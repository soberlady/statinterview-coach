import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { interviews, userFeedback } from "@/db/schema";
import {
  ApiError,
  errorResponse,
  jsonResponse,
  optionalBoolean,
  optionalInteger,
  optionalString,
  readJsonObject,
  validationError,
} from "../../../_lib/http";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getDb();
    await requireInterview(db, id);
    const feedback = await db
      .select()
      .from(userFeedback)
      .where(eq(userFeedback.interviewId, id))
      .orderBy(desc(userFeedback.createdAt))
      .limit(20);
    return jsonResponse({ feedback });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: interviewId } = await context.params;
    const payload = await readJsonObject(request);
    const rating = optionalInteger(payload, "rating", { min: 1, max: 5 });
    const wouldUseAgain = optionalBoolean(payload, "wouldUseAgain");
    const comment = optionalString(payload, "comment", { max: 4_000 }) ?? "";

    if (
      rating === undefined &&
      wouldUseAgain === undefined &&
      comment.length === 0
    ) {
      throw validationError(
        "feedback",
        "must include rating, wouldUseAgain, or comment",
      );
    }

    const db = getDb();
    await requireInterview(db, interviewId);
    const [feedback] = await db
      .insert(userFeedback)
      .values({
        id: `feedback_${crypto.randomUUID()}`,
        interviewId,
        rating,
        wouldUseAgain,
        comment,
        createdAt: new Date().toISOString(),
      })
      .returning();

    return jsonResponse({ feedback }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

async function requireInterview(
  db: ReturnType<typeof getDb>,
  id: string,
): Promise<void> {
  const [interview] = await db
    .select({ id: interviews.id })
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
}
