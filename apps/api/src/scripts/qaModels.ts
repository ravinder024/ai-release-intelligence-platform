import { config as loadEnv } from "dotenv";
loadEnv();
import { getModelProvider } from "../provider.js";
import { supportedModels } from "@prompt-playground/shared";

export async function runModelQa() {
  const provider = getModelProvider();
  const results: Array<{ model: string; ok: boolean; error?: string; latencyMs?: number; snippet?: string }> = [];

  for (const m of supportedModels) {
    const start = performance.now();
    try {
      const outcome = await provider.execute({ model: m.id as any, prompt: "System: QA check", input: "Say hi." });
      const latencyMs = Math.round(performance.now() - start);
      results.push({ model: m.id, ok: true, latencyMs, snippet: (outcome.output || "").slice(0, 200) });
    } catch (error) {
      const latencyMs = Math.round(performance.now() - start);
      results.push({ model: m.id, ok: false, error: error instanceof Error ? error.message : String(error), latencyMs });
    }
  }

  return results;
}

if (process.argv[1] && process.argv[1].endsWith("qaModels.ts")) {
  (async () => {
    try {
      const res = await runModelQa();
      console.log(JSON.stringify(res, null, 2));
      process.exit(0);
    } catch (err) {
      console.error(err);
      process.exit(1);
    }
  })();
}
