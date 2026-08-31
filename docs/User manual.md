# User Manual

## Overview

Prompt Playground is an AI evaluation workspace for comparing prompt variants and running benchmark datasets.

Current capabilities:
- Phase 1: compare two prompt variants on a single input and save the comparison history.
- Phase 2: build a dataset of scenarios, run both prompts across the dataset, and review per-case outputs, latency, tokens, and estimated cost.

This manual is the living guide for the platform. It will be updated after every completed phase.

## Getting started

The whole product runs on a single port (`5101`). The API server also serves the built web app, so there is only one process and one URL.

1. Build and start the app locally:
   - `npm run dev` (builds both apps and starts the server)
   - Open the app in the browser at `http://localhost:5101`.
2. Ensure `DATABASE_URL` is configured in the root `.env` (`PORT=5101`), plus `ENCRYPTION_KEY` and `SESSION_COOKIE_SECRET`.
3. **Create an account** (or sign in) and add your own OpenRouter key in **Settings**. Each user brings their own key — the host's key is never used for your calls.
4. Use the `Datasets` page to create benchmark datasets and evaluate prompt quality.

> Port notes: the app always runs on `5101`. Before starting, stop any other Node servers so no other app ports (e.g. `3001`, `5173`) are in use.

## Accounts & your private workspace

- **Sign up / Sign in:** open the landing page and choose **Create an account** (name, email, password) or **Sign in**. Sessions use a secure httpOnly cookie.
- **Forgot password:** on the sign-in page choose *Forgot password?*, enter your email, and use the one-time reset code shown on screen to set a new password.
- **Your OpenRouter key:** go to **Settings → Your OpenRouter key** and save it. It is validated, then encrypted and stored on your account; it is used only for model calls you make.
- **Private workspace:** your datasets, evaluations, and experiments are visible only to you. The two sample datasets (Customer Support, Travel - Flights) are shared and read-only for everyone.
- **Sign out:** use **Settings → Sign out** or the top-right menu.

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

## Phase 3 workflow: automated judging and review

Phase 3 adds optional automated evaluation using an LLM-based judge that scores each prompt response against the test case and any supplied evaluation criteria. Judgements include an overall score (0–100), a pass/fail flag based on a configurable threshold, a short summary, and per-criterion scores and reasons.

How to run with the judge enabled:
1. Open a dataset and click `Run evaluation`.
2. Toggle "Evaluate results with an LLM judge" in the run form.
3. (Optional) Choose the judge model, set a pass threshold (percent), and edit the judge prompt used to guide scoring.
4. Start the run. Judgements are produced after each successful model call and saved with the result.

How to read judge output in the UI:
- The results page shows a judge summary at the top of the run when a judge was used (model and threshold).
- Each result cell that was judged displays a pass/fail pill, the overall score, a short summary, and an expandable list of per-criterion results with scores and optional reasons.
- Use the pass/fail pill and the score to quickly identify regressions between Prompt A and Prompt B.

Guidance and best practices:
- Provide concise, actionable evaluation criteria (one per line) when adding test cases to get focused per-criterion scores.
- Start with a modest pass threshold (e.g., 60–70%) and adjust after reviewing judge output on a sample dataset.
- Treat judge output as decision support — inspect summaries and per-criterion reasons before making product decisions.

Human review and future scope:
- Phase 3 focuses on automated LLM judgement and persistence. Human-in-the-loop review, reviewer queues, and consensus workflows are planned for a later phase and are documented in the roadmap.

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

The platform now includes accounts and private workspaces, but still does not provide email-based password reset (reset codes are shown in-app), role-based access / admin, reviewer queues, dashboards, or built-in hallucination detection.

Those features are planned for later phases.

## Current phase status

- Phase 1: complete — single input prompt comparison with history.
- Phase 2: complete — dataset evaluation, benchmark scenarios, saved runs.
- Phase 3: complete — automated LLM judging and per-criterion scoring.
- Phase 4: complete — experiments and reproducible snapshots.
- Phase 5: complete — accounts (SSO), per-user OpenRouter keys, private workspaces, in-app User Manual.

### Phase 4 workflow: experiments and decisions

Phase 4 makes Experiments a first-class product concept. An experiment is a controlled comparison between two AI configurations — a **Baseline** (the current configuration) and a **Candidate** (the proposed configuration) — evaluated on the same golden dataset. It answers: *"Did my AI change actually improve the product?"*

The experiment journey is self-contained under the **Experiments** navigation item — it is not run from inside the Dataset flow.

