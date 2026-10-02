import assert from "node:assert/strict";
import test from "node:test";
import {
  createLiveKitVoiceCredentials,
  liveKitHttpUrl,
  preDispatchLiveKitVoiceAgent,
} from "../app/lib/livekit-token";

test("voice token is reconnect-safe and explicitly dispatches the Agent", async () => {
  const credentials = await createLiveKitVoiceCredentials({
    serverUrl: "wss://example.livekit.cloud",
    apiKey: "api-key",
    apiSecret: "a-test-secret-long-enough-for-hmac",
    interviewId: "int_fixture",
    participantIdentity: "candidate-fixture",
    voiceSessionId: "voice-fixture",
  });

  const payload = decodeJwt(credentials.participantToken);
  const video = payload.video as Record<string, unknown>;
  const roomConfig = payload.roomConfig as {
    agents?: Array<{ agentName?: string; metadata?: string }>;
  };

  assert.equal(
    credentials.roomName,
    "statinterview--int_fixture--voice-fixture",
  );
  assert.equal(credentials.participantIdentity, "candidate-fixture");
  assert.equal(credentials.voiceSessionId, "voice-fixture");
  assert.equal(payload.sub, "candidate-fixture");
  assert.equal(video.room, "statinterview--int_fixture--voice-fixture");
  assert.equal(video.roomJoin, true);
  assert.equal(video.canPublish, true);
  assert.equal(video.canSubscribe, true);
  assert.equal(video.canPublishData, true);
  assert.equal(
    roomConfig.agents?.[0]?.agentName,
    "statinterview-coach",
  );
  assert.match(
    roomConfig.agents?.[0]?.metadata ?? "",
    /"interviewId":"int_fixture"/,
  );
  assert.match(
    roomConfig.agents?.[0]?.metadata ?? "",
    /"voiceSessionId":"voice-fixture"/,
  );
});

test("each reconnect uses a fresh room for a new Agent dispatch", async () => {
  const input = {
    serverUrl: "wss://example.livekit.cloud",
    apiKey: "api-key",
    apiSecret: "a-test-secret-long-enough-for-hmac",
    interviewId: "int_fixture",
    participantIdentity: "candidate-fixture",
  };

  const first = await createLiveKitVoiceCredentials(input);
  const second = await createLiveKitVoiceCredentials(input);

  assert.notEqual(first.roomName, second.roomName);
  assert.match(first.roomName, /^statinterview--int_fixture--[0-9a-f-]{36}$/);
  assert.match(second.roomName, /^statinterview--int_fixture--[0-9a-f-]{36}$/);
});

test("Agent pre-dispatch starts the worker before the participant joins", async () => {
  const calls: unknown[][] = [];
  const result = await preDispatchLiveKitVoiceAgent(
    {
      serverUrl: "wss://example.livekit.cloud",
      apiKey: "api-key",
      apiSecret: "api-secret",
      interviewId: "int_fixture",
      voiceSessionId: "voice-fixture",
      roomName: "room-fixture",
    },
    (host, apiKey, apiSecret) => {
      calls.push([host, apiKey, apiSecret]);
      return {
        async createDispatch(...args: unknown[]) {
          calls.push(args);
          return { id: "dispatch-fixture" } as never;
        },
      };
    },
  );

  assert.deepEqual(calls[0], [
    "https://example.livekit.cloud",
    "api-key",
    "api-secret",
  ]);
  assert.deepEqual(calls[1], [
    "room-fixture",
    "statinterview-coach",
    {
      metadata:
        '{"interviewId":"int_fixture","voiceSessionId":"voice-fixture","transport":"browser_voice"}',
    },
  ]);
  assert.deepEqual(result, { id: "dispatch-fixture" });
  assert.equal(liveKitHttpUrl("ws://localhost:7880/"), "http://localhost:7880");
});

function decodeJwt(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  assert.ok(payload);
  return JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  ) as Record<string, unknown>;
}
