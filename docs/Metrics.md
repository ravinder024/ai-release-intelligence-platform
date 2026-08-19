# Metrics

Primary metrics (Phase 3)
- Per-result `overallScore` (0–100) produced by the judge.
- Per-criterion score (0–100) and pass boolean.
- Run-level aggregates: average overall score per prompt variant, pass rate per prompt variant, and delta between variants.

Operational metrics
- Judge call latency and error rate.
- Estimated judge cost per run and aggregated monthly cost.

Reporting
- Start with simple CSV export of run-level metrics; later add dashboards and alerting on regressions.
