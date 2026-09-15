import { useEffect, useState } from "react";
import { useAuth } from "../auth";
import { api } from "../api";

export function SettingsPage() {
  const { user, setKey, removeKey, logout } = useAuth();
  const [usage, setUsage] = useState<{ total: number; used: number; pending: number; remaining: number; byokConfigured: boolean; platformCreditsAvailable: boolean } | null>(null);
  const [key, setKeyInput] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keyBusy, setKeyBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);
  const [pwSaved, setPwSaved] = useState(false);

  useEffect(() => {
    api.get<typeof usage>("/api/usage").then(setUsage).catch(() => setUsage(null));
  }, [user?.hasKey]);

  async function saveKey(event: React.FormEvent) {
    event.preventDefault();
    setKeyBusy(true);
    setKeyError(null);
    setSaved(false);
    try {
      await setKey(key.trim());
      setKeyInput("");
      setSaved(true);
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
        <p>Manage your OpenRouter key and password. Your key is encrypted and only used for your own model calls.</p>
      </div>

      <div className="settings-grid">
        <div className="panel settings-card">
          <h2>Usage</h2>
          <p className="muted">Platform-funded evaluations are complete dataset or experiment runs, not individual scenarios.</p>
          <div className="usage-number"><strong>{usage?.remaining ?? "—"}</strong><span>free evaluations remaining</span></div>
          <p className="hint">{usage ? `${usage.used} of ${usage.total} used${usage.pending ? ` · ${usage.pending} pending` : ""}.` : "Usage will appear after your account loads."}</p>
          <p className="success">Platform credits are available without configuring an API key.</p>
        </div>
        <div className="panel settings-card">
          <h2>Your OpenRouter key</h2>
          <p className="muted">
            {user?.hasKey
              ? "A key is saved for your account. It is used only when you run comparisons or evaluations."
                : "BYOK is optional. Add your own key after platform-funded evaluations are exhausted."}
          </p>
          <form onSubmit={saveKey} className="auth-form">
            <label>OpenRouter API key
              <input
                type="password"
                value={key}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="sk-or-v1-…"
                autoComplete="off"
              />
            </label>
            {keyError && <p className="error" role="alert">{keyError}</p>}
            {saved && <p className="success">Key saved and validated.</p>}
            <div className="row-actions">
              <button className="primary" type="submit" disabled={keyBusy || key.trim().length === 0}>
                {keyBusy ? "Saving…" : "Save key"}
              </button>
              {user?.hasKey && (
                <button type="button" onClick={removeKeyHandler} disabled={keyBusy}>Remove key</button>
              )}
            </div>
          </form>
        </div>

        <div className="panel settings-card">
          <h2>Change password</h2>
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
        </div>
      </div>

      <div className="panel settings-card">
        <h2>Sign out</h2>
        <p className="muted">Sign out of this device. Your datasets and results stay on your account.</p>
        <button className="danger" onClick={() => void logout()}>Sign out</button>
      </div>
    </section>
  );
}
