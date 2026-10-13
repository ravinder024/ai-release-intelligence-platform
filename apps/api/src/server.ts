import dotenv from "dotenv";
import { resolve } from "node:path";
import { bootstrapAdmin } from "./adminBootstrap.js";
import { bootstrapTester } from "./testerBootstrap.js";
import { createApp, currentDirectory, recoverStaleRuns } from "./app.js";

dotenv.config({ path: resolve(currentDirectory, "../.env") });
dotenv.config({ path: resolve(currentDirectory, "../../../.env") });

const port = Number(process.env.PORT ?? 5101);

function validateProductionConfig(): void {
  if (process.env.NODE_ENV !== "production") return;
  const required = [
    "DATABASE_URL",
    "ENCRYPTION_KEY",
    "SESSION_COOKIE_SECRET",
    "ADMIN_USERNAME",
    "ADMIN_PASSWORD",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_CALLBACK_URL",
    "ALLOWED_ORIGINS",
  ];
  const missing = required.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) throw new Error(`Missing required production configuration: ${missing.join(", ")}`);
  // OPENROUTER_API_KEY is intentionally optional: the public deployment is bring-your-own-key.
  // Without it, users must save their own key in Settings; only the platform-funded credit
  // allowance is unavailable.
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    console.warn("OPENROUTER_API_KEY is empty — bring-your-own-key mode: users must add their own key in Settings.");
  }
}

validateProductionConfig();
await bootstrapAdmin();
await bootstrapTester();

const app = createApp();

app.listen(port, () => {
  console.log(`Prompt Playground API listening on http://localhost:${port}`);
  void recoverStaleRuns();
  // Periodically reconcile runs that may be stuck (every 2 minutes)
  setInterval(() => { void recoverStaleRuns(); }, 2 * 60 * 1000);
});
