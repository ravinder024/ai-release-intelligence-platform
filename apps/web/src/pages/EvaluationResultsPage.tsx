import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supportedModels, type EvaluationResult, type EvaluationRun, type ModelId } from "@prompt-playground/shared";
import { api } from "../api";

export function EvaluationResultsPage() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<EvaluationRun | null>(null);
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

  if (error && !run) return <section className="intro"><p className="error">{error}</p><p><Link to="/datasets">Back to datasets</Link></p></section>;
  if (!run) return <section className="intro"><p>Loading…</p></section>;

  const isRunning = run.status === "running";
  const percent = run.progress.total === 0 ? 0 : Math.round((run.progress.completed / run.progress.total) * 100);

  return (
    <section>
      <div className="intro">
        <p className="eyebrow">EVALUATION RESULTS</p>
        <h1>How did both prompts do?</h1>
        <p>Dataset: <Link to={`/datasets/${run.datasetId}`} className="back-link">{run.datasetName}</Link> · {run.model}</p>
      </div>

      <div className="section-heading">
        <div><p className="eyebrow">RUN</p><h2>{new Date(run.createdAt).toLocaleString()}</h2></div>
        <span className={`status ${run.status}`}>{run.status.replace("_", " ")}</span>
      </div>

      {isRunning ? (
        <div className="panel progress-panel">
          <div className="progress-row"><span>Evaluating {run.testCases.length} scenario{run.testCases.length === 1 ? "" : "s"}…</span><strong>{run.progress.completed} / {run.progress.total}</strong></div>
          <div className="progress-track"><div className="progress-fill" style={{ width: `${percent}%` }} /></div>
          <p className="hint">Running scenarios a few at a time to avoid rate limits. This page updates automatically.</p>
        </div>
      ) : (
        <div className="panel summary-bar">
          <span>{run.testCases.length} scenario{run.testCases.length === 1 ? "" : "s"}</span>
          <span>{run.progress.completed} results saved</span>
          {run.completedAt && <span>Finished {new Date(run.completedAt).toLocaleTimeString()}</span>}
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

function ResultRow({ index, input, expected, notes, resultA, resultB, model }: {
  index: number;
  input: string;
  expected: string | null;
  notes: string | null;
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
  return (
    <div className="eval-cell">
      <span className="eval-label">Prompt {label}</span>
      <pre className="eval-output">{result.output || "No response returned."}</pre>
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
