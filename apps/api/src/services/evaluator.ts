import { getModelProvider } from "../provider.js";
import type { ModelId } from "@prompt-playground/shared";

export type JudgementCriterion = {
  criterion: string;
  score: number;
  pass: boolean;
  reason: string | null;
};

export type JudgementResult = {
  overallScore: number;
  pass: boolean;
  summary: string | null;
  evaluatorModel: string | null;
  threshold: number | null;
  status: "completed" | "failed";
  errorMessage: string | null;
  criteriaResults: JudgementCriterion[];
  rawOutput?: string | null;
};

export type JudgeResultArgs = {
  evaluatorModel: ModelId;
  evaluatorPrompt: string | null;
  input: string;
  response: string;
  expectedOutput: string | null;
  criteria: string[];
  threshold: number | null;
  // Optional provider override for testing/mocks
  provider?: { execute: (opts: { model: string; prompt: string; input: string }) => Promise<{ output: string | null }>; };
};

const defaultEvaluatorPrompt = `You are a model evaluation assistant. Compare the assistant response to the test case input and expected output, if present.

Return a single valid JSON object with the following fields:
- overallScore: an integer score from 0 to 100.
- pass: true if the response meets the quality threshold.
- summary: a short explanation of the judgement.
- criteriaResults: an array of objects with criterion, score, pass, and reason.

Example output (must match this JSON shape exactly):
{
  "overallScore": 85,
  "pass": true,
  "summary": "Clear steps and helpful links; tone is empathetic.",
  "criteriaResults": [
    { "criterion": "Clear steps", "score": 90, "pass": true, "reason": "Provides numbered steps" },
    { "criterion": "Helpful links", "score": 80, "pass": true, "reason": "Includes docs link" }
  ]
}

Do not add any text outside the JSON object.`;

function buildMessages({ evaluatorPrompt, input, response, expectedOutput, criteria, threshold }: Omit<JudgeResultArgs, "evaluatorModel">) {
  const prompt = evaluatorPrompt?.trim().length ? evaluatorPrompt.trim() : defaultEvaluatorPrompt;
  const thresholdText = threshold !== null && threshold !== undefined ? `The pass threshold is ${threshold}.` : "There is no fixed threshold; use your judgement.";
  const expectedText = expectedOutput ? `

Expected output: ${expectedOutput}` : "";
  const criteriaText = criteria.length > 0 ? `Evaluation criteria:\n- ${criteria.join("\n- ")}` : "Evaluation criteria:\n- Overall response quality";

  const userContent = `Test case input:\n${input}\n\nAssistant response:\n${response}${expectedText}\n\n${criteriaText}\n\n${thresholdText}\n\nRespond with JSON only.`;

  return {
    prompt,
    input: userContent,
  };
}

function normalizeJson(raw: string): string {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Could not extract JSON from evaluator response.");
  }
  return raw.slice(start, end + 1);
}

function safeJsonParse(text: string): any {
  try {
    return JSON.parse(text);
  } catch (err) {
    // attempt simple fixes: replace single quotes and remove trailing commas
    const singleQuoted = text.replace(/([\{,\[]\s*)'([^']*)'\s*:/g, '$1"$2":');
    const doubleQuoted = singleQuoted.replace(/'([^']*)'/g, '"$1"');
    const noTrailing = doubleQuoted.replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(noTrailing);
  }
}

function parseJudgement(raw: string, thresholdHint: number | null = null): Omit<JudgementResult, "evaluatorModel"> {
  const text = normalizeJson(raw);
  const parsed = safeJsonParse(text) as Partial<{
    overallScore: number;
    pass: boolean;
    summary: string | null;
    criteriaResults: Array<Partial<{ criterion: string; score: number; pass: boolean; reason: string | null }>>;
  }>;

  // Derive overallScore if missing but criteria exist
  let overallScore: number | null = null;
  if (typeof parsed.overallScore === "number" && !Number.isNaN(parsed.overallScore)) {
    overallScore = Math.max(0, Math.min(100, Math.round(parsed.overallScore)));
  }

  const rawCriteria = Array.isArray(parsed.criteriaResults) ? parsed.criteriaResults : [];
  const criteriaResults = rawCriteria.map((item, index) => {
    const criterion = item && typeof item.criterion === "string" ? item.criterion : `criterion_${index}`;
    const score = typeof item?.score === "number" && !Number.isNaN(item.score) ? Math.max(0, Math.min(100, Math.round(item.score))) : 0;
    // if pass flag missing, infer from score using thresholdHint or default 50
    const pass = typeof item?.pass === "boolean" ? item.pass : score >= (thresholdHint ?? 50);
    return {
      criterion,
      score,
      pass,
      reason: item?.reason ?? null,
    };
  });

  if (overallScore === null) {
    if (criteriaResults.length > 0) {
      overallScore = Math.round(criteriaResults.reduce((s, c) => s + c.score, 0) / criteriaResults.length);
    } else {
      overallScore = 0;
    }
  }

  const pass = typeof parsed.pass === "boolean" ? parsed.pass : overallScore >= (thresholdHint ?? 50);

  return {
    overallScore,
    pass,
    summary: parsed.summary ?? null,
    threshold: null,
    status: "completed",
    errorMessage: null,
    criteriaResults,
  };
}

export async function judgeResult(args: JudgeResultArgs): Promise<JudgementResult> {
  const provider = args.provider ?? getModelProvider();
  let messages = buildMessages(args);
  let rawOutput: string | null = null;
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await provider.execute({ model: args.evaluatorModel, prompt: messages.prompt, input: messages.input });
      rawOutput = result.output ?? "";
      const parsed = parseJudgement(rawOutput, args.threshold ?? null);
      const pass = args.threshold !== null && args.threshold !== undefined ? parsed.overallScore >= args.threshold : parsed.pass;
      return {
        ...parsed,
        rawOutput: rawOutput?.slice(0, 20000) ?? null,
        evaluatorModel: args.evaluatorModel,
        threshold: args.threshold,
        pass,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      if (attempt >= maxAttempts) {
        const combined = `Attempt ${attempt} failed: ${errMsg}` + (rawOutput ? ` -- rawOutput: ${rawOutput.slice(0, 1000)}` : "");
        return {
          overallScore: 0,
          pass: false,
          summary: null,
          evaluatorModel: args.evaluatorModel,
          threshold: args.threshold,
          status: "failed",
            errorMessage: combined,
            rawOutput: rawOutput?.slice(0, 20000) ?? null,
          criteriaResults: [],
        };
      }
      // tighten the prompt for the retry to emphasize strict JSON output
      messages = {
        ...messages,
        prompt: `${messages.prompt}\n\nIMPORTANT: Respond only with a single valid JSON object that matches the schema exactly. Do NOT include any explanatory text or commentary.`,
      };
    }
  }

  return {
    overallScore: 0,
    pass: false,
    summary: null,
    evaluatorModel: args.evaluatorModel,
    threshold: args.threshold,
    status: "failed",
    errorMessage: "Evaluator failed after retries.",
    criteriaResults: [],
  };
}
