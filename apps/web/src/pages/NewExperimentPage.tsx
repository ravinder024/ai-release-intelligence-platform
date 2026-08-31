import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supportedModels, type Dataset, type ModelId } from "@prompt-playground/shared";
import { api, createExperiment, runExperiment } from "../api";

const defaultBaseline = "You are a support assistant. Answer the customer's question clearly and helpfully.";
const defaultCandidate = "You are a support assistant. Acknowledge the concern first, answer clearly, and never make claims you cannot support.";
const defaultEvaluatorPrompt = "You are an automated judge that evaluates assistant responses against the test case input and expected output. Return only a JSON object with overallScore, pass, summary, and criteriaResults.";

const steps = ["Define", "Configure", "Review"];

export function NewExperimentPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [name, setName] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [datasetId, setDatasetId] = useState("");
  const [baselinePrompt, setBaselinePrompt] = useState(defaultBaseline);
  const [baselineModel, setBaselineModel] = useState<ModelId>(supportedModels[0].id);
  const [candidatePrompt, setCandidatePrompt] = useState(defaultCandidate);
  const [candidateModel, setCandidateModel] = useState<ModelId>(supportedModels[0].id);
  const [useEvaluator, setUseEvaluator] = useState(false);
  const [evaluatorModel, setEvaluatorModel] = useState<ModelId>(supportedModels[0].id);
  const [evaluatorThreshold, setEvaluatorThreshold] = useState(70);
  const [evaluatorPrompt, setEvaluatorPrompt] = useState(defaultEvaluatorPrompt);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Dataset[]>("/api/datasets")
      .then((list) => { setDatasets(list); setDatasetId((current) => current || list[0]?.id || ""); })
      .catch(() => setError("Could not load datasets"));
  }, []);

  const selectedDataset = datasets.find((dataset) => dataset.id === datasetId) ?? null;
  const stepValid = (index: number): boolean => {
    if (index === 0) return name.trim().length > 0 && datasetId.length > 0;
    if (index === 1) return baselinePrompt.trim().length > 0 && candidatePrompt.trim().length > 0;
    return true;
  };

  async function run() {
    setIsSubmitting(true);
    setError(null);
    try {
      const experiment = await createExperiment({
        name,
        hypothesis: hypothesis || undefined,
        datasetId,
        baselinePrompt,
        baselineModel,
        candidatePrompt,
        candidateModel,
        evaluatorModel: useEvaluator ? evaluatorModel : undefined,
        evaluatorThreshold: useEvaluator ? evaluatorThreshold : undefined,
        evaluatorPrompt: useEvaluator ? evaluatorPrompt : undefined,
      });
      await runExperiment(experiment.id);
      navigate(`/experiments/${experiment.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not run experiment");
      setIsSubmitting(false);
    }
  }

  return (
    <section>
      <div className="intro">
        <p className="eyebrow"><Link to="/experiments" className="back-link">EXPERIMENTS</Link> / NEW</p>
        <h1>New experiment.</h1>
        <p>Define a hypothesis, pick a benchmark dataset, and compare a baseline against a candidate configuration.</p>
      </div>

      <div className="wizard-steps">
        {steps.map((label, index) => (
          <button
            key={label}
            type="button"
            className={`wizard-step ${index === step ? "active" : ""} ${index < step ? "done" : ""}`}
            onClick={() => { if (stepValid(index)) setStep(index); }}
          >
            <span className="wizard-num">{index < step ? "✓" : index + 1}</span>
            <span>{label}</span>
          </button>
        ))}
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      {step === 0 && (
        <div className="panel create-form">
          <h3>1 · Define the experiment</h3>
          <label>Experiment name
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={160} placeholder="e.g. Improve customer support accuracy" autoFocus />
          </label>
          <label>Hypothesis
            <textarea value={hypothesis} onChange={(event) => setHypothesis(event.target.value)} rows={3} placeholder="e.g. Adding explicit instructions around unsupported claims will improve quality without materially increasing cost or latency." />
          </label>
          <label>Dataset — the benchmark both configurations will be evaluated against
            <select value={datasetId} onChange={(event) => setDatasetId(event.target.value)}>
              {datasets.length === 0 && <option value="">No datasets available</option>}
              {datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name} ({dataset.testCaseCount} scenario{dataset.testCaseCount === 1 ? "" : "s"})</option>)}
            </select>
          </label>
          {selectedDataset && (
            <p className="hint">Dataset: <strong>{selectedDataset.name}</strong> · {selectedDataset.testCaseCount} scenario{selectedDataset.testCaseCount === 1 ? "" : "s"}. Both the baseline and candidate will be run against every scenario.</p>
          )}
          <div className="row-actions">
            <button type="button" className="primary" disabled={!stepValid(0)} onClick={() => setStep(1)}>Next</button>
          </div>
        </div>
      )}

      {step === 1 && (
        <>
        <div className="section-heading"><div><p className="eyebrow">TARGET CONFIGURATION</p><h2>Baseline vs Candidate</h2></div></div>
        <div className="config-grid">
          <section className="panel prompt-editor config-block baseline-block">
            <div className="panel-title">
              <span>BASELINE <span className="badge">Current configuration</span></span>
            </div>
            <p className="hint">The current configuration you want to compare against.</p>
            <label>Prompt
              <textarea value={baselinePrompt} onChange={(event) => setBaselinePrompt(event.target.value)} rows={9} />
            </label>
            <label>Model
              <select value={baselineModel} onChange={(event) => setBaselineModel(event.target.value as ModelId)}>
                {supportedModels.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
          </section>

          <section className="panel prompt-editor config-block candidate-block">
            <div className="panel-title">
              <span>CANDIDATE <span className="badge">Proposed configuration</span></span>
            </div>
            <p className="hint">The new configuration you want to test.</p>
            <label>Prompt
              <textarea value={candidatePrompt} onChange={(event) => setCandidatePrompt(event.target.value)} rows={9} />
            </label>
            <label>Model
              <select value={candidateModel} onChange={(event) => setCandidateModel(event.target.value as ModelId)}>
                {supportedModels.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
          </section>

          <section className="panel judge-settings" style={{ gridColumn: "1 / -1" }}>
            <div className="panel-title"><span>EVALUATION CONFIGURATION</span></div>
            <p className="hint">The evaluator is separate from the target model. The judge evaluates each candidate response against the golden answer and evaluation criteria.</p>
            <div className="radio-row">
              <label>
                <input type="radio" name="evaluation-method" checked={!useEvaluator} onChange={() => setUseEvaluator(false)} />
                Human judgement
              </label>
              <label>
                <input type="radio" name="evaluation-method" checked={useEvaluator} onChange={() => setUseEvaluator(true)} />
                LLM-as-a-Judge
              </label>
            </div>
            {useEvaluator && (
              <div className="judge-settings-inner">
                <label>Judge model
                  <select value={evaluatorModel} onChange={(event) => setEvaluatorModel(event.target.value as ModelId)}>
                    {supportedModels.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select>
                </label>
                <label>Pass threshold
                  <div className="threshold-row">
                    <input type="number" min={0} max={100} value={evaluatorThreshold} onChange={(event) => setEvaluatorThreshold(Math.max(0, Math.min(100, Number(event.target.value) || 0)))} />
                    <span className="percent">%</span>
                  </div>
                </label>
                <label>Judge prompt
                  <textarea value={evaluatorPrompt} onChange={(event) => setEvaluatorPrompt(event.target.value)} rows={6} />
                </label>
              </div>
            )}
          </section>

          <div className="row-actions" style={{ gridColumn: "1 / -1" }}>
            <button type="button" className="secondary" onClick={() => setStep(0)}>Back</button>
            <button type="button" className="primary" disabled={!stepValid(1)} onClick={() => setStep(2)}>Next</button>
          </div>
        </div>
        </>
      )}

      {step === 2 && (
        <div className="panel create-form">
          <h3>Review &amp; run</h3>
          <dl className="review-list">
            <div><dt>Experiment</dt><dd>{name}</dd></div>
            <div><dt>Hypothesis</dt><dd>{hypothesis || "—"}</dd></div>
            <div><dt>Dataset</dt><dd>{selectedDataset ? `${selectedDataset.name} (${selectedDataset.testCaseCount} scenarios)` : "—"}</dd></div>
            <div><dt>Baseline</dt><dd>{baselineModel}</dd></div>
            <div><dt>Candidate</dt><dd>{candidateModel}</dd></div>
            <div><dt>Evaluator</dt><dd>{useEvaluator ? `${evaluatorModel} · threshold ${evaluatorThreshold}%` : "None (human judgement)"}</dd></div>
          </dl>
          <div className="review-prompts">
            <div className="config-block baseline-block">
              <h4>BASELINE</h4>
              <pre>{baselinePrompt}</pre>
            </div>
            <div className="config-block candidate-block">
              <h4>CANDIDATE</h4>
              <pre>{candidatePrompt}</pre>
            </div>
          </div>
          <p className="hint">Starting the run freezes this configuration. Results are saved and can be reviewed later even if the dataset or prompts change.</p>
          <div className="row-actions">
            <button type="button" className="secondary" onClick={() => setStep(1)}>Back</button>
            <button type="button" className="primary" onClick={() => void run()} disabled={isSubmitting}>
              {isSubmitting ? "Starting…" : "Run Experiment"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
