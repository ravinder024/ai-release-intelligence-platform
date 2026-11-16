import type { ModelSelectionSnapshot } from "@prompt-playground/shared";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import type { ModelProvider } from "../provider.js";
import { runModel, type ModelOutcome } from "./execution.js";

/**
 * Lifecycle of a Prompt Playground comparison.
 *
 * A comparison is created in `running` and finished in the background so the UI can show
 * progress and offer Stop. Two guarantees matter:
 *   1. A comparison never stays `running` forever. Every failure path writes a terminal
 *      status, and `recoverStaleComparisons()` cleans up rows owned by a previous process.
 *   2. A stopped (or superseded) execution can never overwrite a newer terminal status:
 *      every run holds an epoch that the stop endpoint bumps.
 */

const CALL_TIMEOUT_MS = Number(process.env.PLAYGROUND_CALL_TIMEOUT_MS ?? 60_000);
const MAX_ATTEMPTS = Math.max(1, Number(process.env.PLAYGROUND_MAX_ATTEMPTS ?? 2));

/** Comparisons currently executing inside this process (comparisonId -> owning epoch). */
const active = new Map<string, number>();
/** Last issued epoch per comparison; a finished run keeps its value so late writes are rejected. */
const epochs = new Map<string, number>();
/** Comparisons the user asked to stop. */
const stopped = new Set<string>();

export function activeComparisonIds(): string[] {
  return [...active.keys()];
}

export function isComparisonActive(comparisonId: string): boolean {
  return active.has(comparisonId);
}

/**
 * Invalidates whatever is currently executing for this comparison (Stop, Delete).
 * The in-flight run may still write its per-variant evidence, but it can no longer
 * decide the comparison status.
 */
export function invalidateComparisonRun(comparisonId: string): void {
  epochs.set(comparisonId, (epochs.get(comparisonId) ?? 0) + 1);
  stopped.add(comparisonId);
}

export type ComparisonRunInput = {
  comparisonId: string;
  model: string;
  promptA: string;
  promptB: string;
  input: string;
  provider: ModelProvider;
  snapshot: ModelSelectionSnapshot;
};

/** Starts a comparison in the background. Never throws: failures are recorded on the row. */
export function startComparisonRun(run: ComparisonRunInput): void {
  void execute(run).catch((error) => {
    console.error("Playground comparison run failed:", error);
  });
}

async function execute({ comparisonId, model, promptA, promptB, input, provider, snapshot }: ComparisonRunInput): Promise<void> {
  const epoch = (epochs.get(comparisonId) ?? 0) + 1;
  epochs.set(comparisonId, epoch);
  active.set(comparisonId, epoch);

  let status: "completed" | "partial_failure" | "interrupted" = "partial_failure";
  try {
    const outcomes = await Promise.all([
      executeVariant(comparisonId, "A", model, promptA, input, provider, snapshot),
      executeVariant(comparisonId, "B", model, promptB, input, provider, snapshot),
    ]);
    if (stopped.has(comparisonId)) status = "interrupted";
    else if (outcomes.every((outcome) => outcome === "completed")) status = "completed";
  } catch (error) {
    // Any unexpected failure (provider construction, database write, ...) must still finish the row.
    console.error(`Playground comparison ${comparisonId} failed:`, error);
    status = "partial_failure";
  } finally {
    active.delete(comparisonId);
    stopped.delete(comparisonId);
    if ((epochs.get(comparisonId) ?? 0) === epoch) {
      await prisma.promptComparison
        .updateMany({ where: { id: comparisonId, status: "running" }, data: { status, completedAt: new Date() } })
        .catch((error) => console.error(`Could not finalise playground comparison ${comparisonId}:`, error));
    }
  }
}

async function executeVariant(
  comparisonId: string,
  variant: "A" | "B",
  model: string,
  prompt: string,
  input: string,
  provider: ModelProvider,
  snapshot: ModelSelectionSnapshot,
): Promise<"completed" | "failed" | "skipped"> {
  if (stopped.has(comparisonId)) return "skipped";

  let outcome: ModelOutcome | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const startedAt = performance.now();
    outcome = await Promise.race([
      runModel(model, prompt, input, provider, {
        inputCostPerMillion: snapshot.inputCostPerMillion,
        outputCostPerMillion: snapshot.outputCostPerMillion,
      }),
      new Promise<ModelOutcome>((resolve) =>
        setTimeout(
          () =>
            resolve({
              ok: false,
              latencyMs: Math.round(performance.now() - startedAt),
              error: `Timed out after ${Math.round(CALL_TIMEOUT_MS / 1000)}s waiting for a response from ${model}. Try again or pick another model.`,
            }),
          CALL_TIMEOUT_MS,
        ),
      ),
    ]);
    if (outcome.ok) break;
    if (stopped.has(comparisonId)) return "skipped";
  }

  const result = outcome ?? {
    ok: false as const,
    latencyMs: 0,
    error: "The provider returned no result. Try again.",
  };

  // The user may have stopped or discarded this comparison while the call was in flight.
  // Never write evidence for a run that no longer belongs to anyone.
  if (stopped.has(comparisonId)) return "skipped";

  try {
    await prisma.promptExecution.upsert({
      where: { comparisonId_variant: { comparisonId, variant } },
      create: {
        comparisonId,
        variant,
        prompt,
        output: result.ok ? result.output : null,
        latencyMs: result.latencyMs,
        inputTokens: result.ok ? result.inputTokens : null,
        outputTokens: result.ok ? result.outputTokens : null,
        totalTokens: result.ok ? result.totalTokens : null,
        estimatedCostUsd: result.ok ? result.estimatedCostUsd : null,
        status: result.ok ? "completed" : "failed",
        errorMessage: result.ok ? null : result.error,
      },
      update: {
        output: result.ok ? result.output : null,
        latencyMs: result.latencyMs,
        inputTokens: result.ok ? result.inputTokens : null,
        outputTokens: result.ok ? result.outputTokens : null,
        totalTokens: result.ok ? result.totalTokens : null,
        estimatedCostUsd: result.ok ? result.estimatedCostUsd : null,
        status: result.ok ? "completed" : "failed",
        errorMessage: result.ok ? null : result.error,
      },
    });
  } catch (error) {
    // The comparison was discarded between the stop check and this write (FK violation).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") return "skipped";
    throw error;
  }

  return result.ok ? "completed" : "failed";
}

/**
 * Marks comparisons that no process is executing any more as `interrupted`.
 * Called on boot (nothing is in flight then, so every leftover row is orphaned) and by the
 * periodic sweep, which must never touch a comparison this process is still running.
 */
export async function recoverStaleComparisons(): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  try {
    const inFlight = activeComparisonIds();
    const result = await prisma.promptComparison.updateMany({
      where: { status: "running", ...(inFlight.length > 0 ? { id: { notIn: inFlight } } : {}) },
      data: { status: "interrupted", completedAt: new Date() },
    });
    if (result.count > 0) console.log(`Marked ${result.count} stale playground comparison(s) as interrupted.`);
  } catch (error) {
    console.error("Could not recover interrupted playground comparisons:", error);
  }
}
