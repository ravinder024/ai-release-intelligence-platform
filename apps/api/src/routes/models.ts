import { Router } from "express";
import { supportedModels } from "@prompt-playground/shared";

export const modelsRouter = Router();

modelsRouter.get("/models", (_request, response) => response.json({ models: supportedModels }));

// Return a curated list of free text models (top-weekly).
// Source: https://openrouter.ai/models?max_price=0&output_modalities=text&order=top-weekly
modelsRouter.get("/models/free", (_request, response) => {
	return response.json({ source: "https://openrouter.ai/models?max_price=0&output_modalities=text&order=top-weekly", models: supportedModels });
});

// Simple in-memory cache of the last QA run (timestamp + results)
let lastQaRun: { at: number; results: any[] } | null = null;

modelsRouter.get("/models/qa", (_request, response) => {
	if (!lastQaRun) return response.status(404).json({ error: "No QA results available. Run POST /models/qa/run to start a check." });
	return response.json(lastQaRun);
});

// Trigger a QA run asynchronously (requires OPENROUTER_API_KEY and network access)
modelsRouter.post("/models/qa/run", async (request, response) => {
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
