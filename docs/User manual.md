# User Manual

## Overview

AI-Evals Studio is an AI evaluation workspace for comparing prompt variants, running benchmark datasets, and analyzing failures before release.

Current capabilities:
- Home: a public landing page that explains the product and links straight into the three workspaces.
- Phase 1: compare two prompt variants on a single input, stop or retry a run, and save the comparison history.
- Phase 2: build a dataset of scenarios, run both prompts across the dataset, and review per-case outputs, latency, tokens, and estimated cost.
- Phase 3: score responses with an LLM judge, including per-criterion results and pass rates.
- Phase 4: run experiments (baseline vs candidate), detect regressions, control runs (Stop / Resume / Restart), and record a product decision.
- Phase 5: accounts and multi-provider credentials (Platform Free + BYOK across OpenAI, Anthropic, Google Gemini, DeepSeek, OpenRouter) and Failure Analysis with regression-case creation.

This manual is the living guide for the platform. It will be updated after every completed phase.

## Home (start here)

`/` is the Home page and it is public — you can read it before signing in.

- A short explanation of what the product is for.
- Three clickable cards that open the three workspaces: **Prompt Playground**, **Datasets**, and **Experiments**.
- A **Write → Evaluate → Decide** strip that summarises the workflow.
- An **About the builder** section with the background of the person who built this platform.

Signing in returns you to Home. From there the top navigation is the fastest way around:

| Navigation item | Opens | Sign-in needed |
| --- | --- | --- |
| **Home** | `/` — product overview and About | No |
| **Playground** | `/playground` — compare two prompts on one input | Yes |
| **Datasets** | `/datasets` — sample datasets for everyone; your own are private | Sample data: no |
| **Experiments** | `/experiments` — baseline vs candidate with judging | Yes |
| **Manual** | `/manual` — this document | No |

Your account and API keys live behind the avatar button in the top-right corner (**Settings**).

## Getting started

The whole product runs on a single port (`5101`). The API server also serves the built web app, so there is only one process and one URL.

1. Build and start the app locally:
   - `npm run dev` (builds both apps and starts the server)
   - Open the app in the browser at `http://localhost:5101`.
2. Ensure `DATABASE_URL` is configured in the root `.env` (`PORT=5101`), plus `ENCRYPTION_KEY` and `SESSION_COOKIE_SECRET`.
3. You land on the public **Home** page. Choose **Sign in to start**, then either sign in with a username/email and password, **Continue with Google** (when configured), or **Create an account**.
4. Standard accounts receive five platform-funded evaluations; Admin and any account listed in `FULL_ACCESS_USERNAMES` have unlimited Platform Free access (see *Accounts & your private workspace*).
5. Use the **Datasets** page to create benchmark datasets and evaluate prompt quality.

> Port notes: the app always runs on `5101`. Before starting, stop any other Node servers so no other app ports (e.g. `3001`, `5173`) are in use.

## Accounts & your private workspace

- **Creating an account:** open **Create an account** on the sign-in page and choose a name, email, and password (at least 8 characters).
- **Signing in:** enter your **username or email** plus your password. **Continue with Google** is also available when the deployment configures it; it stores the Google identity mapping, never provider tokens in the browser.
- **Forgot your password?** Use **Forgot password?** on the sign-in page. Enter your email to receive an in-app reset code, then set a new password with that code. All existing sessions are signed out after a reset.
- **Change your password:** **Settings → Security**. Signing out everywhere else happens automatically.
- **Platform Free evaluations:** standard accounts receive five complete platform-funded runs. Admin, the configured Tester, and any username listed in `FULL_ACCESS_USERNAMES` have unlimited access. A run can cover many scenarios; it counts as one evaluation. Invalid requests and incomplete/failed runs do not consume a credit.
- **Checking your usage:** **Settings → Usage & plan** shows how many Platform Free evaluations you have left, how many are in progress, and — for unlimited accounts — the word **Unlimited** instead of a number.
- **Your API keys (BYOK):** optional. Go to **Settings → API keys**, pick a provider, give the key a **label**, and save it. You can add **several keys per provider** (for example `Personal` and `Work`) and each one is a separate selectable option. Each saved key appears as its own card where you can rename it, replace the key, reload its model list, or remove it.
- **Providers:** OpenAI, Anthropic, Google Gemini, DeepSeek, and OpenRouter.
- **Free models only on Platform Free:** Platform Free models are discovered dynamically from OpenRouter's free catalog and use the platform account. BYOK models are discovered from your own key.
- **Private workspace:** your datasets, evaluations, and experiments are visible only to you. The two sample datasets (Customer Support, Travel - Flights) are shared and read-only for everyone.
- **Sign out:** use **Settings → Sign out** or the top-right menu.

## Phase 1 workflow: prompt comparison

When you want to compare two prompt variants on one example:

