import assert from "node:assert/strict";
import test from "node:test";
import { summarizeVoiceTelemetry } from "../app/lib/voice-telemetry";

test("voice telemetry keeps operational latencies separate and computes percentiles", () => {
  const summary = summarizeVoiceTelemetry([
    event("voice.connected", 100, "session-a"),
    event("voice.transcript_final", null, "session-a"),
    event("voice.turn_committed", 400, "session-a"),
    event("voice.connected", 300, "session-b"),
    event("voice.transcript_final", null, "session-b"),
    event("voice.transcript_final", null, "session-b"),
    event("voice.turn_committed", 800, "session-b"),
    event("voice.connection_failed", 1_000, "session-c"),
    event("turn_evaluated", 99_999, "session-b"),
  ]);

  assert.deepEqual(summary, {
    sessionCount: 2,
    reconnectCount: 1,
    failedConnectionCount: 1,
    finalTranscriptSegmentCount: 3,
    committedTurnCount: 2,
    connectionLatency: { count: 2, p50Ms: 200, p95Ms: 290 },
    transcriptToCommitLatency: { count: 2, p50Ms: 600, p95Ms: 780 },
  });
});

test("voice telemetry returns explicit empty measurements", () => {
  assert.deepEqual(summarizeVoiceTelemetry([]), {
    sessionCount: 0,
    reconnectCount: 0,
    failedConnectionCount: 0,
    finalTranscriptSegmentCount: 0,
    committedTurnCount: 0,
    connectionLatency: { count: 0, p50Ms: null, p95Ms: null },
    transcriptToCommitLatency: { count: 0, p50Ms: null, p95Ms: null },
  });
});

function event(
  eventType: string,
  latencyMs: number | null,
  voiceSessionId: string,
) {
  return {
    eventType,
    latencyMs,
    payload: { voiceSessionId },
  };
}
