"use client";

import Link from "next/link";
import {
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";

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
  nextQuestion?: PublicQuestion | null;
  decision?: AgentDecision;
  progress?: Progress;
};

type TurnResponse = NextQuestionResponse & {
  evaluation?: Evaluation;
};

type VoiceTokenResponse = ApiErrorBody & {
  serverUrl?: string;
  participantToken?: string;
};

type VoiceStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "muted"
  | "unavailable"
  | "error";

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
  const [lastEvaluation, setLastEvaluation] = useState<Evaluation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [startedAt, setStartedAt] = useState(() => new Date().toISOString());
  const [inputChannel, setInputChannel] = useState<"text" | "voice">("text");
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("idle");
  const [voiceMessage, setVoiceMessage] = useState(
    "连接后，原始最终转写会进入同一套选题、验证与报告流程。",
  );
  const voiceRoomRef = useRef<import("livekit-client").Room | null>(null);
  const remoteAudioRef = useRef<HTMLDivElement | null>(null);

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
        setQuestion(result.nextQuestion ?? null);
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
  }, [interviewId]);

  useEffect(() => {
    const timer = window.setInterval(
      () => setElapsedSeconds((current) => current + 1),
      1000,
    );
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    return () => {
      void voiceRoomRef.current?.disconnect();
      voiceRoomRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (inputChannel !== "voice" || voiceStatus === "idle") return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(
          `/api/interviews/${interviewId}/next-question`,
          { cache: "no-store" },
        );
        const result = (await response.json()) as NextQuestionResponse;
        if (!response.ok || cancelled) return;
        if (result.progress) setProgress(result.progress);
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
          await voiceRoomRef.current?.disconnect();
          voiceRoomRef.current = null;
        }
      } catch {
        // Realtime media can continue through transient polling failures.
      }
    }, 1_500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [inputChannel, interviewId, voiceStatus]);

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

  async function startVoiceInterview() {
    setError("");
    setVoiceStatus("connecting");
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
        !credentials.participantToken
      ) {
        const unavailable = response.status === 503;
        setVoiceStatus(unavailable ? "unavailable" : "error");
        throw new Error(
          credentials.error?.message ??
            "实时语音连接失败，请继续使用文本通道。",
        );
      }

      const { Room, RoomEvent, Track } = await import("livekit-client");
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind !== Track.Kind.Audio) return;
        const element = track.attach();
        element.dataset.livekitRemoteAudio = "true";
        remoteAudioRef.current?.appendChild(element);
      });
      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        track.detach().forEach((element) => element.remove());
      });
      room.on(RoomEvent.Disconnected, () => {
        setVoiceStatus("idle");
        setInputChannel("text");
        setVoiceMessage("语音连接已结束，可以继续使用文本通道。");
      });

      voiceRoomRef.current = room;
      await room.connect(
        credentials.serverUrl,
        credentials.participantToken,
      );
      await room.startAudio();
      await room.localParticipant.setMicrophoneEnabled(true);
      setInputChannel("voice");
      setVoiceStatus("connected");
      setVoiceMessage("已连接。回答结束后停顿，Agent 会保存最终原始转写并选择下一题。");
    } catch (voiceError) {
      await voiceRoomRef.current?.disconnect();
      voiceRoomRef.current = null;
      setInputChannel("text");
      setVoiceMessage(
        voiceError instanceof Error
          ? voiceError.message
          : "实时语音连接失败，请继续使用文本通道。",
      );
    }
  }

  async function toggleMicrophone() {
    const room = voiceRoomRef.current;
    if (!room) return;
    const shouldEnable = voiceStatus === "muted";
    await room.localParticipant.setMicrophoneEnabled(shouldEnable);
    setVoiceStatus(shouldEnable ? "connected" : "muted");
    setVoiceMessage(
      shouldEnable
        ? "麦克风已开启，可以继续回答。"
        : "麦克风已静音；本地不会继续发送声音。",
    );
  }

  async function stopVoiceInterview() {
    await voiceRoomRef.current?.disconnect();
    voiceRoomRef.current = null;
    setInputChannel("text");
    setVoiceStatus("idle");
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
    return (
      <main className="completion-shell">
        <section className="completion-card">
          <span className="completion-mark" aria-hidden="true">
            ✓
          </span>
          <p className="eyebrow">自适应诊断已完成</p>
          <h1>回答、决策与能力状态都已保存。</h1>
          <p>
            报告将区分有效证据和待验证项。当前无模型密钥时使用透明的结构化降级评估，
            不会把低可靠性回答写成稳定能力结论。
          </p>
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

  return (
    <main className="room-shell">
      <header className="room-header">
        <Link className="brand compact" href="/">
          <span className="brand-mark">S</span>
          <strong>StatInterview</strong>
        </Link>
        <div className="room-session">
          <span className="live-dot" />
          {inputChannel === "voice" ? "LiveKit 实时语音" : "文本通道"} ·
          自动检查点
          <strong>{elapsedLabel}</strong>
        </div>
        <button
          className="quiet-button"
          type="button"
          onClick={() => router.push("/")}
        >
          退出（进度已保存）
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
                <button
                  className="channel-switch"
                  type="button"
                  onClick={startVoiceInterview}
                  disabled={voiceStatus === "connecting"}
                >
                  {voiceStatus === "connecting"
                    ? "正在连接…"
                    : "切换到实时语音"}
                </button>
              </div>
              <textarea
                id="answer"
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                placeholder="当前为可恢复的文本通道。建议按“假设—数据—判断标准—验证动作”组织答案。"
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
                <strong>
                  {voiceStatus === "muted"
                    ? "麦克风已静音"
                    : "实时面试官已连接"}
                </strong>
                <p>{voiceMessage}</p>
              </div>
              <div className="voice-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={toggleMicrophone}
                >
                  {voiceStatus === "muted" ? "开启麦克风" : "静音"}
                </button>
                <button
                  className="quiet-button"
                  type="button"
                  onClick={stopVoiceInterview}
                >
                  结束语音
                </button>
              </div>
              <div className="remote-audio" ref={remoteAudioRef} />
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
