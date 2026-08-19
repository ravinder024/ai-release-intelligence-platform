export const supportedModels = [
  {
    id: "openai/gpt-oss-20b:free",
    label: "OpenAI: gpt-oss-20b (free)",
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
    id: "nvidia/nemotron-3-ultra-550b-a55b:free",
    label: "NVIDIA: Nemotron 3 Ultra (free)",
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
    id: "nvidia/nemotron-3-nano-30b-a3b:free",
    label: "NVIDIA: Nemotron 3 Nano 30B (free)",
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
  executions: PromptExecution[];
};

export type Dataset = {
  id: string;
  name: string;
  description: string | null;
  useCase: string | null;
  isSample?: boolean;
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
  evaluatorModel?: ModelId;
  evaluatorThreshold?: number;
  evaluatorPrompt?: string;
};

export type EvaluationRun = {
  id: string;
  datasetId: string;
  datasetName: string;
  model: ModelId;
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
  testCaseCount: number;
  resultCount: number;
};
