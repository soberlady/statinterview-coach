import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { evaluateAnswer, selectNextQuestion, updateAbility, SELECTION_POLICY_VERSION, type AnswerEvaluation } from "../app/lib/agent-policy";
import { replayInterviewPolicy } from "../app/lib/decision-audit";
import { SKILL_LABELS, type InterviewQuestion } from "../app/lib/question-bank";
import type { InterviewTurn, SkillState } from "../db/schema";

export function syntheticSession(
  interview: Parameters<typeof selectNextQuestion>[0]["interview"],
  score: number | ((question: InterviewQuestion, index: number) => number),
) {
  let states: SkillState[] = Object.keys(SKILL_LABELS).map(skill => ({ id: skill, interviewId: "probe", skill,
    posteriorMean: 0, uncertainty: 1, posterior: "[]", supportingEvidence: "[]", commonErrors: "[]", sourceTurnCount: 0,
    createdAt: "synthetic", updatedAt: "synthetic" }));
  const turns: InterviewTurn[] = [];
  for (let index = 0; index < 10; index++) {
    const decision = selectNextQuestion({ interview, turns, skillStates: states });
    const question = decision.nextQuestion;
    if (!question) { assert.equal(decision.action, "COMPLETE"); break; }
    const answer = "Synthetic accepted evidence for policy sensitivity only; no model assessment is performed.";
    const value = typeof score === "function" ? score(question, index) : score;
    const evaluation: AnswerEvaluation = { ...evaluateAnswer(question, answer),
      evaluator: "RUBRIC_DOUBLE_PASS", totalScore: value, scoreOutOfFour: value * 4,
      reliability: "HIGH", action: "ACCEPT", evidence: [answer],
      disclaimer: "Synthetic injected score; this does not measure scorer accuracy or learning impact." };
    const previous = states.find(state => state.skill === question.skill)!;
    const update = updateAbility(previous, question, evaluation, `turn_${index}`);
    states = states.map(state => state.id !== previous.id ? state : { ...state, ...update,
      posterior: JSON.stringify(update.posterior), supportingEvidence: JSON.stringify(update.supportingEvidence), commonErrors: JSON.stringify(update.commonErrors) });
    turns.push({ id: `turn_${index}`, interviewId: "probe", sequenceNumber: index + 1, questionId: question.id,
      questionText: question.question, questionType: question.questionType, skill: question.skill, answerText: answer,
      scoringAnswerText: null, inputMode: "text", status: "completed", transcriptConfidence: null,
      evidence: JSON.stringify(evaluation.evidence), evaluation: JSON.stringify(evaluation), reliability: evaluation.reliability,
      startedAt: "synthetic", completedAt: "synthetic", createdAt: "synthetic", updatedAt: "synthetic" });
  }
  const audit = replayInterviewPolicy({ interview: { id: "probe", ...interview }, turns });
  assert.ok(Object.values(audit.invariants).every(Boolean));
  return { turns, states, audit };
}

export function buildCoachingBenchmark() {
  const profiles = { balanced: "统计 实验 SQL 业务", sql: "SQL Python 数据处理 ETL 数仓 工程",
    experiment: "实验 a/b 因果 策略 增长", business: "业务 指标 分析 运营 产品 商业" };
  const cases = Object.entries(profiles).flatMap(([profile, jobDescription]) => [0, 0.5, 1].map(score => {
    const session = syntheticSession({ jobDescription, candidateBackground: "有课程和项目经验", durationMinutes: 20, verificationCount: 0 }, score);
    return { profile, injectedScore: score, questionIds: session.turns.map(turn => turn.questionId),
      phases: session.audit.steps.map(step => step.context?.selectionPhase),
      adaptiveDifficulties: session.audit.steps.filter(step => step.context?.selectionPhase === "posterior_adaptive").map(step => step.ranking[0]?.difficulty),
      acceptedEvidence: session.states.reduce((sum, state) => sum + state.sourceTurnCount, 0),
      replayMatches: session.audit.summary.matchingSelections };
  }));
  return { version: "coaching-sensitivity-v1", policyVersion: SELECTION_POLICY_VERSION, synthetic: true,
    boundary: "12 deterministic injected-score scenarios validate sensitivity, budgets and replay only. They do not estimate model accuracy, calibrated ability or learning improvement. The older 3.83% result belongs to the frozen v2 simulation.",
    cases, profilesWithDifferentLowHighRoutes: Object.keys(profiles).filter(profile => {
      const low = cases.find(item => item.profile === profile && item.injectedScore === 0)!;
      const high = cases.find(item => item.profile === profile && item.injectedScore === 1)!;
      return JSON.stringify(low.questionIds) !== JSON.stringify(high.questionIds);
    }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = JSON.stringify(buildCoachingBenchmark(), null, 2) + "\n";
  const file = new URL("../content/coaching-benchmark.json", import.meta.url);
  if (process.argv.includes("--check")) assert.equal(await readFile(file, "utf8"), output);
  else await writeFile(file, output);
  console.log("Coaching sensitivity: 12 synthetic scenarios; budgets and deterministic replay verified.");
}
