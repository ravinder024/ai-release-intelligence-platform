import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";

export function SignupPage() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signup(email, password, displayName);
      navigate("/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create account");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-page">
      <div className="panel auth-card">
        <p className="eyebrow">NEW HERE</p>
        <h1>Create your account</h1>
        <p className="muted">Your datasets, experiments, and results are private to your account.</p>
        <form onSubmit={submit} className="auth-form">
          <label>Name
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={120} autoComplete="name" />
          </label>
          <label>Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </label>
          <label>Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
            <span className="hint">At least 8 characters.</span>
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="primary" type="submit" disabled={busy}>{busy ? "Creating…" : "Create account"}</button>
        </form>
        <div className="auth-links">
          <Link to="/auth/login">Already have an account? Sign in</Link>
        </div>
      </div>
    </section>
  );
}
