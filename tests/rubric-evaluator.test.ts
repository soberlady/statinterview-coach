import assert from "node:assert/strict";
import test from "node:test";
import { combineRubricPasses } from "../app/lib/rubric-evaluator";
import type { InterviewQuestion } from "../app/lib/question-bank";

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
  });

  assert.equal(evaluation.evaluator, "RUBRIC_DOUBLE_PASS");
  assert.equal(evaluation.scoreOutOfFour, 3.75);
  assert.equal(evaluation.reliability, "MEDIUM");
  assert.ok(
    !evaluation.evidence.includes("回答里不存在的句子"),
  );
  assert.equal(evaluation.signals.evidenceCoverage, 1);
  assert.equal(evaluation.telemetry?.inputTokens, 200);
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
