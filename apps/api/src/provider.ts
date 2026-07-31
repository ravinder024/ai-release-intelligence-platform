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

class OpenRouterProvider implements ModelProvider {
  private client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
  });

  async execute({ model, prompt, input }: { model: ModelId; prompt: string; input: string }) {
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
  }
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
