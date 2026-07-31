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
