import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate("/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-page">
      <div className="panel auth-card">
        <p className="eyebrow">WELCOME BACK</p>
        <h1>Sign in</h1>
        <p className="muted">Use your own account and OpenRouter key to run evaluations.</p>
        <button className="google-button" type="button" onClick={() => { window.location.href = "/api/auth/google"; }}>
          Continue with Google
        </button>
        <div className="auth-divider"><span>or emergency admin login</span></div>
        <form onSubmit={submit} className="auth-form">
          <label>Email or username
            <input type="text" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
          </label>
          <label>Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="primary" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        </form>
        <div className="auth-links">
          <Link to="/auth/signup">Create an account</Link>
          <Link to="/auth/forgot-password">Forgot password?</Link>
        </div>
      </div>
    </section>
  );
}
