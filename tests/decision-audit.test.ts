import assert from "node:assert/strict";
import test from "node:test";
import type {
  Interview,
  InterviewTurn,
  SkillState,
} from "../db/schema";
import {
  evaluateAnswer,
  selectNextQuestion,
  updateAbility,
  type AnswerEvaluation,
} from "../app/lib/agent-policy";
import {
  fingerprintPolicyAudit,
  replayInterviewPolicy,
} from "../app/lib/decision-audit";
import {
  getInterviewQuestion,
  listQuestions,
  SKILL_LABELS,
  type SkillKey,
} from "../app/lib/question-bank";

const richAnswer =
  "首先我会确认业务指标、统计口径、样本和基线，再检查随机分流、A/A、显著性、置信区间、样本量和护栏指标。其次使用 SQL 窗口函数、分区、索引、主键和执行计划完成数据处理，并用 Python 分批校验、去重和抽样。然后按渠道、地区、版本和用户分群拆解漏斗，提出可以证伪的假设，对比测试集、交叉验证、准确率、召回率、F1、AUC、偏差和方差。最后检查数据质量、季节性与异常值；如果结果不稳定，就回到假设和数据口径，排除混杂并重新验证。";

test("candidate background cannot change scoring or ability updates", () => {
  const question = getInterviewQuestion("sql_python_002");
  assert.ok(question);
  const backgrounds = [
    "零基础转行，刚开始学习 SQL。",
    "资深数据工程师，精通 SQL 并有五年经验。",
  ];
  const evaluations = backgrounds.map(() =>
    acceptedSemanticEvaluation(question, richAnswer),
  );
  assert.deepEqual(evaluations[0], evaluations[1]);

  const now = "2026-07-30T00:00:00.000Z";
  const prior = createInitialStates("int_background_isolation", now).find(
    (state) => state.skill === question.skill,
  );
  assert.ok(prior);
  const updates = evaluations.map((evaluation, index) =>
    updateAbility(
      prior,
      question,
      evaluation,
      `turn_background_${index}`,
    ),
  );
  assert.equal(updates[0].posteriorMean, updates[1].posteriorMean);
  assert.equal(updates[0].uncertainty, updates[1].uncertainty);
  assert.deepEqual(updates[0].posterior, updates[1].posterior);
  assert.equal(updates[0].sourceTurnCount, updates[1].sourceTurnCount);
});

test("candidate background is reduced to bounded routing for JD baselines", () => {
  const session = buildCompleteSession();
  const states = createInitialStates(
    session.interview.id,
    "2026-07-30T00:00:00.000Z",
  );
  const selectForBackground = (candidateBackground: string) =>
    selectNextQuestion({
      interview: {
        jobDescription:
          "负责 SQL、Python、数据工程、ETL 与数仓建设",
        candidateBackground,
        durationMinutes: 20,
        verificationCount: 0,
      },
      turns: session.turns.slice(0, 2),
      skillStates: states,
    });

  const beginner = selectForBackground(
    "零基础转行，刚开始学习 SQL。",
  );
  const advanced = selectForBackground(
    "资深数据工程师，精通 SQL 并有五年经验。",
  );
  assert.equal(beginner.context?.selectionPhase, "jd_directed_baseline");
  assert.equal(beginner.context?.candidateRouting.experienceBand, "beginner");
  assert.equal(beginner.context?.candidateRouting.preferredDifficulty, 2);
  assert.equal(advanced.context?.candidateRouting.experienceBand, "advanced");
  assert.equal(advanced.context?.candidateRouting.preferredDifficulty, 4);
  assert.equal(beginner.nextQuestion?.difficulty, 2);
  assert.equal(advanced.nextQuestion?.difficulty, 4);
});

