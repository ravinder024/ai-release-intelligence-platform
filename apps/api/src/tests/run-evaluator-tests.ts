import { judgeResult } from "../services/evaluator.js";

async function run() {
  let failures = 0;

  // Test 1: well-formed JSON
  const provider1 = {
    execute: async () => ({
      output: JSON.stringify({
        overallScore: 80,
        pass: true,
        summary: "Good.",
        criteriaResults: [
          { criterion: "A", score: 80, pass: true, reason: null },
        ],
      }),
    }),
  };

  const res1 = await judgeResult({
    evaluatorModel: "nvidia/nemotron-3.5-lightning:free",
    evaluatorPrompt: null,
    input: "input",
    response: "resp",
    expectedOutput: null,
    criteria: ["A"],
    threshold: 60,
    provider: provider1,
  });

  if (res1.status !== "completed" || res1.overallScore !== 80 || !res1.pass) {
    console.error("Test1 failed", res1);
    failures++;
  } else {
    console.log("Test1 passed");
  }

  // Test 2: malformed JSON (single quotes, trailing comma), missing pass flags
  const provider2 = {
    execute: async () => ({
      output: "{ 'overallScore': 70, 'summary': 'Ok', 'criteriaResults': [ { 'criterion': 'A', 'score': 70, }, ], }",
    }),
  };

  const res2 = await judgeResult({
    evaluatorModel: "nvidia/nemotron-3.5-lightning:free",
    evaluatorPrompt: null,
    input: "input",
    response: "resp",
    expectedOutput: null,
    criteria: ["A"],
    threshold: 60,
    provider: provider2,
  });

  if (res2.status !== "completed" || res2.overallScore < 60 || !res2.pass) {
    console.error("Test2 failed", res2);
    failures++;
  } else {
    console.log("Test2 passed");
  }

  // Test 3: missing criteriaResults -> should infer overallScore 0 and fail
  const provider3 = {
    execute: async () => ({ output: JSON.stringify({ overallScore: 0, pass: false, summary: null }) }),
  };

  const res3 = await judgeResult({
    evaluatorModel: "nvidia/nemotron-3.5-lightning:free",
    evaluatorPrompt: null,
    input: "input",
    response: "resp",
    expectedOutput: null,
    criteria: [],
    threshold: 60,
    provider: provider3,
  });

  if (res3.status !== "completed" || res3.overallScore !== 0 || res3.pass) {
    console.error("Test3 failed", res3);
    failures++;
  } else {
    console.log("Test3 passed");
  }

  // Test 4: truncated JSON (a reasoning judge ran out of tokens before closing the object).
  // Production evidence: deepseek-r1 answered `{"overallScore": 95, "pass": true, "summary": "…`
  // and every judgement was discarded as "could not extract JSON", turning runs partial.
  const provider4 = {
    execute: async () => ({
      output: '{\n  "overallScore": 95,\n  "pass": true,\n  "summary": "The response acknowledges the concern and explai',
    }),
  };

  const res4 = await judgeResult({
    evaluatorModel: "deepseek/deepseek-r1-0528",
    evaluatorPrompt: null,
    input: "input",
    response: "resp",
    expectedOutput: null,
    criteria: ["A"],
    threshold: 85,
    provider: provider4,
  });

  if (res4.status !== "completed" || res4.overallScore !== 95 || !res4.pass) {
    console.error("Test4 failed", res4);
    failures++;
  } else {
    console.log("Test4 passed (truncated JSON salvaged)");
  }

  // Test 5: the judge must ask for a large completion budget (reasoning models need the room).
  let requestedTokens: number | undefined;
  const provider5 = {
    execute: async (args: { maxTokens?: number }) => {
      requestedTokens = args.maxTokens;
      return { output: JSON.stringify({ overallScore: 90, pass: true, summary: "Fine." }) };
    },
  };

  await judgeResult({
    evaluatorModel: "deepseek/deepseek-r1-0528",
    evaluatorPrompt: null,
    input: "input",
    response: "resp",
    expectedOutput: null,
    criteria: ["A"],
    threshold: 85,
    provider: provider5 as never,
  });

  if ((requestedTokens ?? 0) < 2048) {
    console.error("Test5 failed - judge did not request extra tokens:", requestedTokens);
    failures++;
  } else {
    console.log(`Test5 passed (judge requested ${requestedTokens} tokens)`);
  }

  // Test 6: a genuinely empty answer must still be reported as a failed judgement.
  const provider6 = { execute: async () => ({ output: "" }) };
  const res6 = await judgeResult({
    evaluatorModel: "deepseek/deepseek-r1-0528",
    evaluatorPrompt: null,
    input: "input",
    response: "resp",
    expectedOutput: null,
    criteria: ["A"],
    threshold: 85,
    provider: provider6,
  });
  if (res6.status !== "failed") {
    console.error("Test6 failed", res6);
    failures++;
  } else {
    console.log("Test6 passed (empty answer is a real failure)");
  }

  if (failures > 0) {
    console.error(`${failures} tests failed`);
    process.exit(1);
  }
  console.log("All tests passed");
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(2);
});
