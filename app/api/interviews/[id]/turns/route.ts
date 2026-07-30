import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  agentEvents,
  interviews,
  interviewTurns,
  skillStates,
} from "@/db/schema";
import {
  selectNextQuestion,
  updateAbility,
} from "@/app/lib/agent-policy";
import { evaluateAnswerWithFallback } from "@/app/lib/rubric-evaluator";
import {
  getInterviewQuestion,
  toPublicQuestion,
} from "@/app/lib/question-bank";
import {
  ApiError,
  errorResponse,
  jsonResponse,
  jsonString,
  optionalIsoDate,
  optionalString,
  readJsonObject,
  requiredString,
  validationError,
} from "../../../_lib/http";
import {
  isTerminalState,
  serializeInterview,
  serializeSkillState,
  serializeTurn,
} from "../../../_lib/interviews";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: interviewId } = await context.params;
    const payload = await readJsonObject(request);
    const sequenceNumber = payload.sequenceNumber;

    if (
      typeof sequenceNumber !== "number" ||
      !Number.isInteger(sequenceNumber) ||
      sequenceNumber < 1 ||
      sequenceNumber > 1_000
    ) {
      throw validationError(
        "sequenceNumber",
        "must be an integer between 1 and 1000",
      );
    }

    const questionId = requiredString(payload, "questionId", { max: 128 });
    const question = getInterviewQuestion(questionId);
    if (!question) {
      throw validationError(
        "questionId",
        "must reference an approved question-bank item",
      );
    }
    const answerText = requiredString(payload, "answerText", {
      max: 20_000,
    });
    if (answerText.trim().length < 10) {
      throw validationError("answerText", "must contain at least 10 characters");
    }
    const startedAt = optionalIsoDate(payload, "startedAt");
    const completedAt =
      optionalIsoDate(payload, "completedAt") ?? new Date().toISOString();
    const inputMode =
      optionalString(payload, "inputMode", { max: 16 }) ?? "text";
    if (!["text", "voice"].includes(inputMode)) {
      throw validationError("inputMode", "must be text or voice");
    }

    const db = getDb();
    const [interview] = await db
      .select()
      .from(interviews)
      .where(eq(interviews.id, interviewId))
      .limit(1);
    if (!interview) {
      throw new ApiError(
        404,
        "INTERVIEW_NOT_FOUND",
        "Interview was not found.",
      );
    }
    if (isTerminalState(interview.status)) {
      throw new ApiError(
        409,
        "INTERVIEW_NOT_ACTIVE",
        `Turns cannot be added to an interview in ${interview.status} state.`,
      );
    }

    const [duplicate] = await db
      .select()
      .from(interviewTurns)
      .where(
        and(
          eq(interviewTurns.interviewId, interviewId),
          eq(interviewTurns.sequenceNumber, sequenceNumber),
        ),
      )
      .limit(1);

    if (duplicate) {
      if (
        duplicate.questionId === question.id &&
        duplicate.answerText === answerText.trim()
      ) {
        const selection = await loadSelection(db, interview);
        return jsonResponse({
          turn: serializeTurn(duplicate),
          interview: serializeInterview(interview),
          ...selection,
          idempotentReplay: true,
        });
      }
      throw new ApiError(
        409,
        "TURN_SEQUENCE_CONFLICT",
        "This sequence number is already used by another turn.",
        { sequenceNumber },
      );
    }

    const [previousSkillState] = await db
      .select()
      .from(skillStates)
      .where(
        and(
          eq(skillStates.interviewId, interviewId),
          eq(skillStates.skill, question.skill),
        ),
      )
      .limit(1);
    if (!previousSkillState) {
      throw new ApiError(
        409,
        "SKILL_STATE_MISSING",
        "The interview is missing its initial skill state.",
        { skill: question.skill },
      );
    }

    const evaluation = await evaluateAnswerWithFallback(question, answerText);
    const now = new Date().toISOString();
    const turnId = `turn_${crypto.randomUUID()}`;
    const [turn] = await db
      .insert(interviewTurns)
      .values({
        id: turnId,
        interviewId,
        sequenceNumber,
        questionId: question.id,
        questionText: question.question,
        skill: question.skill,
        questionType: question.questionType,
        answerText: answerText.trim(),
        inputMode,
        status: "completed",
        evidence: jsonString(evaluation.evidence, "evidence", 32 * 1024),
        evaluation: jsonString(evaluation, "evaluation", 32 * 1024),
        reliability: evaluation.reliability,
        startedAt,
        completedAt,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    const abilityUpdate = updateAbility(
      previousSkillState,
      question,
      evaluation,
      turnId,
    );
    const [updatedSkillState] = await db
      .update(skillStates)
      .set({
        posteriorMean: abilityUpdate.posteriorMean,
        uncertainty: abilityUpdate.uncertainty,
        posterior: jsonString(abilityUpdate.posterior, "posterior"),
        supportingEvidence: jsonString(
          abilityUpdate.supportingEvidence,
          "supportingEvidence",
        ),
        commonErrors: jsonString(abilityUpdate.commonErrors, "commonErrors"),
        sourceTurnCount: abilityUpdate.sourceTurnCount,
        updatedAt: now,
      })
      .where(eq(skillStates.id, previousSkillState.id))
      .returning();

    const newVerificationCount =
      interview.verificationCount +
      (question.questionType === "verification" ? 1 : 0);
    const updatedInterviewBase = {
      ...interview,
      turnCount: Math.max(interview.turnCount, sequenceNumber),
      verificationCount: newVerificationCount,
      currentQuestionId: question.id,
      updatedAt: now,
    };
    const allTurns = await db
      .select()
      .from(interviewTurns)
      .where(eq(interviewTurns.interviewId, interviewId))
      .orderBy(interviewTurns.sequenceNumber);
    const allStates = await db
      .select()
      .from(skillStates)
      .where(eq(skillStates.interviewId, interviewId))
      .orderBy(skillStates.skill);
    const decision = selectNextQuestion({
      interview: updatedInterviewBase,
      turns: allTurns,
      skillStates: allStates,
    });
    const nextStage = decision.nextQuestion
      ? stageForQuestion(decision.nextQuestion.questionType)
      : "FINALIZING";

    const [updatedInterview] = await db
      .update(interviews)
      .set({
        turnCount: updatedInterviewBase.turnCount,
        verificationCount: newVerificationCount,
        currentQuestionId: decision.nextQuestion?.id ?? question.id,
        status: nextStage,
        currentStage: nextStage,
        startedAt: interview.startedAt ?? startedAt ?? now,
        checkpoint: jsonString(
          {
            lastCompletedTurn: sequenceNumber,
            lastQuestionId: question.id,
            nextQuestionId: decision.nextQuestion?.id ?? null,
            decision: {
              action: decision.action,
              reason: decision.reason,
              utility: decision.utility,
            },
          },
          "checkpoint",
        ),
        checkpointVersion: interview.checkpointVersion + 1,
        lastCheckpointAt: now,
        updatedAt: now,
      })
      .where(eq(interviews.id, interviewId))
      .returning();

    await db.insert(agentEvents).values({
      id: `evt_${crypto.randomUUID()}`,
      interviewId,
      turnId,
      eventType: "turn_evaluated",
      fromState: interview.currentStage,
      toState: nextStage,
      payload: jsonString(
        {
          sequenceNumber,
          questionType: question.questionType,
          skill: question.skill,
          reliability: evaluation.reliability,
          action: decision.action,
          nextQuestionId: decision.nextQuestion?.id ?? null,
          evaluator: evaluation.evaluator,
        },
        "eventPayload",
      ),
      latencyMs: evaluation.telemetry?.latencyMs,
      model: evaluation.telemetry?.model,
      inputTokens: evaluation.telemetry?.inputTokens,
      outputTokens: evaluation.telemetry?.outputTokens,
      createdAt: now,
    });

    return jsonResponse(
      {
        turn: serializeTurn(turn),
        evaluation,
        skillState: serializeSkillState(updatedSkillState),
        interview: serializeInterview(updatedInterview),
        nextQuestion: decision.nextQuestion
          ? toPublicQuestion(decision.nextQuestion)
          : null,
        decision: {
          action: decision.action,
          reason: decision.reason,
          utility: decision.utility,
        },
        progress: buildProgress(allTurns, decision.nextQuestion !== null),
      },
      201,
    );
  } catch (error) {
    return errorResponse(error);
  }
}

