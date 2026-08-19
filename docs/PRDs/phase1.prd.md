# Phase 1 — Prompt Playground PRD

Vision
: Quickly compare two prompt variants on a single input to iterate on prompt design with telemetry (latency, tokens, cost) and saved history.

User stories
- As an engineer, I want to run Prompt A and Prompt B on a single input so I can compare outputs side-by-side.
- As a product owner, I want to see latency and token usage for each prompt so I can balance cost and quality.
- As a reviewer, I want to revisit prior comparisons to track prompt changes over time.

Acceptance criteria
- UI lets users enter input, Prompt A, Prompt B and select a model.
- Backend returns outputs with latency, token counts and estimated cost, and stores comparison history.
- Comparison history is searchable and viewable later.

Technical summary
- Frontend: React + Vite.
- Backend: Express + TypeScript + Prisma + PostgreSQL.
- Provider: OpenRouter-compatible adapter for model calls.
- Storage: normalized tables for comparisons and executions; telemetry fields for tokens/latency/cost.

Constraints & implications
- No auth or multi-user features in Phase 1.
- Free-model availability can be rate-limited—UI warns about slowness.

Future scope
- Add A/B aggregated metrics, team dashboards, and prompt versioning.
