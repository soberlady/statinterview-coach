import { asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  agentEvents,
  interviews,
  interviewTurns,
  skillStates,
  userFeedback,
} from "@/db/schema";
import {
  fingerprintPolicyAudit,
  replayInterviewPolicy,
} from "@/app/lib/decision-audit";
import { summarizeVoiceTelemetry } from "@/app/lib/voice-telemetry";
import scoringBenchmark from "@/content/scoring-benchmark.json";
import { ApiError, errorResponse, jsonResponse, parseJsonText } from "../../../_lib/http";
import {
  serializeInterview,
  serializeSkillState,
  serializeTurn,
} from "../../../_lib/interviews";

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

    const [turnRows, stateRows, eventRows, feedbackRows] = await Promise.all([
      db
        .select()
        .from(interviewTurns)
        .where(eq(interviewTurns.interviewId, id))
        .orderBy(asc(interviewTurns.sequenceNumber)),
      db
        .select()
        .from(skillStates)
        .where(eq(skillStates.interviewId, id))
        .orderBy(asc(skillStates.skill)),
      db
        .select()
        .from(agentEvents)
        .where(eq(agentEvents.interviewId, id))
        .orderBy(asc(agentEvents.createdAt))
        .limit(2_000),
      db
        .select()
        .from(userFeedback)
        .where(eq(userFeedback.interviewId, id))
        .orderBy(desc(userFeedback.createdAt))
        .limit(1),
    ]);

    const completedTurns = turnRows.filter(
      (turn) => turn.status === "completed" && turn.answerText.trim().length > 0,
    );
    const acceptedEvaluations = completedTurns
      .map((turn) =>
        parseJsonText<{
          action?: unknown;
          totalScore?: unknown;
        }>(turn.evaluation, {}),
      )
      .filter((evaluation) => evaluation.action === "ACCEPT");
    const scoredTurns = acceptedEvaluations
      .map((evaluation) => evaluation.totalScore)
      .filter(
        (score): score is number =>
          typeof score === "number" && Number.isFinite(score),
      );
    const scoringLatencies = eventRows
      .filter((event) => event.eventType === "turn_evaluated")
      .map((event) => event.latencyMs)
      .filter((latency): latency is number => latency !== null);
    const voiceTelemetry = summarizeVoiceTelemetry(
      eventRows.map((event) => ({
        eventType: event.eventType,
        latencyMs: event.latencyMs,
        payload: parseJsonText<Record<string, unknown>>(event.payload, {}),
      })),
    );
    const totalCostMicrousd = eventRows.reduce(
      (sum, event) => sum + (event.estimatedCostMicrousd ?? 0),
      0,
    );
    const policyAudit = replayInterviewPolicy({
      interview,
      turns: turnRows,
    });
    const policyFingerprint =
      await fingerprintPolicyAudit(policyAudit);

    return jsonResponse({
      report: {
        generatedAt: new Date().toISOString(),
        assessmentStatus:
          acceptedEvaluations.length === 0
            ? "INSUFFICIENT_EVIDENCE"
            : "AVAILABLE",
        interview: serializeInterview(interview),
        skillStates: stateRows.map(serializeSkillState),
        turns: turnRows.map(serializeTurn),
        metrics: {
          totalTurns: turnRows.length,
          completedTurns: completedTurns.length,
          acceptedTurns: acceptedEvaluations.length,
          verificationTurns: turnRows.filter(
            (turn) => turn.questionType === "verification",
          ).length,
          lowReliabilityTurns: turnRows.filter(
            (turn) => turn.reliability === "LOW",
          ).length,
          averageScore:
            scoredTurns.length > 0
              ? round(
                  scoredTurns.reduce((sum, score) => sum + score, 0) /
                    scoredTurns.length,
                )
              : null,
          averageRecordedLatencyMs:
            scoringLatencies.length > 0
              ? Math.round(
                  scoringLatencies.reduce(
                    (sum, latency) => sum + latency,
                    0,
                  ) / scoringLatencies.length,
                )
              : null,
          eventCount: eventRows.length,
          estimatedCostUsd: round(totalCostMicrousd / 1_000_000, 6),
          voiceTelemetry,
        },
        policyAudit: {
          ...policyAudit,
          fingerprint: policyFingerprint,
        },
        scorerReleaseGate: {
          status: scoringBenchmark.releaseGate.status,
          claimBoundary: scoringBenchmark.releaseGate.claimBoundary,
        },
        latestFeedback: feedbackRows[0] ?? null,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

function round(value: number, precision = 3): number {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}
