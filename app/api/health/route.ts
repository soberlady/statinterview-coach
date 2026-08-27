import { getDb } from "@/db";
import { interviews } from "@/db/schema";
import { listQuestions } from "@/app/lib/question-bank";
import { ApiError, errorResponse, jsonResponse } from "../_lib/http";

const EXPECTED_QUESTION_COUNT = 24;

export async function GET() {
  try {
    const questionCount = listQuestions().length;
    if (questionCount !== EXPECTED_QUESTION_COUNT) {
      throw new ApiError(
        503,
        "QUESTION_BANK_NOT_READY",
        `Expected ${EXPECTED_QUESTION_COUNT} approved questions but found ${questionCount}.`,
      );
    }

    await getDb().select({ id: interviews.id }).from(interviews).limit(1);

    return jsonResponse({
      status: "ok",
      checks: {
        database: "ready",
        questionBank: {
          status: "ready",
          approvedQuestionCount: questionCount,
        },
        policy: "ready",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
