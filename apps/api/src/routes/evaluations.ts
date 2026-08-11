import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { runModel } from "../services/execution.js";
import { supportedModels, type EvaluationResult, type EvaluationRun, type EvaluationRunSummary, type ModelId } from "@prompt-playground/shared";

const modelIds = supportedModels.map(({ id }) => id) as [ModelId, ...ModelId[]];

const runEvaluationSchema = z.object({
  datasetId: z.string().uuid("Invalid dataset id"),
  model: z.enum(modelIds),
  promptA: z.string().trim().min(1, "Prompt A is required").max(50_000),
  promptB: z.string().trim().min(1, "Prompt B is required").max(50_000),
});

const CONCURRENCY = 3;

export const evaluationsRouter = Router();

evaluationsRouter.post("/evaluations", async (request, response, next) => {
  try {
    const payload = runEvaluationSchema.parse(request.body);
    const dataset = await prisma.dataset.findUnique({
      where: { id: payload.datasetId },
      include: { testCases: { orderBy: { position: "asc" } } },
    });
    if (!dataset) return response.status(404).json({ error: "Dataset not found" });

    const run = await prisma.evaluationRun.create({
      data: {
        datasetId: dataset.id,
        model: payload.model,
        promptA: payload.promptA,
        promptB: payload.promptB,
        status: "running",
      },
    });

    void executeRun(run.id, payload.model, dataset.testCases, payload.promptA, payload.promptB);

    return response.status(201).json(await findRun(run.id));
  } catch (error) {
    return next(error);
  }
});

evaluationsRouter.get("/evaluations", async (request, response, next) => {
  try {
    const requestedLimit = Number(request.query.limit ?? 20);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.floor(requestedLimit), 1), 100) : 20;
    const runs = await prisma.evaluationRun.findMany({
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        dataset: { select: { name: true, _count: { select: { testCases: true } } } },
        _count: { select: { results: true } },
      },
    });
    response.json(runs.map(toRunSummary));
  } catch (error) {
    next(error);
  }
});

evaluationsRouter.get("/evaluations/:id", async (request, response, next) => {
  try {
    const run = await findRun(request.params.id);
    if (!run) return response.status(404).json({ error: "Evaluation run not found" });
    return response.json(run);
  } catch (error) {
    return next(error);
  }
});

type TestCase = {
  id: string;
  input: string;
  expectedOutput: string | null;
  notes: string | null;
  position: number;
};

async function executeRun(runId: string, model: ModelId, testCases: TestCase[], promptA: string, promptB: string) {
  const jobs = testCases.flatMap((testCase) => [
    { testCase, variant: "A" as const },
    { testCase, variant: "B" as const },
  ]);

  let anyFailed = false;

  try {
    await mapWithConcurrency(jobs, CONCURRENCY, async (job) => {
      try {
        const prompt = job.variant === "A" ? promptA : promptB;
        const outcome = await runModel(model, prompt, job.testCase.input);
        if (!outcome.ok) anyFailed = true;

        await prisma.evaluationResult.create({
          data: {
            runId,
            testCaseId: job.testCase.id,
            variant: job.variant,
            prompt,
            output: outcome.ok ? outcome.output : null,
            latencyMs: outcome.latencyMs,
            inputTokens: outcome.ok ? outcome.inputTokens : null,
            outputTokens: outcome.ok ? outcome.outputTokens : null,
            totalTokens: outcome.ok ? outcome.totalTokens : null,
            estimatedCostUsd: outcome.ok ? outcome.estimatedCostUsd : null,
            status: outcome.ok ? "completed" : "failed",
            errorMessage: outcome.ok ? null : outcome.error,
          },
        });
      } catch (error) {
        anyFailed = true;
        console.error(`Evaluation result write failed for run ${runId}:`, error);
      }
    });
  } catch (error) {
    anyFailed = true;
    console.error(`Evaluation run ${runId} crashed:`, error);
  } finally {
    await prisma.evaluationRun.update({
      where: { id: runId },
      data: { status: anyFailed ? "partial_failure" : "completed", completedAt: new Date() },
    });
  }
}

async function mapWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      await worker(items[current]);
    }
  });
  await Promise.all(workers);
}

async function findRun(id: string): Promise<EvaluationRun | null> {
  const run = await prisma.evaluationRun.findUnique({
    where: { id },
    include: {
      dataset: {
        select: {
          name: true,
          testCases: { select: { id: true, datasetId: true, input: true, expectedOutput: true, notes: true, position: true }, orderBy: { position: "asc" } },
        },
      },
      results: { select: { id: true, testCaseId: true, variant: true, prompt: true, output: true, latencyMs: true, inputTokens: true, outputTokens: true, totalTokens: true, estimatedCostUsd: true, status: true, errorMessage: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!run) return null;

  const testCases = run.dataset.testCases;
  const total = testCases.length * 2;
  return {
    id: run.id,
    datasetId: run.datasetId,
    datasetName: run.dataset.name,
    model: run.model as ModelId,
    promptA: run.promptA,
    promptB: run.promptB,
    status: run.status,
    createdAt: run.createdAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    progress: { completed: run.results.length, total },
    testCases,
    results: run.results.map((result) => ({
      ...result,
      estimatedCostUsd: result.estimatedCostUsd ? Number(result.estimatedCostUsd) : null,
    })) as EvaluationResult[],
  };
}

type RunWithSummary = {
  id: string;
  datasetId: string;
  model: string;
  status: "running" | "completed" | "partial_failure";
  createdAt: Date;
  completedAt: Date | null;
  dataset: { name: string; _count: { testCases: number } };
  _count: { results: number };
};

function toRunSummary(run: RunWithSummary): EvaluationRunSummary {
  return {
    id: run.id,
    datasetId: run.datasetId,
    datasetName: run.dataset.name,
    model: run.model as ModelId,
    status: run.status,
    createdAt: run.createdAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    testCaseCount: run.dataset._count.testCases,
    resultCount: run._count.results,
  };
}
