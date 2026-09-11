import assert from "node:assert/strict";
import test from "node:test";
import { diagnoseVoiceTranscripts } from "../app/lib/voice-transcript-diagnostics";
import type { VoiceTelemetryEvent } from "../app/lib/voice-telemetry";

const turn = (sequenceNumber = 1, answerText = "这是完整的回答。") => ({
  sequenceNumber, answerText, status: "completed", inputMode: "voice",
});
const checkpoint = (sequenceNumber: number, chars: unknown, override: Record<string, unknown> = {}): VoiceTelemetryEvent => ({
  eventType: "voice.turn_committed", latencyMs: null,
  payload: { voiceSessionId: "synthetic-session", transcriptBufferVersion: 2,
    fromCompletedTurns: sequenceNumber - 1, toCompletedTurns: sequenceNumber,
    transcriptCharacters: chars, ...override },
});

test("detects shorter browser text while retaining independently saved answer length", () => {
  const summary = diagnoseVoiceTranscripts([turn()], [checkpoint(1, 3)]);
  assert.deepEqual(summary.turns, [{ sequenceNumber: 1, savedCharacters: 8,
    browserCharacters: 3, status: "DISPLAY_SHORTER", reason: "COMPARABLE" }]);
  assert.equal(summary.differingTurns, 1);
  assert.equal(summary.comparableTurns, 1);
  assert.ok(!JSON.stringify(summary).includes("这是完整"));
});

test("distinguishes equal, longer and zero browser lengths without calling them ASR accuracy", () => {
  const summary = diagnoseVoiceTranscripts([turn(1), turn(2), turn(3)], [checkpoint(1, 8), checkpoint(2, 10), checkpoint(3, 0)]);
  assert.deepEqual(summary.turns.map((row) => row.status), ["LENGTH_MATCH", "DISPLAY_LONGER", "DISPLAY_SHORTER"]);
  assert.equal(summary.differingTurns, 2);
  assert.equal(summary.turns[2].browserCharacters, 0);
});

test("missing telemetry stays unmeasured and only completed voice turns are counted", () => {
  const summary = diagnoseVoiceTranscripts([turn(), { ...turn(2), inputMode: "text" }, { ...turn(3), status: "pending" }], []);
  assert.equal(summary.savedVoiceTurns, 1);
  assert.equal(summary.unmeasuredTurns, 1);
  assert.equal(summary.turns[0].reason, "NO_CHECKPOINT");
  assert.equal(summary.turns[0].browserCharacters, null);
});

test("legacy and skipped-turn checkpoints cannot attribute a stale buffer to a single answer", () => {
  const summary = diagnoseVoiceTranscripts([turn(1), turn(2)], [
    checkpoint(1, 8, { transcriptBufferVersion: undefined }),
    checkpoint(2, 8, { fromCompletedTurns: 0 }),
  ]);
  assert.equal(summary.comparableTurns, 0);
  assert.ok(summary.turns.every((row) => row.reason === "LEGACY_OR_INVALID"));
});

test("rejects malformed, nonfinite, negative and fractional character counts", () => {
  for (const chars of [null, "8", NaN, Infinity, -1, 2.5]) {
    assert.equal(diagnoseVoiceTranscripts([turn()], [checkpoint(1, chars)]).turns[0].status, "UNMEASURED");
  }
});

test("repeated checkpoints do not inflate coverage and conflicting sessions stay unknown", () => {
  const a = checkpoint(1, 8);
  assert.equal(diagnoseVoiceTranscripts([turn()], [a, a]).comparableTurns, 1);
  const summary = diagnoseVoiceTranscripts([turn()], [a, checkpoint(1, 5, { voiceSessionId: "reconnected" })]);
  assert.equal(summary.turns[0].reason, "CONFLICTING_CHECKPOINTS");
});

test("a capped event log does not silently produce a successful comparison", () => {
  const summary = diagnoseVoiceTranscripts([turn()], [checkpoint(1, 8)], true);
  assert.equal(summary.eventsMayBeTruncated, true);
  assert.equal(summary.turns[0].reason, "EVENT_LIMIT");
  assert.equal(summary.comparableTurns, 0);
});

test("length accounting preserves raw whitespace and Unicode without rewriting evidence", () => {
  const raw = " 好🙂。 ";
  const summary = diagnoseVoiceTranscripts([turn(1, raw)], [checkpoint(1, raw.length)]);
  assert.equal(summary.turns[0].savedCharacters, raw.length);
  assert.equal(summary.turns[0].status, "LENGTH_MATCH");
});
