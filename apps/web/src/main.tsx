import { createRoot } from "react-dom/client";
import { BrowserRouter, NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import { PlaygroundPage } from "./pages/PlaygroundPage";
import { DatasetsPage } from "./pages/DatasetsPage";
import { DatasetDetailPage } from "./pages/DatasetDetailPage";
import { RunEvaluationPage } from "./pages/RunEvaluationPage";
import { EvaluationResultsPage } from "./pages/EvaluationResultsPage";
import { ExperimentsPage } from "./pages/ExperimentsPage";
import { NewExperimentPage } from "./pages/NewExperimentPage";
import { ExperimentDetailPage } from "./pages/ExperimentDetailPage";
import { NewIterationPage } from "./pages/NewIterationPage";
import { LoginPage } from "./pages/LoginPage";
import { SignupPage } from "./pages/SignupPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ManualPage } from "./pages/ManualPage";
import "./styles.css";

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading-screen">Loading…</div>;
  if (!user) return <Navigate to="/auth/login" replace />;
  return children;
}

function Topbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <header className="topbar">
      <div className="brand"><span className="mark">P</span><span>Prompt Playground</span></div>
      <nav className="nav">
        <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>Playground</NavLink>
        <NavLink to="/datasets" className={({ isActive }) => (isActive ? "active" : "")}>Datasets</NavLink>
        <NavLink to="/experiments" className={({ isActive }) => (isActive ? "active" : "")}>Experiments</NavLink>
        <NavLink to="/manual" className={({ isActive }) => (isActive ? "active" : "")}>Manual</NavLink>
      </nav>
      <div className="topbar-right">
        {user ? (
          <>
            <button className="topbar-user" onClick={() => navigate("/settings")} title={user.email}>
              <span className="avatar">{user.displayName.slice(0, 1).toUpperCase()}</span>
              <span>{user.displayName}</span>
            </button>
            <button className="topbar-link" onClick={() => void logout()}>Sign out</button>
          </>
        ) : (
          <button className="topbar-link" onClick={() => navigate("/auth/login")}>Sign in</button>
        )}
      </div>
    </header>
  );
}

function App() {
  return (
    <main className="shell">
      <Topbar />
      <Routes>
        <Route path="/auth/login" element={<LoginPage />} />
        <Route path="/auth/signup" element={<SignupPage />} />
        <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/datasets" element={<DatasetsPage />} />
        <Route path="/datasets/:id" element={<DatasetDetailPage />} />
        <Route path="/manual" element={<ManualPage />} />
        <Route path="/" element={<RequireAuth><PlaygroundPage /></RequireAuth>} />
        <Route path="/playground" element={<RequireAuth><PlaygroundPage /></RequireAuth>} />
        <Route path="/datasets/:id/evaluate" element={<RequireAuth><RunEvaluationPage /></RequireAuth>} />
        <Route path="/evaluations/:id" element={<RequireAuth><EvaluationResultsPage /></RequireAuth>} />
        <Route path="/experiments" element={<RequireAuth><ExperimentsPage /></RequireAuth>} />
        <Route path="/experiments/new" element={<RequireAuth><NewExperimentPage /></RequireAuth>} />
        <Route path="/experiments/:id" element={<RequireAuth><ExperimentDetailPage /></RequireAuth>} />
        <Route path="/experiments/:id/iterations/new" element={<RequireAuth><NewIterationPage /></RequireAuth>} />
        <Route path="/settings" element={<RequireAuth><SettingsPage /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <AuthProvider><App /></AuthProvider>
  </BrowserRouter>,
);
