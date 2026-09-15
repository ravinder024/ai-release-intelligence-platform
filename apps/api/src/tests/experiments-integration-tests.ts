import { prisma } from "../prisma.js";
import { buildExperimentDetail, createNextIteration, retryExperimentFailures, startExperimentRun } from "../routes/experiments.js";
import type { ModelProvider } from "../provider.js";

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
function close(label: string, actual: number | null | undefined, expected: number, tolerance = 0.2) {
  const pass = actual !== null && actual !== undefined && Math.abs(actual - expected) <= tolerance;
  if (!pass) {
    failures++;
    console.error(`FAIL ${label}\n  expected ~${expected}\n  actual:   ${actual}`);
  } else {
    console.log(`PASS ${label}`);
  }
}

const BASELINE_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
const CANDIDATE_MODEL = "google/gemma-4-31b-it:free";
const EVALUATOR_MODEL = "nvidia/nemotron-3.5-lightning:free";

/**
 * Deterministic fake provider. Baseline/candidate return fixed model outputs;
 * the judge returns scores keyed on which configuration produced the response.
 * One scenario ("Escalation") is deliberately worse for the candidate so we can
 * assert regression detection.
 */
function makeFakeProvider(): ModelProvider {
  return {
    async execute({ model, input }) {
      if (model === EVALUATOR_MODEL) {
        const lines = input.split("\n");
        const testCaseInput = (lines[1] ?? lines[0]).trim();
        const isBaseline = input.includes("BASELINE_OUTPUT:");
        const isEscalation = testCaseInput.includes("Escalation");
        if (isBaseline) {
          const score = isEscalation ? 80 : 82;
          return {
            output: JSON.stringify({
              overallScore: score,
              pass: true,
              summary: "baseline ok",
              criteriaResults: [
                { criterion: "Accuracy", score: 82, pass: true, reason: null },
                { criterion: "Completeness", score: isEscalation ? 78 : 76, pass: true, reason: null },
              ],
            }),
            inputTokens: 10,
            outputTokens: 10,
          };
        }
        const score = isEscalation ? 64 : 91;
        return {
          output: JSON.stringify({
            overallScore: score,
            pass: score >= 70,
            summary: "candidate result",
            criteriaResults: [
              { criterion: "Accuracy", score: isEscalation ? 60 : 91, pass: score >= 70, reason: null },
              { criterion: "Completeness", score: isEscalation ? 65 : 79, pass: score >= 70, reason: null },
            ],
          }),
          inputTokens: 10,
          outputTokens: 10,
        };
      }
      const marker = model === BASELINE_MODEL ? "BASELINE_OUTPUT" : "CANDIDATE_OUTPUT";
      return { output: `${marker}: ${input.slice(0, 40)}`, inputTokens: 5, outputTokens: 5 };
    },
  };
}

/**
 * Retry-capable provider: on the first run the candidate fails 2 scenarios
 * (Escalation, Billing) with an execution error; after setFailCandidate(false)
 * everything succeeds. Counts model calls to prove successful scenarios are not re-run.
 */
function makeRetryProvider() {
  let failCandidate = true;
  let baselineCalls = 0;
  let candidateCalls = 0;
  return {
    getBaselineCalls: () => baselineCalls,
    getCandidateCalls: () => candidateCalls,
    setFailCandidate: (value: boolean) => { failCandidate = value; },
    async execute({ model, input }: { model: string; prompt: string; input: string }) {
      if (model === EVALUATOR_MODEL) {
        const lines = input.split("\n");
        const testCaseInput = (lines[1] ?? lines[0]).trim();
        const isBaseline = input.includes("BASELINE_OUTPUT:");
        const score = isBaseline ? 82 : 91;
        return {
          output: JSON.stringify({
            overallScore: score,
            pass: true,
            summary: "ok",
            criteriaResults: [{ criterion: "Accuracy", score, pass: true, reason: null }],
          }),
          inputTokens: 10,
          outputTokens: 10,
        };
      }
      if (model === BASELINE_MODEL) baselineCalls += 1;
      else candidateCalls += 1;
      if (failCandidate && model === CANDIDATE_MODEL && (input.includes("Escalation") || input.includes("Billing"))) {
        throw new Error("rate limited");
      }
      const marker = model === BASELINE_MODEL ? "BASELINE_OUTPUT" : "CANDIDATE_OUTPUT";
      return { output: `${marker}: ${input.slice(0, 40)}`, inputTokens: 5, outputTokens: 5 };
    },
  };
}

