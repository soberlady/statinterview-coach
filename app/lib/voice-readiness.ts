export const VOICE_AGENT_READY_TIMEOUT_MS = 15_000;

export type VoiceStatus =
  | "idle"
  | "connecting"
  | "waiting_agent"
  | "connected"
  | "muted"
  | "unavailable"
  | "error";

export type VoiceStatusEvent =
  | "START"
  | "ROOM_CONNECTED"
  | "AGENT_AUDIO_RECEIVED"
  | "MUTE"
  | "UNMUTE"
  | "FAIL"
  | "STOP";

export function transitionVoiceStatus(
  status: VoiceStatus,
  event: VoiceStatusEvent,
): VoiceStatus {
  switch (event) {
    case "START":
      return "connecting";
    case "ROOM_CONNECTED":
      return "waiting_agent";
    case "AGENT_AUDIO_RECEIVED":
      return "connected";
    case "MUTE":
      return status === "connected" ? "muted" : status;
    case "UNMUTE":
      return status === "muted" ? "connected" : status;
    case "FAIL":
      return "error";
    case "STOP":
      return "idle";
  }
}

export function voiceStatusHeading(status: VoiceStatus): string {
  switch (status) {
    case "connecting":
      return "正在连接语音房间";
    case "waiting_agent":
      return "正在等待实时面试官";
    case "connected":
      return "实时面试官已就绪";
    case "muted":
      return "麦克风已静音";
    case "error":
      return "实时语音暂不可用";
    case "unavailable":
      return "实时语音未配置";
    case "idle":
      return "实时语音未连接";
  }
}

