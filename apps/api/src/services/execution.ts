import { estimateCost, getModelProvider, type ModelProvider } from "../provider.js";
import type { ModelId } from "@prompt-playground/shared";

let provider: ModelProvider | null = null;

function getProvider(): ModelProvider {
  if (!provider) provider = getModelProvider();
  return provider;
}

export type ModelOutcome =
  | {
      ok: true;
      output: string;
      latencyMs: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      estimatedCostUsd: number;
    }
  | {
      ok: false;
      latencyMs: number;
      error: string;
    };

export async function runModel(model: ModelId, prompt: string, input: string, providerOverride?: ModelProvider): Promise<ModelOutcome> {
  const provider = providerOverride ?? getProvider();
  const startedAt = performance.now();
  try {
    const result = await provider.execute({ model, prompt, input });
    const latencyMs = Math.round(performance.now() - startedAt);
    return {
      ok: true,
      output: result.output,
      latencyMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      totalTokens: result.inputTokens + result.outputTokens,
      estimatedCostUsd: estimateCost(model, result.inputTokens, result.outputTokens),
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : "Unknown provider error",
    };
  }
}
