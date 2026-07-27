import OpenAI from "openai";
import { supportedModels, type ModelId } from "@prompt-playground/shared";

export type ProviderResult = {
  output: string;
  inputTokens: number;
  outputTokens: number;
};

export interface ModelProvider {
  execute(args: { model: ModelId; prompt: string; input: string }): Promise<ProviderResult>;
}

class OpenAIProvider implements ModelProvider {
  private client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
  });

  async execute({ model, prompt, input }: { model: ModelId; prompt: string; input: string }) {
    const response = await this.client.responses.create({
      model,
      instructions: prompt,
      input,
    });

    return {
      output: response.output_text,
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    };
  }
}

class LocalDevelopmentProvider implements ModelProvider {
  async execute({ model, prompt, input }: { model: ModelId; prompt: string; input: string }) {
    const output = `[Local preview · ${model}]\n\n${prompt}\n\nInput: ${input}`;
    return {
      output,
      inputTokens: estimateTokens(`${prompt}\n${input}`),
      outputTokens: estimateTokens(output),
    };
  }
}

function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.trim().length / 4));
}

export function getModelProvider(): ModelProvider {
  return process.env.OPENAI_API_KEY ? new OpenAIProvider() : new LocalDevelopmentProvider();
}

export function estimateCost(model: ModelId, inputTokens: number, outputTokens: number) {
  const pricing = supportedModels.find((candidate) => candidate.id === model);
  if (!pricing) throw new Error(`Unsupported model: ${model}`);

  return (
    (inputTokens / 1_000_000) * pricing.inputCostPerMillion +
    (outputTokens / 1_000_000) * pricing.outputCostPerMillion
  );
}

