import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { interviews } from "@/db/schema";
import {
  createLiveKitVoiceCredentials,
  preDispatchLiveKitVoiceAgent,
} from "@/app/lib/livekit-token";
import {
  ApiError,
  errorResponse,
  jsonResponse,
} from "../../../_lib/http";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id: interviewId } = await context.params;
    const [interview] = await getDb()
      .select({ id: interviews.id, status: interviews.status })
      .from(interviews)
      .where(eq(interviews.id, interviewId))
      .limit(1);
    if (!interview) {
      throw new ApiError(
        404,
        "INTERVIEW_NOT_FOUND",
        "Interview was not found.",
      );
    }
    if (["COMPLETED", "CANCELLED"].includes(interview.status)) {
      throw new ApiError(
        409,
        "INTERVIEW_NOT_ACTIVE",
        "This interview can no longer join a voice room.",
      );
    }

    const serverUrl = process.env.LIVEKIT_URL?.trim();
    const apiKey = process.env.LIVEKIT_API_KEY?.trim();
    const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();
    if (!serverUrl || !apiKey || !apiSecret) {
      throw new ApiError(
        503,
        "VOICE_NOT_CONFIGURED",
        "实时语音尚未配置；文本诊断仍可正常使用。",
      );
    }
    if (!/^wss?:\/\//i.test(serverUrl)) {
      throw new ApiError(
        500,
        "VOICE_CONFIGURATION_INVALID",
        "LIVEKIT_URL must use ws:// or wss://.",
      );
    }

    const credentials = await createLiveKitVoiceCredentials({
      serverUrl,
      apiKey,
      apiSecret,
      interviewId,
    });
    let agentPreDispatched = false;
    try {
      await preDispatchLiveKitVoiceAgent({
        serverUrl,
        apiKey,
        apiSecret,
        interviewId,
        voiceSessionId: credentials.voiceSessionId,
        roomName: credentials.roomName,
      });
      agentPreDispatched = true;
    } catch {
      // The token retains a room-creation dispatch, so voice can still connect.
      console.warn(
        "LiveKit Agent pre-dispatch failed; falling back to token dispatch.",
      );
    }

    return jsonResponse({ ...credentials, agentPreDispatched });
  } catch (error) {
    return errorResponse(error);
  }
}
