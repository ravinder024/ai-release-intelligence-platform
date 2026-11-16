# Implementation Notes — Phase 5A Model Providers (Platform Free + multi-connection BYOK)

This document captures the implementation decisions for the multi-provider credential layer.
It complements `docs/User manual.md` (end-user behaviour) and `AGENTS.md` (project memory).

> Status: implemented at code level. Automated tests and regression verification are deferred
> to the post-implementation verification pass.

## Goal

Replace the single account-level OpenRouter key with:

1. **Platform Free** — a dynamically discovered OpenRouter free-model catalog funded by the platform.
2. **BYOK** — many labelled connections per user, each with its own provider, key, and model catalog.

Both feed the same shared model selector, and every run stores an immutable selection snapshot.

## Data model (`apps/api/prisma/schema.prisma`)

- New enum `ApiProvider`: `openai | anthropic | gemini | deepseek | openrouter`.
- New model `ProviderConnection`: `userId`, `provider`, `label`, `encryptedKey`, `keyLast4`, `modelCatalog` (JSON), `catalogUpdatedAt`, timestamps. Indexed by `(userId, provider)`; cascades on user delete. Raw keys are never selected into API responses.
- New snapshot columns (all nullable JSON, added for backwards compatibility):
  - `PromptComparison.modelConfig`
  - `EvaluationRun.modelConfigA`, `modelConfigB`, `evaluatorConfig`
  - `Experiment.modelConfigA`, `modelConfigB`, `evaluatorConfig`
- Snapshot shape is `ModelSelectionSnapshot`: `modelId`, `provider`, `source` (`platform_free | byok`), optional `connectionId`, `keyLabel`, and the pricing/context metadata discovered for that model. **No credential is ever stored in a snapshot.**
- The legacy `User.openRouterKey*` columns are retained and still honoured (see Migration).

## Migration

`apps/api/prisma/migrations/20261017090000_phase5_provider_connections_failure_analysis/migration.sql`

1. Creates `ApiProvider` and `provider_connections`.
2. Migrates each existing user key into a `Default` OpenRouter connection (same ciphertext, no re-encryption).
3. Adds the snapshot columns, `dataset_test_cases.requires_review`, and `dataset_test_cases.source_result_id` (FK → `evaluation_results`, `ON DELETE SET NULL`).
4. Backfills sanitized snapshots for pre-existing comparisons, runs, and experiments so historical records stay interpretable. Backfill uses correlated subqueries (no lateral join) and only touches rows where the snapshot is still null.
5. Legacy rows whose key predates last-four metadata get a non-derived `????` mask instead of leaking ciphertext characters.

## Provider adapters (`apps/api/src/providerRegistry.ts`)

- `discoverProviderModels(provider, apiKey)` reads each provider's native model-list API:
  - OpenAI / DeepSeek / OpenRouter: `GET /models` with bearer auth.
  - Anthropic: `GET /models` with `x-api-key` + `anthropic-version`.
  - Gemini: `GET /v1beta/models` with the `x-goog-api-key` header (never the query string).
- Non-chat models (embeddings, moderation, audio, image, TTS, realtime, transcription, search) are filtered out.
- `discoverPlatformFreeModels()` selects OpenRouter entries whose prompt **and** completion prices are both `0`.
- `ApiKeyModelProvider` implements the existing `ModelProvider` interface. Anthropic uses the Messages API (`system` + `messages`, `content[]` → text); the others use the OpenAI-compatible `chat/completions` shape.
- `validateProviderKey(provider, apiKey)` discovers models and issues one tiny probe call, so a bad key fails at connect time rather than mid-run.
- Errors are scrubbed of the API key before they can be returned or logged (`safeProviderError`).

## Credential resolution (`apps/api/src/services/modelSelection.ts`)

- `resolveModelSelection(userId, selection)` — the only path for new work:
  - `platform_free` must be OpenRouter with no `connectionId`, and the model must still exist in the live free catalog; uses the server-owned key.
  - `byok` requires an owned `connectionId`, validates the model against that connection's stored catalog, and decrypts the key server-side.
  - A removed connection or delisted model produces an explicit error — there is **no** silent fallback to another key.
