import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { interviews, interviewTurns, skillStates } from "@/db/schema";
import { selectNextQuestion } from "@/app/lib/agent-policy";
import { toPublicQuestion } from "@/app/lib/question-bank";
import {
  ApiError,
  errorResponse,
  jsonResponse,
} from "../../../_lib/http";
import { serializeInterview } from "../../../_lib/interviews";

type RouteContext = { params: Promise<{ id: string }> };

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
      interview,
      turns,
      skillStates: states,
    });

    return jsonResponse({
      interview: serializeInterview(interview),
      nextQuestion: decision.nextQuestion
        ? toPublicQuestion(decision.nextQuestion)
        : null,
      decision: {
        action: decision.action,
        reason: decision.reason,
        utility: decision.utility,
      },
      progress: {
        completedTurns: turns.filter((turn) => turn.status === "completed")
          .length,
        substantiveTurns: turns.filter(
          (turn) =>
            turn.status === "completed" &&
            turn.questionType !== "verification",
        ).length,
        targetSubstantiveTurns: 6,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
