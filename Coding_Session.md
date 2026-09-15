# AI Release Intelligence Platform — Coding Session Log

A structured record of the end-to-end agentic coding session that built, refined, and shipped the **AI Release Intelligence Platform** (ARIP). Written as a portfolio artifact documenting *how* the product was built, not just what it does.

- **Product:** AI evaluation workspace for deciding whether an AI feature is ready to ship
- **Role context:** product manager + agent pair-building a portfolio case study
- **Stack:** TypeScript monorepo — `apps/api` (Express + Prisma + PostgreSQL), `apps/web` (React + Vite), `packages/shared`
- **Model provider:** OpenRouter (free models)
- **Repository:** `github.com/ravinder024/ai-release-intelligence-platform` (branch `master`)

---

## 1. Session overview

The session delivered five product phases plus a production-hardening pass and a deployment plan. Work proceeded as *define → implement → test → verify → document* for each phase, with the agent acting as a hands-on build partner while the owner (a PM) made product decisions.

**What was accomplished in one continuous effort:**

1. **Phase 1 — Prompt Playground:** A/B prompt comparison on a single input.
2. **Phase 2 — Dataset Evaluation:** benchmark datasets + running both prompts across every scenario.
3. **Phase 3 — AI Judge / Metrics:** LLM-as-a-Judge scoring, pass rates, criterion performance, regressions.
4. **Phase 4 — Experiments & Release Intelligence:** first-class experiments, partial-failure retry, iteration chains, comparability warnings, product recommendation + decision.
5. **Phase 4 refinement pass:** 10 product issues → retry UX, evaluator config, metric semantics/colors, tooltips, recommendation panel, iterations/versioning, snapshots.
6. **Bug-fix / reliability pass:** single-port consolidation, honest progress reporting, retry-with-model-switch, dead-model cleanup (this is what made live runs actually work).
7. **Phase 5 — Accounts (SSO):** username/password auth, per-user encrypted OpenRouter keys, private workspaces, in-app User Manual, README, GitHub push, Contabo deployment runbook.

---

## 2. Phase 1 — Prompt Playground (complete)

**Goal:** Let a user compare two prompt variants (A and B) against one shared input on a chosen model and see which is better — with evidence.

**Delivered**

- Playground UI: model selector, shared input, Prompt A / Prompt B editors, Run button.
- Side-by-side outputs with **latency**, **token usage**, and **estimated cost**.
- **Usage-scale cost projection** (query volume × period → projected spend), with free models shown as "Free".
- **History** — saved comparisons retrievable in a Recent Runs list.

**Key files**

- `apps/web/src/pages/PlaygroundPage.tsx`
- `apps/api/src/routes/comparisons.ts`
- `packages/shared/src/index.ts` (model list + DTOs)

---

## 3. Phase 2 — Dataset Evaluation (complete)

**Goal:** Create repeatable benchmark datasets and run both prompts across every scenario, instead of one-off comparisons.

**Delivered**

- **Datasets**: name, description, use case; each holds many **scenarios** (input, optional expected output, optional notes).
- Separate clean pages: **Datasets**, **Dataset detail**, **Run evaluation**, **Results** — a Linear/Vercel/Notion-style decluttered UI.
- **Run both prompts** (Prompt A vs Prompt B) over every scenario.
- **Live progress bar** while an evaluation runs (middle-ground concurrency to respect free-model rate limits).
- **Results table**: input → Prompt A output → Prompt B output → latency → tokens → cost.
- **Sample "Customer Support" dataset** (~7 scenarios) seeded for instant demoing.
- Deliberately out of scope (per PM): judging/scores, auth, dashboards, versioning.

**Key files**

- `apps/api/src/routes/datasets.ts`, `apps/api/src/routes/evaluations.ts`
- `apps/web/src/pages/DatasetsPage.tsx`, `DatasetDetailPage.tsx`, `RunEvaluationPage.tsx`, `EvaluationResultsPage.tsx`
- `apps/api/prisma/seed.mjs`

