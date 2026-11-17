import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { executeRun, findRun, requestStop, type TestCase } from "./evaluations.js";
import { attachReservationToRun, releasePlatformCredit, reservePlatformCredit, reservePlatformCreditForRun } from "../services/usage.js";
import { assertExperimentScenarioLimit } from "../services/limits.js";
import { authRequired } from "../auth.js";
import {
  aggregateVariant,
  compareCriteria,
  compareMetrics,
  compareScenarios,
  findRegressions,
  recommendExperiment,
  type MetricResult,
} from "../services/metrics.js";
import { type CreateExperimentRequest, type Experiment, type ExperimentDetail, type ExperimentStatus, type ModelSelection, type ModelSelectionSnapshot } from "@prompt-playground/shared";
import { providerSnapshot, resolveLegacyModel, resolveModelSelection, resolveModelSnapshot, unownedLegacySnapshot } from "../services/modelSelection.js";

const modelSelectionSchema = z.object({
  modelId: z.string().trim().min(1).max(200),
  provider: z.enum(["openai", "anthropic", "gemini", "deepseek", "openrouter"]),
  source: z.enum(["platform_free", "byok"]),
  connectionId: z.string().uuid().optional(),
});

const createExperimentSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(160),
  hypothesis: z.string().trim().max(2000).optional(),
  datasetId: z.string().uuid(),
  baselinePrompt: z.string().trim().min(1, "Baseline prompt is required").max(50_000),
  baselineModel: z.string().trim().min(1).max(200),
  candidatePrompt: z.string().trim().min(1, "Candidate prompt is required").max(50_000),
  candidateModel: z.string().trim().min(1).max(200),
  evaluatorModel: z.string().trim().min(1).max(200).optional(),
  evaluatorThreshold: z.number().int().min(0).max(100).optional(),
  evaluatorPrompt: z.string().trim().max(50_000).optional(),
  baselineSelection: modelSelectionSchema.optional(),
  candidateSelection: modelSelectionSchema.optional(),
  evaluatorSelection: modelSelectionSchema.optional(),
});

const decisionSchema = z.object({
  decision: z.enum(["promote_candidate", "keep_baseline", "continue_experiment"]),
  decisionNote: z.string().trim().max(5000).optional(),
});

const iterationSchema = z.object({
  candidatePrompt: z.string().trim().min(1, "Candidate prompt is required").max(50_000),
  candidateModel: z.string().trim().min(1).max(200),
  evaluatorModel: z.string().trim().min(1).max(200).optional(),
  candidateSelection: modelSelectionSchema.optional(),
  evaluatorSelection: modelSelectionSchema.optional(),
  evaluatorThreshold: z.number().int().min(0).max(100).optional(),
  evaluatorPrompt: z.string().trim().max(50_000).optional(),
});

// Optional model overrides for retrying a run (e.g. switch to a working LLM when rate-limited).
const retrySchema = z.object({
  baselineModel: z.string().trim().min(1).max(200).optional(),
  candidateModel: z.string().trim().min(1).max(200).optional(),
  evaluatorModel: z.string().trim().min(1).max(200).optional(),
  baselineSelection: modelSelectionSchema.optional(),
  candidateSelection: modelSelectionSchema.optional(),
  evaluatorSelection: modelSelectionSchema.optional(),
});

const regressionCaseSchema = z.object({
  testCaseId: z.string().uuid(),
  variant: z.enum(["A", "B"]).default("B"),
  datasetName: z.string().trim().min(1).max(160).optional(),
});

export const experimentsRouter = Router();

// POST /api/experiments — create a draft experiment with frozen config snapshots
experimentsRouter.post("/experiments", authRequired, async (req, res, next) => {
  try {
    const payload = createExperimentSchema.parse(req.body);
    const dataset = await prisma.dataset.findUnique({ where: { id: payload.datasetId }, select: { id: true, name: true, isSample: true, userId: true } });
    if (!dataset) return res.status(404).json({ error: "Dataset not found" });
    if (!dataset.isSample && dataset.userId !== req.user!.id) return res.status(404).json({ error: "Dataset not found" });
    await assertExperimentScenarioLimit(req.user!.id, dataset.id);
    const baseline = payload.baselineSelection
      ? await resolveModelSelection(req.user!.id, payload.baselineSelection)
      : await resolveLegacyModel(req.user!.id, payload.baselineModel);
    const candidate = payload.candidateSelection
      ? await resolveModelSelection(req.user!.id, payload.candidateSelection)
      : await resolveLegacyModel(req.user!.id, payload.candidateModel);
    const evaluator = payload.evaluatorModel
      ? payload.evaluatorSelection
        ? await resolveModelSelection(req.user!.id, payload.evaluatorSelection)
        : await resolveLegacyModel(req.user!.id, payload.evaluatorModel)
      : null;
    if (payload.baselineSelection && baseline.snapshot.modelId !== payload.baselineModel) throw new Error("Baseline model selection does not match its model ID.");
    if (payload.candidateSelection && candidate.snapshot.modelId !== payload.candidateModel) throw new Error("Candidate model selection does not match its model ID.");
    const experiment = await prisma.experiment.create({
      data: {
        name: payload.name,
        hypothesis: payload.hypothesis ?? null,
        datasetId: dataset.id,
        baselinePrompt: payload.baselinePrompt,
        baselineModel: baseline.snapshot.modelId,
        candidatePrompt: payload.candidatePrompt,
        candidateModel: candidate.snapshot.modelId,
        evaluatorModel: evaluator?.snapshot.modelId ?? null,
        evaluatorThreshold: payload.evaluatorThreshold ?? null,
        evaluatorPrompt: payload.evaluatorPrompt ?? null,
        modelConfigA: baseline.snapshot,
        modelConfigB: candidate.snapshot,
        evaluatorConfig: evaluator?.snapshot ?? undefined,
        userId: req.user!.id,
        status: "draft",
      },
    });
    res.status(201).json(toExperiment(experiment, dataset.name));
  } catch (err) {
    next(err);
  }
});