1. Open the **Playground** page (`/playground`).
2. Select a model and enter a shared input.
3. Write Prompt A and Prompt B.
4. Run the comparison. The run starts immediately and the page updates on its own as each prompt answers — you can leave the page without losing the run.
5. Review the outputs side by side with latency, token counts, and estimated cost.
6. Use the saved history to revisit earlier comparisons.

### Playground run controls

| Control | When it appears | What it does |
| --- | --- | --- |
| **Stop run** | While the run is in progress | Ends the run and keeps whatever already finished. The run becomes **Interrupted**. |
| **Retry** | On an interrupted or partially failed run | Starts a **new comparison** with the same model, input, and prompts. The old run stays in the history. |
| **Discard** | On any finished run | Deletes the run and its responses. This cannot be undone. |

The same controls appear on each row of **Recent runs**, so you can clean up or retry directly from the list.

A run shows **Interrupted** when you stop it, or when the server restarted while it was still running. Interrupted runs are never left spinning: on the next start the platform closes them automatically, and you can Retry or Discard from the history.

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

## Current phase status

- Home: complete — public landing page with product overview and About the builder.
- Phase 1: complete — single input prompt comparison with history, plus Stop / Retry / Discard run controls.
- Phase 2: complete — dataset evaluation, benchmark scenarios, saved runs.
- Phase 3: complete — automated LLM judging and per-criterion scoring.
- Phase 4: complete — experiments and reproducible snapshots.
- Phase 5: complete — accounts, multi-provider Platform Free + BYOK credentials, immutable configuration snapshots, server-enforced quota policy, and Failure Analysis with regression-case creation.

Known limits are listed under *What this does not do* near the end of this manual.

## Phase 4 workflow: experiments and decisions

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

- **Partial retry** — if some scenarios fail to evaluate (timeout, rate limit, evaluator error), the detail page shows an "Evaluation status" section with per-configuration completion counts and a **Resume** button. Resuming only re-runs the missing or failed scenarios; successful results are never re-run or overwritten. A low judge score is a quality failure, not an execution failure — it is never retried.
- **Evaluation configuration** — experiment creation has a dedicated **EVALUATION CONFIGURATION** section (Human judgement vs LLM-as-a-Judge, judge model, pass threshold, judge prompt). The evaluator is separate from the target model, and this is shown clearly on both the wizard and the detail page.
- **Metric colors** — quality metrics (score, pass rate) are green when the candidate improves and red when it declines; operational metrics (latency, tokens, cost) are green when lower. Zero change is neutral.
- **Criterion tooltips** — criteria such as Accuracy and Completeness show an ⓘ icon explaining their meaning.
- **Recommendation** — the detail page shows an evidence-based **Recommendation** (Promote Candidate / Keep Baseline / Continue Experiment / Insufficient data) built from deterministic rules. It is advisory only — you still make the final decision.
- **Iterations** — choosing **Continue Experiment** creates a **new iteration** (previous candidate becomes the new baseline) instead of overwriting results. Iterations are numbered and listed on the detail page; each is an immutable snapshot. If you change the evaluator configuration (or dataset) between iterations, a **comparability warning** is shown.
- **Reproducibility** — each result stores a snapshot of the test-case input, golden answer, and rubric, so historical experiments keep showing the original benchmark even if the dataset changes later.

#### Run controls: Stop, Resume, Restart

An experiment can take a while on a large dataset, and free models are sometimes rate-limited. Three controls at the top of the Experiment Detail page let you steer a run without losing work:

| Control | When it is available | What it does |
| --- | --- | --- |
| **Stop** | While the run is in progress | Halts the run. Every scenario already evaluated is **kept**; the rest stay pending. The experiment moves out of "running" and shows as incomplete. |
| **Resume** (shows the number of scenarios left) | When a run is stopped, partially failed, or has missing results | Continues **the same run** from where it stopped — only the scenarios that are missing or failed are evaluated again. Successful results are never re-run or overwritten. |
| **Restart** | Whenever a previous run exists | Starts a **brand-new run** of every scenario with the current configuration. The previous run's results are kept in history; nothing is deleted. |

Notes:

- **Resume** is also the tool for rate limits. If scenarios failed because a model was rate-limited, open the "Evaluation status" panel, switch the Baseline / Candidate / Judge model to a different one, then resume — the finished results stay untouched.
- **Restart** consumes one platform-funded evaluation credit (same as a first run); **Resume** continues the existing run and does not.
- A low judge score is a **quality** failure, not an execution failure. Those results are already complete, so they are never re-run by Resume — that is a real finding, not an error.
- Progress updates every few seconds on its own, including after a Resume.

## Model providers (Platform Free vs BYOK)

Every model selector in the product — Playground, dataset evaluation, experiment baseline/candidate, and the judge — uses the same list. Each entry reads:

`[Category] · [Provider] · [Key Label] · [Model]`

Examples:

- `Platform Free · OpenRouter · Default · [Model]`
- `BYOK · Anthropic · Pro_key · [Model]`
- `BYOK · DeepSeek · Work · [Model]`

