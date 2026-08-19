import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { runModel } from "../services/execution.js";
import { judgeResult } from "../services/evaluator.js";
import { supportedModels, type EvaluationResult, type EvaluationRun, type EvaluationRunSummary, type ModelId } from "@prompt-playground/shared";
import type { ModelOutcome } from "../services/execution.js";

const modelIds = supportedModels.map(({ id }) => id) as [ModelId, ...ModelId[]];

const runEvaluationSchema = z.object({
  datasetId: z.string().uuid("Invalid dataset id"),
  model: z.enum(modelIds),
  promptA: z.string().trim().min(1, "Prompt A is required").max(50_000),
  promptB: z.string().trim().min(1, "Prompt B is required").max(50_000),
  evaluatorModel: z.enum(modelIds).optional(),
  evaluatorThreshold: z.number().int().min(0).max(100).optional(),
  evaluatorPrompt: z.string().trim().max(50_000).optional(),
});

const CONCURRENCY = 3;
const PER_TEST_TIMEOUT_MS = Number(process.env.EVAL_TEST_TIMEOUT_MS ?? 45000);
const MAX_ATTEMPTS = Number(process.env.EVAL_MAX_ATTEMPTS ?? 2);

// In-memory cancellation registry for running evaluations (cooperative cancellation)
const runCancellation = new Map<string, boolean>();

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
        evaluatorModel: payload.evaluatorModel,
        evaluatorThreshold: payload.evaluatorThreshold,
        evaluatorPrompt: payload.evaluatorPrompt,
        status: "running",
      },
    });

    // register cancellation flag for this run (cooperative cancellation)
    runCancellation.set(run.id, false);

    const testCases = dataset.testCases.map((testCase) => ({
      id: testCase.id,
      input: testCase.input,
      expectedOutput: testCase.expectedOutput,
      evaluationCriteria: Array.isArray(testCase.evaluationCriteria)
        ? testCase.evaluationCriteria.map((item) => String(item))
        : null,
      notes: testCase.notes,
      position: testCase.position,
    }));

    void executeRun(
      run.id,
      payload.model,
      testCases,
      payload.promptA,
      payload.promptB,
      payload.evaluatorModel,
      payload.evaluatorThreshold ?? null,
      payload.evaluatorPrompt ?? null,
    );

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

