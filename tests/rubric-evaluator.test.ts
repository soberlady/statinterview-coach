import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRubricMessages,
  buildRubricRequestBody,
  combineRubricPasses,
  guardEvaluationForTranscriptConfidence,
  scorerFailureTelemetry,
  selectScorerApiKey,
} from "../app/lib/rubric-evaluator";
import {
  evaluateAnswer,
  updateAbility,
} from "../app/lib/agent-policy";
import {
  getInterviewQuestion,
  type InterviewQuestion,
} from "../app/lib/question-bank";
import type { SkillState } from "../db/schema";

const question: InterviewQuestion = {
  id: "statistics_ml_test",
  sourceQuestionId: "statistics_ml_test",
  skill: "statistics_ml",
  difficulty: 3,
  jobTags: ["统计"],
  question: "如何判断模型是否过拟合？",
  expectedSeconds: 120,
  isAnchor: false,
  questionType: "adaptive",
  rubric: [
    {
      criterion: "比较训练集与验证集表现",
      weight: 0.6,
    },
    {
      criterion: "提出交叉验证或学习曲线",
      weight: 0.4,
    },
  ],
  verificationQuestions: ["你会怎样画学习曲线？"],
};

test("gpt-5-mini request omits unsupported sampling parameters", () => {
  const body = buildRubricRequestBody({
    model: "gpt-5-mini",
    reviewer: false,
    question: question.question,
    criteria: question.rubric.map((criterion, criterionIndex) => ({
      criterionIndex,
      description: criterion.criterion,
      weight: criterion.weight,
    })),
    candidateAnswer: "我会比较训练集和验证集。",
  });

  assert.equal(body.model, "gpt-5-mini");
  assert.ok(!("temperature" in body));
  assert.ok(!("top_p" in body));
  assert.equal(body.response_format.type, "json_object");
  assert.ok(!("thinking" in body));
});

test("deepseek scoring uses low-latency non-thinking JSON mode", () => {
  const body = buildRubricRequestBody({
    model: "deepseek-v4-flash",
    reviewer: true,
    question: question.question,
    criteria: question.rubric.map((criterion, criterionIndex) => ({
      criterionIndex,
      description: criterion.criterion,
      weight: criterion.weight,
    })),
    candidateAnswer: "我会比较训练集和验证集。",
  });

  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.equal(body.response_format.type, "json_object");
  assert.ok(!("temperature" in body));
});

test("provider-specific scorer keys cannot cross providers", () => {
  const runtime = {
    STATINTERVIEW_SCORER_API_KEY: "openai-secret",
    STATINTERVIEW_DEEPSEEK_API_KEY: "deepseek-secret",
  };

  assert.equal(selectScorerApiKey("gpt-5-mini", runtime), "openai-secret");
  assert.equal(
    selectScorerApiKey("deepseek-v4-flash", runtime),
    "deepseek-secret",
  );
  assert.equal(
    selectScorerApiKey("deepseek-v4-flash", {
      STATINTERVIEW_SCORER_API_KEY: "openai-secret",
    }),
    undefined,
  );
});

test("scorer failure telemetry excludes messages and request content", () => {
  const telemetry = scorerFailureTelemetry(
    new TypeError("secret prompt and credential must not be logged"),
  );

  assert.deepEqual(telemetry, {
    category: "network",
    status: null,
    errorType: "TypeError",
    errorCode: null,
    requestId: null,
  });
  assert.doesNotMatch(JSON.stringify(telemetry), /secret|credential/);
});

test("transcript hint helps interpretation but cannot become evidence", () => {
  const messages = buildRubricMessages({
    reviewer: false,
    question: "留存率如何解释？",
    criteria: [{ criterionIndex: 0, description: "解释比例", weight: 1 }],
    candidateAnswer: "留存率是30",
    transcriptScoringHint: "留存率是30%",
  });
  const system = messages[0].content;
  const user = JSON.parse(messages[1].content);

  assert.match(system, /不能引用转写理解辅助/);
  assert.match(system, /冲突时，以回答原文为准/);
  assert.match(system, /不得用于补全原文中缺失的否定词/);
  assert.equal(user.candidateAnswer, "留存率是30");
  assert.equal(user.transcriptScoringHint, "留存率是30%");
});

test("low voice transcript confidence forces verification", () => {
  const evaluation = evaluateAnswer(
    question,
    "我会比较训练集与验证集表现，并使用交叉验证和学习曲线判断。",
  );
  const guarded = guardEvaluationForTranscriptConfidence(evaluation, 0.61);

  assert.equal(guarded.reliability, "LOW");
  assert.equal(guarded.action, "VERIFY");
  assert.match(guarded.disclaimer, /不会直接写入能力后验/);
});

