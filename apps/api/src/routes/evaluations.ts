import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { runModel } from "../services/execution.js";
import { judgeResult } from "../services/evaluator.js";
import { attachReservationToRun, reservePlatformCredit, reservePlatformCreditForRun, settlePlatformCredit } from "../services/usage.js";
import { authRequired } from "../auth.js";
import { type EvaluationResult, type EvaluationRun, type EvaluationRunSummary, type ModelId, type ModelSelectionSnapshot } from "@prompt-playground/shared";
import type { ModelOutcome } from "../services/execution.js";
import { rateLimit } from "../rateLimit.js";
import { providerSnapshot, resolveLegacyModel, resolveModelSelection, resolveModelSnapshot } from "../services/modelSelection.js";

const runEvaluationSchema = z.object({
  datasetId: z.string().uuid("Invalid dataset id"),
  experimentId: z.string().uuid().optional(),
  model: z.string().trim().min(1).max(200),
  modelA: z.string().trim().min(1).max(200).optional(),
  modelB: z.string().trim().min(1).max(200).optional(),
  promptA: z.string().trim().min(1, "Prompt A is required").max(50_000),
  promptB: z.string().trim().min(1, "Prompt B is required").max(50_000),
  evaluatorModel: z.string().trim().min(1).max(200).optional(),
  evaluatorThreshold: z.number().int().min(0).max(100).optional(),
  evaluatorPrompt: z.string().trim().max(50_000).optional(),
  modelSelection: z.object({ modelId: z.string().min(1).max(200), provider: z.enum(["openai", "anthropic", "gemini", "deepseek", "openrouter"]), source: z.enum(["platform_free", "byok"]), connectionId: z.string().uuid().optional() }).optional(),
  modelASelection: z.object({ modelId: z.string().min(1).max(200), provider: z.enum(["openai", "anthropic", "gemini", "deepseek", "openrouter"]), source: z.enum(["platform_free", "byok"]), connectionId: z.string().uuid().optional() }).optional(),
  modelBSelection: z.object({ modelId: z.string().min(1).max(200), provider: z.enum(["openai", "anthropic", "gemini", "deepseek", "openrouter"]), source: z.enum(["platform_free", "byok"]), connectionId: z.string().uuid().optional() }).optional(),
  evaluatorSelection: z.object({ modelId: z.string().min(1).max(200), provider: z.enum(["openai", "anthropic", "gemini", "deepseek", "openrouter"]), source: z.enum(["platform_free", "byok"]), connectionId: z.string().uuid().optional() }).optional(),
});

const CONCURRENCY = 3;
const PER_TEST_TIMEOUT_MS = Number(process.env.EVAL_TEST_TIMEOUT_MS ?? 45000);
const MAX_ATTEMPTS = Number(process.env.EVAL_MAX_ATTEMPTS ?? 2);

// In-memory cancellation registry for running evaluations (cooperative cancellation)
const runCancellation = new Map<string, boolean>();

// Tracks which execution currently "owns" a run. A stopped run can be resumed, which starts a
// new execution for the same run id; the epoch stops the superseded execution from overwriting
// the newer one's status when it eventually unwinds.
const runExecutionEpoch = new Map<string, number>();

/**
 * Cooperatively stop a run: flags in-flight work to wind down and immediately reflects the
 * interruption in the UI (run + owning experiment become `partial_failure`). The remaining
 * scenarios can later be picked up again with a resume.
 * Returns true when a running evaluation was actually flagged.
 */
export async function requestStop(runId: string): Promise<boolean> {
  const run = await prisma.evaluationRun.findUnique({
    where: { id: runId },
    select: { status: true, experimentId: true },
  });
  if (!run) return false;
  // Always set the flag: an in-flight execution checks it between attempts and jobs.
  runCancellation.set(runId, true);
  if (run.status !== "running") return false;
  await prisma.evaluationRun.update({
    where: { id: runId },
    data: { status: "partial_failure", completedAt: new Date() },
  });
  if (run.experimentId) {
    await prisma.experiment.update({ where: { id: run.experimentId }, data: { status: "partial_failure" } });
  }
  return true;
}

