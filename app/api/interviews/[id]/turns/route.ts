import { and, eq, exists, sql } from "drizzle-orm";
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
  buildGuidedDemoPayload,
  evaluateGuidedDemoAnswer,
  GUIDED_DEMO_MODE,
} from "@/app/lib/guided-demo";
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
  isTurnAcceptingState,
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
    if (
      !isTurnAcceptingState(interview.status) ||
      !isTurnAcceptingState(interview.currentStage)
    ) {
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

    const [existingTurns, existingStates] = await Promise.all([
      db
        .select()
        .from(interviewTurns)
        .where(eq(interviewTurns.interviewId, interviewId))
        .orderBy(interviewTurns.sequenceNumber),
      db
        .select()
        .from(skillStates)
        .where(eq(skillStates.interviewId, interviewId))
        .orderBy(skillStates.skill),
    ]);
    const sequenceIsContinuous = existingTurns.every(
      (turn, index) => turn.sequenceNumber === index + 1,
    );
    if (!sequenceIsContinuous) {
      throw new ApiError(
        409,
        "INTERVIEW_SEQUENCE_CORRUPT",
        "The persisted interview sequence is not continuous.",
      );
    }
    const expectedSequenceNumber = existingTurns.length + 1;
    if (sequenceNumber !== expectedSequenceNumber) {
      throw new ApiError(
        409,
        "TURN_SEQUENCE_OUT_OF_ORDER",
        "The turn does not match the next expected sequence number.",
        {
          expectedSequenceNumber,
          receivedSequenceNumber: sequenceNumber,
        },
      );
    }

    const expectedDecision = selectNextQuestion({
      interview,
      turns: existingTurns,
      skillStates: existingStates,
    });
    if (!expectedDecision.nextQuestion) {
      throw new ApiError(
        409,
        "INTERVIEW_POLICY_COMPLETE",
        "The interview policy has no remaining question.",
      );
    }
    if (question.id !== expectedDecision.nextQuestion.id) {
      throw new ApiError(
        409,
        "QUESTION_POLICY_CONFLICT",
        "The submitted question does not match the policy-selected question.",
        {
          expectedQuestionId: expectedDecision.nextQuestion.id,
          receivedQuestionId: question.id,
        },
      );
    }

    const previousSkillState = existingStates.find(
      (state) => state.skill === question.skill,
    );
    if (!previousSkillState) {
      throw new ApiError(
        409,
        "SKILL_STATE_MISSING",
        "The interview is missing its initial skill state.",
        { skill: question.skill },
      );
    }

    const evaluation =
      interview.mode === GUIDED_DEMO_MODE
        ? evaluateGuidedDemoAnswer(question, answerText)
        : await evaluateAnswerWithFallback(question, answerText);
    const now = new Date().toISOString();
    const turnId = `turn_${crypto.randomUUID()}`;
    const turnValues: typeof interviewTurns.$inferInsert = {
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
    };
    const abilityUpdate = updateAbility(
      previousSkillState,
      question,
      evaluation,
      turnId,
    );
    const skillStateValues: Partial<typeof skillStates.$inferInsert> = {
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
    };
    const turnForPolicy: typeof interviewTurns.$inferSelect = {
      ...turnValues,
      questionId: turnValues.questionId ?? null,
      questionType: turnValues.questionType ?? "adaptive",
      answerText: turnValues.answerText ?? "",
      inputMode: turnValues.inputMode ?? "voice",
      status: turnValues.status ?? "completed",
      transcriptConfidence: null,
      evidence: turnValues.evidence ?? "[]",
      evaluation: turnValues.evaluation ?? "{}",
      reliability: turnValues.reliability ?? null,
      startedAt: turnValues.startedAt ?? null,
      completedAt: turnValues.completedAt ?? null,
      createdAt: turnValues.createdAt ?? now,
      updatedAt: turnValues.updatedAt ?? now,
    };
    const updatedSkillStateForPolicy: typeof skillStates.$inferSelect = {
      ...previousSkillState,
      posteriorMean: abilityUpdate.posteriorMean,
      uncertainty: abilityUpdate.uncertainty,
      posterior: skillStateValues.posterior ?? "[]",
      supportingEvidence: skillStateValues.supportingEvidence ?? "[]",
      commonErrors: skillStateValues.commonErrors ?? "[]",
      sourceTurnCount: abilityUpdate.sourceTurnCount,
      updatedAt: now,
    };
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
    const allTurns = [...existingTurns, turnForPolicy];
    const allStates = existingStates.map((state) =>
      state.id === previousSkillState.id
        ? updatedSkillStateForPolicy
        : state,
    );
    const decision = selectNextQuestion({
      interview: updatedInterviewBase,
      turns: allTurns,
      skillStates: allStates,
    });
    const nextStage = decision.nextQuestion
      ? stageForQuestion(decision.nextQuestion.questionType)
      : "FINALIZING";
    const interviewValues: Partial<typeof interviews.$inferInsert> = {
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
    };
    const eventValues: typeof agentEvents.$inferInsert = {
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
          cost: evaluation.telemetry
            ? {
                status: evaluation.telemetry.pricingStatus,
                version: evaluation.telemetry.pricingVersion,
              }
            : undefined,
          selectionAudit: decision.ranking.slice(0, 3),
          selectionContext: decision.context,
        },
        "eventPayload",
      ),
      latencyMs: evaluation.telemetry?.latencyMs,
      model: evaluation.telemetry?.model,
      inputTokens: evaluation.telemetry?.inputTokens,
      outputTokens: evaluation.telemetry?.outputTokens,
      estimatedCostMicrousd:
        evaluation.telemetry?.estimatedCostMicrousd,
      idempotencyKey: `internal:turn:${interviewId}:${sequenceNumber}`,
      createdAt: now,
    };
    const expectedCheckpointVersion = interview.checkpointVersion;
    const committedCheckpointVersion = expectedCheckpointVersion + 1;
    const currentInterviewGuard = and(
      eq(interviews.id, interviewId),
      eq(interviews.status, interview.status),
      eq(interviews.currentStage, interview.currentStage),
      eq(interviews.checkpointVersion, expectedCheckpointVersion),
    );
    const committedInterviewGuard = and(
      eq(interviews.id, interviewId),
      eq(interviews.status, nextStage),
      eq(interviews.currentStage, nextStage),
      eq(interviews.checkpointVersion, committedCheckpointVersion),
      eq(interviews.updatedAt, now),
    );
    const committedInterviewExists = exists(
      db
        .select({ id: interviews.id })
        .from(interviews)
        .where(committedInterviewGuard),
    );
    const [
      updatedInterviews,
      insertedTurns,
      updatedSkillStates,
      insertedEvents,
    ] = await db.batch([
      db
        .update(interviews)
        .set(interviewValues)
        .where(currentInterviewGuard)
        .returning(),
      db
        .insert(interviewTurns)
        .select(
          db
            .select({
              id: sql<string>`${turnValues.id}`.as("id"),
              interviewId: sql<string>`${turnValues.interviewId}`.as(
                "interview_id",
              ),
              sequenceNumber: sql<number>`${turnValues.sequenceNumber}`.as(
                "sequence_number",
              ),
              questionId: sql<string | null>`${turnValues.questionId ?? null}`.as(
                "question_id",
              ),
              questionText: sql<string>`${turnValues.questionText}`.as(
                "question_text",
              ),
              skill: sql<string>`${turnValues.skill}`.as("skill"),
              questionType: sql<string>`${turnValues.questionType}`.as(
                "question_type",
              ),
              answerText: sql<string>`${turnValues.answerText}`.as(
                "answer_text",
              ),
              inputMode: sql<string>`${turnValues.inputMode}`.as("input_mode"),
              status: sql<string>`${turnValues.status}`.as("status"),
              transcriptConfidence: sql<number | null>`${null}`.as(
                "transcript_confidence",
              ),
              evidence: sql<string>`${turnValues.evidence}`.as("evidence"),
              evaluation: sql<string>`${turnValues.evaluation}`.as(
                "evaluation",
              ),
              reliability: sql<string | null>`${turnValues.reliability ?? null}`.as(
                "reliability",
              ),
              startedAt: sql<string | null>`${turnValues.startedAt ?? null}`.as(
                "started_at",
              ),
              completedAt: sql<string | null>`${turnValues.completedAt ?? null}`.as(
                "completed_at",
              ),
              createdAt: sql<string>`${turnValues.createdAt}`.as("created_at"),
              updatedAt: sql<string>`${turnValues.updatedAt}`.as("updated_at"),
            })
            .from(interviews)
            .where(committedInterviewGuard),
        )
        .returning(),
      db
        .update(skillStates)
        .set(skillStateValues)
        .where(
          and(
            eq(skillStates.id, previousSkillState.id),
            committedInterviewExists,
          ),
        )
        .returning(),
      db
        .insert(agentEvents)
        .select(
          db
            .select({
              id: sql<string>`${eventValues.id}`.as("id"),
              interviewId: sql<string>`${eventValues.interviewId}`.as(
                "interview_id",
              ),
              turnId: sql<string | null>`${eventValues.turnId ?? null}`.as(
                "turn_id",
              ),
              eventType: sql<string>`${eventValues.eventType}`.as("event_type"),
              fromState: sql<string | null>`${eventValues.fromState ?? null}`.as(
                "from_state",
              ),
              toState: sql<string | null>`${eventValues.toState ?? null}`.as(
                "to_state",
              ),
              payload: sql<string>`${eventValues.payload}`.as("payload"),
              latencyMs: sql<number | null>`${eventValues.latencyMs ?? null}`.as(
                "latency_ms",
              ),
              model: sql<string | null>`${eventValues.model ?? null}`.as(
                "model",
              ),
              inputTokens: sql<number | null>`${eventValues.inputTokens ?? null}`.as(
                "input_tokens",
              ),
              outputTokens: sql<number | null>`${eventValues.outputTokens ?? null}`.as(
                "output_tokens",
              ),
              estimatedCostMicrousd: sql<number | null>`${eventValues.estimatedCostMicrousd ?? null}`.as(
                "estimated_cost_microusd",
              ),
              idempotencyKey: sql<string | null>`${eventValues.idempotencyKey ?? null}`.as(
                "idempotency_key",
              ),
              createdAt: sql<string>`${eventValues.createdAt}`.as("created_at"),
            })
            .from(interviews)
            .where(committedInterviewGuard),
        )
        .returning({ id: agentEvents.id }),
    ]);
    const turn = insertedTurns[0];
    const updatedSkillState = updatedSkillStates[0];
    const updatedInterview = updatedInterviews[0];
    const insertedEvent = insertedEvents[0];
    if (!turn || !updatedSkillState || !updatedInterview || !insertedEvent) {
      throw new ApiError(
        409,
        "INTERVIEW_STATE_CONFLICT",
        "The interview changed while this answer was being evaluated.",
      );
    }

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
        demo:
          interview.mode === GUIDED_DEMO_MODE && decision.nextQuestion
            ? buildGuidedDemoPayload({
                question: decision.nextQuestion,
                completedTurns: allTurns.filter(
                  (turn) => turn.status === "completed",
                ).length,
                substantiveTurns: allTurns.filter(
                  (turn) =>
                    turn.status === "completed" &&
                    turn.questionType !== "verification",
                ).length,
              })
            : null,
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
  const completedTurns = turns.filter(
    (turn) => turn.status === "completed",
  ).length;
  const substantiveTurns = turns.filter(
    (turn) =>
      turn.status === "completed" && turn.questionType !== "verification",
  ).length;
  return {
    nextQuestion: decision.nextQuestion
      ? toPublicQuestion(decision.nextQuestion)
      : null,
    decision: {
      action: decision.action,
      reason: decision.reason,
      utility: decision.utility,
    },
    demo:
      interview.mode === GUIDED_DEMO_MODE && decision.nextQuestion
        ? buildGuidedDemoPayload({
            question: decision.nextQuestion,
            completedTurns,
            substantiveTurns,
          })
        : null,
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
