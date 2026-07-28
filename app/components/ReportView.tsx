"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Reliability = "HIGH" | "MEDIUM" | "LOW";

type Interview = {
  id: string;
  jobTitle: string;
  status: string;
  mode: string;
};

type SkillState = {
  skill: string;
  posteriorMean: number;
  uncertainty: number;
  supportingEvidence: unknown[];
  commonErrors: unknown[];
  sourceTurnCount: number;
};

type Evaluation = {
  evaluator?: string;
  totalScore?: number;
  reliability?: Reliability;
  evidence?: string[];
  strengths?: string[];
  gaps?: string[];
  disclaimer?: string;
};

type Turn = {
  id: string;
  sequenceNumber: number;
  questionText: string;
  skill: string;
  questionType: string;
  answerText: string;
  reliability: Reliability | null;
  evaluation: Evaluation;
};

type Report = {
  generatedAt: string;
  assessmentStatus: "INSUFFICIENT_EVIDENCE" | "AVAILABLE";
  interview: Interview;
  skillStates: SkillState[];
  turns: Turn[];
  metrics: {
    totalTurns: number;
    completedTurns: number;
    verificationTurns: number;
    lowReliabilityTurns: number;
    averageScore: number | null;
    averageRecordedLatencyMs: number | null;
    eventCount: number;
    estimatedCostUsd: number;
  };
};

type ReportResponse = {
  report?: Report;
  error?: {
    message?: string;
  };
};

const labels: Record<string, string> = {
  statistics_ml: "统计与机器学习",
  experiment_causal: "实验与因果",
  sql_python: "SQL 与 Python",
  business_analytics: "业务分析",
};

