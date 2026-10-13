import assert from "node:assert/strict";
import test from "node:test";
import { buildReportInsights, type DiagnosticTurn } from "../app/lib/report-insights";

function turn(overrides: Partial<DiagnosticTurn> = {}): DiagnosticTurn {
  return { id: "t1", sequenceNumber: 1, questionId: "sql_python_001", skill: "sql_python",
    questionText: "如何处理重复记录？", answerText: "我会直接删除重复行。", reliability: "HIGH",
    evaluation: { evaluator: "RUBRIC_DOUBLE_PASS", action: "ACCEPT", gaps: ["待补充：说明业务主键"],
      semantic: { criteria: [{ criterion: "说明业务主键", score: 1, evidence: ["直接删除重复行"] }] } }, ...overrides };
}

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
