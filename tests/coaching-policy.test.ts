import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { inferExperienceBand } from "../app/lib/candidate-routing";
import { selectNextQuestion, inferJobWeights, updateAbility } from "../app/lib/agent-policy";
import { selectNextQuestion as legacy } from "../app/lib/agent-policy-v2";
import { getInterviewQuestion, listQuestions } from "../app/lib/question-bank";
import { combineRubricPasses } from "../app/lib/rubric-evaluator";
import { createTrainingPlan, publicTrainingContext, readPolicyConfig, targetQuestionCount } from "../app/lib/practice-plan";
import { buildCoachingBenchmark, syntheticSession } from "../experiments/run_coaching_benchmark";

const interview = { jobDescription: "SQL Python 数据处理 ETL 数仓 工程", candidateBackground: "有课程和项目经验", durationMinutes: 20, verificationCount: 0 };

function evaluation(id: string, answer: string, score: number, hasEvidence = true) {
  const question = getInterviewQuestion(id)!;
  const pass = { criteria: question.rubric.map((_, criterionIndex) => ({ criterionIndex, score,
    evidence: hasEvidence ? [answer] : [], note: "synthetic scoring-rule regression" })) };
  return combineRubricPasses({ question, answer, primary: pass, review: structuredClone(pass), model: "fixture",
    latencyMs: 0, inputTokens: null, outputTokens: null });
}

test("clear wrong evidence is accepted at zero and lowers ability", () => {
  const result = evaluation("statistics_ml_002", "增加样本量一定使标准误变大，区间变宽。", 0);
  assert.equal(result.action, "ACCEPT");
  assert.equal(result.totalScore, 0);
  const prior = syntheticSession(interview, 0.5).states[0];
  const update = updateAbility(prior, getInterviewQuestion("statistics_ml_002")!, result, "wrong");
  assert.ok(update.posteriorMean < prior.posteriorMean);
});

test("short correct follow-up is accepted while unsupported scores require verification", () => {
  const id = "statistics_ml_002__verify_v3_0";
  assert.equal(evaluation(id, "其他条件相同时，样本量四倍，标准误减半。", 4).action, "ACCEPT");
  assert.equal(evaluation(id, "不知道", 4, false).action, "VERIFY");
  assert.equal(evaluation(id, "", 4).action, "VERIFY");
});

test("negated and mixed experience cannot create an advanced route", () => {
  assert.equal(inferExperienceBand("没有三年工作经验"), "intermediate");
  assert.equal(inferExperienceBand("不精通 SQL，仅初学 Python"), "beginner");
  assert.equal(inferExperienceBand("博士，刚入门数据分析"), "beginner");
  assert.equal(inferExperienceBand("有五年数据分析经验，精通 SQL"), "advanced");
});

test("verification targets the missing confidence-interval interpretation", () => {
  const fixture = syntheticSession(interview, 0.5);
  const question = getInterviewQuestion("statistics_ml_002")!;
  const first = { ...fixture.turns[0], evaluation: JSON.stringify({ action: "VERIFY", semantic: {
    criteria: question.rubric.map((item, index) => ({ criterion: item.criterion, score: index === 0 ? 0 : 4, evidence: index === 0 ? [] : ["evidence"] })) } }) };
  const decision = selectNextQuestion({ interview, turns: [first], skillStates: fixture.states });
  assert.equal(decision.nextQuestion?.id, "statistics_ml_002__verify_v3_2");
  assert.match(decision.nextQuestion?.rubric[0].criterion ?? "", /长期覆盖率/);
});

test("training preserves exclusions, ends after three main questions and replays", () => {
  const source = syntheticSession(interview, 0.2);
  const plan = createTrainingPlan({ sourceInterviewId: "source", turns: source.turns, states: source.states, jobWeights: inferJobWeights(interview.jobDescription) });
  assert.ok(plan);
  assert.equal(plan.kind, "gap");
  assert.ok(plan.questionIds.every(id => !plan.seenQuestionIds.includes(id)));
  const transfer = getInterviewQuestion(plan.questionIds[2])!;
  assert.ok(plan.seenQuestionIds.every(id => getInterviewQuestion(id)?.family !== transfer.family));
  assert.ok(plan.questionIds.slice(0, 2).every(id => getInterviewQuestion(id)?.family !== transfer.family));
  const training = { ...interview, mode: "training", policyConfig: JSON.stringify({ version: "coaching-v3", trainingPlan: plan }) };
  assert.equal(targetQuestionCount(training), 3);
  const run = syntheticSession(training, 0.8);
  assert.deepEqual(run.turns.map(turn => turn.questionId), plan.questionIds);
  assert.deepEqual(run.audit.steps.map(step => step.context?.selectionPhase), ["targeted_practice", "targeted_practice", "transfer_check"]);
  assert.equal(run.audit.summary.adaptiveDecisions, 0);
  assert.equal(publicTrainingContext(training, run.turns.slice(0, 1))?.stage, "practice");
  assert.deepEqual(publicTrainingContext(training, run.turns.slice(0, 2))?.learningPoints, []);
  assert.equal(publicTrainingContext(training, run.turns.slice(0, 2), `${plan.questionIds[1]}__verify_v3_0`)?.stage, "practice");
  assert.equal(publicTrainingContext(training, run.turns.slice(0, 2), plan.questionIds[2])?.stage, "transfer");
  assert.deepEqual(readPolicyConfig(training.policyConfig)?.trainingPlan, plan);
});

