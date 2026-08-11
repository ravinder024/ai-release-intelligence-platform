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
- **Phase 3 — AI Judge / Evaluation Metrics: planned, NOT started.** Discussion of
  qualitative decision support is on hold until Phase 3 is reached.
- **Phases 4–7:** Experiment tracking, human review, analytics, release
  intelligence. Not started.

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
- Models are called through **OpenRouter**, free models only:
  `openai/gpt-oss-20b:free` and `google/gemma-4-31b-it:free`.
- Provider adapter has retry-with-backoff for rate limits and friendly errors.
- No auth, no analytics.

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