// GET /api/experiments — list root experiments with the latest iteration's result deltas and decision
experimentsRouter.get("/experiments", authRequired, async (req, res, next) => {
  try {
    const userId = req.user?.id ?? null;
    const experiments = await prisma.experiment.findMany({
      orderBy: { createdAt: "desc" },
      where: { userId: userId ?? "00000000-0000-0000-0000-000000000000" },
      include: {
        dataset: { select: { name: true, _count: { select: { testCases: true } } } },
        runs: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { results: { include: { judgement: { include: { criteriaResults: true } } } } },
        },
      },
    });

    // Group every experiment row into its root group (parentId ?? id).
    const byRoot = new Map<string, Array<(typeof experiments)[number]>>();
    for (const experiment of experiments) {
      const rootId = experiment.parentId ?? experiment.id;
      if (!byRoot.has(rootId)) byRoot.set(rootId, []);
      byRoot.get(rootId)!.push(experiment);
    }

    const list: Experiment[] = [];
    for (const [rootId, members] of byRoot) {
      const root = members.find((member) => member.id === rootId) ?? members[0];
      const latest = [...members].sort((a, b) => a.iteration - b.iteration).slice(-1)[0];
      const latestRun = latest.runs[0] ?? null;
      const summary = latestRun ? summarizeRunMetrics(latestRun.results) : null;
      list.push({
        ...toExperiment(latest, root?.dataset.name ?? latest.dataset.name),
        rootId,
        iterationCount: members.length,
        scoreDelta: summary?.comparison.scoreDelta ?? null,
        passRateDelta: summary?.comparison.passRateDelta ?? null,
        latestResult: latestRun
          ? {
              status: latestRun.status,
              completedAt: latestRun.completedAt?.toISOString() ?? null,
              avgScore: summary?.candidate.avgScore ?? null,
              passRate: summary?.candidate.passRate ?? null,
            }
          : null,
      });
    }

    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json(list);
  } catch (err) {
    next(err);
  }
});

