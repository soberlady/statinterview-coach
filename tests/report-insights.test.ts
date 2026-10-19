import assert from "node:assert/strict";
import test from "node:test";
import { buildReportInsights, criterionFeedback, confirmationReason, compareEvidence, verificationFollowups, type DiagnosticTurn } from "../app/lib/report-insights";
import { getInterviewQuestion, LEGACY_QUESTION_BANK_VERSION, COACHING_QUESTION_BANK_VERSION } from "../app/lib/question-bank";

function turn(overrides: Partial<DiagnosticTurn> = {}): DiagnosticTurn {
  return { id: "t1", sequenceNumber: 1, questionId: "sql_python_001", skill: "sql_python",
    questionText: "如何处理重复记录？", answerText: "我会直接删除重复行。", reliability: "HIGH",
    evaluation: { evaluator: "RUBRIC_DOUBLE_PASS", action: "ACCEPT", gaps: ["待补充：说明业务主键"],
      semantic: { criteria: [{ criterion: "说明业务主键", score: 1, evidence: ["直接删除重复行"] }] } }, ...overrides };
}

test("training priority follows the executable recommendation and its topic", () => {
  const result = buildReportInsights([
    turn({ topic: "数据质量" }),
    turn({ id: "retention", topic: "留存口径", sequenceNumber: 2 }),
    turn({ id: "business", skill: "business_analysis" }),
  ], { sql_python: .1, business_analysis: .8 }, { focusSkill: "sql_python", topic: "留存口径", reason: "先练留存" });
  assert.equal(result[0].skill, "sql_python");
  assert.equal(result[0].focusTopic, "留存口径");
  // Duplicate criterion wording in another topic must not hide target evidence.
  assert.equal(result[0].observations[0].turn.id, "retention");
});

test("verification links only later accepted followups of the exact source", () => {
  const parent = turn({ reliability: "LOW" });
  const followup = turn({ id: "followup", sequenceNumber: 2, questionType: "verification", questionId: "sql_python_001__verify_v3_0" });
  assert.deepEqual(verificationFollowups(parent, [parent, followup,
    { ...followup, id: "other", questionId: "sql_python_002__verify_v3_0" },
    { ...followup, id: "unreliable", reliability: "LOW" },
    { ...followup, id: "before", sequenceNumber: 0 },
  ]).map(item => item.id), ["followup"]);
  assert.equal(criterionFeedback(parent)[0].state, "uncertain");
  assert.deepEqual(verificationFollowups(turn({ questionId: null }), [followup]), []);
});

for (const version of [LEGACY_QUESTION_BANK_VERSION, COACHING_QUESTION_BANK_VERSION] as const) {
  for (const roleAnchor of [false, true]) {
    test(`followup source association preserves ${version} / ${roleAnchor ? "JD baseline" : "ordinary question"}`, () => {
      const parentId = `sql_python_001${roleAnchor ? "__role_anchor" : ""}`;
      const followupId = `sql_python_001__verify_${version === LEGACY_QUESTION_BANK_VERSION ? "0" : "v3_0"}`;
      const parentQuestion = getInterviewQuestion(parentId, version);
      const followupQuestion = getInterviewQuestion(followupId, version);
      assert.ok(parentQuestion);
      assert.ok(followupQuestion);
      assert.equal(parentQuestion.sourceQuestionId, followupQuestion.sourceQuestionId);
      const parent = turn({ questionId: parentId, reliability: "LOW", sequenceNumber: 3 });
      const followup = turn({ id: "accepted-followup", questionId: followupId, questionType: "verification", sequenceNumber: 4 });
      const candidates = [parent, followup,
        { ...followup, id: "different-source", questionId: "sql_python_002__verify_0" },
        { ...followup, id: "before-parent", sequenceNumber: 2 },
        { ...followup, id: "unreliable", reliability: "LOW" },
      ];
      assert.deepEqual(verificationFollowups(parent, candidates).map(item => item.id), ["accepted-followup"]);
      assert.equal(criterionFeedback(parent)[0].state, "uncertain");
      assert.deepEqual(verificationFollowups(followup, candidates), []);
    });
  }
}

test("verification flags alone cannot link a main question or malformed followup ID", () => {
  const parent = turn();
  const candidate = turn({ id: "malformed", sequenceNumber: 2, questionType: "verification" });
  assert.deepEqual(verificationFollowups(parent, [candidate,
    { ...candidate, questionId: "sql_python_001__verify_v3_0junk" },
  ]), []);
});

test("uncertain, untested and observed gaps remain distinct", () => {
  const result = buildReportInsights([turn(), turn({ id: "t2", skill: "statistics_ml", reliability: "LOW" })]);
  assert.equal(result.find(s => s.skill === "sql_python")?.status, "practice");
  assert.equal(result.find(s => s.skill === "statistics_ml")?.status, "uncertain");
  assert.equal(result.find(s => s.skill === "experiment_causal")?.status, "uncovered");
  assert.equal(result.find(s => s.skill === "statistics_ml")?.observations.length, 0);
});

