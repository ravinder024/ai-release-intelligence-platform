# Phase 2 — Dataset Evaluation

## Purpose

Phase 2 extends the Prompt Playground from a single-example prompt comparison to a benchmark dataset evaluation workflow.

The goal is to let AI product managers and engineers evaluate prompt variants across many realistic scenarios, rather than relying on one or two manual examples.

## Objectives

- Create benchmark datasets with metadata for real use cases.
- Add multiple test cases per dataset.
- Execute both Prompt A and Prompt B across every test case.
- Store all results and telemetry.
- Review the outcome in a unified results page.

## User experience

### Primary user

AI Product Manager

### Secondary user

AI Engineer

### Phase 2 MVP flow

1. User creates a new dataset with:
   - name
   - description
   - use case
2. User adds multiple test cases with:
   - input
   - expected output (optional)
   - notes (optional)
3. User opens a dataset and clicks `Run evaluation`.
4. User selects a model and enters Prompt A and Prompt B.
5. System executes every test case through both prompts.
6. User reviews a result table with outputs, latency, tokens, and estimated cost.

## What this phase intentionally does not include

- AI-as-a-judge or automatic scoring
- Pass/fail classification
- Hallucination detection
- Dashboards or reporting analytics
- Prompt versioning
- Authentication or multi-user collaboration

Those are planned for later phases.

## Architecture

This phase continues the existing modular monolith approach.

- `apps/api` — Express + Prisma backend
- `apps/web` — React + Vite frontend
- `packages/shared` — shared TypeScript contracts
- PostgreSQL is the system of record
- Model provider adapter remains isolated and reusable

### Design principles

- Keep the backend simple and RESTful.
- Keep the data model normalized to support stable history and efficient querying.
- Preserve prompt text and output telemetry per evaluation result so auditability is maintained.
- Keep the UI clean and action-oriented; avoid unnecessary visual noise.

## Data model

Phase 2 introduces four normalized entities:

### Dataset

Represents a benchmark collection for a single use case.

Fields:
- `id`
- `name`
- `description`
- `useCase`
- `createdAt`
- `updatedAt`
- `testCases`
- `runs`

### DatasetTestCase

Represents a single scenario within a dataset.

Fields:
- `id`
- `datasetId`
- `input`
- `expectedOutput`
- `notes`
- `position`
- `createdAt`
- `results`

### EvaluationRun

Represents one execution of Prompt A and Prompt B across a dataset.

Fields:
- `id`
- `datasetId`
- `model`
- `promptA`
- `promptB`
- `status`
- `createdAt`
- `completedAt`
- `results`

### EvaluationResult

Represents the output and telemetry for one prompt variant on one test case.

Fields:
- `id`
- `runId`
- `testCaseId`
- `variant` (`A` or `B`)
- `prompt`
- `output`
- `latencyMs`
- `inputTokens`
- `outputTokens`
- `totalTokens`
- `estimatedCostUsd`
- `status`
- `errorMessage`
- `createdAt`

### Why normalization

- Avoids duplicated dataset metadata across runs.
- Makes it easy to fetch all results for a run, or all runs for a dataset.
- Supports stable ordering of test cases.
- Keeps evaluation history self-contained.

## Backend API contract

### Dataset CRUD

#### POST /api/datasets
- Creates a dataset.
- Request body: `{ name, description?, useCase? }`
- Response: dataset metadata including `testCaseCount`.

#### GET /api/datasets
- Lists datasets sorted newest first.
- Query param: `limit` optional.
- Response: dataset list with counts.

#### GET /api/datasets/:id
- Returns a single dataset and its ordered test cases.
- Response: dataset metadata and `testCases`.

#### PATCH /api/datasets/:id
- Updates a dataset.
- Request body: partial `{ name?, description?, useCase? }`
- Response: updated dataset metadata.

#### DELETE /api/datasets/:id
- Deletes a dataset and cascades related test cases and runs.
- Response: `204 No Content`.

### Test case CRUD

#### POST /api/datasets/:id/test-cases
- Creates a new test case.
- Request body: `{ input, expectedOutput?, notes?, position? }`
- Response: created test case.

#### PATCH /api/datasets/:datasetId/test-cases/:testCaseId
- Updates a single test case.
- Request body: partial `{ input?, expectedOutput?, notes?, position? }`
- Response: updated test case.

#### DELETE /api/datasets/:datasetId/test-cases/:testCaseId
- Deletes a test case.
- Response: `204 No Content`.

### Evaluation workflow

#### POST /api/evaluations
- Creates an evaluation run against a dataset.
- Request body: `{ datasetId, model, promptA, promptB }`
- Response: evaluation run summary with progress.
- Behavior: creates the run record immediately, then executes the variant calls in the background.

#### GET /api/evaluations
- Lists recent evaluation runs.
- Query param: `limit` optional.
- Response: run summaries with dataset name and counts.

#### GET /api/evaluations/:id
- Returns the full run details.
- Includes test cases, results, progress, and status.

## Backend execution model

- Runs are created in `running` state.
- Every test case generates two jobs: variant A and variant B.
- Jobs are executed with controlled concurrency to reduce provider rate limit risk.
- Results are saved individually.
- When complete or on partial failure, the run transitions to `completed` or `partial_failure`.
- On startup, any stale `running` runs are marked `partial_failure` to avoid indefinite progress.

## Frontend pages

### Datasets page

- List existing datasets.
- Create a new dataset.
- Show recent evaluation runs.
- Navigate to dataset detail or run evaluation.

### Dataset detail page

- View dataset metadata.
- Edit dataset name, description, and use case.
- Add, update, and delete scenarios.
- Click through to run evaluation.

### Run evaluation page

- Show selected dataset and scenario count.
- Pick a model.
- Edit Prompt A and Prompt B.
- Start evaluation.
- Navigate to results.

### Evaluation results page

- Show run status and progress bar.
- Display the prompt variants and their outputs side by side.
- Show latency, tokens, and estimated cost per result.
- Keep results available after completion.

## UX decisions

- Use a clean, Linear-like layout with distinct sections.
- Keep form interactions simple and inline.
- Avoid overloading the user with analytics or scores.
- Provide clear action signposts: create dataset, add scenario, run evaluation, view results.

## Trade-offs

### Why no scoring or judgement

The product brief is explicit: Phase 2 should demonstrate repeatable evaluation without subjective automation. This keeps the MVP focused and avoids premature complexity.

### Why store prompt text in results

Although it duplicates some data, storing prompt text in each `EvaluationResult` makes runs self-contained and robust to later dataset or prompt changes.

### Why asynchronous evaluation

Synchronous API requests for 14+ model calls can be fragile and slow. Background execution makes the user experience smoother and avoids HTTP timeout issues.

## Future extensions

Phase 3 should consider:
- saving prompt versions separately from runs
- adding judge-driven or human review labels
- scoring and quality metrics
- hallucinaton flagging and annotation
- dataset sharing and collaboration
- dashboards and trend analysis

## Notes for developers

- Keep shared types in `packages/shared` aligned with API responses.
- Use `apps/api/src/provider.ts` to isolate model provider details from evaluation logic.
- Keep dataset and evaluation page state local in the frontend and rely on API contracts for persistence.
- When updating this document, preserve the phase boundary and non-goals.
