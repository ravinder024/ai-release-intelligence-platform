# Prompt Playground — Milestone 1

## Scope

The application creates two prompt variants, sends the same input to a selected model, presents both outputs side by side, and stores the full comparison and execution telemetry in PostgreSQL. Authentication, analytics, datasets, and dashboards are intentionally excluded.

## Architecture

```
apps/web (React + Vite) -> apps/api (Express REST API) -> PostgreSQL
                                        |
                                        +-> model provider adapter
```

- **Web** is a single, focused workspace. It owns form state and renders comparison history.
- **API** validates requests, creates a comparison record, executes both variants concurrently, computes standard telemetry, and persists completed or failed executions.
- **Provider adapter** isolates the model API. The initial adapter targets OpenAI's Responses API; a deterministic local fallback is available for development when no API key exists.
- **PostgreSQL** is the system of record. A comparison is immutable after execution, except for transitioning its lifecycle status while requests are running.

This is a modular monolith: one deployable backend and one database. It avoids premature queues, event infrastructure, and service boundaries while leaving a narrow provider interface for future expansion.

## Folder structure

```
apps/
  api/                 # Express REST API, Prisma schema, provider adapter
  web/                 # React Prompt Playground
packages/
  shared/              # API request/response TypeScript contracts
docs/implementation/   # delivery decisions and API documentation
```

## Database schema

```sql
CREATE TYPE comparison_status AS ENUM ('running', 'completed', 'partial_failure');
CREATE TYPE execution_status AS ENUM ('completed', 'failed');

CREATE TABLE prompt_comparisons (
  id UUID PRIMARY KEY,
  model VARCHAR(160) NOT NULL,
  input TEXT NOT NULL,
  status comparison_status NOT NULL DEFAULT 'running',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE prompt_executions (
  id UUID PRIMARY KEY,
  comparison_id UUID NOT NULL REFERENCES prompt_comparisons(id) ON DELETE CASCADE,
  variant CHAR(1) NOT NULL CHECK (variant IN ('A', 'B')),
  prompt TEXT NOT NULL,
  output TEXT,
  latency_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  estimated_cost_usd NUMERIC(12, 8),
  status execution_status NOT NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (comparison_id, variant)
);

CREATE INDEX prompt_comparisons_created_at_idx ON prompt_comparisons (created_at DESC);
CREATE INDEX prompt_executions_comparison_id_idx ON prompt_executions (comparison_id);
```

`estimated_cost_usd` is captured at run time using the configured model-pricing table so historical results remain understandable even when provider pricing changes.

## API contracts

### `POST /api/comparisons`

Creates and executes both prompt variants. The request waits for both provider calls so the UI can render a completed comparison without polling.

```json
{
  "model": "gpt-4.1-mini",
  "input": "Summarize the customer issue.",
  "promptA": "You are a concise support assistant.",
  "promptB": "You are an empathetic support assistant."
}
```

Returns `201` with a `Comparison` object. Validation errors return `400`; unexpected execution failures are represented per variant in a `201` response rather than discarding the other result.

### `GET /api/comparisons?limit=20`

Returns the newest saved comparisons, newest first. `limit` is optional, defaults to 20, and is capped at 100.

### `GET /api/comparisons/:id`

Returns a single saved comparison and its two variant executions; returns `404` when absent.

### `GET /api/models`

Returns model choices supported by the configured provider adapter, each with a display label and pricing metadata used by the UI.

## API response shape

```ts
type Comparison = {
  id: string;
  model: string;
  input: string;
  status: "running" | "completed" | "partial_failure";
  createdAt: string;
  completedAt: string | null;
  executions: Array<{
    id: string;
    variant: "A" | "B";
    prompt: string;
    output: string | null;
    latencyMs: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    estimatedCostUsd: number | null;
    status: "completed" | "failed";
    errorMessage: string | null;
  }>;
};
```
