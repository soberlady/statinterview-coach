import type {
  Interview,
  InterviewTurn,
  SkillState,
} from "@/db/schema";
import {
  selectNextQuestion,
  updateAbility,
  type AnswerEvaluation,
  type SelectionCandidate,
  type SelectionContext,
} from "./agent-policy";
import {
  getInterviewQuestion,
  SKILL_LABELS,
  type SkillKey,
} from "./question-bank";

export type PolicyAuditStep = {
  sequenceNumber: number;
  actualQuestionId: string | null;
  actualQuestionText: string;
  expectedQuestionId: string | null;
  expectedQuestionText: string | null;
  questionType: string;
  skill: string;
  reliability: string | null;
  action: string;
  reason: string;
  utility: number | null;
  matchesPolicy: boolean;
  evaluationReplayable: boolean;
  stateUpdated: boolean;
  posteriorAfter: {
    mean: number;
    uncertainty: number;
  } | null;
  ranking: SelectionCandidate[];
  context: SelectionContext | null;
};

export type PolicyAudit = {
  version: "policy-audit-v1";
  generatedFrom: "persisted-turns";
  steps: PolicyAuditStep[];
  finalDecision: {
    action: string;
    reason: string;
    nextQuestionId: string | null;
  };
  invariants: {
    sequenceContinuous: boolean;
    allQuestionsApproved: boolean;
    allEvaluationsReplayable: boolean;
    deterministicSelection: boolean;
    reachesTerminalPolicyState: boolean;
  };
  summary: {
    replayedTurns: number;
    matchingSelections: number;
    adaptiveDecisions: number;
    verificationDecisions: number;
    abstentions: number;
  };
};

