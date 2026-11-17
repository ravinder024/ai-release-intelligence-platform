import { useEffect, useState } from "react";
import { useAuth } from "../auth";
import { api } from "../api";
import { useProviderModels } from "../useModels";
import type { ApiProvider, ProviderConnectionSummary } from "@prompt-playground/shared";

const PROVIDERS: Array<{ id: ApiProvider; label: string }> = [
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "gemini", label: "Google Gemini" },
  { id: "deepseek", label: "DeepSeek" },
  { id: "openrouter", label: "OpenRouter" },
];

type UsageSummary = {
  total: number | null;
  used: number;
  pending: number;
  remaining: number | null;
  unlimited: boolean;
  byokConfigured: boolean;
  platformCreditsAvailable: boolean;
  scenarioLimit: number | null;
};

type RowState = { busy?: boolean; error?: string; notice?: string; confirming?: boolean; editing?: boolean; label?: string; key?: string };

export function SettingsPage() {
  const { user, logout } = useAuth();
  const { options, connections, loading: catalogLoading, refresh: refreshCatalog } = useProviderModels();
  const [usage, setUsage] = useState<UsageSummary | null>(null);

  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [provider, setProvider] = useState<ApiProvider>("openai");
  const [newLabel, setNewLabel] = useState("");
  const [newKey, setNewKey] = useState("");

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);
  const [pwSaved, setPwSaved] = useState(false);

  const platformFreeCount = options.filter((option) => option.source === "platform_free").length;

  async function loadAccount() {
    await api.get<UsageSummary>("/api/usage").then(setUsage).catch(() => setUsage(null));
  }

  useEffect(() => { void loadAccount(); }, [user?.id]);

  function patchRow(id: string, patch: Partial<RowState>) {
    setRows((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  }

  async function addConnection(event: React.FormEvent) {
    event.preventDefault();
    patchRow("add", { busy: true, error: undefined, notice: undefined });
    try {
      await api.post<ProviderConnectionSummary>("/api/provider-connections", { provider, label: newLabel.trim(), apiKey: newKey });
      setNewKey("");
      setNewLabel("");
      patchRow("add", { busy: false, notice: "Connection validated and saved. Its models now appear in the model picker." });
      await refreshCatalog();
      await loadAccount();
    } catch (caught) {
      patchRow("add", { busy: false, error: caught instanceof Error ? caught.message : "Could not add connection" });
    }
  }

  async function saveConnection(connection: ProviderConnectionSummary) {
    const row = rows[connection.id] ?? {};
    const label = row.label ?? connection.label;
    patchRow(connection.id, { busy: true, error: undefined, notice: undefined });
    try {
      await api.patch(`/api/provider-connections/${connection.id}`, {
        ...(label.trim() !== connection.label ? { label: label.trim() } : {}),
        ...(row.key?.trim() ? { apiKey: row.key.trim() } : {}),
      });
      patchRow(connection.id, { busy: false, editing: false, key: "", notice: "Connection updated." });
      await refreshCatalog();
    } catch (caught) {
      patchRow(connection.id, { busy: false, error: caught instanceof Error ? caught.message : "Could not update connection" });
    }
  }

  async function refreshConnection(connection: ProviderConnectionSummary) {
    patchRow(connection.id, { busy: true, error: undefined, notice: undefined });
    try {
      await api.post(`/api/provider-connections/${connection.id}/refresh`, {});
      await refreshCatalog();
      patchRow(connection.id, { busy: false, notice: "Model catalog refreshed." });
    } catch (caught) {
      patchRow(connection.id, { busy: false, error: caught instanceof Error ? caught.message : "Could not refresh models" });
    }
  }

  async function removeConnection(connection: ProviderConnectionSummary) {
    patchRow(connection.id, { busy: true, error: undefined, notice: undefined });
    try {
      await api.delete(`/api/provider-connections/${connection.id}`);
      await refreshCatalog();
      await loadAccount();
      setRows((current) => {
        const next = { ...current };
        delete next[connection.id];
        return next;
      });
    } catch (caught) {
      patchRow(connection.id, { busy: false, confirming: false, error: caught instanceof Error ? caught.message : "Could not remove connection" });
    }
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    setPwBusy(true);
    setPwError(null);
    setPwSaved(false);
    try {
      await api.post<{ ok: boolean }>("/api/auth/change-password", { oldPassword, newPassword });
      setOldPassword("");
      setNewPassword("");
      setPwSaved(true);
    } catch (caught) {
      setPwError(caught instanceof Error ? caught.message : "Could not change password");
    } finally {
      setPwBusy(false);
    }
  }

  return (
    <section>
      <div className="intro">
        <p className="eyebrow">SETTINGS</p>
        <h1>Account settings</h1>
        <p>Your account, your API keys, your usage, and your security details — in one place.</p>
      </div>

      <div className="settings-grid">
        <div className="panel settings-card">
          <h2>Account</h2>
          <dl className="detail-list">
            <div><dt>Name</dt><dd>{user?.displayName ?? "—"}</dd></div>
            <div><dt>Email</dt><dd>{user?.email ?? "—"}</dd></div>
            <div><dt>Sign-in method</dt><dd>{user?.provider === "google" ? "Google" : "Local account"}</dd></div>
            <div><dt>Role</dt><dd>{user?.role === "admin" ? "Admin" : "User"}</dd></div>
          </dl>
        </div>

        <div className="panel settings-card">
          <h2>Usage &amp; plan</h2>
          <p className="muted">One evaluation = one complete dataset or experiment run, however many scenarios it contains.</p>
          <div className="usage-number">
            <strong className={usage?.unlimited ? "usage-unlimited" : undefined}>{usage?.unlimited ? "Unlimited" : usage?.remaining ?? "—"}</strong>
            <span>Platform Free evaluations left</span>
          </div>
          <p className="hint">
            {usage
              ? usage.unlimited
                ? `Full access is enabled for this account${usage.pending ? ` · ${usage.pending} in progress` : ""}.`
                : `${usage.used} of ${usage.total} used${usage.pending ? ` · ${usage.pending} in progress` : ""}.`
              : "Usage will appear once your account loads."}
          </p>
          <p className="hint">
            Runs on your own keys never consume Platform Free credits
            {usage?.byokConfigured ? " — you already have at least one connection." : " — add a connection below to run without limits."}
          </p>
          {usage?.scenarioLimit != null && (
            <p className="hint">Free accounts can keep up to {usage.scenarioLimit} scenarios per dataset, and can run experiments on datasets of that size.</p>
          )}
        </div>
      </div>

      <section className="api-keys-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">API KEYS</p>
            <h2>Model providers</h2>
          </div>
          <span className="badge">{connections.length} saved connection{connections.length === 1 ? "" : "s"}</span>
        </div>
        <p className="section-lead">
          Platform Free runs on the shared OpenRouter account inside your credit allowance. Add your own provider keys to run any model on your own account — those runs never use platform credits.
        </p>

        <div className="provider-box platform-free-box">
          <div className="provider-row-header">
            <strong>Platform Free</strong>
            <span>{platformFreeCount} models available</span>
          </div>
          <p className="muted">Discovered live from OpenRouter's free catalog. No key needed; counted against your Platform Free evaluations.</p>
        </div>

        <div className="keys-list">
          {connections.length === 0 && (
            <div className="empty">
              No personal API keys yet. Platform Free works right away — add a key below when you want to evaluate a paid or provider-specific model.
            </div>
          )}
          {connections.map((connection) => {
            const row = rows[connection.id] ?? {};
            const busy = Boolean(row.busy);
            const catalogMissing = !connection.catalogUpdatedAt || connection.modelCount === 0;
            return (
              <article className="panel key-card" key={connection.id}>
                <div className="key-card-head">
                  <div className="key-card-title">
                    <span className="provider-chip">{providerName(connection.provider)}</span>
                    <strong>{connection.label}</strong>
                  </div>
                  <span className={catalogMissing ? "status running" : "status completed"}>
                    {catalogMissing ? "models not loaded" : `${connection.modelCount} models`}
                  </span>
                </div>

                <dl className="key-meta">
                  <div><dt>Key</dt><dd>{connection.maskedKey}</dd></div>
                  <div><dt>Added</dt><dd>{formatWhen(connection.createdAt)}</dd></div>
                  <div><dt>Models refreshed</dt><dd>{connection.catalogUpdatedAt ? formatWhen(connection.catalogUpdatedAt) : "Never — refresh to load models"}</dd></div>
                </dl>

                {row.editing ? (
                  <div className="connection-edit">
                    <label>Connection label
                      <input
                        aria-label="Connection label"
                        value={row.label ?? connection.label}
                        onChange={(event) => patchRow(connection.id, { label: event.target.value })}
                        maxLength={120}
                      />
                    </label>
                    <label>Replacement key <span className="optional">optional</span>
                      <input
                        aria-label="Replacement API key"
                        type="password"
                        value={row.key ?? ""}
                        onChange={(event) => patchRow(connection.id, { key: event.target.value })}
                        placeholder="Leave blank to keep the current key"
                        autoComplete="off"
                      />
                    </label>
                    <div className="row-actions">
                      <button type="button" className="primary" onClick={() => void saveConnection(connection)} disabled={busy}>
                        {busy ? "Saving…" : "Save changes"}
                      </button>
                      <button type="button" className="secondary" onClick={() => patchRow(connection.id, { editing: false, key: "", label: connection.label, error: undefined })}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="row-actions key-actions">
                    <button type="button" className="secondary" onClick={() => patchRow(connection.id, { editing: true, label: connection.label, key: "" })} disabled={busy}>
                      Rename or replace key
                    </button>
                    <button type="button" className="secondary" onClick={() => void refreshConnection(connection)} disabled={busy}>
                      {busy ? "Working…" : catalogMissing ? "Load models" : "Refresh models"}
                    </button>
                    {row.confirming ? (
                      <span className="inline-confirm">
                        <span>Remove this key?</span>
                        <button type="button" className="danger" onClick={() => void removeConnection(connection)} disabled={busy}>
                          {busy ? "Removing…" : "Yes, remove"}
                        </button>
                        <button type="button" className="secondary" onClick={() => patchRow(connection.id, { confirming: false })}>Keep</button>
                      </span>
                    ) : (
                      <button type="button" className="secondary danger-text" onClick={() => patchRow(connection.id, { confirming: true })} disabled={busy}>
                        Remove
                      </button>
                    )}
                  </div>
                )}

                {row.error && <p className="error" role="alert">{row.error}</p>}
                {row.notice && <p className="success" role="status">{row.notice}</p>}
              </article>
            );
          })}
        </div>

        <div className="panel key-card add-connection">
          <h3>Add a connection</h3>
          <p className="hint">The key is validated with the provider before it is saved, then encrypted at rest. It is only decrypted server-side when your run calls that provider.</p>
          <form onSubmit={addConnection} className="auth-form">
            <div className="connection-form-grid">
              <label>Provider
                <select value={provider} onChange={(event) => setProvider(event.target.value as ApiProvider)}>
                  {PROVIDERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </label>
              <label>Connection label
                <input value={newLabel} onChange={(event) => setNewLabel(event.target.value)} placeholder="e.g. Personal, Work, Team key" maxLength={120} required />
              </label>
            </div>
            <label>API key
              <input type="password" value={newKey} onChange={(event) => setNewKey(event.target.value)} placeholder="Paste the provider key" autoComplete="off" required />
            </label>
            <div className="row-actions">
              <button className="primary" type="submit" disabled={rows.add?.busy || catalogLoading}>
                {rows.add?.busy ? "Validating…" : "Validate and save"}
              </button>
              <span className="hint">The same model under two keys stays two separate entries.</span>
            </div>
            {rows.add?.error && <p className="error" role="alert">{rows.add.error}</p>}
            {rows.add?.notice && <p className="success" role="status">{rows.add.notice}</p>}
          </form>
        </div>
      </section>

      <div className="settings-grid">
        <div className="panel settings-card">
          <h2>Security</h2>
          <ul className="security-list">
            <li>Sessions use server-managed httpOnly cookies — no auth tokens sit in localStorage or sessionStorage.</li>
            <li>Saved keys are encrypted at rest and never returned in plain text after storage.</li>
            <li>Your datasets, evaluations, and experiments are private to your account.</li>
            <li>Keys are decrypted only server-side, only for the request you made.</li>
          </ul>
          {user?.provider === "local" && (
            <form onSubmit={changePassword} className="auth-form">
              <label>Current password
                <input type="password" value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} required autoComplete="current-password" />
              </label>
              <label>New password
                <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required minLength={8} autoComplete="new-password" />
              </label>
              {pwError && <p className="error" role="alert">{pwError}</p>}
              {pwSaved && <p className="success">Password updated.</p>}
              <button className="primary" type="submit" disabled={pwBusy}>{pwBusy ? "Updating…" : "Change password"}</button>
            </form>
          )}
        </div>

        <div className="panel settings-card">
          <h2>Sign out</h2>
          <p className="muted">Signing out ends your server session. Your datasets, runs, and keys stay on your account.</p>
          <button className="danger" onClick={() => void logout()}>Sign out</button>
        </div>
      </div>
    </section>
  );
}

function providerName(provider: ApiProvider): string {
  return PROVIDERS.find((item) => item.id === provider)?.label ?? provider;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return date.toLocaleDateString();
}
