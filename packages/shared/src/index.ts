export const supportedModels = [
  {
    id: "gpt-4.1-mini",
    label: "GPT-4.1 mini",
    inputCostPerMillion: 0.4,
    outputCostPerMillion: 1.6,
  },
  {
    id: "gpt-4.1",
    label: "GPT-4.1",
    inputCostPerMillion: 2,
    outputCostPerMillion: 8,
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

