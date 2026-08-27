import type {
  Interview,
  InterviewTurn,
  SkillState,
} from "@/db/schema";
import {
  ApiError,
  isJsonObject,
  parseJsonText,
  validationError,
} from "./http";

export const INTERVIEW_STATES = [
  "CREATED",
  "PREPARING",
  "ANCHOR_INTERVIEW",
  "ADAPTIVE_INTERVIEW",
  "VERIFYING",
  "FINALIZING",
  "COMPLETED",
  "PAUSED",
  "RECOVERING",
  "FAILED",
  "CANCELLED",
] as const;

export type InterviewState = (typeof INTERVIEW_STATES)[number];

const TERMINAL_STATES = new Set<InterviewState>(["COMPLETED", "CANCELLED"]);
const TURN_ACCEPTING_STATES = new Set<InterviewState>([
  "CREATED",
  "PREPARING",
  "ANCHOR_INTERVIEW",
  "ADAPTIVE_INTERVIEW",
  "VERIFYING",
  "RECOVERING",
]);

const ALLOWED_TRANSITIONS: Record<InterviewState, ReadonlySet<InterviewState>> = {
  CREATED: new Set([
    "PREPARING",
    "ANCHOR_INTERVIEW",
    "PAUSED",
    "FAILED",
    "CANCELLED",
  ]),
  PREPARING: new Set([
    "ANCHOR_INTERVIEW",
    "PAUSED",
    "FAILED",
    "CANCELLED",
  ]),
  ANCHOR_INTERVIEW: new Set([
    "ADAPTIVE_INTERVIEW",
    "VERIFYING",
    "FINALIZING",
    "PAUSED",
    "FAILED",
    "CANCELLED",
  ]),
  ADAPTIVE_INTERVIEW: new Set([
    "VERIFYING",
    "FINALIZING",
    "PAUSED",
    "FAILED",
    "CANCELLED",
  ]),
  VERIFYING: new Set([
    "ANCHOR_INTERVIEW",
    "ADAPTIVE_INTERVIEW",
    "FINALIZING",
    "PAUSED",
    "FAILED",
    "CANCELLED",
  ]),
  FINALIZING: new Set(["COMPLETED", "PAUSED", "FAILED", "CANCELLED"]),
  COMPLETED: new Set(),
  PAUSED: new Set(["RECOVERING", "COMPLETED", "CANCELLED", "FAILED"]),
  RECOVERING: new Set([
    "PREPARING",
    "ANCHOR_INTERVIEW",
    "ADAPTIVE_INTERVIEW",
    "VERIFYING",
    "FINALIZING",
    "COMPLETED",
    "PAUSED",
    "FAILED",
    "CANCELLED",
  ]),
  FAILED: new Set(["RECOVERING", "CANCELLED"]),
  CANCELLED: new Set(),
};

export const SKILL_KEYS = [
  "statistics_ml",
  "experiment_causal",
  "sql_python",
  "business_analytics",
] as const;

export function parseInterviewState(
  value: unknown,
  field: string,
): InterviewState | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw validationError(field, "must be a valid interview state");
  }

  const normalized = value.trim().toUpperCase();
  if (!(INTERVIEW_STATES as readonly string[]).includes(normalized)) {
    throw validationError(
      field,
      `must be one of ${INTERVIEW_STATES.join(", ")}`,
    );
  }
  return normalized as InterviewState;
}

export function assertStateTransition(
  from: string,
  to: InterviewState,
): void {
  const normalizedFrom = from.toUpperCase() as InterviewState;
  if (normalizedFrom === to) return;

  const allowed = ALLOWED_TRANSITIONS[normalizedFrom];
  if (!allowed || !allowed.has(to)) {
    throw new ApiError(
      409,
      "INVALID_STATE_TRANSITION",
      `Interview cannot move from ${from} to ${to}.`,
      { from, to },
    );
  }
}

export function isTerminalState(value: string): boolean {
  return TERMINAL_STATES.has(value.toUpperCase() as InterviewState);
}

export function isTurnAcceptingState(value: string): boolean {
  return TURN_ACCEPTING_STATES.has(value.toUpperCase() as InterviewState);
}

export function serializeInterview(interview: Interview) {
  return {
    ...interview,
    checkpoint: parseJsonText<Record<string, unknown>>(
      interview.checkpoint,
      {},
    ),
  };
}

export function serializeTurn(turn: InterviewTurn) {
  return {
    ...turn,
    evidence: parseJsonText<unknown[]>(turn.evidence, []),
    evaluation: parseJsonText<Record<string, unknown>>(turn.evaluation, {}),
  };
}

export function serializeSkillState(state: SkillState) {
  return {
    ...state,
    posterior: parseJsonText<unknown[]>(state.posterior, []),
    supportingEvidence: parseJsonText<unknown[]>(
      state.supportingEvidence,
      [],
    ),
    commonErrors: parseJsonText<unknown[]>(state.commonErrors, []),
  };
}

export function readCheckpoint(value: unknown): Record<string, unknown> {
  if (!isJsonObject(value)) {
    throw validationError("checkpoint", "must be a JSON object");
  }
  return value;
}
