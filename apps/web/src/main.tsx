import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { supportedModels, type Comparison, type CreateComparisonRequest, type ModelId, type PromptExecution } from "@prompt-playground/shared";
import "./styles.css";

const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
const initialRequest: CreateComparisonRequest = {
  model: "gpt-4.1-mini",
  input: "A customer says their monthly invoice is unexpectedly higher than usual. Draft a helpful response.",
  promptA: "You are a concise support assistant. Explain the likely next step in no more than 100 words.",
  promptB: "You are an empathetic support assistant. Acknowledge the concern, explain the likely next step, and offer a clear path to resolution.",
};

function App() {
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
      const response = await fetch(`${apiUrl}/api/comparisons?limit=12`);
      if (response.ok) setHistory(await response.json());
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
      const response = await fetch(`${apiUrl}/api/comparisons`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not run comparison");
      setComparison(data);
      setHistory((current) => [data, ...current.filter((item) => item.id !== data.id)].slice(0, 12));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not run comparison");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><span className="mark">P</span><span>Prompt Playground</span></div>
        <span className="scope">Release intelligence / Experiment</span>
      </header>
      <section className="intro">
        <p className="eyebrow">COMPARE PROMPT VARIANTS</p>
        <h1>Make a better prompt decision.</h1>
        <p>Run two approaches against the same input and keep the evidence.</p>
      </section>

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
            <p>Projected spend is based on the latest result for each variant.</p>
          </fieldset>
        </section>

        <section className="prompt-grid">
          <PromptEditor title="Prompt A" value={form.promptA} onChange={(value) => updateField("promptA", value)} />
          <PromptEditor title="Prompt B" value={form.promptB} onChange={(value) => updateField("promptB", value)} />
        </section>
      </form>

      {comparison && <ComparisonView comparison={comparison} queryVolume={queryVolume} volumePeriod={volumePeriod} />}
      <History history={history} onSelect={setComparison} />
    </main>
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
  const pricing = supportedModels.find((item) => item.id === model)!;
  const inputCost = execution.inputTokens == null ? null : execution.inputTokens / 1_000_000 * pricing.inputCostPerMillion;
  const outputCost = execution.outputTokens == null ? null : execution.outputTokens / 1_000_000 * pricing.outputCostPerMillion;
  const totalCost = execution.estimatedCostUsd ?? (inputCost == null || outputCost == null ? null : inputCost + outputCost);
  return <article className="panel result-card">
    <div className="panel-title"><span>Prompt {execution.variant}</span><span className={`status ${execution.status}`}>{execution.status}</span></div>
    {execution.status === "failed" ? <p className="error">{execution.errorMessage}</p> : <div className="model-output"><span>Model response</span><pre>{execution.output || "No response returned."}</pre></div>}
    <dl className="metrics">
      <div><dt>Latency</dt><dd>{execution.latencyMs?.toLocaleString() ?? "—"} ms</dd></div>
      <div><dt>Tokens</dt><dd>{execution.totalTokens?.toLocaleString() ?? "—"}</dd></div>
      <div><dt>Est. cost</dt><dd>{execution.estimatedCostUsd == null ? "—" : formatCost(execution.estimatedCostUsd)}</dd></div>
      <div><dt>Input tokens</dt><dd>{execution.inputTokens?.toLocaleString() ?? "N/A"}</dd></div>
      <div><dt>Output tokens</dt><dd>{execution.outputTokens?.toLocaleString() ?? "N/A"}</dd></div>
      <div><dt>Input cost</dt><dd>{inputCost == null ? "N/A" : formatCost(inputCost)}</dd></div>
      <div><dt>Output cost</dt><dd>{outputCost == null ? "N/A" : formatCost(outputCost)}</dd></div>
      <div><dt>{queryVolume.toLocaleString()} / {volumePeriod}</dt><dd>{totalCost == null ? "N/A" : formatCost(totalCost * queryVolume)}</dd></div>
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

createRoot(document.getElementById("root")!).render(<App />);
