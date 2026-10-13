/**
 * End-to-end smoke test for a real Customer Support experiment.
 *
 * Verifies, against a running local API, that:
 *   1. an experiment can be created on the sample "Customer Support" dataset (all 7 scenarios),
 *   2. a run can be Stopped part-way through and keeps the scenarios already evaluated,
 *   3. the run can be Resumed to completion, with the LLM judge scoring every scenario,
 *   4. Restart creates a brand-new run, which also completes.
 *
 * Usage (server must already be running):
 *   node apps/api/scripts/verify-customer-support-experiment.mjs [--account=tester|admin] [--stop-after=20] [--timeout-min=30]
 *   node apps/api/scripts/verify-customer-support-experiment.mjs --experiment=<id>   # re-use an existing experiment
 *
 * Credentials are read from the root .env (TESTER_USERNAME/TESTER_PASSWORD or ADMIN_*).
 * Nothing is printed except non-secret status, counts and scores.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");

const arg = (name, fallback) => {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const account = arg("account", "tester").toLowerCase();
const stopAfterSeconds = Number(arg("stop-after", 20));
const pollTimeoutMs = Number(arg("timeout-min", 30)) * 60_000;

const env = {};
for (const line of readFileSync(resolve(root, ".env"), "utf8").split(/\r?\n/)) {
  const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
  if (match) env[match[1]] = match[2].trim().replace(/^"(.*)"$/, "$1");
}

const BASE = `http://localhost:${env.PORT ?? 5101}`;
const prefix = account === "admin" ? "ADMIN" : "TESTER";
const username = env[`${prefix}_USERNAME`];
const password = env[`${prefix}_PASSWORD`];
if (!username || !password) throw new Error(`${prefix}_USERNAME / ${prefix}_PASSWORD are not set in .env`);

let cookie = "";
let failures = 0;

function check(label, condition, detail = "") {
  const ok = Boolean(condition);
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  return ok;
}

async function call(method, path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const setCookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const rawSetCookie = response.headers.get("set-cookie");
  const all = setCookies.length > 0 ? setCookies : rawSetCookie ? [rawSetCookie] : [];
  for (const value of all) {
    const pair = value.split(";")[0];
    if (pair) cookie = pair;
  }
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${data?.error ?? text}`);
  return data;
}

async function waitForFinish(id, label) {
  const deadline = Date.now() + pollTimeoutMs;
  while (Date.now() < deadline) {
    const detail = await call("GET", `/api/experiments/${id}`);
    if (detail.status !== "running") return detail;
    const { baseline, candidate } = detail.completion;
    process.stdout.write(`\r  ${label}: ${baseline.completed}/${baseline.total} baseline, ${candidate.completed}/${candidate.total} candidate…   `);
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error(`${label} did not finish within ${pollTimeoutMs / 60000} minutes`);
}

function report(detail, heading) {
  const { baseline, candidate, comparison } = detail.metrics;
  console.log(`\n--- ${heading} ---`);
  console.log(`  status            : ${detail.status}`);
  console.log(`  baseline judged   : ${detail.completion.baseline.completed}/${detail.completion.baseline.total}`);
  console.log(`  candidate judged  : ${detail.completion.candidate.completed}/${detail.completion.candidate.total}`);
  console.log(`  still to resume   : ${detail.completion.retryable}`);
  console.log(`  avg score         : baseline ${baseline.avgScore ?? "n/a"} → candidate ${candidate.avgScore ?? "n/a"} (Δ ${comparison.scoreDelta ?? "n/a"})`);
  console.log(`  pass rate         : baseline ${baseline.passRate ?? "n/a"}% → candidate ${candidate.passRate ?? "n/a"}% (Δ ${comparison.passRateDelta ?? "n/a"}pp)`);
  console.log(`  avg latency       : baseline ${baseline.avgLatencyMs ?? "n/a"}ms → candidate ${candidate.avgLatencyMs ?? "n/a"}ms`);
  console.log(`  total tokens      : baseline ${baseline.totalTokens ?? "n/a"} → candidate ${candidate.totalTokens ?? "n/a"}`);
  console.log(`  scenarios judged  : ${detail.scenarios.filter((s) => s.baselineScore !== null && s.candidateScore !== null).length}/${detail.scenarios.length}`);
  console.log(`  criteria compared : ${detail.criteria.map((c) => `${c.criterion} ${c.baselineScore ?? "-"}→${c.candidateScore ?? "-"}`).join(", ") || "none"}`);
  if (detail.recommendation) console.log(`  recommendation    : ${detail.recommendation.label} — ${detail.recommendation.reason}`);
}

const BASELINE_PROMPT = [
  "You are a customer support agent for a subscription software product.",
  "Answer the customer's message directly.",
].join("\n");

const CANDIDATE_PROMPT = [
  "You are a senior customer support specialist for a subscription software product.",
  "Structure every reply as:",
  "1. One warm sentence acknowledging the customer's concern.",
  "2. The likely cause, or the exact steps to resolve it (numbered when actions are needed).",
  "3. Clear next steps with a concrete timeline and what the customer should expect.",
  "4. A short closing offer of further help.",
  "Rules: never invent policies, prices or timelines; if you need more information, ask for exactly what you need.",
  "Keep the reply under 180 words and free of filler.",
].join("\n");

const SUBJECT_MODEL = "nvidia/nemotron-3.5-lightning:free"; // same model for A and B, so the prompt is the only variable
const JUDGE_MODEL = "nvidia/nemotron-3-super-120b-a12b:free"; // different, stronger model => no self-preference bias

console.log(`Target ${BASE} as ${prefix} (${username})\n`);

await call("POST", "/api/auth/login", { email: username, password });
const me = await call("GET", "/api/auth/me");
check("signed in", Boolean(me?.id), `role=${me?.role}`);

const reuseId = arg("experiment", "");
const datasets = await call("GET", "/api/datasets");
const support = datasets.find((d) => d.name === "Customer Support");
check("sample dataset found", Boolean(support), `${support?.testCaseCount} scenarios`);

let experiment;
if (reuseId) {
  experiment = await call("GET", `/api/experiments/${reuseId}`);
  console.log(`\nreusing experiment id: ${experiment.id}`);
} else {
  experiment = await call("POST", "/api/experiments", {
    name: `Customer Support verification (${new Date().toISOString().slice(0, 16).replace("T", " ")})`,
    hypothesis: "A structured, acknowledgement-first support reply improves judged quality over a plain direct answer.",
    datasetId: support.id,
    baselinePrompt: BASELINE_PROMPT,
    baselineModel: SUBJECT_MODEL,
    candidatePrompt: CANDIDATE_PROMPT,
    candidateModel: SUBJECT_MODEL,
    evaluatorModel: JUDGE_MODEL,
    evaluatorThreshold: 70,
  });
  console.log(`\nexperiment id: ${experiment.id}`);
  check("experiment starts as draft", experiment.status === "draft", `status=${experiment.status}`);
}

// ---- 1. Run, then Stop part-way through -------------------------------------------------
const run1 = await call("POST", `/api/experiments/${experiment.id}/run`, {});
check("run started", run1.status === "running", `run=${run1.id}`);

await new Promise((r) => setTimeout(r, stopAfterSeconds * 1000));
const stopped = await call("POST", `/api/experiments/${experiment.id}/stop`, {});
const afterStop = await call("GET", `/api/experiments/${experiment.id}`);
const progressAfterStop = afterStop.completion.baseline.completed + afterStop.completion.candidate.completed;
const totalJobs = afterStop.completion.baseline.total + afterStop.completion.candidate.total;
check("stop acknowledged", stopped.ok === true);
check("experiment left the running state", afterStop.status !== "running", `status=${afterStop.status}`);
check("stop was partial (not all scenarios done)", progressAfterStop < totalJobs, `${progressAfterStop}/${totalJobs} done, ${afterStop.completion.retryable} remaining`);
if (progressAfterStop > 0) {
  check("stopped run keeps its completed results", true, `${progressAfterStop} results kept`);
} else {
  console.log(`NOTE  the stop landed before any result was written — nothing to keep yet`);
}

// let in-flight model calls drain so they cannot race the resume
await new Promise((r) => setTimeout(r, 10_000));

// ---- 2. Resume the same run to completion ----------------------------------------------
const resumed = await call("POST", `/api/experiments/${experiment.id}/resume`, {});
check("resume picked up the remaining scenarios", resumed.resumed > 0, `resumed=${resumed.resumed}`);
const finished1 = await waitForFinish(experiment.id, "resume");
check("resumed run finished", finished1.status === "completed", `status=${finished1.status}`);
check("same run was continued (no new run created)", finished1.latestRun?.id === run1.id, `run=${finished1.latestRun?.id}`);
check("baseline judged every scenario", finished1.completion.baseline.completed === finished1.completion.baseline.total, `${finished1.completion.baseline.completed}/${finished1.completion.baseline.total}`);
check("candidate judged every scenario", finished1.completion.candidate.completed === finished1.completion.candidate.total, `${finished1.completion.candidate.completed}/${finished1.completion.candidate.total}`);
check("LLM judge scored every scenario", finished1.scenarios.every((s) => s.baselineScore !== null && s.candidateScore !== null));
// Regression guard: stopping a run must never leave a completed result that was never judged.
const resumedRun = await call("GET", `/api/evaluations/${finished1.latestRun?.id}`);
const unjudged = resumedRun.results.filter((r) => r.status === "completed" && !r.judgement).length;
check("no completed result is missing a judgement", unjudged === 0, `${unjudged} unjudged`);
check("criteria were compared", finished1.criteria.length > 0, finished1.criteria.map((c) => c.criterion).join(", "));
report(finished1, "After Stop + Resume");

// ---- 3. Restart: a brand-new run of all scenarios --------------------------------------
const run2 = await call("POST", `/api/experiments/${experiment.id}/run`, {});
check("restart created a NEW run", run2.id !== run1.id, `${run1.id} -> ${run2.id}`);
const restarted = await call("GET", `/api/experiments/${experiment.id}`);
check("experiment is running again", restarted.status === "running", `status=${restarted.status}`);
check("new run starts from zero", restarted.completion.baseline.completed === 0 && restarted.completion.candidate.completed === 0);
const finished2 = await waitForFinish(experiment.id, "restart");
check("restarted run finished", finished2.status === "completed", `status=${finished2.status}`);
check("all scenarios evaluated again", finished2.completion.baseline.completed === finished2.completion.baseline.total && finished2.completion.candidate.completed === finished2.completion.candidate.total);
report(finished2, "After Restart");

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
