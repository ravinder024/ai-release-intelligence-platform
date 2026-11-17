import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { type Dataset } from "@prompt-playground/shared";
import { api, createExperiment, runExperiment } from "../api";
import { ModelSelector } from "../components/ModelSelector";
import { HelpTooltip } from "../components/HelpTooltip";
import { decodeModelSelection, encodeModelSelection } from "../components/ModelSelector";
import { useProviderModels } from "../useModels";

const defaultBaseline = "You are a support assistant. Answer the customer's question clearly and helpfully.";
const defaultCandidate = "You are a support assistant. Acknowledge the concern first, answer clearly, and never make claims you cannot support.";
const defaultEvaluatorPrompt = "You are an automated judge that evaluates assistant responses against the test case input and expected output. Return only a JSON object with overallScore, pass, summary, and criteriaResults.";

const steps = ["Define", "Configure", "Review"];

export function NewExperimentPage() {
  const { options, loading: catalogLoading } = useProviderModels();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [name, setName] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [datasetId, setDatasetId] = useState("");
  const [baselinePrompt, setBaselinePrompt] = useState(defaultBaseline);
  const [baselineSelectionValue, setBaselineSelectionValue] = useState("");
  const [candidatePrompt, setCandidatePrompt] = useState(defaultCandidate);
  const [candidateSelectionValue, setCandidateSelectionValue] = useState("");
  const [useEvaluator, setUseEvaluator] = useState(false);
  const [evaluatorSelectionValue, setEvaluatorSelectionValue] = useState("");
  const [selectionInitialized, setSelectionInitialized] = useState(false);
  const [evaluatorThreshold, setEvaluatorThreshold] = useState(70);
  const [evaluatorPrompt, setEvaluatorPrompt] = useState(defaultEvaluatorPrompt);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Dataset[]>("/api/datasets")
      .then((list) => { setDatasets(list); setDatasetId((current) => current || list[0]?.id || ""); })
      .catch(() => setError("Could not load datasets"));
  }, []);

  useEffect(() => {
    const encodedOptions = options.map((option) => encodeModelSelection({ modelId: option.modelId, provider: option.provider, source: option.source, ...(option.connectionId ? { connectionId: option.connectionId } : {}) }));
    if (!selectionInitialized && !catalogLoading && encodedOptions.length) {
      setBaselineSelectionValue(encodedOptions[0]);
      setCandidateSelectionValue(encodedOptions[0]);
      setEvaluatorSelectionValue(encodedOptions[0]);
      setSelectionInitialized(true);
      return;
    }
    if (selectionInitialized) {
      if (baselineSelectionValue && !encodedOptions.includes(baselineSelectionValue)) setBaselineSelectionValue("");
      if (candidateSelectionValue && !encodedOptions.includes(candidateSelectionValue)) setCandidateSelectionValue("");
      if (evaluatorSelectionValue && !encodedOptions.includes(evaluatorSelectionValue)) setEvaluatorSelectionValue("");
    }
  }, [options, catalogLoading, selectionInitialized, baselineSelectionValue, candidateSelectionValue, evaluatorSelectionValue]);

  const selectedDataset = datasets.find((dataset) => dataset.id === datasetId) ?? null;
  const stepValid = (index: number): boolean => {
    if (index === 0) return name.trim().length > 0 && datasetId.length > 0;
    if (index === 1) return baselinePrompt.trim().length > 0 && candidatePrompt.trim().length > 0 && Boolean(decodeModelSelection(baselineSelectionValue)) && Boolean(decodeModelSelection(candidateSelectionValue)) && (!useEvaluator || Boolean(decodeModelSelection(evaluatorSelectionValue)));
    return true;
  };

  async function run() {
    const baselineSelection = decodeModelSelection(baselineSelectionValue);
    const candidateSelection = decodeModelSelection(candidateSelectionValue);
    const evaluatorSelection = useEvaluator ? decodeModelSelection(evaluatorSelectionValue) : null;
    if (!baselineSelection || !candidateSelection || (useEvaluator && !evaluatorSelection)) {
      setError("Select an available model and provider connection for each configuration.");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const experiment = await createExperiment({
        name,
        hypothesis: hypothesis || undefined,
        datasetId,
        baselinePrompt,
        baselineModel: baselineSelection.modelId,
        baselineSelection,
        candidatePrompt,
        candidateModel: candidateSelection.modelId,
        candidateSelection,
        evaluatorModel: evaluatorSelection?.modelId,
        evaluatorSelection: evaluatorSelection ?? undefined,
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
            <ModelSelector
              label="Model"
              value={baselineSelectionValue}
              onChange={setBaselineSelectionValue}
              options={options}
              loading={catalogLoading}
              className="model-selector"
            />
          </section>

          <section className="panel prompt-editor config-block candidate-block">
            <div className="panel-title">
              <span>CANDIDATE <span className="badge">Proposed configuration</span></span>
            </div>
            <p className="hint">The new configuration you want to test.</p>
            <label>Prompt
              <textarea value={candidatePrompt} onChange={(event) => setCandidatePrompt(event.target.value)} rows={9} />
            </label>
            <ModelSelector
              label="Model"
              value={candidateSelectionValue}
              onChange={setCandidateSelectionValue}
              options={options}
              loading={catalogLoading}
              className="model-selector"
            />
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
                <ModelSelector
                  label="Judge model"
                  value={evaluatorSelectionValue}
                  onChange={setEvaluatorSelectionValue}
                  options={options}
                  loading={catalogLoading}
                  className="model-selector"
                />
                <label>Pass threshold
                  <div className="threshold-row">
                    <input type="number" min={0} max={100} value={evaluatorThreshold} onChange={(event) => setEvaluatorThreshold(Math.max(0, Math.min(100, Number(event.target.value) || 0)))} />
                    <span className="percent">%</span>
                    <HelpTooltip label="About the pass threshold">
                      A result passes when the judge's overall score is at least this percentage (0–100).
                    </HelpTooltip>
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
            <div><dt>Baseline</dt><dd>{decodeModelSelection(baselineSelectionValue)?.modelId ?? "Not selected"}</dd></div>
            <div><dt>Candidate</dt><dd>{decodeModelSelection(candidateSelectionValue)?.modelId ?? "Not selected"}</dd></div>
            <div><dt>Evaluator</dt><dd>{useEvaluator ? `${decodeModelSelection(evaluatorSelectionValue)?.modelId ?? "Not selected"} · threshold ${evaluatorThreshold}%` : "None (human judgement)"}</dd></div>
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
