import type { ApiProvider } from "@prisma/client";
import type { ModelProvider, ProviderResult } from "./provider.js";

export type ProviderModel = {
  id: string;
  name: string;
  inputCostPerMillion: number | null;
  outputCostPerMillion: number | null;
  contextLength: number | null;
};

const endpoints: Record<ApiProvider, { label: string; baseUrl: string }> = {
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  anthropic: { label: "Anthropic", baseUrl: "https://api.anthropic.com/v1" },
  gemini: { label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
  openrouter: { label: "OpenRouter", baseUrl: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1" },
};

const excludedModelTerms = /embedding|moderation|whisper|tts|text-to-speech|image|audio|realtime|transcri|dall-e|search-preview/i;

function safeProviderError(error: unknown, apiKey: string): Error {
  const message = error instanceof Error ? error.message : "Provider request failed";
  return new Error(message.split(apiKey).join("[redacted]").slice(0, 1000));
}

const RETRYABLE_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 800;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function backoffDelay(attempt: number): number {
  const base = RETRY_BASE_DELAY_MS * 2 ** attempt;
  const jitter = base * 0.2 * (Math.random() * 2 - 1);
  return Math.max(100, base + jitter);
}

/**
 * POST JSON with retry-with-backoff for rate limits, upstream 5xx, and network
 * errors. Free models are shared heavily, so transient failures are expected.
 */
async function postJson(url: string, makeInit: () => RequestInit): Promise<{ status: number; data: any }> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, makeInit());
      const data = await response.json().catch(() => null);
      if (!response.ok && RETRYABLE_STATUSES.has(response.status) && attempt < MAX_RETRIES) {
        await sleep(backoffDelay(attempt));
        continue;
      }
      return { status: response.status, data };
    } catch (error) {
      lastError = error;
      if (attempt >= MAX_RETRIES) break;
      await sleep(backoffDelay(attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Provider request failed");
}

async function readJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof data?.error?.message === "string" ? data.error.message : typeof data?.message === "string" ? data.message : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}

function bearer(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` };
}

function pricePerMillion(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed * 1_000_000 : null;
}

function isChatModel(id: string, entry: any): boolean {
  if (excludedModelTerms.test(id)) return false;
  const output = entry?.architecture?.output_modalities;
  const input = entry?.architecture?.input_modalities;
  if (Array.isArray(output) && !output.includes("text")) return false;
  if (Array.isArray(input) && !input.includes("text")) return false;
  return true;
}

function normalizeModel(entry: any, provider: ApiProvider): ProviderModel | null {
  const id = String(entry?.id ?? entry?.name ?? "").replace(/^models\//, "");
  if (!id || excludedModelTerms.test(id)) return null;
  const context = Number(entry?.context_length ?? entry?.contextWindow ?? entry?.inputTokenLimit);
  const promptPrice = pricePerMillion(entry?.pricing?.prompt ?? entry?.input_price_per_token ?? entry?.inputPrice);
  const completionPrice = pricePerMillion(entry?.pricing?.completion ?? entry?.output_price_per_token ?? entry?.outputPrice);
  const rawName = entry?.name ?? entry?.display_name ?? entry?.displayName ?? id;
  return {
    id,
    name: String(rawName),
    inputCostPerMillion: provider === "openrouter" && entry?.pricing ? promptPrice : promptPrice,
    outputCostPerMillion: provider === "openrouter" && entry?.pricing ? completionPrice : completionPrice,
    contextLength: Number.isFinite(context) && context > 0 ? context : null,
  };
}

export async function discoverProviderModels(provider: ApiProvider, apiKey: string): Promise<ProviderModel[]> {
  const endpoint = endpoints[provider];
  try {
    let raw: any[];
    if (provider === "anthropic") {
      const data = await readJson(`${endpoint.baseUrl}/models`, {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      });
      raw = Array.isArray(data?.data) ? data.data : [];
    } else if (provider === "gemini") {
      const data = await readJson("https://generativelanguage.googleapis.com/v1beta/models", { "x-goog-api-key": apiKey });
      raw = Array.isArray(data?.models)
        ? data.models.filter((model: any) => model.supportedGenerationMethods?.includes("generateContent"))
        : [];
    } else {
      const data = await readJson(`${endpoint.baseUrl.replace(/\/$/, "")}/models`, bearer(apiKey));
      raw = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
    }

    return raw
      .filter((entry) => isChatModel(String(entry?.id ?? entry?.name ?? ""), entry))
      .map((entry) => normalizeModel(entry, provider))
      .filter((model): model is ProviderModel => Boolean(model))
      .sort((left, right) => left.name.localeCompare(right.name));
  } catch (error) {
    throw safeProviderError(error, apiKey);
  }
}

export async function discoverPlatformFreeModels(apiKey = process.env.OPENROUTER_API_KEY): Promise<ProviderModel[]> {
  if (!apiKey) return [];
  const endpoint = endpoints.openrouter;
  let data: any;
  try {
    data = await readJson(`${endpoint.baseUrl.replace(/\/$/, "")}/models`, bearer(apiKey));
  } catch (error) {
    throw safeProviderError(error, apiKey);
  }
  const entries = Array.isArray(data?.data) ? data.data : [];
  return entries
    .filter((entry: any) => entry?.pricing && Number(entry.pricing.prompt) === 0 && Number(entry.pricing.completion) === 0 && isChatModel(String(entry.id ?? ""), entry))
    .map((entry: any) => normalizeModel(entry, "openrouter"))
    .filter((model: ProviderModel | null): model is ProviderModel => Boolean(model))
    .sort((left: ProviderModel, right: ProviderModel) => left.name.localeCompare(right.name));
}

export class ApiKeyModelProvider implements ModelProvider {
  constructor(private readonly provider: ApiProvider, private readonly apiKey: string) {}

  async execute({ model, prompt, input }: { model: string; prompt: string; input: string }): Promise<ProviderResult> {
    const describe = (status: number, data: any): string => {
      const detail = typeof data?.error?.message === "string"
        ? data.error.message
        : typeof data?.message === "string" ? data.message : "no detail returned";
      const hint = status === 429 ? " (rate limited; wait a minute or switch models)" : status >= 500 ? " (provider temporarily unavailable)" : "";
      return `Provider error (HTTP ${status}) for ${model}${hint}: ${detail}`;
    };
    if (this.provider === "anthropic") {
      try {
        const { status, data } = await postJson(`${endpoints.anthropic.baseUrl}/messages`, () => ({
          method: "POST",
          headers: { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model, max_tokens: 2048, system: prompt, messages: [{ role: "user", content: input }] }),
          signal: AbortSignal.timeout(60_000),
        }));
        if (status < 200 || status >= 300) throw new Error(describe(status, data));
        const output = Array.isArray(data?.content) ? data.content.filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n") : "";
        if (!output.trim()) throw new Error(`Provider returned no usable message for ${model}.`);
        return { output, inputTokens: Number(data?.usage?.input_tokens ?? 0), outputTokens: Number(data?.usage?.output_tokens ?? 0) };
      } catch (error) {
        throw safeProviderError(error, this.apiKey);
      }
    }
    try {
      const baseUrl = endpoints[this.provider].baseUrl.replace(/\/$/, "");
      const { status, data } = await postJson(`${baseUrl}/chat/completions`, () => ({
        method: "POST",
        headers: { ...bearer(this.apiKey), "content-type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "system", content: prompt }, { role: "user", content: input }], max_tokens: 2048 }),
        signal: AbortSignal.timeout(60_000),
      }));
      if (status < 200 || status >= 300) throw new Error(describe(status, data));
      const output = data?.choices?.[0]?.message?.content;
      if (typeof output !== "string" || !output.trim()) throw new Error(`Provider returned no usable chat completion for ${model}.`);
      return {
        output,
        inputTokens: Number(data?.usage?.prompt_tokens ?? data?.usage?.input_tokens ?? 0),
        outputTokens: Number(data?.usage?.completion_tokens ?? data?.usage?.output_tokens ?? 0),
      };
    } catch (error) {
      throw safeProviderError(error, this.apiKey);
    }
  }
}

export function createApiKeyProvider(provider: ApiProvider, apiKey: string): ModelProvider {
  return new ApiKeyModelProvider(provider, apiKey);
}

/**
 * One-token inference probe.
 *
 * Listing models is not proof that a key works: several providers (OpenRouter included)
 * serve their public catalog to genuinely invalid credentials. Sending a single-token
 * completion is the only way to confirm the key can actually execute a request.
 *
 * The probe is deliberately forgiving about anything that is not an authentication
 * failure: rate limits, provider outages, and "no credit" responses prove the key was
 * accepted, so they must not block saving it.
 */
async function probeInference(provider: ApiProvider, apiKey: string, models: ProviderModel[]): Promise<void> {
  if ((process.env.KEY_VALIDATION_PROBE ?? "true").toLowerCase() === "false") return;
  const candidates = [...models]
    .sort((left, right) => (left.outputCostPerMillion ?? Number.MAX_SAFE_INTEGER) - (right.outputCostPerMillion ?? Number.MAX_SAFE_INTEGER))
    .slice(0, 2);
  if (!candidates.length) return;

  let lastAuthError: string | null = null;
  for (const candidate of candidates) {
    const result = await runProbe(provider, apiKey, candidate.id);
    if (result === "authenticated") return;
    lastAuthError = result.message;
  }
  throw new Error(
    lastAuthError ??
      "The provider rejected this API key. Check that the key is active and has access to this provider.",
  );
}

async function runProbe(provider: ApiProvider, apiKey: string, model: string): Promise<"authenticated" | { message: string }> {
  const baseUrl = endpoints[provider].baseUrl.replace(/\/$/, "");
  const anthropic = provider === "anthropic";
  const url = anthropic ? `${baseUrl}/messages` : `${baseUrl}/chat/completions`;
  const headers: Record<string, string> = anthropic
    ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" }
    : { ...bearer(apiKey), "content-type": "application/json" };
  const body = anthropic
    ? { model, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }
    : { model, max_tokens: 1, messages: [{ role: "user", content: "ping" }] };

  let response: Response;
  try {
    response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  } catch {
    // Network failure says nothing about the key: let the save continue.
    return "authenticated";
  }

  if (response.ok) return "authenticated";

  const data = await response.json().catch(() => null);
  const detail = typeof data?.error?.message === "string"
    ? data.error.message
    : typeof data?.message === "string" ? data.message : "no detail returned";

  if (response.status === 401 || response.status === 403) {
    return {
      message: `The provider rejected this API key (HTTP ${response.status}): ${detail.slice(0, 200)}`,
    };
  }
  // Every other status means the credential was understood: quota, rate limits, and
  // provider incidents are run-time problems, not key problems.
  return "authenticated";
}

export async function validateProviderKey(provider: ApiProvider, apiKey: string): Promise<ProviderModel[]> {
  const models = await discoverProviderModels(provider, apiKey);
  if (!models.length) throw new Error("No supported text-generation models were returned for this key.");
  // Confirm the key can actually run a request before it is stored.
  await probeInference(provider, apiKey, models);
  return models;
}