---

## 4. Phase 3 — AI Judge / Evaluation Metrics (complete)

**Goal:** Move from "read the outputs yourself" to automated quality measurement.

**Delivered**

- **LLM-as-a-Judge**: a judge model scores each candidate response against the input + expected output.
- Judge returns `overallScore`, `pass`, `summary`, and per-criterion results.
- Aggregated metrics per variant: **avg score**, **pass rate**, **avg latency**, **token counts**, **cost**.
- **Criterion-level performance** and **scenario-level comparison**.
- **Regression detection** across criteria and scenarios.

**Key files**

- `apps/api/src/services/evaluator.ts`, `apps/api/src/services/metrics.ts`
- `apps/api/src/services/execution.ts` (provider calls + retry/backoff)

---

## 5. Phase 4 — Experiments & Release Intelligence (complete)

**Goal:** Answer *"Did my AI change actually improve the product?"* — not just compare, but decide.

**Delivered**

- **First-class Experiments**: `draft → baseline vs candidate → run → results → recommendation`.
- Experiment stores a **frozen configuration snapshot** (baseline/candidate prompts + models, evaluator config).
- Experiment run reuses the Phase-3 engine (variant A = baseline, variant B = candidate).
- **Product recommendation** with reasoning (deterministic rules).
- **Product decision** recorded by the user (promote / keep / continue) — never auto-changed.
- **Integration test suite** proving the full experiment lifecycle.

**Key files**

- `apps/api/prisma/schema.prisma` → `Experiment` model
- `apps/api/src/routes/experiments.ts`
- `apps/web/src/pages/ExperimentsPage.tsx`, `ExperimentDetailPage.tsx`, `NewExperimentPage.tsx`

---

## 6. Phase 4 refinement pass (10 product issues)

