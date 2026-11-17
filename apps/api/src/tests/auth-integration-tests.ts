import express from "express";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../prisma.js";
import { encryptKey, decryptKey } from "../crypto.js";
import { createApp } from "../app.js";
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
  return createApp();
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
    const userId = (me.data as { id: string }).id;
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

    // -- username login (used by the emergency Admin account)
    const usernameA = `AdminStyle${Date.now()}`;
    await prisma.user.update({ where: { id: (me.data as { id: string }).id }, data: { username: usernameA } });
    const byUsername = await request(base, { cookie: "" }, "/api/auth/login", "POST", { username: usernameA, password: "newpassword456" });
    check("login with username", byUsername.status, 200);
    const byUsernameWrong = await request(base, { cookie: "" }, "/api/auth/login", "POST", { username: usernameA, password: "definitely-wrong" });
    check("login with username wrong password 401", byUsernameWrong.status, 401);
    const unknownUser = await request(base, { cookie: "" }, "/api/auth/login", "POST", { username: "__nobody__", password: "irrelevant123" });
    check("login with unknown username 401", unknownUser.status, 401);
    const missingIdentifier = await request(base, { cookie: "" }, "/api/auth/login", "POST", { password: "irrelevant123" });
    check("login without identifier rejected", missingIdentifier.status, 400);

    // -- change password (wrong current -> 400)
    const changeBad = await request(base, sessionA, "/api/auth/change-password", "POST", { oldPassword: "notright", newPassword: "another456" });
    check("change-password wrong current 400", changeBad.status, 400);

    // -- dataset ownership
    const created = await request(base, sessionA, "/api/datasets", "POST", { name: `Alice's dataset ${Date.now()}`, useCase: "support" });
    check("create dataset 201", created.status, 201);
    const datasetA = created.data as { id: string };
    check("created dataset editable", (datasetA as unknown as { editable?: boolean }).editable, true);

    // Dataset routes are not available until sign-in (Home and account routes remain public).
    const anonDatasets = await request(base, { cookie: "" }, "/api/datasets");
    check("anonymous dataset tab API requires login", anonDatasets.status, 401);
    const anonDatasetDetail = await request(base, { cookie: "" }, `/api/datasets/${datasetA.id}`);
    check("anonymous dataset detail requires login", anonDatasetDetail.status, 401);

    // user A list includes own dataset
    const myDatasets = await request(base, sessionA, "/api/datasets");
    const myList = (myDatasets.data as Array<{ name: string }>) ?? [];
    check("user A sees own dataset", myList.some((d) => d.name === (created.data as { name: string }).name), true);

    // user B cannot read A's dataset (404)
    const signupB = await request(base, sessionB, "/api/auth/signup", "POST", { email: emailB, password, displayName: "Bob" });
    check("signup B 201", signupB.status, 201);
    const otherAccess = await request(base, sessionB, `/api/datasets/${datasetA.id}`);
    check("user B cannot read A's dataset (404)", otherAccess.status, 404);

    // Locally authenticated users can still see their own saved Playground runs.
    const localHistoryRow = await prisma.promptComparison.create({
      data: {
        model: "local-test-model",
        input: "A saved local comparison",
        promptA: "Prompt A",
        promptB: "Prompt B",
        userId: userId,
        status: "completed",
      },
    });
    const anonHistory = await request(base, { cookie: "" }, "/api/comparisons");
    check("anonymous comparison history requires login", anonHistory.status, 401);
    const localHistory = await request(base, sessionA, "/api/comparisons");
    const localRuns = (localHistory.data as Array<{ id: string }> | null) ?? [];
    check("local account sees its own previous comparison", localRuns.some((run) => run.id === localHistoryRow.id), true);
    const otherHistory = await request(base, sessionB, "/api/comparisons");
    const otherRuns = (otherHistory.data as Array<{ id: string }> | null) ?? [];
    check("another account cannot see local comparison history", otherRuns.some((run) => run.id === localHistoryRow.id), false);

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
    check("anonymous evaluation list 401", (await request(base, { cookie: "" }, "/api/evaluations")).status, 401);
    check("anonymous experiment list 401", (await request(base, { cookie: "" }, "/api/experiments")).status, 401);

    // -- the retired single-key endpoint never exposes a raw key
    const keyMetaRetired = await request(base, sessionA, "/api/auth/key");
    check("legacy key endpoint retired", keyMetaRetired.status, 410);
    check("legacy key endpoint returns no payload", JSON.stringify(keyMetaRetired.data).includes("encrypted-placeholder"), false);
    const hasKeyBefore = (me.data as { hasKey?: boolean }).hasKey;
    check("hasKey false without a connection", hasKeyBefore, false);
    const probeConnection = await prisma.providerConnection.create({
      data: {
        userId,
        provider: "openrouter",
        label: "HasKey probe",
        encryptedKey: "encrypted-placeholder",
        keyLast4: "7abc",
        modelCatalog: [],
      },
    });
    const meWithConnection = await request(base, sessionA, "/api/auth/me");
    check("hasKey true with a connection", (meWithConnection.data as { hasKey?: boolean }).hasKey, true);
    await prisma.providerConnection.delete({ where: { id: probeConnection.id } });
    const meWithoutConnection = await request(base, sessionA, "/api/auth/me");
    check("hasKey false after removing the connection", (meWithoutConnection.data as { hasKey?: boolean }).hasKey, false);

    // -- usage endpoint is server-computed and safe
    const usageA = await request(base, sessionA, "/api/usage");
    const usageBody = usageA.data as { total?: number; used?: number; remaining?: number };
    check("usage total is five", usageBody.total, 5);
    check("usage starts unused", usageBody.used, 0);
    check("usage remaining is five", usageBody.remaining, 5);
    const anonUsage = await request(base, { cookie: "" }, "/api/usage");
    check("anonymous usage 401", anonUsage.status, 401);

    // -- admin-only endpoints reject normal and anonymous callers
    const anonQa = await request(base, { cookie: "" }, "/api/models/qa");
    check("anonymous model QA 401", anonQa.status, 401);
    const userQa = await request(base, sessionB, "/api/models/qa");
    check("normal user model QA 403", userQa.status, 403);
    const userReconcile = await request(base, sessionB, "/api/admin/reconcile-runs", "POST", {});
    check("normal user reconcile 403", userReconcile.status, 403);

    // -- free-model policy rejects paid models at the API boundary
    const paidModel = await request(base, sessionA, "/api/evaluations", "POST", { datasetId: datasetA.id, model: "openai/gpt-5", promptA: "a", promptB: "b" });
    check("paid model rejected by API", paidModel.status, 400);

    // -- free accounts are capped at 30 scenarios per dataset
    // Seed the first 30 directly: the API is rate limited, and the limit under test is the
    // scenario cap, not the request throttle.
    await prisma.datasetTestCase.createMany({
      data: Array.from({ length: 30 }, (_, index) => ({ datasetId: datasetA.id, input: `Scenario ${index + 1}`, position: index })),
    });
    const overLimit = await request(base, sessionA, `/api/datasets/${datasetA.id}/test-cases`, "POST", { input: "Scenario 31" });
    check("31st scenario rejected", overLimit.status, 403);
    check("scenario cap error code", (overLimit.data as { code?: string }).code, "SCENARIO_LIMIT_REACHED");
    check("dataset still holds 30 scenarios", await prisma.datasetTestCase.count({ where: { datasetId: datasetA.id } }), 30);

    // -- resume/restart controls on plain dataset evaluations
    const resumeDataset = await prisma.dataset.create({
      data: { name: `Resume fixture ${Date.now()}`, isSample: false, userId, testCases: { create: [{ input: "resume case", position: 0 }] } },
    });
    const testCaseId = (await prisma.datasetTestCase.findFirst({ where: { datasetId: resumeDataset.id }, select: { id: true } }))!.id;
    const finishedRun = await prisma.evaluationRun.create({
      data: {
        datasetId: resumeDataset.id,
        model: "nvidia/nemotron-3.5-lightning:free",
        promptA: "a",
        promptB: "b",
        status: "completed",
        userId,
        results: {
          create: [
            { testCaseId, variant: "A", status: "completed", output: "ok", prompt: "a" },
            { testCaseId, variant: "B", status: "completed", output: "ok", prompt: "b" },
          ],
        },
      },
    });
    check("resume by another account 404", (await request(base, sessionB, `/api/evaluations/${finishedRun.id}/resume`, "POST", {})).status, 404);
    const nothingToResume = await request(base, sessionA, `/api/evaluations/${finishedRun.id}/resume`, "POST", {});
    check("resume with no gaps reports zero retried", (nothingToResume.data as { retried?: number }).retried, 0);
    await prisma.evaluationRun.update({ where: { id: finishedRun.id }, data: { status: "running" } });
    check("resume while running 409", (await request(base, sessionA, `/api/evaluations/${finishedRun.id}/resume`, "POST", {})).status, 409);
    await prisma.evaluationRun.delete({ where: { id: finishedRun.id } });

    // -- polling must not be throttled: the results page polls continuously during a run
    const pollStatuses: number[] = [];
    for (let index = 0; index < 40; index += 1) {
      pollStatuses.push((await request(base, sessionA, "/api/evaluations?limit=1")).status);
    }
    check("40 evaluation polls are not throttled", pollStatuses.filter((status) => status === 429).length, 0);

    // -- manual endpoint is protected like the other workspace tabs
    const anonManual = await request(base, { cookie: "" }, "/api/manual");
    check("anonymous manual requires login", anonManual.status, 401);
    const manual = await request(base, sessionA, "/api/manual");
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
