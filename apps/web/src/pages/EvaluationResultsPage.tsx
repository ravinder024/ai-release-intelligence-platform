import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supportedModels, type EvaluationResult, type EvaluationRun, type Experiment } from "@prompt-playground/shared";
import { api, getExperiment } from "../api";

export function EvaluationResultsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [run, setRun] = useState<EvaluationRun | null>(null);
  const [experiment, setExperiment] = useState<Experiment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<"stop" | "resume" | "restart" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get<EvaluationRun>(`/api/evaluations/${id}`);
      setRun(data);
      return data;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load evaluation");
      return null;
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll whenever the run is in progress — including when it starts *after* mount (Resume).
  // Polling only on mount left a resumed run frozen at its old progress until a manual reload.
  useEffect(() => {
    if (run?.status !== "running") return;
    let cancelled = false;
    const timer = setInterval(() => {
      if (cancelled) return;
      void load();
    }, 3000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [run?.status, load]);

  useEffect(() => {
    if (!run?.experimentId) { setExperiment(null); return; }
    let cancelled = false;
    getExperiment(run.experimentId)
      .then((experiment) => { if (!cancelled) setExperiment(experiment); })
      .catch(() => { if (!cancelled) setExperiment(null); });
    return () => { cancelled = true; };
  }, [run?.experimentId, run?.id]);

  if (error && !run) return <section className="intro"><p className="error">{error}</p><p><Link to="/datasets">Back to datasets</Link></p></section>;
  if (!run) return <section className="intro"><p>Loading…</p></section>;

  const isRunning = run.status === "running";
  const percent = run.progress.total === 0 ? 0 : Math.round((run.progress.completed / run.progress.total) * 100);
  const executionPercent = run.progress.total === 0 ? 0 : Math.round((run.progress.executionsCompleted / run.progress.total) * 100);
  const hasJudge = Boolean(run.evaluatorModel);
  const remainingWork = run.progress.total - run.progress.completed;

  async function act(kind: "resume" | "restart") {
    if (!run) return;
    setActionBusy(kind);
    setError(null);
    setNotice(null);
    try {
      const result = await api.post<EvaluationRun | { run: EvaluationRun }>(`/api/evaluations/${run.id}/${kind}`, {});
      const next = "run" in result ? result.run : result;
      if (kind === "restart") {
        // Restart creates a NEW run; open it so the page is not stuck on the old, finished one.
        navigate(`/evaluations/${next.id}`);
        return;
      }
      setRun(next);
      setNotice("Resumed — re-running only the missing or failed scenarios.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Could not ${kind} this run`);
    } finally {
      setActionBusy(null);
    }
  }

  return (
    <section>
      <div className="intro">
        <p className="eyebrow">EVALUATION RESULTS</p>
        <h1>How did both prompts do?</h1>
        <p>Dataset: <Link to={`/datasets/${run.datasetId}`} className="back-link">{run.datasetName}</Link> · {run.model}</p>
      </div>

      {run.experimentId && experiment ? (
        <div className="panel judge-summary">
          <div className="judge-row">
            <span className="judge-badge">Experiment</span>
            <Link to="/experiments" className="back-link">{experiment.name}</Link>
            {experiment.hypothesis ? <span className="judge-prompt">{truncate(experiment.hypothesis, 140)}</span> : null}
          </div>
        </div>
      ) : null}

      {hasJudge ? (
        <div className="panel judge-summary">
          <div className="judge-row">
            <span className="judge-badge">LLM judge</span>
            <span>{run.evaluatorModel}</span>
            <span>Pass threshold: {run.evaluatorThreshold ?? "—"}%</span>
          </div>
          {run.evaluatorPrompt ? <p className="judge-prompt">{truncate(run.evaluatorPrompt, 140)}</p> : null}
        </div>
      ) : null}

      <div className="section-heading">
        <div><p className="eyebrow">RUN</p><h2>{new Date(run.createdAt).toLocaleString()}</h2></div>
        <span className={`status ${run.status}`}>{run.status.replace("_", " ")}</span>
      </div>

      {error && (
        <p className="error" role="alert">{error}</p>
      )}
      {notice && (
        <p className="success" role="status">{notice}</p>
      )}

      {isRunning ? (
        <div className="panel progress-panel">
          <div className="progress-row"><span>Evaluating {run.testCases.length} scenario{run.testCases.length === 1 ? "" : "s"}…</span><strong>{run.progress.completed} / {run.progress.total}</strong></div>
          <div className="progress-track"><div className="progress-fill" style={{ width: `${hasJudge ? executionPercent : percent}%` }} /></div>
          <p className="hint">
            {hasJudge
              ? `${run.progress.executionsCompleted} of ${run.progress.total} answers received · ${run.progress.completed} judged and passed. The judge can take a while on free models.`
              : "Running scenarios a few at a time to avoid rate limits. This page updates automatically."}
          </p>
          <div className="run-actions">
            <button type="button" onClick={async () => {
              if (!confirm('Stop this run? In-flight jobs will finish but remaining jobs will be cancelled.')) return;
              setActionBusy("stop");
              setError(null);
              try {
                await api.post(`/api/evaluations/${run.id}/stop`, {});
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Could not stop run');
                setActionBusy(null);
                return;
              }
              setActionBusy(null);
              await load();
            }} disabled={actionBusy !== null}>{actionBusy === "stop" ? "Stopping…" : "Stop"}</button>
          </div>
        </div>
      ) : (
        <div className="panel summary-bar">
          <span>{run.testCases.length} scenario{run.testCases.length === 1 ? "" : "s"}</span>
          <span>{run.progress.completed} of {run.progress.total} evaluated</span>
          {run.completedAt && <span>Finished {new Date(run.completedAt).toLocaleTimeString()}</span>}
          <div className="run-actions">
            {remainingWork > 0 && (
              <button type="button" className="secondary" onClick={() => void act("resume")} disabled={actionBusy !== null}>
                {actionBusy === "resume" ? "Resuming…" : `Resume (${remainingWork} left)`}
              </button>
            )}
            <button type="button" onClick={async () => {
              if (!confirm('Start a brand-new run of every scenario? The current results are kept in history.')) return;
              await act("restart");
            }} disabled={actionBusy !== null}>{actionBusy === "restart" ? "Starting…" : "Restart"}</button>
          </div>
        </div>
      )}

      <div className="prompt-labels">
        <span className="label-a">Prompt A · {truncate(run.promptA, 60)}</span>
        <span className="label-b">Prompt B · {truncate(run.promptB, 60)}</span>
      </div>

      <div className="eval-table">
        {run.testCases.map((testCase, index) => (
          <ResultRow
            key={testCase.id}
            index={index}
            input={testCase.input}
            expected={testCase.expectedOutput}
            notes={testCase.notes}
            criteria={testCase.evaluationCriteria}
            resultA={findResult(run.results, testCase.id, "A")}
            resultB={findResult(run.results, testCase.id, "B")}
          />
        ))}
      </div>
    </section>
  );
}

function findResult(results: EvaluationResult[], testCaseId: string, variant: "A" | "B") {
  return results.find((result) => result.testCaseId === testCaseId && result.variant === variant);
}

function ResultRow({ index, input, expected, notes, criteria, resultA, resultB }: {
  index: number;
  input: string;
  expected: string | null;
  notes: string | null;
  criteria: string[] | null;
  resultA: EvaluationResult | undefined;
  resultB: EvaluationResult | undefined;
}) {
  const status = scenarioStatus(resultA, resultB);
  return (
    <article className="eval-row">
      <div className="eval-input">
        <span className="scenario-num">#{index + 1}</span>
        <span className={`failure-status ${status.replace(/ /g, "_")}`}>{status}</span>
        <p>{input}</p>
        {expected && <p className="scenario-meta"><strong>Expected:</strong> {expected}</p>}
        {criteria?.length ? (
          <p className="scenario-meta"><strong>Criteria:</strong> {criteria.join(", ")}</p>
        ) : null}
        {notes && <p className="scenario-meta"><strong>Notes:</strong> {notes}</p>}
      </div>
      <ResultCell result={resultA} label="A" />
      <ResultCell result={resultB} label="B" />
    </article>
  );
}

function scenarioStatus(resultA: EvaluationResult | undefined, resultB: EvaluationResult | undefined): string {
  if (!resultA || !resultB) return "missing result";
  if (resultA.status === "failed" || resultB.status === "failed") return "execution error";
  if (resultA.judgement?.status === "failed" || resultB.judgement?.status === "failed") return "evaluator error";
  if (!resultA.judgement || !resultB.judgement) return "judgement pending";
  if (resultA.judgement.pass && !resultB.judgement.pass) return "candidate regression";
  if (!resultA.judgement.pass && resultB.judgement.pass) return "improved";
  if (!resultA.judgement.pass || !resultB.judgement.pass) return "quality failure";
  return "pass";
}

function ResultCell({ result, label }: { result: EvaluationResult | undefined; label: "A" | "B" }) {
  if (!result || result.status === "failed") {
    return <div className="eval-cell failed"><span className="eval-label">Prompt {label}</span><p className="error">{result?.errorMessage ?? "Not run yet"}</p></div>;
  }
  const pricing = supportedModels.find((item) => item.id === String((result.modelMetadata as { model?: unknown } | null)?.model ?? ""));
  const isFree = (result.modelMetadata as { source?: string; inputCostPerMillion?: number | null; outputCostPerMillion?: number | null } | null)?.source === "platform_free"
    || pricing !== undefined && pricing.inputCostPerMillion === 0 && pricing.outputCostPerMillion === 0;
  const judgement = result.judgement;

  return (
    <div className={`eval-cell${judgement ? " judged" : ""}`}>
      <span className="eval-label">Prompt {label}</span>
      {judgement ? (
        <div className="judgement-panel">
          {judgement.status === "failed" ? (
            <p className="error">Judge error: {judgement.errorMessage ?? "Unknown issue"}</p>
          ) : <>
            <div className={`judge-pill ${judgement.pass ? "pass" : "fail"}`}>{judgement.pass ? "Judge pass" : "Judge fail"}</div>
            <span className="judge-score">Score {judgement.overallScore}%</span>
            {judgement.summary ? <p className="judgement-summary">{judgement.summary}</p> : null}
          </>}
          {judgement.status === "completed" && judgement.criteriaResults.length > 0 ? (
            <details className="criteria-details">
              <summary>Criteria results</summary>
              <ul className="criteria-list">
                {judgement.criteriaResults.map((criterion) => (
                  <li key={criterion.id}>
                    <strong>{criterion.criterion}</strong>: {criterion.score}% · {criterion.pass ? "Pass" : "Fail"}
                    {criterion.reason ? <span>: {criterion.reason}</span> : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
      <pre className="eval-output">{result.output || "No response returned."}</pre>
      {result.responseSnapshot || result.modelMetadata ? (
        <details className="snapshot-details">
          <summary>Raw snapshot</summary>
          <div className="snapshot-body">
            {result.modelMetadata ? (
              <div>
                <strong>Model metadata</strong>
                <pre>{JSON.stringify(result.modelMetadata, null, 2)}</pre>
              </div>
            ) : null}
            {result.responseSnapshot ? (
              <div>
                <strong>Response snapshot</strong>
                <pre>{JSON.stringify(result.responseSnapshot, null, 2)}</pre>
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
      <div className="eval-metrics">
        <span title="Latency">{result.latencyMs?.toLocaleString() ?? "—"} ms</span>
        <span title="Tokens">{result.totalTokens?.toLocaleString() ?? "—"} tokens</span>
        <span title="Estimated cost">{isFree ? "Free" : result.estimatedCostUsd == null ? "—" : formatCost(result.estimatedCostUsd)}</span>
      </div>
    </div>
  );
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function formatCost(cost: number) {
  return cost < 0.01 ? `$${cost.toFixed(5)}` : `$${cost.toFixed(3)}`;
}
