import { Link } from "react-router-dom";
import { useAuth } from "../auth";

type ProductCard = {
  eyebrow: string;
  title: string;
  description: string;
  points: string[];
  to: string;
  cta: string;
};

const products: ProductCard[] = [
  {
    eyebrow: "STEP 1 · DECIDE",
    title: "Prompt Playground",
    description: "Compare two prompt variants against the same input before you commit to either one.",
    points: [
      "Side-by-side responses from one model",
      "Latency, tokens and cost per variant",
      "Usage-scale cost projection",
    ],
    to: "/playground",
    cta: "Open the Playground",
  },
  {
    eyebrow: "STEP 2 · PROVE",
    title: "Datasets",
    description: "Turn real customer inputs into a reusable test set, then score both prompts across every scenario.",
    points: [
      "Scenario datasets with expected answers",
      "Progress-tracked batch evaluation",
      "Per-scenario output, latency, tokens, cost",
    ],
    to: "/datasets",
    cta: "Explore datasets",
  },
  {
    eyebrow: "STEP 3 · SHIP",
    title: "Experiments",
    description: "Run a baseline against a candidate, judge every answer, and get a release recommendation you can defend.",
    points: [
      "LLM-as-a-judge scoring and pass rates",
      "Regression detection with failure analysis",
      "Promote, keep baseline, or iterate",
    ],
    to: "/experiments",
    cta: "View experiments",
  },
];

const steps = [
  { label: "01", title: "Write", copy: "Two prompts, one input — or a dataset of real scenarios." },
  { label: "02", title: "Evaluate", copy: "Run both variants, then score them with a judge and measure quality, latency, tokens and cost." },
  { label: "03", title: "Decide", copy: "Compare against a previous run, catch regressions, and record the release decision." },
];

const builderLinks = [
  { label: "Portfolio", href: "https://ravinder-ai.duckdns.org/" },
  { label: "This product's case study", href: "https://ravinder-ai.duckdns.org/article.html?id=airelease" },
  { label: "LinkedIn", href: "https://www.linkedin.com/in/ravinderkmr/" },
  { label: "GitHub repository", href: "https://github.com/ravinder024/ai-release-intelligence-platform" },
  { label: "Email", href: "mailto:ravinderk.jobs@gmail.com" },
];

const stats = [
  { value: "350K+", label: "users scaled" },
  { value: "6+ yrs", label: "product management" },
  { value: "0→1", label: "product launches" },
  { value: "25–30", label: "person teams led" },
];

export function HomePage() {
  const { user } = useAuth();
  return (
    <section className="home">
      <div className="intro home-hero">
        <p className="eyebrow">AI RELEASE INTELLIGENCE</p>
        <h1>Ship AI features on evidence, not vibes.</h1>
        <p>
          AI-Evals Studio is the workspace an AI team uses to answer one question: <strong>is this prompt change safe to release?</strong>{" "}
          Compare variants, evaluate them across a dataset, score the answers with a judge, and record the decision.
        </p>
        <div className="home-cta">
          {user ? (
            <>
              <Link className="primary" to="/playground">Open the Playground</Link>
              <Link className="secondary" to="/datasets">Browse the sample dataset</Link>
            </>
          ) : (
            <>
              <Link className="primary" to="/auth/login">Sign in to start</Link>
              <Link className="secondary" to="/manual">Read the user manual</Link>
            </>
          )}
        </div>
        <p className="home-note">
          Platform Free is available with no API key. Bring your own OpenAI, Anthropic, Gemini, DeepSeek, or OpenRouter key when you need more.
        </p>
      </div>

      <div className="section-heading">
        <div>
          <p className="eyebrow">THE WORKFLOW</p>
          <h2>Three connected workspaces</h2>
        </div>
      </div>
      <div className="home-grid">
        {products.map((product) => (
          <Link className="panel home-card" to={product.to} key={product.title}>
            <p className="eyebrow">{product.eyebrow}</p>
            <h3>{product.title}</h3>
            <p className="home-card-desc">{product.description}</p>
            <ul className="home-card-points">
              {product.points.map((point) => <li key={point}>{point}</li>)}
            </ul>
            <span className="home-card-cta">{product.cta} →</span>
          </Link>
        ))}
      </div>

      <div className="home-steps">
        {steps.map((step) => (
          <div className="home-step" key={step.label}>
            <span className="home-step-num">{step.label}</span>
            <div>
              <strong>{step.title}</strong>
              <p>{step.copy}</p>
            </div>
          </div>
        ))}
      </div>

      <section className="about-builder panel">
        <div className="about-head">
          <div>
            <p className="eyebrow">ABOUT THE BUILDER</p>
            <h2>Built by a product manager, for product managers.</h2>
          </div>
        </div>
        <p className="about-copy">
          I'm <strong>Ravinder Kumar</strong>, a Lead Product Manager with 6+ years building AI-powered B2B SaaS, fintech, and data
          platforms. I led Gemini-powered voice AI at Good Business Lab, scaling worker support to 350K+ factory users, and have taken
          fintech and data products from 0 to 1 — usually leading cross-functional squads of 25–30 people.
        </p>
        <p className="about-copy">
          This platform is my working answer to a question I kept meeting as an AI PM: release decisions were being made on vibes.
          AI-Evals Studio is a portfolio case study in AI product management — it is not a commercial product. Every screen is built
          around the decision an AI team actually has to make: keep the baseline, promote the candidate, or keep iterating.
        </p>
        <div className="about-stats">
          {stats.map((stat) => (
            <div className="about-stat" key={stat.label}>
              <strong>{stat.value}</strong>
              <span>{stat.label}</span>
            </div>
          ))}
        </div>
        <div className="about-links">
          {builderLinks.map((link) => (
            <a key={link.label} href={link.href} target="_blank" rel="noreferrer noopener">{link.label} ↗</a>
          ))}
        </div>
      </section>
    </section>
  );
}
