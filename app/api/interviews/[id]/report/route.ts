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
import { summarizeCostTelemetry } from "@/app/lib/cost-telemetry";
import { diagnoseVoiceTranscripts } from "@/app/lib/voice-transcript-diagnostics";
import { summarizeVoiceTelemetry } from "@/app/lib/voice-telemetry";
import scoringBenchmark from "@/content/scoring-benchmark.json";
import { inferJobWeights } from "@/app/lib/agent-policy";
import { createTrainingPlan, readPolicyConfig, interviewQuestionBankVersion } from "@/app/lib/practice-plan";
import { CURRENT_QUESTION_BANK_VERSION, getInterviewQuestion } from "@/app/lib/question-bank";
import { buildReportInsights, compareEvidence, criterionFeedback, isAcceptedEvidence, type DiagnosticTurn } from "@/app/lib/report-insights";
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
    const diagnosticTurns: DiagnosticTurn[] = turnRows.map(turn => ({ ...turn,
      topic: turn.questionId ? getInterviewQuestion(turn.questionId, interviewQuestionBankVersion(interview))?.topic : undefined,
      evaluation: parseJsonText<DiagnosticTurn["evaluation"]>(turn.evaluation, {}),
    }));
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
    const costTelemetry = summarizeCostTelemetry(
      eventRows.map((event) => ({
        eventType: event.eventType,
        estimatedCostMicrousd: event.estimatedCostMicrousd,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        payload: parseJsonText<Record<string, unknown>>(event.payload, {}),
      })),
    );
    const policyAudit = replayInterviewPolicy({
      interview,
      turns: turnRows,
    });
    const policyFingerprint =
      await fingerprintPolicyAudit(policyAudit);
    const trainingPlan = readPolicyConfig(interview.policyConfig)?.trainingPlan;
    const recommendation = interview.mode === "guided_demo" ? null : createTrainingPlan({
      sourceInterviewId: id, turns: turnRows, states: stateRows,
      questionBankVersion: readPolicyConfig(interview.policyConfig) ? interviewQuestionBankVersion(interview) : CURRENT_QUESTION_BANK_VERSION,
      jobWeights: inferJobWeights(interview.jobDescription), previousPlan: trainingPlan,
    });
    const transferTurn = trainingPlan
      ? completedTurns.find((turn) => turn.questionId === trainingPlan.questionIds[2]) : undefined;
    const transferEvaluation = transferTurn ? parseJsonText<{ action?: string; totalScore?: number }>(transferTurn.evaluation, {}) : null;
    const transferDiagnostic = diagnosticTurns.find(turn => turn.id === transferTurn?.id);
    const sourceTurns = trainingPlan ? await db.select().from(interviewTurns)
      .where(eq(interviewTurns.interviewId, trainingPlan.sourceInterviewId)).orderBy(asc(interviewTurns.sequenceNumber)) : [];
    const [sourceInterview] = trainingPlan ? await db.select().from(interviews)
      .where(eq(interviews.id, trainingPlan.sourceInterviewId)).limit(1) : [];
    const sourceTrainingPlan = sourceInterview ? readPolicyConfig(sourceInterview.policyConfig)?.trainingPlan : null;
    const baselineTurns = sourceTurns.filter(turn => turn.skill === trainingPlan?.focusSkill
      && sourceInterview && turn.questionId
      && getInterviewQuestion(turn.questionId, interviewQuestionBankVersion(sourceInterview))?.topic === trainingPlan?.topic
      && (!sourceTrainingPlan || turn.questionId === sourceTrainingPlan.questionIds[2]))
      .map(turn => ({ ...turn, evaluation: parseJsonText<DiagnosticTurn["evaluation"]>(turn.evaluation, {}) }));
    const evidenceComparison = compareEvidence(baselineTurns, transferDiagnostic);
    const baselineEvidence = baselineTurns.filter(isAcceptedEvidence).flatMap(turn => criterionFeedback(turn)
      .map(item => ({ criterion: item.criterion, label: item.label, quote: item.quote, sequenceNumber: turn.sequenceNumber })));

    return jsonResponse({
      report: {
        generatedAt: new Date().toISOString(),
        assessmentStatus:
          acceptedEvaluations.length === 0
            ? "INSUFFICIENT_EVIDENCE"
            : "AVAILABLE",
        interview: serializeInterview(interview),
        diagnosis: buildReportInsights(diagnosticTurns, inferJobWeights(interview.jobDescription), recommendation),
        reviewGuidance: Object.fromEntries(completedTurns.map(turn => {
          const question = turn.questionId ? getInterviewQuestion(turn.questionId, interviewQuestionBankVersion(interview)) : undefined;
          return [turn.id, question?.learningPoints?.length ? question.learningPoints : question?.rubric.map(item => item.criterion) ?? []];
        })),
        trainingRecommendation: recommendation ? {
          focusSkill: recommendation.focusSkill, topic: recommendation.topic,
          kind: recommendation.kind, reason: recommendation.reason,
          learningPoints: recommendation.learningPoints,
        } : null,
        trainingOutcome: trainingPlan ? {
          sourceInterviewId: trainingPlan.sourceInterviewId, focusSkill: trainingPlan.focusSkill,
          topic: trainingPlan.topic, completed: Boolean(transferTurn),
          evidenceComparison,
          baselineEvidence,
          transferScore: transferDiagnostic && isAcceptedEvidence(transferDiagnostic) ? transferEvaluation?.totalScore ?? null : null,
          message: !transferTurn ? "尚未完成新场景复测。"
            : !transferDiagnostic || !isAcceptedEvidence(transferDiagnostic) ? "复测证据不足，暂不判断是否掌握；练习和追问不能代替独立复测。"
              : "这是一次未见场景的独立回答结果。本轮能力状态包含有提示练习，仅用于过程反馈；不能与诊断后验直接比较，也不能据此宣称长期学习提升。",
        } : null,
        skillStates: stateRows.map(serializeSkillState),
        turns: turnRows.map((turn, index) => ({ ...serializeTurn(turn), topic: diagnosticTurns[index].topic })),
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
          estimatedCostUsd:
            costTelemetry.estimatedCostMicrousd === null
              ? null
              : round(
                  costTelemetry.estimatedCostMicrousd / 1_000_000,
                  6,
                ),
          costTelemetry,
          voiceTelemetry,
          voiceTranscriptDiagnostics: diagnoseVoiceTranscripts(
            turnRows,
            eventRows.map((event) => ({
              eventType: event.eventType,
              latencyMs: event.latencyMs,
              payload: parseJsonText<Record<string, unknown>>(event.payload, {}),
            })),
            eventRows.length >= 2_000,
          ),
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
