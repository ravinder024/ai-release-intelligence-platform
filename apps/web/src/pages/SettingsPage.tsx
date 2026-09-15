import { useEffect, useState } from "react";
import { useAuth } from "../auth";
import { api } from "../api";

export function SettingsPage() {
  const { user, setKey, removeKey, logout } = useAuth();
  const [usage, setUsage] = useState<{ total: number; used: number; pending: number; remaining: number; byokConfigured: boolean; platformCreditsAvailable: boolean } | null>(null);
  const [keyMeta, setKeyMeta] = useState<{ configured: boolean; provider: string | null; maskedKey: string | null; lastUpdated: string | null } | null>(null);
  const [key, setKeyInput] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keyBusy, setKeyBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);
  const [pwSaved, setPwSaved] = useState(false);

  async function loadAccount() {
    await Promise.all([
      api.get<typeof usage>("/api/usage").then(setUsage).catch(() => setUsage(null)),
      api.get<typeof keyMeta>("/api/auth/key").then(setKeyMeta).catch(() => setKeyMeta(null)),
    ]);
  }

  useEffect(() => { void loadAccount(); }, [user?.id]);

  async function saveKey(event: React.FormEvent) {
    event.preventDefault();
    setKeyBusy(true);
    setKeyError(null);
    setSaved(false);
    try {
      await setKey(key.trim());
      setKeyInput("");
      setSaved(true);
      await loadAccount();
    } catch (caught) {
      setKeyError(caught instanceof Error ? caught.message : "Could not save key");
    } finally {
      setKeyBusy(false);
    }
  }

  async function removeKeyHandler() {
    setKeyBusy(true);
    setKeyError(null);
    try {
      await removeKey();
      await loadAccount();
    } catch (caught) {
      setKeyError(caught instanceof Error ? caught.message : "Could not remove key");
    } finally {
      setKeyBusy(false);
    }
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    setPwBusy(true);
    setPwError(null);
    setPwSaved(false);
    try {
      await api.post<{ ok: boolean }>("/api/auth/change-password", {
        oldPassword,
        newPassword,
      });
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
        <p>Your account, free evaluation usage, optional API key, and security details.</p>
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
          <h2>Usage</h2>
          <p className="muted">A free evaluation is one complete dataset or experiment run — not a single scenario.</p>
          <div className="usage-number"><strong>{usage?.remaining ?? "—"}</strong><span>free evaluations remaining</span></div>
          <p className="hint">
            {usage
              ? `${usage.used} of ${usage.total} used${usage.pending ? ` · ${usage.pending} in progress` : ""}.`
              : "Usage will appear after your account loads."}
          </p>
          <p className="hint">
            {usage && usage.remaining === 0
              ? "You've used your 5 free platform evaluations. Add your own API key to continue."
              : "Platform-funded evaluations are available — no API key required yet."}
          </p>
        </div>

        <div className="panel settings-card">
          <h2>API access</h2>
          <p className="muted">
            Platform-funded evaluation credits: {usage?.platformCreditsAvailable ? "available" : "exhausted"}.
            The platform key stays on the server and is never sent to your browser.
          </p>
          <div className="key-status">
            <span className="key-status-label">BYOK</span>
            {keyMeta?.configured ? (
              <span className="key-status-value">
                {keyMeta.provider} · <code>{keyMeta.maskedKey}</code>
                {keyMeta.lastUpdated ? ` · updated ${new Date(keyMeta.lastUpdated).toLocaleDateString()}` : ""}
              </span>
            ) : (
              <span className="key-status-value">Not configured</span>
            )}
          </div>
          <p className="hint">
            BYOK is optional. Use your own provider key after your free evaluations are exhausted.
            Your key is stored encrypted, is never displayed again, and is used only for your own provider requests.
          </p>
          <form onSubmit={saveKey} className="auth-form">
            <label>{keyMeta?.configured ? "Update API key" : "Configure API key"}
              <input
                type="password"
                value={key}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="sk-or-v1-…"
                autoComplete="off"
              />
            </label>
            {keyError && <p className="error" role="alert">{keyError}</p>}
            {saved && <p className="success">Key validated, encrypted, and saved.</p>}
            <div className="row-actions">
              <button className="primary" type="submit" disabled={keyBusy || key.trim().length === 0}>
                {keyBusy ? "Saving…" : keyMeta?.configured ? "Update key" : "Save key"}
              </button>
              {keyMeta?.configured && (
                <button type="button" className="danger" onClick={removeKeyHandler} disabled={keyBusy}>Remove key</button>
              )}
            </div>
          </form>
        </div>

        <div className="panel settings-card">
          <h2>Security</h2>
          <ul className="security-list">
            <li>Sessions use server-managed httpOnly cookies — no auth tokens are kept in localStorage or sessionStorage.</li>
            <li>BYOK keys are encrypted at rest and never returned after saving.</li>
            <li>Your datasets, evaluations, and experiments are private to your account.</li>
            <li>BYOK keys are decrypted only server-side when making your provider request.</li>
          </ul>
          {user?.provider === "local" && (
            <form onSubmit={changePassword} className="auth-form">
              <label>Current password
                <input type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} required autoComplete="current-password" />
              </label>
              <label>New password
                <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
              </label>
              {pwError && <p className="error" role="alert">{pwError}</p>}
              {pwSaved && <p className="success">Password updated.</p>}
              <button className="primary" type="submit" disabled={pwBusy}>{pwBusy ? "Updating…" : "Change password"}</button>
            </form>
          )}
        </div>
      </div>

      <div className="panel settings-card">
        <h2>Sign out</h2>
        <p className="muted">Signing out invalidates your server session. Your datasets and results stay on your account.</p>
        <button className="danger" onClick={() => void logout()}>Sign out</button>
      </div>
    </section>
  );
}