// GET /api/experiments/:id — full detail with comparison, criteria, scenarios, regressions
experimentsRouter.get("/experiments/:id", authRequired, async (req, res, next) => {
  try {
    const owner = await prisma.experiment.findUnique({ where: { id: req.params.id }, select: { userId: true } });
    if (!owner) return res.status(404).json({ error: "Experiment not found" });
    if (owner.userId !== (req.user?.id ?? null)) return res.status(404).json({ error: "Experiment not found" });
    const detail = await buildExperimentDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: "Experiment not found" });
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/experiments/:id/decision — record the product decision
experimentsRouter.patch("/experiments/:id/decision", authRequired, async (req, res, next) => {
  try {
    const payload = decisionSchema.parse(req.body);
    const existing = await prisma.experiment.findUnique({ where: { id: req.params.id }, select: { userId: true } });
    if (!existing) return res.status(404).json({ error: "Experiment not found" });
    if (existing.userId !== req.user!.id) return res.status(404).json({ error: "Experiment not found" });
    const experiment = await prisma.experiment.update({
      where: { id: req.params.id },
      data: {
        decision: payload.decision,
        decisionNote: payload.decisionNote ?? null,
        decidedAt: new Date(),
      },
    });
    res.json(toExperiment(experiment));
  } catch (err) {
    next(err);
  }
});

// POST /api/experiments/:id/run — freeze config and run baseline (A) vs candidate (B) on the dataset
experimentsRouter.post("/experiments/:id/run", authRequired, async (req, res, next) => {
  let reservationId: string | undefined;
  try {
    const existing = await prisma.experiment.findUnique({
      where: { id: req.params.id },
      select: { userId: true, datasetId: true, baselineModel: true, candidateModel: true, evaluatorModel: true, modelConfigA: true, modelConfigB: true, evaluatorConfig: true },
    });
    if (!existing) return res.status(404).json({ error: "Experiment not found" });
    if (existing.userId !== req.user!.id) return res.status(404).json({ error: "Experiment not found" });
    // The dataset can grow after the draft is created, so the scenario limit is re-checked here.
    await assertExperimentScenarioLimit(req.user!.id, existing.datasetId);
    const resolved = await resolveExperimentProviders(req.user!.id, existing);
    const usesPlatform = [resolved.a.snapshot, resolved.b.snapshot, ...(resolved.evaluator ? [resolved.evaluator.snapshot] : [])].some((snapshot) => snapshot.source === "platform_free");
    reservationId = usesPlatform ? await reservePlatformCredit(req.user!.id, "experiment") : undefined;
    const result = await startExperimentRun(req.params.id, {
      providerA: resolved.a.provider,
      providerB: resolved.b.provider,
      evaluatorProvider: resolved.evaluator?.provider,
      modelConfigA: resolved.a.snapshot,
      modelConfigB: resolved.b.snapshot,
      evaluatorConfig: resolved.evaluator?.snapshot ?? null,
      reservationId,
    });
    if (result === null) {
      if (reservationId) await releasePlatformCredit(reservationId);
      return res.status(404).json({ error: "Experiment not found" });
    }
    if (result === "conflict") {
      if (reservationId) await releasePlatformCredit(reservationId);
      return res.status(409).json({ error: "Experiment is already running" });
    }
    res.status(201).json(result);
  } catch (err) {
    if (reservationId) await releasePlatformCredit(reservationId).catch(() => undefined);
    next(err);
  }
});

// POST /api/experiments/:id/stop — stop the experiment's currently running evaluation.
// Scenarios already evaluated are kept; the rest stay pending and can be resumed.
experimentsRouter.post("/experiments/:id/stop", authRequired, async (req, res, next) => {
  try {
    const existing = await prisma.experiment.findUnique({ where: { id: req.params.id }, select: { userId: true } });
    if (!existing) return res.status(404).json({ error: "Experiment not found" });
    if (existing.userId !== req.user!.id) return res.status(404).json({ error: "Experiment not found" });

    const latestRun = await prisma.evaluationRun.findFirst({
      where: { experimentId: req.params.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    });
    if (!latestRun || latestRun.status !== "running") return res.json({ ok: true, stopped: false });

    const stopped = await requestStop(latestRun.id);
    return res.json({ ok: true, stopped });
  } catch (err) {
    next(err);
  }
});

// POST /api/experiments/:id/resume — continue the current run from where it stopped.
// Only scenarios that are missing or failed are re-evaluated; successful results are kept.
experimentsRouter.post("/experiments/:id/resume", authRequired, async (req, res, next) => {
  try {
    const overrides = retrySchema.parse(req.body ?? {});
    const existing = await prisma.experiment.findUnique({
      where: { id: req.params.id },
      select: { userId: true, baselineModel: true, candidateModel: true, evaluatorModel: true, modelConfigA: true, modelConfigB: true, evaluatorConfig: true },
    });
    if (!existing) return res.status(404).json({ error: "Experiment not found" });
    if (existing.userId !== req.user!.id) return res.status(404).json({ error: "Experiment not found" });
    const resolved = await resolveExperimentProviders(req.user!.id, existing);
    const a = overrides.baselineSelection
      ? await resolveModelSelection(req.user!.id, overrides.baselineSelection)
      : overrides.baselineModel ? await resolveModelSelection(req.user!.id, { ...resolved.a.snapshot, modelId: overrides.baselineModel }) : resolved.a;
    const b = overrides.candidateSelection
      ? await resolveModelSelection(req.user!.id, overrides.candidateSelection)
      : overrides.candidateModel ? await resolveModelSelection(req.user!.id, { ...resolved.b.snapshot, modelId: overrides.candidateModel }) : resolved.b;
    const evaluator = overrides.evaluatorSelection
      ? await resolveModelSelection(req.user!.id, overrides.evaluatorSelection)
      : overrides.evaluatorModel && resolved.evaluator
      ? await resolveModelSelection(req.user!.id, { ...resolved.evaluator.snapshot, modelId: overrides.evaluatorModel })
      : resolved.evaluator;
    const result = await retryExperimentFailures(req.params.id, {
      providerA: a.provider,
      providerB: b.provider,
      evaluatorProvider: evaluator?.provider,
      modelConfigA: a.snapshot,
      modelConfigB: b.snapshot,
      evaluatorConfig: evaluator?.snapshot ?? null,
      userId: req.user!.id,
      models: {
        baselineModel: a.snapshot.modelId,
        candidateModel: b.snapshot.modelId,
        ...(evaluator ? { evaluatorModel: evaluator.snapshot.modelId } : {}),
      },
    });
    if (result === null) return res.status(404).json({ error: "Experiment not found" });
    if ("conflict" in result) return res.status(409).json({ error: "Experiment is already running" });
    return res.json({ resumed: result.retried, remaining: result.remaining });
  } catch (err) {
    next(err);
  }
});

// POST /api/experiments/:id/retry — re-evaluate ONLY the failed scenarios (execution/evaluator failures).
// Optional model overrides let you switch to a working LLM if the current one is rate-limited.
experimentsRouter.post("/experiments/:id/retry", authRequired, async (req, res, next) => {
  try {
    const overrides = retrySchema.parse(req.body ?? {});
    const existing = await prisma.experiment.findUnique({
      where: { id: req.params.id },
      select: { userId: true, baselineModel: true, candidateModel: true, evaluatorModel: true, modelConfigA: true, modelConfigB: true, evaluatorConfig: true },
    });
    if (!existing) return res.status(404).json({ error: "Experiment not found" });
    if (existing.userId !== req.user!.id) return res.status(404).json({ error: "Experiment not found" });
    const resolved = await resolveExperimentProviders(req.user!.id, existing);
    const a = overrides.baselineSelection
      ? await resolveModelSelection(req.user!.id, overrides.baselineSelection)
      : overrides.baselineModel ? await resolveModelSelection(req.user!.id, { ...resolved.a.snapshot, modelId: overrides.baselineModel }) : resolved.a;
    const b = overrides.candidateSelection
      ? await resolveModelSelection(req.user!.id, overrides.candidateSelection)
      : overrides.candidateModel ? await resolveModelSelection(req.user!.id, { ...resolved.b.snapshot, modelId: overrides.candidateModel }) : resolved.b;
    const evaluator = overrides.evaluatorSelection
      ? await resolveModelSelection(req.user!.id, overrides.evaluatorSelection)
      : overrides.evaluatorModel && resolved.evaluator
      ? await resolveModelSelection(req.user!.id, { ...resolved.evaluator.snapshot, modelId: overrides.evaluatorModel })
      : resolved.evaluator;
    const result = await retryExperimentFailures(req.params.id, {
      providerA: a.provider,
      providerB: b.provider,
      evaluatorProvider: evaluator?.provider,
      modelConfigA: a.snapshot,
      modelConfigB: b.snapshot,
      evaluatorConfig: evaluator?.snapshot ?? null,
      userId: req.user!.id,
      models: {
        baselineModel: a.snapshot.modelId,
        candidateModel: b.snapshot.modelId,
        ...(evaluator ? { evaluatorModel: evaluator.snapshot.modelId } : {}),
      },
    });
    if (result === null) return res.status(404).json({ error: "Experiment not found" });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/experiments/:id/iterations — create the next iteration (baseline = previous candidate)
experimentsRouter.post("/experiments/:id/iterations", authRequired, async (req, res, next) => {
  try {
    const payload = iterationSchema.parse(req.body);
    const existing = await prisma.experiment.findUnique({ where: { id: req.params.id }, select: { userId: true } });
    if (!existing) return res.status(404).json({ error: "Experiment not found" });
    if (existing.userId !== req.user!.id) return res.status(404).json({ error: "Experiment not found" });
    const next = await createNextIteration(req.params.id, payload, req.user!.id);
    if (next === null) return res.status(404).json({ error: "Experiment not found" });
    res.status(201).json(next);
  } catch (err) {
    next(err);
  }
});

experimentsRouter.post("/experiments/:id/regression-cases", authRequired, async (req, res, next) => {
  try {
    const payload = regressionCaseSchema.parse(req.body);
    const experiment = await prisma.experiment.findUnique({ where: { id: req.params.id } });
    if (!experiment || experiment.userId !== req.user!.id) return res.status(404).json({ error: "Experiment not found" });
    const run = await prisma.evaluationRun.findFirst({ where: { experimentId: experiment.id }, orderBy: { createdAt: "desc" } });
    if (!run) return res.status(404).json({ error: "Experiment has no evaluation results" });
    const result = await prisma.evaluationResult.findFirst({
      where: { runId: run.id, testCaseId: payload.testCaseId, variant: payload.variant },
    });
    if (!result || !result.inputSnapshot) return res.status(404).json({ error: "Scenario evidence not found" });
    const criteria = Array.isArray(result.criteriaSnapshot) ? result.criteriaSnapshot.map(String) : [];
    const requiresReview = !result.expectedOutputSnapshot?.trim() || criteria.length === 0;
    const name = payload.datasetName ?? `${experiment.name} regression cases`.slice(0, 160);
    const dataset = await prisma.dataset.create({
      data: {
        name,
        description: `Regression case copied from experiment ${experiment.name}. The original dataset and evaluation history are unchanged.`,
        useCase: "Regression analysis",
        userId: req.user!.id,
        testCases: {
          create: {
            input: result.inputSnapshot,
            expectedOutput: result.expectedOutputSnapshot,
            evaluationCriteria: criteria.length ? criteria : undefined,
            notes: `Copied from ${payload.variant === "A" ? "baseline" : "candidate"} output in experiment ${experiment.name}.${requiresReview ? " Review the expected answer and rubric before relying on this case." : ""}`,
            position: 0,
            requiresReview,
            sourceResultId: result.id,
          },
        },
      },
      include: { testCases: true },
    });
    return res.status(201).json({ datasetId: dataset.id, datasetName: dataset.name, testCaseId: dataset.testCases[0].id, requiresReview });
  } catch (err) {
    next(err);
  }
});

/** Create the next iteration: baseline = previous candidate, same dataset, evaluator inherited unless overridden. */
export async function createNextIteration(
  experimentId: string,
  payload: {
    candidatePrompt: string;
    candidateModel: string;
    candidateSelection?: ModelSelection;
    evaluatorModel?: string;
    evaluatorSelection?: ModelSelection;
    evaluatorThreshold?: number;
    evaluatorPrompt?: string;
  },
  userId?: string,
) {
  const current = await prisma.experiment.findUnique({ where: { id: experimentId } });
  if (!current) return null;

  const ownerId = userId ?? current.userId ?? null;
  const snapshotFor = async (modelId: string) => (ownerId
    ? (await resolveLegacyModel(ownerId, modelId)).snapshot
    : unownedLegacySnapshot(modelId));
  const baselineSnapshot = providerSnapshot(current.modelConfigB) ?? (await snapshotFor(current.candidateModel));
  const candidate = payload.candidateSelection
    ? { snapshot: (await resolveModelSelection(ownerId ?? "", payload.candidateSelection)).snapshot }
    : { snapshot: await snapshotFor(payload.candidateModel) };
  const currentEvaluatorSnapshot = providerSnapshot(current.evaluatorConfig);
  const evaluator = payload.evaluatorModel
    ? payload.evaluatorSelection
      ? { snapshot: (await resolveModelSelection(ownerId ?? "", payload.evaluatorSelection)).snapshot }
      : { snapshot: await snapshotFor(payload.evaluatorModel) }
    : current.evaluatorModel
      ? { snapshot: currentEvaluatorSnapshot ?? (await snapshotFor(current.evaluatorModel)) }
      : null;

  const rootId = current.parentId ?? current.id;
  const members = await prisma.experiment.findMany({ where: { OR: [{ id: rootId }, { parentId: rootId }] }, select: { iteration: true } });
  const nextIteration = members.reduce((max, member) => Math.max(max, member.iteration), 0) + 1;

  const next = await prisma.experiment.create({
    data: {
      name: current.name,
      hypothesis: current.hypothesis,
      datasetId: current.datasetId,
      parentId: rootId,
      iteration: nextIteration,
      userId: userId ?? current.userId,
      // Previous candidate becomes the new baseline (immutable snapshot).
      baselinePrompt: current.candidatePrompt,
      baselineModel: current.candidateModel,
      candidatePrompt: payload.candidatePrompt,
      candidateModel: candidate.snapshot.modelId,
      evaluatorModel: evaluator?.snapshot.modelId ?? null,
      evaluatorThreshold: payload.evaluatorThreshold ?? current.evaluatorThreshold,
      evaluatorPrompt: payload.evaluatorPrompt ?? current.evaluatorPrompt,
      modelConfigA: baselineSnapshot,
      modelConfigB: candidate.snapshot,
      evaluatorConfig: evaluator?.snapshot ?? undefined,
      status: "draft",
    },
  });

  return toExperiment(next);
}

/**
 * Re-run only the scenarios that failed execution or evaluation, preserving successful results.
 * Returns the number of retried jobs and how many are still failing (best-effort).
 */
export async function retryExperimentFailures(
  experimentId: string,
  opts?: {
    provider?: import("../provider.js").ModelProvider;
    providerA?: import("../provider.js").ModelProvider;
    providerB?: import("../provider.js").ModelProvider;
    evaluatorProvider?: import("../provider.js").ModelProvider;
    modelConfigA?: ModelSelectionSnapshot | null;
    modelConfigB?: ModelSelectionSnapshot | null;
    evaluatorConfig?: ModelSelectionSnapshot | null;
    userId?: string;
    awaitRun?: boolean;
    models?: { baselineModel?: string; candidateModel?: string; evaluatorModel?: string };
  },
) {
  const experiment = await prisma.experiment.findUnique({
    where: { id: experimentId },
    include: { dataset: { include: { testCases: { orderBy: { position: "asc" } } } } },
  });
  if (!experiment) return null;

  const latestRun = await prisma.evaluationRun.findFirst({
    where: { experimentId },
    orderBy: { createdAt: "desc" },
    include: { results: { include: { judgement: true } } },
  });
  if (!latestRun) return { retried: 0, remaining: 0 };
  if (latestRun.status === "running") return { retried: 0, remaining: 0, conflict: "running" };

  const testCases: TestCase[] = experiment.dataset.testCases.map((tc) => ({
    id: tc.id,
    input: tc.input,
    expectedOutput: tc.expectedOutput,
    evaluationCriteria: Array.isArray(tc.evaluationCriteria) ? tc.evaluationCriteria.map((item) => String(item)) : null,
    notes: tc.notes,
    position: tc.position,
  }));

  // Use model overrides when provided (e.g. a working LLM), else the experiment's frozen config.
  const baselineModel = opts?.models?.baselineModel ?? experiment.baselineModel;
  const candidateModel = opts?.models?.candidateModel ?? experiment.candidateModel;
  const evaluatorModel = opts?.models?.evaluatorModel ?? (experiment.evaluatorModel ?? undefined);
  const judgeExpected = Boolean(evaluatorModel ?? latestRun.evaluatorModel);
  const modelConfigA = opts?.modelConfigA ?? providerSnapshot(latestRun.modelConfigA);
  const modelConfigB = opts?.modelConfigB ?? providerSnapshot(latestRun.modelConfigB);
  const evaluatorConfig = opts?.evaluatorConfig ?? providerSnapshot(latestRun.evaluatorConfig);

  // Resumable = missing result, execution failure, evaluator failure, or a result that was never
  // judged (the jobs still in flight when a run was stopped). A successfully judged low score is a
  // quality failure, not a gap — it is never re-run.
  const retryable: Array<{ testCase: TestCase; variant: "A" | "B" }> = [];
  for (const testCase of testCases) {
    for (const variant of ["A", "B"] as const) {
      const result = latestRun.results.find((r) => r.testCaseId === testCase.id && r.variant === variant);
      if (!result) { retryable.push({ testCase, variant }); continue; }
      const judgeFailed = result.judgement?.status === "failed";
      const judgeMissing = judgeExpected && !result.judgement;
      if (result.status === "failed" || judgeFailed || judgeMissing) retryable.push({ testCase, variant });
    }
  }

  if (retryable.length === 0) return { retried: 0, remaining: 0 };

  const usesPlatform = [modelConfigA, modelConfigB, evaluatorConfig].some((snapshot) => snapshot?.source === "platform_free");
  const reservationId = usesPlatform && opts?.userId
    ? await reservePlatformCreditForRun(opts.userId, latestRun.id, "resume")
    : undefined;

  await prisma.evaluationRun.update({
    where: { id: latestRun.id },
    data: {
      status: "running",
      model: baselineModel,
      modelA: baselineModel,
      modelB: candidateModel,
      ...(modelConfigA ? { modelConfigA } : {}),
      ...(modelConfigB ? { modelConfigB } : {}),
      ...(evaluatorConfig ? { evaluatorConfig } : {}),
    },
  });
  await prisma.experiment.update({ where: { id: experiment.id }, data: { status: "running" } });

  const runPromise = executeRun({
    runId: latestRun.id,
    model: baselineModel,
    modelA: baselineModel,
    modelB: candidateModel,
    testCases,
    jobs: retryable,
    upsert: true,
    promptA: experiment.baselinePrompt,
    promptB: experiment.candidatePrompt,
    evaluatorModel,
    evaluatorThreshold: experiment.evaluatorThreshold,
    evaluatorPrompt: experiment.evaluatorPrompt,
    provider: opts?.provider,
    providerA: opts?.providerA,
    providerB: opts?.providerB,
    evaluatorProvider: opts?.evaluatorProvider,
    modelConfigA,
    modelConfigB,
    evaluatorConfig,
    reservationId,
  });

  if (opts?.awaitRun) await runPromise;

  const updatedRun = await prisma.evaluationRun.findUnique({
    where: { id: latestRun.id },
    include: { results: { include: { judgement: true } } },
  });
  let remaining = 0;
  for (const testCase of testCases) {
    for (const variant of ["A", "B"] as const) {
      const r = updatedRun?.results.find((x) => x.testCaseId === testCase.id && x.variant === variant);
      if (!r || r.status === "failed" || r.judgement?.status === "failed") remaining++;
      else if (judgeExpected && !r.judgement) remaining++;
    }
  }

  return { retried: retryable.length, remaining };
}

async function resolveExperimentProviders(userId: string, experiment: {
  baselineModel: string;
  candidateModel: string;
  evaluatorModel: string | null;
  modelConfigA: unknown;
  modelConfigB: unknown;
  evaluatorConfig: unknown;
}) {
  const configA = providerSnapshot(experiment.modelConfigA);
  const configB = providerSnapshot(experiment.modelConfigB);
  const evaluatorConfig = providerSnapshot(experiment.evaluatorConfig);
  const a = configA
    ? { provider: await resolveModelSnapshot(userId, configA), snapshot: configA }
    : await resolveLegacyModel(userId, experiment.baselineModel);
  const b = configB
    ? { provider: await resolveModelSnapshot(userId, configB), snapshot: configB }
    : await resolveLegacyModel(userId, experiment.candidateModel);
  const evaluator = experiment.evaluatorModel
    ? evaluatorConfig
      ? { provider: await resolveModelSnapshot(userId, evaluatorConfig), snapshot: evaluatorConfig }
      : await resolveLegacyModel(userId, experiment.evaluatorModel)
    : null;
  return { a, b, evaluator };
}

/**
 * Start (or restart) an experiment run: baseline = variant A, candidate = variant B.
 * Reuses the Phase-3 evaluation engine via executeRun. Optionally awaits the run for tests.
 */
export async function startExperimentRun(
  experimentId: string,
  opts?: {
    provider?: import("../provider.js").ModelProvider;
    providerA?: import("../provider.js").ModelProvider;
    providerB?: import("../provider.js").ModelProvider;
    evaluatorProvider?: import("../provider.js").ModelProvider;
    modelConfigA?: ModelSelectionSnapshot | null;
    modelConfigB?: ModelSelectionSnapshot | null;
    evaluatorConfig?: ModelSelectionSnapshot | null;
    awaitRun?: boolean;
    reservationId?: string;
  },
) {
  const experiment = await prisma.experiment.findUnique({
    where: { id: experimentId },
    include: { dataset: { include: { testCases: { orderBy: { position: "asc" } } } } },
  });
  if (!experiment) return null;
  if (experiment.status === "running") return "conflict";

  const testCases: TestCase[] = experiment.dataset.testCases.map((tc) => ({
    id: tc.id,
    input: tc.input,
    expectedOutput: tc.expectedOutput,
    evaluationCriteria: Array.isArray(tc.evaluationCriteria) ? tc.evaluationCriteria.map((item) => String(item)) : null,
    notes: tc.notes,
    position: tc.position,
  }));

  const run = await prisma.evaluationRun.create({
    data: {
      datasetId: experiment.datasetId,
      experimentId: experiment.id,
      model: experiment.baselineModel,
      modelA: experiment.baselineModel,
      modelB: experiment.candidateModel,
      promptA: experiment.baselinePrompt,
      promptB: experiment.candidatePrompt,
      evaluatorModel: experiment.evaluatorModel,
      evaluatorThreshold: experiment.evaluatorThreshold,
      evaluatorPrompt: experiment.evaluatorPrompt,
      modelConfigA: opts?.modelConfigA ?? experiment.modelConfigA ?? undefined,
      modelConfigB: opts?.modelConfigB ?? experiment.modelConfigB ?? undefined,
      evaluatorConfig: opts?.evaluatorConfig ?? experiment.evaluatorConfig ?? undefined,
      userId: experiment.userId,
      status: "running",
    },
  });
  if (opts?.reservationId) await attachReservationToRun(opts.reservationId, run.id);

  await prisma.experiment.update({ where: { id: experiment.id }, data: { status: "running" } });

  const runPromise = executeRun({
    runId: run.id,
    model: experiment.baselineModel,
    modelA: experiment.baselineModel,
    modelB: experiment.candidateModel,
    testCases,
    promptA: experiment.baselinePrompt,
    promptB: experiment.candidatePrompt,
    evaluatorModel: experiment.evaluatorModel ?? undefined,
    evaluatorThreshold: experiment.evaluatorThreshold,
    evaluatorPrompt: experiment.evaluatorPrompt,
    provider: opts?.provider,
    providerA: opts?.providerA,
    providerB: opts?.providerB,
    evaluatorProvider: opts?.evaluatorProvider,
    modelConfigA: opts?.modelConfigA ?? providerSnapshot(experiment.modelConfigA),
    modelConfigB: opts?.modelConfigB ?? providerSnapshot(experiment.modelConfigB),
    evaluatorConfig: opts?.evaluatorConfig ?? providerSnapshot(experiment.evaluatorConfig),
    reservationId: opts?.reservationId,
  });

  if (opts?.awaitRun) await runPromise;
  return await findRun(run.id);
}

// ---------- helpers ----------

function toExperiment(row: {
  id: string;
  name: string;
  hypothesis: string | null;
  datasetId: string;
  baselinePrompt: string;
  baselineModel: string;
  candidatePrompt: string;
  candidateModel: string;
  evaluatorModel: string | null;
  evaluatorThreshold: number | null;
  evaluatorPrompt: string | null;
  modelConfigA: unknown;
  modelConfigB: unknown;
  evaluatorConfig: unknown;
  status: string;
  decision: string | null;
  decisionNote: string | null;
  decidedAt: Date | null;
  iteration: number;
  parentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}, datasetName?: string): Experiment {
  return {
    id: row.id,
    name: row.name,
    hypothesis: row.hypothesis,
    datasetId: row.datasetId,
    ...(datasetName !== undefined ? { datasetName } : {}),
    baselinePrompt: row.baselinePrompt,
    baselineModel: row.baselineModel,
    candidatePrompt: row.candidatePrompt,
    candidateModel: row.candidateModel,
    evaluatorModel: row.evaluatorModel,
    evaluatorThreshold: row.evaluatorThreshold,
    evaluatorPrompt: row.evaluatorPrompt,
    modelConfigA: providerSnapshot(row.modelConfigA),
    modelConfigB: providerSnapshot(row.modelConfigB),
    evaluatorConfig: providerSnapshot(row.evaluatorConfig),
    status: row.status as ExperimentStatus,
    decision: row.decision as Experiment["decision"],
    decisionNote: row.decisionNote,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    iteration: row.iteration,
    parentId: row.parentId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toMetricResults(rows: Array<{
  variant: string;
  testCaseId: string;
  output: string | null;
  latencyMs: number | null;
  totalTokens: number | null;
  estimatedCostUsd: unknown;
  status: string;
  errorMessage: string | null;
  modelMetadata: unknown;
  judgement: {
    overallScore: number;
    pass: boolean;
    status: string;
    summary: string | null;
    evaluatorModel: string | null;
    threshold: number | null;
    errorMessage: string | null;
    criteriaResults: Array<{ criterion: string; score: number; pass: boolean; reason: string | null }>;
  } | null;
}>): MetricResult[] {
  return rows.map((row) => ({
    variant: row.variant as "A" | "B",
    testCaseId: row.testCaseId,
    output: row.output,
    latencyMs: row.latencyMs,
    totalTokens: row.totalTokens,
    estimatedCostUsd: typeof row.estimatedCostUsd === "number" ? row.estimatedCostUsd : row.estimatedCostUsd ? Number(row.estimatedCostUsd) : null,
    status: row.status as "completed" | "failed",
    errorMessage: row.errorMessage,
    model: typeof (row.modelMetadata as { model?: unknown } | null)?.model === "string" ? (row.modelMetadata as { model: string }).model : null,
    judgement: row.judgement
      ? {
          overallScore: row.judgement.overallScore,
          pass: row.judgement.pass,
          status: row.judgement.status as "completed" | "failed",
          summary: row.judgement.summary,
          evaluatorModel: row.judgement.evaluatorModel,
          threshold: row.judgement.threshold,
          errorMessage: row.judgement.errorMessage,
          criteriaResults: row.judgement.criteriaResults.map((c) => ({
            criterion: c.criterion,
            score: c.score,
            pass: c.pass,
            reason: c.reason,
          })),
        }
      : null,
  }));
}

function emptyMetrics() {
  return {
    avgScore: null,
    passRate: null,
    avgLatencyMs: null,
    totalTokens: null,
    avgTokens: null,
    totalCostUsd: null,
    scoredCount: 0,
    completedCount: 0,
  };
}

function summarizeRunMetrics(rows: Parameters<typeof toMetricResults>[0]) {
  const results = toMetricResults(rows);
  const baseline = aggregateVariant(results.filter((r) => r.variant === "A"));
  const candidate = aggregateVariant(results.filter((r) => r.variant === "B"));
  return { baseline, candidate, comparison: compareMetrics(baseline, candidate) };
}

/**
 * Build the scenario inputs for comparison from the run's test-case snapshots so that
 * historical results keep showing the original input/golden even if the dataset changes later.
 */
function buildScenarioTestCases(
  results: Array<{ testCaseId: string; inputSnapshot: string | null; expectedOutputSnapshot: string | null; criteriaSnapshot: unknown }>,
  liveTestCases: Array<{ id: string; input: string; expectedOutput: string | null; evaluationCriteria: unknown }>,
) {
  const liveById = new Map(liveTestCases.map((tc) => [tc.id, tc]));
  const ids = [...new Set(results.map((r) => r.testCaseId))];
  if (ids.length === 0) {
    return liveTestCases.map((tc) => ({ id: tc.id, input: tc.input, expectedOutput: tc.expectedOutput, criteria: Array.isArray(tc.evaluationCriteria) ? tc.evaluationCriteria.map(String) : [] }));
  }
  return ids.map((id) => {
    const result = results.find((r) => r.testCaseId === id);
    const live = liveById.get(id);
    return {
      id,
      input: result?.inputSnapshot ?? live?.input ?? "",
      expectedOutput: result?.expectedOutputSnapshot ?? live?.expectedOutput ?? null,
      criteria: Array.isArray(result?.criteriaSnapshot)
        ? result.criteriaSnapshot.map(String)
        : Array.isArray(live?.evaluationCriteria) ? live.evaluationCriteria.map(String) : [],
    };
  });
}

function computeCompletion(
  results: Array<{ testCaseId: string; variant: string; status: string; judgement: { status: string } | null }>,
  testCaseIds: string[],
  judgeExpected = false,
) {
  const baseline = { completed: 0, total: testCaseIds.length };
  const candidate = { completed: 0, total: testCaseIds.length };
  let retryable = 0;
  for (const testCaseId of testCaseIds) {
    for (const variant of ["A", "B"] as const) {
      const r = results.find((x) => x.testCaseId === testCaseId && x.variant === variant);
      const bucket = variant === "A" ? baseline : candidate;
      if (!r) { retryable += 1; continue; }
      const judgeFailed = r.judgement?.status === "failed";
      // When a judge is configured, a result without a judgement is not finished work: it must
      // still be scored (this happens to jobs that were in flight when a run was stopped).
      const judgeMissing = judgeExpected && !r.judgement;
      if (r.status === "completed" && !judgeFailed && !judgeMissing) bucket.completed += 1;
      else retryable += 1;
    }
  }
  return { baseline, candidate, retryable };
}

export async function buildExperimentDetail(id: string): Promise<ExperimentDetail | null> {
  const experiment = await prisma.experiment.findUnique({
    where: { id },
    include: {
      dataset: {
        select: {
          name: true,
          _count: { select: { testCases: true } },
          testCases: { orderBy: { position: "asc" }, select: { id: true, input: true, expectedOutput: true, evaluationCriteria: true } },
        },
      },
      runs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { results: { include: { judgement: { include: { criteriaResults: true } } } } },
      },
    },
  });
  if (!experiment) return null;

  const latestRun = experiment.runs[0] ?? null;
  const total = experiment.dataset._count.testCases;

  // Iteration chain metadata
  const rootId = experiment.parentId ?? experiment.id;
  const group = await prisma.experiment.findMany({
    where: { OR: [{ id: rootId }, { parentId: rootId }] },
    orderBy: { iteration: "asc" },
    select: {
      id: true,
      iteration: true,
      status: true,
      decision: true,
      decidedAt: true,
      createdAt: true,
      baselineModel: true,
      candidateModel: true,
      evaluatorModel: true,
      evaluatorThreshold: true,
      datasetId: true,
    },
  });
  const iterations = group.map((member) => ({
    id: member.id,
    iteration: member.iteration,
    status: member.status,
    decision: member.decision,
    decidedAt: member.decidedAt?.toISOString() ?? null,
    createdAt: member.createdAt.toISOString(),
    baselineModel: member.baselineModel,
    candidateModel: member.candidateModel,
  }));
  const previous = group.find((member) => member.iteration === experiment.iteration - 1);
  let comparabilityWarning: string | null = null;
  if (previous) {
    const evaluatorChanged =
      (previous.evaluatorModel ?? null) !== (experiment.evaluatorModel ?? null) ||
      (previous.evaluatorThreshold ?? null) !== (experiment.evaluatorThreshold ?? null) ||
      (previous.datasetId !== experiment.datasetId);
    if (evaluatorChanged) {
      comparabilityWarning = "Evaluation configuration changed. Results from this iteration may not be directly comparable with the previous iteration.";
    }
  }

  const detail: ExperimentDetail = {
    ...toExperiment(experiment, experiment.dataset.name),
    datasetName: experiment.dataset.name,
    testCaseCount: total,
    rootId,
    iterations,
    comparabilityWarning,
    completion: latestRun
      ? computeCompletion(
          latestRun.results,
          experiment.dataset.testCases.map((tc) => tc.id),
          Boolean(latestRun.evaluatorModel ?? experiment.evaluatorModel),
        )
      : { baseline: { completed: 0, total }, candidate: { completed: 0, total }, retryable: 0 },
    metrics: {
      baseline: emptyMetrics(),
      candidate: emptyMetrics(),
      comparison: { scoreDelta: null, passRateDelta: null, latencyDeltaMs: null, tokenDelta: null, costDeltaUsd: null },
    },
    criteria: [],
    scenarios: [],
    regressions: [],
    recommendation: null,
    latestRun: latestRun ? await findRun(latestRun.id) : null,
  };

  if (latestRun) {
    const baselineResults = toMetricResults(latestRun.results).filter((r) => r.variant === "A");
    const candidateResults = toMetricResults(latestRun.results).filter((r) => r.variant === "B");
    const baseline = aggregateVariant(baselineResults);
    const candidate = aggregateVariant(candidateResults);
    const criteria = compareCriteria(baselineResults, candidateResults);
    const scenarios = compareScenarios(
      baselineResults,
      candidateResults,
      buildScenarioTestCases(latestRun.results, experiment.dataset.testCases),
    );
    const regressions = findRegressions(criteria, scenarios);
    detail.metrics = { baseline, candidate, comparison: compareMetrics(baseline, candidate) };
    detail.criteria = criteria;
    detail.scenarios = scenarios;
    detail.regressions = regressions;
    detail.recommendation = recommendExperiment({
      metrics: detail.metrics,
      criteria,
      scenarios,
      regressions,
      retryable: detail.completion.retryable,
    });
  }

  return detail;
}

export default experimentsRouter;
