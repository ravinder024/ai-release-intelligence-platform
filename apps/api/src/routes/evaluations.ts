import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { runModel } from "../services/execution.js";
import { judgeResult } from "../services/evaluator.js";
import { resolveUserProvider } from "../services/userProvider.js";
import { attachReservationToRun, settlePlatformCredit } from "../services/usage.js";
import { authRequired, optionalAuth } from "../auth.js";
import { supportedModels, type EvaluationResult, type EvaluationRun, type EvaluationRunSummary, type ModelId } from "@prompt-playground/shared";
import type { ModelOutcome } from "../services/execution.js";
import { rateLimit } from "../rateLimit.js";

const modelIds = supportedModels.map(({ id }) => id) as [ModelId, ...ModelId[]];

const runEvaluationSchema = z.object({
  datasetId: z.string().uuid("Invalid dataset id"),
  experimentId: z.string().uuid().optional(),
  model: z.enum(modelIds),
  modelA: z.enum(modelIds).optional(),
  modelB: z.enum(modelIds).optional(),
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
evaluationsRouter.use(rateLimit({ name: "evaluations", windowMs: 60_000, max: 20 }));

evaluationsRouter.post("/evaluations", authRequired, async (request, response, next) => {
  let reservationId: string | undefined;
  try {
    const payload = runEvaluationSchema.parse(request.body);
    const dataset = await prisma.dataset.findUnique({
      where: { id: payload.datasetId },
      include: { testCases: { orderBy: { position: "asc" } } },
    });
    if (!dataset) return response.status(404).json({ error: "Dataset not found" });
    // Users may only evaluate datasets they own or the shared samples.
    if (!dataset.isSample && dataset.userId !== request.user!.id) {
      return response.status(404).json({ error: "Dataset not found" });
    }

    const resolvedProvider = await resolveUserProvider(request.user!.id, "evaluation");
    reservationId = resolvedProvider.reservationId;

    const run = await prisma.evaluationRun.create({
      data: {
        datasetId: dataset.id,
        experimentId: payload.experimentId ?? null,
        model: payload.model,
        modelA: payload.modelA ?? null,
        modelB: payload.modelB ?? null,
        promptA: payload.promptA,
        promptB: payload.promptB,
        evaluatorModel: payload.evaluatorModel,
        evaluatorThreshold: payload.evaluatorThreshold,
        evaluatorPrompt: payload.evaluatorPrompt,
        userId: request.user!.id,
        status: "running",
      },
    });
    if (resolvedProvider.reservationId) {
      await attachReservationToRun(resolvedProvider.reservationId, run.id);
    }

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

    void executeRun({
      runId: run.id,
      model: payload.model,
      modelA: payload.modelA ?? null,
      modelB: payload.modelB ?? null,
      testCases,
      promptA: payload.promptA,
      promptB: payload.promptB,
      evaluatorModel: payload.evaluatorModel,
      evaluatorThreshold: payload.evaluatorThreshold ?? null,
      evaluatorPrompt: payload.evaluatorPrompt ?? null,
      provider: resolvedProvider.provider,
      reservationId: resolvedProvider.reservationId,
    });

    return response.status(201).json(await findRun(run.id));
  } catch (error) {
    if (reservationId) await settlePlatformCredit(reservationId, false).catch(() => undefined);
    return next(error);
  }
});

evaluationsRouter.get("/evaluations", optionalAuth, async (request, response, next) => {
  try {
    const requestedLimit = Number(request.query.limit ?? 20);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.floor(requestedLimit), 1), 100) : 20;
    const userId = request.user?.id ?? null;
    const runs = await prisma.evaluationRun.findMany({
      take: limit,
      orderBy: { createdAt: "desc" },
      where: { userId: userId ?? "00000000-0000-0000-0000-000000000000" },
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

evaluationsRouter.get("/evaluations/:id", optionalAuth, async (request, response, next) => {
  try {
    const run = await findRun(request.params.id);
    if (!run) return response.status(404).json({ error: "Evaluation run not found" });
    // Legacy records without an owner are not readable by anonymous callers.
    if (!run.userId || run.userId !== request.user?.id) return response.status(404).json({ error: "Evaluation run not found" });
    return response.json(run);
  } catch (error) {
    return next(error);
  }
});

evaluationsRouter.post("/evaluations/:id/stop", authRequired, async (request, response, next) => {
  try {
    const id = request.params.id;
    const run = await prisma.evaluationRun.findUnique({ where: { id }, select: { id: true, userId: true, status: true } });
    if (!run) return response.status(404).json({ error: "Run not found" });
    if (run.userId !== request.user!.id) return response.status(404).json({ error: "Run not found" });
    // mark run as cancelled; executeRun checks this flag cooperatively
    runCancellation.set(id, true);
    if (run.status === "running") {
      await prisma.evaluationRun.update({ where: { id }, data: { status: "partial_failure", completedAt: new Date() } });
    }
    return response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

evaluationsRouter.post("/evaluations/:id/restart", authRequired, async (request, response, next) => {
  try {
    const id = request.params.id;
    const existing = await prisma.evaluationRun.findUnique({ where: { id } });
    if (!existing) return response.status(404).json({ error: "Run not found" });
    if (existing.userId !== request.user!.id) return response.status(404).json({ error: "Run not found" });

    const dataset = await prisma.dataset.findUnique({ where: { id: existing.datasetId }, include: { testCases: { orderBy: { position: "asc" } } } });
    if (!dataset) return response.status(404).json({ error: "Dataset not found" });
    if (!dataset.isSample && dataset.userId !== request.user!.id) return response.status(404).json({ error: "Dataset not found" });

    const resolvedProvider = await resolveUserProvider(request.user!.id, "restart");

    const newRun = await prisma.evaluationRun.create({
      data: {
        datasetId: dataset.id,
        experimentId: existing.experimentId,
        model: existing.model,
        modelA: existing.modelA,
        modelB: existing.modelB,
        promptA: existing.promptA,
        promptB: existing.promptB,
        evaluatorModel: existing.evaluatorModel,
        evaluatorThreshold: existing.evaluatorThreshold,
        evaluatorPrompt: existing.evaluatorPrompt,
        userId: request.user!.id,
        status: "running",
      },
    });
    if (resolvedProvider.reservationId) await attachReservationToRun(resolvedProvider.reservationId, newRun.id);

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

    void executeRun({
      runId: newRun.id,
      model: existing.model as ModelId,
      modelA: existing.modelA as ModelId | null,
      modelB: existing.modelB as ModelId | null,
      testCases,
      promptA: existing.promptA,
      promptB: existing.promptB,
      evaluatorModel: (existing.evaluatorModel as unknown as ModelId) ?? undefined,
      evaluatorThreshold: existing.evaluatorThreshold ?? null,
      evaluatorPrompt: existing.evaluatorPrompt ?? null,
      provider: resolvedProvider.provider,
      reservationId: resolvedProvider.reservationId,
    });

    return response.status(201).json(await findRun(newRun.id));
  } catch (error) {
    next(error);
  }
});

export type TestCase = {
  id: string;
  input: string;
  expectedOutput: string | null;
  evaluationCriteria: string[] | null;
  notes: string | null;
  position: number;
};

export type ExecuteRunOptions = {
  runId: string;
  model: ModelId;
  modelA?: ModelId | null;
  modelB?: ModelId | null;
  testCases: TestCase[];
  /** Run only these specific (testCase, variant) jobs instead of all test cases. */
  jobs?: Array<{ testCase: TestCase; variant: "A" | "B" }>;
  /** Upsert existing results (used by partial retry) instead of always creating. */
  upsert?: boolean;
  promptA: string;
  promptB: string;
  evaluatorModel?: ModelId | null;
  evaluatorThreshold?: number | null;
  evaluatorPrompt?: string | null;
  /** Optional provider override (used by deterministic tests). */
  provider?: import("../provider.js").ModelProvider;
  reservationId?: string;
};

export async function executeRun({
  runId,
  model,
  modelA = null,
  modelB = null,
  testCases,
  jobs: selectedJobs,
  upsert = false,
  promptA,
  promptB,
  evaluatorModel,
  evaluatorThreshold = null,
  evaluatorPrompt = null,
  provider,
  reservationId,
}: ExecuteRunOptions) {
  // ensure cancellation flag exists for this run
  runCancellation.set(runId, false);

  const jobs = selectedJobs ?? testCases.flatMap((testCase) => [
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
        const variantModel = (job.variant === "A" ? modelA ?? model : modelB ?? model) as ModelId;

        // attempt the model call with retries and per-call timeout
        let outcome: ModelOutcome | null = null;
        let lastError = "";
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          if (runCancellation.get(runId)) break;
          const start = performance.now();
          try {
            const race = await Promise.race([
              runModel(variantModel, prompt, job.testCase.input, provider),
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

        const resultData = {
          runId,
          testCaseId: job.testCase.id,
          variant: job.variant,
          prompt,
          output: outcome.ok ? outcome.output : null,
          responseSnapshot: outcome.ok ? { output: outcome.output } : undefined,
          modelMetadata: { model: variantModel },
          inputSnapshot: job.testCase.input,
          expectedOutputSnapshot: job.testCase.expectedOutput,
          criteriaSnapshot: job.testCase.evaluationCriteria ?? undefined,
          latencyMs: outcome.latencyMs,
          inputTokens: outcome.ok ? outcome.inputTokens : null,
          outputTokens: outcome.ok ? outcome.outputTokens : null,
          totalTokens: outcome.ok ? outcome.totalTokens : null,
          estimatedCostUsd: outcome.ok ? outcome.estimatedCostUsd : null,
          status: outcome.ok ? ("completed" as const) : ("failed" as const),
          errorMessage: outcome.ok ? null : outcome.error,
        };

        // On upsert (partial retry) we only ever touch results that failed, so we can safely
        // replace them. Successful historical results are never overwritten.
        let result: { id: string };
        if (upsert) {
          const existing = await prisma.evaluationResult.findFirst({
            where: { runId, testCaseId: job.testCase.id, variant: job.variant },
            select: { id: true, judgement: { select: { id: true } } },
          });
          if (existing) {
            if (existing.judgement) {
              await prisma.evaluationJudgement.delete({ where: { id: existing.judgement.id } }).catch(() => undefined);
            }
            result = await prisma.evaluationResult.update({ where: { id: existing.id }, data: resultData });
          } else {
            result = await prisma.evaluationResult.create({ data: resultData });
          }
        } else {
          result = await prisma.evaluationResult.create({ data: resultData });
        }

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
            ...(provider
              ? {
                  provider: {
                    execute: async (opts: { model: string; prompt: string; input: string }) => {
                      const modelResult = await provider.execute({ model: opts.model as ModelId, prompt: opts.prompt, input: opts.input });
                      return { output: modelResult.output };
                    },
                  },
                }
              : {}),
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
    if (reservationId) {
      const completedWork = await prisma.evaluationResult.count({ where: { runId, status: "completed" } }) > 0;
      await settlePlatformCredit(reservationId, completedWork).catch((error) => console.error("Could not settle evaluation credit:", error));
    }
    await prisma.evaluationRun.update({
      where: { id: runId },
      data: { status: anyFailed ? "partial_failure" : "completed", completedAt: new Date() },
    });
    // Sync owning experiment status (Phase 4)
    const finishedRun = await prisma.evaluationRun.findUnique({ where: { id: runId }, select: { experimentId: true, status: true } });
    if (finishedRun?.experimentId) {
      await prisma.experiment.update({
        where: { id: finishedRun.experimentId },
        data: { status: finishedRun.status === "partial_failure" ? "partial_failure" : "completed" },
      });
    }
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

export async function findRun(id: string): Promise<EvaluationRun | null> {
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
  // Progress counts only successfully evaluated results — execution failures and
  // evaluator failures do NOT advance the progress bar (so a partial-failure run
  // no longer misleadingly reports 100%).
  const completed = run.results.filter((result) => {
    if (result.status !== "completed") return false;
    if (!run.evaluatorModel) return true; // human judgement: any completed result counts
    return result.judgement?.status === "completed";
  }).length;
  return {
    id: run.id,
    datasetId: run.datasetId,
    datasetName: run.dataset.name,
    experimentId: run.experimentId ?? null,
    userId: run.userId ?? null,
    model: run.model as ModelId,
    modelA: run.modelA as ModelId | null,
    modelB: run.modelB as ModelId | null,
    promptA: run.promptA,
    promptB: run.promptB,
    evaluatorModel: run.evaluatorModel ?? null,
    evaluatorThreshold: run.evaluatorThreshold ?? null,
    evaluatorPrompt: run.evaluatorPrompt ?? null,
    status: run.status,
    createdAt: run.createdAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    progress: { completed, total },
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
