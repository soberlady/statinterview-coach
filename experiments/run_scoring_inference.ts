import { createHash } from "node:crypto";
import {
  readFile,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import {
  evaluateAnswerStrict,
  RUBRIC_PROMPT_VERSION,
} from "../app/lib/rubric-evaluator";
import { getInterviewQuestion } from "../app/lib/question-bank";

type AnswerRecord = {
  schemaVersion: "scoring-answer-v1";
  answerId: string;
  questionId: string;
  answerText: string;
};

const argumentsByName = parseArguments(process.argv.slice(2));
const answersPath = requiredArgument(argumentsByName, "--answers");
const outputPath = requiredArgument(argumentsByName, "--output");
const runId = requiredArgument(argumentsByName, "--run-id");
const questionBankPath = resolve(
  argumentsByName.get("--question-bank") ??
    "content/question-bank.json",
);
const questionBankBytes = await readFile(questionBankPath);
const questionBankSha256 = createHash("sha256")
  .update(questionBankBytes)
  .digest("hex");
const answers = readJsonl<AnswerRecord>(
  await readFile(resolve(answersPath), "utf8"),
);
const predictions = [];

for (const answer of answers) {
  if (
    answer.schemaVersion !== "scoring-answer-v1" ||
    !answer.answerId ||
    !answer.questionId ||
    !answer.answerText
  ) {
    throw new Error("invalid scoring-answer-v1 record");
  }
  const question = getInterviewQuestion(answer.questionId);
  if (!question) {
    throw new Error(
      `${answer.answerId}: unknown question ${answer.questionId}`,
    );
  }
  const evaluation = await evaluateAnswerStrict(
    question,
    answer.answerText,
  );
  if (
    evaluation.evaluator !== "RUBRIC_DOUBLE_PASS" ||
    !evaluation.semantic?.passes
  ) {
    throw new Error(
      `${answer.answerId}: strict inference produced no semantic passes`,
    );
  }
  predictions.push({
    schemaVersion: "scoring-prediction-v1",
    runId,
    answerId: answer.answerId,
    evaluator: evaluation.evaluator,
    model: evaluation.semantic.model,
    promptVersion:
      evaluation.semantic.promptVersion ?? RUBRIC_PROMPT_VERSION,
    questionBankSha256,
    questionFingerprint: evaluation.semantic.questionFingerprint,
    requestFingerprint: evaluation.semantic.requestFingerprint,
    criteria: evaluation.semantic.criteria.map((criterion, index) => ({
      criterionIndex: index,
      score: criterion.score,
      evidence: criterion.evidence,
    })),
    passes: evaluation.semantic.passes,
    scoreOutOfFour: evaluation.scoreOutOfFour,
    reliability: evaluation.reliability,
    action: evaluation.action,
    telemetry: evaluation.telemetry,
  });
}

await writeFile(
  resolve(outputPath),
  `${predictions.map((record) => JSON.stringify(record)).join("\n")}\n`,
  "utf8",
);
console.log(
  JSON.stringify(
    {
      runId,
      predictionCount: predictions.length,
      evaluator: "RUBRIC_DOUBLE_PASS",
      promptVersion: RUBRIC_PROMPT_VERSION,
      questionBankSha256,
      output: resolve(outputPath),
    },
    null,
    2,
  ),
);

function parseArguments(values: string[]) {
  const result = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || !value) {
      throw new Error(
        "arguments must be provided as --name value pairs",
      );
    }
    result.set(key, value);
  }
  return result;
}

function requiredArgument(
  values: Map<string, string>,
  name: string,
) {
  const value = values.get(name);
  if (!value) throw new Error(`missing required argument ${name}`);
  return value;
}

function readJsonl<T>(value: string): T[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => JSON.parse(line) as T);
}
