import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supportedModels, type DatasetDetail, type EvaluationRun, type ModelId } from "@prompt-playground/shared";
import { api } from "../api";

const defaultPromptA = "You are a concise support assistant. Explain the likely next step in no more than 100 words.";
const defaultPromptB = "You are an empathetic support assistant. Acknowledge the concern, explain the likely next step, and offer a clear path to resolution.";

export function RunEvaluationPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [dataset, setDataset] = useState<DatasetDetail | null>(null);
  const [model, setModel] = useState<ModelId>(supportedModels[0].id);
  const [promptA, setPromptA] = useState(defaultPromptA);
  const [promptB, setPromptB] = useState(defaultPromptB);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<DatasetDetail>(`/api/datasets/${id}`)
      .then(setDataset)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load dataset"));
  }, [id]);

  async function start(event: React.FormEvent) {
    event.preventDefault();
    if (!dataset) return;
    setIsStarting(true);
    setError(null);
    try {
      const run = await api.post<EvaluationRun>("/api/evaluations", {
        datasetId: dataset.id,
        model,
        promptA,
        promptB,
      });
      navigate(`/evaluations/${run.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start evaluation");
      setIsStarting(false);
    }
  }

  if (error && !dataset) return <section className="intro"><p className="error">{error}</p><p><Link to="/datasets">Back to datasets</Link></p></section>;
  if (!dataset) return <section className="intro"><p>Loading…</p></section>;

  return (
    <section>
      <div className="intro">
        <p className="eyebrow"><Link to={`/datasets/${dataset.id}`} className="back-link">DATASETS / {dataset.name}</Link> / RUN EVALUATION</p>
        <h1>Run an evaluation.</h1>
        <p>Run both prompt versions across all {dataset.testCaseCount} scenario{dataset.testCaseCount === 1 ? "" : "s"}.</p>
      </div>

      <form onSubmit={start} className="run-form">
        <section className="panel controls">
          <label>Dataset
            <input value={dataset.name} disabled />
          </label>
          <label>Scenarios
            <input value={`${dataset.testCaseCount} scenario${dataset.testCaseCount === 1 ? "" : "s"}`} disabled />
          </label>
          <label>Model
            <select value={model} onChange={(event) => setModel(event.target.value as ModelId)}>
              {supportedModels.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <p className="hint">Free models can be slow and occasionally rate-limited. Runs happen in the background with a progress bar.</p>
        </section>

        <section className="prompt-grid">
          <PromptEditor title="Prompt A" value={promptA} onChange={setPromptA} />
          <PromptEditor title="Prompt B" value={promptB} onChange={setPromptB} />
        </section>

        <div className="run-submit">
          <button className="primary" type="submit" disabled={isStarting || promptA.trim().length === 0 || promptB.trim().length === 0}>
            {isStarting ? "Starting…" : "Start evaluation"}
          </button>
          <span className="hint">Every scenario is run through both prompts. Results are saved and can be revisited.</span>
        </div>
      </form>
    </section>
  );
}

function PromptEditor({ title, value, onChange }: { title: string; value: string; onChange: (value: string) => void }) {
  return <section className="panel prompt-editor">
    <div className="panel-title"><span>{title}</span><span className="badge">Variant</span></div>
    <textarea aria-label={title} value={value} onChange={(event) => onChange(event.target.value)} rows={9} />
  </section>;
}
