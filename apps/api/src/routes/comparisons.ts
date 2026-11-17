import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { authRequired } from "../auth.js";
import { type Comparison, type CreateComparisonRequest, type PlaygroundStatus } from "@prompt-playground/shared";
import { providerSnapshot, resolveLegacyModel, resolveModelSelection, resolveModelSnapshot } from "../services/modelSelection.js";
import { invalidateComparisonRun, startComparisonRun } from "../services/comparisonRuns.js";

const createComparisonSchema = z.object({
  model: z.string().trim().min(1).max(200),
  modelSelection: z.object({ modelId: z.string().min(1).max(200), provider: z.enum(["openai", "anthropic", "gemini", "deepseek", "openrouter"]), source: z.enum(["platform_free", "byok"]), connectionId: z.string().uuid().optional() }).optional(),
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
    const resolved = payload.modelSelection
      ? await resolveModelSelection(request.user!.id, payload.modelSelection)
      : await resolveLegacyModel(request.user!.id, payload.model);
    if (payload.modelSelection && payload.model !== resolved.snapshot.modelId) throw new Error("Model selection does not match its model ID.");
    const comparison = await prisma.promptComparison.create({
      data: {
        model: resolved.snapshot.modelId,
        input: payload.input,
        promptA: payload.promptA,
        promptB: payload.promptB,
        userId: request.user!.id,
        modelConfig: resolved.snapshot,
      },
    });

    // Run in the background so the page can show progress and the user can stop the run.
    startComparisonRun({
      comparisonId: comparison.id,
      model: resolved.snapshot.modelId,
      promptA: payload.promptA,
      promptB: payload.promptB,
      input: payload.input,
      provider: resolved.provider,
      snapshot: resolved.snapshot,
    });

    response.status(201).json(await findComparison(comparison.id));
  } catch (error) {
    next(error);
  }
});

comparisonsRouter.get("/comparisons", authRequired, async (request, response, next) => {
  try {
    const requestedLimit = Number(request.query.limit ?? 20);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.floor(requestedLimit), 1), 100) : 20;
    const userId = request.user!.id;
    const comparisons = await prisma.promptComparison.findMany({
      take: limit,
      orderBy: { createdAt: "desc" },
      where: { userId },
      include: { executions: { orderBy: { variant: "asc" } } },
    });
    response.json(comparisons.map(toComparison));
  } catch (error) {
    next(error);
  }
});

comparisonsRouter.get("/comparisons/:id", authRequired, async (request, response, next) => {
  try {
    const comparison = await findComparison(request.params.id);
    if (!comparison) return response.status(404).json({ error: "Comparison not found" });
    // Legacy records without an owner are not readable by anonymous callers.
    if (!comparison.userId || comparison.userId !== request.user!.id) return response.status(404).json({ error: "Comparison not found" });
    return response.json(comparison);
  } catch (error) {
    return next(error);
  }
});

/**
 * Stops a running comparison. Already-finished work is kept; the run becomes `interrupted`
 * and can be retried or discarded from the history list.
 */
comparisonsRouter.post("/comparisons/:id/stop", authRequired, async (request, response, next) => {
  try {
    const existing = await prisma.promptComparison.findFirst({
      where: { id: request.params.id, userId: request.user!.id },
      select: { id: true, status: true },
    });
    if (!existing) return response.status(404).json({ error: "Comparison not found" });
    if (existing.status !== "running") {
      return response.status(409).json({ error: "This run has already finished." });
    }
    // Safe even when this process is not the owner (e.g. the row survived a restart):
    // invalidating the epoch stops any late write, and the row is closed as interrupted.
    invalidateComparisonRun(existing.id);
    await prisma.promptComparison.updateMany({
      where: { id: existing.id, status: "running" },
      data: { status: "interrupted", completedAt: new Date() },
    });
    return response.json(await findComparison(existing.id));
  } catch (error) {
    return next(error);
  }
});

/** Discards a comparison the user no longer wants (cascades to its executions). */
comparisonsRouter.delete("/comparisons/:id", authRequired, async (request, response, next) => {
  try {
    const result = await prisma.promptComparison.deleteMany({
      where: { id: request.params.id, userId: request.user!.id },
    });
    if (result.count === 0) return response.status(404).json({ error: "Comparison not found" });
    invalidateComparisonRun(request.params.id);
    return response.status(204).send();
  } catch (error) {
    return next(error);
  }
});

/** Re-runs a comparison with the same model, input and prompts as a brand-new run. */
comparisonsRouter.post("/comparisons/:id/retry", authRequired, async (request, response, next) => {
  try {
    const existing = await prisma.promptComparison.findFirst({
      where: { id: request.params.id, userId: request.user!.id },
      include: { executions: { orderBy: { variant: "asc" } } },
    });
    if (!existing) return response.status(404).json({ error: "Comparison not found" });
    if (existing.status === "running") {
      return response.status(409).json({ error: "Stop this run before retrying it." });
    }

    const promptA = existing.promptA ?? existing.executions.find((item) => item.variant === "A")?.prompt ?? null;
    const promptB = existing.promptB ?? existing.executions.find((item) => item.variant === "B")?.prompt ?? null;
    if (!promptA || !promptB) {
      return response.status(409).json({ error: "This run has no stored prompts to retry. Start a new comparison instead." });
    }
    const snapshot = providerSnapshot(existing.modelConfig);
    if (!snapshot) {
      return response.status(409).json({ error: "This run has no stored model configuration. Start a new comparison instead." });
    }

    const provider = await resolveModelSnapshot(request.user!.id, snapshot);
    const retried = await prisma.promptComparison.create({
      data: {
        model: snapshot.modelId,
        input: existing.input,
        promptA,
        promptB,
        userId: request.user!.id,
        modelConfig: snapshot as unknown as object,
      },
    });
    startComparisonRun({
      comparisonId: retried.id,
      model: snapshot.modelId,
      promptA,
      promptB,
      input: existing.input,
      provider,
      snapshot,
    });
    return response.status(201).json(await findComparison(retried.id));
  } catch (error) {
    return next(error);
  }
});

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
  modelConfig: unknown;
  input: string;
  promptA: string | null;
  promptB: string | null;
  userId: string | null;
  status: PlaygroundStatus;
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
    model: comparison.model,
    modelConfig: providerSnapshot(comparison.modelConfig),
    input: comparison.input,
    promptA: comparison.promptA,
    promptB: comparison.promptB,
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
