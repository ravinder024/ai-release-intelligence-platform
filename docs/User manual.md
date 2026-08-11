# User Manual

## Overview

Prompt Playground is an AI evaluation workspace for comparing prompt variants and running benchmark datasets.

Current capabilities:
- Phase 1: compare two prompt variants on a single input and save the comparison history.
- Phase 2: build a dataset of scenarios, run both prompts across the dataset, and review per-case outputs, latency, tokens, and estimated cost.

This manual is the living guide for the platform. It will be updated after every completed phase.

## Getting started

1. Start the API and web app locally:
   - `npm run dev`
   - Open the web app in the browser at `http://localhost:5173`.
2. Ensure `DATABASE_URL` and `OPENROUTER_API_KEY` are configured in the root `.env`.
3. Use the `Datasets` page to create benchmark datasets and evaluate prompt quality.

## Phase 1 workflow: prompt comparison

When you want to compare two prompt variants on one example:

1. Open the `Playground` page.
2. Select a model and enter a shared input.
3. Write Prompt A and Prompt B.
4. Run the comparison.
5. Review the outputs side by side with latency, token counts, and estimated cost.
6. Use the saved history to revisit earlier comparisons.

Use Phase 1 when you are exploring prompt directions or validating a quick prompt change.

## Phase 2 workflow: dataset evaluation

Phase 2 is designed for repeatable, use-case-level prompt evaluation.

### Create a dataset

1. Go to `Datasets`.
2. Click `New dataset`.
3. Enter a name, optional use case, and optional description.
4. Save the dataset.

### Add test cases

For each scenario, provide:
- Input: the user query or example prompt content.
- Expected Output: optional guidance about the desired result.
- Notes: optional context or scoring comments.

Keep datasets under 50 scenarios for faster runs and predictable results.

### Run an evaluation

1. Open a dataset.
2. Click `Run evaluation`.
3. Select a model.
4. Enter Prompt A and Prompt B.
5. Start the evaluation.
6. The system runs every test case through both prompts and saves all results.

### Review results

Once the evaluation completes, review:
- Input scenario
- Prompt A output
- Prompt B output
- Latency for each call
- Token usage for each call
- Estimated cost for each result

The results page shows progress while the run is still `running`, then preserves a completed record for review.

## How to use the playground effectively

- Start with a small dataset to validate prompt structure before scaling up.
- Capture a clear `expected output` when you want the prompt to follow a specific style or contain key details.
- Use notes to explain edge cases or user intent so future reviewers understand the benchmark context.
- Compare output quality by looking at both the answer content and the supporting telemetry:
  - lower latency may be good for speed-sensitive workflows
  - token usage helps understand cost and verbosity
  - estimated cost is useful even for free models, especially once paid models are added later
- Keep prompt variants focused on the behavior difference you want to test: tone, clarity, brevity, or structure.

## What this platform does not do yet

Phase 2 intentionally does not include:
- AI judging or automatic scoring
- pass/fail labeling
- hallucination detection
- dashboards or team collaboration
- prompt versioning
- authentication

Those features are planned for later phases.

## Current phase status

- Phase 1: complete — single input prompt comparison with history.
- Phase 2: complete — dataset evaluation, benchmark scenarios, saved runs.
- Phase 3: planned — next phase will extend evaluation capabilities while preserving the current workflow.

## Updating this manual

After each phase or major feature completion, update this document with:
- what is new
- workflow changes
- feature guidance and best practices
- any limitations or non-goals

This keeps the user manual aligned with the product and makes the repository easier to demo as a portfolio project.
