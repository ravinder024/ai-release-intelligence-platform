# AGENTS.md — AI Release Intelligence Platform (ARIP)

Project memory file. Every new session in this folder should read this file first.
The owner is a **product manager** building a portfolio project; keep explanations
in plain language (functionality first, minimal technical jargon).

## What this project is

A platform that helps AI teams decide whether an AI feature is ready to ship.
Built to look like an internal product used at OpenAI / Anthropic / Cursor /
Perplexity / Glean. It is a portfolio case study demonstrating AI Product
Management thinking, not just software engineering.

## Roadmap status

- **Phase 1 — Prompt Playground: COMPLETE.** Compare two prompts (A/B) against one
  input on a chosen model; see side-by-side outputs, latency, tokens, cost, and a
  usage-scale cost projection; history is saved. Summary: `docs/phase1.md`.
- **Phase 2 — Dataset Evaluation: COMPLETE.** Create datasets of test scenarios,
  run both prompts across every scenario, watch a live progress bar, and read the
  results table (output, latency, tokens, cost). Sample "Customer Support"
  dataset (7 scenarios) seeded via `npm run db:seed`. Summary: `docs/phase2.md`.
- **Phase 3 — AI Judge / Evaluation Metrics: COMPLETE.** LLM-as-a-Judge scoring,
  pass rates, criterion-level performance, regression detection.
- **Phase 4 — Experiments & Release Intelligence: COMPLETE.** First-class
  Experiments (draft -> baseline vs candidate -> run -> results -> recommendation),
  partial-failure retry with model switching, iteration chains, comparability
  warnings, product decision. **Run controls: Stop / Resume / Restart** on the
  Experiment Detail page. Summary: `docs/PRDs/phase4_prd.md`.
- **Phase 5 — Accounts (SSO): COMPLETE.** Username/password sign up, sign in,
  forgot-password with an in-app reset code. Each user brings their own OpenRouter
  key (encrypted on their account) and gets a private workspace (own datasets,
  runs, experiments) alongside the shared read-only samples. In-app User Manual
  menu item + README. Deployed to Contabo under `ai-evals-studio.duckdns.org`.
