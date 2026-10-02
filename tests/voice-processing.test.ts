import assert from "node:assert/strict";
import test from "node:test";
import { parseVoiceProcessing, VOICE_SAVE_CONFIRM_TIMEOUT_MS } from "../app/lib/voice-processing";

test("processing updates only apply to the current question and turn", () => {
  assert.equal(parseVoiceProcessing({ stage: "scoring", questionId: "q2", sequenceNumber: 2 }, "q2", 2), "scoring");
  assert.equal(parseVoiceProcessing({ stage: "saved", questionId: "q1", sequenceNumber: 1 }, "q2", 2), null);
  assert.equal(parseVoiceProcessing({ stage: "invented", questionId: "q2", sequenceNumber: 2 }, "q2", 2), null);
  assert.equal(parseVoiceProcessing(null, "q2", 2), null);
});

test("browser confirmation budget covers worker submission and recovery", () => {
  assert.ok(VOICE_SAVE_CONFIRM_TIMEOUT_MS >= (5 + 0.5 + 55 + 10) * 1000);
});
