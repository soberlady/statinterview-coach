import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { interviews, interviewTurns, skillStates } from "@/db/schema";
import {
  selectNextQuestion,
  TARGET_SUBSTANTIVE_TURNS,
} from "@/app/lib/agent-policy";
import {
  buildGuidedDemoPayload,
  GUIDED_DEMO_MODE,
} from "@/app/lib/guided-demo";
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
    const completedTurns = turns.filter(
      (turn) => turn.status === "completed",
    ).length;
    const substantiveTurns = turns.filter(
      (turn) =>
        turn.status === "completed" && turn.questionType !== "verification",
    ).length;

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
      demo:
        interview.mode === GUIDED_DEMO_MODE && decision.nextQuestion
          ? buildGuidedDemoPayload({
              question: decision.nextQuestion,
              completedTurns,
              substantiveTurns,
            })
          : null,
      progress: {
        completedTurns,
        substantiveTurns,
        targetSubstantiveTurns: TARGET_SUBSTANTIVE_TURNS,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
