import { Router } from "express";
import { supportedModels } from "@prompt-playground/shared";
import { adminRequired } from "../auth.js";
import { rateLimit } from "../rateLimit.js";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const modelsRouter = Router();

const healthReportPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../model-health.json");
const HEALTH_MAX_AGE_MS = 36 * 60 * 60 * 1000;

type HealthEntry = { status: "healthy" | "rate_limited" | "unavailable" | "check_failed"; error?: string; latencyMs?: number };

async function buildModelCatalog() {
	try {
		const report = JSON.parse(await readFile(healthReportPath, "utf8")) as {
			checkedAt?: string;
			models?: Array<{ model: string; status?: HealthEntry["status"]; ok?: boolean; error?: string; latencyMs?: number }>;
		};
		const checkedAt = report.checkedAt ? Date.parse(report.checkedAt) : NaN;
		const fresh = Number.isFinite(checkedAt) && Date.now() - checkedAt <= HEALTH_MAX_AGE_MS;
		const health = new Map((report.models ?? []).map((item) => [item.model, item]));
		return {
			checkedAt: report.checkedAt ?? null,
			stale: !fresh,
			models: supportedModels.map((model) => {
				const entry = fresh ? health.get(model.id) : undefined;
				const status = entry?.status ?? (entry?.ok ? "healthy" : "unverified");
				return { ...model, health: status, latencyMs: entry?.latencyMs ?? null, healthMessage: entry?.error ?? null };
			}),
		};
	} catch {
		return {
			checkedAt: null,
			stale: true,
			models: supportedModels.map((model) => ({ ...model, health: "unverified", latencyMs: null, healthMessage: null })),
		};
	}
}

modelsRouter.get("/models", async (_request, response, next) => {
	try {
		response.json(await buildModelCatalog());
	} catch (error) {
		next(error);
	}
});

// Return a curated list of free text models (top-weekly).
// Source: https://openrouter.ai/models?max_price=0&output_modalities=text&order=top-weekly
modelsRouter.get("/models/free", async (_request, response, next) => {
	try {
		return response.json({ source: "https://openrouter.ai/models?max_price=0&output_modalities=text&order=top-weekly", ...(await buildModelCatalog()) });
	} catch (error) {
		next(error);
	}
});

// Simple in-memory cache of the last QA run (timestamp + results)
let lastQaRun: { at: number; results: any[] } | null = null;

modelsRouter.get("/models/qa", adminRequired, (_request, response) => {
	if (!lastQaRun) return response.status(404).json({ error: "No QA results available. Run POST /models/qa/run to start a check." });
	return response.json(lastQaRun);
});

// Trigger a QA run asynchronously (requires OPENROUTER_API_KEY and network access)
modelsRouter.post("/models/qa/run", adminRequired, rateLimit({ name: "model-qa", windowMs: 60_000, max: 2 }), async (request, response) => {
	// Spawn the QA script as a background job if available; for now, return accepted and run the script inline (best-effort).
	void (async () => {
		try {
			const { runModelQa } = await import("../scripts/qaModels.js");
			const results = await runModelQa();
			lastQaRun = { at: Date.now(), results };
		} catch (err) {
			console.error("Model QA script failed:", err);
		}
	})();
	return response.status(202).json({ accepted: true });
});
