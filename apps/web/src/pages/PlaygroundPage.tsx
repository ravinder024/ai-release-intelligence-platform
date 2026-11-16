import { useEffect, useState } from "react";
import type { Comparison, CreateComparisonRequest, PromptExecution } from "@prompt-playground/shared";
import { api } from "../api";
import { decodeModelSelection, encodeModelSelection, ModelSelector } from "../components/ModelSelector";
import { useProviderModels } from "../useModels";

const initialRequest: CreateComparisonRequest = {
  model: "nvidia/nemotron-3.5-lightning:free",
  input: "A customer says their monthly invoice is unexpectedly higher than usual. Draft a helpful response.",
  promptA: "You are a concise support assistant. Explain the likely next step in no more than 100 words.",
  promptB: "You are an empathetic support assistant. Acknowledge the concern, explain the likely next step, and offer a clear path to resolution.",
};

const POLL_INTERVAL_MS = 2_000;

function upsertHistory(current: Comparison[], next: Comparison): Comparison[] {
  return [next, ...current.filter((item) => item.id !== next.id)].slice(0, 12);
}

export function PlaygroundPage() {
  const { options, loading: catalogLoading, checkedAt } = useProviderModels();
  const [form, setForm] = useState(initialRequest);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [history, setHistory] = useState<Comparison[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionBusy, setActionBusy] = useState<"stop" | "retry" | "discard" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queryVolume, setQueryVolume] = useState(1_000);
  const [volumePeriod, setVolumePeriod] = useState<"day" | "week" | "month">("month");
  const [modelSelectionValue, setModelSelectionValue] = useState("");
  const [selectionInitialized, setSelectionInitialized] = useState(false);

  const isRunning = comparison?.status === "running";

  useEffect(() => { void loadHistory(); }, []);

  // Poll the open run until it reaches a terminal status (completed / partial_failure / interrupted).
  useEffect(() => {
    const id = comparison?.id;
    if (!id || comparison?.status !== "running") return;
    let cancelled = false;
    const tick = async () => {
      try {
        const fresh = await api.get<Comparison>(`/api/comparisons/${id}`);
        if (cancelled) return;
        setComparison(fresh);
        setHistory((current) => upsertHistory(current, fresh));
      } catch {
        // A transient failure should not stop the poller; the sweep will close the run server-side.
      }
    };
    const timer = setInterval(() => { void tick(); }, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [comparison?.id, comparison?.status]);

  useEffect(() => {
    const values = options.map((option) => encodeModelSelection({ modelId: option.modelId, provider: option.provider, source: option.source, ...(option.connectionId ? { connectionId: option.connectionId } : {}) }));
    if (!selectionInitialized && !catalogLoading && values.length) {
      setModelSelectionValue(values[0]);
      setSelectionInitialized(true);
      return;
    }
    if (selectionInitialized && modelSelectionValue && !values.includes(modelSelectionValue)) setModelSelectionValue("");
  }, [options, catalogLoading, selectionInitialized, modelSelectionValue]);

  async function loadHistory() {
    try {
      setHistory(await api.get<Comparison[]>("/api/comparisons?limit=12"));
    } catch {
      // The empty state is more useful than an error before the local API is started.
    }
  }

  function updateField<Key extends keyof CreateComparisonRequest>(key: Key, value: CreateComparisonRequest[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function runComparison(event: React.FormEvent) {
    event.preventDefault();
    const modelSelection = decodeModelSelection(modelSelectionValue);
    if (!modelSelection) {
      setError("Select an available model and provider connection.");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const data = await api.post<Comparison>("/api/comparisons", { ...form, model: modelSelection.modelId, modelSelection });
      setComparison(data);
      setHistory((current) => upsertHistory(current, data));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not run comparison");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function stopRun(target: Comparison) {
    setActionBusy("stop");
    setError(null);
    try {
      const fresh = await api.post<Comparison>(`/api/comparisons/${target.id}/stop`, {});
      setComparison((current) => (current?.id === fresh.id ? fresh : current));
      setHistory((current) => upsertHistory(current, fresh));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not stop this run");
    } finally {
      setActionBusy(null);
    }
  }

  async function retryRun(target: Comparison) {
    setActionBusy("retry");
    setError(null);
    try {
      const fresh = await api.post<Comparison>(`/api/comparisons/${target.id}/retry`, {});
      setComparison(fresh);
      setHistory((current) => upsertHistory(current, fresh));
      if (fresh.promptA) updateField("promptA", fresh.promptA);
      if (fresh.promptB) updateField("promptB", fresh.promptB);
      updateField("input", fresh.input);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not retry this run");
    } finally {
      setActionBusy(null);
    }
  }

  async function discardRun(target: Comparison) {
    setActionBusy("discard");
    setError(null);
    try {
      await api.delete(`/api/comparisons/${target.id}`);
      setHistory((current) => current.filter((item) => item.id !== target.id));
      setComparison((current) => (current?.id === target.id ? null : current));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not discard this run");
    } finally {
      setActionBusy(null);
    }
  }

  return (
    <section>
      <div className="intro">
        <p className="eyebrow">COMPARE PROMPT VARIANTS</p>
        <h1>Make a better prompt decision.</h1>
        <p>Run two approaches against the same input and keep the evidence.</p>
      </div>

      <form onSubmit={runComparison} className="workspace">
        <section className="controls panel">
          <ModelSelector
            label="Model"
            value={modelSelectionValue}
            onChange={setModelSelectionValue}
            options={options}
            loading={catalogLoading}
            className="model-selector"
          />
          <span className="hint">{checkedAt ? `Free-model health last checked ${new Date(checkedAt).toLocaleString()}.` : "Free-model health has not been checked yet."}</span>
          <label>Shared input
            <textarea value={form.input} onChange={(event) => updateField("input", event.target.value)} rows={5} />
          </label>
          <button type="submit" disabled={isSubmitting || isRunning}>{isRunning ? "Running both prompts…" : isSubmitting ? "Starting…" : "Run comparison"}</button>
          {error && <p className="error" role="alert">{error}</p>}
          <p className="hint">Every run is saved to the comparison history.</p>
          <fieldset className="scale-input">
            <legend>Usage scale</legend>
            <div>
              <input aria-label="Query volume" type="number" min="1" value={queryVolume} onChange={(event) => setQueryVolume(Math.max(1, Number(event.target.value)))} />
              <select aria-label="Query volume period" value={volumePeriod} onChange={(event) => setVolumePeriod(event.target.value as "day" | "week" | "month")}>
                <option value="day">queries / day</option>
                <option value="week">queries / week</option>
                <option value="month">queries / month</option>
              </select>
            </div>
            <p>Projected spend is based on the latest result for each variant. Free models show "Free" instead of a dollar figure.</p>
          </fieldset>
        </section>

        <section className="prompt-grid">
          <PromptEditor title="Prompt A" value={form.promptA} onChange={(value) => updateField("promptA", value)} />
          <PromptEditor title="Prompt B" value={form.promptB} onChange={(value) => updateField("promptB", value)} />
        </section>
      </form>

      {comparison && <ComparisonView
        comparison={comparison}
        queryVolume={queryVolume}
        volumePeriod={volumePeriod}
        actionBusy={actionBusy}
        onStop={() => void stopRun(comparison)}
        onRetry={() => void retryRun(comparison)}
        onDiscard={() => void discardRun(comparison)}
      />}
      <History
        history={history}
        actionBusy={actionBusy}
        onSelect={setComparison}
        onStop={(item) => void stopRun(item)}
        onRetry={(item) => void retryRun(item)}
        onDiscard={(item) => void discardRun(item)}
      />
    </section>
  );
}

function PromptEditor({ title, value, onChange }: { title: string; value: string; onChange: (value: string) => void }) {
  return <section className="panel prompt-editor">
    <div className="panel-title"><span>{title}</span><span className="badge">Variant</span></div>
    <textarea aria-label={title} value={value} onChange={(event) => onChange(event.target.value)} rows={9} />
  </section>;
}

function ComparisonView({ comparison, queryVolume, volumePeriod, actionBusy, onStop, onRetry, onDiscard }: {
  comparison: Comparison;
  queryVolume: number;
  volumePeriod: "day" | "week" | "month";
  actionBusy: "stop" | "retry" | "discard" | null;
  onStop: () => void;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const isRunning = comparison.status === "running";
  const canAct = !isRunning && (comparison.status === "partial_failure" || comparison.status === "interrupted");
  const executions = ["A", "B"].map((variant) => comparison.executions.find((execution) => execution.variant === variant));
  return <section className="result-section">
    <div className="section-heading">
      <div><p className="eyebrow">LATEST RESULT</p><h2>Side-by-side output</h2></div>
      <div className="run-controls">
        <span className={`status ${comparison.status}`}>{comparison.status.replace("_", " ")}</span>
        {isRunning && <button type="button" className="secondary" onClick={onStop} disabled={actionBusy !== null}>{actionBusy === "stop" ? "Stopping…" : "Stop run"}</button>}
        {canAct && <button type="button" className="secondary" onClick={onRetry} disabled={actionBusy !== null}>{actionBusy === "retry" ? "Retrying…" : "Retry"}</button>}
        {!isRunning && <button type="button" className="secondary danger-text" onClick={onDiscard} disabled={actionBusy !== null}>{actionBusy === "discard" ? "Discarding…" : "Discard"}</button>}
      </div>
    </div>
    {isRunning && <p className="run-note">Both prompts are running. You can leave this page — the run keeps going and appears in the history below.</p>}
    {comparison.status === "interrupted" && <p className="run-note run-note-warn">This run was interrupted — it was stopped, or the server restarted while it was running. Any response that finished is kept below; <strong>Retry</strong> runs both prompts again as a new comparison.</p>}
    {comparison.status === "partial_failure" && <p className="run-note run-note-warn">One or both prompts failed. The error is shown on the card; <strong>Retry</strong> starts a fresh run with the same prompts.</p>}
    <div className="result-grid">
      {["A", "B"].map((variant, index) => {
        const execution = executions[index];
        if (!execution) {
          return <article className="panel result-card pending-card" key={variant}>
            <div className="panel-title">
              <span>Prompt {variant}</span>
              <span className={isRunning ? "status running" : "status interrupted"}>{isRunning ? "running" : comparison.status.replace("_", " ")}</span>
            </div>
            <p className="pending-note">{isRunning ? "Waiting for a response…" : "No response was recorded for this prompt."}</p>
          </article>;
        }
        return <ResultCard key={execution.id} execution={execution} model={comparison.model} modelConfig={comparison.modelConfig ?? null} queryVolume={queryVolume} volumePeriod={volumePeriod} />;
      })}
    </div>
  </section>;
}

function ResultCard({ execution, model, modelConfig, queryVolume, volumePeriod }: { execution: PromptExecution; model: string; modelConfig: Comparison["modelConfig"]; queryVolume: number; volumePeriod: "day" | "week" | "month" }) {
  const isFreeModel = modelConfig?.source === "platform_free" || (modelConfig?.inputCostPerMillion === 0 && modelConfig.outputCostPerMillion === 0);
  const inputCost = modelConfig?.inputCostPerMillion != null && execution.inputTokens != null ? execution.inputTokens / 1_000_000 * modelConfig.inputCostPerMillion : null;
  const outputCost = modelConfig?.outputCostPerMillion != null && execution.outputTokens != null ? execution.outputTokens / 1_000_000 * modelConfig.outputCostPerMillion : null;
  const totalCost = execution.estimatedCostUsd ?? (inputCost == null || outputCost == null ? null : inputCost + outputCost);
  const modelLabel = `${modelConfig?.provider ?? "Model"} · ${modelConfig?.keyLabel ?? ""} · ${model}`;
  const costCell = (value: number | null) => isFreeModel ? "Free" : value == null ? "—" : formatCost(value);
  return <article className="panel result-card">
    <div className="panel-title"><span>Prompt {execution.variant}</span><span className="model-name">{modelLabel}</span><span className={`status ${execution.status}`}>{execution.status}</span></div>
    {execution.status === "failed" ? <p className="error">{execution.errorMessage}</p> : <div className="model-output"><span>Model response</span><pre>{execution.output || "No response returned."}</pre></div>}
    <dl className="metrics">
      <div><dt>Latency</dt><dd>{execution.latencyMs?.toLocaleString() ?? "—"} ms</dd></div>
      <div><dt>Tokens</dt><dd>{execution.totalTokens?.toLocaleString() ?? "—"}</dd></div>
      <div><dt>Est. cost</dt><dd>{costCell(execution.estimatedCostUsd)}</dd></div>
      <div><dt>Input tokens</dt><dd>{execution.inputTokens?.toLocaleString() ?? "N/A"}</dd></div>
      <div><dt>Output tokens</dt><dd>{execution.outputTokens?.toLocaleString() ?? "N/A"}</dd></div>
      <div><dt>Input cost</dt><dd>{isFreeModel ? "Free" : inputCost == null ? "N/A" : formatCost(inputCost)}</dd></div>
      <div><dt>Output cost</dt><dd>{isFreeModel ? "Free" : outputCost == null ? "N/A" : formatCost(outputCost)}</dd></div>
      <div><dt>{queryVolume.toLocaleString()} / {volumePeriod}</dt><dd>{isFreeModel ? "Free" : totalCost == null ? "N/A" : formatCost(totalCost * queryVolume)}</dd></div>
    </dl>
  </article>;
}

function History({ history, actionBusy, onSelect, onStop, onRetry, onDiscard }: {
  history: Comparison[];
  actionBusy: "stop" | "retry" | "discard" | null;
  onSelect: (comparison: Comparison) => void;
  onStop: (comparison: Comparison) => void;
  onRetry: (comparison: Comparison) => void;
  onDiscard: (comparison: Comparison) => void;
}) {
  return <section className="history run-history"><div className="section-heading"><div><p className="eyebrow">SAVED COMPARISONS</p><h2>Recent runs</h2></div></div>
    {history.length === 0 ? <div className="empty">No comparisons yet. Your completed runs will appear here.</div> : <div className="history-list">{history.map((item) => {
      const running = item.status === "running";
      const retryable = item.status === "interrupted" || item.status === "partial_failure";
      return <div className="history-item" key={item.id}>
        <button type="button" className="history-open" onClick={() => onSelect(item)} title="Open this run">
          <span>{new Date(item.createdAt).toLocaleString()}</span>
          <span>{item.model}</span>
          <span>{item.input}</span>
        </button>
        <span className={`status ${item.status}`}>{item.status.replace("_", " ")}</span>
        <div className="history-actions">
          {running && <button type="button" onClick={() => onStop(item)} disabled={actionBusy !== null}>Stop</button>}
          {retryable && <button type="button" onClick={() => onRetry(item)} disabled={actionBusy !== null}>Retry</button>}
          {!running && <button type="button" className="danger-text" onClick={() => onDiscard(item)} disabled={actionBusy !== null}>Discard</button>}
        </div>
      </div>;
    })}</div>}
  </section>;
}

function formatCost(cost: number) { return cost < 0.01 ? `$${cost.toFixed(5)}` : `$${cost.toFixed(3)}`; }