async function run() {
  let datasetId: string | null = null;
  let experimentId: string | null = null;
  try {
    // 1. Fixture dataset with 5 scenarios (one regression trigger)
    const dataset = await prisma.dataset.create({
      data: {
        name: `E2E Fixture ${Date.now()}`,
        description: "Deterministic integration fixture",
        isSample: false,
        testCases: {
          create: [
            { input: "Refund", expectedOutput: "Refund guidance", evaluationCriteria: ["Accuracy", "Completeness"], position: 0 },
            { input: "Escalation", expectedOutput: "Escalate calmly", evaluationCriteria: ["Accuracy", "Completeness"], position: 1 },
            { input: "Cancellation", expectedOutput: "Cancel steps", evaluationCriteria: ["Accuracy", "Completeness"], position: 2 },
            { input: "Billing", expectedOutput: "Billing help", evaluationCriteria: ["Accuracy", "Completeness"], position: 3 },
            { input: "Feature request", expectedOutput: "Acknowledge", evaluationCriteria: ["Accuracy", "Completeness"], position: 4 },
          ],
        },
      },
    });
    datasetId = dataset.id;

    // 2. Create experiment (mimics POST /api/experiments)
    const experiment = await prisma.experiment.create({
      data: {
        name: "Integration Test Experiment",
        hypothesis: "Candidate should improve quality on most scenarios.",
        datasetId: dataset.id,
        baselinePrompt: "You are a support assistant.",
        baselineModel: BASELINE_MODEL,
        candidatePrompt: "You are an empathetic support assistant.",
        candidateModel: CANDIDATE_MODEL,
        evaluatorModel: EVALUATOR_MODEL,
        evaluatorThreshold: 70,
        status: "draft",
      },
    });
    experimentId = experiment.id;

    // 3. Run the experiment end-to-end with the fake provider (awaits completion)
    const run = await startExperimentRun(experiment.id, { provider: makeFakeProvider(), awaitRun: true });
    check("3. run created", run !== null && run !== "conflict", true);
    if (run === null || run === "conflict") throw new Error("Expected a run");
    check("3b. run linked to experiment", run.experimentId, experiment.id);

    const after = await prisma.experiment.findUnique({ where: { id: experiment.id }, select: { status: true } });
    check("4. experiment completed", after?.status, "completed");

    // 4. Metrics
    const detail = await buildExperimentDetail(experiment.id);
    check("5. detail found", detail !== null, true);
    close("6. baseline avg score", detail?.metrics.baseline.avgScore, 81.6);
    close("7. candidate avg score", detail?.metrics.candidate.avgScore, 85.6);
    close("8. score delta", detail?.metrics.comparison.scoreDelta, 4);
    close("9. pass-rate delta (pp)", detail?.metrics.comparison.passRateDelta, -20);

    // 5. Criterion comparison
    const accuracy = detail?.criteria.find((c) => c.criterion === "Accuracy");
    const completeness = detail?.criteria.find((c) => c.criterion === "Completeness");
    close("10. criterion Accuracy delta", accuracy?.delta, 2.8);
    close("11. criterion Completeness delta (regression)", completeness?.delta, -0.2);

    // 6. Scenario comparison + regressions
    const escalation = detail?.scenarios.find((s) => s.input === "Escalation");
    close("12. Escalation scenario delta (regression)", escalation?.delta, -16);
    check("13. Escalation pass change", escalation?.passChange, "regressed");
    check("14. regressions include Escalation", detail?.regressions.some((r) => r.kind === "scenario" && r.testCaseId === escalation?.testCaseId), true);
    check("15. criterion regression detected", detail?.regressions.some((r) => r.kind === "criterion"), true);

    // 7. Decision persistence (mimics PATCH /api/experiments/:id/decision)
    const decided = await prisma.experiment.update({
      where: { id: experiment.id },
      data: { decision: "continue_experiment", decisionNote: "Watch Escalation regression.", decidedAt: new Date() },
    });
    check("16. decision saved", decided.decision, "continue_experiment");
    check("17. rationale saved", decided.decisionNote, "Watch Escalation regression.");
    check("18. decidedAt set", decided.decidedAt !== null, true);

    // 8. Reproducibility — rename the dataset; experiment snapshot must not change
    await prisma.dataset.update({ where: { id: dataset.id }, data: { name: "Renamed After Run" } });
    const detailAfterRename = await buildExperimentDetail(experiment.id);
    check("19. baseline prompt preserved", detailAfterRename?.baselinePrompt, "You are a support assistant.");
    check("20. candidate prompt preserved", detailAfterRename?.candidatePrompt, "You are an empathetic support assistant.");
    close("21. metrics preserved after dataset rename", detailAfterRename?.metrics.comparison.scoreDelta, 4);
    check("22. dataset name reflects rename (live link)", detailAfterRename?.datasetName, "Renamed After Run");

    // --- Recommendation (Test Group E) ---
    check("23. recommendation present", detail?.recommendation !== null, true);
    check("24. recommendation = keep baseline (pass rate declined)", detail?.recommendation?.recommendation, "keep_baseline");

    // --- Evaluator persistence + threshold semantics (Test Group C) ---
    check("25. evaluator model persisted", experiment.evaluatorModel, EVALUATOR_MODEL);
    check("26. threshold persisted", experiment.evaluatorThreshold, 70);
    const escalationEv = detail?.scenarios.find((s) => s.input === "Escalation");
    check("27. score>=threshold passes (80 vs 70)", escalationEv?.baselineJudgement?.pass, true);
    check("28. score<threshold fails (64 vs 70)", escalationEv?.candidateJudgement?.pass, false);
    // Quality failure (judged low) is NOT retryable.
    check("B1. quality failure not retryable (all completed)", detail?.completion.retryable, 0);

    // --- Partial retry (Test Groups A + B) ---
    const retryExperiment = await prisma.experiment.create({
      data: {
        name: "Retry Test",
        hypothesis: null,
        datasetId: dataset.id,
        baselinePrompt: "Retry baseline",
        baselineModel: BASELINE_MODEL,
        candidatePrompt: "Retry candidate",
        candidateModel: CANDIDATE_MODEL,
        evaluatorModel: EVALUATOR_MODEL,
        evaluatorThreshold: 70,
        status: "draft",
      },
    });
    const retryProvider = makeRetryProvider();
    await startExperimentRun(retryExperiment.id, { provider: retryProvider, awaitRun: true });

    const retryFirst = await buildExperimentDetail(retryExperiment.id);
    check("A1. candidate 3/5 after first run", retryFirst?.completion.candidate.completed, 3);
    check("A2. baseline 5/5 after first run", retryFirst?.completion.baseline.completed, 5);
    check("A3. retryable = 2", retryFirst?.completion.retryable, 2);
    check("A4. baseline calls = 5 (not re-run)", retryProvider.getBaselineCalls(), 5);
    // 5 candidate scenarios; the 2 that fail are retried once internally (MAX_ATTEMPTS=2) -> 7 calls
    check("A5. candidate calls = 7 on first run (5 + 2 internal retry attempts)", retryProvider.getCandidateCalls(), 7);
    check("A6. recommendation insufficient while incomplete", retryFirst?.recommendation?.recommendation, "insufficient_data");

    retryProvider.setFailCandidate(false);
    const retryResult = await retryExperimentFailures(retryExperiment.id, { provider: retryProvider, awaitRun: true });
    check("A7. retried = 2", retryResult?.retried, 2);
    check("A8. remaining = 0", retryResult?.remaining, 0);

    const retryAfter = await buildExperimentDetail(retryExperiment.id);
    check("A9. candidate 5/5 after retry", retryAfter?.completion.candidate.completed, 5);
    check("A10. retryable = 0 after retry", retryAfter?.completion.retryable, 0);
    check("A11. baseline calls still 5 (successful never re-run)", retryProvider.getBaselineCalls(), 5);
    // Only the 2 retried pairs ran again: 7 before + 2 = 9 (the 3 successful candidates were NOT re-run)
    check("A12. candidate calls = 9 (7 + 2 retried)", retryProvider.getCandidateCalls(), 9);
    check("A13. recommendation now promote after completion", retryAfter?.recommendation?.recommendation, "promote_candidate");

    // --- Iteration + versioning (Test Groups F, G) ---
    const iter2 = await createNextIteration(experiment.id, {
      candidatePrompt: "You are a very polished assistant.",
      candidateModel: CANDIDATE_MODEL,
      evaluatorModel: EVALUATOR_MODEL,
      evaluatorThreshold: 70,
    });
    check("F1. iteration 2 created", iter2?.iteration, 2);
    check("F2. iteration 2 baseline = previous candidate", iter2?.baselinePrompt, "You are an empathetic support assistant.");
    check("F3. iteration 2 baseline model = previous candidate model", iter2?.baselineModel, CANDIDATE_MODEL);
    check("F4. iteration 2 parent = root", iter2?.parentId, experiment.id);
    const iter1After = await prisma.experiment.findUnique({ where: { id: experiment.id } });
    check("F5. iteration 1 candidate unchanged", iter1After?.candidatePrompt, "You are an empathetic support assistant.");
    const detailIter2 = await buildExperimentDetail(iter2!.id);
    check("F6. iteration history length 2", detailIter2?.iterations.length, 2);
    check("F7. rootId set", detailIter2?.rootId, experiment.id);
    check("G1. no comparability warning (same evaluator)", detailIter2?.comparabilityWarning, null);

    const iter3 = await createNextIteration(iter2!.id, {
      candidatePrompt: "Another prompt",
      candidateModel: BASELINE_MODEL,
      evaluatorModel: BASELINE_MODEL,
      evaluatorThreshold: 80,
    });
    const detailIter3 = await buildExperimentDetail(iter3!.id);
    check("G2. comparability warning on evaluator change", detailIter3?.comparabilityWarning !== null, true);
    check("G3. iteration 3 baseline = iteration 2 candidate", detailIter3?.baselinePrompt, "You are a very polished assistant.");

    // --- Dataset change does not alter historical display (Test Group I) ---
    await prisma.datasetTestCase.updateMany({ where: { datasetId: dataset.id, input: "Escalation" }, data: { input: "Escalation CHANGED AFTER RUN" } });
    const detailAfterEdit = await buildExperimentDetail(experiment.id);
    check("I1. historical scenario input preserved from snapshot", detailAfterEdit?.scenarios.some((s) => s.input === "Escalation"), true);
    check("I2. changed input not shown for historical run", detailAfterEdit?.scenarios.some((s) => s.input === "Escalation CHANGED AFTER RUN"), false);

    // Clean up extra experiments created for retry/iteration tests
    for (const id of [retryExperiment.id, iter2?.id, iter3?.id]) {
      if (id) await prisma.experiment.deleteMany({ where: { id } }).catch(() => undefined);
    }
  } finally {
    // cleanup ALWAYS runs before the process exits (no process.exit inside try)
    if (experimentId) await prisma.experiment.deleteMany({ where: { id: experimentId } }).catch(() => undefined);
    if (datasetId) await prisma.dataset.deleteMany({ where: { id: datasetId } }).catch(() => undefined);
    await prisma.$disconnect();
  }

  if (failures > 0) {
    console.error(`${failures} integration tests failed`);
    process.exit(1);
  }
  console.log("All integration tests passed");
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(2);
  });
