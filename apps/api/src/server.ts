import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { comparisonsRouter } from "./routes/comparisons.js";
import { datasetsRouter } from "./routes/datasets.js";
import { evaluationsRouter } from "./routes/evaluations.js";
import { modelsRouter } from "./routes/models.js";
import { prisma } from "./prisma.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(currentDirectory, "../.env") });
dotenv.config({ path: resolve(currentDirectory, "../../../.env") });

const app = express();
const port = Number(process.env.PORT ?? 3001);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_request, response) => response.json({
  status: process.env.DATABASE_URL ? "ok" : "degraded",
  database: process.env.DATABASE_URL ? "configured" : "not_configured",
}));

app.use("/api", modelsRouter);
app.use("/api", comparisonsRouter);
app.use("/api", datasetsRouter);
app.use("/api", evaluationsRouter);

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error instanceof z.ZodError) return response.status(400).json({ error: "Invalid request", details: error.flatten() });
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
    return response.status(404).json({ error: "Resource not found" });
  }
  console.error(error);
  return response.status(500).json({ error: "Unexpected server error" });
});

app.listen(port, () => {
  console.log(`Prompt Playground API listening on http://localhost:${port}`);
  void recoverStaleRuns();
});

async function recoverStaleRuns() {
  if (!process.env.DATABASE_URL) return;
  try {
    const result = await prisma.evaluationRun.updateMany({
      where: { status: "running" },
      data: { status: "partial_failure", completedAt: new Date() },
    });
    if (result.count > 0) console.log(`Marked ${result.count} interrupted evaluation run(s) as partial_failure.`);
  } catch (error) {
    console.error("Could not recover interrupted evaluation runs:", error);
  }
}
