"use client";

import Link from "next/link";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import type { GuidedDemoPayload } from "@/app/lib/guided-demo";
import {
  transitionVoiceStatus,
  VOICE_AGENT_COLD_START_NOTICE_MS,
  VOICE_AGENT_READY_TIMEOUT_MS,
  VOICE_ROOM_CONNECT_OPTIONS,
  voiceStatusHeading,
  type VoiceStatus,
} from "@/app/lib/voice-readiness";

type PublicQuestion = {
  id: string;
  sourceQuestionId: string;
  skill: string;
  skillLabel: string;
  text: string;
  difficulty: number;
  expectedSeconds: number;
  questionType: "anchor" | "adaptive" | "verification";
};

type Evaluation = {
  totalScore: number;
  reliability: "HIGH" | "MEDIUM" | "LOW";
  action: "ACCEPT" | "VERIFY" | "ABSTAIN";
  evidence: string[];
  strengths: string[];
  gaps: string[];
  disclaimer: string;
};

type Progress = {
  completedTurns: number;
  substantiveTurns: number;
  targetSubstantiveTurns: number;
  hasNext?: boolean;
};

type AgentDecision = {
  action: "ACCEPT" | "VERIFY" | "ABSTAIN" | "COMPLETE";
  reason: string;
  utility: number | null;
};

type ApiErrorBody = {
  error?: {
    message?: string;
  };
};

type NextQuestionResponse = ApiErrorBody & {
  interview?: {
    status: string;
    currentStage: string;
    mode: string;
  };
  nextQuestion?: PublicQuestion | null;
  decision?: AgentDecision;
  progress?: Progress;
  demo?: GuidedDemoPayload | null;
};

type TurnResponse = NextQuestionResponse & {
  evaluation?: Evaluation;
};

type VoiceTokenResponse = ApiErrorBody & {
  serverUrl?: string;
  participantToken?: string;
  participantIdentity?: string;
  roomName?: string;
  voiceSessionId?: string;
};

type VoiceTranscriptStatus = "waiting" | "interim" | "final" | "saved";

type VoiceEventInput = {
  eventType: string;
  latencyMs?: number;
  idempotencyKey?: string;
  payload: Record<string, unknown>;
};

const flowLabels = [
  "统计与机器学习",
  "实验与因果",
  "SQL 与 Python",
  "业务分析",
  "自适应诊断",
  "自适应复核",
];

