# Phase 3 — Evaluation & Judging PRD

Vision
: Add automated, criterion-based scoring to evaluation runs using an LLM judge, enabling quick, repeatable assessments and decision support for prompt quality.

Scope
- Persist automated judgements for each prompt result with overall score, pass/fail, summary, and per-criterion results.
- Provide UI controls to enable the judge for a run, pick the judge model, set a pass threshold, and edit the judge prompt.
- Surface judge output in the Results UI with per-result summary and expandable criterion details.

User stories
- As a researcher, I want to run a dataset evaluation with an LLM judge so I can get automated scoring for both prompt variants.
- As a reviewer, I want to see per-criterion scores and reasons so I can understand why a result passed or failed.
- As an engineer, I want judgements persisted in the database so I can query and aggregate scores over time.

Acceptance criteria
- API accepts `evaluatorModel`, `evaluatorThreshold`, and `evaluatorPrompt` when creating a run.
- The backend invokes an evaluator service and persists `EvaluationJudgement` and `EvaluationCriterionResult` rows for completed results.
- `GET /api/evaluations/:id` returns runs with judgements and criteria for UI rendering.
- UI exposes judge controls on `Run evaluation` and displays judge summary and criteria on the Results page.
- Tests cover judgement creation and retrieval and basic UI rendering for judged results.

Technical details
- Backend: Express + TypeScript; new evaluator service module that parses judge model output and returns structured judgement objects.
- DB: Prisma migrations adding `EvaluationJudgement` and `EvaluationCriterionResult` models (already present in schema for this repo).
- Models/provider: reuse `supportedModels` (OpenRouter adapter) for judge calls; control concurrency and rate limits.
- Frontend: React pages `RunEvaluationPage` and `EvaluationResultsPage` updated to configure and display judgements.
- DevOps: environment variables `OPENROUTER_API_KEY`, database migrations via `npm run db:migrate`, monitoring for judge cost and rate limits.

Constraints & implications
- Judge model calls incur additional cost and latency; set expectations and default threshold values accordingly.
- Judgements should be treated as advisory; human review workflows are out of scope for Phase 3.
- No auth/role-based review features in Phase 3.

Future scope
- Human-in-the-loop review queues, consensus workflows, dashboarding for aggregated metrics, and automated alerts on regressions.
