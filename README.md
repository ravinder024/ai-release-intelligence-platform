# AI-Evals Studio

AI Release Intelligence Platform is the project behind **AI-Evals Studio**, an evaluation workspace for teams deciding **whether an AI feature is ready to ship**. Compare prompt variants, run benchmark datasets, analyze failures, and make evidence-backed release decisions.

Built as a portfolio case study demonstrating AI Product Management thinking end to end (product spec → architecture → working software → docs).

## What it does

- **Home:** a public landing page that explains the product, links straight into the three workspaces (Playground, Datasets, Experiments), and credits the builder.
- **Phase 1 — Prompt comparison:** compare two prompts (A/B) on one input; see side-by-side outputs, latency, tokens, cost, and a usage-scale cost projection. Runs stream into the page while they execute and can be stopped, retried, or discarded. History is saved.
- **Phase 2 — Dataset Evaluation:** create datasets of test scenarios, run both prompts across every scenario with a live progress bar, and read the results table (output, latency, tokens, cost).
- **Phase 3 — AI Judge / Evaluation Metrics:** LLM-as-a-Judge scoring, pass rates, criterion-level performance, and regression detection.
- **Phase 4 — Experiments & Release Intelligence:** first-class Experiments (draft → baseline vs candidate → run → results → recommendation), partial-failure retry with model switching, iteration chains, comparability warnings, and a product decision (promote / keep / continue).
- **Phase 5 — Accounts, Model Providers & Failure Analysis:** username/password accounts with secure server sessions and an emergency local Admin, private workspaces, five platform-funded free evaluations for standard accounts (unlimited for Admin, configured Tester, and usernames in `FULL_ACCESS_USERNAMES`), a 30-scenario cap per dataset for standard accounts, encrypted multi-provider BYOK (OpenAI, Anthropic, Google Gemini, DeepSeek, OpenRouter) with labelled connections and dynamically discovered model catalogs, immutable provider/model configuration snapshots, and deterministic **Failure Analysis** that classifies failures, cites evidence, and turns failures into reviewable regression datasets.

> 📖 Full end-user guidance lives in the **[User Manual](docs/User%20manual.md)**.

## Architecture

Monorepo (npm workspaces):

| Package | What it is |
| --- | --- |
| `apps/api` | Express + Prisma + PostgreSQL backend (auth, models, datasets, evaluations, experiments) |
| `apps/web` | React + Vite single-page app (served by the API server on one port) |
| `packages/shared` | Shared TypeScript contracts, model list, metric semantics |

