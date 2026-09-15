import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { executeRun, findRun, type TestCase } from "./evaluations.js";
import { getUserProvider, resolveUserProvider } from "../services/userProvider.js";
import { attachReservationToRun, releasePlatformCredit } from "../services/usage.js";
import { authRequired, optionalAuth } from "../auth.js";
import {
  aggregateVariant,
  compareCriteria,
  compareMetrics,
  compareScenarios,
  findRegressions,
  recommendExperiment,
  type MetricResult,
} from "../services/metrics.js";
import { supportedModels, type CreateExperimentRequest, type Experiment, type ExperimentDetail, type ExperimentStatus, type ModelId } from "@prompt-playground/shared";

const modelIds = supportedModels.map(({ id }) => id) as [ModelId, ...ModelId[]];

const createExperimentSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(160),
  hypothesis: z.string().trim().max(2000).optional(),
  datasetId: z.string().uuid(),
  baselinePrompt: z.string().trim().min(1, "Baseline prompt is required").max(50_000),
  baselineModel: z.enum(modelIds),
  candidatePrompt: z.string().trim().min(1, "Candidate prompt is required").max(50_000),
  candidateModel: z.enum(modelIds),
  evaluatorModel: z.enum(modelIds).optional(),
  evaluatorThreshold: z.number().int().min(0).max(100).optional(),
  evaluatorPrompt: z.string().trim().max(50_000).optional(),
});

const decisionSchema = z.object({
  decision: z.enum(["promote_candidate", "keep_baseline", "continue_experiment"]),
  decisionNote: z.string().trim().max(5000).optional(),
});

const iterationSchema = z.object({
  candidatePrompt: z.string().trim().min(1, "Candidate prompt is required").max(50_000),
  candidateModel: z.enum(modelIds),
  evaluatorModel: z.enum(modelIds).optional(),
  evaluatorThreshold: z.number().int().min(0).max(100).optional(),
  evaluatorPrompt: z.string().trim().max(50_000).optional(),
});

// Optional model overrides for retrying a run (e.g. switch to a working LLM when rate-limited).
const retrySchema = z.object({
  baselineModel: z.enum(modelIds).optional(),
  candidateModel: z.enum(modelIds).optional(),
  evaluatorModel: z.enum(modelIds).optional(),
});

export const experimentsRouter = Router();

