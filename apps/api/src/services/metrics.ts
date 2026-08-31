import type {
  CriterionComparison,
  ExperimentComparison,
  ExperimentMetrics,
  Regression,
  ScenarioComparison,
} from "@prompt-playground/shared";

/**
 * Normalized evaluation result shape used by the metrics layer.
 * Decoupled from Prisma so the functions are pure and easy to unit test.
 */
export type MetricResult = {
  variant: "A" | "B";
  testCaseId: string;
  output: string | null;
  latencyMs: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  status: "completed" | "failed";
  judgement?: {
    overallScore: number;
    pass: boolean;
    status: "completed" | "failed";
    criteriaResults: Array<{ criterion: string; score: number; pass: boolean; reason: string | null }>;
  } | null;
};

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number | null, digits = 1): number | null {
  if (value === null) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function delta(candidate: number | null, baseline: number | null, digits = 1): number | null {
  if (candidate === null || baseline === null) return null;
  return round(candidate - baseline, digits);
}

/**
 * Aggregate per-variant metrics from the results of one evaluation run.
 */
export function aggregateVariant(results: MetricResult[]): ExperimentMetrics {
  const completed = results.filter((result) => result.status === "completed");
  const judged = results.filter((result) => result.judgement?.status === "completed");

  const scores = judged.map((result) => result.judgement!.overallScore);
  const passes = judged.filter((result) => result.judgement!.pass).length;
  const latencies = completed.map((result) => result.latencyMs).filter((value): value is number => value !== null);
  const tokens = completed.map((result) => result.totalTokens).filter((value): value is number => value !== null);
  const costs = completed.map((result) => result.estimatedCostUsd).filter((value): value is number => value !== null);

  const avgScore = mean(scores);
  const passRate = judged.length > 0 ? (passes / judged.length) * 100 : null;
  const avgLatencyMs = mean(latencies);
  const totalTokens = tokens.length > 0 ? tokens.reduce((sum, value) => sum + value, 0) : null;
  const avgTokens = totalTokens !== null && tokens.length > 0 ? totalTokens / tokens.length : null;
  const totalCostUsd = costs.length > 0 ? costs.reduce((sum, value) => sum + value, 0) : null;

  return {
    avgScore: round(avgScore),
    passRate: round(passRate, 1),
    avgLatencyMs: round(avgLatencyMs),
    totalTokens,
    avgTokens: round(avgTokens),
    totalCostUsd: round(totalCostUsd, 4),
    scoredCount: judged.length,
    completedCount: completed.length,
  };
}

/**
 * Compare candidate vs baseline metrics. Pass-rate delta is expressed in
 * percentage points (not %), all deltas are signed candidate - baseline.
 */
export function compareMetrics(baseline: ExperimentMetrics, candidate: ExperimentMetrics): ExperimentComparison {
  return {
    scoreDelta: delta(candidate.avgScore, baseline.avgScore),
    passRateDelta: delta(candidate.passRate, baseline.passRate),
    latencyDeltaMs: delta(candidate.avgLatencyMs, baseline.avgLatencyMs),
    tokenDelta: candidate.totalTokens !== null && baseline.totalTokens !== null
      ? candidate.totalTokens - baseline.totalTokens
      : null,
    costDeltaUsd: delta(candidate.totalCostUsd, baseline.totalCostUsd, 4),
  };
}

/**
 * Per-criterion comparison across both variants. A criterion is included if it
 * appears in at least one completed judgement on either side.
 */
export function compareCriteria(baselineResults: MetricResult[], candidateResults: MetricResult[]): CriterionComparison[] {
  const baselineByTestCase = new Map(baselineResults.map((result) => [result.testCaseId, result]));
  const candidateByTestCase = new Map(candidateResults.map((result) => [result.testCaseId, result]));

  const criteria = new Map<string, { baseline: number[]; candidate: number[] }>();
  for (const result of baselineByTestCase.values()) {
    for (const criterion of result.judgement?.criteriaResults ?? []) {
      const entry = criteria.get(criterion.criterion) ?? { baseline: [], candidate: [] };
      entry.baseline.push(criterion.score);
      criteria.set(criterion.criterion, entry);
    }
  }
  for (const result of candidateByTestCase.values()) {
    for (const criterion of result.judgement?.criteriaResults ?? []) {
      const entry = criteria.get(criterion.criterion) ?? { baseline: [], candidate: [] };
      entry.candidate.push(criterion.score);
      criteria.set(criterion.criterion, entry);
    }
  }

  return [...criteria.entries()].map(([criterion, values]) => {
    const baselineScore = mean(values.baseline);
    const candidateScore = mean(values.candidate);
    return {
      criterion,
      baselineScore: round(baselineScore),
      candidateScore: round(candidateScore),
      delta: delta(candidateScore, baselineScore),
    };
  });
}

/**
 * Per-scenario comparison. Baseline = variant A, candidate = variant B.
 */
export function compareScenarios(
  baselineResults: MetricResult[],
  candidateResults: MetricResult[],
  testCases: Array<{ id: string; input: string; expectedOutput: string | null }>,
): ScenarioComparison[] {
  const baselineByTestCase = new Map(baselineResults.map((result) => [result.testCaseId, result]));
  const candidateByTestCase = new Map(candidateResults.map((result) => [result.testCaseId, result]));

  return testCases.map((testCase) => {
    const baseline = baselineByTestCase.get(testCase.id);
    const candidate = candidateByTestCase.get(testCase.id);

    const baselineScore = baseline?.judgement?.status === "completed" ? baseline.judgement.overallScore : null;
    const candidateScore = candidate?.judgement?.status === "completed" ? candidate.judgement.overallScore : null;
    const baselinePass = baseline?.judgement?.status === "completed" ? baseline.judgement.pass : null;
    const candidatePass = candidate?.judgement?.status === "completed" ? candidate.judgement.pass : null;

    let passChange: ScenarioComparison["passChange"] = "missing";
    if (baselinePass !== null && candidatePass !== null) {
      if (candidatePass === baselinePass) passChange = "unchanged";
      else passChange = candidatePass ? "improved" : "regressed";
    }

    return {
      testCaseId: testCase.id,
      input: testCase.input,
      expectedOutput: testCase.expectedOutput,
      baselineScore: round(baselineScore),
      candidateScore: round(candidateScore),
      delta: delta(candidateScore, baselineScore),
      baselinePass,
      candidatePass,
      passChange,
      baselineOutput: baseline?.output ?? null,
      candidateOutput: candidate?.output ?? null,
      baselineJudgement: baseline?.judgement
        ? {
            id: "",
            resultId: "",
            overallScore: baseline.judgement.overallScore,
            pass: baseline.judgement.pass,
            summary: null,
            evaluatorModel: null,
            threshold: null,
            status: baseline.judgement.status,
            errorMessage: null,
            criteriaResults: baseline.judgement.criteriaResults.map((criterion) => ({
              id: "",
              criterion: criterion.criterion,
              score: criterion.score,
              pass: criterion.pass,
              reason: criterion.reason,
            })),
          }
        : null,
      candidateJudgement: candidate?.judgement
        ? {
            id: "",
            resultId: "",
            overallScore: candidate.judgement.overallScore,
            pass: candidate.judgement.pass,
            summary: null,
            evaluatorModel: null,
            threshold: null,
            status: candidate.judgement.status,
            errorMessage: null,
            criteriaResults: candidate.judgement.criteriaResults.map((criterion) => ({
              id: "",
              criterion: criterion.criterion,
              score: criterion.score,
              pass: criterion.pass,
              reason: criterion.reason,
            })),
          }
        : null,
    };
  });
}

/**
 * Detect regressions: any scenario or criterion where the candidate is worse
 * than the baseline (strictly negative delta).
 */
export function findRegressions(criteria: CriterionComparison[], scenarios: ScenarioComparison[]): Regression[] {
  const regressions: Regression[] = [];

  for (const scenario of scenarios) {
    if (scenario.delta !== null && scenario.delta < 0) {
      regressions.push({
        kind: "scenario",
        label: scenario.input.slice(0, 120),
        baselineValue: scenario.baselineScore,
        candidateValue: scenario.candidateScore,
        delta: scenario.delta,
        testCaseId: scenario.testCaseId,
      });
    }
  }

  for (const criterion of criteria) {
    if (criterion.delta !== null && criterion.delta < 0) {
      regressions.push({
        kind: "criterion",
        label: criterion.criterion,
        baselineValue: criterion.baselineScore,
        candidateValue: criterion.candidateScore,
        delta: criterion.delta,
        criterion: criterion.criterion,
      });
    }
  }

  return regressions;
}

export type ExperimentRecommendation = {
  recommendation: "promote_candidate" | "keep_baseline" | "continue_experiment" | "insufficient_data";
  label: string;
  reason: string;
  evidence: string[];
  canRecommend: boolean;
};

function fmtSigned(value: number, digits = 1): string {
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded.toFixed(digits)}`;
}

/**
 * Deterministic, evidence-based recommendation. It never decides for the user —
 * it only summarizes the evaluation evidence to support their decision.
 */
export function recommendExperiment(input: {
  metrics: { baseline: ExperimentMetrics; candidate: ExperimentMetrics; comparison: ExperimentComparison };
  criteria: CriterionComparison[];
  scenarios: ScenarioComparison[];
  regressions: Regression[];
  retryable: number;
}): ExperimentRecommendation {
  const { metrics, regressions, retryable } = input;
  const { baseline, candidate, comparison } = metrics;
  const evidence: string[] = [];

  // Never recommend on an incomplete evaluation.
  if (retryable > 0) {
    return {
      recommendation: "insufficient_data",
      label: "Insufficient data",
      reason: "The evaluation is incomplete.",
      evidence: [`${retryable} scenario${retryable === 1 ? "" : "s"} still require evaluation.`],
      canRecommend: false,
    };
  }

  const scoreDelta = comparison.scoreDelta ?? 0;
  const passDelta = comparison.passRateDelta ?? 0;
  const latencyDelta = comparison.latencyDeltaMs ?? 0;
  const costDelta = comparison.costDeltaUsd ?? 0;
  const scenarioRegs = regressions.filter((r) => r.kind === "scenario").length;
  const criterionRegs = regressions.filter((r) => r.kind === "criterion").length;
  const totalRegs = scenarioRegs + criterionRegs;

  if (candidate.avgScore != null) {
    evidence.push(`${fmtSigned(scoreDelta)} average score (${candidate.avgScore.toFixed(1)} vs ${baseline.avgScore?.toFixed(1) ?? "—"} baseline)`);
  }
  if (candidate.passRate != null) evidence.push(`${fmtSigned(passDelta)} pp pass rate`);
  if (scenarioRegs > 0) evidence.push(`-${scenarioRegs} scenario regression${scenarioRegs === 1 ? "" : "s"}`);
  if (criterionRegs > 0) evidence.push(`-${criterionRegs} criterion regression${criterionRegs === 1 ? "" : "s"}`);
  if (latencyDelta !== 0) evidence.push(`${latencyDelta > 0 ? "+" : ""}${Math.round(latencyDelta)} ms latency`);
  if (costDelta !== 0) evidence.push(`${costDelta > 0 ? "+" : "-"}$${Math.abs(costDelta).toFixed(4)} cost`);

  const qualityImproved = scoreDelta > 0.5 && passDelta >= 0;
  const qualityDeclined = scoreDelta < -0.5 || passDelta < 0;

  if (qualityImproved && totalRegs === 0) {
    return {
      recommendation: "promote_candidate",
      label: "Promote Candidate",
      reason: "Candidate improves quality with no detected regressions.",
      evidence,
      canRecommend: true,
    };
  }
  if (qualityDeclined) {
    return {
      recommendation: "keep_baseline",
      label: "Keep Baseline",
      reason: "Candidate reduces quality.",
      evidence,
      canRecommend: true,
    };
  }
  if (totalRegs > 0) {
    return {
      recommendation: "continue_experiment",
      label: "Continue Experiment",
      reason: "Candidate improves quality but introduces regressions.",
      evidence,
      canRecommend: true,
    };
  }
  return {
    recommendation: "continue_experiment",
    label: "Continue Experiment",
    reason: "No clear quality improvement.",
    evidence,
    canRecommend: true,
  };
}