evaluationsRouter.post("/evaluations/:id/stop", async (request, response, next) => {
  try {
    const id = request.params.id;
    // mark run as cancelled; executeRun checks this flag cooperatively
    runCancellation.set(id, true);
    // update run status to partial_failure if still running
    const run = await prisma.evaluationRun.findUnique({ where: { id } });
    if (!run) return response.status(404).json({ error: "Run not found" });
    if (run.status === "running") {
      await prisma.evaluationRun.update({ where: { id }, data: { status: "partial_failure", completedAt: new Date() } });
    }
    return response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

evaluationsRouter.post("/evaluations/:id/restart", async (request, response, next) => {
  try {
    const id = request.params.id;
    const existing = await prisma.evaluationRun.findUnique({ where: { id } });
    if (!existing) return response.status(404).json({ error: "Run not found" });

    const dataset = await prisma.dataset.findUnique({ where: { id: existing.datasetId }, include: { testCases: { orderBy: { position: "asc" } } } });
    if (!dataset) return response.status(404).json({ error: "Dataset not found" });

    const newRun = await prisma.evaluationRun.create({
      data: {
        datasetId: dataset.id,
        model: existing.model,
        promptA: existing.promptA,
        promptB: existing.promptB,
        evaluatorModel: existing.evaluatorModel,
        evaluatorThreshold: existing.evaluatorThreshold,
        evaluatorPrompt: existing.evaluatorPrompt,
        status: "running",
      },
    });

    const testCases = dataset.testCases.map((testCase) => ({
      id: testCase.id,
      input: testCase.input,
      expectedOutput: testCase.expectedOutput,
      evaluationCriteria: Array.isArray(testCase.evaluationCriteria) ? testCase.evaluationCriteria.map((item) => String(item)) : null,
      notes: testCase.notes,
      position: testCase.position,
    }));

    // clear cancellation for the new run
    runCancellation.delete(newRun.id);

    void executeRun(
      newRun.id,
      existing.model as ModelId,
      testCases,
      existing.promptA,
      existing.promptB,
      (existing.evaluatorModel as unknown as ModelId) ?? undefined,
      existing.evaluatorThreshold ?? null,
      existing.evaluatorPrompt ?? null,
    );

    return response.status(201).json(await findRun(newRun.id));
  } catch (error) {
    next(error);
  }
});

type TestCase = {
  id: string;
  input: string;
  expectedOutput: string | null;
  evaluationCriteria: string[] | null;
  notes: string | null;
  position: number;
};

async function executeRun(
  runId: string,
  model: ModelId,
  testCases: TestCase[],
  promptA: string,
  promptB: string,
  evaluatorModel: ModelId | undefined,
  evaluatorThreshold: number | null,
  evaluatorPrompt: string | null,
) {
  // ensure cancellation flag exists for this run
  runCancellation.set(runId, false);

  const jobs = testCases.flatMap((testCase) => [
    { testCase, variant: "A" as const },
    { testCase, variant: "B" as const },
  ]);

  let anyFailed = false;

  try {
    await mapWithConcurrency(jobs, CONCURRENCY, async (job) => {
      // cooperative cancellation: stop processing further jobs if run is cancelled
      if (runCancellation.get(runId)) return;
      try {
        const prompt = job.variant === "A" ? promptA : promptB;

        // attempt the model call with retries and per-call timeout
        let outcome: ModelOutcome | null = null;
        let lastError = "";
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          if (runCancellation.get(runId)) break;
          const start = performance.now();
          try {
            const race = await Promise.race([
              runModel(model, prompt, job.testCase.input),
              new Promise<{ ok: false; latencyMs: number; error: string }>((resolve) =>
                setTimeout(() => resolve({ ok: false, latencyMs: Math.round(performance.now() - start), error: "timeout" }), PER_TEST_TIMEOUT_MS),
              ),
            ]);
            outcome = race as ModelOutcome;
            if (outcome && outcome.ok) break;
            lastError = (!outcome || outcome.ok === undefined || (outcome as any).error === undefined) ? "unknown" : (outcome as any).error;
          } catch (err) {
            lastError = err instanceof Error ? err.message : String(err);
          }
        }

        if (!outcome) {
          outcome = { ok: false, latencyMs: 0, error: lastError || "no outcome" };
        }

        if (!outcome.ok) anyFailed = true;

        const result = await prisma.evaluationResult.create({
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

        if (runCancellation.get(runId)) return;

        if (evaluatorModel && outcome.ok) {
          const judgement = await judgeResult({
            evaluatorModel,
            evaluatorPrompt,
            input: job.testCase.input,
            response: outcome.output,
            expectedOutput: job.testCase.expectedOutput,
            criteria: job.testCase.evaluationCriteria ?? ["Overall response quality"],
            threshold: evaluatorThreshold,
          });

          await prisma.evaluationJudgement.create({
            data: {
              resultId: result.id,
              overallScore: judgement.overallScore,
              pass: judgement.pass,
              summary: judgement.summary,
              evaluatorModel: judgement.evaluatorModel,
              threshold: judgement.threshold,
              status: judgement.status,
              errorMessage: judgement.errorMessage,
              rawOutput: judgement.rawOutput ?? null,
              criteriaResults: {
                create: judgement.criteriaResults.map((criterion) => ({
                  criterion: criterion.criterion,
                  score: criterion.score,
                  pass: criterion.pass,
                  reason: criterion.reason,
                })),
              },
            },
          });

          if (judgement.status === "failed") anyFailed = true;
        }
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
    // remove cancellation flag after run finishes
    runCancellation.delete(runId);
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
          testCases: { select: { id: true, datasetId: true, input: true, expectedOutput: true, evaluationCriteria: true, notes: true, position: true }, orderBy: { position: "asc" } },
        },
      },
      results: {
        orderBy: { createdAt: "asc" },
        include: {
          judgement: { include: { criteriaResults: true } },
        },
      },
    },
  });
  if (!run) return null;

  const testCases = run.dataset.testCases.map((testCase) => ({
    ...testCase,
    evaluationCriteria: Array.isArray(testCase.evaluationCriteria)
      ? testCase.evaluationCriteria.map((item) => String(item))
      : null,
  }));
  const total = testCases.length * 2;
  return {
    id: run.id,
    datasetId: run.datasetId,
    datasetName: run.dataset.name,
    model: run.model as ModelId,
    promptA: run.promptA,
    promptB: run.promptB,
    evaluatorModel: run.evaluatorModel ?? null,
    evaluatorThreshold: run.evaluatorThreshold ?? null,
    evaluatorPrompt: run.evaluatorPrompt ?? null,
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
