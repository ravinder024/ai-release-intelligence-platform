import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supportedModels, metricDeltaTone, type ExperimentDecision, type ExperimentDetail, type MetricKind, type ModelId, type ScenarioComparison } from "@prompt-playground/shared";
import { getExperiment, retryExperiment, runExperiment, saveExperimentDecision } from "../api";
import { CriterionName } from "../components/CriterionName";

const decisionLabel: Record<ExperimentDecision, string> = {
  promote_candidate: "Promote Candidate",
  keep_baseline: "Keep Baseline",
  continue_experiment: "Continue Experiment",
};

export function ExperimentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [experiment, setExperiment] = useState<ExperimentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState<ExperimentDecision | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [expandedScenarios, setExpandedScenarios] = useState<Set<string>>(new Set());
  const [showPrompts, setShowPrompts] = useState(false);
  const [retryModels, setRetryModels] = useState<{ id?: string; baselineModel?: ModelId; candidateModel?: ModelId; evaluatorModel?: ModelId }>({});

  const load = useCallback(async () => {
    try {
      const data = await getExperiment(id!);
      setExperiment(data);
      setDecision(data.decision);
      setDecisionNote(data.decisionNote ?? "");
      // Default the retry model overrides to the frozen config (preserve user picks, reset per experiment).
      setRetryModels((current) => (current.baselineModel && current.id === data.id
        ? current
        : {
            id: data.id,
            baselineModel: data.baselineModel as ModelId,
            candidateModel: data.candidateModel as ModelId,
            ...(data.evaluatorModel ? { evaluatorModel: data.evaluatorModel as ModelId } : {}),
          }));
      return data;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load experiment");
      return null;
    }
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    void (async () => {
      const first = await load();
      if (cancelled || !first || first.status !== "running") return;
      timer = setInterval(async () => {
        const current = await load();
        if (cancelled || !current || current.status !== "running") {
          if (timer) clearInterval(timer);
        }
      }, 3000);
    })();
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, [load]);

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

  async function retryFailed() {
    if (!experiment) return;
    setError(null);
    try {
      await retryExperiment(experiment.id, {
        ...(retryModels.baselineModel ? { baselineModel: retryModels.baselineModel } : {}),
        ...(retryModels.candidateModel ? { candidateModel: retryModels.candidateModel } : {}),
        ...(retryModels.evaluatorModel ? { evaluatorModel: retryModels.evaluatorModel } : {}),
      });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not retry failed scenarios");
    }
  }

  if (error && !experiment) return <section className="intro"><p className="error">{error}</p><p><Link to="/experiments">Back to experiments</Link></p></section>;
  if (!experiment) return <section className="intro"><p>Loading…</p></section>;

  const { metrics, criteria, scenarios, regressions } = experiment;
  const { baseline, candidate, comparison } = metrics;
  const isRunning = experiment.status === "running";
  const percent = experiment.latestRun?.progress?.total
    ? Math.round((experiment.latestRun.progress.completed / experiment.latestRun.progress.total) * 100)
    : 0;

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
          {experiment.status !== "running" && (
            <button type="button" className="secondary" onClick={() => void rerun()}>Run again</button>
          )}
        </div>
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
              <p className="hint">{experiment.completion.retryable} scenario{experiment.completion.retryable === 1 ? "" : "s"} require retry (execution or evaluation failures). Successful results are kept. If your current model is rate-limited, switch to another below.</p>
              <div className="retry-models">
                <label>Baseline model
                  <select value={retryModels.baselineModel ?? ""} onChange={(event) => setRetryModels((current) => ({ ...current, baselineModel: event.target.value as ModelId }))}>
                    {supportedModels.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select>
                </label>
                <label>Candidate model
                  <select value={retryModels.candidateModel ?? ""} onChange={(event) => setRetryModels((current) => ({ ...current, candidateModel: event.target.value as ModelId }))}>
                    {supportedModels.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select>
                </label>
                {experiment.evaluatorModel && (
                  <label>Judge model
                    <select value={retryModels.evaluatorModel ?? ""} onChange={(event) => setRetryModels((current) => ({ ...current, evaluatorModel: event.target.value as ModelId }))}>
                      {supportedModels.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                    </select>
                  </label>
                )}
              </div>
              <button type="button" className="primary" onClick={() => void retryFailed()}>Retry {experiment.completion.retryable} failed scenario{experiment.completion.retryable === 1 ? "" : "s"}</button>
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

function ScenarioRow({ scenario, index, expanded, onToggle }: {
  scenario: ScenarioComparison;
  index: number;
  expanded: boolean;
  onToggle: () => void;
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
          {scenario.expectedOutput && <div><strong>Golden answer</strong><pre>{scenario.expectedOutput}</pre></div>}
          <div className="evidence-columns">
            <div>
              <strong>Baseline output</strong>
              <pre>{scenario.baselineOutput ?? "Not run"}</pre>
              {scenario.baselineJudgement && <p className="judgement-evidence">Judge: {scenario.baselineJudgement.overallScore}/100 · {scenario.baselineJudgement.pass ? "Pass" : "Fail"}</p>}
            </div>
            <div>
              <strong>Candidate output</strong>
              <pre>{scenario.candidateOutput ?? "Not run"}</pre>
              {scenario.candidateJudgement && <p className="judgement-evidence">Judge: {scenario.candidateJudgement.overallScore}/100 · {scenario.candidateJudgement.pass ? "Pass" : "Fail"}</p>}
            </div>
          </div>
        </div>
      )}
    </article>
  );
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