export const evaluationsRouter = Router();
// Polling (`GET /evaluations/:id`) must never share a bucket with mutating calls: the results page
// polls every few seconds, so a single tight limit throttled the poller and froze the progress bar.
const evaluationReadLimit = rateLimit({ name: "evaluations-read", windowMs: 60_000, max: 600 });
const evaluationWriteLimit = rateLimit({ name: "evaluations-write", windowMs: 60_000, max: 30 });

/**
 * Run ids currently being executed by this process. Used by the stale-run recovery sweep so it
 * can only ever clean up genuinely orphaned runs and never a long-but-healthy in-flight one.
 */
export function activeRunIds(): string[] {
  return [...runExecutionEpoch.keys()];
}

/**
 * Only one evaluation per dataset may execute at a time for a given account.
 *
 * Without this guard a repeated click on Restart ("nothing happened, click again") starts a new
 * full run each time. Production showed 13 identical runs created in 17 seconds, all hammering
 * the same free model, which is what produced the provider rate limits and the crawling runs.
 */
async function findActiveRunForDataset(userId: string, datasetId: string, excludeRunId?: string) {
  return prisma.evaluationRun.findFirst({
    where: {
      userId,
      datasetId,
      status: "running",
      ...(excludeRunId ? { id: { not: excludeRunId } } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
}

const RUN_IN_PROGRESS_MESSAGE =
  "Another evaluation for this dataset is still running. Stop it first, or wait for it to finish.";

evaluationsRouter.post("/evaluations", evaluationWriteLimit, authRequired, async (request, response, next) => {
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

    const activeRun = await findActiveRunForDataset(request.user!.id, dataset.id);
    if (activeRun) {
      return response.status(409).json({ error: RUN_IN_PROGRESS_MESSAGE, code: "RUN_IN_PROGRESS", runId: activeRun.id });
    }

    const selectionA = payload.modelASelection ?? payload.modelSelection;
    const selectionB = payload.modelBSelection ?? payload.modelSelection;
    const resolvedA = selectionA ? await resolveModelSelection(request.user!.id, selectionA) : await resolveLegacyModel(request.user!.id, payload.modelA ?? payload.model);
    const resolvedB = selectionB ? await resolveModelSelection(request.user!.id, selectionB) : await resolveLegacyModel(request.user!.id, payload.modelB ?? payload.model);
    const resolvedEvaluator = payload.evaluatorModel
      ? payload.evaluatorSelection ? await resolveModelSelection(request.user!.id, payload.evaluatorSelection) : await resolveLegacyModel(request.user!.id, payload.evaluatorModel)
      : null;
    const usesPlatform = [resolvedA.snapshot, resolvedB.snapshot, ...(resolvedEvaluator ? [resolvedEvaluator.snapshot] : [])].some((snapshot) => snapshot.source === "platform_free");
    if (usesPlatform) {
      reservationId = await reservePlatformCredit(request.user!.id, "evaluation");
    }

    const run = await prisma.evaluationRun.create({
      data: {
        datasetId: dataset.id,
        experimentId: payload.experimentId ?? null,
        model: resolvedA.snapshot.modelId,
        modelA: resolvedA.snapshot.modelId,
        modelB: resolvedB.snapshot.modelId,
        promptA: payload.promptA,
        promptB: payload.promptB,
        evaluatorModel: resolvedEvaluator?.snapshot.modelId ?? null,
        evaluatorThreshold: payload.evaluatorThreshold,
        evaluatorPrompt: payload.evaluatorPrompt,
        modelConfigA: resolvedA.snapshot,
        modelConfigB: resolvedB.snapshot,
        evaluatorConfig: resolvedEvaluator?.snapshot ?? undefined,
        userId: request.user!.id,
        status: "running",
      },
    });
    if (reservationId) await attachReservationToRun(reservationId, run.id);

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
      model: resolvedA.snapshot.modelId,
      modelA: resolvedA.snapshot.modelId,
      modelB: resolvedB.snapshot.modelId,
      testCases,
      promptA: payload.promptA,
      promptB: payload.promptB,
      evaluatorModel: resolvedEvaluator?.snapshot.modelId,
      evaluatorThreshold: payload.evaluatorThreshold ?? null,
      evaluatorPrompt: payload.evaluatorPrompt ?? null,
      providerA: resolvedA.provider,
      providerB: resolvedB.provider,
      evaluatorProvider: resolvedEvaluator?.provider,
      modelConfigA: resolvedA.snapshot,
      modelConfigB: resolvedB.snapshot,
      evaluatorConfig: resolvedEvaluator?.snapshot ?? null,
      reservationId,
    }).catch((error) => {
      // An unhandled rejection here would take the process down and leave the run to the sweep.
      console.error(`Evaluation run ${run.id} failed to start:`, error);
    });

    return response.status(201).json(await findRun(run.id));
  } catch (error) {
    if (reservationId) await settlePlatformCredit(reservationId, false).catch(() => undefined);
    return next(error);
  }
});

evaluationsRouter.get("/evaluations", evaluationReadLimit, authRequired, async (request, response, next) => {
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

evaluationsRouter.get("/evaluations/:id", evaluationReadLimit, authRequired, async (request, response, next) => {
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

evaluationsRouter.post("/evaluations/:id/stop", evaluationWriteLimit, authRequired, async (request, response, next) => {
  try {
    const id = request.params.id;
    const run = await prisma.evaluationRun.findUnique({ where: { id }, select: { id: true, userId: true, status: true } });
    if (!run) return response.status(404).json({ error: "Run not found" });
    if (run.userId !== request.user!.id) return response.status(404).json({ error: "Run not found" });
    const stopped = await requestStop(id);
    return response.json({ ok: true, stopped });
  } catch (error) {
    next(error);
  }
});

evaluationsRouter.post("/evaluations/:id/restart", evaluationWriteLimit, authRequired, async (request, response, next) => {
  try {
    const id = request.params.id;
    const existing = await prisma.evaluationRun.findUnique({ where: { id } });
    if (!existing) return response.status(404).json({ error: "Run not found" });
    if (existing.userId !== request.user!.id) return response.status(404).json({ error: "Run not found" });

    const dataset = await prisma.dataset.findUnique({ where: { id: existing.datasetId }, include: { testCases: { orderBy: { position: "asc" } } } });
    if (!dataset) return response.status(404).json({ error: "Dataset not found" });
    if (!dataset.isSample && dataset.userId !== request.user!.id) return response.status(404).json({ error: "Dataset not found" });

    // Restart must never multiply work: refuse while a *different* run of this dataset is active,
    // and stop the run being replaced so two executors never hammer the provider at once.
    const activeRun = await findActiveRunForDataset(request.user!.id, existing.datasetId, existing.id);
    if (activeRun) {
      return response.status(409).json({ error: RUN_IN_PROGRESS_MESSAGE, code: "RUN_IN_PROGRESS", runId: activeRun.id });
    }
    await requestStop(existing.id).catch(() => undefined);

    const oldConfigA = providerSnapshot(existing.modelConfigA);
    const oldConfigB = providerSnapshot(existing.modelConfigB);
    const oldEvaluatorConfig = providerSnapshot(existing.evaluatorConfig);
    const resolvedA = oldConfigA
      ? { provider: await resolveModelSnapshot(request.user!.id, oldConfigA), snapshot: oldConfigA }
      : await resolveLegacyModel(request.user!.id, existing.modelA ?? existing.model);
    const resolvedB = oldConfigB
      ? { provider: await resolveModelSnapshot(request.user!.id, oldConfigB), snapshot: oldConfigB }
      : await resolveLegacyModel(request.user!.id, existing.modelB ?? existing.model);
    const resolvedEvaluator = existing.evaluatorModel
      ? oldEvaluatorConfig
        ? { provider: await resolveModelSnapshot(request.user!.id, oldEvaluatorConfig), snapshot: oldEvaluatorConfig }
        : await resolveLegacyModel(request.user!.id, existing.evaluatorModel)
      : null;
    const usesPlatform = [resolvedA.snapshot, resolvedB.snapshot, ...(resolvedEvaluator ? [resolvedEvaluator.snapshot] : [])].some((snapshot) => snapshot.source === "platform_free");
    const reservationId = usesPlatform ? await reservePlatformCredit(request.user!.id, "restart") : undefined;

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
        modelConfigA: resolvedA.snapshot,
        modelConfigB: resolvedB.snapshot,
        evaluatorConfig: resolvedEvaluator?.snapshot ?? undefined,
        userId: request.user!.id,
        status: "running",
      },
    });
    if (reservationId) await attachReservationToRun(reservationId, newRun.id);

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

    // keep the owning experiment (if any) in sync while the fresh run executes
    if (newRun.experimentId) {
      await prisma.experiment.update({ where: { id: newRun.experimentId }, data: { status: "running" } });
    }

    void executeRun({
      runId: newRun.id,
      model: resolvedA.snapshot.modelId,
      modelA: resolvedA.snapshot.modelId,
      modelB: resolvedB.snapshot.modelId,
      testCases,
      promptA: existing.promptA,
      promptB: existing.promptB,
      evaluatorModel: resolvedEvaluator?.snapshot.modelId,
      evaluatorThreshold: existing.evaluatorThreshold ?? null,
      evaluatorPrompt: existing.evaluatorPrompt ?? null,
      providerA: resolvedA.provider,
      providerB: resolvedB.provider,
      evaluatorProvider: resolvedEvaluator?.provider,
      modelConfigA: resolvedA.snapshot,
      modelConfigB: resolvedB.snapshot,
      evaluatorConfig: resolvedEvaluator?.snapshot ?? null,
      reservationId,
    });

    return response.status(201).json(await findRun(newRun.id));
  } catch (error) {
    next(error);
  }
});

/**
 * Resume a stopped or partially failed run: re-runs only the missing/failed work in the same run.
 * A resume continues an existing evaluation, so it never spends a new platform credit — the
 * original reservation (if it was released) is reopened instead.
 */
evaluationsRouter.post("/evaluations/:id/resume", evaluationWriteLimit, authRequired, async (request, response, next) => {
  try {
    const run = await prisma.evaluationRun.findUnique({
      where: { id: request.params.id },
      include: {
        dataset: { select: { name: true, testCases: { orderBy: { position: "asc" } } } },
        results: { include: { judgement: true } },
      },
    });
    if (!run) return response.status(404).json({ error: "Evaluation run not found" });
    if (run.userId !== request.user!.id) return response.status(404).json({ error: "Evaluation run not found" });
    if (run.status === "running") return response.status(409).json({ error: "This run is already in progress." });

    const activeRun = await findActiveRunForDataset(request.user!.id, run.datasetId, run.id);
    if (activeRun) {
      return response.status(409).json({ error: RUN_IN_PROGRESS_MESSAGE, code: "RUN_IN_PROGRESS", runId: activeRun.id });
    }

    const testCases: TestCase[] = run.dataset.testCases.map((testCase) => ({
      id: testCase.id,
      input: testCase.input,
      expectedOutput: testCase.expectedOutput,
      evaluationCriteria: Array.isArray(testCase.evaluationCriteria) ? testCase.evaluationCriteria.map((item) => String(item)) : null,
      notes: testCase.notes,
      position: testCase.position,
    }));
    const judgeExpected = Boolean(run.evaluatorModel);

    // Retryable = missing result, failed execution, failed judgement, or a completed execution the
    // judge never scored (the jobs still in flight when the run was stopped).
    const retryable: Array<{ testCase: TestCase; variant: "A" | "B" }> = [];
    for (const testCase of testCases) {
      for (const variant of ["A", "B"] as const) {
        const result = run.results.find((item) => item.testCaseId === testCase.id && item.variant === variant);
        if (!result) { retryable.push({ testCase, variant }); continue; }
        if (result.status === "failed") { retryable.push({ testCase, variant }); continue; }
        if (judgeExpected && (!result.judgement || result.judgement.status === "failed")) retryable.push({ testCase, variant });
      }
    }
    if (retryable.length === 0) {
      return response.json({ retried: 0, remaining: 0, run: await findRun(run.id) });
    }

    const configA = providerSnapshot(run.modelConfigA);
    const configB = providerSnapshot(run.modelConfigB);
    const evaluatorConfig = providerSnapshot(run.evaluatorConfig);
    const resolvedA = configA
      ? { provider: await resolveModelSnapshot(request.user!.id, configA), snapshot: configA }
      : await resolveLegacyModel(request.user!.id, run.modelA ?? run.model);
    const resolvedB = configB
      ? { provider: await resolveModelSnapshot(request.user!.id, configB), snapshot: configB }
      : await resolveLegacyModel(request.user!.id, run.modelB ?? run.model);
    const resolvedEvaluator = run.evaluatorModel
      ? evaluatorConfig
        ? { provider: await resolveModelSnapshot(request.user!.id, evaluatorConfig), snapshot: evaluatorConfig }
        : await resolveLegacyModel(request.user!.id, run.evaluatorModel)
      : null;

    const usesPlatform = [resolvedA.snapshot, resolvedB.snapshot, ...(resolvedEvaluator ? [resolvedEvaluator.snapshot] : [])].some((snapshot) => snapshot.source === "platform_free");
    const reservationId = usesPlatform
      ? await reservePlatformCreditForRun(request.user!.id, run.id, "resume")
      : undefined;

    await prisma.evaluationRun.update({
      where: { id: run.id },
      data: {
        status: "running",
        completedAt: null,
        model: resolvedA.snapshot.modelId,
        modelA: resolvedA.snapshot.modelId,
        modelB: resolvedB.snapshot.modelId,
        modelConfigA: resolvedA.snapshot,
        modelConfigB: resolvedB.snapshot,
        ...(resolvedEvaluator ? { evaluatorConfig: resolvedEvaluator.snapshot } : {}),
      },
    });
    if (run.experimentId) {
      await prisma.experiment.update({ where: { id: run.experimentId }, data: { status: "running" } });
    }
    runCancellation.set(run.id, false);

    void executeRun({
      runId: run.id,
      model: resolvedA.snapshot.modelId,
      modelA: resolvedA.snapshot.modelId,
      modelB: resolvedB.snapshot.modelId,
      testCases,
      jobs: retryable,
      upsert: true,
      promptA: run.promptA,
      promptB: run.promptB,
      evaluatorModel: resolvedEvaluator?.snapshot.modelId,
      evaluatorThreshold: run.evaluatorThreshold ?? null,
      evaluatorPrompt: run.evaluatorPrompt ?? null,
      providerA: resolvedA.provider,
      providerB: resolvedB.provider,
      evaluatorProvider: resolvedEvaluator?.provider,
      modelConfigA: resolvedA.snapshot,
      modelConfigB: resolvedB.snapshot,
      evaluatorConfig: resolvedEvaluator?.snapshot ?? null,
      reservationId,
    }).catch((error) => {
      console.error(`Resumed evaluation run ${run.id} failed to start:`, error);
    });

    return response.json({ retried: retryable.length, remaining: retryable.length, run: await findRun(run.id) });
  } catch (error) {
    return next(error);
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
  model: string;
  modelA?: string | null;
  modelB?: string | null;
  testCases: TestCase[];
  /** Run only these specific (testCase, variant) jobs instead of all test cases. */
  jobs?: Array<{ testCase: TestCase; variant: "A" | "B" }>;
  /** Upsert existing results (used by partial retry) instead of always creating. */
  upsert?: boolean;
  promptA: string;
  promptB: string;
  evaluatorModel?: string | null;
  evaluatorThreshold?: number | null;
  evaluatorPrompt?: string | null;
  /** Optional provider override (used by deterministic tests). */
  provider?: import("../provider.js").ModelProvider;
  providerA?: import("../provider.js").ModelProvider;
  providerB?: import("../provider.js").ModelProvider;
  evaluatorProvider?: import("../provider.js").ModelProvider;
  modelConfigA?: ModelSelectionSnapshot | null;
  modelConfigB?: ModelSelectionSnapshot | null;
  evaluatorConfig?: ModelSelectionSnapshot | null;
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
  providerA,
  providerB,
  evaluatorProvider,
  modelConfigA,
  modelConfigB,
  evaluatorConfig,
  reservationId,
}: ExecuteRunOptions) {
  // ensure cancellation flag exists for this run, and claim ownership of its status
  runCancellation.set(runId, false);
  const epoch = (runExecutionEpoch.get(runId) ?? 0) + 1;
  runExecutionEpoch.set(runId, epoch);

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
        const variantModel = job.variant === "A" ? modelA ?? model : modelB ?? model;
        const variantConfig = job.variant === "A" ? modelConfigA : modelConfigB;
        const variantProvider = job.variant === "A" ? providerA ?? provider : providerB ?? provider;

        // attempt the model call with retries and per-call timeout
        let outcome: ModelOutcome | null = null;
        let lastError = "";
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          if (runCancellation.get(runId)) break;
          const start = performance.now();
          try {
            const race = await Promise.race([
              runModel(variantModel, prompt, job.testCase.input, variantProvider, variantConfig ? {
                inputCostPerMillion: variantConfig.inputCostPerMillion,
                outputCostPerMillion: variantConfig.outputCostPerMillion,
              } : undefined),
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
          modelMetadata: { model: variantModel, ...(variantConfig ?? {}) },
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

        // NB: no cancellation check here on purpose. Cancellation only stops work that has not
        // started yet; once a model call has succeeded we always finish the job (score included),
        // otherwise a stopped run would leave completed results that can never be judged.
        if (evaluatorModel && outcome.ok) {
          const judgement = await judgeResult({
            evaluatorModel,
            evaluatorPrompt,
            input: job.testCase.input,
            response: outcome.output,
            expectedOutput: job.testCase.expectedOutput,
            criteria: job.testCase.evaluationCriteria ?? ["Overall response quality"],
            threshold: evaluatorThreshold,
            ...((evaluatorProvider ?? provider)
              ? {
                  provider: {
                    execute: async (opts: { model: string; prompt: string; input: string }) => {
                      const modelResult = await (evaluatorProvider ?? provider)!.execute({ model: opts.model, prompt: opts.prompt, input: opts.input });
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
    const cancelled = runCancellation.get(runId) === true;
    const finalStatus = anyFailed || cancelled ? "partial_failure" : "completed";
    // The credit belongs to this execution, so it always settles, even if a resume took over.
    if (reservationId) {
      await settlePlatformCredit(reservationId, finalStatus === "completed").catch((error) => console.error("Could not settle evaluation credit:", error));
    }
    // A newer execution (a resume after a stop) owns this run now — do not clobber its status.
    if (runExecutionEpoch.get(runId) === epoch) {
      await prisma.evaluationRun.update({
        where: { id: runId },
        data: { status: finalStatus, completedAt: new Date() },
      });
      // Sync owning experiment status (Phase 4) — but only while this run is still the
      // experiment's latest run, so a superseded run cannot overwrite a fresh one.
      const finishedRun = await prisma.evaluationRun.findUnique({ where: { id: runId }, select: { experimentId: true } });
      if (finishedRun?.experimentId) {
        const latestRun = await prisma.evaluationRun.findFirst({
          where: { experimentId: finishedRun.experimentId },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });
        if (latestRun?.id === runId) {
          await prisma.experiment.update({
            where: { id: finishedRun.experimentId },
            data: { status: finalStatus },
          });
        }
      }
      // remove cancellation flag after run finishes
      runCancellation.delete(runId);
      runExecutionEpoch.delete(runId);
    }
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
  // Executions that produced an answer. While the judge is still working this keeps moving,
  // so a judge-enabled run never looks frozen at 0 / total.
  const executionsCompleted = run.results.filter((result) => result.status === "completed").length;
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
    modelConfigA: providerSnapshot(run.modelConfigA),
    modelConfigB: providerSnapshot(run.modelConfigB),
    evaluatorConfig: providerSnapshot(run.evaluatorConfig),
    status: run.status,
    createdAt: run.createdAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    progress: { completed, total, executionsCompleted },
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