export function InterviewRoom({ interviewId }: { interviewId: string }) {
  const router = useRouter();
  const [question, setQuestion] = useState<PublicQuestion | null>(null);
  const [answer, setAnswer] = useState("");
  const [phase, setPhase] = useState("PREPARING");
  const [progress, setProgress] = useState<Progress>({
    completedTurns: 0,
    substantiveTurns: 0,
    targetSubstantiveTurns: 6,
  });
  const [decision, setDecision] = useState<AgentDecision | null>(null);
  const [interviewMode, setInterviewMode] = useState("diagnostic");
  const [demoGuide, setDemoGuide] = useState<GuidedDemoPayload | null>(null);
  const [lastEvaluation, setLastEvaluation] = useState<Evaluation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [error, setError] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [startedAt, setStartedAt] = useState(() => new Date().toISOString());
  const [inputChannel, setInputChannel] = useState<"text" | "voice">("text");
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("idle");
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [voiceTranscriptStatus, setVoiceTranscriptStatus] =
    useState<VoiceTranscriptStatus>("waiting");
  const [voiceMessage, setVoiceMessage] = useState(
    "连接后，原始最终转写会进入同一套选题、验证与报告流程。",
  );
  const voiceRoomRef = useRef<import("livekit-client").Room | null>(null);
  const remoteAudioRef = useRef<HTMLDivElement | null>(null);
  const voiceTranscriptSegmentsRef = useRef(new Map<string, string>());
  const voiceTranscriptSavedRef = useRef(false);
  const voiceCompletedTurnsRef = useRef(0);
  const voiceSessionIdRef = useRef<string | null>(null);
  const voiceSessionStartedAtRef = useRef<number | null>(null);
  const voiceFinalTranscriptAtRef = useRef<number | null>(null);
  const voiceReconnectStartedAtRef = useRef<number | null>(null);
  const voiceExpectedDisconnectRef = useRef(false);
  const voiceAgentReadyRef = useRef(false);
  const voiceAgentIdentityRef = useRef<string | null>(null);
  const voiceAgentReadyTimerRef = useRef<number | null>(null);
  const voiceAgentLostRecordedRef = useRef(false);

  const recordVoiceEvent = useCallback(
    (event: VoiceEventInput) => {
      void fetch(`/api/interviews/${interviewId}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
      }).catch(() => {
        // Observability must never interrupt the interview experience.
      });
    },
    [interviewId],
  );

  const updateLifecycle = useCallback(
    async (target: "PAUSED" | "RECOVERING" | "COMPLETED") => {
      const response = await fetch(`/api/interviews/${interviewId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: target, currentStage: target }),
      });
      const result = (await response.json()) as ApiErrorBody;
      if (!response.ok) {
        throw new Error(
          result.error?.message ?? "面试状态保存失败，请稍后重试。",
        );
      }
    },
    [interviewId],
  );

  useEffect(() => {
    let cancelled = false;

    async function restoreInterview() {
      try {
        const response = await fetch(
          `/api/interviews/${interviewId}/next-question`,
          { cache: "no-store" },
        );
        const result = (await response.json()) as NextQuestionResponse;
        if (!response.ok) {
          throw new Error(
            result.error?.message ?? "无法恢复本次面试，请返回首页重试。",
          );
        }
        if (cancelled) return;
        const restoredStatus = result.interview?.status;
        setInterviewMode(result.interview?.mode ?? "diagnostic");
        setDemoGuide(result.demo ?? null);
        if (restoredStatus === "CANCELLED") {
          throw new Error("本次诊断已经取消，请返回首页重新创建。");
        }
        if (!result.nextQuestion) {
          const finalizableStatuses = new Set([
            "COMPLETED",
            "FINALIZING",
            "PAUSED",
            "RECOVERING",
          ]);
          if (!restoredStatus || !finalizableStatuses.has(restoredStatus)) {
            throw new Error(
              "选题策略没有返回下一题，但当前诊断尚未完成，请刷新后重试。",
            );
          }
          if (
            restoredStatus === "FINALIZING" ||
            restoredStatus === "PAUSED" ||
            restoredStatus === "RECOVERING"
          ) {
            await updateLifecycle("COMPLETED");
          }
          setQuestion(null);
          setPhase("COMPLETED");
          return;
        }
        if (restoredStatus === "PAUSED") {
          await updateLifecycle("RECOVERING");
        }
        if (cancelled) return;
        setQuestion(result.nextQuestion);
        if (result.progress) setProgress(result.progress);
        setDecision(result.decision ?? null);
        setPhase(
          result.nextQuestion
            ? stageForQuestion(result.nextQuestion.questionType)
            : "COMPLETED",
        );
      } catch (restoreError) {
        if (!cancelled) {
          setError(
            restoreError instanceof Error
              ? restoreError.message
              : "无法恢复本次面试，请返回首页重试。",
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void restoreInterview();
    return () => {
      cancelled = true;
    };
  }, [interviewId, updateLifecycle]);

  useEffect(() => {
    const timer = window.setInterval(
      () => setElapsedSeconds((current) => current + 1),
      1000,
    );
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    return () => {
      if (voiceAgentReadyTimerRef.current !== null) {
        window.clearTimeout(voiceAgentReadyTimerRef.current);
      }
      voiceExpectedDisconnectRef.current = true;
      void voiceRoomRef.current?.disconnect();
      voiceRoomRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (inputChannel !== "voice" || voiceStatus === "idle") return;
    let cancelled = false;
    let timer: number | undefined;
    const controller = new AbortController();

    async function syncVoiceState() {
      try {
        const response = await fetch(
          `/api/interviews/${interviewId}/next-question`,
          { cache: "no-store", signal: controller.signal },
        );
        const result = (await response.json()) as NextQuestionResponse;
        if (!response.ok || cancelled) return;
        if (result.progress) {
          setProgress(result.progress);
          if (
            result.progress.completedTurns > voiceCompletedTurnsRef.current
          ) {
            const previousCompletedTurns = voiceCompletedTurnsRef.current;
            const committedAt = performance.now();
            const transcriptStartedAt = voiceFinalTranscriptAtRef.current;
            const voiceSessionId = voiceSessionIdRef.current;
            if (voiceSessionId) {
              recordVoiceEvent({
                eventType: "voice.turn_committed",
                latencyMs:
                  transcriptStartedAt === null
                    ? undefined
                    : Math.max(
                        0,
                        Math.round(committedAt - transcriptStartedAt),
                      ),
                idempotencyKey:
                  `client:voice:${voiceSessionId}:turn:` +
                  result.progress.completedTurns,
                payload: {
                  voiceSessionId,
                  fromCompletedTurns: previousCompletedTurns,
                  toCompletedTurns: result.progress.completedTurns,
                  nextQuestionId: result.nextQuestion?.id ?? null,
                  transcriptCharacters: Array.from(
                    voiceTranscriptSegmentsRef.current.values(),
                  ).join(" ").length,
                  measurement: "final-transcript-to-browser-checkpoint",
                },
              });
            }
            voiceCompletedTurnsRef.current = result.progress.completedTurns;
            voiceFinalTranscriptAtRef.current = null;
            voiceTranscriptSavedRef.current = true;
            setVoiceTranscriptStatus("saved");
            setVoiceMessage(
              "本题回答已保存。Agent 正在准备追问或下一题；听完后请重新开启麦克风。",
            );
          }
        }
        if (result.decision) setDecision(result.decision);
        if (result.nextQuestion) {
          setQuestion(result.nextQuestion);
          setPhase(stageForQuestion(result.nextQuestion.questionType));
        } else if (
          (result.progress?.substantiveTurns ?? 0) >=
          (result.progress?.targetSubstantiveTurns ?? 6)
        ) {
          setQuestion(null);
          setPhase("COMPLETED");
          voiceExpectedDisconnectRef.current = true;
          await voiceRoomRef.current?.disconnect();
          voiceRoomRef.current = null;
        }
      } catch {
        // Realtime media can continue through transient polling failures.
      } finally {
        if (!cancelled) {
          timer = window.setTimeout(syncVoiceState, 1_000);
        }
      }
    }

    void syncVoiceState();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [inputChannel, interviewId, recordVoiceEvent, voiceStatus]);

  const elapsedLabel = useMemo(() => {
    const minutes = Math.floor(elapsedSeconds / 60)
      .toString()
      .padStart(2, "0");
    const seconds = (elapsedSeconds % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}`;
  }, [elapsedSeconds]);

  async function submitAnswer(event: FormEvent) {
    event.preventDefault();
    if (answer.trim().length < 10 || !question) {
      setError("请至少写下两三句话，说明你的判断依据。");
      return;
    }

    setError("");
    setIsSaving(true);

    try {
      const response = await fetch(`/api/interviews/${interviewId}/turns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sequenceNumber: progress.completedTurns + 1,
          questionId: question.id,
          answerText: answer.trim(),
          startedAt,
          completedAt: new Date().toISOString(),
        }),
      });
      const result = (await response.json()) as TurnResponse;
      if (!response.ok) {
        throw new Error(result.error?.message ?? "回答保存失败，请重试。");
      }

      if (result.evaluation) setLastEvaluation(result.evaluation);
      if (result.progress) setProgress(result.progress);
      if (result.interview?.mode) setInterviewMode(result.interview.mode);
      setDemoGuide(result.demo ?? null);
      setDecision(result.decision ?? null);
      setAnswer("");
      setStartedAt(new Date().toISOString());

      if (!result.nextQuestion) {
        setPhase("FINALIZING");
        const completionResponse = await fetch(`/api/interviews/${interviewId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "COMPLETED",
            currentStage: "COMPLETED",
          }),
        });
        if (!completionResponse.ok) {
          const completionResult =
            (await completionResponse.json()) as ApiErrorBody;
          throw new Error(
            completionResult.error?.message ?? "报告生成前的状态保存失败。",
          );
        }
        setQuestion(null);
        setPhase("COMPLETED");
        return;
      }

      setQuestion(result.nextQuestion);
      setPhase(stageForQuestion(result.nextQuestion.questionType));
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "回答保存失败，请重试。",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function exitAndPause() {
    setError("");
    setIsExiting(true);
    try {
      await updateLifecycle("PAUSED");
      await voiceRoomRef.current?.disconnect();
      voiceRoomRef.current = null;
      router.push("/");
    } catch (pauseError) {
      setError(
        pauseError instanceof Error
          ? pauseError.message
          : "进度暂停失败，请稍后重试。",
      );
      setIsExiting(false);
    }
  }

  async function startVoiceInterview() {
    const connectionStartedAt = performance.now();
    const clientAttemptId = crypto.randomUUID();
    let requestedVoiceSessionId: string | null = null;
    setError("");
    setVoiceStatus((current) => transitionVoiceStatus(current, "START"));
    setVoiceTranscript("");
    setVoiceTranscriptStatus("waiting");
    voiceTranscriptSegmentsRef.current.clear();
    voiceTranscriptSavedRef.current = false;
    voiceCompletedTurnsRef.current = progress.completedTurns;
    voiceSessionIdRef.current = null;
    voiceSessionStartedAtRef.current = null;
    voiceFinalTranscriptAtRef.current = null;
    voiceReconnectStartedAtRef.current = null;
    voiceExpectedDisconnectRef.current = false;
    voiceAgentReadyRef.current = false;
    voiceAgentIdentityRef.current = null;
    voiceAgentLostRecordedRef.current = false;
    if (voiceAgentReadyTimerRef.current !== null) {
      window.clearTimeout(voiceAgentReadyTimerRef.current);
      voiceAgentReadyTimerRef.current = null;
    }
    setVoiceMessage("正在申请麦克风并连接实时面试官…");

    try {
      const response = await fetch(
        `/api/interviews/${interviewId}/voice-token`,
        { method: "POST" },
      );
      const credentials = (await response.json()) as VoiceTokenResponse;
      if (
        !response.ok ||
        !credentials.serverUrl ||
        !credentials.participantToken ||
        !credentials.participantIdentity ||
        !credentials.roomName ||
        !credentials.voiceSessionId
      ) {
        const unavailable = response.status === 503;
        setVoiceStatus(unavailable ? "unavailable" : "error");
        throw new Error(
          credentials.error?.message ??
            "实时语音连接失败，请继续使用文本通道。",
        );
      }
      requestedVoiceSessionId = credentials.voiceSessionId;
      voiceSessionIdRef.current = credentials.voiceSessionId;

      const { Room, RoomEvent, Track } = await import("livekit-client");
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });
      room.registerTextStreamHandler(
        "lk.transcription",
        async (reader, participantInfo) => {
          try {
            const text = (await reader.readAll()).trim();
            if (
              !text ||
              participantInfo.identity !== credentials.participantIdentity
            ) {
              return;
            }

            if (voiceTranscriptSavedRef.current) {
              voiceTranscriptSegmentsRef.current.clear();
              voiceTranscriptSavedRef.current = false;
            }
            const attributes = reader.info.attributes ?? {};
            const segmentId =
              attributes["lk.segment_id"] ?? reader.info.id;
            const isFinal =
              attributes["lk.transcription_final"] === "true";
            voiceTranscriptSegmentsRef.current.set(segmentId, text);
            setVoiceTranscript(
              Array.from(voiceTranscriptSegmentsRef.current.values()).join(
                " ",
              ),
            );
            setVoiceTranscriptStatus(isFinal ? "final" : "interim");
            if (isFinal) {
              voiceFinalTranscriptAtRef.current ??= performance.now();
              recordVoiceEvent({
                eventType: "voice.transcript_final",
                idempotencyKey:
                  `client:voice:${credentials.voiceSessionId}:transcript:` +
                  segmentId.slice(0, 64),
                payload: {
                  voiceSessionId: credentials.voiceSessionId,
                  sequenceNumber: voiceCompletedTurnsRef.current + 1,
                  segmentId,
                  transcriptCharacters: text.length,
                },
              });
            }
            setVoiceMessage(
              isFinal
                ? "已生成最终转写，Agent 正在保存回答并选择下一步。"
                : "正在识别你的回答……",
            );
          } catch {
            setVoiceMessage(
              "转写显示暂时中断；语音连接仍在运行，请继续完成回答。",
            );
          }
        },
      );
      const fallBackToText = (
        eventType: "voice.agent_timeout" | "voice.agent_disconnected",
        message: string,
      ) => {
        if (
          voiceRoomRef.current !== room ||
          voiceExpectedDisconnectRef.current
        ) {
          return;
        }
        if (voiceAgentReadyTimerRef.current !== null) {
          window.clearTimeout(voiceAgentReadyTimerRef.current);
          voiceAgentReadyTimerRef.current = null;
        }
        if (
          eventType === "voice.agent_disconnected" &&
          voiceAgentLostRecordedRef.current
        ) {
          return;
        }
        voiceAgentLostRecordedRef.current =
          eventType === "voice.agent_disconnected";
        recordVoiceEvent({
          eventType,
          latencyMs: Math.max(
            0,
            Math.round(performance.now() - connectionStartedAt),
          ),
          idempotencyKey: `client:voice:${credentials.voiceSessionId}:${
            eventType === "voice.agent_timeout"
              ? "agent-timeout"
              : "agent-disconnected"
          }`,
          payload: {
            voiceSessionId: credentials.voiceSessionId,
            roomName: credentials.roomName,
            agentIdentity: voiceAgentIdentityRef.current,
          },
        });
        voiceExpectedDisconnectRef.current = true;
        voiceRoomRef.current = null;
        voiceAgentReadyRef.current = false;
        setVoiceStatus((current) => transitionVoiceStatus(current, "FAIL"));
        setInputChannel("text");
        setVoiceMessage(message);
        void room.disconnect();
      };

      room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
        if (track.kind !== Track.Kind.Audio) return;
        const element = track.attach();
        element.dataset.livekitRemoteAudio = "true";
        remoteAudioRef.current?.appendChild(element);
        if (voiceRoomRef.current !== room || voiceAgentReadyRef.current) return;

        const readyAt = performance.now();
        voiceAgentReadyRef.current = true;
        voiceAgentIdentityRef.current = participant.identity;
        if (voiceAgentReadyTimerRef.current !== null) {
          window.clearTimeout(voiceAgentReadyTimerRef.current);
          voiceAgentReadyTimerRef.current = null;
        }
        recordVoiceEvent({
          eventType: "voice.agent_ready",
          latencyMs: Math.max(0, Math.round(readyAt - connectionStartedAt)),
          idempotencyKey: `client:voice:${credentials.voiceSessionId}:agent-ready`,
          payload: {
            voiceSessionId: credentials.voiceSessionId,
            roomName: credentials.roomName,
            agentIdentity: participant.identity,
          },
        });
        recordVoiceEvent({
          eventType: "voice.first_audio_received",
          latencyMs: Math.max(0, Math.round(readyAt - connectionStartedAt)),
          idempotencyKey: `client:voice:${credentials.voiceSessionId}:first-audio`,
          payload: {
            voiceSessionId: credentials.voiceSessionId,
            roomName: credentials.roomName,
            agentIdentity: participant.identity,
          },
        });
        setVoiceStatus((current) =>
          transitionVoiceStatus(current, "AGENT_AUDIO_RECEIVED"),
        );
        setVoiceMessage(
          "面试官音频已到达。回答结束后停顿，系统会保存最终转写并选择下一题。",
        );
      });
      room.on(
        RoomEvent.TrackUnsubscribed,
        (track, _publication, participant) => {
          track.detach().forEach((element) => element.remove());
          if (
            track.kind === Track.Kind.Audio &&
            participant.identity === voiceAgentIdentityRef.current
          ) {
            fallBackToText(
              "voice.agent_disconnected",
              "实时面试官的音频已中断，已自动切回文本通道。你可以继续作答或重新连接语音。",
            );
          }
        },
      );
      room.on(RoomEvent.ParticipantDisconnected, (participant) => {
        if (participant.identity !== voiceAgentIdentityRef.current) return;
        fallBackToText(
          "voice.agent_disconnected",
          "实时面试官已离开语音房间，已自动切回文本通道。你可以继续作答或重新连接语音。",
        );
      });
      room.on(RoomEvent.Reconnecting, () => {
        voiceReconnectStartedAtRef.current = performance.now();
        setVoiceStatus((current) => transitionVoiceStatus(current, "START"));
        setVoiceMessage("网络正在重连；恢复远端音频前不会显示为已就绪。请稍候…");
      });
      room.on(RoomEvent.Reconnected, () => {
        const reconnectStartedAt = voiceReconnectStartedAtRef.current;
        recordVoiceEvent({
          eventType: "voice.reconnected",
          latencyMs:
            reconnectStartedAt === null
              ? undefined
              : Math.max(0, Math.round(performance.now() - reconnectStartedAt)),
          payload: {
            voiceSessionId: credentials.voiceSessionId,
            roomName: credentials.roomName,
          },
        });
        voiceReconnectStartedAtRef.current = null;
        setVoiceStatus((current) =>
          transitionVoiceStatus(
            current,
            voiceAgentReadyRef.current
              ? "AGENT_AUDIO_RECEIVED"
              : "ROOM_CONNECTED",
          ),
        );
        setVoiceMessage(
          voiceAgentReadyRef.current
            ? "网络已恢复，实时面试官音频已就绪。"
            : "语音房间已恢复，正在等待实时面试官音频…",
        );
      });
      room.on(RoomEvent.Disconnected, (reason) => {
        const sessionStartedAt = voiceSessionStartedAtRef.current;
        recordVoiceEvent({
          eventType: "voice.disconnected",
          latencyMs:
            sessionStartedAt === null
              ? undefined
              : Math.max(0, Math.round(performance.now() - sessionStartedAt)),
          payload: {
            voiceSessionId: credentials.voiceSessionId,
            roomName: credentials.roomName,
            expected: voiceExpectedDisconnectRef.current,
            reason: reason === undefined ? null : String(reason),
          },
        });
        if (voiceRoomRef.current !== room) return;
        if (voiceAgentReadyTimerRef.current !== null) {
          window.clearTimeout(voiceAgentReadyTimerRef.current);
          voiceAgentReadyTimerRef.current = null;
        }
        const expected = voiceExpectedDisconnectRef.current;
        if (!expected && voiceAgentReadyRef.current) {
          recordVoiceEvent({
            eventType: "voice.agent_disconnected",
            idempotencyKey: `client:voice:${credentials.voiceSessionId}:agent-disconnected`,
            payload: {
              voiceSessionId: credentials.voiceSessionId,
              roomName: credentials.roomName,
              agentIdentity: voiceAgentIdentityRef.current,
              reason: reason === undefined ? null : String(reason),
            },
          });
        }
        voiceRoomRef.current = null;
        voiceAgentReadyRef.current = false;
        setVoiceStatus((current) =>
          transitionVoiceStatus(current, expected ? "STOP" : "FAIL"),
        );
        setInputChannel("text");
        setVoiceMessage(
          expected
            ? "语音连接已结束，可以继续使用文本通道。"
            : "语音连接意外中断，已自动切回文本通道。你可以继续作答或重新连接语音。",
        );
      });

      voiceRoomRef.current = room;
      await room.connect(
        credentials.serverUrl,
        credentials.participantToken,
        VOICE_ROOM_CONNECT_OPTIONS,
      );
      await room.startAudio();
      await room.localParticipant.setMicrophoneEnabled(true);
      const connectedAt = performance.now();
      voiceSessionStartedAtRef.current = connectedAt;
      recordVoiceEvent({
        eventType: "voice.connected",
        latencyMs: Math.max(0, Math.round(connectedAt - connectionStartedAt)),
        idempotencyKey: `client:voice:${credentials.voiceSessionId}:connected`,
        payload: {
          voiceSessionId: credentials.voiceSessionId,
          roomName: credentials.roomName,
          completedTurnsAtConnect: progress.completedTurns,
          measurement: "token-request-to-microphone-published",
        },
      });
      setInputChannel("voice");
      if (voiceAgentReadyRef.current) {
        setVoiceStatus((current) =>
          transitionVoiceStatus(current, "AGENT_AUDIO_RECEIVED"),
        );
        setVoiceMessage("面试官音频已到达，可以开始回答。");
      } else {
        setVoiceStatus((current) =>
          transitionVoiceStatus(current, "ROOM_CONNECTED"),
        );
        setVoiceMessage(
          "语音房间已连接，正在唤醒云端面试官；首次连接通常需要 10–20 秒。",
        );
        voiceAgentReadyTimerRef.current = window.setTimeout(() => {
          if (
            voiceRoomRef.current !== room ||
            voiceExpectedDisconnectRef.current ||
            voiceAgentReadyRef.current
          ) {
            return;
          }
          setVoiceMessage(
            "云端面试官仍在唤醒，弱网络会自动尝试 TCP 或加密中继；请再稍候。",
          );
          voiceAgentReadyTimerRef.current = window.setTimeout(() => {
            fallBackToText(
              "voice.agent_timeout",
              "45 秒内仍未收到实时面试官音频，已自动切回文本通道。你可以继续文字作答，或点击重新连接实时语音。",
            );
          }, VOICE_AGENT_READY_TIMEOUT_MS - VOICE_AGENT_COLD_START_NOTICE_MS);
        }, VOICE_AGENT_COLD_START_NOTICE_MS);
      }
    } catch (voiceError) {
      voiceExpectedDisconnectRef.current = true;
      if (voiceAgentReadyTimerRef.current !== null) {
        window.clearTimeout(voiceAgentReadyTimerRef.current);
        voiceAgentReadyTimerRef.current = null;
      }
      recordVoiceEvent({
        eventType: "voice.connection_failed",
        latencyMs: Math.max(
          0,
          Math.round(performance.now() - connectionStartedAt),
        ),
        idempotencyKey: `client:voice-attempt:${clientAttemptId}:failed`,
        payload: {
          clientAttemptId,
          voiceSessionId: requestedVoiceSessionId,
          stage:
            requestedVoiceSessionId === null
              ? "token-or-configuration"
              : "room-or-microphone",
        },
      });
      await voiceRoomRef.current?.disconnect();
      voiceRoomRef.current = null;
      setInputChannel("text");
      setVoiceStatus((current) =>
        current === "unavailable"
          ? current
          : transitionVoiceStatus(current, "FAIL"),
      );
      setVoiceMessage(
        voiceError instanceof Error
          ? voiceError.message
          : "实时语音连接失败，请继续使用文本通道。",
      );
    }
  }

  async function toggleMicrophone() {
    const room = voiceRoomRef.current;
    if (!room || (voiceStatus !== "connected" && voiceStatus !== "muted")) {
      return;
    }
    const shouldEnable = voiceStatus === "muted";
    await room.localParticipant.setMicrophoneEnabled(shouldEnable);
    setVoiceStatus((current) =>
      transitionVoiceStatus(current, shouldEnable ? "UNMUTE" : "MUTE"),
    );
    setVoiceMessage(
      shouldEnable
        ? "麦克风已开启，可以继续回答。"
        : "麦克风已静音；本地不会继续发送声音。",
    );
  }

  async function finishVoiceAnswer() {
    const room = voiceRoomRef.current;
    if (!room || voiceStatus !== "connected") return;
    setVoiceMessage("正在结束本题收音并生成最终转写，请稍候……");
    await new Promise((resolve) => window.setTimeout(resolve, 500));
    await room.localParticipant.setMicrophoneEnabled(false);
    setVoiceStatus("muted");
  }

  async function stopVoiceInterview() {
    if (voiceAgentReadyTimerRef.current !== null) {
      window.clearTimeout(voiceAgentReadyTimerRef.current);
      voiceAgentReadyTimerRef.current = null;
    }
    voiceExpectedDisconnectRef.current = true;
    await voiceRoomRef.current?.disconnect();
    voiceRoomRef.current = null;
    setInputChannel("text");
    voiceAgentReadyRef.current = false;
    setVoiceStatus((current) => transitionVoiceStatus(current, "STOP"));
    setVoiceMessage("语音连接已结束，可以继续使用文本通道。");
  }

  if (isLoading) {
    return (
      <main className="completion-shell">
        <section className="completion-card" aria-live="polite">
          <p className="eyebrow">正在恢复检查点</p>
          <h1>准备你的下一道题…</h1>
          <p>系统正在读取已保存的回答与能力状态。</p>
        </section>
      </main>
    );
  }

  if (phase === "COMPLETED") {
    const isGuidedDemo = interviewMode === "guided_demo";
    return (
      <main className="completion-shell">
        <section className="completion-card">
          <span className="completion-mark" aria-hidden="true">
            ✓
          </span>
          <p className="eyebrow">
            {isGuidedDemo ? "引导演示已完成" : "自适应诊断已完成"}
          </p>
          <h1>回答、决策与能力状态都已保存。</h1>
          {isGuidedDemo ? (
            <p>
              本次全部评分均为明确标记的合成演示夹具，只用于复现
              VERIFY、ABSTAIN、自适应选题与决策回放，不代表真实候选人能力。
            </p>
          ) : (
            <p>
              报告将区分有效证据和待验证项。当前无模型密钥时使用透明的结构化降级评估，
              不会把低可靠性回答写成稳定能力结论。
            </p>
          )}
          <div className="completion-actions">
            <Link className="primary-button link-button" href={`/report/${interviewId}`}>
              查看诊断报告 <span>→</span>
            </Link>
            <Link className="secondary-button" href="/">
              返回首页
            </Link>
          </div>
        </section>
      </main>
    );
  }

  if (!question) {
    return (
      <main className="completion-shell">
        <section className="completion-card">
          <p className="eyebrow">恢复失败</p>
          <h1>暂时没有可用问题。</h1>
          <p>{error || "请返回首页创建一次新的诊断。"}</p>
          <Link className="secondary-button" href="/">
            返回首页
          </Link>
        </section>
      </main>
    );
  }

  const isGuidedDemo = interviewMode === "guided_demo";

  return (
    <main className="room-shell">
      <div className="remote-audio" ref={remoteAudioRef} />
      <header className="room-header">
        <Link className="brand compact" href="/">
          <span className="brand-mark">S</span>
          <strong>StatInterview</strong>
        </Link>
        <div className="room-session">
          <span className="live-dot" />
          {isGuidedDemo
            ? "合成引导演示"
            : inputChannel === "voice"
              ? "LiveKit 实时语音"
              : "文本通道"} ·
          自动检查点
          <strong>{elapsedLabel}</strong>
        </div>
        <button
          className="quiet-button"
          type="button"
          onClick={exitAndPause}
          disabled={isSaving || isExiting}
        >
          {isExiting ? "正在保存…" : "暂停并退出"}
        </button>
      </header>

      <section className="room-layout">
        <aside className="room-progress">
          <p className="card-index">DIAGNOSTIC FLOW</p>
          <h2>能力诊断</h2>
          <p>四道固定锚点建立基线，两道自适应题减少最大的不确定性。</p>
          <ol>
            {flowLabels.map((label, index) => (
              <li
                className={
                  index === progress.substantiveTurns
                    ? "active"
                    : index < progress.substantiveTurns
                      ? "complete"
                      : ""
                }
                key={label}
              >
                <span>{index < progress.substantiveTurns ? "✓" : index + 1}</span>
                <div>
                  <strong>{label}</strong>
                  <small>
                    {index === progress.substantiveTurns
                      ? question.questionType === "verification"
                        ? "追问验证中"
                        : "正在评估"
                      : index < progress.substantiveTurns
                        ? "已保存"
                        : "等待中"}
                  </small>
                </div>
              </li>
            ))}
          </ol>
          <div className="privacy-box">
            <strong>内容评分原则</strong>
            <p>只评估回答中的知识与证据，不分析面部、声音特征或情绪。</p>
          </div>
        </aside>

        <section className="question-stage">
          {isGuidedDemo && demoGuide ? (
            <section className="guided-demo-panel" aria-label="引导演示步骤">
              <div>
                <span>DETERMINISTIC DEMO · {demoGuide.version}</span>
                <strong>{demoGuide.step}</strong>
                <p>{demoGuide.instruction}</p>
              </div>
              <em>合成数据，不计入真实评测</em>
            </section>
          ) : null}

          <div className="agent-presence">
            <div className="agent-orb" aria-hidden="true">
              <span />
            </div>
            <div>
              <strong>AI 面试官</strong>
              <small>{questionTypeLabel(question.questionType)}</small>
            </div>
          </div>

          <div className="question-card">
            <div className="question-meta">
              <span>{questionTypeLabel(question.questionType)}</span>
              <span>{question.skillLabel}</span>
              <span>难度 {question.difficulty} / 5</span>
            </div>
            <h1>{question.text}</h1>
            <p>
              不需要追求标准答案。请说明判断过程、需要的数据、判断标准以及如何验证结论。
            </p>
          </div>

          {inputChannel === "text" ? (
            <form className="answer-composer" onSubmit={submitAnswer}>
              <div className="composer-heading">
                <label htmlFor="answer">你的回答</label>
                {isGuidedDemo ? (
                  <span className="demo-channel-label">固定演示评分通道</span>
                ) : (
                  <button
                    className="channel-switch"
                    type="button"
                    onClick={startVoiceInterview}
                    disabled={voiceStatus === "connecting"}
                  >
                    {voiceStatus === "connecting"
                      ? "正在连接…"
                      : voiceStatus === "error"
                        ? "重新连接实时语音"
                        : "切换到实时语音"}
                  </button>
                )}
              </div>
              {isGuidedDemo && demoGuide ? (
                <div className="demo-answer-options">
                  {demoGuide.answerOptions.map((option) => (
                    <button
                      type="button"
                      key={option.id}
                      className={option.recommended ? "recommended" : ""}
                      onClick={() => setAnswer(option.answer)}
                      disabled={isSaving}
                    >
                      <span>
                        {option.label}
                        {option.recommended ? <b>推荐步骤</b> : null}
                      </span>
                      <small>{option.description}</small>
                    </button>
                  ))}
                </div>
              ) : null}
              <textarea
                id="answer"
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                placeholder={
                  isGuidedDemo
                    ? "请从上方载入推荐演示回答；你也可以修改，但修改后只运行结构化降级反馈。"
                    : "当前为可恢复的文本通道。建议按“假设—数据—判断标准—验证动作”组织答案。"
                }
                rows={7}
                disabled={isSaving}
              />
              <div className="composer-footer">
                <span>{answer.trim().length} 字</span>
                {error ? <p role="alert">{error}</p> : null}
                {voiceStatus === "unavailable" ||
                voiceStatus === "error" ? (
                  <p role="status">{voiceMessage}</p>
                ) : null}
                <button
                  className="primary-button compact-button"
                  disabled={isSaving}
                >
                  {isSaving ? "评估并选题中…" : "提交回答"}
                  <span>→</span>
                </button>
              </div>
            </form>
          ) : (
            <section className="voice-console" aria-live="polite">
              <div className="voice-pulse" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </div>
              <div className="voice-copy">
                <span>LIVEKIT VOICE CHANNEL</span>
                <strong>{voiceStatusHeading(voiceStatus)}</strong>
                <p>{voiceMessage}</p>
              </div>
              <div className="voice-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={toggleMicrophone}
                  disabled={
                    voiceStatus !== "connected" && voiceStatus !== "muted"
                  }
                >
                  {voiceStatus === "muted" ? "开启麦克风" : "静音"}
                </button>
                <button
                  className="primary-button compact-button"
                  type="button"
                  onClick={finishVoiceAnswer}
                  disabled={voiceStatus !== "connected"}
                >
                  我已回答完
                </button>
                <button
                  className="quiet-button"
                  type="button"
                  onClick={stopVoiceInterview}
                >
                  退出语音模式
                </button>
              </div>
              <div className="voice-transcript" aria-live="polite">
                <div>
                  <span>你的语音转写</span>
                  <strong>
                    {voiceTranscriptStatus === "saved"
                      ? "回答已保存"
                      : voiceTranscriptStatus === "final"
                        ? "最终转写"
                        : voiceTranscriptStatus === "interim"
                          ? "正在识别"
                          : "等待回答"}
                  </strong>
                </div>
                <p>
                  {voiceTranscript ||
                    "开始回答后，识别出的文字会显示在这里。说完请点击“我已回答完”，不要直接退出语音模式。"}
                </p>
              </div>
            </section>
          )}
        </section>

        <aside className="signal-panel">
          <p className="card-index">LIVE SIGNALS</p>
          <h2>决策信号</h2>
          <div className="signal-item">
            <span>上一轮可引用证据</span>
            <strong>
              {lastEvaluation ? `${lastEvaluation.evidence.length} 条` : "等待提交"}
            </strong>
          </div>
          <div className="signal-item">
            <span>评分可靠性</span>
            <strong>{lastEvaluation?.reliability ?? "—"}</strong>
          </div>
          {isGuidedDemo ? (
            <div className="signal-item demo-signal-item">
              <span>数据边界</span>
              <strong>DEMO FIXTURE</strong>
            </div>
          ) : null}
          <div className="signal-item">
            <span>策略动作</span>
            <strong>{decision?.action ?? "建立锚点"}</strong>
          </div>
          <div className="stage-note">
            <span>当前阶段</span>
            <strong>{phase}</strong>
            <p>
              {decision?.reason ??
                "每轮都会保存原回答、评估证据、能力更新和下一题选择原因。"}
            </p>
          </div>
        </aside>
      </section>
    </main>
  );
}

function stageForQuestion(questionType: PublicQuestion["questionType"]) {
  if (questionType === "anchor") return "ANCHOR_INTERVIEW";
  if (questionType === "verification") return "VERIFYING";
  return "ADAPTIVE_INTERVIEW";
}

function questionTypeLabel(questionType: PublicQuestion["questionType"]) {
  if (questionType === "anchor") return "固定锚点题";
  if (questionType === "verification") return "可靠性验证题";
  return "自适应诊断题";
}

