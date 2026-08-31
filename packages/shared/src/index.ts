// Ordered list of supported free models. A healthy, general-purpose model is first so
// it becomes the default selection; models that OpenRouter returns 404 for are removed.
export const supportedModels = [
  {
    id: "nvidia/nemotron-3-ultra-550b-a55b:free",
    label: "NVIDIA: Nemotron 3 Ultra (free)",
    inputCostPerMillion: 0,
    outputCostPerMillion: 0,
  },
  {
    id: "google/gemma-4-31b-it:free",
    label: "Google: Gemma 4 31B (free)",
    inputCostPerMillion: 0,
    outputCostPerMillion: 0,
  },
  {
    id: "poolside/laguna-s-2.1:free",
    label: "Poolside: Laguna S 2.1 (free)",
    inputCostPerMillion: 0,
    outputCostPerMillion: 0,
  },
  {
    id: "nvidia/nemotron-3.5-lightning:free",
    label: "NVIDIA: Nemotron 3.5 Lightning (free)",
    inputCostPerMillion: 0,
    outputCostPerMillion: 0,
  },
  {
    id: "nvidia/nemotron-3-super-120b-a12b:free",
    label: "NVIDIA: Nemotron 3 Super (free)",
    inputCostPerMillion: 0,
    outputCostPerMillion: 0,
  },
  {
    id: "cohere/north-mini-code:free",
    label: "Cohere: North Mini Code (free)",
    inputCostPerMillion: 0,
    outputCostPerMillion: 0,
  },
  {
    id: "poolside/laguna-xs-2.1:free",
    label: "Poolside: Laguna XS 2.1 (free)",
    inputCostPerMillion: 0,
    outputCostPerMillion: 0,
  },
  {
    id: "dots-studio/dots-3-note-preview:free",
    label: "Dots Studio: Dots3-Note Preview (free)",
    inputCostPerMillion: 0,
    outputCostPerMillion: 0,
  },
  {
    id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    label: "NVIDIA: Nemotron 3 Nano Omni (free)",
    inputCostPerMillion: 0,
    outputCostPerMillion: 0,
  },
  {
    id: "google/gemma-4-26b-a4b-it:free",
    label: "Google: Gemma 4 26B (free)",
    inputCostPerMillion: 0,
    outputCostPerMillion: 0,
  },
] as const;

export type ModelId = (typeof supportedModels)[number]["id"];
export type ComparisonStatus = "running" | "completed" | "partial_failure";
export type ExecutionStatus = "completed" | "failed";

export type CreateComparisonRequest = {
  model: ModelId;
  input: string;
  promptA: string;
  promptB: string;
};

export type PromptExecution = {
  id: string;
  variant: "A" | "B";
  prompt: string;
  output: string | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  status: ExecutionStatus;
  errorMessage: string | null;
};

export type Comparison = {
  id: string;
  model: ModelId;
  input: string;
  status: ComparisonStatus;
  createdAt: string;
  completedAt: string | null;
  userId?: string | null;
  executions: PromptExecution[];
};

export type Dataset = {
  id: string;
  name: string;
  description: string | null;
  useCase: string | null;
  isSample?: boolean;
  /** Whether the current user may edit this dataset (samples are read-only, others' are private). */
  editable?: boolean;
  createdAt: string;
  updatedAt: string;
  testCaseCount: number;
};

export type DatasetTestCase = {
  id: string;
  datasetId: string;
  input: string;
  expectedOutput: string | null;
  evaluationCriteria: string[] | null;
  notes: string | null;
  position: number;
};

export type CreateDatasetRequest = {
  name: string;
  description?: string;
  useCase?: string;
};

export type UpdateDatasetRequest = Partial<CreateDatasetRequest>;

export type CreateTestCaseRequest = {
  input: string;
  expectedOutput?: string;
  evaluationCriteria?: string[];
  notes?: string;
  position?: number;
};

export type UpdateTestCaseRequest = Partial<CreateTestCaseRequest>;

