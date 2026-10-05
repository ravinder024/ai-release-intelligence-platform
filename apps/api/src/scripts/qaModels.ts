import { config as loadEnv } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { mkdir, writeFile } from "node:fs/promises";

// Ensure we load the repository root .env regardless of CWD when invoked from tooling
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootEnv = path.resolve(__dirname, "..", "..", "..", "..", ".env");
loadEnv({ path: rootEnv });
import { getModelProvider } from "../provider.js";
import { supportedModels } from "@prompt-playground/shared";

const reportPath = path.resolve(__dirname, "..", "..", "model-health.json");

function classifyError(error: string): "rate_limited" | "unavailable" | "check_failed" {
  if (/429|rate limit/i.test(error)) return "rate_limited";
  if (/404|no usable chat completion/i.test(error)) return "unavailable";
  return "check_failed";
}

export async function runModelQa() {
  const provider = getModelProvider();
  const results: Array<{ model: string; ok: boolean; status: "healthy" | "rate_limited" | "unavailable" | "check_failed"; error?: string; latencyMs?: number; snippet?: string }> = [];

  for (const m of supportedModels) {
    const start = performance.now();
    try {
      const outcome = await provider.execute({ model: m.id as any, prompt: "System: QA check", input: "Say hi." });
      const latencyMs = Math.round(performance.now() - start);
      results.push({ model: m.id, ok: true, status: "healthy", latencyMs, snippet: (outcome.output || "").slice(0, 200) });
    } catch (error) {
      const latencyMs = Math.round(performance.now() - start);
      const message = error instanceof Error ? error.message : String(error);
      results.push({ model: m.id, ok: false, status: classifyError(message), error: message, latencyMs });
    }
  }

  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify({ checkedAt: new Date().toISOString(), models: results }, null, 2), "utf8");
  return results;
}

if (process.argv[1] && (process.argv[1].endsWith("qaModels.ts") || process.argv[1].endsWith("qaModels.js"))) {
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
