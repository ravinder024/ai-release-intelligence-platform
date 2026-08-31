import {
  aggregateVariant,
  compareCriteria,
  compareMetrics,
  compareScenarios,
  findRegressions,
  recommendExperiment,
  type MetricResult,
} from "../services/metrics.js";
import { metricDeltaTone } from "@prompt-playground/shared";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) {
    failures++;
    console.error(`FAIL ${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  } else {
    console.log(`PASS ${label}`);
  }
}

function close(label: string, actual: number | null, expected: number, tolerance = 0.05) {
  const pass = actual !== null && Math.abs(actual - expected) <= tolerance;
  if (!pass) {
    failures++;
    console.error(`FAIL ${label}\n  expected ~${expected}\n  actual:   ${actual}`);
  } else {
    console.log(`PASS ${label}`);
  }
}

function makeResult(overrides: Partial<MetricResult> & { variant: "A" | "B"; testCaseId: string }): MetricResult {
  return {
    output: "out",
    latencyMs: null,
    totalTokens: null,
    estimatedCostUsd: null,
    status: "completed",
    ...overrides,
  };
}

// --- 1. Score, pass-rate, latency, token, cost aggregation -----------------
const aggResults: MetricResult[] = [
  makeResult({
    variant: "A", testCaseId: "t1", latencyMs: 100, totalTokens: 100, estimatedCostUsd: 0.001,
    judgement: { overallScore: 80, pass: true, status: "completed", criteriaResults: [] },
  }),
  makeResult({
    variant: "A", testCaseId: "t2", latencyMs: 200, totalTokens: 200, estimatedCostUsd: 0.002,
    judgement: { overallScore: 60, pass: false, status: "completed", criteriaResults: [] },
  }),
  makeResult({ variant: "A", testCaseId: "t3", latencyMs: 300, totalTokens: 300, estimatedCostUsd: 0.003 }),
  makeResult({ variant: "A", testCaseId: "t4", latencyMs: null, status: "failed" }),
];

const agg = aggregateVariant(aggResults);
close("1. avg score", agg.avgScore, 70);
close("2. pass rate", agg.passRate, 50);
close("3. avg latency", agg.avgLatencyMs, 200);
check("4. total tokens", agg.totalTokens, 600);
close("5. avg tokens", agg.avgTokens, 200);
close("6. total cost", agg.totalCostUsd, 0.006);
check("7. scored/completed counts", [agg.scoredCount, agg.completedCount], [2, 3]);

// --- 6/7. Score and pass-rate deltas ---------------------------------------
const baselineAgg = aggregateVariant([
  makeResult({ variant: "A", testCaseId: "t1", judgement: { overallScore: 78, pass: true, status: "completed", criteriaResults: [] } }),
  makeResult({ variant: "A", testCaseId: "t2", judgement: { overallScore: 78, pass: true, status: "completed", criteriaResults: [] } }),
]);
const candidateAgg = aggregateVariant([
  makeResult({ variant: "B", testCaseId: "t1", judgement: { overallScore: 86, pass: true, status: "completed", criteriaResults: [] } }),
  makeResult({ variant: "B", testCaseId: "t2", judgement: { overallScore: 86, pass: true, status: "completed", criteriaResults: [] } }),
]);
const comparison = compareMetrics(baselineAgg, candidateAgg);
close("8. score delta", comparison.scoreDelta, 8);
close("9. pass-rate delta (pp)", comparison.passRateDelta, 0);
// baseline 100% pass (78>=threshold?) -> both 100% so delta 0. Test with mixed:
const baselineAgg2 = aggregateVariant([
  makeResult({ variant: "A", testCaseId: "t1", judgement: { overallScore: 90, pass: true, status: "completed", criteriaResults: [] } }),
  makeResult({ variant: "A", testCaseId: "t2", judgement: { overallScore: 50, pass: false, status: "completed", criteriaResults: [] } }),
  makeResult({ variant: "A", testCaseId: "t3", judgement: { overallScore: 50, pass: false, status: "completed", criteriaResults: [] } }),
  makeResult({ variant: "A", testCaseId: "t4", judgement: { overallScore: 90, pass: true, status: "completed", criteriaResults: [] } }),
]);
const candidateAgg2 = aggregateVariant([
  makeResult({ variant: "B", testCaseId: "t1", judgement: { overallScore: 90, pass: true, status: "completed", criteriaResults: [] } }),
  makeResult({ variant: "B", testCaseId: "t2", judgement: { overallScore: 90, pass: true, status: "completed", criteriaResults: [] } }),
  makeResult({ variant: "B", testCaseId: "t3", judgement: { overallScore: 90, pass: true, status: "completed", criteriaResults: [] } }),
  makeResult({ variant: "B", testCaseId: "t4", judgement: { overallScore: 90, pass: true, status: "completed", criteriaResults: [] } }),
]);
close("10. pass-rate delta in pp (50% -> 100%)", compareMetrics(baselineAgg2, candidateAgg2).passRateDelta, 50);

// --- 8. Criterion comparison ----------------------------------------------
const criterionBaseline: MetricResult[] = [
  makeResult({
    variant: "A", testCaseId: "t1",
    judgement: { overallScore: 82, pass: true, status: "completed", criteriaResults: [
      { criterion: "Accuracy", score: 82, pass: true, reason: null },
      { criterion: "Completeness", score: 76, pass: true, reason: null },
    ] },
  }),
];
const criterionCandidate: MetricResult[] = [
  makeResult({
    variant: "B", testCaseId: "t1",
    judgement: { overallScore: 91, pass: true, status: "completed", criteriaResults: [
      { criterion: "Accuracy", score: 91, pass: true, reason: null },
      { criterion: "Completeness", score: 70, pass: false, reason: null },
    ] },
  }),
];
const criterionComparison = compareCriteria(criterionBaseline, criterionCandidate);
const accuracy = criterionComparison.find((item) => item.criterion === "Accuracy");
const completeness = criterionComparison.find((item) => item.criterion === "Completeness");
close("11. criterion Accuracy delta", accuracy?.delta ?? null, 9);
close("12. criterion Completeness delta (regression)", completeness?.delta ?? null, -6);

// --- 9. Scenario comparison + 10. regression detection --------------------
const scenarioBaseline: MetricResult[] = [
  makeResult({ variant: "A", testCaseId: "s1", output: "b1", judgement: { overallScore: 72, pass: true, status: "completed", criteriaResults: [] } }),
  makeResult({ variant: "A", testCaseId: "s2", output: "b2", judgement: { overallScore: 80, pass: true, status: "completed", criteriaResults: [] } }),
];
const scenarioCandidate: MetricResult[] = [
  makeResult({ variant: "B", testCaseId: "s1", output: "c1", judgement: { overallScore: 91, pass: true, status: "completed", criteriaResults: [] } }),
  makeResult({ variant: "B", testCaseId: "s2", output: "c2", judgement: { overallScore: 64, pass: false, status: "completed", criteriaResults: [] } }),
];
const scenarios = compareScenarios(scenarioBaseline, scenarioCandidate, [
  { id: "s1", input: "Refund", expectedOutput: null },
  { id: "s2", input: "Escalation", expectedOutput: null },
]);
close("13. scenario s1 delta", scenarios[0].delta ?? null, 19);
close("14. scenario s2 delta (regression)", scenarios[1].delta ?? null, -16);
check("15. scenario pass changes", [scenarios[0].passChange, scenarios[1].passChange], ["unchanged", "regressed"]);
check("16. scenario outputs", [scenarios[0].baselineOutput, scenarios[1].candidateOutput], ["b1", "c2"]);

const regressions = findRegressions(criterionComparison, scenarios);
check("17. regression count (1 criterion + 1 scenario)", regressions.length, 2);
check("18. regression kinds", regressions.map((r) => r.kind).sort(), ["criterion", "scenario"]);

// --- Metric direction semantics (Test Group D) ---
check("D1. quality + delta = good", metricDeltaTone(1, "score"), "good");
check("D2. quality - delta = bad", metricDeltaTone(-1, "score"), "bad");
check("D3. pass-rate + delta = good", metricDeltaTone(8, "pp"), "good");
check("D4. latency - delta = good", metricDeltaTone(-500, "ms"), "good");
check("D5. latency + delta = bad", metricDeltaTone(500, "ms"), "bad");
check("D6. tokens - delta = good", metricDeltaTone(-100, "tokens"), "good");
check("D7. tokens + delta = bad", metricDeltaTone(100, "tokens"), "bad");
check("D8. cost - delta = good", metricDeltaTone(-0.02, "cost"), "good");
check("D9. cost + delta = bad", metricDeltaTone(0.02, "cost"), "bad");
check("D10. zero delta = neutral", metricDeltaTone(0, "score"), "neutral");
check("D11. null delta = neutral", metricDeltaTone(null, "cost"), "neutral");

// --- Recommendation (Test Group E) ---
function recommendInput(overrides: {
  scoreDelta?: number; passRateDelta?: number; latencyDeltaMs?: number; costDeltaUsd?: number;
  regressions?: Array<{ kind: "scenario" | "criterion"; label: string; baselineValue: number; candidateValue: number; delta: number; testCaseId?: string; criterion?: string }>;
  retryable?: number; avgScore?: number; passRate?: number;
}) {
  const { scoreDelta = 0, passRateDelta = 0, latencyDeltaMs = 0, costDeltaUsd = 0, regressions = [], retryable = 0, avgScore = 8, passRate = 80 } = overrides;
  const base = { avgLatencyMs: 1000, totalTokens: 500, avgTokens: 100, totalCostUsd: 0.1, scoredCount: 5, completedCount: 5 };
  return {
    metrics: {
      baseline: { avgScore: avgScore - scoreDelta, passRate: passRate - passRateDelta, ...base },
      candidate: { avgScore, passRate, ...base },
      comparison: { scoreDelta, passRateDelta, latencyDeltaMs, tokenDelta: 0, costDeltaUsd },
    },
    criteria: [],
    scenarios: [],
    regressions,
    retryable,
  };
}

// Scenario 1: quality improved, no regressions -> PROMOTE
const promoteRec = recommendExperiment(recommendInput({ scoreDelta: 0.8, passRateDelta: 8 }));
check("E1. promote candidate", promoteRec.recommendation, "promote_candidate");
check("E1b. promote evidence present", promoteRec.evidence.some((e) => e.includes("+0.8")), true);

// Scenario 2: quality declined -> KEEP BASELINE
check("E2. keep baseline", recommendExperiment(recommendInput({ scoreDelta: -1.2, passRateDelta: -10 })).recommendation, "keep_baseline");

// Scenario 3: quality improved but regressions -> CONTINUE
check("E3. continue (improved + regressions)", recommendExperiment(recommendInput({
  scoreDelta: 0.8, passRateDelta: 6,
  regressions: [{ kind: "scenario", label: "Escalation", baselineValue: 8, candidateValue: 6.4, delta: -1.6, testCaseId: "t1" }],
})).recommendation, "continue_experiment");

// Scenario 4: incomplete evaluation -> insufficient data
const insufficientRec = recommendExperiment(recommendInput({ scoreDelta: 0.8, retryable: 2 }));
check("E4. insufficient data", insufficientRec.recommendation, "insufficient_data");
check("E4b. cannot recommend", insufficientRec.canRecommend, false);

if (failures > 0) {
  console.error(`${failures} tests failed`);
  process.exit(1);
}
console.log("All metrics tests passed");
process.exit(0);