export type DatasetDetail = Dataset & { testCases: DatasetTestCase[] };

export type EvaluationCriterionResult = {
  id: string;
  criterion: string;
  score: number;
  pass: boolean;
  reason: string | null;
};

export type EvaluationJudgement = {
  id: string;
  resultId: string;
  overallScore: number;
  pass: boolean;
  summary: string | null;
  evaluatorModel: string | null;
  threshold: number | null;
  status: ExecutionStatus;
  errorMessage: string | null;
  criteriaResults: EvaluationCriterionResult[];
};

export type EvaluationResult = {
  id: string;
  testCaseId: string;
  variant: "A" | "B";
  prompt: string;
  output: string | null;
  // optional provider response snapshot and model metadata
  responseSnapshot?: any;
  modelMetadata?: any;
  inputSnapshot?: string | null;
  expectedOutputSnapshot?: string | null;
  criteriaSnapshot?: string[] | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  status: ExecutionStatus;
  errorMessage: string | null;
  judgement?: EvaluationJudgement;
};

export type RunEvaluationRequest = {
  datasetId: string;
  model: ModelId;
  promptA: string;
  promptB: string;
  experimentId?: string;
  modelA?: ModelId;
  modelB?: ModelId;
  evaluatorModel?: ModelId;
  evaluatorThreshold?: number;
  evaluatorPrompt?: string;
};

export type EvaluationRun = {
  id: string;
  datasetId: string;
  datasetName: string;
  experimentId?: string | null;
  userId?: string | null;
  model: ModelId;
  modelA?: ModelId | null;
  modelB?: ModelId | null;
  promptA: string;
  promptB: string;
  evaluatorModel: string | null;
  evaluatorThreshold: number | null;
  evaluatorPrompt: string | null;
  status: ComparisonStatus;
  createdAt: string;
  completedAt: string | null;
  progress: { completed: number; total: number };
  testCases: DatasetTestCase[];
  results: EvaluationResult[];
};

export type EvaluationRunSummary = {
  id: string;
  datasetId: string;
  datasetName: string;
  model: ModelId;
  status: ComparisonStatus;
  createdAt: string;
  completedAt: string | null;
  userId?: string | null;
  testCaseCount: number;
  resultCount: number;
};

export type ExperimentStatus = "draft" | "running" | "completed" | "partial_failure" | "failed";
export type ExperimentDecision = "promote_candidate" | "keep_baseline" | "continue_experiment";

export type Experiment = {
  id: string;
  name: string;
  hypothesis: string | null;
  datasetId: string;
  datasetName?: string;
  baselinePrompt: string;
  baselineModel: string;
  candidatePrompt: string;
  candidateModel: string;
  evaluatorModel: string | null;
  evaluatorThreshold: number | null;
  evaluatorPrompt: string | null;
  status: ExperimentStatus;
  decision: ExperimentDecision | null;
  decisionNote: string | null;
  decidedAt: string | null;
  iteration: number;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  // Computed on list responses (latest completed run)
  scoreDelta?: number | null;
  passRateDelta?: number | null;
  rootId?: string | null;
  iterationCount?: number;
  latestResult?: {
    status: ComparisonStatus;
    completedAt: string | null;
    avgScore?: number | null;
    passRate?: number | null;
  } | null;
};

export type CreateExperimentRequest = {
  name: string;
  hypothesis?: string;
  datasetId: string;
  baselinePrompt: string;
  baselineModel: ModelId;
  candidatePrompt: string;
  candidateModel: ModelId;
  evaluatorModel?: ModelId;
  evaluatorThreshold?: number;
  evaluatorPrompt?: string;
};

export type SaveExperimentDecisionRequest = {
  decision: ExperimentDecision;
  decisionNote?: string;
};

export type ExperimentMetrics = {
  avgScore: number | null;
  passRate: number | null;
  avgLatencyMs: number | null;
  totalTokens: number | null;
  avgTokens: number | null;
  totalCostUsd: number | null;
  scoredCount: number;
  completedCount: number;
};

