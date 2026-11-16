# Implementation Notes — Phase 5B Failure Analysis

This document captures the implementation decisions for the Failure Analysis layer.
It builds **on top of** the Phase 3 judge results and Phase 4 experiment data.

> Status: implemented at code level. Automated tests and regression verification are deferred
> to the post-implementation verification pass.

## Design constraint

No new evaluator and no duplicated LLM-as-a-Judge logic. Failure Analysis is a pure function over
data that already exists (`EvaluationResult`, `EvaluationJudgement`, `EvaluationCriterionResult`)
plus dataset metadata. There is no extra model call anywhere in this phase.

## Contracts (`packages/shared/src/index.ts`)

```ts
type FailureCategory =
  | "unsupported_claim" | "missing_information" | "incorrect_next_step"
  | "instruction_violation" | "incomplete_response" | "criterion_failure"
  | "execution_error" | "evaluator_error" | "missing_result" | "unclassified";

type FailureAnalysis = {
  type: "quality_failure" | "execution_error" | "evaluator_error"
      | "missing_result" | "regression" | "improvement" | "pass";
  categories: FailureCategory[];
  failedCriteria: Array<{ criterion: string; reason: string | null; score: number; pass: boolean }>;
  evidence: string[];
  suggestions: Array<{ action: string; rationale: string; testCaseId: string; criterion?: string }>;
  requiresHumanReview: boolean;
};
```

`ScenarioComparison` gained `criteria` (the rubric snapshot), `baselineExecution` /
`candidateExecution` (status, error, latency, model), and `failureAnalysis`.

## Classification (`apps/api/src/services/metrics.ts`)

`analyzeScenarioFailure` runs a strict, ordered decision list so an infrastructure problem is never
reported as a low-quality AI answer:

1. no candidate result → `missing_result`
2. candidate execution failed → `execution_error`
3. candidate judgement failed → `evaluator_error`
4. candidate not judged → `missing_result`
5. candidate passed less than baseline → `regression`
6. candidate did not pass → `quality_failure`
7. candidate passed and improved → `improvement`
8. otherwise → `pass`

Only steps 5–6 (and `improvement`) produce categories, evidence, and suggestions. Steps 1–3 return
the raw execution/evaluator error text as their single piece of evidence and no suggestions.

`categoryForEvidence` maps the judge's own criterion names and reasons onto the requested
categories with conservative regular expressions. If nothing matches, the failure is recorded as
`criterion_failure` (criterion present) or `unclassified` — **a category is never invented**.

Suggestions are deterministic templates keyed off the detected category, and each one carries the
`testCaseId` (and criterion where applicable) plus an explicit "treat this as a hypothesis"
rationale. Two conditional suggestions are added when the evidence supports them:

- baseline and candidate used **different models** → investigate a model-specific regression;
- the scenario has **no golden answer** → add and review one before using it as a release gate.

When a scenario is an `improvement`, `failedCriteria` describes the *baseline* failures that the
candidate fixed, and no corrective suggestions are emitted.

### Evidence quality

- `summary`, `evaluatorModel`, `threshold`, and `errorMessage` are now carried from the persisted
  judgement into the metrics layer instead of being flattened to `null`.
- `modelMetadata.model` is read back per result so per-variant model identity appears in the UI.
- `buildScenarioTestCases` prefers `criteriaSnapshot` (the rubric as it was at evaluation time) and
  falls back to the live dataset only when no snapshot exists.

## Creating regression cases (`apps/api/src/routes/experiments.ts`)

`POST /api/experiments/:id/regression-cases`

- Body: `{ testCaseId, variant?: "A" | "B" (default B), datasetName? }`.
- Owner-checked against the experiment; the latest run and the matching result are looked up.
- Creates a **new dataset** (not a row in the original one) with a single test case copied from the
  historical snapshots: input, golden answer, and rubric.
- Sets `requiresReview` when the golden answer or rubric is missing, so the UI can flag it.
- Sets `sourceResultId` to the originating `EvaluationResult` id, preserving provenance.
- The note records which variant the case came from and why review may be needed.
- The original dataset, its scenarios, and all historical results are untouched.

Review state is cleared later through the existing dataset test-case `PATCH` (`requiresReview`),
which the dataset detail page exposes as a checkbox.

Re-evaluation needs no new code: a regression dataset is an ordinary dataset, so the existing
dataset-evaluation and experiment flows already accept it.

## Frontend

### `pages/ExperimentDetailPage.tsx`

- **Failure Analysis panel** — rollups for new regressions, improved scenarios, genuine quality
  failures, and incomplete/errored scenarios, plus two breakdowns: failure patterns (categories)
  and the criteria failed most often.
- **Per-scenario detail** — a status chip (quality failure / regression / improvement / execution
  error / evaluator error / missing result), the rubric, the golden answer, both outputs, and
  `JudgementEvidence`, which renders a score + pass/fail only for completed judgements and an
  explicit "Evaluator error" line for failed ones.
- Execution metadata (model, latency, status) and the raw execution error are shown separately
  from the judge verdict.
- Evidence list and "Possible next steps" with the cited rationale; the review-required hint when
  the evidence is thin.
- **Create regression case** button on failing/regressed/improved scenarios, with a success banner
  linking to the new dataset.

### `pages/EvaluationResultsPage.tsx`

The standalone dataset results view now labels each row (`pass`, `improved`, `candidate
regression`, `quality failure`, `execution error`, `evaluator error`, `judgement pending`, `missing
result`) and no longer renders a score for a failed judgement.

### `pages/DatasetDetailPage.tsx`

Shows a **Review required** badge for regression cases awaiting confirmation and provides a
checkbox to clear it.

## Boundaries honoured

Not implemented, by explicit scope: semantic clustering, autonomous prompt rewriting, automatic
production monitoring, automatic release decisions, credential failover, and any second evaluation
engine.
