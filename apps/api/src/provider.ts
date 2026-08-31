import OpenAI, { APIConnectionError, APIError, AuthenticationError, InternalServerError, NotFoundError, PermissionDeniedError, RateLimitError } from "openai";
import { supportedModels, type ModelId } from "@prompt-playground/shared";

export type ProviderResult = {
  output: string;
  inputTokens: number;
  outputTokens: number;
};

export interface ModelProvider {
  execute(args: { model: ModelId; prompt: string; input: string }): Promise<ProviderResult>;
}

const MAX_RETRIES = 3;
const RETRYABLE_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504]);
const RETRY_BASE_DELAY_MS = 800;

function isRetryable(error: unknown): boolean {
  if (error instanceof RateLimitError || error instanceof APIConnectionError || error instanceof InternalServerError) return true;
  if (error instanceof APIError) return RETRYABLE_STATUSES.has(error.status ?? 0);
  return false;
}

function backoffDelay(attempt: number): number {
  const base = RETRY_BASE_DELAY_MS * 2 ** attempt;
  const jitter = base * 0.2 * (Math.random() * 2 - 1);
  return Math.max(100, base + jitter);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function describeProviderError(error: unknown, retryCount: number): string {
  const retries = retryCount === 1 ? "1 retry" : `${retryCount} retries`;
  if (error instanceof RateLimitError) {
    return `Provider rate limit (HTTP 429) after ${retries}. Free models are shared heavily; wait a minute or switch models.`;
  }
  if (error instanceof AuthenticationError) {
    return "Provider rejected the API key (HTTP 401). Check OPENROUTER_API_KEY.";
  }
  if (error instanceof PermissionDeniedError) {
    return "Provider denied access (HTTP 403). The key may lack permission for this model.";
  }
  if (error instanceof NotFoundError) {
    return `Provider could not find the model (HTTP 404). Check the model id.`;
  }
  if (error instanceof APIConnectionError) {
    return "Could not reach the model provider. Check your internet connection and try again.";
  }
  if (error instanceof APIError) {
    return `Provider error (HTTP ${error.status ?? "unknown"}): ${error.message}`;
  }
  return error instanceof Error ? error.message : "Unknown provider error";
}

class OpenRouterProvider implements ModelProvider {
  private client: OpenAI;

  constructor(opts?: { apiKey?: string; baseURL?: string }) {
    this.client = new OpenAI({
      apiKey: opts?.apiKey ?? process.env.OPENROUTER_API_KEY,
      baseURL: (opts?.baseURL ?? process.env.OPENROUTER_BASE_URL) || "https://openrouter.ai/api/v1",
    });
  }

  async execute({ model, prompt, input }: { model: ModelId; prompt: string; input: string }) {
    let lastError: unknown;
    let retryCount = 0;

    for (let attempt = 0; ; attempt++) {
      try {
        const response = await this.client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: prompt },
            { role: "user", content: input },
          ],
        });

        return {
          output: response.choices[0]?.message.content || "No response returned.",
          inputTokens: response.usage?.prompt_tokens ?? 0,
          outputTokens: response.usage?.completion_tokens ?? 0,
        };
      } catch (error) {
        lastError = error;
        if (!isRetryable(error) || attempt >= MAX_RETRIES) break;
        retryCount = attempt + 1;
        await sleep(backoffDelay(attempt));
      }
    }

    throw new Error(describeProviderError(lastError, retryCount));
  }
}

/**
 * Creates a provider for a specific OpenRouter key (bring-your-own-key / per-user key).
 * When no key is supplied, falls back to the server's OPENROUTER_API_KEY (owner/dev use).
 */
export function createProvider(opts?: { apiKey?: string; baseURL?: string }): ModelProvider {
  return new OpenRouterProvider(opts);
}

export function getModelProvider(): ModelProvider {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is required to run model comparisons.");
  }
  return new OpenRouterProvider();
}

export function estimateCost(model: ModelId, inputTokens: number, outputTokens: number) {
  const pricing = supportedModels.find((candidate) => candidate.id === model);
  if (!pricing) throw new Error(`Unsupported model: ${model}`);

  return (
    (inputTokens / 1_000_000) * pricing.inputCostPerMillion +
    (outputTokens / 1_000_000) * pricing.outputCostPerMillion
  );
}