export type ExperimentComparison = {
  scoreDelta: number | null;
  passRateDelta: number | null;
  latencyDeltaMs: number | null;
  tokenDelta: number | null;
  costDeltaUsd: number | null;
};

export type CriterionComparison = {
  criterion: string;
  baselineScore: number | null;
  candidateScore: number | null;
  delta: number | null;
};

export type ScenarioComparison = {
  testCaseId: string;
  input: string;
  expectedOutput: string | null;
  baselineScore: number | null;
  candidateScore: number | null;
  delta: number | null;
  baselinePass: boolean | null;
  candidatePass: boolean | null;
  passChange: "improved" | "regressed" | "unchanged" | "missing";
  baselineOutput: string | null;
  candidateOutput: string | null;
  baselineJudgement?: EvaluationJudgement | null;
  candidateJudgement?: EvaluationJudgement | null;
};

export type Regression = {
  kind: "scenario" | "criterion";
  label: string;
  baselineValue: number | null;
  candidateValue: number | null;
  delta: number | null;
  testCaseId?: string;
  criterion?: string;
};

export type ExperimentRecommendation = {
  recommendation: "promote_candidate" | "keep_baseline" | "continue_experiment" | "insufficient_data";
  label: string;
  reason: string;
  evidence: string[];
  canRecommend: boolean;
};

export type ExperimentIterationSummary = {
  id: string;
  iteration: number;
  status: ExperimentStatus;
  decision: ExperimentDecision | null;
  decidedAt: string | null;
  createdAt: string;
  baselineModel: string;
  candidateModel: string;
};

export type ExperimentDetail = Experiment & {
  datasetName: string;
  testCaseCount: number;
  rootId: string | null;
  iterations: ExperimentIterationSummary[];
  comparabilityWarning: string | null;
  completion: {
    baseline: { completed: number; total: number };
    candidate: { completed: number; total: number };
    retryable: number;
  };
  metrics: {
    baseline: ExperimentMetrics;
    candidate: ExperimentMetrics;
    comparison: ExperimentComparison;
  };
  criteria: CriterionComparison[];
  scenarios: ScenarioComparison[];
  regressions: Regression[];
  recommendation: ExperimentRecommendation | null;
  latestRun: EvaluationRun | null;
};

// ---------- Metric direction semantics (reusable) ----------
export type MetricKind = "score" | "pp" | "ms" | "tokens" | "cost";
export type MetricDirection = "higher" | "lower";
export type DeltaTone = "good" | "bad" | "neutral";

/** Quality metrics are higher-is-better; operational metrics are lower-is-better. */
export const METRIC_DIRECTION: Record<MetricKind, MetricDirection> = {
  score: "higher",
  pp: "higher",
  ms: "lower",
  tokens: "lower",
  cost: "lower",
};

/** Semantic tone of a delta for a given metric kind. Zero/null is neutral. */
export function metricDeltaTone(delta: number | null, kind: MetricKind): DeltaTone {
  if (delta === null || delta === 0) return "neutral";
  const improved = METRIC_DIRECTION[kind] === "higher" ? delta > 0 : delta < 0;
  return improved ? "good" : "bad";
}

// ---------- Criterion descriptions (reusable tooltips) ----------
export const CRITERION_DESCRIPTIONS: Record<string, string> = {
  Accuracy: "Measures whether the response is factually correct and consistent with the expected answer.",
  Completeness: "Measures whether the response addresses all important requirements defined by the expected answer and evaluation criteria.",
  "Overall response quality": "Overall assessment of how well the response meets the request.",
};

/** Returns a human description for a criterion name, or null if none is known. */
export function criterionDescription(name: string): string | null {
  const direct = CRITERION_DESCRIPTIONS[name];
  if (direct) return direct;
  const match = Object.keys(CRITERION_DESCRIPTIONS).find((key) => key.toLowerCase() === name.toLowerCase());
  return match ? CRITERION_DESCRIPTIONS[match] : null;
}
