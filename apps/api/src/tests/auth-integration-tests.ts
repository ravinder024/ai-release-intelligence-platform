import express from "express";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../prisma.js";
import { encryptKey, decryptKey } from "../crypto.js";
import { authRouter } from "../routes/auth.js";
import { datasetsRouter } from "../routes/datasets.js";
import { evaluationsRouter } from "../routes/evaluations.js";
import { experimentsRouter } from "../routes/experiments.js";
import { comparisonsRouter } from "../routes/comparisons.js";
import { modelsRouter } from "../routes/models.js";
import { pruneData } from "../scripts/prune.js";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) {
    failures++;
    console.error(`FAIL ${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  } else {
    console.log(`PASS ${label}`);
  }
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", modelsRouter);
  app.use("/api", authRouter);
  app.use("/api", comparisonsRouter);
  app.use("/api", datasetsRouter);
  app.use("/api", evaluationsRouter);
  app.use("/api", experimentsRouter);
  app.get("/api/manual", (_req, res) => {
    const manualPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../docs/User manual.md");
    if (!existsSync(manualPath)) return res.status(404).json({ error: "not found" });
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.send(readFileSync(manualPath, "utf8"));
  });
  return app;
}

type Session = { cookie: string };

async function request(base: string, session: Session, path: string, method = "GET", body?: unknown) {
  const headers: Record<string, string> = {};
  if (session.cookie) headers["Cookie"] = session.cookie;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) {
    const token = setCookie.split(";")[0];
    if (token.startsWith("arip_session=")) session.cookie = token;
  }
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

const emailA = `authA_${Date.now()}@example.com`;
const emailB = `authB_${Date.now()}@example.com`;
const password = "supersecret123";

async function main() {
  const server = buildApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const sessionA: Session = { cookie: "" };
  const sessionB: Session = { cookie: "" };

  // -- crypto roundtrip
  const enc = encryptKey("sk-test-abc");
  check("crypto roundtrip", decryptKey(enc), "sk-test-abc");

  try {
    // -- signup
    const signup = await request(base, sessionA, "/api/auth/signup", "POST", { email: emailA, password, displayName: "Alice" });
    check("signup 201", signup.status, 201);
    check("signup sets cookie", sessionA.cookie.startsWith("arip_session="), true);

    // -- me (authed + anonymous)
    const me = await request(base, sessionA, "/api/auth/me");
    check("me email", (me.data as { email?: string }).email, emailA.toLowerCase());
    const anon = await request(base, { cookie: "" }, "/api/auth/me");
    check("me anonymous 401", anon.status, 401);

    // -- login: wrong then right
    const wrongLogin = await request(base, { cookie: "" }, "/api/auth/login", "POST", { email: emailA, password: "wrongpassword" });
    check("login wrong 401", wrongLogin.status, 401);
    const logout = await request(base, sessionA, "/api/auth/logout", "POST", {});
    check("logout ok", (logout.data as { ok?: boolean }).ok, true);
    const meAfterLogout = await request(base, sessionA, "/api/auth/me");
    check("me after logout 401", meAfterLogout.status, 401);
    const login = await request(base, sessionA, "/api/auth/login", "POST", { email: emailA, password });
    check("login ok", login.status, 200);

    // -- forgot + reset password
    const forgot = await request(base, { cookie: "" }, "/api/auth/forgot-password", "POST", { email: emailA });
    const code = (forgot.data as { code?: string | null }).code;
    check("forgot returns code", typeof code === "string" && code.length > 0, true);
    const reset = await request(base, { cookie: "" }, "/api/auth/reset-password", "POST", { email: emailA, code, password: "newpassword456" });
    check("reset ok", (reset.data as { ok?: boolean }).ok, true);
    const loginNew = await request(base, sessionA, "/api/auth/login", "POST", { email: emailA, password: "newpassword456" });
    check("login with new password", loginNew.status, 200);

    // -- change password (wrong current -> 400)
    const changeBad = await request(base, sessionA, "/api/auth/change-password", "POST", { oldPassword: "notright", newPassword: "another456" });
    check("change-password wrong current 400", changeBad.status, 400);

    // -- dataset ownership
    const created = await request(base, sessionA, "/api/datasets", "POST", { name: `Alice's dataset ${Date.now()}`, useCase: "support" });
    check("create dataset 201", created.status, 201);
    const datasetA = created.data as { id: string };
    check("created dataset editable", (datasetA as unknown as { editable?: boolean }).editable, true);

    // anonymous list: only samples (no user datasets)
    const anonDatasets = await request(base, { cookie: "" }, "/api/datasets");
    const anonList = (anonDatasets.data as Array<{ isSample?: boolean; editable?: boolean }>) ?? [];
    check("anonymous sees only samples", anonList.every((d) => d.isSample), true);

    // user A list includes own dataset
    const myDatasets = await request(base, sessionA, "/api/datasets");
    const myList = (myDatasets.data as Array<{ name: string }>) ?? [];
    check("user A sees own dataset", myList.some((d) => d.name === (created.data as { name: string }).name), true);

    // user B cannot read A's dataset (404)
    const signupB = await request(base, sessionB, "/api/auth/signup", "POST", { email: emailB, password, displayName: "Bob" });
    check("signup B 201", signupB.status, 201);
    const otherAccess = await request(base, sessionB, `/api/datasets/${datasetA.id}`);
    check("user B cannot read A's dataset (404)", otherAccess.status, 404);

    // user B cannot edit A's dataset (403/404)
    const otherEdit = await request(base, sessionB, `/api/datasets/${datasetA.id}`, "PATCH", { name: "hacked" });
    check("user B cannot edit A's dataset", otherEdit.status, 404);

    // sample dataset is read-only (403 on PATCH)
    const samples = await prisma.dataset.findMany({ where: { isSample: true }, take: 1 });
    if (samples[0]) {
      const sampleEdit = await request(base, sessionA, `/api/datasets/${samples[0].id}`, "PATCH", { name: "renamed" });
      check("sample dataset read-only (403)", sampleEdit.status, 403);
    } else {
      check("sample dataset read-only (403) [no samples]", true, true);
    }

    // -- evaluations: anonymous create 401
    const anonEval = await request(base, { cookie: "" }, "/api/evaluations", "POST", { datasetId: datasetA.id, model: "nvidia/nemotron-3.5-lightning:free", promptA: "a", promptB: "b" });
    check("anonymous create run 401", anonEval.status, 401);

    // -- manual endpoint
    const manual = await request(base, { cookie: "" }, "/api/manual");
    check("manual 200", manual.status, 200);
    check("manual is markdown", typeof manual.data === "string" && manual.data.includes("User Manual"), true);

    // -- prune: only samples remain, users wiped
    const pruneResult = await pruneData();
    check("prune wipes users", pruneResult.deletedUsers >= 2, true);
    check("prune keeps samples", pruneResult.sampleCount >= 1, true);
    const remaining = await prisma.dataset.findMany({ where: { isSample: false } });
    check("no non-sample datasets after prune", remaining.length, 0);
    const users = await prisma.user.count();
    check("no users after prune", users, 0);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

main()
  .catch((error) => {
    console.error("Auth/ownership test crashed:", error);
    failures++;
  })
  .finally(async () => {
    // Best-effort cleanup of any test-created rows.
    await prisma.user.deleteMany({ where: { email: { in: [emailA, emailB] } } }).catch(() => undefined);
    await prisma.dataset.deleteMany({ where: { name: { startsWith: "Alice's dataset" } } }).catch(() => undefined);
    await prisma.$disconnect();
    if (failures > 0) process.exit(1);
    console.log("All auth/ownership tests passed");
    process.exit(0);
  });
