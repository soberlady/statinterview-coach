export const VOICE_SAVE_CONFIRM_TIMEOUT_MS = 75_000;
export const voiceProcessingLabels = {
  listening: "等待回答",
  transcribing: "正在整理最终转写",
  scoring: "正在评分并保存",
  saved: "回答已保存，准备下一题",
  recovery: "尚未确认保存，请核对转写",
} as const;
export type VoiceProcessingStage = keyof typeof voiceProcessingLabels;

export function parseVoiceProcessing(
  value: unknown, questionId: string | null, sequenceNumber: number,
): VoiceProcessingStage | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Record<string, unknown>;
  if (state.questionId !== questionId || state.sequenceNumber !== sequenceNumber) return null;
  return typeof state.stage === "string" && Object.hasOwn(voiceProcessingLabels, state.stage)
    ? state.stage as VoiceProcessingStage : null;
}
