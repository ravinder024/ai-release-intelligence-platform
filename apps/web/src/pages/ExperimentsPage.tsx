import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Experiment } from "@prompt-playground/shared";
import { getExperiments } from "../api";

const decisionLabel: Record<string, string> = {
  promote_candidate: "Promote Candidate",
  keep_baseline: "Keep Baseline",
  continue_experiment: "Continue Experiment",
};

export function ExperimentsPage() {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => { void load(); }, []);

  async function load() {
    try {
      setExperiments(await getExperiments());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load experiments");
    }
  }

  return (
    <section>
      <div className="intro">
        <p className="eyebrow">EXPERIMENTS</p>
        <h1>Experiments</h1>
        <p>Compare AI configurations, measure improvements, and decide what to promote.</p>
      </div>

      <div className="section-heading">
        <div><p className="eyebrow">COLLECTIONS</p><h2>Your experiments</h2></div>
        <button className="primary" onClick={() => navigate("/experiments/new")}>+ New Experiment</button>
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      {experiments.length === 0 ? (
        <div className="empty">
          No experiments yet. Create an experiment to compare a baseline configuration against a candidate on a golden dataset.
          <div className="row-actions" style={{ marginTop: 12 }}>
            <button className="primary" onClick={() => navigate("/experiments/new")}>Create your first experiment</button>
          </div>
        </div>
      ) : (
        <div className="experiment-list">
          {experiments.map((experiment) => (
            <Link className="panel experiment-row" to={`/experiments/${experiment.id}`} key={experiment.id}>
              <div className="experiment-main">
                <div className="panel-title">
                  <span className="dataset-name">{experiment.name}</span>
                  <span className="iteration-badge">Iteration {experiment.iteration}</span>
                  <span className={`status ${experiment.status}`}>{experiment.status.replace("_", " ")}</span>
                </div>
                {experiment.hypothesis && <p className="dataset-desc">{experiment.hypothesis}</p>}
                <div className="dataset-meta">
                  <span>Dataset: {experiment.datasetName ?? "—"}</span>
                  <span>Baseline: {experiment.baselineModel}</span>
                  <span>Candidate: {experiment.candidateModel}</span>
                  {experiment.iterationCount != null && experiment.iterationCount > 1 && <span>{experiment.iterationCount} iteration{experiment.iterationCount === 1 ? "" : "s"}</span>}
                  <span>{new Date(experiment.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
              <div className="experiment-results">
                {experiment.scoreDelta != null && experiment.latestResult ? (
                  <>
                    <div className="metric-block">
                      <span className="metric-label">Quality</span>
                      <strong className={experiment.scoreDelta >= 0 ? "delta-positive" : "delta-negative"}>
                        {experiment.scoreDelta >= 0 ? "+" : ""}{experiment.scoreDelta.toFixed(1)}
                      </strong>
                    </div>
                    <div className="metric-block">
                      <span className="metric-label">Pass rate</span>
                      <strong className={experiment.passRateDelta != null && experiment.passRateDelta >= 0 ? "delta-positive" : "delta-negative"}>
                        {experiment.passRateDelta != null ? `${experiment.passRateDelta >= 0 ? "+" : ""}${experiment.passRateDelta.toFixed(1)} pp` : "—"}
                      </strong>
                    </div>
                  </>
                ) : (
                  <span className="metric-label">{experiment.status === "running" ? "Running…" : "No result yet"}</span>
                )}
                {experiment.decision && (
                  <span className={`decision-pill ${experiment.decision}`}>{decisionLabel[experiment.decision]}</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
