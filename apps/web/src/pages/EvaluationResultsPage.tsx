import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supportedModels, type EvaluationResult, type EvaluationRun, type Experiment, type ModelId } from "@prompt-playground/shared";
import { api, getExperiment } from "../api";

export function EvaluationResultsPage() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<EvaluationRun | null>(null);
  const [experiment, setExperiment] = useState<Experiment | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      const first = await load();
      if (cancelled || !first || first.status !== "running") return;
      timer = setInterval(async () => {
        const current = await load();
        if (cancelled) return;
        if (!current || current.status !== "running" && timer) {
          if (timer) clearInterval(timer);
        }
      }, 2000);
    })();
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, [load]);

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

  const hasJudge = Boolean(run.evaluatorModel);

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

      {isRunning ? (
        <div className="panel progress-panel">
          <div className="progress-row"><span>Evaluating {run.testCases.length} scenario{run.testCases.length === 1 ? "" : "s"}…</span><strong>{run.progress.completed} / {run.progress.total}</strong></div>
          <div className="progress-track"><div className="progress-fill" style={{ width: `${percent}%` }} /></div>
          <p className="hint">Running scenarios a few at a time to avoid rate limits. This page updates automatically.</p>
          <div className="run-actions">
            <button type="button" onClick={async () => {
              if (!confirm('Stop this run? In-flight jobs will finish but remaining jobs will be cancelled.')) return;
              try {
                await api.post(`/api/evaluations/${run.id}/stop`, {});
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Could not stop run');
                return;
              }
              // poll until the run is no longer running (or timeout after 15s)
              const until = Date.now() + 15000;
              while (Date.now() < until) {
                const current = await load();
                if (!current || current.status !== 'running') break;
                await new Promise((r) => setTimeout(r, 1000));
              }
            }}>Stop</button>
          </div>
        </div>
      ) : (
        <div className="panel summary-bar">
          <span>{run.testCases.length} scenario{run.testCases.length === 1 ? "" : "s"}</span>
          <span>{run.progress.completed} results saved</span>
          {run.completedAt && <span>Finished {new Date(run.completedAt).toLocaleTimeString()}</span>}
          <div className="run-actions">
            <button type="button" onClick={async () => { await api.post(`/api/evaluations/${run.id}/restart`, {}); await load(); }}>Restart</button>
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
            model={run.model}
          />
        ))}
      </div>
    </section>
  );
}

function findResult(results: EvaluationResult[], testCaseId: string, variant: "A" | "B") {
  return results.find((result) => result.testCaseId === testCaseId && result.variant === variant);
}

function ResultRow({ index, input, expected, notes, criteria, resultA, resultB, model }: {
  index: number;
  input: string;
  expected: string | null;
  notes: string | null;
  criteria: string[] | null;
  resultA: EvaluationResult | undefined;
  resultB: EvaluationResult | undefined;
  model: ModelId;
}) {
  return (
    <article className="eval-row">
      <div className="eval-input">
        <span className="scenario-num">#{index + 1}</span>
        <p>{input}</p>
        {expected && <p className="scenario-meta"><strong>Expected:</strong> {expected}</p>}
        {criteria?.length ? (
          <p className="scenario-meta"><strong>Criteria:</strong> {criteria.join(", ")}</p>
        ) : null}
        {notes && <p className="scenario-meta"><strong>Notes:</strong> {notes}</p>}
      </div>
      <ResultCell result={resultA} model={model} label="A" />
      <ResultCell result={resultB} model={model} label="B" />
    </article>
  );
}

function ResultCell({ result, model, label }: { result: EvaluationResult | undefined; model: ModelId; label: "A" | "B" }) {
  if (!result || result.status === "failed") {
    return <div className="eval-cell failed"><span className="eval-label">Prompt {label}</span><p className="error">{result?.errorMessage ?? "Not run yet"}</p></div>;
  }
  const pricing = supportedModels.find((item) => item.id === model);
  const isFree = pricing !== undefined && pricing.inputCostPerMillion === 0 && pricing.outputCostPerMillion === 0;
  const judgement = result.judgement;

  return (
    <div className={`eval-cell${judgement ? " judged" : ""}`}>
      <span className="eval-label">Prompt {label}</span>
      {judgement ? (
        <div className="judgement-panel">
          <div className={`judge-pill ${judgement.pass ? "pass" : "fail"}`}>
            {judgement.pass ? "Judge pass" : "Judge fail"}
          </div>
          <span className="judge-score">Score {judgement.overallScore}%</span>
          {judgement.status === "failed" ? (
            <p className="error">Judge error: {judgement.errorMessage ?? "Unknown issue"}</p>
          ) : judgement.summary ? (
            <p className="judgement-summary">{judgement.summary}</p>
          ) : null}
          {judgement.criteriaResults.length > 0 ? (
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