- `resolveLegacyModel(userId, modelId)` preserves Phase 1–4 behaviour for requests without an explicit selection: a saved OpenRouter key (now the migrated `Default` connection) takes precedence, then the platform key.
- `providerSnapshot(value)` is the single guard used when reading snapshots out of JSON columns, so malformed legacy data degrades to `null` instead of crashing a page.

## API (`apps/api/src/routes/providers.ts`)

| Route | Purpose |
| --- | --- |
| `GET /api/provider-connections` | List this user's connections (masked). |
| `POST /api/provider-connections` | Validate, then create with label + catalog. |
| `PATCH /api/provider-connections/:id` | Rename a label and/or replace the key (revalidated). |
| `POST /api/provider-connections/:id/refresh` | Re-discover models for that connection. |
| `DELETE /api/provider-connections/:id` | Remove a connection (owner-scoped). |
| `GET /api/model-catalog` | `{ platformFree, byok, connections }` for the shared selector. |

Ownership is enforced on every route via `authRequired` plus a `userId` predicate, including the
delete (implemented as `deleteMany` with the owner filter, so a foreign id simply 404s).

### Execution paths

- `executeRun` (evaluations) now takes `providerA`, `providerB`, `evaluatorProvider` and per-variant
  configs, so baseline, candidate, and judge can each use a different provider and connection.
  Model metadata is written into `EvaluationResult.modelMetadata`; cost comes from the snapshot's
  catalog pricing (or a legacy lookup).
- Experiment create / run / resume / retry / iteration all resolve their selections through
  `resolveExperimentProviders`, and restart re-resolves the frozen snapshot so a deleted connection
  fails loudly instead of silently switching credentials.
- Prompt comparisons resolve the same way and store `modelConfig`.

## Quota policy (`apps/api/src/services/usage.ts`)

The five-free-completed-evaluations ledger is unchanged in shape, but the funding decision now
follows the **selected source**, not the user's key:

- A run is platform-funded only if at least one selected model (baseline, candidate, or judge) is
  `platform_free`.
- One credit per completed dataset evaluation; one credit per completed experiment (both
  configurations together); BYOK-only runs consume none.
- A credit is marked consumed only when the run finishes as `completed`. Failed, partial, or
  stopped runs settle to `released`.
- `reservePlatformCreditForRun` atomically re-opens a released reservation when an incomplete
  platform-funded run is resumed. It is serializable, re-checks the allowance, and refuses to touch
  a `consumed` reservation.

## Frontend (`apps/web/src`)

- `useModels.ts` — new `useProviderModels()` hook returning `{ options, connections, loading, checkedAt, refresh }` from `GET /api/model-catalog`. The older `useModels()` hook remains for compatibility.
- `components/ModelSelector.tsx` — accepts `options` and renders `[Category] · [Provider] · [Key Label] · [Model]`. Values are canonical JSON selection objects via `encodeModelSelection` / `decodeModelSelection`, so the same model under two keys stays two distinct, selectable entries. An empty option is always present, so a cleared selection never looks like an automatic switch.
- `pages/SettingsPage.tsx` — connection manager: add (provider + label + key), rename/replace, refresh models, remove. Every mutation awaits `refreshCatalog()`, so the model lists update without a page reload.
- `PlaygroundPage`, `RunEvaluationPage`, `NewExperimentPage`, `NewIterationPage`, `ExperimentDetailPage` — all use the shared selector, submit explicit selections, and clear a selection that points at a removed connection. Experiment resume/retry switches models by connection, not by name.

## Security properties

- Keys are AES-256-GCM encrypted at rest and never returned after storage (only `••••1234`).
- Credentials are decrypted only server-side, immediately before the provider call.
- No credential is persisted in snapshots, experiment records, or results.
- Provider errors are scrubbed of key material before surfacing.
- Gemini key discovery uses a header rather than a URL parameter.

## Follow-ups for the verification pass

- Apply the migration against a copy of a populated database and confirm the legacy backfill.
- Exercise add/rename/replace/remove with real keys for each of the five providers.
- Confirm the quota ledger across completed, failed, stopped, and resumed platform runs.
- Confirm a removed connection blocks resume with a clear message rather than falling back.
