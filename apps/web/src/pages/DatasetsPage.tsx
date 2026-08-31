import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Dataset, EvaluationRunSummary } from "@prompt-playground/shared";
import { useAuth } from "../auth";
import { api } from "../api";

const emptyForm = { name: "", description: "", useCase: "" };

export function DatasetsPage() {
  const { user } = useAuth();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [runs, setRuns] = useState<EvaluationRunSummary[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => { void load(); }, []);

  async function load() {
    try {
      const [datasetList, runList] = await Promise.all([
        api.get<Dataset[]>("/api/datasets"),
        api.get<EvaluationRunSummary[]>("/api/evaluations?limit=5"),
      ]);
      setDatasets(datasetList);
      setRuns(runList);
    } catch {
      // Show empty states if the API is not reachable yet.
    }
  }

  async function createDataset(event: React.FormEvent) {
    event.preventDefault();
    setIsCreating(true);
    setError(null);
    try {
      const dataset = await api.post<Dataset>("/api/datasets", {
        name: form.name,
        description: form.description || undefined,
        useCase: form.useCase || undefined,
      });
      setDatasets((current) => [dataset, ...current]);
      setForm(emptyForm);
      setShowCreate(false);
      navigate(`/datasets/${dataset.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create dataset");
    } finally {
      setIsCreating(false);
    }
  }

  const canCreate = Boolean(user);

  return (
    <section>
      <div className="intro">
        <p className="eyebrow">DATASETS</p>
        <h1>Test prompts across many scenarios.</h1>
        <p>Build a dataset of example questions, then run both of your prompts over every one of them.</p>
      </div>

      <div className="section-heading">
        <div>
          <p className="eyebrow">COLLECTIONS</p>
          <h2>{user ? "Your datasets" : "Sample datasets"}</h2>
        </div>
        {canCreate && (
          <button className="primary" onClick={() => setShowCreate((value) => !value)}>{showCreate ? "Cancel" : "New dataset"}</button>
        )}
      </div>

      {!canCreate && (
        <div className="panel notice">
          <p>You're browsing the shared sample datasets. <Link to="/auth/signup">Create an account</Link> (or <Link to="/auth/login">sign in</Link>) to build your own datasets and run evaluations.</p>
        </div>
      )}

      {canCreate && showCreate && (
        <form onSubmit={createDataset} className="panel create-form">
          <h3>Create a dataset</h3>
          <label>Name
            <input value={form.name} onChange={(event) => setForm((c) => ({ ...c, name: event.target.value }))} required maxLength={160} placeholder="e.g. Customer support" />
          </label>
          <label>Use case
            <input value={form.useCase} onChange={(event) => setForm((c) => ({ ...c, useCase: event.target.value }))} maxLength={160} placeholder="e.g. support, product, sales" />
          </label>
          <label>Description
            <textarea value={form.description} onChange={(event) => setForm((c) => ({ ...c, description: event.target.value }))} rows={3} placeholder="What kinds of questions does this dataset cover?" />
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" disabled={isCreating || form.name.trim().length === 0}>{isCreating ? "Creating…" : "Create dataset"}</button>
        </form>
      )}

      {datasets.length === 0 && !showCreate ? (
        <div className="empty">No datasets yet. Create one to start evaluating your prompts.</div>
      ) : (
        <div className="dataset-grid">
          {datasets.map((dataset) => (
            <article className="panel dataset-card" key={dataset.id}>
              <div className="panel-title">
                <Link to={`/datasets/${dataset.id}`} className="dataset-name">{dataset.name}</Link>
                {dataset.isSample && <span className="badge">Sample</span>}
              </div>
              <p className="dataset-desc">{dataset.description || "No description."}</p>
              <div className="dataset-meta">
                <span>{dataset.testCaseCount} scenario{dataset.testCaseCount === 1 ? "" : "s"}</span>
                {dataset.useCase && <span className="badge">{dataset.useCase}</span>}
                <span>{new Date(dataset.updatedAt).toLocaleDateString()}</span>
              </div>
              <div className="row-actions">
                <Link to={`/datasets/${dataset.id}`}>Open</Link>
                {canCreate && <Link to={`/datasets/${dataset.id}/evaluate`}>Run evaluation</Link>}
              </div>
            </article>
          ))}
        </div>
      )}

      {user && (
        <section className="history">
          <div className="section-heading"><div><p className="eyebrow">RECENT EVALUATIONS</p><h2>Previous runs</h2></div></div>
          {runs.length === 0 ? <div className="empty">No evaluations yet. Runs will appear here so you can revisit results.</div> : (
            <div className="history-list">
              {runs.map((run) => (
                <Link className="history-item" key={run.id} to={`/evaluations/${run.id}`}>
                  <span>{new Date(run.createdAt).toLocaleString()}</span>
                  <span>{run.datasetName}</span>
                  <span>{run.model}</span>
                  <span className={`status ${run.status}`}>{run.status.replace("_", " ")}</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}
    </section>
  );
}
