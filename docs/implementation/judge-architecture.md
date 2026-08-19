# Judge Architecture (Phase 3)

Overview
: The judge is an automated LLM-based evaluator that receives a single scenario input, the model response, optional expected output, and a list of evaluation criteria. It returns a structured JSON object containing an overall score (0–100), pass boolean, a short summary, and per-criterion scores with reasons.

Execution flow
1. After a prompt execution completes successfully, the backend calls the evaluator service with the scenario payload.
2. The evaluator invokes the configured model (via OpenRouter adapter) with a judge prompt and parses the JSON output.
3. The parsed judgement is persisted as `EvaluationJudgement` and `EvaluationCriterionResult` rows linked to the `EvaluationResult`.

Concurrency & reliability
- Controlled concurrency: the execution runner batches model calls and limits concurrent judge calls (configurable, default 3).
- Retry/backoff: evaluator calls use retry-with-backoff for transient provider errors; persistent failures mark the judgement as `failed` and record `errorMessage`.
- Validation: evaluator output is validated; parsing errors create a failed judgement with the raw response saved to logs for debugging.

Costs & monitoring
- Judge calls incur model input+output token costs; track and surface estimated judge cost per run.
- Monitor judge error rates and average latency; add alerts for sustained rate limits or cost spikes.

Data model & migration notes
- Persist judgements in `EvaluationJudgement` and `EvaluationCriterionResult` (Prisma models).
- Migration must include backfill plan for historical runs (optional) and a default null value when no judgement exists.

APIs
- `POST /api/evaluations` accepts `evaluatorModel`, `evaluatorThreshold`, `evaluatorPrompt`.
- `GET /api/evaluations/:id` returns judgements nested with results.

Security & privacy
- Do not expose private test data in public logs; redact PII when storing long traces.