test("missing evidence is not called a demonstrated weakness", () => {
  const source = syntheticSession(interview, 0.8);
  const turns = source.turns.map(turn => ({ ...turn, evaluation: JSON.stringify({ evaluator: "STRUCTURE_HEURISTIC", action: "ABSTAIN", totalScore: 0 }) }));
  const plan = createTrainingPlan({ sourceInterviewId: "missing", turns, states: [], jobWeights: inferJobWeights(interview.jobDescription) });
  assert.ok(plan);
  assert.equal(plan.kind, "insufficient_evidence");
});

test("no plan can reuse a seen transfer question or unsupported policy version", () => {
  assert.throws(() => readPolicyConfig('{"version":"unknown"}'));
  const source = syntheticSession(interview, 0.2);
  const plan = createTrainingPlan({ sourceInterviewId: "source", turns: source.turns, states: source.states, jobWeights: inferJobWeights(interview.jobDescription) })!;
  assert.throws(() => readPolicyConfig(JSON.stringify({ version: "coaching-v3", trainingPlan: { ...plan, seenQuestionIds: [...plan.seenQuestionIds, plan.questionIds[2]] } })));
});

test("old persisted sessions use frozen v2 and never select newly authored questions", () => {
  const old = { ...interview, policyConfig: "{}" };
  const source = syntheticSession(old, 0.8);
  assert.ok(source.turns.every(turn => Number(getInterviewQuestion(turn.questionId!)!.sourceQuestionId.split("_").at(-1)) <= 6));
  assert.deepEqual(selectNextQuestion({ interview: old, turns: [], skillStates: [] }), legacy({ interview: old, turns: [], skillStates: [] }));
});

test("authored bank has independent follow-up rubrics and deployable topic coverage", () => {
  assert.equal(listQuestions().length, 48);
  for (const question of listQuestions()) {
    assert.ok(question.topic && question.family);
    assert.equal(question.verificationRubrics?.length, question.verificationQuestions.length);
    question.verificationQuestions.forEach((_, index) => assert.ok(getInterviewQuestion(`${question.id}__verify_v3_${index}`)?.rubric.length));
  }
});

test("current sensitivity artifact is reproducible and distinguishes low/high routes", async () => {
  const benchmark = buildCoachingBenchmark();
  assert.ok(benchmark.profilesWithDifferentLowHighRoutes.includes("balanced"));
  assert.ok(benchmark.cases.every(item => item.replayMatches === 7));
  assert.equal(await readFile(new URL("../content/coaching-benchmark.json", import.meta.url), "utf8"), JSON.stringify(benchmark, null, 2) + "\n");
});

test("continued training tries another complete topic without reusing seen questions or transfer families", () => {
  for (const jobDescription of ["统计 实验 SQL 业务", "SQL Python 数据处理 ETL 数仓 工程", "实验 a/b 因果 策略 增长", "业务 指标 分析 运营 产品 商业"]) {
    for (const score of [0, 0.5, 1]) {
      const profile = { ...interview, jobDescription };
      const source = syntheticSession(profile, score);
      const jobWeights = inferJobWeights(jobDescription);
      const first = createTrainingPlan({ sourceInterviewId: "diagnostic", turns: source.turns, states: source.states, jobWeights })!;
      assert.ok(first);
      const training = syntheticSession({ ...profile, mode: "training", policyConfig: JSON.stringify({ version: "coaching-v3", trainingPlan: first }) }, score);
      const second = createTrainingPlan({ sourceInterviewId: "training", turns: training.turns, states: training.states, jobWeights, previousPlan: first });
      assert.ok(second, `${jobDescription}: ${score} should have another eligible topic`);
      assert.ok(second.questionIds.every(id => !second.seenQuestionIds.includes(id)));
      assert.ok(second.questionIds.every(id => getInterviewQuestion(id)?.topic === second.topic));
      const transfer = getInterviewQuestion(second.questionIds[2])!;
      assert.ok([...second.seenQuestionIds, ...second.questionIds.slice(0, 2)].every(id => getInterviewQuestion(id)?.family !== transfer.family));
      if (score < 0.625) assert.match(second.reason, /优先主题暂缺/);
      assert.equal(createTrainingPlan({ sourceInterviewId: "exhausted", turns: training.turns, states: training.states, jobWeights,
        previousPlan: { ...second, seenQuestionIds: listQuestions().map(q => q.id) } }), null);
    }
  }
});
