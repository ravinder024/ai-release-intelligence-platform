# Phase 2 — Dataset Evaluation

**Status: Complete.**

## What we built

Phase 2 takes the single-example comparison from Phase 1 and runs it across a
whole set of realistic examples. It answers: "does this prompt work well across
many real situations, not just this one question?"

A product manager can now:

- Create datasets (name, use case, description) containing many test scenarios.
  Each scenario has a question/input, an optional "expected output" hint, and
  optional notes.
- Open a dataset, add/edit/delete scenarios, and keep the dataset tidy.
- Run an evaluation: pick a dataset, a model, and both prompts — every scenario
  is run through **both** prompts automatically.
- Watch a progress bar while the run happens in the background, and come back
  later — results are saved and shown in a results page.
- Read a per-scenario results table: input → Prompt A output → Prompt B output →
  latency → tokens → cost. Failed scenarios show a friendly error instead of a
  blank cell.

## Screens

Four clean, focused pages (decluttered, Linear/Vercel/Notion feel):

1. **Datasets** — list of datasets + recent evaluation runs, with quick "New
   dataset" and "Run evaluation" actions.
2. **Dataset detail** — edit dataset info, add/edit/delete scenarios.
3. **Run evaluation** — choose model and write both prompts before starting.
4. **Results** — live progress bar while running, then the full results table.

## Sample data

A **"Customer Support"** dataset is pre-loaded (7 billing/account/usage
scenarios) so the whole flow is instantly demoable. It is seeded by running:

```
npm run db:seed
```

The seed is safe to re-run: it creates the sample dataset if missing, updates
its description, and adds any missing scenarios without touching existing
scenarios or evaluation history.

## Reliability & anti-deadlock fixes

The previous attempt left runs that could never finish. These were fixed:

- **Results page 500 error (fixed).** `GET /api/evaluations/:id` crashed because
  the same Prisma query used both `select` and `include` on one relation, which
  Prisma rejects. It now returns the run and its results correctly.
- **Runs can no longer get stuck in "running".** The background executor now
  catches every failure and always closes out a run as `completed` or
  `partial_failure` with a finish time — even if a model call, a database write,
  or the whole run crashes.
- **Startup recovery.** If the API server restarts mid-run, any run left in
  "running" is automatically marked `partial_failure` on boot, so the progress
  page never spins forever.
- **Rate-limit friendly.** Scenarios run a few at a time (concurrency of 3) with
  retry-with-backoff, matching the Phase 1 approach, so free models aren't
  hammered.

## Models

Same two free models through OpenRouter (unchanged from Phase 1):

- OpenAI gpt-oss-20b (free)
- Google Gemma 4 31B (free)

## Deliberately not in Phase 2

Per the agreed scope, none of these were added: AI judging, scores, pass/fail,
human review, dashboards, versioning, auth, or team features. That is future
work.

## Why it matters

Phase 1 answered "which prompt is better for one example?" Phase 2 answers
"which prompt is better across a real workload?" — the difference between a
lucky example and a defensible prompt decision.
