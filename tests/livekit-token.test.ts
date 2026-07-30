import assert from "node:assert/strict";
import test from "node:test";
import { createLiveKitVoiceCredentials } from "../app/lib/livekit-token";

test("voice token is room-scoped and explicitly dispatches the Agent", async () => {
  const credentials = await createLiveKitVoiceCredentials({
    serverUrl: "wss://example.livekit.cloud",
    apiKey: "api-key",
    apiSecret: "a-test-secret-long-enough-for-hmac",
    interviewId: "int_fixture",
    participantIdentity: "candidate-fixture",
  });
  const payload = decodeJwt(credentials.participantToken);
  const video = payload.video as Record<string, unknown>;
  const roomConfig = payload.roomConfig as {
    agents?: Array<{ agentName?: string; metadata?: string }>;
  };

  assert.equal(credentials.roomName, "statinterview--int_fixture");
  assert.equal(credentials.participantIdentity, "candidate-fixture");
  assert.equal(payload.sub, "candidate-fixture");
  assert.equal(video.room, "statinterview--int_fixture");
  assert.equal(video.roomJoin, true);
  assert.equal(video.canPublish, true);
  assert.equal(video.canSubscribe, true);
  assert.equal(
    roomConfig.agents?.[0]?.agentName,
    "statinterview-coach",
  );
  assert.match(
    roomConfig.agents?.[0]?.metadata ?? "",
    /"interviewId":"int_fixture"/,
  );
});

function decodeJwt(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  assert.ok(payload);
  return JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  ) as Record<string, unknown>;
}
