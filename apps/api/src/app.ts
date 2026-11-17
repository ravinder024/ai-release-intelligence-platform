import cors from "cors";
import express from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { comparisonsRouter } from "./routes/comparisons.js";
import { datasetsRouter } from "./routes/datasets.js";
import { evaluationsRouter, activeRunIds } from "./routes/evaluations.js";
import { modelsRouter } from "./routes/models.js";
import { experimentsRouter } from "./routes/experiments.js";
import { authRouter } from "./routes/auth.js";
import { providersRouter } from "./routes/providers.js";
import { adminRequired, authRequired } from "./auth.js";
import { FreeEvaluationLimitError } from "./services/usage.js";
import { releaseOrphanedReservations } from "./services/usage.js";
import { ScenarioLimitError } from "./services/limits.js";
import { ModelSelectionError } from "./services/modelSelection.js";
import { recoverStaleComparisons } from "./services/comparisonRuns.js";
import { prisma } from "./prisma.js";

export const currentDirectory = dirname(fileURLToPath(import.meta.url));

/**
 * Marks interrupted (orphaned) runs as failed. Shared by startup and the periodic sweep.
 *
 * Runs still being executed by this process are never touched: a long experiment on slow/free
 * models can legitimately stay in `running` for many minutes, and marking it failed would make the
 * UI stop polling while results are still arriving. At startup nothing is in flight, so every
 * `running` row left over from a previous process is correctly cleaned up.
 */
export async function recoverStaleRuns(): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  try {
    const inFlight = activeRunIds();
    const result = await prisma.evaluationRun.updateMany({
      where: { status: "running", ...(inFlight.length > 0 ? { id: { notIn: inFlight } } : {}) },
      data: { status: "partial_failure", completedAt: new Date() },
    });
    if (result.count > 0) console.log(`Marked ${result.count} interrupted evaluation run(s) as partial_failure.`);
    // A crashed process never reaches executeRun's finally block, so its reserved credit is
    // settled here instead — failed/partial work must never consume one of the five evaluations.
    await releaseOrphanedReservations(inFlight);
  } catch (error) {
    console.error("Could not recover interrupted evaluation runs:", error);
  }
}

/**
 * Builds the full application (middleware, routes, static assets, error handling).
 * Shared by the server entrypoint and the integration tests so tests exercise the
 * same behavior as production.
 */
export function createApp() {
  const app = express();

  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "http://localhost:5101")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.use(cors({ origin: allowedOrigins, credentials: true }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_request, response) => response.json({
    status: process.env.DATABASE_URL ? "ok" : "degraded",
    database: process.env.DATABASE_URL ? "configured" : "not_configured",
  }));

  // Simple client config so the UI knows whether auth is required / how to behave.
  app.get("/api/config", (_request, response) =>
    response.json({
      authRequired: true,
      openRouterBaseUrl: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
    }),
  );

  // Serve the living User Manual so it can be rendered in-app (single source of truth).
  app.get("/api/manual", authRequired, (_request, response) => {
    const manualPath = resolve(currentDirectory, "../../../docs/User manual.md");
    try {
      if (!existsSync(manualPath)) return response.status(404).json({ error: "User manual not found" });
      response.setHeader("Content-Type", "text/markdown; charset=utf-8");
      response.send(readFileSync(manualPath, "utf8"));
    } catch (error) {
      console.error("Could not read User manual:", error);
      response.status(500).json({ error: "Could not read User manual" });
    }
  });

  app.use("/api", modelsRouter);
  app.use("/api", authRouter);
  app.use("/api", providersRouter);
  app.use("/api", comparisonsRouter);
  app.use("/api", datasetsRouter);
  app.use("/api", evaluationsRouter);
  app.use("/api", experimentsRouter);

  // Admin-only operational endpoint.
  app.post("/api/admin/reconcile-runs", adminRequired, async (_req, res) => {
    try {
      await recoverStaleRuns();
      await recoverStaleComparisons();
      return res.json({ ok: true });
    } catch (err) {
      console.error("Manual reconcile failed", err);
      return res.status(500).json({ error: "reconcile failed" });
    }
  });

  // Serve the built web app so the whole product runs on one port (default 5101)
  const webDist = resolve(currentDirectory, "../../web/dist");
  if (existsSync(webDist)) {
    // Hashed assets are immutable; index.html must always revalidate so a deploy is picked up
    // immediately instead of leaving a browser on a stale bundle (old buttons, old behaviour).
    app.use(express.static(webDist, {
      setHeaders: (response, filePath) => {
        if (filePath.endsWith(".html")) response.setHeader("Cache-Control", "no-cache, must-revalidate");
      },
    }));
    // SPA fallback: serve index.html for any non-API GET route
    app.use((request, response, next) => {
      if (request.method !== "GET" || request.path.startsWith("/api") || request.path === "/health") return next();
      response.setHeader("Cache-Control", "no-cache, must-revalidate");
      response.sendFile(resolve(webDist, "index.html"));
    });
  }

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    if (error instanceof z.ZodError) return response.status(400).json({ error: "Invalid request", details: error.flatten() });
    if (error instanceof ModelSelectionError) return response.status(400).json({ error: error.message });
    if (error instanceof FreeEvaluationLimitError) return response.status(429).json({ error: error.message, code: "FREE_EVALUATION_LIMIT_REACHED" });
    if (error instanceof ScenarioLimitError) return response.status(403).json({ error: error.message, code: "SCENARIO_LIMIT_REACHED" });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return response.status(404).json({ error: "Resource not found" });
    }
    console.error(error);
    return response.status(500).json({ error: "Unexpected server error" });
  });

  return app;
}
