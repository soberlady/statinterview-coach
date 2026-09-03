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
  semantic?: {
    transcriptRepair?: {
      applied: boolean;
      method: "raw" | "deterministic" | "model";
      model: string | null;
      promptVersion: string;
    };
  };
};

type Turn = {
  id: string;
  sequenceNumber: number;
  questionText: string;
  skill: string;
  questionType: string;
  answerText: string;
  scoringAnswerText: string | null;
  inputMode: string;
  reliability: Reliability | null;
  evaluation: Evaluation;
};

type PolicyCandidate = {
  questionId: string;
  questionText: string;
  skill: string;
  difficulty: number;
  expectedSeconds: number;
  utility: number;
  signals: {
    normalizedInformationGain: number;
    jdRelevance: number;
    difficultyMatch: number;
    coverageNeed: number;
    timeCost: number;
  };
};

type PolicyAuditStep = {
  sequenceNumber: number;
  actualQuestionId: string | null;
  actualQuestionText: string;
  expectedQuestionId: string | null;
  questionType: string;
  skill: string;
  reliability: string | null;
  action: string;
  reason: string;
  utility: number | null;
  matchesPolicy: boolean;
  evaluationReplayable: boolean;
  stateUpdated: boolean;
  posteriorAfter: {
    mean: number;
    uncertainty: number;
  } | null;
  ranking: PolicyCandidate[];
  context: {
    policyVersion: string;
    selectionPhase:
      | "public_anchor"
      | "jd_directed_baseline"
      | "posterior_adaptive";
    candidateRouting: {
      experienceBand: "beginner" | "intermediate" | "advanced";
      preferredDifficulty: 2 | 3 | 4;
      scenarioTags: string[];
    };
  } | null;
};

