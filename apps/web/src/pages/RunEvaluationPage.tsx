import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supportedModels, type DatasetDetail, type EvaluationRun, type ModelId } from "@prompt-playground/shared";
import { api } from "../api";

const defaultPromptA = "You are a concise support assistant. Explain the likely next step in no more than 100 words.";
const defaultPromptB = "You are an empathetic support assistant. Acknowledge the concern, explain the likely next step, and offer a clear path to resolution.";
const defaultEvaluatorPrompt = "You are an automated judge that evaluates assistant responses against the test case input and expected output. Return only a JSON object with overallScore, pass, summary, and criteriaResults.";

export function RunEvaluationPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [dataset, setDataset] = useState<DatasetDetail | null>(null);
  const [model, setModel] = useState<ModelId>(supportedModels[0].id);
  const [promptA, setPromptA] = useState(defaultPromptA);
  const [promptB, setPromptB] = useState(defaultPromptB);
  const [useEvaluator, setUseEvaluator] = useState(false);
  const [evaluatorModel, setEvaluatorModel] = useState<ModelId>(supportedModels[0].id);
  const [evaluatorThreshold, setEvaluatorThreshold] = useState(70);
  const [evaluatorPrompt, setEvaluatorPrompt] = useState(defaultEvaluatorPrompt);
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
        evaluatorModel: useEvaluator ? evaluatorModel : undefined,
        evaluatorThreshold: useEvaluator ? evaluatorThreshold : undefined,
        evaluatorPrompt: useEvaluator ? evaluatorPrompt : undefined,
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
          <div className="radio-row">
            <label>
              <input type="radio" name="judge" checked={!useEvaluator} onChange={() => setUseEvaluator(false)} />
              Human judgement (default)
            </label>
            <label>
              <input type="radio" name="judge" checked={useEvaluator} onChange={() => setUseEvaluator(true)} />
              LLM judge
            </label>
          </div>
          {useEvaluator && (
            <div className="panel judge-settings">
              <label>Judge model
                <select value={evaluatorModel} onChange={(event) => setEvaluatorModel(event.target.value as ModelId)}>
                  {supportedModels.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </label>
              <label>Pass threshold
                <div className="threshold-row">
                  <input type="number" min={0} max={100} value={evaluatorThreshold} onChange={(event) => setEvaluatorThreshold(Math.max(0, Math.min(100, Number(event.target.value) || 0)))} />
                  <span className="percent">%</span>
                  <button type="button" className="help-icon" title="Pass threshold is a percentage (0–100). A result passes if the judge's overall score is greater than or equal to this threshold.">!</button>
                </div>
              </label>
              <label>Judge prompt
                <textarea value={evaluatorPrompt} onChange={(event) => setEvaluatorPrompt(event.target.value)} rows={4} />
              </label>
            </div>
          )}
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