#### Create an experiment (`/experiments` → `+ New Experiment`)

The creation wizard walks through four steps:

1. **Define** — give the experiment a name and a hypothesis (e.g. "Adding explicit refund-handling instructions will reduce false refund claims").
2. **Dataset** — pick the golden dataset. Both configurations will be evaluated against every scenario.
3. **Configure** — define the **Baseline** (current configuration) and the **Candidate** (proposed configuration), each with a prompt and a model. Optionally enable the LLM judge (judge model, pass threshold, judge prompt).
4. **Review** — review the full configuration, then click **Run Experiment**.

#### What happens when you run an experiment

- The configuration is **frozen** — the exact prompts, models, and evaluator settings are preserved as snapshots.
- The Baseline and Candidate are both evaluated on the same dataset using the Phase-3 LLM judge.
- You are taken to the Experiment Detail page, which shows progress while the run is active.

#### Experiment Detail (`/experiments/:id`)

This page answers "did my change improve the AI?" at a glance:

- **Configuration comparison** — Baseline vs Candidate (prompt + model), with a "View prompts" toggle.
- **Result summary** — Average score, pass rate, average latency, total tokens, and total cost for each configuration with signed deltas (candidate − baseline). Pass-rate deltas are shown in **percentage points (pp)**, not %.
- **Criterion performance** — per-criterion average scores and deltas (e.g. Accuracy +9 pp, Completeness +3 pp).
- **Scenario performance** — every scenario with Baseline → Candidate scores and pass changes. Regressions are highlighted in red.
- **Regressions** — a dedicated panel listing every scenario or criterion where the candidate scored lower than the baseline.
- **Evidence** — expand any scenario to inspect the input, golden answer, baseline/candidate outputs, and the judge's score for each.
- **Decision** — choose **Promote Candidate**, **Keep Baseline**, or **Continue Experiment**, add a rationale, and save. The system provides evidence; the human makes the product decision.

#### Experiment history

Completed experiments remain on the `/experiments` list with their latest score/pass-rate deltas and the recorded decision, so the product team can revisit historical comparisons later.

#### Reproducibility

Because the configuration is snapshotted at run time, later changes to the dataset or source prompts **do not** alter historical experiment results. Each result also stores a raw response snapshot and model metadata for forensic debugging.

#### Best practices

- Start with a small dataset (6–12 test cases) to validate prompts and judge configuration before scaling.
- Write a clear hypothesis so the experiment has a decision-relevant question.
- When the candidate regresses on specific scenarios or criteria, inspect the raw evidence (golden answer, outputs, judge reasons) before deciding.
- Use experiments for formal A/B comparisons where you expect to make a product decision; use the Playground for quick prompt exploration.

#### Refinements: retry, evaluation config, recommendation, iterations

- **Partial retry** — if some scenarios fail to evaluate (timeout, rate limit, evaluator error), the detail page shows an "Evaluation status" section with per-configuration completion counts and a **Retry failed scenarios** button. Retrying only re-runs the failed scenarios; successful results are never re-run or overwritten. A low judge score is a quality failure, not an execution failure — it is never retried.
- **Evaluation configuration** — experiment creation has a dedicated **EVALUATION CONFIGURATION** section (Human judgement vs LLM-as-a-Judge, judge model, pass threshold, judge prompt). The evaluator is separate from the target model, and this is shown clearly on both the wizard and the detail page.
- **Metric colors** — quality metrics (score, pass rate) are green when the candidate improves and red when it declines; operational metrics (latency, tokens, cost) are green when lower. Zero change is neutral.
- **Criterion tooltips** — criteria such as Accuracy and Completeness show an ⓘ icon explaining their meaning.
- **Recommendation** — the detail page shows an evidence-based **Recommendation** (Promote Candidate / Keep Baseline / Continue Experiment / Insufficient data) built from deterministic rules. It is advisory only — you still make the final decision.
- **Iterations** — choosing **Continue Experiment** creates a **new iteration** (previous candidate becomes the new baseline) instead of overwriting results. Iterations are numbered and listed on the detail page; each is an immutable snapshot. If you change the evaluator configuration (or dataset) between iterations, a **comparability warning** is shown.
- **Reproducibility** — each result stores a snapshot of the test-case input, golden answer, and rubric, so historical experiments keep showing the original benchmark even if the dataset changes later.

## Updating this manual

After each phase or major feature completion, update this document with:
- what is new
- workflow changes
- feature guidance and best practices
- any limitations or non-goals

This keeps the user manual aligned with the product and makes the repository easier to demo as a portfolio project.