async function loadSelection(
  db: ReturnType<typeof getDb>,
  interview: typeof interviews.$inferSelect,
) {
  const [turns, states] = await Promise.all([
    db
      .select()
      .from(interviewTurns)
      .where(eq(interviewTurns.interviewId, interview.id))
      .orderBy(interviewTurns.sequenceNumber),
    db
      .select()
      .from(skillStates)
      .where(eq(skillStates.interviewId, interview.id))
      .orderBy(skillStates.skill),
  ]);
  const decision = selectNextQuestion({
    interview,
    turns,
    skillStates: states,
  });
  return {
    nextQuestion: decision.nextQuestion
      ? toPublicQuestion(decision.nextQuestion)
      : null,
    decision: {
      action: decision.action,
      reason: decision.reason,
      utility: decision.utility,
    },
    progress: buildProgress(turns, decision.nextQuestion !== null),
  };
}

function stageForQuestion(
  questionType: "anchor" | "adaptive" | "verification",
) {
  if (questionType === "anchor") return "ANCHOR_INTERVIEW" as const;
  if (questionType === "verification") return "VERIFYING" as const;
  return "ADAPTIVE_INTERVIEW" as const;
}

function buildProgress(turns: typeof interviewTurns.$inferSelect[], hasNext: boolean) {
  const completed = turns.filter((turn) => turn.status === "completed").length;
  const substantive = turns.filter(
    (turn) =>
      turn.status === "completed" && turn.questionType !== "verification",
  ).length;
  return {
    completedTurns: completed,
    substantiveTurns: substantive,
    targetSubstantiveTurns: 6,
    hasNext,
  };
}
