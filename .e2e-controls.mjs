import fs from "node:fs";

const env = {};
for (const line of fs.readFileSync("/var/www/arip/.env", "utf8").split("\n")) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (!match) continue;
  env[match[1]] = match[2].trim().replace(/^"(.*)"$/, "$1");
}

const base = "https://ai-evals-studio.duckdns.org";
let cookie = "";

async function call(path, init = {}) {
  const response = await fetch(base + path, {
    ...init,
    headers: { ...(init.headers || {}), ...(cookie ? { cookie } : {}) },
    redirect: "manual",
  });
  for (const raw of response.headers.getSetCookie?.() ?? []) {
    const pair = raw.split(";")[0];
    if (pair.startsWith("arip_session=")) cookie = pair;
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

const post = (path, payload) => call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload ?? {}) });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const login = await post("/api/auth/login", { username: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD });
console.log("login:", login.status, env.ADMIN_USERNAME);

const datasets = await call("/api/datasets");
const dataset = (Array.isArray(datasets.body) ? datasets.body : []).find((item) => item.name === "Customer Support");
if (!dataset) { console.log("Customer Support dataset missing"); process.exit(1); }
console.log("dataset:", dataset.name, dataset._count?.testCases ?? dataset.testCaseCount ?? "?");

const connectionId = "c3232474-852b-4801-91ac-d63e6e91db42";
const selection = (modelId) => ({ modelId, provider: "openrouter", source: "byok", connectionId });
const payload = {
  datasetId: dataset.id,
  model: "google/gemini-2.5-flash-lite",
  promptA: "You are a concise support assistant. Explain the likely next step in no more than 100 words.",
  promptB: "You are an empathetic support assistant. Acknowledge the concern, explain the likely next step, and offer a clear path to resolution.",
  modelSelection: selection("google/gemini-2.5-flash-lite"),
  modelASelection: selection("google/gemini-2.5-flash-lite"),
  modelBSelection: selection("google/gemini-2.5-flash-lite"),
  evaluatorModel: "deepseek/deepseek-r1-0528",
  evaluatorSelection: selection("deepseek/deepseek-r1-0528"),
  evaluatorThreshold: 85,
  evaluatorPrompt: "You are an automated judge that evaluates assistant responses against the test case input and expected output. Return only a JSON object with overallScore, pass, summary, and criteriaResults.",
};

// 1 — fresh run
const created = await post("/api/evaluations", payload);
const runId = created.body?.id;
console.log("1. create:", created.status, runId, created.body?.status);
if (!runId) { console.log("payload rejected:", JSON.stringify(created.body)); process.exit(1); }

// 2 — a second run of the same dataset must be refused while the first executes
const duplicate = await post("/api/evaluations", payload);
console.log("2. duplicate create:", duplicate.status, duplicate.body?.code ?? "", "|", duplicate.body?.error ?? "");

// 3 — progress must move
let last = null;
for (let index = 0; index < 8; index += 1) {
  await sleep(3000);
  const poll = await call(`/api/evaluations/${runId}`);
  last = poll.body;
  console.log(`3. progress: ${last?.progress?.executionsCompleted}/${last?.progress?.total} executed, ${last?.progress?.completed}/${last?.progress?.total} judged (${last?.status})`);
  if ((last?.progress?.executionsCompleted ?? 0) >= 4) break;
}

// 4 — stop
const stop = await post(`/api/evaluations/${runId}/stop`);
const afterStop = await call(`/api/evaluations/${runId}`);
console.log("4. stop:", stop.status, "->", afterStop.body?.status, JSON.stringify(afterStop.body?.progress));

// 5 — resume until finished
const resume = await post(`/api/evaluations/${runId}/resume`);
console.log("5. resume:", resume.status, "retried:", resume.body?.retried, "remaining:", resume.body?.remaining);
const resumeDeadline = Date.now() + 300_000;
let resumed = null;
while (Date.now() < resumeDeadline) {
  await sleep(4000);
  const poll = await call(`/api/evaluations/${runId}`);
  resumed = poll.body;
  console.log(`5. polling: ${resumed?.progress?.executionsCompleted}/${resumed?.progress?.total} executed, ${resumed?.progress?.completed}/${resumed?.progress?.total} judged (${resumed?.status})`);
  if (resumed?.status !== "running") break;
}
console.log("5. final after resume:", resumed?.status, JSON.stringify(resumed?.progress));

// 6 — restart replaces it with a brand-new run
const restart = await post(`/api/evaluations/${runId}/restart`);
const newRunId = restart.body?.id;
console.log("6. restart:", restart.status, "new run:", newRunId, "old run still exists:", (await call(`/api/evaluations/${runId}`)).status === 200);

// 7 — a second restart while the new run executes must be refused
const restartAgain = await post(`/api/evaluations/${runId}/restart`);
console.log("7. second restart:", restartAgain.status, restartAgain.body?.code ?? "", "|", restartAgain.body?.error ?? "");

// 8 — let the new run settle, then stop whatever is left so nothing is left running
const newDeadline = Date.now() + 300_000;
let newest = null;
while (Date.now() < newDeadline) {
  await sleep(4000);
  const poll = await call(`/api/evaluations/${newRunId}`);
  newest = poll.body;
  console.log(`8. new run: ${newest?.progress?.completed}/${newest?.progress?.total} judged (${newest?.status})`);
  if (newest?.status !== "running") break;
}
if (newest?.status === "running" && newest?.progress?.completed > 0) {
  await post(`/api/evaluations/${newRunId}/stop`);
}

const finalList = await call("/api/evaluations?limit=10");
console.log("final run list:");
for (const run of Array.isArray(finalList.body) ? finalList.body : []) {
  console.log(`  ${run.createdAt} ${run.status} ${run.datasetName ?? ""} ${run.progress?.completed}/${run.progress?.total}`);
}
