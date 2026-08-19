# User Flows — Run → Judge → Review (Phase 3)

1. Create dataset
  - User creates dataset and adds test cases with optional evaluation criteria (one per line).

2. Run evaluation with judge
  - User opens `Run evaluation`, toggles "Evaluate results with an LLM judge", configures model/threshold/prompt, and starts the run.
  - System creates an `EvaluationRun` with status `running` and starts background tasks.

3. Judge execution
  - For each successful prompt result, the evaluator service is called. On success, an `EvaluationJudgement` and related `EvaluationCriterionResult` rows are persisted.
  - If the judge fails, the result is marked with a failed judgement and the error is recorded.

4. Review results
  - User opens Results page and sees a judge summary at the top when a judge was used.
  - Each result cell shows judge pass/fail, overall score, summary, and per-criterion details accessible via an expand control.

5. Next steps
  - User iterates on prompts, adjusts judge threshold, and reruns runs as needed. Human review workflows are planned later.