test("double-pass rubric keeps only verbatim evidence", () => {
  const answer =
    "我会比较训练集与验证集表现，再使用交叉验证观察稳定性，并检查学习曲线，最后用独立测试集确认结论。";
  const evaluation = combineRubricPasses({
    question,
    answer,
    primary: {
      criteria: [
        {
          criterionIndex: 0,
          score: 4,
          evidence: ["比较训练集与验证集表现"],
          note: "完整",
        },
        {
          criterionIndex: 1,
          score: 4,
          evidence: ["使用交叉验证观察稳定性"],
          note: "完整",
        },
      ],
    },
    review: {
      criteria: [
        {
          criterionIndex: 0,
          score: 3.5,
          evidence: ["比较训练集与验证集表现", "回答里不存在的句子"],
          note: "基本充分",
        },
        {
          criterionIndex: 1,
          score: 3.5,
          evidence: ["检查学习曲线"],
          note: "基本充分",
        },
      ],
    },
    model: "fixture-model",
    latencyMs: 120,
    inputTokens: 200,
    outputTokens: 80,
    promptVersion: "rubric-double-pass-v1",
    questionFingerprint: "question-fixture",
    requestFingerprint: "request-fixture",
  });

  assert.equal(evaluation.evaluator, "RUBRIC_DOUBLE_PASS");
  assert.equal(evaluation.scoreOutOfFour, 3.75);
  assert.equal(evaluation.reliability, "MEDIUM");
  assert.ok(
    !evaluation.evidence.includes("回答里不存在的句子"),
  );
  assert.equal(evaluation.signals.evidenceCoverage, 1);
  assert.equal(evaluation.telemetry?.inputTokens, 200);
  assert.equal(
    evaluation.semantic?.promptVersion,
    "rubric-double-pass-v1",
  );
  assert.equal(evaluation.semantic?.passes?.primary.length, 2);
  assert.equal(evaluation.semantic?.passes?.review.length, 2);
});

test("large reviewer disagreement blocks ability updates", () => {
  const answer =
    "我会比较训练集与验证集表现，再使用交叉验证观察稳定性，并检查学习曲线。";
  const evaluation = combineRubricPasses({
    question,
    answer,
    primary: {
      criteria: [
        {
          criterionIndex: 0,
          score: 4,
          evidence: ["比较训练集与验证集表现"],
          note: "充分",
        },
        {
          criterionIndex: 1,
          score: 4,
          evidence: ["使用交叉验证观察稳定性"],
          note: "充分",
        },
      ],
    },
    review: {
      criteria: [
        {
          criterionIndex: 0,
          score: 0,
          evidence: [],
          note: "无证据",
        },
        {
          criterionIndex: 1,
          score: 0,
          evidence: [],
          note: "无证据",
        },
      ],
    },
    model: "fixture-model",
    latencyMs: 120,
    inputTokens: null,
    outputTokens: null,
  });

  assert.equal(evaluation.reliability, "LOW");
  assert.equal(evaluation.action, "VERIFY");
  assert.equal(evaluation.signals.reviewDisagreement, 4);
});

test("verification questions use a bounded one-criterion rubric", () => {
  const source = getInterviewQuestion("statistics_ml_002");
  const verification = getInterviewQuestion(
    "statistics_ml_002__verify_0",
  );

  assert.ok(source);
  assert.ok(verification);
  assert.equal(verification.questionType, "verification");
  assert.equal(verification.sourceQuestionId, source.id);
  assert.equal(verification.rubric.length, 1);
  assert.equal(verification.rubric[0].weight, 1);
  assert.match(
    verification.rubric[0].criterion,
    new RegExp(verification.question.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.ok(verification.expectedSeconds <= 90);
});

test("structure-only fallback never changes the ability posterior", () => {
  const evaluation = evaluateAnswer(
    question,
    "首先比较训练集和验证集，再用交叉验证、学习曲线和独立测试集检查过拟合，最后根据偏差与方差定位问题并验证结论。",
  );
  const previous: SkillState = {
    id: "skill_test",
    interviewId: "interview_test",
    skill: question.skill,
    posteriorMean: 0,
    uncertainty: 1,
    posterior: "[]",
    supportingEvidence: "[]",
    commonErrors: "[]",
    sourceTurnCount: 0,
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
  };
  const updated = updateAbility(
    previous,
    question,
    evaluation,
    "turn_test",
  );

  assert.equal(evaluation.evaluator, "STRUCTURE_HEURISTIC");
  assert.equal(evaluation.reliability, "LOW");
  assert.equal(evaluation.action, "ABSTAIN");
  assert.equal(updated.posteriorMean, previous.posteriorMean);
  assert.equal(updated.uncertainty, previous.uncertainty);
  assert.equal(updated.sourceTurnCount, 0);
});