- **Phase 5A — Model Providers: COMPLETE.** Platform Free (dynamically discovered
  from OpenRouter's free catalog, funded by the platform) plus multi-connection
  BYOK across OpenAI, Anthropic, Google Gemini, DeepSeek, and OpenRouter. Labelled
  connections (add / rename / replace / refresh / remove), per-connection model
  discovery, a shared selector that keeps the same model under different keys as
  separate entries, immutable provider/model snapshots on runs and experiments,
  and server-side quota driven by the selected source. Summary:
  `docs/implementation/model-providers.md`.
- **Phase 5B — Failure Analysis: COMPLETE.** Deterministic classification layered
  on existing judge results (quality failure vs regression vs execution error vs
  evaluator error vs missing result), failure-pattern and criterion rollups,
  evidence-backed corrective suggestions, and converting a failure into a
  reviewable regression dataset. No second evaluator. Summary:
  `docs/implementation/failure-analysis.md`.
- **Phase 5C — Home page, readability, run controls: COMPLETE.** Public landing page
  at `/` (three clickable workspace cards + About the builder); Playground moved to
  `/playground`. `apps/web/src/styles.css` is now a **single light theme driven by
  CSS tokens** (no dark surfaces, no literal colours outside `:root`). Settings is
  rebuilt around **API keys** (per-key cards, per-row state, confirm-before-remove).
  Playground runs are background + polled with **Stop / Retry / Discard** and an
  explicit `interrupted` status; orphaned runs are swept on boot and every 2 minutes.
  The legacy hidden `users.open_router_key_*` key is imported into a labelled
  `Imported key` connection and the columns are dropped.
- **Phases 6–7:** human review, analytics, deeper release intelligence. Not started.

## Phase 2 scope (agreed with the PM)

- Users create datasets (name, description, use case) containing many test
  scenarios. Each scenario: input, optional expected output, optional notes.
- Users run both prompts across the entire dataset and get a results table:
  input -> Prompt A output -> Prompt B output -> latency -> tokens -> cost.
- **Guideline:** keep datasets under 50 scenarios (MVP).
- Show a **progress bar** while an evaluation runs; scenarios run a few at a time
  (middle ground) to avoid free-model rate limits.
- **Pre-load a sample "Customer Support" dataset** (~6–8 scenarios) so the flow is
  instantly demoable.
- **Separate clean pages:** Datasets, Dataset detail, Run evaluation, Results.
  UI should be decluttered and easy to use (Linear / Vercel / Notion feel).
- **Deliberately NOT in Phase 2:** AI judging, scores, pass/fail, human review,
  dashboards, versioning, auth, team features.

## Phase 2 build stages (review after each)

1. Foundation: docs + data model design.
2. Backend engine: dataset & scenario CRUD + run evaluations.
3. Frontend screens.
4. Integration + sample data + progress bar.
5. Cleanup + `docs/phase2.md`.

## Key technical context (short version)

- Monorepo: `apps/api` (Express + Prisma + PostgreSQL), `apps/web`
  (React + Vite), `packages/shared` (shared TypeScript contracts).
- Two model sources feed one shared selector. **Platform Free** = OpenRouter models
  discovered live where prompt *and* completion price are 0, billed to the platform
  key. **BYOK** = per-user labelled `ProviderConnection` rows across OpenAI,
  Anthropic, Google Gemini, DeepSeek, OpenRouter, each with its own discovered
  catalog. Selector labels read `[Category] · [Provider] · [Key Label] · [Model]`;
  the same model under two keys stays two entries.
- Adapters live in `apps/api/src/providerRegistry.ts`; credential resolution lives in
  `apps/api/src/services/modelSelection.ts` (removed connection/model => explicit
  error, never a silent key switch). Snapshots store provider/source/label/model
  only — never credentials.
- Provider adapters have retry-with-backoff for rate limits and friendly errors.
- **Auth (Phase 5):** username/password SSO with httpOnly cookie sessions
  (bcryptjs), in-app forgot-password reset codes (no email infra), per-user
  provider keys encrypted at rest (AES-256-GCM via `ENCRYPTION_KEY`).
  Multi-tenant: samples (`userId null`) shared/read-only; all user data is private.
  `npm run db:prune` wipes user data + non-sample datasets (deploy cleanup).
  Accounts are (re)created from `.env` on every server start: `ADMIN_USERNAME` /
  `ADMIN_PASSWORD` (emergency Admin, can sign in with username or email) and the
  optional demo `TESTER_USERNAME` / `TESTER_PASSWORD` (normal non-admin user,
  allowed to use local login in production).
- **Platform Free quota:** standard users receive five completed evaluations;
  Admin and the configured Tester are unlimited. Add existing usernames to
  `FULL_ACCESS_USERNAMES` (comma-separated, case-insensitive) for additional
  unlimited accounts. BYOK runs do not consume platform credits. Only a fully
  `completed` run is consumed; failures, stops, and runs swept after a restart are
  released by `releaseOrphanedReservations()` (called from `recoverStaleRuns()`).
- **Scenario cap:** standard users may keep at most 30 scenarios per dataset and may
  not create/run experiments on datasets larger than that (`services/limits.ts`,
  shared `FREE_SCENARIO_LIMIT`, 403 `SCENARIO_LIMIT_REACHED`). Full-access accounts
  are exempt.
- **Run controls:** `POST /api/experiments/:id/stop` (cooperative cancel, keeps
  finished work), `.../resume` (continues the same run: only missing/failed/unjudged
  evaluations), `.../run` (Restart = brand-new run). `.../retry` is the older alias
  for resume. End-to-end check: `node apps/api/scripts/verify-customer-support-experiment.mjs`.
- **Dataset evaluation run controls:** `POST /api/evaluations/:id/stop`, `.../resume`
  (re-runs only missing/failed/unjudged pairs in the same run via `executeRun({jobs,upsert})`,
  reopening the existing credit with `reservePlatformCreditForRun`) and `.../restart`
  (brand-new run). The results page polls every 3s and reports answers received as well as
  answers judged.
- **One run at a time per dataset:** `POST /api/evaluations` and `.../restart` answer 409
  `RUN_IN_PROGRESS` while another run of the same dataset is still executing, and restart
  cooperatively stops the run it replaces. Repeated Restart clicks used to create a dozen
  identical runs, which is what triggered the provider rate limits and the frozen progress bars.
- **Stop/resume bookkeeping is execution-scoped:** cancellation is a "stop epoch" per run, not a
  boolean, because a stopped execution keeps judging its in-flight jobs while a resume has already
  started a newer execution for the same run. Judgements are written with `upsert` on `resultId`
  for the same reason (two executions may score the same answer). A single boolean plus
  `judgement.create` produced P2002 errors that marked healthy runs `partial_failure`.
- **Provider governor:** every outbound model *and* judge call takes a slot from one global pool
  (`services/providerLimiter.ts`, `PROVIDER_MAX_CONCURRENCY`, default 4), and judge calls are
  hard-capped (`JUDGE_TIMEOUT_MS`, default 90s) so a stalled judge can never leave a run
  `running` forever. Judges ask for `JUDGE_MAX_TOKENS` (default 4096) because reasoning models
  spend most of a small budget thinking and used to return cut-off JSON.
- **Cache headers:** `index.html` is served `no-cache` so a deploy is picked up immediately;
  hashed bundles stay cacheable.
- **Rate limiting pitfall:** routers are all mounted on `/api`, and a router-level
  `use(rateLimit(...))` runs for *every* `/api` request, so the smallest limit becomes a
  global ceiling. Limiters must be path-scoped (`auth`, `provider-connections`) or bound to
  specific routes. Evaluation GETs use a 600/min read bucket so 3s polling is never throttled.
- **Playground run controls:** `POST /api/comparisons` returns immediately and the run
  continues in `apps/api/src/services/comparisonRuns.ts` (in-process registry, execution
  epoch, `PLAYGROUND_CALL_TIMEOUT_MS` per call, default 60s). `.../stop`, `DELETE
  /api/comparisons/:id` (discard) and `.../retry` are owner-scoped. Orphaned `running`
  rows are closed as `interrupted` by `recoverStaleComparisons()` on boot and in the
  existing 2-minute sweep. `ComparisonStatus` (evaluation runs) is unchanged; comparisons
  use their own `PlaygroundStatus` enum.
- **Routes:** `/` is the public Home page; the Playground lives at `/playground` behind auth.
- The API server serves the built web app on a single port (default `5101`);
  `GET /api/manual` serves the living User Manual (`docs/User manual.md`) for the
  in-app Manual page.
- **Providers API:** `GET/POST /api/provider-connections`, `PATCH/DELETE /api/provider-connections/:id`,
  `POST /api/provider-connections/:id/refresh`, `GET /api/model-catalog`. All owner-scoped.
- **Regression cases:** `POST /api/experiments/:id/regression-cases` copies a failing scenario
  into a new dataset (`requiresReview` when the golden/rubric is missing, `sourceResultId` for
  provenance). The original dataset and history are never modified.

## How to run locally

- Requirements: Node.js, PostgreSQL running locally.
- DB + API key live in the gitignored root `.env` (see `.env.example`).
- One-time: `npm install` then `npm run db:migrate`.
- Start both servers: `npm run dev`
  - App: http://localhost:5173
  - API: http://localhost:3001 (health check: http://localhost:3001/health)

## Original context documents

- `docs/chatgpt conversation.pdf` — initial product vision + roadmap.
- `docs/codex conversation.txt` — earlier implementation history.
