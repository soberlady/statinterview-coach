import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { interviews, interviewTurns, skillStates } from "@/db/schema";
import { selectNextQuestion } from "@/app/lib/agent-policy";
import {
  ApiError,
  errorResponse,
  jsonResponse,
  readJsonObject,
  validationError,
} from "../../_lib/http";
import {
  assertStateTransition,
  parseInterviewState,
  serializeInterview,
  serializeSkillState,
  serializeTurn,
} from "../../_lib/interviews";

type RouteContext = { params: Promise<{ id: string }> };

const PUBLIC_STATE_TARGETS = new Set([
  "COMPLETED",
  "PAUSED",
  "RECOVERING",
  "CANCELLED",
]);

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getDb();
    const [interview] = await db
      .select()
      .from(interviews)
      .where(eq(interviews.id, id))
      .limit(1);

    if (!interview) {
      throw new ApiError(
        404,
        "INTERVIEW_NOT_FOUND",
        "Interview was not found.",
      );
    }

    const [states, recentTurns] = await Promise.all([
      db
        .select()
        .from(skillStates)
        .where(eq(skillStates.interviewId, id))
        .orderBy(skillStates.skill),
      db
        .select()
        .from(interviewTurns)
        .where(eq(interviewTurns.interviewId, id))
        .orderBy(interviewTurns.sequenceNumber)
        .limit(100),
    ]);

    return jsonResponse({
      interview: serializeInterview(interview),
      skillStates: states.map(serializeSkillState),
      turns: recentTurns.map(serializeTurn),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const payload = await readJsonObject(request);
    const unsupportedFields = Object.keys(payload).filter(
      (field) => !["status", "currentStage"].includes(field),
    );
    if (unsupportedFields.length > 0) {
      throw validationError(
        "request",
        `public state updates do not accept: ${unsupportedFields.join(", ")}`,
      );
    }

    const status = parseInterviewState(payload.status, "status");
    const currentStage = parseInterviewState(
      payload.currentStage,
      "currentStage",
    );
    if (!status || !currentStage || status !== currentStage) {
      throw validationError(
        "state",
        "status and currentStage must both be present and equal",
      );
    }
    if (!PUBLIC_STATE_TARGETS.has(status)) {
      throw validationError(
        "status",
        "public updates may only complete, pause, resume, or cancel an interview",
      );
    }

    const db = getDb();
    const [existing] = await db
      .select()
      .from(interviews)
      .where(eq(interviews.id, id))
      .limit(1);
    if (!existing) {
      throw new ApiError(
        404,
        "INTERVIEW_NOT_FOUND",
        "Interview was not found.",
      );
    }
    assertStateTransition(existing.status, status);
    assertStateTransition(existing.currentStage, currentStage);

    if (status === "COMPLETED") {
      const [turns, states] = await Promise.all([
        db
          .select()
          .from(interviewTurns)
          .where(eq(interviewTurns.interviewId, id))
          .orderBy(interviewTurns.sequenceNumber),
        db
          .select()
          .from(skillStates)
          .where(eq(skillStates.interviewId, id))
          .orderBy(skillStates.skill),
      ]);
      const decision = selectNextQuestion({
        interview: existing,
        turns,
        skillStates: states,
      });
      if (decision.nextQuestion) {
        throw new ApiError(
          409,
          "INTERVIEW_POLICY_INCOMPLETE",
          "The interview policy still has an approved next question.",
          { nextQuestionId: decision.nextQuestion.id },
        );
      }
    }

    const now = new Date().toISOString();
    const [updated] = await db
      .update(interviews)
      .set({
        status,
        currentStage,
        completedAt: status === "COMPLETED" ? now : existing.completedAt,
        checkpointVersion: existing.checkpointVersion + 1,
        lastCheckpointAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(interviews.id, id),
          eq(interviews.status, existing.status),
          eq(interviews.currentStage, existing.currentStage),
          eq(interviews.checkpointVersion, existing.checkpointVersion),
        ),
      )
      .returning();
    if (!updated) {
      throw new ApiError(
        409,
        "INTERVIEW_STATE_CONFLICT",
        "The interview state changed before this update was applied.",
      );
    }

    const states = await db
      .select()
      .from(skillStates)
      .where(eq(skillStates.interviewId, id))
      .orderBy(skillStates.skill);
    return jsonResponse({
      interview: serializeInterview(updated),
      skillStates: states.map(serializeSkillState),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