test("policy audit deterministically replays a complete interview", async () => {
  const session = buildCompleteSession();
  const audit = replayInterviewPolicy(session);

  assert.equal(audit.summary.replayedTurns, 7);
  assert.equal(audit.summary.matchingSelections, 7);
  assert.equal(audit.summary.adaptiveDecisions, 3);
  assert.equal(audit.invariants.sequenceContinuous, true);
  assert.equal(audit.invariants.allQuestionsApproved, true);
  assert.equal(audit.invariants.allEvaluationsReplayable, true);
  assert.equal(audit.invariants.deterministicSelection, true);
  assert.equal(audit.invariants.reachesTerminalPolicyState, true);
  assert.equal(audit.finalDecision.action, "COMPLETE");
  assert.deepEqual(
    audit.steps.slice(0, 2).map((step) => step.actualQuestionId),
    ["statistics_ml_002", "business_analytics_002"],
  );
  assert.deepEqual(
    audit.steps.map((step) => step.context?.selectionPhase),
    [
      "public_anchor",
      "public_anchor",
      "jd_directed_baseline",
      "jd_directed_baseline",
      "posterior_adaptive",
      "posterior_adaptive",
      "posterior_adaptive",
    ],
  );
  assert.ok(
    audit.steps
      .slice(2, 4)
      .every((step) => step.actualQuestionId?.endsWith("__role_anchor")),
  );

  const adaptiveSteps = audit.steps.filter(
    (step) => step.questionType === "adaptive",
  );
  assert.equal(adaptiveSteps.length, 3);
  for (const step of adaptiveSteps) {
    assert.ok(step.ranking.length >= 2);
    assert.equal(step.ranking[0].questionId, step.actualQuestionId);
    assert.ok(
      step.ranking[0].utility >= step.ranking[1].utility,
      "candidate ranking must be sorted by utility",
    );
  }

  const firstFingerprint = await fingerprintPolicyAudit(audit);
  const secondFingerprint = await fingerprintPolicyAudit(audit);
  assert.match(firstFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(firstFingerprint, secondFingerprint);
});

test("policy audit flags an approved but counterfactual question", async () => {
  const session = buildCompleteSession();
  const originalAudit = replayInterviewPolicy(session);
  const askedIds = new Set(
    session.turns
      .map((turn) => turn.questionId)
      .filter((value): value is string => value !== null),
  );
  const replacementSource = listQuestions().find(
    (question) => !question.isAnchor && !askedIds.has(question.id),
  );
  assert.ok(replacementSource);
  const replacement = getInterviewQuestion(replacementSource.id);
  assert.ok(replacement);

  const tamperedTurns = session.turns.map((turn, index) => {
    if (index !== 4) return turn;
    const evaluation = acceptedSemanticEvaluation(replacement, richAnswer);
    return {
      ...turn,
      questionId: replacement.id,
      questionText: replacement.question,
      skill: replacement.skill,
      questionType: replacement.questionType,
      evaluation: JSON.stringify(evaluation),
      evidence: JSON.stringify(evaluation.evidence),
      reliability: evaluation.reliability,
    };
  });
  const tamperedAudit = replayInterviewPolicy({
    interview: session.interview,
    turns: tamperedTurns,
  });

  assert.equal(tamperedAudit.invariants.allQuestionsApproved, true);
  assert.equal(tamperedAudit.invariants.deterministicSelection, false);
  assert.equal(tamperedAudit.steps[4].matchesPolicy, false);
  assert.notEqual(
    await fingerprintPolicyAudit(originalAudit),
    await fingerprintPolicyAudit(tamperedAudit),
  );
});

function buildCompleteSession(): {
  interview: Interview;
  turns: InterviewTurn[];
} {
  const now = "2026-07-30T00:00:00.000Z";
  const interview: Interview = {
    id: "int_policy_audit",
    jobTitle: "数据分析实习生",
    jobDescription:
      "负责 SQL、Python、A/B 实验、业务指标分析与统计建模。",
    candidateBackground: "",
    durationMinutes: 15,
    cameraEnabled: false,
    recordingEnabled: false,
    mode: "diagnostic",
    status: "CREATED",
    currentStage: "CREATED",
    currentQuestionId: null,
    checkpoint: "{}",
    checkpointVersion: 0,
    turnCount: 0,
    verificationCount: 0,
    startedAt: null,
    completedAt: null,
    lastCheckpointAt: null,
    createdAt: now,
    updatedAt: now,
  };
  let states = createInitialStates(interview.id, now);
  const turns: InterviewTurn[] = [];
  let verificationCount = 0;

  for (let sequenceNumber = 1; sequenceNumber <= 7; sequenceNumber += 1) {
    const decision = selectNextQuestion({
      interview: {
        jobDescription: interview.jobDescription,
        candidateBackground: interview.candidateBackground,
        durationMinutes: interview.durationMinutes,
        verificationCount,
      },
      turns,
      skillStates: states,
    });
    const question = decision.nextQuestion;
    assert.ok(question, `question ${sequenceNumber} should exist`);
    const evaluation = acceptedSemanticEvaluation(question, richAnswer);
    assert.equal(evaluation.action, "ACCEPT");
    const turnId = `turn_${sequenceNumber}`;
    const turn: InterviewTurn = {
      id: turnId,
      interviewId: interview.id,
      sequenceNumber,
      questionId: question.id,
      questionText: question.question,
      skill: question.skill,
      questionType: question.questionType,
      answerText: richAnswer,
      inputMode: "text",
      status: "completed",
      transcriptConfidence: null,
      evidence: JSON.stringify(evaluation.evidence),
      evaluation: JSON.stringify(evaluation),
      reliability: evaluation.reliability,
      startedAt: now,
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    const previous = states.find(
      (state) => state.skill === question.skill,
    );
    assert.ok(previous);
    const updated = updateAbility(
      previous,
      question,
      evaluation,
      turnId,
    );
    states = states.map((state) =>
      state.id === previous.id
        ? {
            ...state,
            posteriorMean: updated.posteriorMean,
            uncertainty: updated.uncertainty,
            posterior: JSON.stringify(updated.posterior),
            supportingEvidence: JSON.stringify(
              updated.supportingEvidence,
            ),
            commonErrors: JSON.stringify(updated.commonErrors),
            sourceTurnCount: updated.sourceTurnCount,
          }
        : state,
    );
    turns.push(turn);
    if (question.questionType === "verification") {
      verificationCount += 1;
    }
  }

  return { interview, turns };
}

function acceptedSemanticEvaluation(
  question: NonNullable<ReturnType<typeof getInterviewQuestion>>,
  answer: string,
): AnswerEvaluation {
  const structure = evaluateAnswer(question, answer);
  return {
    ...structure,
    evaluator: "RUBRIC_DOUBLE_PASS",
    totalScore: 0.8,
    scoreOutOfFour: 3.2,
    reliability: "HIGH",
    action: "ACCEPT",
    signals: {
      ...structure.signals,
      evidenceCoverage: 1,
      reviewDisagreement: 0.2,
    },
    semantic: {
      model: "deterministic-test-scorer",
      criteria: question.rubric.map((criterion) => ({
        criterion: criterion.criterion,
        score: 3.2,
        evidence: structure.evidence.slice(0, 1),
      })),
      primaryScore: 3.3,
      reviewScore: 3.1,
    },
    disclaimer: "Deterministic semantic-scoring fixture for policy tests.",
  };
}

function createInitialStates(
  interviewId: string,
  now: string,
): SkillState[] {
  return (Object.keys(SKILL_LABELS) as SkillKey[]).map((skill) => ({
    id: `skill_${skill}`,
    interviewId,
    skill,
    posteriorMean: 0,
    uncertainty: 1,
    posterior: "[]",
    supportingEvidence: "[]",
    commonErrors: "[]",
    sourceTurnCount: 0,
    createdAt: now,
    updatedAt: now,
  }));
}
