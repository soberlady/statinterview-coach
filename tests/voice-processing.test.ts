import assert from "node:assert/strict";
import test from "node:test";
import { assessVoiceSync, parseVoiceProcessing, VOICE_SAVE_CONFIRM_TIMEOUT_MS, VOICE_SYNC_GRACE_MS } from "../app/lib/voice-processing";

test("a turn committed between polling and RPC is a transition, not an immediate disconnect", () => {
  const next = { stage: "saved", questionId: "q8", sequenceNumber: 8 };
  const first = assessVoiceSync(next, "q7", 7, null, 100);
  assert.equal(first.disconnect, false);
  const settled = assessVoiceSync(next, "q8", 8, first.pending, 200);
  assert.equal(settled.stage, "saved");
  assert.equal(settled.pending, null);
});

test("final-answer completion settles to a null question without a false mismatch", () => {
  const terminal = { stage: "saved", questionId: null, sequenceNumber: 10 };
  const race = assessVoiceSync(terminal, "last-question", 9, null, 100);
  assert.equal(race.disconnect, false);
  const completed = assessVoiceSync(terminal, null, 10, race.pending, 200);
  assert.equal(completed.disconnect, false);
  assert.equal(completed.stage, "saved");
});

test("only persistent mismatch at the same checkpoint disconnects", () => {
  const wrong = { stage: "listening", questionId: "wrong", sequenceNumber: 7 };
  const first = assessVoiceSync(wrong, "q7", 7, null, 100);
  assert.equal(assessVoiceSync(wrong, "q7", 7, first.pending, 100 + VOICE_SYNC_GRACE_MS - 1).disconnect, false);
  assert.equal(assessVoiceSync(wrong, "q7", 7, first.pending, 100 + VOICE_SYNC_GRACE_MS).disconnect, true);
  assert.equal(assessVoiceSync(wrong, "q8", 8, first.pending, 100 + VOICE_SYNC_GRACE_MS).disconnect, false);
});

test("processing updates only apply to the current question and turn", () => {
  assert.equal(parseVoiceProcessing({ stage: "scoring", questionId: "q2", sequenceNumber: 2 }, "q2", 2), "scoring");
  assert.equal(parseVoiceProcessing({ stage: "saved", questionId: "q1", sequenceNumber: 1 }, "q2", 2), null);
  assert.equal(parseVoiceProcessing({ stage: "invented", questionId: "q2", sequenceNumber: 2 }, "q2", 2), null);
  assert.equal(parseVoiceProcessing(null, "q2", 2), null);
});

test("browser confirmation budget covers worker submission and recovery", () => {
  assert.ok(VOICE_SAVE_CONFIRM_TIMEOUT_MS >= (5 + 0.5 + 55 + 10) * 1000);
});
