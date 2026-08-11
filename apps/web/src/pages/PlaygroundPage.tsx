import { useEffect, useState } from "react";
import { supportedModels, type Comparison, type CreateComparisonRequest, type ModelId, type PromptExecution } from "@prompt-playground/shared";
import { api } from "../api";

const initialRequest: CreateComparisonRequest = {
  model: "openai/gpt-oss-20b:free",
  input: "A customer says their monthly invoice is unexpectedly higher than usual. Draft a helpful response.",
  promptA: "You are a concise support assistant. Explain the likely next step in no more than 100 words.",
  promptB: "You are an empathetic support assistant. Acknowledge the concern, explain the likely next step, and offer a clear path to resolution.",
};

export function PlaygroundPage() {
  const [form, setForm] = useState(initialRequest);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [history, setHistory] = useState<Comparison[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queryVolume, setQueryVolume] = useState(1_000);
  const [volumePeriod, setVolumePeriod] = useState<"day" | "week" | "month">("month");

  useEffect(() => { void loadHistory(); }, []);

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
    setIsRunning(true);
    setError(null);
    try {
      const data = await api.post<Comparison>("/api/comparisons", form);
      setComparison(data);
      setHistory((current) => [data, ...current.filter((item) => item.id !== data.id)].slice(0, 12));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not run comparison");
    } finally {
      setIsRunning(false);
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
          <label>Model
            <select value={form.model} onChange={(event) => updateField("model", event.target.value as ModelId)}>
              {supportedModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
            </select>
          </label>
          <label>Shared input
            <textarea value={form.input} onChange={(event) => updateField("input", event.target.value)} rows={5} />
          </label>
          <button type="submit" disabled={isRunning}>{isRunning ? "Running both prompts…" : "Run comparison"}</button>
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

      {comparison && <ComparisonView comparison={comparison} queryVolume={queryVolume} volumePeriod={volumePeriod} />}
      <History history={history} onSelect={setComparison} />
    </section>
  );
}

function PromptEditor({ title, value, onChange }: { title: string; value: string; onChange: (value: string) => void }) {
  return <section className="panel prompt-editor">
    <div className="panel-title"><span>{title}</span><span className="badge">Variant</span></div>
    <textarea aria-label={title} value={value} onChange={(event) => onChange(event.target.value)} rows={9} />
  </section>;
}

function ComparisonView({ comparison, queryVolume, volumePeriod }: { comparison: Comparison; queryVolume: number; volumePeriod: "day" | "week" | "month" }) {
  const executions = ["A", "B"].map((variant) => comparison.executions.find((execution) => execution.variant === variant)).filter(Boolean) as PromptExecution[];
  return <section className="result-section">
    <div className="section-heading"><div><p className="eyebrow">LATEST RESULT</p><h2>Side-by-side output</h2></div><span className={`status ${comparison.status}`}>{comparison.status.replace("_", " ")}</span></div>
    <div className="result-grid">{executions.map((execution) => <ResultCard key={execution.id} execution={execution} model={comparison.model} queryVolume={queryVolume} volumePeriod={volumePeriod} />)}</div>
  </section>;
}

function ResultCard({ execution, model, queryVolume, volumePeriod }: { execution: PromptExecution; model: ModelId; queryVolume: number; volumePeriod: "day" | "week" | "month" }) {
  const pricing = supportedModels.find((item) => item.id === model);
  const isFreeModel = pricing !== undefined && pricing.inputCostPerMillion === 0 && pricing.outputCostPerMillion === 0;
  const inputCost = pricing != null && execution.inputTokens != null ? execution.inputTokens / 1_000_000 * pricing.inputCostPerMillion : null;
  const outputCost = pricing != null && execution.outputTokens != null ? execution.outputTokens / 1_000_000 * pricing.outputCostPerMillion : null;
  const totalCost = execution.estimatedCostUsd ?? (inputCost == null || outputCost == null ? null : inputCost + outputCost);
  const modelLabel = pricing?.label ?? model;
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

function History({ history, onSelect }: { history: Comparison[]; onSelect: (comparison: Comparison) => void }) {
  return <section className="history"><div className="section-heading"><div><p className="eyebrow">SAVED COMPARISONS</p><h2>Recent runs</h2></div></div>
    {history.length === 0 ? <div className="empty">No comparisons yet. Your completed runs will appear here.</div> : <div className="history-list">{history.map((item) => <button className="history-item" key={item.id} type="button" onClick={() => onSelect(item)}>
      <span>{new Date(item.createdAt).toLocaleString()}</span><span>{item.model}</span><span>{item.input}</span><span className={`status ${item.status}`}>{item.status.replace("_", " ")}</span>
    </button>)}</div>}
  </section>;
}

function formatCost(cost: number) { return cost < 0.01 ? `$${cost.toFixed(5)}` : `$${cost.toFixed(3)}`; }
