"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    const form = new FormData(event.currentTarget);
    const payload = {
      jobTitle: String(form.get("jobTitle") ?? "").trim(),
      jobDescription: String(form.get("jobDescription") ?? "").trim(),
      candidateBackground: String(form.get("candidateBackground") ?? "").trim(),
      durationMinutes: Number(form.get("durationMinutes") ?? 15),
      cameraEnabled: form.get("cameraEnabled") === "on",
      recordingEnabled: false,
    };

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
      setIsSubmitting(false);
    }
  }

  return (
    <aside className="setup-panel" aria-labelledby="setup-title">
      <div className="setup-heading">
        <div>
          <p>开始一次诊断</p>
          <h2 id="setup-title">创建你的面试</h2>
        </div>
        <span>约 15 分钟</span>
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
            placeholder="粘贴 JD；系统会提取岗位能力权重"
            rows={5}
            minLength={20}
            required
          />
        </label>

        <label>
          你的背景
          <textarea
            name="candidateBackground"
            placeholder="例如：应用统计研一，掌握 Python、SQL 和基础机器学习"
            rows={3}
            minLength={10}
            required
          />
        </label>

        <div className="form-row">
          <label>
            诊断时长
            <select name="durationMinutes" defaultValue="15">
              <option value="15">15 分钟</option>
              <option value="20">20 分钟</option>
            </select>
          </label>
          <label className="checkbox-field">
            <input type="checkbox" name="cameraEnabled" />
            <span>
          预留摄像头
              <small>仅用于沉浸感，不参与评分</small>
            </span>
          </label>
        </div>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        <button className="primary-button" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "正在创建…" : "开始文本诊断"}
          <span aria-hidden="true">→</span>
        </button>

        <p className="form-note">
          继续即表示你同意本次练习使用回答文本生成诊断报告。默认不保存原始录音。
        </p>
      </form>
    </aside>
  );
}
