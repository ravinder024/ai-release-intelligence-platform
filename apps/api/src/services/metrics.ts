import type {
  CriterionComparison,
  ExperimentComparison,
  ExperimentMetrics,
  FailureCategory,
  FailureAnalysis,
  Regression,
  ScenarioComparison,
} from "@prompt-playground/shared";

export type MetricResult = {
  variant: "A" | "B";
  testCaseId: string;
  output: string | null;
  latencyMs: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  status: "completed" | "failed";
  errorMessage?: string | null;
  model?: string | null;
  judgement?: {
    overallScore: number;
    pass: boolean;
    status: "completed" | "failed";
    summary?: string | null;
    evaluatorModel?: string | null;
    threshold?: number | null;
    errorMessage?: string | null;
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
  const avgTokens = totalTokens !== null ? totalTokens / tokens.length : null;
  const totalCostUsd = costs.length > 0 ? costs.reduce((sum, value) => sum + value, 0) : null;
  return {
    avgScore: round(avgScore),
    passRate: round(passRate),
    avgLatencyMs: round(avgLatencyMs),
    totalTokens,
    avgTokens: round(avgTokens),
    totalCostUsd: round(totalCostUsd, 4),
    scoredCount: judged.length,
    completedCount: completed.length,
  };
}

export function compareMetrics(baseline: ExperimentMetrics, candidate: ExperimentMetrics): ExperimentComparison {
  return {
    scoreDelta: delta(candidate.avgScore, baseline.avgScore),
    passRateDelta: delta(candidate.passRate, baseline.passRate),
    latencyDeltaMs: delta(candidate.avgLatencyMs, baseline.avgLatencyMs),
    tokenDelta: candidate.totalTokens !== null && baseline.totalTokens !== null ? candidate.totalTokens - baseline.totalTokens : null,
    costDeltaUsd: delta(candidate.totalCostUsd, baseline.totalCostUsd, 4),
  };
}

export function compareCriteria(baselineResults: MetricResult[], candidateResults: MetricResult[]): CriterionComparison[] {
  const criteria = new Map<string, { baseline: number[]; candidate: number[] }>();
  for (const result of baselineResults) {
    if (result.judgement?.status !== "completed") continue;
    for (const item of result.judgement.criteriaResults) {
      const entry = criteria.get(item.criterion) ?? { baseline: [], candidate: [] };
      entry.baseline.push(item.score);
      criteria.set(item.criterion, entry);
    }
  }
  for (const result of candidateResults) {
    if (result.judgement?.status !== "completed") continue;
    for (const item of result.judgement.criteriaResults) {
      const entry = criteria.get(item.criterion) ?? { baseline: [], candidate: [] };
      entry.candidate.push(item.score);
      criteria.set(item.criterion, entry);
    }
  }
  return [...criteria.entries()].map(([criterion, values]) => {
    const baselineScore = mean(values.baseline);
    const candidateScore = mean(values.candidate);
    return { criterion, baselineScore: round(baselineScore), candidateScore: round(candidateScore), delta: delta(candidateScore, baselineScore) };
  });
}

function toPublicJudgement(result: MetricResult["judgement"], resultId: string) {
  if (!result) return null;
  return {
    id: "",
    resultId,
    overallScore: result.overallScore,
    pass: result.pass,
    summary: result.summary ?? null,
    evaluatorModel: result.evaluatorModel ?? null,
    threshold: result.threshold ?? null,
    status: result.status,
    errorMessage: result.errorMessage ?? null,
    criteriaResults: result.criteriaResults.map((item) => ({ id: "", ...item })),
  };
}

export function compareScenarios(
  baselineResults: MetricResult[],
  candidateResults: MetricResult[],
  testCases: Array<{ id: string; input: string; expectedOutput: string | null; criteria?: string[] }>,
): ScenarioComparison[] {
  const baselineById = new Map(baselineResults.map((result) => [result.testCaseId, result]));
  const candidateById = new Map(candidateResults.map((result) => [result.testCaseId, result]));
  return testCases.map((testCase) => {
    const baseline = baselineById.get(testCase.id) ?? null;
    const candidate = candidateById.get(testCase.id) ?? null;
    const baselineJudgement = baseline?.judgement?.status === "completed" ? baseline.judgement : null;
    const candidateJudgement = candidate?.judgement?.status === "completed" ? candidate.judgement : null;
    const baselinePass = baselineJudgement?.pass ?? null;
    const candidatePass = candidateJudgement?.pass ?? null;
    let passChange: ScenarioComparison["passChange"] = "missing";
    if (baselinePass !== null && candidatePass !== null) {
      passChange = baselinePass === candidatePass ? "unchanged" : candidatePass ? "improved" : "regressed";
    }
    const criteria = testCase.criteria ?? [];
    const analysis = analyzeScenarioFailure({
      testCaseId: testCase.id,
      criteria,
      hasGolden: Boolean(testCase.expectedOutput?.trim()),
      baseline,
      candidate,
      passChange,
    });
    return {
      testCaseId: testCase.id,
      input: testCase.input,
      expectedOutput: testCase.expectedOutput,
      criteria,
      baselineScore: round(baselineJudgement?.overallScore ?? null),
      candidateScore: round(candidateJudgement?.overallScore ?? null),
      delta: delta(candidateJudgement?.overallScore ?? null, baselineJudgement?.overallScore ?? null),
      baselinePass,
      candidatePass,
      passChange,
      baselineOutput: baseline?.output ?? null,
      candidateOutput: candidate?.output ?? null,
      baselineJudgement: toPublicJudgement(baseline?.judgement, ""),
      candidateJudgement: toPublicJudgement(candidate?.judgement, ""),
      baselineExecution: baseline ? { status: baseline.status, errorMessage: baseline.errorMessage ?? null, latencyMs: baseline.latencyMs, model: baseline.model ?? null } : null,
      candidateExecution: candidate ? { status: candidate.status, errorMessage: candidate.errorMessage ?? null, latencyMs: candidate.latencyMs, model: candidate.model ?? null } : null,
      failureAnalysis: analysis,
    };
  });
}

function categoryForEvidence(text: string): FailureCategory | null {
  const normalized = text.toLowerCase();
  if (/unsupported|unsubstantiated|hallucinat|fabricat|invented claim/.test(normalized)) return "unsupported_claim";
  if (/missing|omitted|does not include|fails to include|not address|left out/.test(normalized)) return "missing_information";
  if (/next step|incorrect step|wrong step|misdirect|wrong action|incorrect action/.test(normalized)) return "incorrect_next_step";
  if (/instruction|format|constraint|follow the prompt|violat/.test(normalized)) return "instruction_violation";
  if (/incomplete|unfinished|partial response|truncated/.test(normalized)) return "incomplete_response";
  return null;
}

function analyzeScenarioFailure(input: {
  testCaseId: string;
  criteria: string[];
  hasGolden: boolean;
  baseline: MetricResult | null;
  candidate: MetricResult | null;
  passChange: ScenarioComparison["passChange"];
}): FailureAnalysis {
  const { testCaseId, criteria, hasGolden, baseline, candidate, passChange } = input;
  let type: FailureAnalysis["type"] = "pass";
  if (!candidate) type = "missing_result";
  else if (candidate.status === "failed") type = "execution_error";
  else if (candidate.judgement?.status === "failed") type = "evaluator_error";
  else if (!candidate.judgement || candidate.judgement.status !== "completed") type = "missing_result";
  else if (passChange === "regressed") type = "regression";
  else if (!candidate.judgement.pass) type = "quality_failure";
  else if (passChange === "improved") type = "improvement";

  const failedCriteria = (type === "improvement" ? baseline : candidate)?.judgement?.status === "completed"
    ? (type === "improvement" ? baseline!.judgement! : candidate!.judgement!).criteriaResults.filter((item) => !item.pass)
    : [];
  if (type === "execution_error") return { type, categories: ["execution_error"], failedCriteria: [], evidence: [candidate?.errorMessage ?? "Candidate execution failed."], suggestions: [], requiresHumanReview: false };
  if (type === "evaluator_error") return { type, categories: ["evaluator_error"], failedCriteria: [], evidence: [candidate?.judgement?.errorMessage ?? "Evaluator failed; this is not a quality score."], suggestions: [], requiresHumanReview: false };
  if (type === "missing_result") return { type, categories: ["missing_result"], failedCriteria: [], evidence: ["A required execution or completed judgement is missing."], suggestions: [], requiresHumanReview: false };
  if (type === "pass") return { type, categories: [], failedCriteria: [], evidence: [], suggestions: [], requiresHumanReview: false };

  const categories = new Set<FailureCategory>();
  for (const item of failedCriteria) categories.add(categoryForEvidence(`${item.criterion} ${item.reason ?? ""}`) ?? (item.criterion ? "criterion_failure" : "unclassified"));
  if (!categories.size) categories.add("unclassified");
  const evidence = failedCriteria.map((item) => `${item.criterion}: ${item.reason ?? `score ${item.score}, failed`}`);
  const evaluatorSummary = (type === "improvement" ? baseline : candidate)?.judgement?.summary;
  if (evaluatorSummary) evidence.unshift(`Evaluator: ${evaluatorSummary}`);
  const suggestions: FailureAnalysis["suggestions"] = type === "improvement" ? [] : failedCriteria.map((item) => {
    const category = categoryForEvidence(`${item.criterion} ${item.reason ?? ""}`);
    const action = category === "unsupported_claim"
      ? "Clarify the prompt's evidence boundary and require uncertainty when support is absent."
      : category === "missing_information"
        ? "Add an explicit instruction to address the missing required information."
        : category === "incorrect_next_step"
          ? "Review the decision rule for the next step and add a contrasting edge case."
          : category === "instruction_violation"
            ? "Make the relevant instruction or output constraint explicit and test it directly."
            : category === "incomplete_response"
              ? "Clarify minimum required response elements and add a completeness check to the rubric."
              : "Review whether this rubric criterion distinguishes acceptable and failing responses.";
    return { action, rationale: `Scenario ${testCaseId}, criterion '${item.criterion}': ${item.reason ?? `score ${item.score}`}. Treat the proposed cause as a hypothesis.`, testCaseId, criterion: item.criterion };
  });
  if (type === "regression" && baseline?.model && candidate?.model && baseline.model !== candidate.model) {
    suggestions.push({ action: "Investigate whether this regression is model-specific.", rationale: `Baseline used ${baseline.model}; candidate used ${candidate.model}.`, testCaseId });
  }
  if (type !== "improvement" && !hasGolden) {
    suggestions.push({ action: "Add and review a golden answer before using this scenario as a release gate.", rationale: `Scenario ${testCaseId} has no expected output to anchor the judgement.`, testCaseId });
  }
  return { type, categories: [...categories], failedCriteria, evidence, suggestions, requiresHumanReview: !hasGolden || criteria.length === 0 };
}

export function findRegressions(criteria: CriterionComparison[], scenarios: ScenarioComparison[]): Regression[] {
  const regressions: Regression[] = [];
  for (const scenario of scenarios) {
    if (scenario.delta !== null && scenario.delta < 0) regressions.push({ kind: "scenario", label: scenario.input.slice(0, 120), baselineValue: scenario.baselineScore, candidateValue: scenario.candidateScore, delta: scenario.delta, testCaseId: scenario.testCaseId });
  }
  for (const criterion of criteria) {
    if (criterion.delta !== null && criterion.delta < 0) regressions.push({ kind: "criterion", label: criterion.criterion, baselineValue: criterion.baselineScore, candidateValue: criterion.candidateScore, delta: criterion.delta, criterion: criterion.criterion });
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
  const rounded = Math.round(value * 10 ** digits) / 10 ** digits;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(digits)}`;
}

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
  if (retryable > 0) return { recommendation: "insufficient_data", label: "Insufficient data", reason: "The evaluation is incomplete.", evidence: [`${retryable} scenario${retryable === 1 ? "" : "s"} still require evaluation.`], canRecommend: false };
  const scoreDelta = comparison.scoreDelta ?? 0;
  const passDelta = comparison.passRateDelta ?? 0;
  const latencyDelta = comparison.latencyDeltaMs ?? 0;
  const costDelta = comparison.costDeltaUsd ?? 0;
  const scenarioRegs = regressions.filter((item) => item.kind === "scenario").length;
  const criterionRegs = regressions.filter((item) => item.kind === "criterion").length;
  const totalRegs = scenarioRegs + criterionRegs;
  if (candidate.avgScore != null) evidence.push(`${fmtSigned(scoreDelta)} average score (${candidate.avgScore.toFixed(1)} vs ${baseline.avgScore?.toFixed(1) ?? "—"} baseline)`);
  if (candidate.passRate != null) evidence.push(`${fmtSigned(passDelta)} pp pass rate`);
  if (scenarioRegs > 0) evidence.push(`-${scenarioRegs} scenario regression${scenarioRegs === 1 ? "" : "s"}`);
  if (criterionRegs > 0) evidence.push(`-${criterionRegs} criterion regression${criterionRegs === 1 ? "" : "s"}`);
  if (latencyDelta !== 0) evidence.push(`${latencyDelta > 0 ? "+" : ""}${Math.round(latencyDelta)} ms latency`);
  if (costDelta !== 0) evidence.push(`${costDelta > 0 ? "+" : "-"}$${Math.abs(costDelta).toFixed(4)} cost`);
  const qualityImproved = scoreDelta > 0.5 && passDelta >= 0;
  const qualityDeclined = scoreDelta < -0.5 || passDelta < 0;
  if (qualityImproved && totalRegs === 0) return { recommendation: "promote_candidate", label: "Promote Candidate", reason: "Candidate improves quality with no detected regressions.", evidence, canRecommend: true };
  if (qualityDeclined) return { recommendation: "keep_baseline", label: "Keep Baseline", reason: "Candidate reduces quality.", evidence, canRecommend: true };
  if (totalRegs > 0) return { recommendation: "continue_experiment", label: "Continue Experiment", reason: "Candidate improves quality but introduces regressions.", evidence, canRecommend: true };
  return { recommendation: "continue_experiment", label: "Continue Experiment", reason: "No clear quality improvement.", evidence, canRecommend: true };
}
