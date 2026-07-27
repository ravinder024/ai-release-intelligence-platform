import "dotenv/config";
import cors from "cors";
import express from "express";
import { PrismaClient } from "@prisma/client";
import { supportedModels, type Comparison, type CreateComparisonRequest, type ModelId } from "@prompt-playground/shared";
import { z } from "zod";
import { estimateCost, getModelProvider } from "./provider.js";

const prisma = new PrismaClient();
const provider = getModelProvider();
const app = express();
const port = Number(process.env.PORT ?? 3001);

const modelIds = supportedModels.map(({ id }) => id) as [ModelId, ...ModelId[]];
const createComparisonSchema = z.object({
  model: z.enum(modelIds),
  input: z.string().trim().min(1, "Input is required").max(50_000),
  promptA: z.string().trim().min(1, "Prompt A is required").max(50_000),
  promptB: z.string().trim().min(1, "Prompt B is required").max(50_000),
});

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_request, response) => response.json({ status: "ok" }));
app.get("/api/models", (_request, response) => response.json({ models: supportedModels }));

app.post("/api/comparisons", async (request, response, next) => {
  try {
    const payload = createComparisonSchema.parse(request.body) satisfies CreateComparisonRequest;
    const comparison = await prisma.promptComparison.create({
      data: { model: payload.model, input: payload.input },
    });

    const outcomes = await Promise.all([
      executeVariant(comparison.id, "A", payload.model, payload.promptA, payload.input),
      executeVariant(comparison.id, "B", payload.model, payload.promptB, payload.input),
    ]);
    const status = outcomes.every((outcome) => outcome === "completed") ? "completed" : "partial_failure";
    await prisma.promptComparison.update({
      where: { id: comparison.id },
      data: { status, completedAt: new Date() },
    });

    response.status(201).json(await findComparison(comparison.id));
  } catch (error) {
    next(error);
  }
});

app.get("/api/comparisons", async (request, response, next) => {
  try {
    const requestedLimit = Number(request.query.limit ?? 20);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.floor(requestedLimit), 1), 100) : 20;
    const comparisons = await prisma.promptComparison.findMany({
      take: limit,
      orderBy: { createdAt: "desc" },
      include: { executions: { orderBy: { variant: "asc" } } },
    });
    response.json(comparisons.map(toComparison));
  } catch (error) {
    next(error);
  }
});

app.get("/api/comparisons/:id", async (request, response, next) => {
  try {
    const comparison = await findComparison(request.params.id);
    if (!comparison) return response.status(404).json({ error: "Comparison not found" });
    return response.json(comparison);
  } catch (error) {
    return next(error);
  }
});

async function executeVariant(comparisonId: string, variant: "A" | "B", model: ModelId, prompt: string, input: string) {
  const startedAt = performance.now();
  try {
    const result = await provider.execute({ model, prompt, input });
    const latencyMs = Math.round(performance.now() - startedAt);
    await prisma.promptExecution.create({
      data: {
        comparisonId,
        variant,
        prompt,
        output: result.output,
        latencyMs,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        totalTokens: result.inputTokens + result.outputTokens,
        estimatedCostUsd: estimateCost(model, result.inputTokens, result.outputTokens),
        status: "completed",
      },
    });
    return "completed" as const;
  } catch (error) {
    await prisma.promptExecution.create({
      data: {
        comparisonId,
        variant,
        prompt,
        latencyMs: Math.round(performance.now() - startedAt),
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Unknown provider error",
      },
    });
    return "failed" as const;
  }
}

async function findComparison(id: string): Promise<Comparison | null> {
  const comparison = await prisma.promptComparison.findUnique({
    where: { id },
    include: { executions: { orderBy: { variant: "asc" } } },
  });
  return comparison ? toComparison(comparison) : null;
}

type ComparisonWithExecutions = {
  id: string;
  model: string;
  input: string;
  status: "running" | "completed" | "partial_failure";
  createdAt: Date;
  completedAt: Date | null;
  executions: Array<{
    id: string;
    variant: string;
    prompt: string;
    output: string | null;
    latencyMs: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    estimatedCostUsd: { toString(): string } | null;
    status: "completed" | "failed";
    errorMessage: string | null;
  }>;
};

function toComparison(comparison: ComparisonWithExecutions): Comparison {
  return {
    id: comparison.id,
    model: comparison.model as ModelId,
    input: comparison.input,
    status: comparison.status,
    createdAt: comparison.createdAt.toISOString(),
    completedAt: comparison.completedAt?.toISOString() ?? null,
    executions: comparison.executions.map((execution) => ({
      id: execution.id,
      variant: execution.variant as "A" | "B",
      prompt: execution.prompt,
      output: execution.output,
      latencyMs: execution.latencyMs,
      inputTokens: execution.inputTokens,
      outputTokens: execution.outputTokens,
      totalTokens: execution.totalTokens,
      estimatedCostUsd: execution.estimatedCostUsd ? Number(execution.estimatedCostUsd) : null,
      status: execution.status,
      errorMessage: execution.errorMessage,
    })),
  } satisfies Comparison;
}

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error instanceof z.ZodError) return response.status(400).json({ error: "Invalid comparison", details: error.flatten() });
  console.error(error);
  return response.status(500).json({ error: "Unexpected server error" });
});

app.listen(port, () => console.log(`Prompt Playground API listening on http://localhost:${port}`));