type PolicyAudit = {
  version: string;
  generatedFrom: string;
  fingerprint: string;
  steps: PolicyAuditStep[];
  finalDecision: {
    action: string;
    reason: string;
    nextQuestionId: string | null;
  };
  invariants: {
    sequenceContinuous: boolean;
    allQuestionsApproved: boolean;
    allEvaluationsReplayable: boolean;
    deterministicSelection: boolean;
    reachesTerminalPolicyState: boolean;
  };
  summary: {
    replayedTurns: number;
    matchingSelections: number;
    adaptiveDecisions: number;
    verificationDecisions: number;
    abstentions: number;
  };
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
    acceptedTurns: number;
    verificationTurns: number;
    lowReliabilityTurns: number;
    averageScore: number | null;
    averageRecordedLatencyMs: number | null;
    eventCount: number;
    estimatedCostUsd: number | null;
    costTelemetry: {
      status: "NOT_MEASURED" | "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
      estimatedCostMicrousd: number | null;
      pricedEventCount: number;
      voiceUsageEventCount: number;
      scorerUsageEventCount: number;
      pricedUsageCount: number;
      unpricedUsageCount: number;
      pricingVersions: string[];
      allowancesApplied: false;
    };
    voiceTelemetry: {
      sessionCount: number;
      reconnectCount: number;
      failedConnectionCount: number;
      finalTranscriptSegmentCount: number;
      committedTurnCount: number;
      connectionLatency: {
        count: number;
        p50Ms: number | null;
        p95Ms: number | null;
      };
      transcriptToCommitLatency: {
        count: number;
        p50Ms: number | null;
        p95Ms: number | null;
      };
    };
  };
  policyAudit: PolicyAudit;
  scorerReleaseGate: {
    status: "NOT_READY" | "PASS" | "FAIL";
    claimBoundary: string;
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

const actionLabels: Record<string, string> = {
  ACCEPT: "接受证据",
  VERIFY: "触发验证",
  ABSTAIN: "拒绝评分",
  COMPLETE: "完成诊断",
};

const questionTypeLabels: Record<string, string> = {
  anchor: "固定锚点",
  adaptive: "自适应题",
  verification: "限定追问",
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
    const usesSemanticScorer = report.turns.some(
      (turn) => turn.evaluation.evaluator === "RUBRIC_DOUBLE_PASS",
    );
    const usesDemoFixture =
      report.interview.mode === "guided_demo" ||
      report.turns.some(
        (turn) => turn.evaluation.evaluator === "DEMO_FIXTURE",
      );

    return {
      skills,
      weakest,
      gapItems,
      evidenceItems,
      usesFallback,
      usesSemanticScorer,
      usesDemoFixture,
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
  const auditChecks = [
    {
      label: "题号连续",
      passed: report.policyAudit.invariants.sequenceContinuous,
    },
    {
      label: "题库来源合法",
      passed: report.policyAudit.invariants.allQuestionsApproved,
    },
    {
      label: "评分记录可解析",
      passed: report.policyAudit.invariants.allEvaluationsReplayable,
    },
    {
      label: "选题轨迹一致",
      passed: report.policyAudit.invariants.deterministicSelection,
    },
    {
      label: "策略正常终止",
      passed: report.policyAudit.invariants.reachesTerminalPolicyState,
    },
  ];

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
            {report.assessmentStatus === "INSUFFICIENT_EVIDENCE"
              ? `已完成 ${report.metrics.completedTurns} 轮回答，语义能力证据尚未建立。`
              : `完成 ${report.metrics.completedTurns} 轮回答，其中 ${report.metrics.acceptedTurns} 轮进入能力后验。`}
          </h1>
          <p>
            这不是录用预测。每项结论都来自已保存的回答证据；
            低可靠性回答不会直接改变能力状态。
          </p>
          <div className="report-status">
            <span>
              {view.usesDemoFixture
                ? "确定性演示夹具"
                : view.usesFallback
                  ? "透明降级评估"
                  : "语义量表评估"}
            </span>
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

      {view.usesDemoFixture ? (
        <aside className="evaluation-notice demo-evaluation-notice">
          这是可复现的引导演示报告。标记为 DEMO_FIXTURE 的评分和能力变化来自确定性合成夹具，
          只用于展示 Agent 的 VERIFY、ABSTAIN、自适应选题、状态恢复与决策回放；
          不代表大模型评分结果，也不会作为真实候选人评测证据。
        </aside>
      ) : view.usesFallback ? (
        <aside className="evaluation-notice">
          当前站点未配置语义模型密钥，因此采用结构化降级评估：只测量回答长度、
          领域术语和推理结构。这些反馈不会写入能力后验。配置模型后可启用实验性量表评分；
          正式离线门禁通过前，不会把它宣称为已验证评分器。
        </aside>
      ) : view.usesSemanticScorer ? (
        <aside className="evaluation-notice">
          当前使用实验性语义量表评分，正式门禁状态为{" "}
          {report.scorerReleaseGate.status}。结果仅用于训练反馈；评分一致性门禁通过前，
          不会把它宣称为已验证评分器或招聘效度证据。
        </aside>
      ) : null}

      <section className="report-grid">
        {report.metrics.voiceTelemetry.sessionCount > 0 ? (
          <article className="report-card report-card-wide">
            <div className="section-heading">
              <div>
                <p className="card-index">VOICE OBSERVABILITY</p>
                <h2>语音链路实测</h2>
              </div>
              <span className="legend">客户端观测，不参与能力评分</span>
            </div>
            <div className="report-status">
              <span>
                {report.metrics.voiceTelemetry.sessionCount} 次成功连接
              </span>
              <span>
                连接 p50 {formatLatency(
                  report.metrics.voiceTelemetry.connectionLatency.p50Ms,
                )}
              </span>
              <span>
                连接 p95 {formatLatency(
                  report.metrics.voiceTelemetry.connectionLatency.p95Ms,
                )}
              </span>
              <span>
                转写至保存 p95 {formatLatency(
                  report.metrics.voiceTelemetry.transcriptToCommitLatency
                    .p95Ms,
                )}
              </span>
              <span>
                {report.metrics.voiceTelemetry.reconnectCount} 次恢复连接
              </span>
              <span>
                推理费用 {formatInferenceCost(report.metrics.estimatedCostUsd)}
              </span>
              <span>
                {formatCostStatus(report.metrics.costTelemetry.status)} · 计价覆盖{" "}
                {report.metrics.costTelemetry.pricedUsageCount}/
                {report.metrics.costTelemetry.pricedUsageCount +
                  report.metrics.costTelemetry.unpricedUsageCount}
              </span>
            </div>
            <p className="report-caption">
              当前样本包含 {report.metrics.voiceTelemetry.committedTurnCount} 个已保存语音回答、
              {report.metrics.voiceTelemetry.finalTranscriptSegmentCount} 个最终转写片段和
              {report.metrics.voiceTelemetry.failedConnectionCount} 次连接失败。样本量不足时只展示原始观测，不做质量结论。
              推理费用按观测用量与版本化目录价估算，不扣除免费额度，
              也不等同于最终账单；LiveKit 之外的评分模型需单独配置价格，
              未知模型会标为未计价，不会按零成本处理。
            </p>
          </article>
        ) : null}

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

      {report.turns.some((turn) => turn.inputMode === "voice") ? (
        <section className="transcript-audit-card">
          <div className="policy-audit-heading">
            <div>
              <p className="card-index">TRANSCRIPT AUDIT</p>
              <h2>语音转写与评分辅助文本</h2>
              <p>
                评分辅助文本只校正近音词、百分号、标点和专业术语；
                原始转写永久保留，并仍是评分证据的唯一引用来源。
              </p>
            </div>
          </div>
          <div className="transcript-audit-list">
            {report.turns
              .filter((turn) => turn.inputMode === "voice")
              .map((turn) => {
                const repair = turn.evaluation.semantic?.transcriptRepair;
                return (
                  <article className="transcript-audit-item" key={turn.id}>
                    <div className="transcript-audit-meta">
                      <span>
                        第 {turn.sequenceNumber} 题 · {labels[turn.skill] ?? turn.skill}
                      </span>
                      <span>
                        {repair?.method === "model"
                          ? "模型辅助校对"
                          : repair?.method === "deterministic"
                            ? "规则辅助校对"
                            : "原始转写未改动"}
                      </span>
                    </div>
                    <h3>{turn.questionText}</h3>
                    <div className="transcript-copy repaired">
                      <strong>评分辅助文本</strong>
                      <p>{turn.scoringAnswerText ?? turn.answerText}</p>
                    </div>
                    <details>
                      <summary>查看原始语音转写</summary>
                      <div className="transcript-copy raw">
                        <p>{turn.answerText}</p>
                      </div>
                    </details>
                  </article>
                );
              })}
          </div>
        </section>
      ) : null}

      <section className="policy-audit-card">
        <div className="policy-audit-heading">
          <div>
            <p className="card-index">AGENT DECISION AUDIT</p>
            <h2>每一次选题都可以确定性重放</h2>
            <p>
              使用已持久化的回答、可靠性与能力后验重新执行策略，不调用模型、
              不改写原始报告。候选题排名展示信息增益、岗位相关性、覆盖需要和时间成本。
            </p>
          </div>
          <div className="audit-fingerprint">
            <span>决策指纹 · SHA-256</span>
            <strong>{report.policyAudit.fingerprint.slice(0, 16)}</strong>
            <small>{report.policyAudit.version}</small>
          </div>
        </div>

        <div className="audit-summary-grid">
          <article>
            <span>重放匹配</span>
            <strong>
              {report.policyAudit.summary.matchingSelections}/
              {report.policyAudit.summary.replayedTurns}
            </strong>
            <small>实际题目与策略输出一致</small>
          </article>
          <article>
            <span>自适应决策</span>
            <strong>{report.policyAudit.summary.adaptiveDecisions}</strong>
            <small>按效用排序后选择</small>
          </article>
          <article>
            <span>可靠性追问</span>
            <strong>{report.policyAudit.summary.verificationDecisions}</strong>
            <small>低证据时优先补证</small>
          </article>
          <article>
            <span>拒绝评分</span>
            <strong>{report.policyAudit.summary.abstentions}</strong>
            <small>预算耗尽仍不强行打分</small>
          </article>
        </div>

        <div className="audit-invariants">
          {auditChecks.map((check) => (
            <span
              className={check.passed ? "passed" : "failed"}
              key={check.label}
            >
              {check.passed ? "✓" : "!"} {check.label}
            </span>
          ))}
        </div>

        <div className="audit-timeline">
          {report.policyAudit.steps.map((step) => (
            <article className="audit-step" key={step.sequenceNumber}>
              <div className="audit-step-index">
                <span>{String(step.sequenceNumber).padStart(2, "0")}</span>
                <i />
              </div>
              <div className="audit-step-content">
                <div className="audit-step-meta">
                  <span>
                    {questionTypeLabels[step.questionType] ??
                      step.questionType}
                  </span>
                  <span>{labels[step.skill] ?? step.skill}</span>
                  {step.context ? (
                    <span>
                      {step.context.selectionPhase === "public_anchor"
                        ? "公共锚点"
                        : step.context.selectionPhase ===
                            "jd_directed_baseline"
                          ? "JD 定向基线"
                          : "后验自适应"}
                      {" · 难度路由 " +
                        step.context.candidateRouting
                          .preferredDifficulty}
                    </span>
                  ) : null}
                  <span
                    className={
                      step.matchesPolicy
                        ? "audit-match passed"
                        : "audit-match failed"
                    }
                  >
                    {step.matchesPolicy ? "重放一致" : "轨迹异常"}
                  </span>
                </div>
                <h3>{step.actualQuestionText}</h3>
                <p>{step.reason}</p>
                <div className="audit-state-line">
                  <strong>
                    {actionLabels[step.action] ?? step.action}
                  </strong>
                  <span>
                    {step.stateUpdated && step.posteriorAfter
                      ? `能力状态已更新：μ ${step.posteriorAfter.mean.toFixed(2)} · σ ${step.posteriorAfter.uncertainty.toFixed(2)}`
                      : "能力状态未更新，保留上一版后验"}
                  </span>
                </div>

                {step.ranking.length > 0 ? (
                  <div className="candidate-ranking">
                    <div className="candidate-ranking-title">
                      <strong>当时的前三名候选题</strong>
                      <span>效用越高越优先</span>
                    </div>
                    {step.ranking.map((candidate, index) => (
                      <div
                        className="candidate-row"
                        key={candidate.questionId}
                      >
                        <div className="candidate-copy">
                          <span>#{index + 1}</span>
                          <div>
                            <strong>
                              {labels[candidate.skill] ?? candidate.skill}
                            </strong>
                            <p>{candidate.questionText}</p>
                          </div>
                          <b>{candidate.utility.toFixed(3)}</b>
                        </div>
                        <div className="candidate-track">
                          <span
                            style={{
                              width: `${Math.max(
                                4,
                                Math.min(100, candidate.utility * 100),
                              )}%`,
                            }}
                          />
                        </div>
                        <div className="candidate-signals">
                          <span>
                            信息增益{" "}
                            {formatPercent(
                              candidate.signals
                                .normalizedInformationGain,
                            )}
                          </span>
                          <span>
                            JD 相关{" "}
                            {formatPercent(
                              candidate.signals.jdRelevance,
                            )}
                          </span>
                          <span>
                            难度匹配{" "}
                            {formatPercent(
                              candidate.signals.difficultyMatch,
                            )}
                          </span>
                          <span>
                            覆盖需要{" "}
                            {formatPercent(
                              candidate.signals.coverageNeed,
                            )}
                          </span>
                          <span>
                            时间惩罚{" "}
                            {formatPercent(candidate.signals.timeCost)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>

        <div className="audit-final">
          <span>重放后的最终策略状态</span>
          <strong>
            {actionLabels[report.policyAudit.finalDecision.action] ??
              report.policyAudit.finalDecision.action}
          </strong>
          <p>{report.policyAudit.finalDecision.reason}</p>
        </div>
      </section>

      {view.usesDemoFixture ? (
        <section className="feedback-card demo-feedback-boundary">
          <div>
            <p className="card-index">DATA BOUNDARY</p>
            <h2>演示会话不收集用户反馈</h2>
            <p>该会话使用合成回答和固定评分，已从真实用户评测数据中排除。</p>
          </div>
        </section>
      ) : (
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
      )}
    </main>
  );
}

function formatLatency(value: number | null): string {
  if (value === null) return "—";
  if (value < 1_000) return `${value} ms`;
  return `${(value / 1_000).toFixed(2)} s`;
}

function formatInferenceCost(value: number | null): string {
  if (value === null) return "未测量";
  return `$${value.toFixed(6)}`;
}

function formatCostStatus(
  status: Report["metrics"]["costTelemetry"]["status"],
): string {
  return {
    NOT_MEASURED: "费用未测量",
    AVAILABLE: "费用可估算",
    PARTIAL: "费用部分估算",
    UNAVAILABLE: "费用暂不可估算",
  }[status];
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
