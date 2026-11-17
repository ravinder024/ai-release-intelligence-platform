import { getModelProvider } from "../provider.js";
import { withProviderSlot } from "./providerLimiter.js";

/**
 * A judge call must never hang forever: a stalled request would keep its evaluation run in
 * `running` indefinitely and the user would see a progress bar that never moves. Every attempt
 * is capped, so a slow judge degrades into a failed judgement that Resume can re-score.
 * Reasoning judges think before answering, so the cap is generous but finite.
 */
const JUDGE_TIMEOUT_MS = Math.max(5_000, Number(process.env.JUDGE_TIMEOUT_MS ?? 90_000));

/**
 * Reasoning judges (e.g. deepseek-r1) spend most of their completion budget on hidden reasoning,
 * so a small cap cut the JSON off mid-object and every judgement failed with "could not extract
 * JSON". The judge therefore gets a much larger budget than a normal prompt call.
 */
const JUDGE_MAX_TOKENS = Math.max(512, Number(process.env.JUDGE_MAX_TOKENS ?? 4096));

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
  evaluatorModel: string;
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
  if (start === -1) throw new Error("Could not extract JSON from evaluator response.");
  const end = raw.lastIndexOf("}");
  // A truncated answer (very common with reasoning judges) has no closing brace; keep the tail so
  // the salvor below can still read the fields that did arrive.
  return end > start ? raw.slice(start, end + 1) : raw.slice(start);
}

/**
 * Last-resort extraction for truncated or slightly malformed judge output.
 *
 * A judge that answered `{"overallScore": 95, "pass": true, "summary": "…` has produced a usable
 * verdict; throwing that away turned one truncated token into a "partial failure" run.
 */
function salvageJudgement(text: string): Record<string, unknown> {
  const score = /"overallScore"\s*:\s*(-?\d+(?:\.\d+)?)/.exec(text);
  const pass = /"pass"\s*:\s*(true|false)/.exec(text);
  const summary = /"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text);
  if (!score && !pass) throw new Error("Could not extract JSON from evaluator response.");
  return {
    overallScore: score ? Number(score[1]) : undefined,
    pass: pass ? pass[1] === "true" : undefined,
    summary: summary ? summary[1].replace(/\\"/g, '"').replace(/\\n/g, " ") : null,
    criteriaResults: [],
  };
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
  let parsed: Partial<{
    overallScore: number;
    pass: boolean;
    summary: string | null;
    criteriaResults: Array<Partial<{ criterion: string; score: number; pass: boolean; reason: string | null }>>;
  }>;
  try {
    parsed = safeJsonParse(text);
  } catch {
    parsed = salvageJudgement(text) as typeof parsed;
  }

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

/** Reject when `promise` has not settled within `timeoutMs` (the work itself is left to finish). */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

export async function judgeResult(args: JudgeResultArgs): Promise<JudgementResult> {
  const provider = args.provider ?? getModelProvider();
  let messages = buildMessages(args);
  let rawOutput: string | null = null;
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await withProviderSlot(() => withTimeout(
        provider.execute({ model: args.evaluatorModel, prompt: messages.prompt, input: messages.input, maxTokens: JUDGE_MAX_TOKENS }),
        JUDGE_TIMEOUT_MS,
        `The judge did not answer within ${Math.round(JUDGE_TIMEOUT_MS / 1000)}s.`,
      ));
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