The PM supplied a refinement PRD (treating Phase 4 as shipped, no rewrites, don't break Phases 1–3) covering ten issues. Each was implemented and verified.

### 6.1 Partial-failure retry
- `executeRun` gained `jobs?` (retry only specific testCase+variant) and `upsert?` (replace only failed results).
- New `POST /experiments/:id/retry` retries **only execution/evaluator failures**; a successfully judged *low score* is **not** retryable.
- Experiment detail exposes `completion { baseline/candidate completed/total, retryable }`.

### 6.2 Evaluator configuration
- Wizard shows explicit **EVALUATION CONFIGURATION** section (human vs LLM judge, model, threshold) separate from **TARGET CONFIGURATION**.
- Detail page shows a distinct EVALUATOR section.

### 6.3 Metric semantics & colors
- Shared `METRIC_DIRECTION` / `metricDeltaTone`: quality higher-better; latency/tokens/cost lower-better.
- Result summary rows color by direction (score/pass-rate red on decline; latency/cost green when lower; tokens neutral).
- **Fixed a cost-delta sign bug** (was `$0.0400`, now `-$0.0400`).

### 6.4 Criterion tooltips
- Shared `CRITERION_DESCRIPTIONS` + `CriterionName` component showing an ⓘ tooltip per criterion.

### 6.5 Recommendation
- Deterministic `recommendExperiment()` in `metrics.ts`: `insufficient_data` when incomplete; `promote` / `keep_baseline` / `continue_experiment` from score/pass deltas + regressions.
- RECOMMENDATION panel with evidence; never mutates the user's decision.

### 6.6 Iterations / versioning
- Schema: `Experiment.iteration` (default 1) + `parentId` self-relation ("ExperimentTree").
- `POST /experiments/:id/iterations` creates the next iteration (baseline = previous candidate).
- Detail page shows iteration badge, history chips, and version labels; the list groups experiment trees and shows iteration count.

### 6.7 Comparability warning
- Detail compares current iteration's evaluator/dataset vs the previous → warning when changed ("results may not be directly comparable").

### 6.8 Status / drafts
- Fixed the evaluation-status panel so drafts show **"Not started"** instead of a misleading complete state.

### 6.9 Incomplete data
- Progress counts only successfully evaluated results — no more false 100% on partial failure.

### 6.10 Reproducibility snapshots
- `EvaluationResult` stores `inputSnapshot` / `expectedOutputSnapshot` / `criteriaSnapshot` so historical results survive dataset edits.

**Tests:** metrics suite grew to 30 unit tests (incl. metric-direction + recommendation groups); experiments integration suite to 44 tests (retry, evaluator, recommendation, iterations, comparability, snapshots). All passing.

---

## 7. Reliability & bug-fix pass

A QA pass surfaced real, demo-breaking problems. Root causes were found with live model health checks.

### 7.1 "I can't run a single test under experiments" — root cause
- The **default model `openai/gpt-oss-20b:free` returned HTTP 404 on OpenRouter** (removed from the catalog), so every experiment run failed instantly.
- `nvidia/nemotron-3-nano-30b-a3b:free` was also dead (404); several others were rate-limited (429).
- **Fix:** pruned `supportedModels` in `packages/shared/src/index.ts`, removed dead models, made a QA-confirmed healthy model first (default). Cleaned up all references in the Playground, tests, and docs.

### 7.2 Progress bar showed 100% even on failed runs
- `findRun` counted all result rows as "completed".
- **Fix:** progress counts only results that are `completed` *and* (if judged) whose judgement is `completed`. Partial-failure runs now honestly show e.g. `5/7 baseline · 7/7 candidate · 2 retryable`.

### 7.3 Retry must let you switch LLMs for success
- Added **model overrides** to the retry endpoint (`baselineModel`/`candidateModel`/`evaluatorModel`).
- Verified live: a run that failed 14/14 on the dead model → retried on a healthy model → completed 7/7 + 7/7 with a real recommendation.

### 7.4 UI polish
- Prompt textareas given ample space (`rows={9}`, ~176px × 733px), judge settings moved to a two-column grid, retry panel shows model selectors, dark theme preserved throughout.

---

## 8. Phase 5 — Accounts (SSO), per-user keys, private workspaces (complete)

**Product decision (with the PM):** add simple username/password accounts so each user gets a **personalized, private** experience; samples stay shared/read-only; each user brings their **own OpenRouter key** so the host's key is never used by visitors.

### 8.1 Decisions locked in
| Topic | Decision |
| --- | --- |
| Auth | Username/password + httpOnly cookie sessions (bcryptjs hashing, DB-backed tokens) — no JWT library |
| Forgot password | In-app one-time reset code returned in the response (no email infrastructure), 30-min expiry, single use |
| User's OpenRouter key | Stored per-account, **encrypted at rest** (AES-256-GCM), validated on save, only used for that user's calls |
| Data model | Samples (`userId null`) shared/read-only; all user-created data private to its owner |
| Anonymous access | Can browse samples + Manual; must sign in to create/edit/run |

### 8.2 Backend delivered
- **Schema** (`prisma/schema.prisma`, migration `20260831041308_phase5_auth`): `User`, `Session`, `PasswordResetToken`, plus nullable `userId` FKs on `PromptComparison`, `Dataset`, `EvaluationRun`, `Experiment`.
- **`apps/api/src/auth.ts`**: session token helpers, cookie parsing (manual — avoided a `cookie-parser`/@types/express v5 typing conflict), `authRequired` + `optionalAuth` middleware.
- **`apps/api/src/routes/auth.ts`**: `signup`, `login`, `logout`, `me`, `forgot-password`, `reset-password`, `change-password`, `PUT/DELETE /auth/key`, `POST /keys/validate`.
- **`apps/api/src/crypto.ts`**: AES-256-GCM encrypt/decrypt keyed by `ENCRYPTION_KEY`.
- **`apps/api/src/provider.ts`**: `createProvider({ apiKey, baseURL })` factory (kept `getModelProvider` for local/owner fallback).
- **`apps/api/src/services/userProvider.ts`**: decrypts the user's stored key into a per-request provider.
- **Ownership scoping** in datasets / comparisons / evaluations / experiments: samples read-only (403 on edit), other users' resources hidden (404), everything scoped to `req.user.id`.
- **`apps/api/src/scripts/prune.ts`** + `npm run db:prune`: wipes all user data + non-sample datasets, keeping only the two seeds (deploy cleanup).
- **`GET /api/config`** and **`GET /api/manual`** (serves `docs/User manual.md` for the in-app Manual page).

### 8.3 Frontend delivered
- **`apps/web/src/auth.tsx`** — auth context (`user`, login/signup/logout/setKey, loading).
- Pages: `LoginPage`, `SignupPage`, `ForgotPasswordPage` (email → in-app code → new password), `SettingsPage` (OpenRouter key + change password + sign out).
- **Route guards** (`RequireAuth`) on create/edit/run/experiment/settings routes; sample browsing + Manual stay public.
- **Ownership-aware UI**: `DatasetsPage`/`DatasetDetailPage` use an `editable` flag from the API — anonymous visitors see samples + a "create an account" prompt; owners get full CRUD.
- **Topbar**: shows user avatar/name, Sign out, and the new **Manual** nav item.
- **`ManualPage.tsx`** renders the manual markdown via `react-markdown` + `remark-gfm`.

### 8.4 Testing (Phase 5)
- New **`apps/api/src/tests/auth-integration-tests.ts`** (28 checks): crypto roundtrip, signup/login/me/logout, wrong-password 401, forgot+reset code flow, change-password, dataset ownership (404 for others, 403 for samples, samples-only for anonymous), anonymous run → 401, `/api/manual` 200 + markdown, prune keeps only samples.
- All suites pass: 30 unit tests, experiments integration (44), auth integration (28). Full `npm run build` clean.

### 8.5 Live E2E verification (on `:5101`)
1. Opened the app → **Sign in** landing.
2. Created an account → redirected to the app, topbar showed the user.
3. Settings → saved an **invalid** key → rejected with a friendly 401 message.
4. Saved a **real** key → `hasKey: true` (validated, then encrypted).
5. Ran a real Playground comparison → **completed**, both executions used the user's stored key.
6. Anonymous view of `/datasets` → only the two samples, read-only, with sign-up prompt.

---

## 9. Infrastructure & consistency work

- **Single-port architecture:** the API server serves the built web app (Express static + SPA fallback) so the whole product runs on **one port (5101)** — "shut down every other port before running; use 5101 every time." `.env` and `apps/api/.env` both set `PORT=5101`.
- **Windows notes:** `prisma generate` can fail with EPERM if a node process holds the query-engine DLL → stop node processes first. The terminal's PowerShell cannot `cd` into paths containing spaces via `;` chaining — used quoted absolute paths or relative `cd ../..`.
- **TypeScript tooling:** pinned `@types/express@^4.17.21` to match the Express 4 runtime (Express 5 types typed `req.params` as `string | string[]` and broke Prisma `where` calls); removed `cookie-parser` in favor of a tiny manual cookie reader.

---

## 10. Git history

Pushed to `github.com/ravinder024/ai-release-intelligence-platform` (branch `master`), identity consistent with prior commits (`Codex <codex@local>`), `.env` verified gitignored.

```
a412cea..3e4d9b0  Add Contabo deployment runbook (docs/Deployment.md)
ce76dc9..a412cea  Phase 5: accounts (SSO), per-user OpenRouter keys,
                  private workspaces, in-app Manual   ← main Phase 5 commit
ce76dc9           Mark stale running evaluation runs at startup, add periodic
                  reconcile and admin endpoint        ← earlier work
```

The main Phase 5 commit also carried prior uncommitted Phase 4 work (experiments/iterations/metrics) forward.

---

## 11. Deployment plan (Contabo)

Target **213.136.66.153** under **https://ai-evals-studio.duckdns.org**. The server already has Node.js, PostgreSQL, nginx, and DuckDNS configured.

Runbook (full detail in **`docs/Deployment.md`**):

1. Create DB/user in PostgreSQL.
2. Clone repo to `/var/www/arip`.
3. Write `.env` → `DATABASE_URL`, `PORT=5101`, `OPENROUTER_BASE_URL`, `OPENROUTER_API_KEY=""` (empty — users bring their own), `ENCRYPTION_KEY` + `SESSION_COOKIE_SECRET` (generated once via `openssl rand -hex 32`), `NODE_ENV=production`.
4. `npm ci` → `npm run build` → `npx prisma migrate deploy` → `npm run db:seed` → `npm run db:prune`.
5. systemd service `arip.service` → `node /var/www/arip/apps/api/dist/server.js`, `Restart=always`.
6. nginx site proxying `ai-evals-studio.duckdns.org` → `127.0.0.1:5101`, then `certbot --nginx` for TLS.
7. Verify: landing → sign-in, create account, save key in Settings, run a comparison + experiment; samples read-only; Manual renders.

**Security notes**

- `ENCRYPTION_KEY` / `SESSION_COOKIE_SECRET` must stay stable (changing them invalidates stored keys/sessions).
- `NODE_ENV=production` makes the session cookie `Secure` (HTTPS-only).
- `.env` is gitignored — never committed.

---

## 12. Evaluation error investigation (2026-09-15)

The deployed/local evaluation screen showed `Unexpected server error` beneath the judge prompt. The investigation separated the problem into two parts:

- The evaluation-start API could create runs successfully; the failure was in background execution, where some OpenRouter responses had no usable `choices[0].message.content`.
- `provider.ts` previously accessed `response.choices[0]` without checking the response shape, producing `Cannot read properties of undefined (reading '0')`.
- The provider now validates the response and reports `Model <id> returned no usable chat completion.` so the run becomes an honest retryable failure instead of an opaque server error.
- The compiled model QA script was also fixed to run when invoked as `qaModels.js` (it previously only ran for `qaModels.ts`).

The updated QA report found:

- Healthy during the check: `nvidia/nemotron-3.5-lightning:free`, `poolside/laguna-s-2.1:free`, `poolside/laguna-xs-2.1:free`, and `dots-studio/dots-3-note-preview:free`.
- Temporarily rate-limited (HTTP 429, not removed): Gemma 4 31B, Nemotron 3 Super, Cohere North Mini Code, and Gemma 4 26B.
- Removed as unreliable: `nvidia/nemotron-3-ultra-550b-a55b:free` (intermittent malformed responses) and `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` (malformed responses).
- The default model is now `nvidia/nemotron-3.5-lightning:free`.

Verification after the fix: the API model list reported 8 models; a one-scenario judged evaluation completed with `2/2` results and both judgements saved; the full build, unit tests, auth/ownership tests, and experiments integration tests passed. Temporary verification accounts and datasets were pruned afterward, leaving the two samples.

## 13. Final state & how to run

**Final state:** Phases 1–5 complete and tested; code pushed to GitHub; deployment runbook documented. Working tree clean.

**Run locally:**

```bash
npm install
npm run db:migrate    # apply migrations (incl. phase5_auth)
npm run db:seed       # two sample datasets
npm run dev           # build + start on http://localhost:5101
```

**Tests:**

```bash
npm run test -w @prompt-playground/api               # unit (evaluator + metrics)
npm run test:integration -w @prompt-playground/api   # auth + experiments integration
```

**Key scripts:** `npm run db:prune` (samples-only reset), `npm run db:seed`.

---

## 14. Out of scope / future work (documented, not built)

- Email-based password reset (reset codes are intentionally in-app).
- OAuth/Google SSO, roles/RBAC, admin surfaces.
- Per-user rate limiting, dashboards, reviewer queues, hallucination detection.
- Backups, CI/CD pipeline, key rotation / KMS.

---

*End of session log.*
