# Phase 4 PRD — First-class Experiments, Comparison, and Decisions

Status: Complete (implemented, validated end-to-end, and refined after real testing)

## Goal
Make Experiments a first-class product concept: a controlled comparison between a **Baseline** and a **Candidate** AI configuration, evaluated on the same golden dataset, with a comparison dashboard and a human decision. Answers *"Did my AI change actually improve the product?"*.

## Product concept
- An experiment records: name, hypothesis, dataset, baseline configuration (prompt + model), candidate configuration (prompt + model), and evaluator configuration (judge model, threshold, prompt) — all snapshotted at run time.
- Baseline and Candidate are evaluated against the SAME dataset using the existing Phase-3 LLM judge engine (no second evaluator).
- The user compares quality, pass rate, latency, tokens, cost, criterion performance, and scenario performance, then makes a decision: Promote Candidate / Keep Baseline / Continue Experiment (with rationale).

## Scope (implemented)
- First-class navigation: `Experiments → /experiments` (landing list), `/experiments/new` (wizard), `/experiments/:id` (detail + decision).
- Data model: `Experiment` with hypothesis, dataset FK, baseline/candidate prompt+model, evaluator config, status (draft/running/completed/partial_failure/failed), decision, decisionNote, decidedAt.
- `EvaluationRun` supports per-variant models (`modelA`/`modelB`) and `experimentId`; `EvaluationResult` stores `responseSnapshot` + `modelMetadata`.
- Metrics service: aggregation (avg score, pass rate, latency, tokens, cost), signed deltas (pass-rate in percentage points), criterion comparison, scenario comparison, regression detection.
- APIs: `POST/GET /api/experiments`, `GET /api/experiments/:id`, `PATCH /api/experiments/:id/decision`, `POST /api/experiments/:id/run`.
- Reproducibility: historical experiments are unchanged by later dataset/prompt edits.
- Removed the experiment selector from the Dataset "Run evaluation" flow — experiments have their own journey.

## Acceptance criteria (all met)
- [x] Experiments is a first-class navigation destination (`/experiments`, no dataset redirect).
- [x] Landing page shows experiment list with hypothesis, dataset, baseline, candidate, latest result (score delta, pass-rate delta in pp), decision, created date.
- [x] New Experiment wizard: define → dataset → baseline/candidate → review → Run Experiment.
- [x] Config snapshots preserved (prompt, model, evaluator config, threshold).
- [x] Phase-3 evaluation engine reused; baseline/candidate run on the same dataset.
- [x] Progress shown while running; statuses handled (running/completed/partial_failure/failed).
- [x] Detail page: header, configuration comparison, result summary with signed deltas, criterion comparison, scenario comparison, regressions panel, raw evidence.
- [x] Decision workflow: Promote Candidate / Keep Baseline / Continue Experiment + rationale; persists with decidedAt.
- [x] Historical experiments remain reproducible after dataset changes.
- [x] Automated tests: metrics unit tests (18), integration/E2E tests (22) — all pass.
- [x] Phase 1/2/3 flows preserved (evaluator tests pass; web/api build).

## Non-goals (not built)
- Automatic promote recommendation, prompt optimization, statistical significance, confidence intervals, human review queues, production A/B traffic, dataset version management, team collaboration, auth, release automation, complex dashboards, model registry, microservices.

## Risks / follow-ups
- Free-model rate limits can cause `partial_failure` runs (surfaced in the UI with a retry CTA). A paid model tier or retry/backoff tuning may reduce this.
- Snapshot storage growth: consider TTL or sample-only snapshotting in a later phase.
- Privacy: snapshots may contain user data — document retention guidance.

## Refinement (post-testing product correction) — complete
- [x] Failed scenarios can be retried individually (only execution/evaluator failures; quality failures are never retried).
- [x] Successful scenarios are not re-run on retry (verified by call counters).
- [x] Experiment exposes LLM-as-a-Judge configuration (judge model + threshold), separate from the target model.
- [x] Metric colors use higher-is-better for quality and lower-is-better for latency/tokens/cost; zero is neutral.
- [x] Accuracy/Completeness show explanatory ⓘ tooltips (reusable criterion-description mechanism).
- [x] Evidence-based recommendation (deterministic, insufficient-data when incomplete) that never auto-decides.
- [x] Continue Experiment creates a new immutable iteration (baseline = previous candidate); previous iteration unchanged.
- [x] Evaluator/dataset changes between iterations produce a comparability warning.
- [x] Version/configuration labels visible (Iteration N, baseline vN, candidate vN+1).
- [x] Incomplete evaluation is clearly indicated; metrics are qualified when data is incomplete.
- [x] Historical results remain reproducible after dataset/prompt changes (test-case snapshots).
- [x] Automated tests pass (30 unit + 44 integration/E2E); manual end-to-end validated; Phase 1/2/3 regression passes.