export function replayInterviewPolicy(input: {
  interview: Pick<
    Interview,
    "id" | "jobDescription" | "durationMinutes"
  >;
  turns: InterviewTurn[];
}): PolicyAudit {
  const completedTurns = [...input.turns]
    .filter(
      (turn) =>
        turn.status === "completed" && turn.answerText.trim().length > 0,
    )
    .sort(
      (left, right) =>
        left.sequenceNumber - right.sequenceNumber ||
        left.id.localeCompare(right.id),
    );
  const replayedTurns: InterviewTurn[] = [];
  let replayedStates = createInitialStates(input.interview.id);
  let verificationCount = 0;
  let allQuestionsApproved = true;
  let allEvaluationsReplayable = true;
  const steps: PolicyAuditStep[] = [];

  for (const turn of completedTurns) {
    const decision = selectNextQuestion({
      interview: {
        jobDescription: input.interview.jobDescription,
        durationMinutes: input.interview.durationMinutes,
        verificationCount,
      },
      turns: replayedTurns,
      skillStates: replayedStates,
    });
    const expectedQuestion = decision.nextQuestion;
    const actualQuestion = turn.questionId
      ? getInterviewQuestion(turn.questionId)
      : undefined;
    const evaluation = parseEvaluation(turn.evaluation);
    const actualState = actualQuestion
      ? replayedStates.find(
          (state) => state.skill === actualQuestion.skill,
        )
      : undefined;
    let posteriorAfter: PolicyAuditStep["posteriorAfter"] = null;
    let stateUpdated = false;

    if (!actualQuestion) {
      allQuestionsApproved = false;
    }
    if (!evaluation) {
      allEvaluationsReplayable = false;
    }

    if (actualQuestion && actualState && evaluation) {
      const updated = updateAbility(
        actualState,
        actualQuestion,
        evaluation,
        turn.id,
      );
      stateUpdated = updated.sourceTurnCount > actualState.sourceTurnCount;
      posteriorAfter = {
        mean: updated.posteriorMean,
        uncertainty: updated.uncertainty,
      };
      replayedStates = replayedStates.map((state) =>
        state.id === actualState.id
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
    }

    steps.push({
      sequenceNumber: turn.sequenceNumber,
      actualQuestionId: turn.questionId,
      actualQuestionText: turn.questionText,
      expectedQuestionId: expectedQuestion?.id ?? null,
      expectedQuestionText: expectedQuestion?.question ?? null,
      questionType: turn.questionType,
      skill: turn.skill,
      reliability: turn.reliability,
      action: decision.action,
      reason: decision.reason,
      utility: decision.utility,
      matchesPolicy:
        Boolean(turn.questionId) &&
        turn.questionId === (expectedQuestion?.id ?? null),
      evaluationReplayable: evaluation !== null,
      stateUpdated,
      posteriorAfter,
      ranking: decision.ranking.slice(0, 3),
      context: decision.context,
    });

    replayedTurns.push(turn);
    if (turn.questionType === "verification") {
      verificationCount += 1;
    }
  }

  const finalDecision = selectNextQuestion({
    interview: {
      jobDescription: input.interview.jobDescription,
      durationMinutes: input.interview.durationMinutes,
      verificationCount,
    },
    turns: replayedTurns,
    skillStates: replayedStates,
  });
  const sequenceContinuous = completedTurns.every(
    (turn, index) => turn.sequenceNumber === index + 1,
  );
  const matchingSelections = steps.filter(
    (step) => step.matchesPolicy,
  ).length;

  return {
    version: "policy-audit-v1",
    generatedFrom: "persisted-turns",
    steps,
    finalDecision: {
      action: finalDecision.action,
      reason: finalDecision.reason,
      nextQuestionId: finalDecision.nextQuestion?.id ?? null,
    },
    invariants: {
      sequenceContinuous,
      allQuestionsApproved,
      allEvaluationsReplayable,
      deterministicSelection:
        steps.length === matchingSelections && sequenceContinuous,
      reachesTerminalPolicyState: finalDecision.action === "COMPLETE",
    },
    summary: {
      replayedTurns: steps.length,
      matchingSelections,
      adaptiveDecisions: steps.filter(
        (step) => step.questionType === "adaptive",
      ).length,
      verificationDecisions: steps.filter(
        (step) => step.action === "VERIFY",
      ).length,
      abstentions:
        steps.filter((step) => step.action === "ABSTAIN").length +
        (finalDecision.action === "ABSTAIN" ? 1 : 0),
    },
  };
}

export async function fingerprintPolicyAudit(
  audit: PolicyAudit,
): Promise<string> {
  const canonicalTrace = {
    version: audit.version,
    steps: audit.steps.map((step) => ({
      sequenceNumber: step.sequenceNumber,
      actualQuestionId: step.actualQuestionId,
      expectedQuestionId: step.expectedQuestionId,
      action: step.action,
      utility: step.utility,
      reliability: step.reliability,
      matchesPolicy: step.matchesPolicy,
      ranking: step.ranking.map((candidate) => ({
        questionId: candidate.questionId,
        utility: candidate.utility,
        signals: candidate.signals,
      })),
    })),
    finalDecision: audit.finalDecision,
    invariants: audit.invariants,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalTrace));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function createInitialStates(interviewId: string): SkillState[] {
  const now = "policy-replay";
  return (Object.keys(SKILL_LABELS) as SkillKey[]).map((skill) => ({
    id: `replay_${skill}`,
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

function parseEvaluation(value: string): AnswerEvaluation | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    const candidate = parsed as Partial<AnswerEvaluation>;
    if (
      (candidate.evaluator !== "STRUCTURE_HEURISTIC" &&
        candidate.evaluator !== "RUBRIC_DOUBLE_PASS" &&
        candidate.evaluator !== "DEMO_FIXTURE") ||
      typeof candidate.totalScore !== "number" ||
      typeof candidate.scoreOutOfFour !== "number" ||
      !["HIGH", "MEDIUM", "LOW"].includes(candidate.reliability ?? "") ||
      !["ACCEPT", "VERIFY", "ABSTAIN"].includes(candidate.action ?? "") ||
      !Array.isArray(candidate.evidence) ||
      !Array.isArray(candidate.strengths) ||
      !Array.isArray(candidate.gaps) ||
      !candidate.signals ||
      typeof candidate.signals !== "object" ||
      typeof candidate.disclaimer !== "string"
    ) {
      return null;
    }
    return candidate as AnswerEvaluation;
  } catch {
    return null;
  }
}
