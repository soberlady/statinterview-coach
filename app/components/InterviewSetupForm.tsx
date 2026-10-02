"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { GUIDED_DEMO_REQUEST } from "@/app/lib/guided-demo";

type CreateInterviewResponse = {
  interview?: {
    id: string;
  };
  error?: {
    message?: string;
  };
};

export function InterviewSetupForm() {
  const router = useRouter();
  const [submittingKind, setSubmittingKind] = useState<
    "diagnostic" | "demo" | null
  >(null);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = new FormData(event.currentTarget);
    const payload = {
      jobTitle: String(form.get("jobTitle") ?? "").trim(),
      jobDescription: String(form.get("jobDescription") ?? "").trim(),
      candidateBackground: String(form.get("candidateBackground") ?? "").trim(),
      durationMinutes: Number(form.get("durationMinutes") ?? 20),
      cameraEnabled: form.get("cameraEnabled") === "on",
      recordingEnabled: false,
      mode: "diagnostic",
    };

    await createInterview(payload, "diagnostic");
  }

  async function startGuidedDemo() {
    await createInterview(GUIDED_DEMO_REQUEST, "demo");
  }

  async function createInterview(
    payload: Record<string, unknown>,
    kind: "diagnostic" | "demo",
  ) {
    setError("");
    setSubmittingKind(kind);

    try {
      const response = await fetch("/api/interviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as CreateInterviewResponse;

      if (!response.ok || !result.interview?.id) {
        throw new Error(
          result.error?.message || "暂时无法创建诊断，请稍后重试。",
        );
      }

      router.push(`/interview/${result.interview.id}`);
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "暂时无法创建诊断，请稍后重试。",
      );
    } finally {
      setSubmittingKind(null);
    }
  }

  return (
    <aside className="setup-panel" aria-labelledby="setup-title">
      <div className="setup-heading">
        <div>
          <p>本次练习</p>
          <h2 id="setup-title">你想准备什么岗位？</h2>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <label>
          目标岗位
          <input
            name="jobTitle"
            placeholder="例如：数据分析实习生"
            defaultValue="数据分析实习生"
            required
          />
        </label>

        <label>
          岗位描述
          <textarea
            name="jobDescription"
            placeholder="粘贴岗位要求，例如负责业务指标分析、A/B 实验设计及 SQL 数据提取。至少 20 个字。"
            rows={5}
            minLength={20}
            required
          />
        </label>

        <label>
          你的学习与项目经历
          <textarea
            name="candidateBackground"
            placeholder="例如：应用统计研二，使用过 Python、SQL，做过用户留存分析项目。至少 10 个字。"
            rows={3}
            minLength={10}
            required
          />
        </label>

        <div className="form-row">
          <label>
            选题时间预算
            <select name="durationMinutes" defaultValue="20">
              <option value="15">15 分钟</option>
              <option value="20">20 分钟</option>
            </select>
          </label>
          <p className="microphone-note">进入面试后，请允许浏览器使用麦克风。</p>
        </div>
        <p className="setup-help">15 / 20 分钟用于选题时估算时间成本，不是倒计时。两档均为 7 道主问题，按需追问；实际用时包含回答、等待和评分，可能更长。</p>
        <details className="setup-demo">
          <summary>填写的信息怎样影响题目？</summary>
          <p className="setup-help">前 2 道是固定公共题；中间 2 道按岗位关键词匹配，经历用于难度和场景选择；后 3 道结合回答表现自适应选题。当前从题库选题，不会针对具体项目自由生成问题，也不因背景直接加分。</p>
        </details>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        <button
          className="primary-button"
          type="submit"
          disabled={submittingKind !== null}
        >
          {submittingKind === "diagnostic" ? "正在准备面试…" : "开始语音练习"}
        </button>

        <details className="setup-demo">
          <summary>想先熟悉流程？</summary>
          <div className="guided-demo-launch">
          <div>
            <strong>用示例回答体验一次</strong>
            <small>合成回答 · 固定评分 · 不调用外部模型</small>
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={startGuidedDemo}
            disabled={submittingKind !== null}
          >
            {submittingKind === "demo" ? "正在准备…" : "进入引导演示"}
          </button>
          </div>
        </details>

        <p className="form-note">
          继续即表示你同意本次练习使用回答文本生成诊断报告。默认不保存原始录音。
        </p>
      </form>
    </aside>
  );
}