The same model reached through two different keys appears as **two separate entries**, so you always know which credential a run will use.

**Platform Free** is funded by the platform and counts against your five free evaluations. **BYOK** runs use your own key and do not consume platform credits.

### Managing connections

1. Open **Settings → API keys** (avatar menu → Settings).
2. In **Add a connection**, choose a provider, type a **connection label**, and paste the API key.
3. Click **Validate and save**. The platform lists the provider's models and then sends a **single-token test request** with the cheapest model, so a key that cannot actually run a request is rejected instead of silently saved.
4. The connection appears as its own card and its models show up in every model selector immediately — no page reload needed.
5. On each card you can:
   - **Rename or replace key** — change the label, paste a new key, or both.
   - **Refresh models** — reload that key's model list.
   - **Remove** — asks for confirmation first, then deletes the connection.

Each card also shows the masked key (last four characters), when the connection was added, and when its model list was last refreshed.

If a card says **Models not loaded**, click **Load models** once. This happens for keys that were imported from an older version of the product, because the platform cannot fetch a model list without calling the provider.

### What happens when you change or remove a key

- Adding, renaming, replacing, or removing a connection refreshes the model list right away.
- If a connection is removed, any selection that pointed at it is **cleared** rather than silently switched to another key.
- Runs whose configuration is already frozen keep their recorded provider, category, connection label, and model, so historical results stay readable. The stored credentials are never part of that record.

## Failure analysis

Phase 5 adds a **Failure Analysis** layer on top of the existing judge results. It reuses the same evaluations — it does not create a second evaluation engine.

### On the Experiment Detail page

- **Evidence breakdown** — how many scenarios are new candidate regressions, improved, genuine candidate quality failures, or incomplete/errored.
- **Failure patterns** — deterministic categories derived from the rubric criteria and the judge's own words: unsupported claims, missing information, incorrect next steps, instruction violations, incomplete responses, criterion failures, and an explicit **unclassified** bucket when evidence is thin.
- **Criteria most often failed** — which rubric criteria fail most across the dataset.
- **Per-scenario failure detail** — expand any scenario to see the input, golden answer, rubric, baseline and candidate outputs, the judge's score, pass/fail, summary and per-criterion reasons, plus the model, latency, and status of each execution.

Failures are clearly separated into:

- **Genuine quality failure** — the judge scored the answer and it did not meet the bar.
- **Regression** — the candidate passed less than the baseline.
- **Execution error** — the model call itself failed.
- **Evaluator error** — the judge returned a malformed or failed response. This is shown as an evaluator problem, **not** as a low-quality AI answer.
- **Missing result** — a required execution or judgement is absent.

### Suggested next steps

Each failure comes with evidence-backed suggestions such as clarifying an instruction, adding an explicit constraint, tightening a rubric criterion, adding an edge case, or investigating a model-specific regression. Every suggestion cites the scenario (and usually the criterion) behind it, and is labelled as a **hypothesis** — the platform never rewrites or deploys prompts for you.

### Turning a failure into a regression case

1. Expand a failing (or improved) scenario on the Experiment Detail page.
2. Click **Create regression case**.
3. The platform creates a **new, separate dataset** containing that scenario, preserving the input, the golden answer, and the rubric, and linking it back to the original result.

The original dataset and all historical evaluations are **never modified**.

If the captured scenario has no golden answer or no rubric, the new case is marked **Requires human review**. You can clear that marker from the dataset page once the expected behaviour has been confirmed.

### Re-evaluating regression cases

A regression dataset is a normal dataset, so you can run it through the existing evaluation or experiment flow to confirm a fix. Nothing new is required.

## What this does not do

By design, the platform does **not**:

- automatically rewrite or deploy prompts,
- make release decisions for you (the recommendation is advisory),
- fail over automatically between credentials,
- monitor live production traffic,
- use consumer subscription logins (Claude/ChatGPT/Gemini) or bill users.

Reviewer queues, human approval workflows, and richer release-intelligence dashboards remain future work.

## For operators

These settings live in the server `.env` and cannot be changed from the UI:

| Setting | Purpose |
| --- | --- |
| `FULL_ACCESS_USERNAMES` | Comma-separated, case-insensitive usernames that get unlimited Platform Free usage in addition to Admin and the configured Tester. |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Emergency Admin account, recreated on every server start. |
| `TESTER_USERNAME` / `TESTER_PASSWORD` | Optional demo account with full access. |
| `OPENROUTER_API_KEY` | Funds Platform Free model discovery and runs. |
| `PLAYGROUND_CALL_TIMEOUT_MS` | How long a single Playground model call may take before it is marked as timed out (default 60000). |
| `KEY_VALIDATION_PROBE` | Set to `false` to skip the one-token inference check when saving a provider key (not recommended). |

## Updating this manual

After each phase or major feature completion, update this document with:
- what is new
- workflow changes
- feature guidance and best practices
- any limitations or non-goals

This keeps the user manual aligned with the product and makes the repository easier to demo as a portfolio project.