// POST /api/experiments — create a draft experiment with frozen config snapshots
experimentsRouter.post("/experiments", authRequired, async (req, res, next) => {
  try {
    const payload = createExperimentSchema.parse(req.body);
    const dataset = await prisma.dataset.findUnique({ where: { id: payload.datasetId }, select: { id: true, name: true, isSample: true, userId: true } });
    if (!dataset) return res.status(404).json({ error: "Dataset not found" });
    if (!dataset.isSample && dataset.userId !== req.user!.id) return res.status(404).json({ error: "Dataset not found" });
    const experiment = await prisma.experiment.create({
      data: {
        name: payload.name,
        hypothesis: payload.hypothesis ?? null,
        datasetId: dataset.id,
        baselinePrompt: payload.baselinePrompt,
        baselineModel: payload.baselineModel,
        candidatePrompt: payload.candidatePrompt,
        candidateModel: payload.candidateModel,
        evaluatorModel: payload.evaluatorModel ?? null,
        evaluatorThreshold: payload.evaluatorThreshold ?? null,
        evaluatorPrompt: payload.evaluatorPrompt ?? null,
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
experimentsRouter.get("/experiments", optionalAuth, async (req, res, next) => {
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
experimentsRouter.get("/experiments/:id", optionalAuth, async (req, res, next) => {
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
    const existing = await prisma.experiment.findUnique({ where: { id: req.params.id }, select: { userId: true } });
    if (!existing) return res.status(404).json({ error: "Experiment not found" });
    if (existing.userId !== req.user!.id) return res.status(404).json({ error: "Experiment not found" });
    const resolvedProvider = await resolveUserProvider(req.user!.id, "experiment");
    reservationId = resolvedProvider.reservationId;
    const result = await startExperimentRun(req.params.id, { provider: resolvedProvider.provider, reservationId: resolvedProvider.reservationId });
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

// POST /api/experiments/:id/retry — re-evaluate ONLY the failed scenarios (execution/evaluator failures).
// Optional model overrides let you switch to a working LLM if the current one is rate-limited.
experimentsRouter.post("/experiments/:id/retry", authRequired, async (req, res, next) => {
  try {
    const overrides = retrySchema.parse(req.body ?? {});
    const existing = await prisma.experiment.findUnique({ where: { id: req.params.id }, select: { userId: true } });
    if (!existing) return res.status(404).json({ error: "Experiment not found" });
    if (existing.userId !== req.user!.id) return res.status(404).json({ error: "Experiment not found" });
    const provider = await getUserProvider(req.user!.id);
    const result = await retryExperimentFailures(req.params.id, {
      provider,
      models: {
        ...(overrides.baselineModel ? { baselineModel: overrides.baselineModel } : {}),
        ...(overrides.candidateModel ? { candidateModel: overrides.candidateModel } : {}),
        ...(overrides.evaluatorModel ? { evaluatorModel: overrides.evaluatorModel } : {}),
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

/** Create the next iteration: baseline = previous candidate, same dataset, evaluator inherited unless overridden. */
export async function createNextIteration(
  experimentId: string,
  payload: {
    candidatePrompt: string;
    candidateModel: string;
    evaluatorModel?: string;
    evaluatorThreshold?: number;
    evaluatorPrompt?: string;
  },
  userId?: string,
) {
  const current = await prisma.experiment.findUnique({ where: { id: experimentId } });
  if (!current) return null;

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
      candidateModel: payload.candidateModel,
      evaluatorModel: payload.evaluatorModel ?? current.evaluatorModel,
      evaluatorThreshold: payload.evaluatorThreshold ?? current.evaluatorThreshold,
      evaluatorPrompt: payload.evaluatorPrompt ?? current.evaluatorPrompt,
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
    awaitRun?: boolean;
    models?: { baselineModel?: ModelId; candidateModel?: ModelId; evaluatorModel?: ModelId };
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

  // Retryable = missing result, execution failure, or evaluator failure.
  // A successfully judged low score (quality failure) is NOT retryable.
  const retryable: Array<{ testCase: TestCase; variant: "A" | "B" }> = [];
  for (const testCase of testCases) {
    for (const variant of ["A", "B"] as const) {
      const result = latestRun.results.find((r) => r.testCaseId === testCase.id && r.variant === variant);
      if (!result) { retryable.push({ testCase, variant }); continue; }
      const judgeFailed = result.judgement?.status === "failed";
      if (result.status === "failed" || judgeFailed) retryable.push({ testCase, variant });
    }
  }

  if (retryable.length === 0) return { retried: 0, remaining: 0 };

  await prisma.evaluationRun.update({ where: { id: latestRun.id }, data: { status: "running" } });
  await prisma.experiment.update({ where: { id: experiment.id }, data: { status: "running" } });

  // Use model overrides when provided (e.g. a working LLM), else the experiment's frozen config.
  const baselineModel = opts?.models?.baselineModel ?? (experiment.baselineModel as ModelId);
  const candidateModel = opts?.models?.candidateModel ?? (experiment.candidateModel as ModelId);
  const evaluatorModel = opts?.models?.evaluatorModel ?? ((experiment.evaluatorModel as ModelId) ?? undefined);

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
    }
  }

  return { retried: retryable.length, remaining };
}

/**
 * Start (or restart) an experiment run: baseline = variant A, candidate = variant B.
 * Reuses the Phase-3 evaluation engine via executeRun. Optionally awaits the run for tests.
 */
export async function startExperimentRun(
  experimentId: string,
  opts?: { provider?: import("../provider.js").ModelProvider; awaitRun?: boolean; reservationId?: string },
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
      userId: experiment.userId,
      status: "running",
    },
  });
  if (opts?.reservationId) await attachReservationToRun(opts.reservationId, run.id);

  await prisma.experiment.update({ where: { id: experiment.id }, data: { status: "running" } });

  const runPromise = executeRun({
    runId: run.id,
    model: experiment.baselineModel as ModelId,
    modelA: experiment.baselineModel as ModelId,
    modelB: experiment.candidateModel as ModelId,
    testCases,
    promptA: experiment.baselinePrompt,
    promptB: experiment.candidatePrompt,
    evaluatorModel: (experiment.evaluatorModel as ModelId) ?? undefined,
    evaluatorThreshold: experiment.evaluatorThreshold,
    evaluatorPrompt: experiment.evaluatorPrompt,
    provider: opts?.provider,
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
  judgement: {
    overallScore: number;
    pass: boolean;
    status: string;
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
    judgement: row.judgement
      ? {
          overallScore: row.judgement.overallScore,
          pass: row.judgement.pass,
          status: row.judgement.status as "completed" | "failed",
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
  results: Array<{ testCaseId: string; inputSnapshot: string | null; expectedOutputSnapshot: string | null }>,
  liveTestCases: Array<{ id: string; input: string; expectedOutput: string | null }>,
) {
  const liveById = new Map(liveTestCases.map((tc) => [tc.id, tc]));
  const ids = [...new Set(results.map((r) => r.testCaseId))];
  if (ids.length === 0) {
    return liveTestCases.map((tc) => ({ id: tc.id, input: tc.input, expectedOutput: tc.expectedOutput }));
  }
  return ids.map((id) => {
    const result = results.find((r) => r.testCaseId === id);
    const live = liveById.get(id);
    return {
      id,
      input: result?.inputSnapshot ?? live?.input ?? "",
      expectedOutput: result?.expectedOutputSnapshot ?? live?.expectedOutput ?? null,
    };
  });
}

function computeCompletion(
  results: Array<{ testCaseId: string; variant: string; status: string; judgement: { status: string } | null }>,
  testCaseIds: string[],
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
      if (r.status === "completed" && !judgeFailed) bucket.completed += 1;
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
          testCases: { orderBy: { position: "asc" }, select: { id: true, input: true, expectedOutput: true } },
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
      ? computeCompletion(latestRun.results, experiment.dataset.testCases.map((tc) => tc.id))
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
