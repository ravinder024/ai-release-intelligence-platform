# Implementation Notes — Phase 4 First-class Experiments

This document captures the implementation decisions for Phase 4 (first-class experiments, comparison, and decisions).

## Data model (`apps/api/prisma/schema.prisma`)
- `Experiment` model: `id`, `name`, `hypothesis`, `datasetId` (FK → Dataset, cascade delete), `baselinePrompt`/`baselineModel`, `candidatePrompt`/`candidateModel`, `evaluatorModel`/`evaluatorThreshold`/`evaluatorPrompt`, `status` (enum: draft/running/completed/partial_failure/failed), `decision` (enum: promote_candidate/keep_baseline/continue_experiment), `decisionNote`, `decidedAt`, `createdAt`, `updatedAt`. Configuration is stored as explicit snapshot columns (not a mutable reference) for reproducibility.
- `EvaluationRun` additions: `experimentId` (FK), `modelA`/`modelB` (optional per-variant models; fall back to `model`).
- `EvaluationResult`: `responseSnapshot` (JSON), `modelMetadata` (JSON).

## Backend
- `apps/api/src/services/metrics.ts` — pure functions: `aggregateVariant`, `compareMetrics`, `compareCriteria`, `compareScenarios`, `findRegressions`. Pass-rate deltas are in percentage points; all deltas signed candidate − baseline.
- `apps/api/src/routes/evaluations.ts` — `executeRun` refactored to an options object and **exported** (reused by experiments). Supports `modelA`/`modelB` and an optional provider override for deterministic tests. On completion it syncs the owning experiment status. `findRun` is exported and returns `modelA`/`modelB`.
- `apps/api/src/routes/experiments.ts` — full API:
  - `POST /api/experiments` (create draft with frozen config)
  - `GET /api/experiments` (list + latest-result score/pass-rate deltas + decision)
  - `GET /api/experiments/:id` (`buildExperimentDetail`: metrics, criteria, scenarios, regressions, latest run)
  - `PATCH /api/experiments/:id/decision` (decision + rationale + decidedAt)
  - `POST /api/experiments/:id/run` → `startExperimentRun(...)`: creates an `EvaluationRun` (baseline = prompt A / modelA, candidate = prompt B / modelB), sets experiment `running`, reuses the Phase-3 engine via `executeRun`.
- Experiment status transitions: `running` on run start → `completed` or `partial_failure` when the run finishes (in `executeRun`'s finally).

## Frontend (`apps/web/src`)
- `main.tsx`: routes `/experiments`, `/experiments/new`, `/experiments/:id`; nav already pointed to `/experiments` (no dataset redirect).
- `pages/ExperimentsPage.tsx`: first-class landing — list rows with name, hypothesis, dataset, baseline/candidate models, status, signed score/pass-rate deltas, decision pill, "Run again"-free list + `+ New Experiment`.
- `pages/NewExperimentPage.tsx`: wizard (Define → Configure → Review → Run Experiment) with BASELINE/CANDIDATE terminology and LLM-judge options.
- `pages/ExperimentDetailPage.tsx`: header + status, configuration comparison, result summary table (signed deltas, pp pass rate), criterion table, scenario table (expandable evidence: golden answer, outputs, judge scores), regressions panel, decision panel (Promote/Keep/Continue + rationale + Save), progress while running, "Run again" for retries.
- `RunEvaluationPage.tsx`: experiment selector and modal **removed** — the Dataset flow is Phase 2/3 only. `ExperimentFormModal.tsx` deleted.
- `EvaluationResultsPage.tsx`: still shows an experiment banner + raw snapshot expanders when a run is linked to an experiment.
- Styles: added `.experiment-list`, `.wizard-steps`, `.config-block` (baseline/candidate accents), `.summary-table`, `.scenario-compare-*`, `.regressions-panel`, `.decision-*`, `.delta-positive/negative` etc.

## Tests
- `apps/api/src/tests/metrics-tests.ts` — 18 unit tests (aggregation, deltas, criterion/scenario comparison, regression detection). Run via `npm test`.
- `apps/api/src/tests/experiments-integration-tests.ts` — 22 deterministic integration/E2E tests using a fake provider + fake judge (run via `npm run test:integration`): create → run → metrics/deltas/regressions → decision persistence → reproducibility after dataset rename → cleanup.

## Phase-4 refinement pass (2026-08-26)

Implemented as a product-correction pass; Phase 1/2/3 preserved.

- **Partial retry**: `executeRun` gains `jobs?` (run only specific testCase+variant pairs) and `upsert?` modes; `POST /api/experiments/:id/retry` (`retryExperimentFailures`) re-runs only execution/evaluator failures in the same run, never touching successful results. Retryable = `result.status === "failed"` or a failed judgement or a missing pair — a low quality score is NOT retryable. `EvaluationResult` keeps an `attempt`-free single effective row (failed → replaced).
- **Reproducibility snapshots**: `EvaluationResult` now stores `inputSnapshot`, `expectedOutputSnapshot`, `criteriaSnapshot` so historical scenario comparisons show the original benchmark even after dataset edits.
- **Evaluator config**: explicit EVALUATION CONFIGURATION (Human/LLM-as-a-Judge radio, judge model, threshold, prompt) in the wizard + New Iteration page; the detail page shows an EVALUATOR section distinct from TARGET CONFIGURATION.
- **Metric semantics**: shared `METRIC_DIRECTION`/`metricDeltaTone` (quality higher-is-better; latency/tokens/cost lower-is-better; zero neutral) used by the UI; `CriterionName` shows ⓘ tooltips from shared `CRITERION_DESCRIPTIONS`.
- **Recommendation**: deterministic `recommendExperiment()` in `metrics.ts` (insufficient_data when incomplete; promote/keep/continue by transparent rules with evidence strings). Never auto-changes the user's decision.
- **Iterations/versioning**: `Experiment.iteration` (default 1) + `parentId` self-relation. `POST /api/experiments/:id/iterations` (`createNextIteration`) creates a child (baseline = previous candidate, same dataset, inherited evaluator). List groups roots + shows latest iteration + `iterationCount`; detail shows iteration number, version labels (baseline `vN`, candidate `vN+1`), iteration history chips, and a comparability warning when evaluator/dataset changed vs the previous iteration.
- **Status/UX**: Evaluation-status panel (per-variant completion + retry CTA + incomplete-data footnote); "Not started" for drafts; recommendation panel; semantic delta colors.

### Tests (all pass)
- `metrics-tests.ts`: 18 + new Test-Group D (metric direction) + E (recommendation) = 30 unit tests total with evaluator tests.
- `experiments-integration-tests.ts`: 44 assertions — retry (3/5→5/5, only-failed re-run via call counters, quality vs execution failure), evaluator/threshold persistence, recommendation states, iteration (baseline=prev candidate, immutability), comparability warning, dataset-snapshot reproducibility.
- Integration test cleanup now runs before `process.exit` so fixtures are always removed.

## Operational notes
- Free-model rate limits can produce `partial_failure` runs; the detail page surfaces this with a retry CTA.
- Monitor snapshot storage; consider TTL/sample-only retention in a later phase.
