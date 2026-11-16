import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { metricDeltaTone, type ExperimentDecision, type ExperimentDetail, type MetricKind, type ScenarioComparison } from "@prompt-playground/shared";
import { api } from "../api";
import { getExperiment, resumeExperiment, runExperiment, saveExperimentDecision, stopExperiment } from "../api";
import { CriterionName } from "../components/CriterionName";
import { useProviderModels } from "../useModels";
import { decodeModelSelection, encodeModelSelection, ModelSelector } from "../components/ModelSelector";

const decisionLabel: Record<ExperimentDecision, string> = {
  promote_candidate: "Promote Candidate",
  keep_baseline: "Keep Baseline",
  continue_experiment: "Continue Experiment",
};

export function ExperimentDetailPage() {
  const { options, loading: catalogLoading } = useProviderModels();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [experiment, setExperiment] = useState<ExperimentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState<ExperimentDecision | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [expandedScenarios, setExpandedScenarios] = useState<Set<string>>(new Set());
  const [showPrompts, setShowPrompts] = useState(false);
  const [creatingRegressionId, setCreatingRegressionId] = useState<string | null>(null);
  const [regressionCase, setRegressionCase] = useState<{ datasetId: string; datasetName: string; requiresReview: boolean } | null>(null);
  const [retryModels, setRetryModels] = useState<{ id?: string; baseline?: string; candidate?: string; evaluator?: string }>({});

  const load = useCallback(async () => {
    try {
      const data = await getExperiment(id!);
      setExperiment(data);
      setDecision(data.decision);
      setDecisionNote(data.decisionNote ?? "");
      // Default the retry model overrides to the frozen config (preserve user picks, reset per experiment).
      setRetryModels((current) => (current.baseline && current.id === data.id
        ? current
        : {
            id: data.id,
        baseline: data.modelConfigA ? encodeModelSelection(data.modelConfigA) : "",
        candidate: data.modelConfigB ? encodeModelSelection(data.modelConfigB) : "",
        evaluator: data.evaluatorConfig ? encodeModelSelection(data.evaluatorConfig) : "",
          }));
      return data;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load experiment");
      return null;
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (catalogLoading) return;
    const values = new Set(options.map((option) => encodeModelSelection({ modelId: option.modelId, provider: option.provider, source: option.source, ...(option.connectionId ? { connectionId: option.connectionId } : {}) })));
    setRetryModels((current) => ({
      ...current,
      baseline: current.baseline && !values.has(current.baseline) ? "" : current.baseline,
      candidate: current.candidate && !values.has(current.candidate) ? "" : current.candidate,
      evaluator: current.evaluator && !values.has(current.evaluator) ? "" : current.evaluator,
    }));
  }, [options, catalogLoading]);

  // Poll while the experiment is running. Keyed on the status so polling restarts
  // automatically after a Resume (and stops as soon as a run is Stopped or finishes).
  const isRunning = experiment?.status === "running";
  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => { void load(); }, 3000);
    return () => clearInterval(timer);
  }, [isRunning, load]);

  async function saveDecision() {
    if (!experiment || !decision) return;
    setIsSaving(true);
    setError(null);
    try {
      const updated = await saveExperimentDecision(experiment.id, decision, decisionNote || undefined);
      setExperiment((current) => (current ? { ...current, ...updated } : current));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save decision");
    } finally {
      setIsSaving(false);
    }
  }

  async function createRegressionCase(testCaseId: string) {
    if (!experiment) return;
    setCreatingRegressionId(testCaseId);
    setError(null);
    try {
      const created = await api.post<{ datasetId: string; datasetName: string; requiresReview: boolean }>(`/api/experiments/${experiment.id}/regression-cases`, { testCaseId, variant: "B" });
      setRegressionCase(created);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create regression case");
    } finally {
      setCreatingRegressionId(null);
    }
  }

  async function rerun() {
    if (!experiment) return;
    setError(null);
    try {
      await runExperiment(experiment.id);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start run");
    }
  }

  async function stopRun() {
    if (!experiment) return;
    setIsBusy(true);
    setError(null);
    try {
      await stopExperiment(experiment.id);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not stop the run");
    } finally {
      setIsBusy(false);
    }
  }

  /** Continue the current run: only scenarios that are missing or failed are re-evaluated. */
  async function resumeRun() {
    if (!experiment) return;
    const baselineSelection = decodeModelSelection(retryModels.baseline ?? "");
    const candidateSelection = decodeModelSelection(retryModels.candidate ?? "");
    const evaluatorSelection = experiment.evaluatorModel ? decodeModelSelection(retryModels.evaluator ?? "") : null;
    if (!baselineSelection || !candidateSelection || (experiment.evaluatorModel && !evaluatorSelection)) {
      setError("Choose an available provider connection for each configuration before resuming.");
      return;
    }
    setIsBusy(true);
    setError(null);
    try {
      await resumeExperiment(experiment.id, {
        baselineModel: baselineSelection.modelId,
        candidateModel: candidateSelection.modelId,
        baselineSelection,
        candidateSelection,
        ...(evaluatorSelection ? { evaluatorModel: evaluatorSelection.modelId, evaluatorSelection } : {}),
      });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not resume the run");
    } finally {
      setIsBusy(false);
    }
  }

  if (error && !experiment) return <section className="intro"><p className="error">{error}</p><p><Link to="/experiments">Back to experiments</Link></p></section>;
  if (!experiment) return <section className="intro"><p>Loading…</p></section>;

  const { metrics, criteria, scenarios, regressions } = experiment;
  const failureScenarios = scenarios.filter((scenario) => ["quality_failure", "regression", "execution_error", "evaluator_error", "missing_result"].includes(scenario.failureAnalysis?.type ?? ""));
  const failureCategoryCounts = new Map<string, number>();
  const failedCriterionCounts = new Map<string, number>();
  for (const scenario of scenarios) {
    for (const category of scenario.failureAnalysis?.categories ?? []) failureCategoryCounts.set(category, (failureCategoryCounts.get(category) ?? 0) + 1);
    for (const criterion of scenario.failureAnalysis?.failedCriteria ?? []) failedCriterionCounts.set(criterion.criterion, (failedCriterionCounts.get(criterion.criterion) ?? 0) + 1);
  }
  const categoryBreakdown = [...failureCategoryCounts.entries()].sort((left, right) => right[1] - left[1]);
  const criterionBreakdown = [...failedCriterionCounts.entries()].sort((left, right) => right[1] - left[1]);
  const { baseline, candidate, comparison } = metrics;
  const percent = experiment.latestRun?.progress?.total
    ? Math.round((experiment.latestRun.progress.completed / experiment.latestRun.progress.total) * 100)
    : 0;
  const remainingScenarios = experiment.completion?.retryable ?? 0;
  const canResume = !isRunning && Boolean(experiment.latestRun) && remainingScenarios > 0;

  return (
    <section>
      <div className="intro">
        <p className="eyebrow"><Link to="/experiments" className="back-link">EXPERIMENTS</Link> / {experiment.datasetName}</p>
        <div className="experiment-title-row">
          <h1>{experiment.name}</h1>
          <span className="iteration-badge">Iteration {experiment.iteration}</span>
          <span className={`status ${experiment.status}`}>{experiment.status.replace("_", " ")}</span>
          {experiment.status !== "running" && experiment.latestRun && (
            <button type="button" className="secondary" onClick={() => navigate(`/experiments/${experiment.id}/iterations/new`)}>Create Next Iteration</button>
          )}
          {isRunning ? (
            <button type="button" className="secondary" disabled={isBusy} onClick={() => void stopRun()}>
              {isBusy ? "Stopping…" : "Stop"}
            </button>
          ) : (
            <>
              {experiment.latestRun && (
                <button
                  type="button"
                  className="secondary"
                  disabled={isBusy || !canResume}
                  title={canResume
                    ? "Continue this run: only the evaluations that are missing or failed are run again"
                    : "Nothing left to resume — every scenario has been evaluated for both configurations"}
                  onClick={() => void resumeRun()}
                >
                  {isBusy ? "Resuming…" : canResume ? `Resume (${experiment.completion?.retryable ?? 0})` : "Resume"}
                </button>
              )}
              <button type="button" className="secondary" disabled={isBusy} onClick={() => void rerun()}>
                {experiment.latestRun ? "Restart" : "Run experiment"}
              </button>
            </>
          )}
        </div>
        {experiment.latestRun && (
          <p className="hint run-controls-hint">
            <strong>Stop</strong> halts the run and keeps every scenario already evaluated ·{" "}
            <strong>Resume</strong> continues that run where it left off ·{" "}
            <strong>Restart</strong> starts a brand-new run of all scenarios (history is kept).
          </p>
        )}
        {experiment.hypothesis && <p className="experiment-hypothesis">Hypothesis: {experiment.hypothesis}</p>}
        <p className="experiment-dataset">
          Dataset: <Link to={`/datasets/${experiment.datasetId}`} className="back-link">{experiment.datasetName}</Link> · {experiment.testCaseCount} scenario{experiment.testCaseCount === 1 ? "" : "s"}
        </p>
        {experiment.comparabilityWarning && (
          <div className="panel comparability-warning" style={{ marginTop: 16 }}>
            <strong>Comparability warning.</strong> {experiment.comparabilityWarning}
          </div>
        )}
        {experiment.iterations.length > 1 && (
          <div className="iteration-strip">
            {experiment.iterations.map((iteration) => (
              <Link
                key={iteration.id}
                to={`/experiments/${iteration.id}`}
                className={`iteration-chip ${iteration.id === experiment.id ? "active" : ""}`}
              >
                Iteration {iteration.iteration}
              </Link>
            ))}
          </div>
        )}
      </div>

      {isRunning && experiment.latestRun && (
        <div className="panel progress-panel">
          <div className="progress-row">
            <span>Running {experiment.latestRun.progress.completed} / {experiment.latestRun.progress.total} evaluations…</span>
            <strong>{percent}%</strong>
          </div>
          <div className="progress-track"><div className="progress-fill" style={{ width: `${percent}%` }} /></div>
          <p className="hint">Baseline runs as configuration A and candidate as configuration B, judged by the LLM evaluator.</p>
        </div>
      )}

      {/* Evaluation status + partial retry */}
      {!isRunning && experiment.completion && (
        <div className="panel eval-status-panel">
          <div className="panel-title">
            <span>EVALUATION STATUS</span>
            <span className="badge">{!experiment.latestRun ? "Not started" : experiment.completion.retryable > 0 ? "Incomplete" : "Complete"}</span>
          </div>
          <div className="eval-status-rows">
            <span>Baseline: <strong>{experiment.completion.baseline.completed} / {experiment.completion.baseline.total}</strong> completed</span>
            <span>Candidate: <strong>{experiment.completion.candidate.completed} / {experiment.completion.candidate.total}</strong> completed</span>
          </div>
          {!experiment.latestRun ? (
            <p className="hint">Run the experiment to evaluate both configurations.</p>
          ) : experiment.completion.retryable > 0 ? (
            <>
              <p className="hint">{experiment.completion.retryable} evaluation{experiment.completion.retryable === 1 ? "" : "s"} still need results (stopped, failed, or not evaluated yet) — that is one result per configuration. Successful results are kept. If your current model is rate-limited, switch to another below, then resume.</p>
              <div className="retry-models">
                <ModelSelector label="Baseline model" value={retryModels.baseline ?? ""} onChange={(baseline) => setRetryModels((current) => ({ ...current, baseline }))} options={options} loading={catalogLoading} />
                <ModelSelector label="Candidate model" value={retryModels.candidate ?? ""} onChange={(candidate) => setRetryModels((current) => ({ ...current, candidate }))} options={options} loading={catalogLoading} />
                {experiment.evaluatorModel && (
                  <ModelSelector label="Judge model" value={retryModels.evaluator ?? ""} onChange={(evaluator) => setRetryModels((current) => ({ ...current, evaluator }))} options={options} loading={catalogLoading} />
                )}
              </div>
              <button type="button" className="primary" disabled={isBusy} onClick={() => void resumeRun()}>
                {isBusy ? "Resuming…" : `Resume ${experiment.completion.retryable} pending evaluation${experiment.completion.retryable === 1 ? "" : "s"}`}
              </button>
            </>
          ) : (
            <p className="hint">All scenarios evaluated successfully.</p>
          )}
        </div>
      )}

      {/* Configuration comparison */}
      <div className="section-heading"><div><p className="eyebrow">CONFIGURATION</p><h2>Configuration comparison</h2></div>
        <button type="button" className="secondary" onClick={() => setShowPrompts((value) => !value)}>{showPrompts ? "Hide prompts" : "View prompts"}</button>
      </div>
      <div className="config-compare">
        <div className="panel config-block baseline-block">
          <div className="panel-title"><span>BASELINE</span><span className="badge">v{experiment.iteration} · Current</span></div>
          <p className="config-model">{experiment.baselineModel}</p>
          {showPrompts && <pre className="config-prompt">{experiment.baselinePrompt}</pre>}
        </div>
        <div className="panel config-block candidate-block">
          <div className="panel-title"><span>CANDIDATE</span><span className="badge">v{experiment.iteration + 1} · Proposed</span></div>
          <p className="config-model">{experiment.candidateModel}</p>
          {showPrompts && <pre className="config-prompt">{experiment.candidatePrompt}</pre>}
        </div>
      </div>

      {/* Evaluator configuration (distinct from target configuration) */}
      <div className="section-heading"><div><p className="eyebrow">EVALUATOR</p><h2>Evaluation configuration</h2></div></div>
      <div className="panel eval-config">
        <span className="badge">{experiment.evaluatorModel ? "LLM-as-a-Judge" : "Human judgement"}</span>
        {experiment.evaluatorModel ? (
          <>
            <span>Judge model: <strong>{experiment.evaluatorModel}</strong></span>
            <span>Pass threshold: <strong>{experiment.evaluatorThreshold ?? "—"}%</strong></span>
          </>
        ) : (
          <span>No automated judge — evaluate responses manually.</span>
        )}
      </div>

      {/* Result summary */}
      <div className="section-heading"><div><p className="eyebrow">RESULTS</p><h2>Result summary</h2></div></div>
      <div className="panel summary-table-wrap">
        <table className="summary-table">
          <thead>
            <tr><th></th><th>Baseline</th><th>Candidate</th><th>Change</th></tr>
          </thead>
          <tbody>
            <SummaryRow label="Avg score" baseline={fmtScore(baseline.avgScore)} candidate={fmtScore(candidate.avgScore)} delta={comparison.scoreDelta} deltaKind="score" />
            <SummaryRow label="Pass rate" baseline={fmtPercent(baseline.passRate)} candidate={fmtPercent(candidate.passRate)} delta={comparison.passRateDelta} deltaKind="pp" />
            <SummaryRow label="Avg latency" baseline={fmtLatency(baseline.avgLatencyMs)} candidate={fmtLatency(candidate.avgLatencyMs)} delta={comparison.latencyDeltaMs} deltaKind="ms" />
            <SummaryRow label="Total tokens" baseline={fmtTokens(baseline.totalTokens)} candidate={fmtTokens(candidate.totalTokens)} delta={comparison.tokenDelta} deltaKind="tokens" />
            <SummaryRow label="Total cost" baseline={fmtCost(baseline.totalCostUsd)} candidate={fmtCost(candidate.totalCostUsd)} delta={comparison.costDeltaUsd} deltaKind="cost" />
          </tbody>
        </table>
        <p className="hint">Deltas are candidate − baseline. Pass-rate deltas are shown in percentage points (pp). {baseline.scoredCount}/{baseline.completedCount} scored per configuration.{experiment.completion.retryable > 0 ? ` * Based on ${baseline.scoredCount} successfully evaluated scenario${baseline.scoredCount === 1 ? "" : "s"} per configuration; the comparison is incomplete.` : ""}</p>
      </div>

      {/* Criterion performance */}
      {criteria.length > 0 && (
        <>
          <div className="section-heading"><div><p className="eyebrow">CRITERIA</p><h2>Criterion performance</h2></div></div>
          <div className="panel summary-table-wrap">
            <table className="summary-table">
              <thead><tr><th>Criterion</th><th>Baseline</th><th>Candidate</th><th>Change</th></tr></thead>
              <tbody>
                {criteria.map((criterion) => (
                  <SummaryRow
                    key={criterion.criterion}
                    label={<CriterionName name={criterion.criterion} />}
                    baseline={criterion.baselineScore == null ? "—" : `${criterion.baselineScore.toFixed(0)}`}
                    candidate={criterion.candidateScore == null ? "—" : `${criterion.candidateScore.toFixed(0)}`}
                    delta={criterion.delta}
                    deltaKind="score"
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Scenario performance */}
      <div className="section-heading"><div><p className="eyebrow">SCENARIOS</p><h2>Scenario performance</h2></div></div>
      <div className="scenario-compare-list">
        {scenarios.map((scenario) => (
          <ScenarioRow
            key={scenario.testCaseId}
            scenario={scenario}
            index={scenarios.indexOf(scenario)}
            expanded={expandedScenarios.has(scenario.testCaseId)}
            creatingRegression={creatingRegressionId === scenario.testCaseId}
            onCreateRegression={() => void createRegressionCase(scenario.testCaseId)}
            onToggle={() => setExpandedScenarios((current) => {
              const next = new Set(current);
              if (next.has(scenario.testCaseId)) next.delete(scenario.testCaseId);
              else next.add(scenario.testCaseId);
              return next;
            })}
          />
        ))}
        {scenarios.length === 0 && <div className="empty">No scenario results yet.</div>}
      </div>

      <div className="section-heading"><div><p className="eyebrow">FAILURE ANALYSIS</p><h2>Evidence breakdown</h2></div><span className="badge">{failureScenarios.length} scenarios to review</span></div>
      <div className="panel failure-analysis-panel">
        <div className="failure-rollups">
          <div><strong>{failureScenarios.filter((scenario) => scenario.failureAnalysis?.type === "regression").length}</strong><span>new candidate regressions</span></div>
          <div><strong>{scenarios.filter((scenario) => scenario.failureAnalysis?.type === "improvement").length}</strong><span>improved scenarios</span></div>
          <div><strong>{scenarios.filter((scenario) => scenario.failureAnalysis?.type === "quality_failure").length}</strong><span>candidate quality failures</span></div>
          <div><strong>{scenarios.filter((scenario) => ["execution_error", "evaluator_error", "missing_result"].includes(scenario.failureAnalysis?.type ?? "")).length}</strong><span>incomplete or errored</span></div>
        </div>
        <div className="failure-breakdowns">
          <div><h3>Failure patterns</h3>{categoryBreakdown.length ? categoryBreakdown.map(([label, count]) => <p key={label}><span>{label.replace(/_/g, " ")}</span><strong>{count}</strong></p>) : <p className="muted">No classified failure evidence.</p>}</div>
          <div><h3>Criteria most often failed</h3>{criterionBreakdown.length ? criterionBreakdown.map(([label, count]) => <p key={label}><span>{label}</span><strong>{count}</strong></p>) : <p className="muted">No failed criteria recorded.</p>}</div>
        </div>
        {regressionCase && <p className="success" role="status">Regression dataset created: <Link to={`/datasets/${regressionCase.datasetId}`}>{regressionCase.datasetName}</Link>{regressionCase.requiresReview ? " · review the golden answer and rubric before use" : ""}</p>}
      </div>

      {/* Regressions */}
      {regressions.length > 0 && (
        <div className="panel regressions-panel">
          <div className="panel-title"><span>REGRESSIONS</span><span className="badge">{regressions.length} found</span></div>
          <p className="hint">The candidate scored lower than the baseline in these areas.</p>
          <ul className="regression-list">
            {regressions.map((regression, index) => (
              <li key={`${regression.kind}-${index}`}>
                <span className={`regression-kind ${regression.kind}`}>{regression.kind}</span>
                <span className="regression-label">{regression.label}</span>
                <span className="regression-values">
                  {regression.baselineValue?.toFixed(1) ?? "—"} → {regression.candidateValue?.toFixed(1) ?? "—"}
                </span>
                <strong className="delta-negative">{regression.delta == null ? "—" : fmtDelta(regression.delta, "score")}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Recommendation */}
      {experiment.recommendation && (
        <div className="panel recommendation-panel">
          <div className="panel-title"><span>RECOMMENDATION</span><span className="badge">Based on evaluation results</span></div>
          <p className="hint">Recommendation based on evaluation results — the final decision is yours.</p>
          <div className={`recommendation-label ${experiment.recommendation.recommendation}`}>
            {experiment.recommendation.label}
          </div>
          <p className="recommendation-reason">{experiment.recommendation.reason}</p>
          {experiment.recommendation.evidence.length > 0 && (
            <ul className="recommendation-evidence">
              {experiment.recommendation.evidence.map((item, index) => <li key={index}>{item}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* Decision */}
      <div className="section-heading"><div><p className="eyebrow">DECISION</p><h2>What should happen next?</h2></div></div>
      <div className="panel decision-panel">
        <p className="hint">The system provides evidence — you make the product decision.</p>
        <div className="decision-options">
          {(Object.keys(decisionLabel) as ExperimentDecision[]).map((option) => (
            <button
              key={option}
              type="button"
              className={`decision-option ${decision === option ? "selected" : ""} ${option}`}
              onClick={() => setDecision(option)}
            >
              {decisionLabel[option]}
            </button>
          ))}
        </div>
        <label>Decision rationale
          <textarea value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} rows={3} placeholder="Why did you choose this? Reference the evidence above." />
        </label>
        <div className="row-actions">
          <button type="button" className="primary" onClick={() => void saveDecision()} disabled={!decision || isSaving}>
            {isSaving ? "Saving…" : "Save Decision"}
          </button>
          {experiment.decision && <span className="decision-saved">Saved: {decisionLabel[experiment.decision]}{experiment.decidedAt ? ` · ${new Date(experiment.decidedAt).toLocaleString()}` : ""}</span>}
        </div>
      </div>
    </section>
  );
}

function SummaryRow({ label, baseline, candidate, delta, deltaKind }: {
  label: React.ReactNode;
  baseline: string;
  candidate: string;
  delta: number | null;
  deltaKind: MetricKind;
}) {
  const tone = metricDeltaTone(delta, deltaKind);
  const className = tone === "good" ? "delta-positive" : tone === "bad" ? "delta-negative" : "delta-neutral";
  return (
    <tr>
      <td className="summary-label">{label}</td>
      <td>{baseline}</td>
      <td>{candidate}</td>
      <td>
        {delta === null ? <span className="muted">—</span> : (
          <strong className={className}>{fmtDelta(delta, deltaKind)}</strong>
        )}
      </td>
    </tr>
  );
}

function ScenarioRow({ scenario, index, expanded, onToggle, onCreateRegression, creatingRegression }: {
  scenario: ScenarioComparison;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  onCreateRegression: () => void;
  creatingRegression: boolean;
}) {
  const tone = metricDeltaTone(scenario.delta, "score");
  const regressed = tone === "bad";
  const scoreClass = tone === "good" ? "delta-positive" : tone === "bad" ? "delta-negative" : "delta-neutral";
  return (
    <article className={`panel scenario-compare-row ${regressed ? "regressed" : ""}`}>
      <button type="button" className="scenario-compare-head" onClick={onToggle}>
        <span className="scenario-num">#{index + 1}</span>
        <span className="scenario-input">{scenario.input}</span>
        <span className="scenario-scores">
          <span>{scenario.baselineScore == null ? "—" : scenario.baselineScore.toFixed(1)}</span>
          <span className="arrow">→</span>
          <span className={scoreClass}>{scenario.candidateScore == null ? "—" : scenario.candidateScore.toFixed(1)}</span>
          <strong className={scoreClass}>{scenario.delta == null ? "" : fmtDelta(scenario.delta, "score")}</strong>
        </span>
        <span className={`pass-change ${scenario.passChange}`}>{scenario.passChange}</span>
      </button>
      {expanded && (
        <div className="scenario-evidence">
          <div className={`failure-status ${scenario.failureAnalysis?.type ?? "missing_result"}`}>
            <strong>{(scenario.failureAnalysis?.type ?? "missing result").replace(/_/g, " ")}</strong>
            {(scenario.failureAnalysis?.categories ?? []).map((category) => <span key={category}>{category.replace(/_/g, " ")}</span>)}
          </div>
          {scenario.criteria.length > 0 && <div><strong>Rubric</strong><ul className="failure-criteria-list">{scenario.criteria.map((criterion) => <li key={criterion}>{criterion}</li>)}</ul></div>}
          {scenario.expectedOutput && <div><strong>Golden answer</strong><pre>{scenario.expectedOutput}</pre></div>}
          <div className="evidence-columns">
            <div>
              <strong>Baseline output</strong>
              <pre>{scenario.baselineOutput ?? "Not run"}</pre>
              {scenario.baselineExecution && <p className="judgement-evidence">{scenario.baselineExecution.status} · {scenario.baselineExecution.model ?? "model unknown"} · {scenario.baselineExecution.latencyMs ?? "—"} ms</p>}
              {scenario.baselineExecution?.errorMessage && <p className="error">Execution: {scenario.baselineExecution.errorMessage}</p>}
              {scenario.baselineJudgement && <JudgementEvidence judgement={scenario.baselineJudgement} />}
            </div>
            <div>
              <strong>Candidate output</strong>
              <pre>{scenario.candidateOutput ?? "Not run"}</pre>
              {scenario.candidateExecution && <p className="judgement-evidence">{scenario.candidateExecution.status} · {scenario.candidateExecution.model ?? "model unknown"} · {scenario.candidateExecution.latencyMs ?? "—"} ms</p>}
              {scenario.candidateExecution?.errorMessage && <p className="error">Execution: {scenario.candidateExecution.errorMessage}</p>}
              {scenario.candidateJudgement && <JudgementEvidence judgement={scenario.candidateJudgement} />}
            </div>
          </div>
          {(scenario.failureAnalysis?.evidence.length ?? 0) > 0 && <div><strong>Evidence</strong><ul className="failure-criteria-list">{scenario.failureAnalysis!.evidence.map((item, evidenceIndex) => <li key={evidenceIndex}>{item}</li>)}</ul></div>}
          {(scenario.failureAnalysis?.suggestions.length ?? 0) > 0 && <div className="failure-suggestions"><strong>Possible next steps</strong>{scenario.failureAnalysis!.suggestions.map((suggestion, suggestionIndex) => <p key={suggestionIndex}><b>{suggestion.action}</b><span>{suggestion.rationale}</span></p>)}</div>}
          {scenario.failureAnalysis?.requiresHumanReview && <p className="hint">Review the golden answer and rubric before treating this as a regression gate.</p>}
          {scenario.failureAnalysis && ["quality_failure", "regression", "improvement"].includes(scenario.failureAnalysis.type) && (
            <button type="button" className="secondary" onClick={onCreateRegression} disabled={creatingRegression}>
              {creatingRegression ? "Creating dataset…" : "Create regression case"}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function JudgementEvidence({ judgement }: { judgement: NonNullable<ScenarioComparison["candidateJudgement"]> }) {
  if (judgement.status === "failed") return <p className="error">Evaluator error: {judgement.errorMessage ?? "No valid judgement was produced."}</p>;
  return <>
    <p className="judgement-evidence">Judge: {judgement.overallScore}/100 · {judgement.pass ? "Pass" : "Fail"}{judgement.evaluatorModel ? ` · ${judgement.evaluatorModel}` : ""}{judgement.threshold != null ? ` · threshold ${judgement.threshold}` : ""}</p>
    {judgement.summary && <p className="judgement-evidence">{judgement.summary}</p>}
    {judgement.criteriaResults.filter((criterion) => !criterion.pass).map((criterion) => <p className="judgement-evidence" key={criterion.id || criterion.criterion}><strong>{criterion.criterion}</strong>: {criterion.reason ?? `score ${criterion.score}`}</p>)}
  </>;
}

function fmtDelta(delta: number, kind: MetricKind): string {
  const sign = delta > 0 ? "+" : "";
  switch (kind) {
    case "pp": return `${sign}${delta.toFixed(1)} pp`;
    case "ms": return `${sign}${delta >= 1000 ? `${(delta / 1000).toFixed(2)}s` : `${delta.toFixed(0)}ms`}`;
    case "tokens": return `${sign}${delta.toLocaleString()}`;
    case "cost": return `${delta > 0 ? "+" : "-"}$${Math.abs(delta).toFixed(4)}`;
    case "score": return `${sign}${delta.toFixed(1)}`;
  }
}

function fmtScore(value: number | null) { return value == null ? "—" : value.toFixed(1); }
function fmtPercent(value: number | null) { return value == null ? "—" : `${value.toFixed(0)}%`; }
function fmtLatency(value: number | null) { return value == null ? "—" : value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${value.toFixed(0)}ms`; }
function fmtTokens(value: number | null) { return value == null ? "—" : value.toLocaleString(); }
function fmtCost(value: number | null) { return value == null ? "—" : `$${value.toFixed(4)}`; }
