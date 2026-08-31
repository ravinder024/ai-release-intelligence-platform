import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { runModel } from "../services/execution.js";
import { getUserProvider } from "../services/userProvider.js";
import { authRequired, optionalAuth } from "../auth.js";
import { supportedModels, type Comparison, type CreateComparisonRequest, type ModelId } from "@prompt-playground/shared";

const modelIds = supportedModels.map(({ id }) => id) as [ModelId, ...ModelId[]];

const createComparisonSchema = z.object({
  model: z.enum(modelIds),
  input: z.string().trim().min(1, "Input is required").max(50_000),
  promptA: z.string().trim().min(1, "Prompt A is required").max(50_000),
  promptB: z.string().trim().min(1, "Prompt B is required").max(50_000),
});

export const comparisonsRouter = Router();

comparisonsRouter.post("/comparisons", authRequired, async (request, response, next) => {
  try {
    if (!process.env.DATABASE_URL) {
      return response.status(503).json({
        error: "PostgreSQL is not configured. Set DATABASE_URL, run npm run db:migrate, and restart the API.",
      });
    }
    const payload = createComparisonSchema.parse(request.body) satisfies CreateComparisonRequest;
    const provider = await getUserProvider(request.user!.id);
    const comparison = await prisma.promptComparison.create({
      data: { model: payload.model, input: payload.input, userId: request.user!.id },
    });

    const outcomes = await Promise.all([
      executeVariant(comparison.id, "A", payload.model, payload.promptA, payload.input, provider),
      executeVariant(comparison.id, "B", payload.model, payload.promptB, payload.input, provider),
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

comparisonsRouter.get("/comparisons", optionalAuth, async (request, response, next) => {
  try {
    const requestedLimit = Number(request.query.limit ?? 20);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.floor(requestedLimit), 1), 100) : 20;
    const userId = request.user?.id ?? null;
    const comparisons = await prisma.promptComparison.findMany({
      take: limit,
      orderBy: { createdAt: "desc" },
      where: { userId: userId ?? "00000000-0000-0000-0000-000000000000" },
      include: { executions: { orderBy: { variant: "asc" } } },
    });
    response.json(comparisons.map(toComparison));
  } catch (error) {
    next(error);
  }
});

comparisonsRouter.get("/comparisons/:id", optionalAuth, async (request, response, next) => {
  try {
    const comparison = await findComparison(request.params.id);
    if (!comparison) return response.status(404).json({ error: "Comparison not found" });
    if (comparison.userId !== (request.user?.id ?? null)) return response.status(404).json({ error: "Comparison not found" });
    return response.json(comparison);
  } catch (error) {
    return next(error);
  }
});

async function executeVariant(comparisonId: string, variant: "A" | "B", model: ModelId, prompt: string, input: string, provider: import("../provider.js").ModelProvider) {
  const outcome = await runModel(model, prompt, input, provider);
  await prisma.promptExecution.create({
    data: {
      comparisonId,
      variant,
      prompt,
      output: outcome.ok ? outcome.output : null,
      latencyMs: outcome.latencyMs,
      inputTokens: outcome.ok ? outcome.inputTokens : null,
      outputTokens: outcome.ok ? outcome.outputTokens : null,
      totalTokens: outcome.ok ? outcome.totalTokens : null,
      estimatedCostUsd: outcome.ok ? outcome.estimatedCostUsd : null,
      status: outcome.ok ? "completed" : "failed",
      errorMessage: outcome.ok ? null : outcome.error,
    },
  });
  return outcome.ok ? ("completed" as const) : ("failed" as const);
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
  userId: string | null;
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
    userId: comparison.userId,
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
