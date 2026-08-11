# Phase 1 — Prompt Playground

**Status: Complete.**

## What we built

A workspace where a product manager can:

- Write two versions of a prompt (Prompt A and Prompt B).
- Pick a model.
- Enter one question or input.
- Run both prompts against that same input.
- See both answers side by side, with:
  - Latency (how fast the model replied)
  - Token usage (how much text was processed)
  - Estimated cost
  - A projected cost at a chosen usage scale (queries per day/week/month)
- Every run is saved to comparison history, so you can revisit past runs.

## Models

Two free models, called through OpenRouter:

- OpenAI gpt-oss-20b (free)
- Google Gemma 4 31B (free)

## Reliability fixes included

- Auto-retry with backoff when a free model is rate-limited.
- Friendly, clear error messages instead of raw technical errors.
- Fixed a crash that could happen when viewing very old runs.

## Why it matters

Phase 1 is manual experimentation: it answers
"which prompt gives the better answer for this one example?"

It does not yet answer "will this prompt work well across many real
situations?" — that is exactly what Phase 2 (dataset evaluation) is for.
