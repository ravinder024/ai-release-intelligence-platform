import { createRoot } from "react-dom/client";
import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import { PlaygroundPage } from "./pages/PlaygroundPage";
import { DatasetsPage } from "./pages/DatasetsPage";
import { DatasetDetailPage } from "./pages/DatasetDetailPage";
import { RunEvaluationPage } from "./pages/RunEvaluationPage";
import { EvaluationResultsPage } from "./pages/EvaluationResultsPage";
import "./styles.css";

function App() {
  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><span className="mark">P</span><span>Prompt Playground</span></div>
        <nav className="nav">
          <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>Playground</NavLink>
          <NavLink to="/datasets" className={({ isActive }) => (isActive ? "active" : "")}>Datasets</NavLink>
        </nav>
        <span className="scope">Release intelligence / Experiment</span>
      </header>
      <Routes>
        <Route path="/" element={<PlaygroundPage />} />
        <Route path="/datasets" element={<DatasetsPage />} />
        <Route path="/datasets/:id" element={<DatasetDetailPage />} />
        <Route path="/datasets/:id/evaluate" element={<RunEvaluationPage />} />
        <Route path="/evaluations/:id" element={<EvaluationResultsPage />} />
      </Routes>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <BrowserRouter><App /></BrowserRouter>,
);
