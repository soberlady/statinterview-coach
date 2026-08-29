import assert from "node:assert/strict";
import test from "node:test";
import {
  transitionVoiceStatus,
  VOICE_AGENT_COLD_START_NOTICE_MS,
  VOICE_AGENT_READY_TIMEOUT_MS,
  VOICE_ROOM_CONNECT_OPTIONS,
  voiceStatusHeading,
} from "../app/lib/voice-readiness";

test("room connection waits for remote agent audio before reporting ready", () => {
  const connecting = transitionVoiceStatus("idle", "START");
  const waiting = transitionVoiceStatus(connecting, "ROOM_CONNECTED");

  assert.equal(connecting, "connecting");
  assert.equal(waiting, "waiting_agent");
  assert.equal(voiceStatusHeading(waiting), "正在等待实时面试官");
  assert.notEqual(voiceStatusHeading(waiting), "实时面试官已就绪");
});

test("remote audio is the event that marks the agent ready", () => {
  const ready = transitionVoiceStatus(
    "waiting_agent",
    "AGENT_AUDIO_RECEIVED",
  );

  assert.equal(ready, "connected");
  assert.equal(voiceStatusHeading(ready), "实时面试官已就绪");
});

test("failure falls back to an error state that can be stopped or retried", () => {
  assert.equal(transitionVoiceStatus("waiting_agent", "FAIL"), "error");
  assert.equal(transitionVoiceStatus("connected", "FAIL"), "error");
  assert.equal(transitionVoiceStatus("error", "STOP"), "idle");
  assert.equal(transitionVoiceStatus("muted", "UNMUTE"), "connected");
  assert.equal(VOICE_AGENT_COLD_START_NOTICE_MS, 15_000);
  assert.equal(VOICE_AGENT_READY_TIMEOUT_MS, 45_000);
});

test("weak networks get longer signaling and peer connection retries", () => {
  assert.deepEqual(VOICE_ROOM_CONNECT_OPTIONS, {
    maxRetries: 2,
    peerConnectionTimeout: 30_000,
    websocketTimeout: 20_000,
  });
});
