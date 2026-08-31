import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";

type Stage = "email" | "code" | "done";

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function requestCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ ok: boolean; code: string | null }>("/api/auth/forgot-password", { email });
      if (!result.code) {
        setStage("done");
      } else {
        setStage("code");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not request a reset code");
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post<{ ok: boolean }>("/api/auth/reset-password", { email, code: code.trim(), password });
      setStage("done");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not reset password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-page">
      <div className="panel auth-card">
        <p className="eyebrow">ACCOUNT RECOVERY</p>
        <h1>Forgot password</h1>

        {stage === "email" && (
          <>
            <p className="muted">Enter your email to receive a one-time reset code (shown right here in this demo).</p>
            <form onSubmit={requestCode} className="auth-form">
              <label>Email
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
              </label>
              {error && <p className="error" role="alert">{error}</p>}
              <button className="primary" type="submit" disabled={busy}>{busy ? "Sending…" : "Get reset code"}</button>
            </form>
          </>
        )}

        {stage === "code" && (
          <>
            <p className="muted">Use the one-time reset code shown on screen to set a new password.</p>
            <form onSubmit={resetPassword} className="auth-form">
              <label>Reset code
                <input value={code} onChange={(e) => setCode(e.target.value)} required placeholder="e.g. A1B2C3D4" autoComplete="one-time-code" />
              </label>
              <label>New password
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
              </label>
              {error && <p className="error" role="alert">{error}</p>}
              <button className="primary" type="submit" disabled={busy}>{busy ? "Resetting…" : "Reset password"}</button>
            </form>
          </>
        )}

        {stage === "done" && (
          <div className="auth-done">
            <p className="muted">Your password has been reset. You can now sign in with the new password.</p>
            <Link className="primary" to="/auth/login" onClick={() => navigate("/auth/login")}>Go to sign in</Link>
          </div>
        )}

        <div className="auth-links">
          <Link to="/auth/login">Back to sign in</Link>
        </div>
      </div>
    </section>
  );
}