test("an unreliable final answer does not erase earlier reliable observations", () => {
  const result = buildReportInsights([turn(), turn({ id: "t2", sequenceNumber: 2, reliability: "LOW" })]);
  const sql = result.find(s => s.skill === "sql_python")!;
  assert.equal(sql.accepted.length, 1);
  assert.equal(sql.confidence, "初步观察");
  assert.equal(sql.observations[0].turn.id, "t1");
});

test("follow-ups to one question cannot count as independent multi-question support", () => {
  const result = buildReportInsights([turn(), turn({ id: "t2", questionId: "sql_python_001__verify_v3_0" })]);
  assert.equal(result.find(s => s.skill === "sql_python")?.confidence, "初步观察");
  const independent = buildReportInsights([turn(), turn({ id: "t3", questionId: "sql_python_002" })]);
  assert.equal(independent.find(s => s.skill === "sql_python")?.confidence, "多题支持");
});

test("quotes are tied to the missing criterion and must occur in the original answer", () => {
  assert.equal(buildReportInsights([turn()])[0].observations[0].quote, "直接删除重复行");
  const changed = turn();
  changed.evaluation.semantic!.criteria![0].evidence = ["不存在于原回答中的改写"];
  assert.equal(buildReportInsights([changed])[0].observations[0].quote, null);
});

test("job relevance prioritizes actionable gaps without accepting demo or heuristic scores", () => {
  const results = buildReportInsights([turn(), turn({ id: "t2", skill: "statistics_ml" })], { sql_python: .1, statistics_ml: .6 });
  assert.equal(results[0].skill, "statistics_ml");
  for (const evaluator of ["STRUCTURE_HEURISTIC", "DEMO_FIXTURE"]) {
    const input = turn(); input.evaluation.evaluator = evaluator;
    assert.equal(buildReportInsights([input]).find(s => s.skill === "sql_python")?.accepted.length, 0);
  }
});

test("blank and unfinished answers never become diagnoses", () => {
  for (const input of [turn({ answerText: "  " }), turn({ status: "pending" })]) {
    assert.ok(buildReportInsights([input]).every(s => !s.accepted.length && s.status === "uncovered"));
  }
});

test("partial evidence is visible, while wrong or unsupported quotes are not strengths", () => {
  const input = turn();
  input.evaluation.semantic!.criteria![0].score = 2;
  assert.equal(criterionFeedback(input)[0].label, "部分体现");
  assert.match(buildReportInsights([input])[0].goal, /^部分体现/);
  input.evaluation.semantic!.criteria![0].score = 0;
  assert.equal(criterionFeedback(input)[0].state, "revisit");
  input.evaluation.semantic!.criteria![0].score = 4;
  input.evaluation.semantic!.criteria![0].evidence = ["捏造原话"];
  assert.equal(criterionFeedback(input)[0].state, "uncertain");
  assert.equal(criterionFeedback(input)[0].quote, null);
  input.reliability = "LOW";
  input.evaluation.semantic!.criteria![0].evidence = ["直接删除重复行"];
  assert.equal(criterionFeedback(input)[0].state, "uncertain");
});

test("pending reasons distinguish transcript problems, scorer fallback and reviewer disagreement", () => {
  const input = turn({ reliability: "LOW" });
  input.evaluation.gaps = ["语音转写置信度较低，需要通过追问验证核心结论"];
  assert.equal(confirmationReason(input)?.code, "transcript");
  input.evaluation.gaps = [];
  input.evaluation.evaluator = "STRUCTURE_HEURISTIC";
  assert.equal(confirmationReason(input)?.code, "scorer");
  input.evaluation.evaluator = "RUBRIC_DOUBLE_PASS";
  input.evaluation.signals = { reviewDisagreement: .9 };
  assert.equal(confirmationReason(input)?.code, "disagreement");
  input.evaluation.signals = {};
  assert.equal(confirmationReason(input)?.code, "evidence");
  assert.equal(confirmationReason(turn()), null);
});

test("transfer compares exact criteria only, excludes unreliable baselines and preserves conflicts", () => {
  const before = turn();
  const after = turn({ id: "new", questionId: "sql_python_999" });
  after.evaluation = { ...after.evaluation, semantic: { criteria: [
    { criterion: "说明业务主键", score: 3, evidence: ["直接删除重复行"] },
    { criterion: "其他要求", score: 2, evidence: ["直接删除重复行"] },
  ] } };
  const result = compareEvidence([before], after);
  assert.equal(result[0].before, "尚未充分体现");
  assert.equal(result[0].after, "已体现");
  assert.match(result[1].before, /暂不比较/);
  assert.match(compareEvidence([turn({ reliability: "LOW" })], after)[0].before, /暂不比较/);
  assert.match(compareEvidence([before, after], after)[0].before, /不一致/);
  assert.equal(compareEvidence([before], { ...after, reliability: "LOW" })[0].after, "无法判断");
  assert.deepEqual(compareEvidence([before]), []);
});
