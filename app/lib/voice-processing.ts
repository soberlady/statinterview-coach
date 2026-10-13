export const VOICE_SAVE_CONFIRM_TIMEOUT_MS = 75_000;
export const voiceProcessingLabels = {
  listening: "等待回答",
  transcribing: "正在整理最终转写",
  scoring: "正在评分并保存",
  saved: "回答已保存，准备下一题",
  recovery: "尚未确认保存，请核对转写",
} as const;
export type VoiceProcessingStage = keyof typeof voiceProcessingLabels;

export const VOICE_SYNC_GRACE_MS = 5_000;
export type VoiceSyncMismatch = { signature: string; startedAt: number };

export function assessVoiceSync(
  value: unknown, questionId: string | null, sequenceNumber: number,
  pending: VoiceSyncMismatch | null, now: number,
): { stage: VoiceProcessingStage | null; pending: VoiceSyncMismatch | null; disconnect: boolean } {
  const stage = parseVoiceProcessing(value, questionId, sequenceNumber);
  if (stage) return { stage, pending: null, disconnect: false };
  const signature = JSON.stringify([questionId, sequenceNumber]);
  const mismatch = pending?.signature === signature ? pending : { signature, startedAt: now };
  return { stage: null, pending: mismatch, disconnect: now - mismatch.startedAt >= VOICE_SYNC_GRACE_MS };
}

export function parseVoiceProcessing(
  value: unknown, questionId: string | null, sequenceNumber: number,
): VoiceProcessingStage | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Record<string, unknown>;
  if (state.questionId !== questionId || state.sequenceNumber !== sequenceNumber) return null;
  return typeof state.stage === "string" && Object.hasOwn(voiceProcessingLabels, state.stage)
    ? state.stage as VoiceProcessingStage : null;
}
