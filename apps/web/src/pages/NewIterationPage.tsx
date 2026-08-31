import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supportedModels, type ExperimentDetail, type ModelId } from "@prompt-playground/shared";
import { createIteration, getExperiment } from "../api";

const defaultEvaluatorPrompt = "You are an automated judge that evaluates assistant responses against the test case input and expected output. Return only a JSON object with overallScore, pass, summary, and criteriaResults.";

export function NewIterationPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [current, setCurrent] = useState<ExperimentDetail | null>(null);
  const [candidatePrompt, setCandidatePrompt] = useState("");
  const [candidateModel, setCandidateModel] = useState<ModelId>(supportedModels[0].id);
  const [useEvaluator, setUseEvaluator] = useState(false);
  const [evaluatorModel, setEvaluatorModel] = useState<ModelId>(supportedModels[0].id);
  const [evaluatorThreshold, setEvaluatorThreshold] = useState(70);
  const [evaluatorPrompt, setEvaluatorPrompt] = useState(defaultEvaluatorPrompt);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getExperiment(id!)
      .then((experiment) => {
        setCurrent(experiment);
        // The previous candidate becomes the new baseline (immutable); candidate is editable.
        setCandidatePrompt(experiment.candidatePrompt);
        setCandidateModel(experiment.candidateModel as ModelId);
        const hasEvaluator = Boolean(experiment.evaluatorModel);
        setUseEvaluator(hasEvaluator);
        if (experiment.evaluatorModel) setEvaluatorModel(experiment.evaluatorModel as ModelId);
        if (experiment.evaluatorThreshold != null) setEvaluatorThreshold(experiment.evaluatorThreshold);
        if (experiment.evaluatorPrompt) setEvaluatorPrompt(experiment.evaluatorPrompt);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load experiment"));
  }, [id]);

  if (error && !current) return <section className="intro"><p className="error">{error}</p><p><Link to="/experiments">Back to experiments</Link></p></section>;
  if (!current) return <section className="intro"><p>Loading…</p></section>;

  const nextIteration = current.iteration + 1;
  // Evaluator changed vs the previous iteration?
  const evaluatorChanged =
    (evaluatorModel ?? null) !== (current.evaluatorModel ?? null) ||
    (useEvaluator ? evaluatorThreshold : null) !== current.evaluatorThreshold ||
    (useEvaluator ? evaluatorPrompt.trim() : null) !== (current.evaluatorPrompt ?? null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!current) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const next = await createIteration(current.id, {
        candidatePrompt,
        candidateModel,
        ...(useEvaluator
          ? {
              evaluatorModel,
              evaluatorThreshold,
              evaluatorPrompt: evaluatorPrompt || undefined,
            }
          : {}),
      });
      navigate(`/experiments/${next.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create iteration");
      setIsSubmitting(false);
    }
  }

  return (
    <section>
      <div className="intro">
        <p className="eyebrow"><Link to={`/experiments/${current.id}`} className="back-link">EXPERIMENTS / {current.name}</Link> / NEXT ITERATION</p>
        <h1>Create Iteration {nextIteration}.</h1>
        <p>Continue the experiment with the previous candidate as the new baseline. Previous iterations stay unchanged.</p>
      </div>

      {evaluatorChanged && (
        <div className="panel comparability-warning">
          <strong>Evaluation configuration changed.</strong> Results from this iteration may not be directly comparable with the previous iteration.
        </div>
      )}

      <form onSubmit={submit} className="config-grid">
        <section className="panel prompt-editor config-block baseline-block">
          <div className="panel-title"><span>BASELINE <span className="badge">v{nextIteration} (from Iteration {current.iteration} candidate)</span></span></div>
          <p className="hint">The previous candidate, frozen as the new baseline.</p>
          <label>Prompt
            <textarea value={current.candidatePrompt} readOnly rows={7} />
          </label>
          <label>Model
            <input value={current.candidateModel} readOnly />
          </label>
        </section>

        <section className="panel prompt-editor config-block candidate-block">
          <div className="panel-title"><span>CANDIDATE <span className="badge">v{nextIteration + 1}</span></span></div>
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
          <div className="radio-row">
            <label><input type="radio" name="evaluation-method" checked={!useEvaluator} onChange={() => setUseEvaluator(false)} /> Human judgement</label>
            <label><input type="radio" name="evaluation-method" checked={useEvaluator} onChange={() => setUseEvaluator(true)} /> LLM-as-a-Judge</label>
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

        {error && <p className="error" role="alert" style={{ gridColumn: "1 / -1" }}>{error}</p>}

        <div className="row-actions" style={{ gridColumn: "1 / -1" }}>
          <Link className="secondary" to={`/experiments/${current.id}`}>Cancel</Link>
          <button type="submit" className="primary" disabled={isSubmitting || candidatePrompt.trim().length === 0}>
            {isSubmitting ? "Creating…" : "Create Iteration " + nextIteration}
          </button>
        </div>
      </form>
    </section>
  );
}
