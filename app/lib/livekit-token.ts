import {
  AccessToken,
  AgentDispatchClient,
  RoomAgentDispatch,
  RoomConfiguration,
} from "livekit-server-sdk";

export const LIVEKIT_VOICE_AGENT_NAME = "statinterview-coach";

type DispatchClient = Pick<AgentDispatchClient, "createDispatch">;

function createVoiceMetadata(interviewId: string, voiceSessionId: string) {
  return JSON.stringify({
    interviewId,
    voiceSessionId,
    transport: "browser_voice",
  });
}

export function liveKitHttpUrl(serverUrl: string) {
  const url = new URL(serverUrl);
  if (url.protocol === "wss:") url.protocol = "https:";
  if (url.protocol === "ws:") url.protocol = "http:";
  return url.toString().replace(/\/$/, "");
}

/**
 * Start the Agent before the browser finishes joining the room. The access
 * token still carries the same dispatch as a fallback if this request fails.
 */
export async function preDispatchLiveKitVoiceAgent(
  input: {
    serverUrl: string;
    apiKey: string;
    apiSecret: string;
    interviewId: string;
    voiceSessionId: string;
    roomName: string;
  },
  createClient: (
    host: string,
    apiKey: string,
    apiSecret: string,
  ) => DispatchClient = (host, apiKey, apiSecret) =>
    new AgentDispatchClient(host, apiKey, apiSecret, {
      requestTimeout: 1_500,
    }),
) {
  const client = createClient(
    liveKitHttpUrl(input.serverUrl),
    input.apiKey,
    input.apiSecret,
  );
  return client.createDispatch(input.roomName, LIVEKIT_VOICE_AGENT_NAME, {
    metadata: createVoiceMetadata(input.interviewId, input.voiceSessionId),
  });
}

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
  const metadata = createVoiceMetadata(input.interviewId, voiceSessionId);
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
    canPublishData: true, // Question-bound finish/repeat RPC to this room's Agent.
  });
  token.roomConfig = new RoomConfiguration({
    agents: [
      new RoomAgentDispatch({
        agentName: LIVEKIT_VOICE_AGENT_NAME,
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