Models are called through **OpenRouter** by default (the Platform Free catalog is discovered dynamically from OpenRouter's free models). Users can additionally connect their own keys for **OpenAI, Anthropic, Google Gemini, DeepSeek, and OpenRouter**; the same model reached through two different keys stays a separate, explicitly labelled option. The API server serves both the API and the built web app on a **single port** (default `5101`).

## Getting started (local)

Requirements: Node.js 18+, PostgreSQL running locally.

1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure the database and secrets. Copy `.env.example` to `.env` and set:
   - `DATABASE_URL` (PostgreSQL URL)
   - `ENCRYPTION_KEY` and `SESSION_COOKIE_SECRET` (generate once, e.g. `openssl rand -hex 32`)
   - `OPENROUTER_API_KEY` (optional locally — with accounts, each user saves their own key in Settings)
   - `ADMIN_USERNAME` / `ADMIN_PASSWORD` — emergency Admin sign-in (created or refreshed on every server start)
   - `TESTER_USERNAME` / `TESTER_PASSWORD` — *optional* demo account for reviewers (a normal, non-admin user with its own private workspace). Also created or refreshed on every server start. Leave blank to skip.
   - `FULL_ACCESS_USERNAMES` — optional comma-separated usernames that should have unlimited Platform Free usage (Admin and the configured Tester are already unlimited).
3. Migrate and seed sample data:
   ```bash
   npm run db:migrate
   npm run db:seed
   ```
4. Build and start everything:
   ```bash
   npm run dev
   ```
   - App: http://localhost:5101
   - API health: http://localhost:5101/health

> Port note: the app always runs on `5101`. Stop other Node servers first so no other ports (e.g. `3001`, `5173`) are in use.

### Useful scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Build both apps and start the server |
| `npm run build` | Compile API + web |
| `npm run db:migrate` | Apply Prisma migrations (dev) |
| `npm run db:seed` | Create the sample datasets (Customer Support, Travel - Flights) |
| `npm run db:prune` | Wipe all user data + non-sample datasets (keeps only samples) |
| `npm test` | Unit tests (evaluator + metrics) |
| `npm run test:integration` | End-to-end experiment tests (⚠️ wipes local users + non-sample datasets) |
| `npm run verify:experiment` | Live smoke test against a running server: Stop → Resume → Restart |

## Accounts & bring-your-own-key

- **Sign up / Sign in:** username/password with httpOnly cookie sessions (bcrypt-hashed passwords).
- **Forgot password:** request a one-time reset code (shown in-app — no email service), then set a new password.
- **Model providers:** go to **Settings → API keys** to add one or more labelled API connections (OpenAI, Anthropic, Google Gemini, DeepSeek, OpenRouter). A key is validated by listing its models **and** sending a single-token test request, so a key that cannot actually run is rejected instead of silently saved. Keys are encrypted at rest (AES-256-GCM) and never returned to the client. `Platform Free` models use the platform's own key and count against the free allowance; `BYOK` runs use yours and consume no platform credits.
- **Immutable configuration:** every evaluation and experiment stores the provider, source category, connection label, and model used — never the credential — so historical results stay readable after a key is renamed or removed.
- **Private workspace:** sign-in is required for every workspace (Playground, Datasets, Experiments, and Manual). Your datasets, runs, and experiments are visible only to you. The two sample datasets are shared and read-only once signed in.

## Documentation

- [User Manual](docs/User%20manual.md) — end-user guide (also available in-app under **Manual**)
- [PRD](docs/PRD.md) — product requirements
- [Phase 4 PRD](docs/PRDs/phase4_prd.md) — Experiments / Release Intelligence requirements
- [Roadmap](docs/Roadmap.md) — phased product plan
- [Architecture](docs/Architecture.md) — technical design
- [Security migration](docs/Security%20migration.md) — credential revocation, Google setup, Admin bootstrap, quota, and free-model safeguards
- [Model health schedule](docs/Model%20health.md) — daily OpenRouter free-model checks (Windows Task Scheduler / VPS cron)
- [Implementation notes](docs/implementation/) — per-feature implementation details

## Deploying

The app runs as a single Express process serving API + SPA. A typical production setup:

- Node.js + PostgreSQL on the server, `.env` with `DATABASE_URL`, `PORT=5101`, `ENCRYPTION_KEY`, `SESSION_COOKIE_SECRET`, and a server-side `OPENROUTER_API_KEY` to enable Platform Free model discovery and health checks.
- `npm ci` → `npm run build` → `npx prisma migrate deploy` (inside `apps/api`) → `npm run db:seed`. Do not run `db:prune` on an existing installation; it deletes user data.
- Run `node apps/api/dist/server.js` under a process manager (e.g. systemd), behind nginx with TLS (e.g. Let's Encrypt).

> 📋 Full step-by-step instructions (systemd unit + nginx config + certbot): **[docs/Deployment.md](docs/Deployment.md)**

## Security notes

- Per-user provider keys are encrypted at rest; keep `ENCRYPTION_KEY` stable across restarts.
- Credentials are resolved server-side from the authenticated user plus an explicit selection. A removed connection is never silently replaced by another key.
- In production the session cookie is `httpOnly` + `Secure` (served over HTTPS).
- No analytics, no email infra, no RBAC — out of scope for this portfolio build.
