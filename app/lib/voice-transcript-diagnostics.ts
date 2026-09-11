import type { VoiceTelemetryEvent } from "./voice-telemetry";

export const TRANSCRIPT_BUFFER_VERSION = 2;
export type TranscriptComparisonStatus = "LENGTH_MATCH" | "DISPLAY_SHORTER" | "DISPLAY_LONGER" | "UNMEASURED";
export type TranscriptComparisonReason = "COMPARABLE" | "NO_CHECKPOINT" | "LEGACY_OR_INVALID" | "CONFLICTING_CHECKPOINTS" | "EVENT_LIMIT";
export type TranscriptComparison = {
  sequenceNumber: number;
  savedCharacters: number;
  browserCharacters: number | null;
  status: TranscriptComparisonStatus;
  reason: TranscriptComparisonReason;
};
export type VoiceTranscriptDiagnostics = {
  savedVoiceTurns: number;
  comparableTurns: number;
  differingTurns: number;
  unmeasuredTurns: number;
  eventsMayBeTruncated: boolean;
  turns: TranscriptComparison[];
};
type StoredTurn = {
  sequenceNumber: number;
  status: string;
  inputMode: string;
  answerText: string;
};

/** Lengths are transport diagnostics, never recognition accuracy or scoring input.
 * Only v2 single-turn checkpoints isolate the browser buffer by saved turn.
 * Missing/legacy/ambiguous telemetry must not imply success or audio loss.
 */
export function diagnoseVoiceTranscripts(
  turns: StoredTurn[],
  events: VoiceTelemetryEvent[],
  eventsMayBeTruncated = false,
): VoiceTranscriptDiagnostics {
  const comparisons = turns
    .filter((turn) => turn.status === "completed" && turn.inputMode === "voice")
    .map((turn): TranscriptComparison => {
      const base = { sequenceNumber: turn.sequenceNumber, savedCharacters: turn.answerText.length };
      const unknown = (reason: TranscriptComparisonReason): TranscriptComparison => ({
        ...base, browserCharacters: null, status: "UNMEASURED", reason,
      });
      if (eventsMayBeTruncated) return unknown("EVENT_LIMIT");
      const checkpoints = events.filter((event) =>
        event.eventType === "voice.turn_committed" &&
        event.payload.toCompletedTurns === turn.sequenceNumber,
      );
      if (!checkpoints.length) return unknown("NO_CHECKPOINT");
      if (checkpoints.some(({ payload }) =>
        payload.transcriptBufferVersion !== TRANSCRIPT_BUFFER_VERSION ||
        payload.fromCompletedTurns !== turn.sequenceNumber - 1 ||
        typeof payload.voiceSessionId !== "string" || !payload.voiceSessionId ||
        typeof payload.transcriptCharacters !== "number" ||
        !Number.isSafeInteger(payload.transcriptCharacters) || payload.transcriptCharacters < 0,
      )) return unknown("LEGACY_OR_INVALID");
      const lengths = new Set(checkpoints.map(({ payload }) => payload.transcriptCharacters as number));
      if (lengths.size !== 1) return unknown("CONFLICTING_CHECKPOINTS");
      const browserCharacters = [...lengths][0];
      return {
        ...base, browserCharacters, reason: "COMPARABLE",
        status: browserCharacters === base.savedCharacters ? "LENGTH_MATCH"
          : browserCharacters < base.savedCharacters ? "DISPLAY_SHORTER" : "DISPLAY_LONGER",
      };
    });
  return {
    savedVoiceTurns: comparisons.length,
    comparableTurns: comparisons.filter((turn) => turn.status !== "UNMEASURED").length,
    differingTurns: comparisons.filter((turn) => turn.status === "DISPLAY_SHORTER" || turn.status === "DISPLAY_LONGER").length,
    unmeasuredTurns: comparisons.filter((turn) => turn.status === "UNMEASURED").length,
    eventsMayBeTruncated,
    turns: comparisons,
  };
}
