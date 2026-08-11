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
  createdAt: string;
  updatedAt: string;
  testCaseCount: number;
};

export type DatasetTestCase = {
  id: string;
  datasetId: string;
  input: string;
  expectedOutput: string | null;
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
  notes?: string;
  position?: number;
};

export type UpdateTestCaseRequest = Partial<CreateTestCaseRequest>;

export type DatasetDetail = Dataset & { testCases: DatasetTestCase[] };

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
};

export type EvaluationRun = {
  id: string;
  datasetId: string;
  datasetName: string;
  model: ModelId;
  promptA: string;
  promptB: string;
  status: ComparisonStatus;
  createdAt: string;
  completedAt: string | null;
  progress: { completed: number; total: number };
  testCases: DatasetTestCase[];
  results: EvaluationResult[];
};

export type RunEvaluationRequest = {
  datasetId: string;
  model: ModelId;
  promptA: string;
  promptB: string;
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
