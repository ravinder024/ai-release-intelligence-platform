# AI Release Intelligence Platform

An AI evaluation workspace for teams deciding **whether an AI feature is ready to ship**. Compare prompt variants, run benchmark datasets, run experiments (baseline vs candidate), and get a recommendation — from Prompt Playground to Release Intelligence.

Built as a portfolio case study demonstrating AI Product Management thinking end to end (product spec → architecture → working software → docs).

## What it does

- **Phase 1 — Prompt Playground:** compare two prompts (A/B) on one input; see side-by-side outputs, latency, tokens, cost, and a usage-scale cost projection. History is saved.
- **Phase 2 — Dataset Evaluation:** create datasets of test scenarios, run both prompts across every scenario with a live progress bar, and read the results table (output, latency, tokens, cost).
- **Phase 3 — AI Judge / Evaluation Metrics:** LLM-as-a-Judge scoring, pass rates, criterion-level performance, and regression detection.
- **Phase 4 — Experiments & Release Intelligence:** first-class Experiments (draft → baseline vs candidate → run → results → recommendation), partial-failure retry with model switching, iteration chains, comparability warnings, and a product decision (promote / keep / continue).
- **Phase 5 — Accounts (SSO):** sign up / sign in / forgot-password with an in-app reset code. Each user brings their **own OpenRouter key** (stored encrypted on their account) and gets a **private workspace** — their own datasets, runs, and experiments — alongside the shared sample datasets.

> 📖 Full end-user guidance lives in the **[User Manual](docs/User%20manual.md)**.

## Architecture

Monorepo (npm workspaces):

| Package | What it is |
| --- | --- |
| `apps/api` | Express + Prisma + PostgreSQL backend (auth, models, datasets, evaluations, experiments) |
| `apps/web` | React + Vite single-page app (served by the API server on one port) |
| `packages/shared` | Shared TypeScript contracts, model list, metric semantics |

Models are called through **OpenRouter** (free models by default). The API server serves both the API and the built web app on a **single port** (default `5101`).

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
| `npm run test:integration` | End-to-end experiment tests |

## Accounts & bring-your-own-key

- **Sign up / Sign in:** username/password with httpOnly cookie sessions (bcrypt-hashed passwords).
- **Forgot password:** request a one-time reset code (shown in-app — no email service), then set a new password.
- **Your OpenRouter key:** save it in **Settings**. It is encrypted at rest (AES-256-GCM) and only ever used to make model calls for your account. The host's key is never used by visitors.
- **Private workspace:** your datasets, runs, and experiments are visible only to you. The two sample datasets are shared and read-only.

## Documentation

- [User Manual](docs/User%20manual.md) — end-user guide (also available in-app under **Manual**)
- [PRD](docs/PRD.md) — product requirements
- [Phase 4 PRD](docs/PRDs/phase4_prd.md) — Experiments / Release Intelligence requirements
- [Roadmap](docs/Roadmap.md) — phased product plan
- [Architecture](docs/Architecture.md) — technical design
- [Implementation notes](docs/implementation/) — per-feature implementation details

## Deploying

The app runs as a single Express process serving API + SPA. A typical production setup:

- Node.js + PostgreSQL on the server, `.env` with `DATABASE_URL`, `PORT=5101`, `ENCRYPTION_KEY`, `SESSION_COOKIE_SECRET` (`OPENROUTER_API_KEY` empty).
- `npm ci` → `npm run build` → `npx prisma migrate deploy` (inside `apps/api`) → `npm run db:seed` → `npm run db:prune`.
- Run `node apps/api/dist/server.js` under a process manager (e.g. systemd), behind nginx with TLS (e.g. Let's Encrypt).

> 📋 Full step-by-step instructions (systemd unit + nginx config + certbot): **[docs/Deployment.md](docs/Deployment.md)**

## Security notes

- Per-user OpenRouter keys are encrypted at rest; keep `ENCRYPTION_KEY` stable across restarts.
- In production the session cookie is `httpOnly` + `Secure` (served over HTTPS).
- No analytics, no email infra, no RBAC — out of scope for this portfolio build.
