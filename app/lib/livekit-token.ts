import { RoomAgentDispatch, RoomConfiguration } from "@livekit/protocol";
import { AccessToken } from "livekit-server-sdk";

export async function createLiveKitVoiceCredentials(input: {
  serverUrl: string;
  apiKey: string;
  apiSecret: string;
  interviewId: string;
  participantIdentity?: string;
  voiceSessionId?: string;
}) {
  const voiceSessionId = input.voiceSessionId ?? crypto.randomUUID();
  const roomName = `statinterview--${input.interviewId}--${voiceSessionId}`;
  const participantIdentity =
    input.participantIdentity ?? `candidate-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({
    interviewId: input.interviewId,
    voiceSessionId,
    transport: "browser_voice",
  });
  const token = new AccessToken(input.apiKey, input.apiSecret, {
    identity: participantIdentity,
    name: "Candidate",
    metadata,
    ttl: "20m",
  });
  token.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: false,
  });
  token.roomConfig = new RoomConfiguration({
    agents: [
      new RoomAgentDispatch({
        agentName: "statinterview-coach",
        metadata,
      }),
    ],
  });

  return {
    serverUrl: input.serverUrl,
    participantToken: await token.toJwt(),
    roomName,
    participantIdentity,
    voiceSessionId,
    expiresInSeconds: 1_200,
  };
}
