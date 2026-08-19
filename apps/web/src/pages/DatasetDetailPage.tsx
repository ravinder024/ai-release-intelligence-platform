import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { DatasetDetail, DatasetTestCase } from "@prompt-playground/shared";
import { api } from "../api";

const emptyScenario = { input: "", expectedOutput: "", evaluationCriteria: "", notes: "" };

export function DatasetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [dataset, setDataset] = useState<DatasetDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isEditingMeta, setIsEditingMeta] = useState(false);
  const [metaForm, setMetaForm] = useState({ name: "", description: "", useCase: "" });
  const [scenarioForm, setScenarioForm] = useState(emptyScenario);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(emptyScenario);
  const [busy, setBusy] = useState(false);

  useEffect(() => { void load(); }, [id]);

  async function load() {
    try {
      const data = await api.get<DatasetDetail>(`/api/datasets/${id}`);
      setDataset(data);
      setMetaForm({ name: data.name, description: data.description ?? "", useCase: data.useCase ?? "" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load dataset");
    }
  }

  async function saveMeta(event: React.FormEvent) {
    event.preventDefault();
    if (!dataset) return;
    setBusy(true);
    try {
      const updated = await api.patch<DatasetDetail>(`/api/datasets/${dataset.id}`, {
        name: metaForm.name,
        description: metaForm.description || null,
        useCase: metaForm.useCase || null,
      });
      setDataset({ ...updated, testCases: dataset.testCases });
      setIsEditingMeta(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update dataset");
    } finally {
      setBusy(false);
    }
  }

  async function addScenario(event: React.FormEvent) {
    event.preventDefault();
    if (!dataset) return;
    setBusy(true);
    try {
      const created = await api.post<DatasetTestCase>(`/api/datasets/${dataset.id}/test-cases`, {
        input: scenarioForm.input,
        expectedOutput: scenarioForm.expectedOutput || undefined,
        evaluationCriteria: scenarioForm.evaluationCriteria
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
        notes: scenarioForm.notes || undefined,
      });
      setDataset({ ...dataset, testCases: [...dataset.testCases, created], testCaseCount: dataset.testCaseCount + 1 });
      setScenarioForm(emptyScenario);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add scenario");
    } finally {
      setBusy(false);
    }
  }

  function startEdit(testCase: DatasetTestCase) {
    setEditingId(testCase.id);
    setEditForm({
      input: testCase.input,
      expectedOutput: testCase.expectedOutput ?? "",
      evaluationCriteria: testCase.evaluationCriteria?.join("\n") ?? "",
      notes: testCase.notes ?? "",
    });
  }

  async function saveEdit(testCase: DatasetTestCase) {
    if (!dataset) return;
    setBusy(true);
    try {
      const updated = await api.patch<DatasetTestCase>(`/api/datasets/${dataset.id}/test-cases/${testCase.id}`, {
        input: editForm.input,
        expectedOutput: editForm.expectedOutput || null,
        evaluationCriteria: editForm.evaluationCriteria
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
        notes: editForm.notes || null,
      });
      setDataset({
        ...dataset,
        testCases: dataset.testCases.map((item) => (item.id === updated.id ? updated : item)),
      });
      setEditingId(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update scenario");
    } finally {
      setBusy(false);
    }
  }

  async function removeScenario(testCase: DatasetTestCase) {
    if (!dataset) return;
    setBusy(true);
    try {
      await api.delete(`/api/datasets/${dataset.id}/test-cases/${testCase.id}`);
      setDataset({
        ...dataset,
        testCases: dataset.testCases.filter((item) => item.id !== testCase.id),
        testCaseCount: dataset.testCaseCount - 1,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete scenario");
    } finally {
      setBusy(false);
    }
  }

  if (error && !dataset) return <section className="intro"><p className="error">{error}</p><p><Link to="/datasets">Back to datasets</Link></p></section>;
  if (!dataset) return <section className="intro"><p>Loading…</p></section>;

  return (
    <section>
      <div className="intro">
        <p className="eyebrow"><Link to="/datasets" className="back-link">DATASETS</Link> / {dataset.testCaseCount} SCENARIOS</p>
        <h1>{dataset.name}</h1>
        <div className="row-actions">
          {!dataset.isSample ? (
            <button className="danger" onClick={async () => {
              const confirmation = prompt('Type DELETE to confirm dataset deletion');
              if (confirmation !== 'DELETE') return;
              setBusy(true);
              try {
                await api.delete(`/api/datasets/${dataset.id}`);
                navigate('/datasets');
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Could not delete dataset');
              } finally {
                setBusy(false);
              }
            }} disabled={busy}>Delete dataset</button>
          ) : (
            <span title="This is a sample dataset and cannot be deleted." className="muted">Sample dataset — cannot delete</span>
          )}
        </div>
        {!isEditingMeta ? (
          <p>{dataset.description || "No description."} {dataset.useCase && <span className="badge">{dataset.useCase}</span>}</p>
        ) : (
          <form onSubmit={saveMeta} className="panel inline-form">
            <label>Name<input value={metaForm.name} onChange={(e) => setMetaForm((c) => ({ ...c, name: e.target.value }))} required maxLength={160} /></label>
            <label>Use case<input value={metaForm.useCase} onChange={(e) => setMetaForm((c) => ({ ...c, useCase: e.target.value }))} maxLength={160} /></label>
            <label>Description<textarea value={metaForm.description} onChange={(e) => setMetaForm((c) => ({ ...c, description: e.target.value }))} rows={2} /></label>
            <div className="row-actions">
              <button type="submit" disabled={busy}>Save</button>
              <button type="button" onClick={() => setIsEditingMeta(false)}>Cancel</button>
            </div>
          </form>
        )}
      </div>

      <div className="section-heading">
        <div><p className="eyebrow">EXAMPLES</p><h2>Scenarios</h2></div>
        <button className="primary" onClick={() => navigate(`/datasets/${dataset.id}/evaluate`)}>Run evaluation</button>
      </div>
      <p className="hint">Keep datasets under 50 scenarios for fast evaluations.</p>

      {error && dataset && <p className="error" role="alert">{error}</p>}

      <form onSubmit={addScenario} className="panel scenario-form">
        <h3>Add a scenario</h3>
        <label>Question / input
          <textarea value={scenarioForm.input} onChange={(e) => setScenarioForm((c) => ({ ...c, input: e.target.value }))} rows={2} required placeholder="e.g. A customer says their invoice is higher than usual…" />
        </label>
        <div className="two-col">
          <label>What a good answer should include (optional)
            <textarea value={scenarioForm.expectedOutput} onChange={(e) => setScenarioForm((c) => ({ ...c, expectedOutput: e.target.value }))} rows={2} />
          </label>
          <label>Evaluation criteria (optional, one per line)
            <textarea value={scenarioForm.evaluationCriteria} onChange={(e) => setScenarioForm((c) => ({ ...c, evaluationCriteria: e.target.value }))} rows={2} />
          </label>
        </div>
        <label>Notes (optional)
          <textarea value={scenarioForm.notes} onChange={(e) => setScenarioForm((c) => ({ ...c, notes: e.target.value }))} rows={2} />
        </label>
        <button type="submit" disabled={busy || scenarioForm.input.trim().length === 0}>Add scenario</button>
      </form>

      {dataset.testCases.length === 0 ? (
        <div className="empty">No scenarios yet. Add your first example above.</div>
      ) : (
        <div className="scenario-list">
          {dataset.testCases.map((testCase) => (
            <article className="panel scenario-row" key={testCase.id}>
              {editingId === testCase.id ? (
                <div className="scenario-edit">
                  <label>Question<textarea value={editForm.input} onChange={(e) => setEditForm((c) => ({ ...c, input: e.target.value }))} rows={2} /></label>
                  <label>Expected output<textarea value={editForm.expectedOutput} onChange={(e) => setEditForm((c) => ({ ...c, expectedOutput: e.target.value }))} rows={2} /></label>
                  <label>Evaluation criteria<textarea value={editForm.evaluationCriteria} onChange={(e) => setEditForm((c) => ({ ...c, evaluationCriteria: e.target.value }))} rows={2} /></label>
                  <label>Notes<textarea value={editForm.notes} onChange={(e) => setEditForm((c) => ({ ...c, notes: e.target.value }))} rows={2} /></label>
                  <div className="row-actions">
                    <button onClick={() => saveEdit(testCase)} disabled={busy}>Save</button>
                    <button onClick={() => setEditingId(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="scenario-head"><span className="scenario-num">#{testCase.position + 1}</span><div className="row-actions">
                    <button onClick={() => startEdit(testCase)}>Edit</button>
                    <button className="danger" onClick={() => removeScenario(testCase)} disabled={busy}>Delete</button>
                  </div></div>
                  <p className="scenario-input">{testCase.input}</p>
                  {testCase.expectedOutput && <p className="scenario-meta"><strong>Expected:</strong> {testCase.expectedOutput}</p>}
                  {testCase.evaluationCriteria?.length ? (
                    <p className="scenario-meta"><strong>Criteria:</strong> {testCase.evaluationCriteria.join(", ")}</p>
                  ) : null}
                  {testCase.notes && <p className="scenario-meta"><strong>Notes:</strong> {testCase.notes}</p>}
                </>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
