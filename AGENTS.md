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
  warnings, product decision. Summary: `docs/PRDs/phase4_prd.md`.
- **Phase 5 — Accounts (SSO): COMPLETE.** Username/password sign up, sign in,
  forgot-password with an in-app reset code. Each user brings their own OpenRouter
  key (encrypted on their account) and gets a private workspace (own datasets,
  runs, experiments) alongside the shared read-only samples. In-app User Manual
  menu item + README. Deployed to Contabo under `ai-evals-studio.duckdns.org`.
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
- Models are called through **OpenRouter**, free models only (the list lives in `packages/shared/src/index.ts`; a healthy model is the default).
- Provider adapter has retry-with-backoff for rate limits and friendly errors.
- **Auth (Phase 5):** username/password SSO with httpOnly cookie sessions
  (bcryptjs), in-app forgot-password reset codes (no email infra), per-user
  OpenRouter keys encrypted at rest (AES-256-GCM via `ENCRYPTION_KEY`).
  Multi-tenant: samples (`userId null`) shared/read-only; all user data is private.
  `npm run db:prune` wipes user data + non-sample datasets (deploy cleanup).
- The API server serves the built web app on a single port (default `5101`);
  `GET /api/manual` serves the living User Manual (`docs/User manual.md`) for the
  in-app Manual page.

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
