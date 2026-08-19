# Phase 2 — Dataset Evaluation PRD

Vision
: Evaluate prompt variants across a dataset of real-world scenarios to measure quality, cost, and regressions at use-case scale.

User stories
- As an engineer, I want to create datasets of scenarios so I can run repeatable evaluations.
- As a product manager, I want to run prompts across a dataset and get telemetry for every scenario so I can compare variants at scale.
- As a reviewer, I want to store and revisit completed runs to track changes over time.

Acceptance criteria
- Create/update/delete datasets and test cases via UI and API.
- Run evaluation: system starts a background run that executes both prompts for every test case and persists results.
- Results page shows progress while running and preserves telemetry and outputs after completion.

Technical summary
- Frontend: React + Vite — pages: Datasets, Dataset Detail, Run Evaluation, Results.
- Backend: Express + TypeScript, Prisma ORM with PostgreSQL migrations.
- Execution: background runner with controlled concurrency (e.g., 3 concurrent calls), retry/backoff for provider errors.
- Shared types: `packages/shared` for DTOs and contracts between frontend and backend.

Constraints & implications
- No scoring/judging in Phase 2; runs are recorded but not automatically scored.
- Keep datasets under ~50 scenarios for predictable runtimes and cost during development.

Future scope
- Automated scoring and judgement (Phase 3), human review, dashboards, and role-based access.