export function ReportView({ interviewId }: { interviewId: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [feedbackRating, setFeedbackRating] = useState<number | null>(null);
  const [feedbackStatus, setFeedbackStatus] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadReport() {
      try {
        const response = await fetch(`/api/interviews/${interviewId}/report`, {
          cache: "no-store",
        });
        const result = (await response.json()) as ReportResponse;
        if (!response.ok || !result.report) {
          throw new Error(result.error?.message ?? "报告读取失败，请稍后重试。");
        }
        if (!cancelled) setReport(result.report);
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "报告读取失败，请稍后重试。",
          );
        }
      }
    }

    void loadReport();
    return () => {
      cancelled = true;
    };
  }, [interviewId]);

  const view = useMemo(() => {
    if (!report) return null;
    const skills = report.skillStates.map((state) => {
      const skillTurns = report.turns.filter(
        (turn) => turn.skill === state.skill,
      );
      const latestTurn = skillTurns.at(-1);
      const reliability = latestTurn?.reliability ?? "LOW";
      const value =
        state.sourceTurnCount > 0
          ? Math.round(100 / (1 + Math.exp(-state.posteriorMean)))
          : null;
      const gaps = latestTurn?.evaluation.gaps ?? [];
      const strengths = latestTurn?.evaluation.strengths ?? [];
      const note =
        strengths[0] ??
        gaps[0] ??
        (state.sourceTurnCount > 0
          ? "已有可接受证据，但仍需要在后续训练中交叉验证。"
          : "暂无足够可靠的证据，不生成稳定能力结论。");
      return {
        key: state.skill,
        label: labels[state.skill] ?? state.skill,
        reliability,
        value,
        note,
        uncertainty: state.uncertainty,
      };
    });
    const scoredSkills = skills.filter(
      (skill): skill is typeof skill & { value: number } =>
        skill.value !== null,
    );
    const weakest = [...scoredSkills].sort(
      (left, right) => left.value - right.value,
    )[0];
    const gapItems = [
      ...new Set(
        report.turns.flatMap((turn) => turn.evaluation.gaps ?? []),
      ),
    ].slice(0, 4);
    const evidenceItems = report.turns
      .flatMap((turn) =>
        (turn.evaluation.evidence ?? []).map((quote) => ({
          question: turn.questionText,
          quote,
          reliability: turn.reliability ?? "LOW",
        })),
      )
      .slice(0, 4);
    const usesFallback = report.turns.some(
      (turn) => turn.evaluation.evaluator === "STRUCTURE_HEURISTIC",
    );

    return {
      skills,
      weakest,
      gapItems,
      evidenceItems,
      usesFallback,
    };
  }, [report]);

  async function submitFeedback(rating: number) {
    setFeedbackRating(rating);
    setFeedbackStatus("正在保存…");
    try {
      const response = await fetch(
        `/api/interviews/${interviewId}/feedback`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rating,
            wouldUseAgain: rating >= 4,
          }),
        },
      );
      if (!response.ok) throw new Error("反馈保存失败");
      setFeedbackStatus("感谢反馈，已写入评测数据。");
    } catch {
      setFeedbackStatus("反馈暂未保存，请稍后再试。");
    }
  }

  if (!report || !view) {
    return (
      <main className="completion-shell">
        <section className="completion-card">
          <p className="eyebrow">{error ? "报告不可用" : "正在生成报告"}</p>
          <h1>{error ? "暂时无法读取诊断结果。" : "正在整理回答证据…"}</h1>
          <p>{error || "系统正在聚合能力状态、可靠性与策略事件。"}</p>
          {error ? (
            <Link className="secondary-button" href="/">
              返回首页
            </Link>
          ) : null}
        </section>
      </main>
    );
  }

  const nextSkill = view.weakest?.label ?? "回答结构";
  const nextSkillKey = view.weakest?.key;
  const nextSkillGaps = report.turns
    .filter((turn) => turn.skill === nextSkillKey)
    .flatMap((turn) => turn.evaluation.gaps ?? []);

  return (
    <main className="report-shell">
      <header className="report-header">
        <Link className="brand compact" href="/">
          <span className="brand-mark">S</span>
          <strong>StatInterview</strong>
        </Link>
        <span>诊断报告 · {interviewId.slice(0, 12)}</span>
      </header>

      <section className="report-hero">
        <div>
          <p className="eyebrow">证据型能力诊断</p>
          <h1>
            完成 {report.metrics.completedTurns} 轮回答，
            {report.metrics.lowReliabilityTurns > 0
              ? `其中 ${report.metrics.lowReliabilityTurns} 轮仍需验证。`
              : "当前证据均已达到接受阈值。"}
          </h1>
          <p>
            这不是录用预测。每项结论都来自已保存的回答证据；
            低可靠性回答不会直接改变能力状态。
          </p>
          <div className="report-status">
            <span>{view.usesFallback ? "透明降级评估" : "语义量表评估"}</span>
            <span>{report.metrics.verificationTurns} 次可靠性追问</span>
            <span>{report.metrics.eventCount} 条 Agent 事件</span>
          </div>
        </div>
        <div className="report-summary">
          <span>建议下一步</span>
          <strong>专项训练：{nextSkill}</strong>
          <p>
            {nextSkillGaps[0] ??
              "用不同场景回测当前判断，继续降低能力估计的不确定性。"}
          </p>
          <Link className="primary-button" href="/">
            创建专项训练 <span>→</span>
          </Link>
        </div>
      </section>

      {view.usesFallback ? (
        <aside className="evaluation-notice">
          当前站点未配置语义模型密钥，因此采用结构化降级评估：只测量回答长度、
          领域术语和推理结构，并明确标记可靠性；接入模型适配器后再按题目量表逐项评分。
        </aside>
      ) : null}

      <section className="report-grid">
        <article className="report-card report-card-wide">
          <div className="section-heading">
            <div>
              <p className="card-index">ABILITY MAP</p>
              <h2>能力状态与证据可靠性</h2>
            </div>
            <span className="legend">分数仅作训练参考</span>
          </div>
          <div className="skill-list">
            {view.skills.map((skill) => (
              <div className="skill-report-row" key={skill.key}>
                <div className="skill-score">
                  <strong>{skill.value ?? "—"}</strong>
                  <span>{skill.value === null ? "证据不足" : "/ 100"}</span>
                </div>
                <div>
                  <div className="skill-title">
                    <strong>{skill.label}</strong>
                    <span
                      className={`reliability ${skill.reliability.toLowerCase()}`}
                    >
                      {skill.reliability}
                    </span>
                  </div>
                  <div className="report-track">
                    <span style={{ width: `${skill.value ?? 0}%` }} />
                  </div>
                  <p>
                    {skill.note} 当前不确定性 {skill.uncertainty.toFixed(2)}。
                  </p>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="report-card">
          <p className="card-index">WHY VERIFY</p>
          <h2>本轮待补证据</h2>
          <ul className="evidence-list">
            {(view.gapItems.length > 0
              ? view.gapItems
              : ["当前没有额外待验证项，建议用新场景进行迁移回测。"]
            ).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="report-caption">
            低可靠性结论不会写入长期能力档案；追问预算耗尽时，Agent 会拒绝评分。
          </p>
        </article>

        <article className="report-card">
          <p className="card-index">SOURCE EVIDENCE</p>
          <h2>结论来自哪里</h2>
          <div className="evidence-quotes">
            {(view.evidenceItems.length > 0
              ? view.evidenceItems
              : [
                  {
                    question: "尚无可引用证据",
                    quote: "请完成一次回答较完整的诊断。",
                    reliability: "LOW" as const,
                  },
                ]
            ).map((item, index) => (
              <blockquote key={`${item.question}-${index}`}>
                <span>{item.reliability}</span>
                <p>“{item.quote}”</p>
                <small>{item.question}</small>
              </blockquote>
            ))}
          </div>
        </article>
      </section>

      <section className="feedback-card">
        <div>
          <p className="card-index">HUMAN FEEDBACK</p>
          <h2>这份报告对你有帮助吗？</h2>
          <p>反馈会作为离线评测数据保存，不会反向修改本次分数。</p>
        </div>
        <div className="rating-row" aria-label="报告评分">
          {[1, 2, 3, 4, 5].map((rating) => (
            <button
              className={feedbackRating === rating ? "selected" : ""}
              key={rating}
              type="button"
              onClick={() => void submitFeedback(rating)}
            >
              {rating}
            </button>
          ))}
          <span>{feedbackStatus}</span>
        </div>
      </section>
    </main>
  );
}
