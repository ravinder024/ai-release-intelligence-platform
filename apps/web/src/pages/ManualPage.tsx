import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function ManualPage() {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch("/api/manual");
        if (!response.ok) throw new Error(`Could not load the manual (${response.status})`);
        const text = await response.text();
        if (active) setMarkdown(text);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "Could not load the manual");
      }
    })();
    return () => { active = false; };
  }, []);

  return (
    <section>
      <div className="intro">
        <p className="eyebrow">DOCUMENTATION</p>
        <h1>User manual</h1>
        <p>The living guide for the AI Release Intelligence Platform.</p>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {!markdown && !error && <div className="empty">Loading manual…</div>}
      {markdown && (
        <div className="panel manual">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
        </div>
      )}
    </section>
  );
}
