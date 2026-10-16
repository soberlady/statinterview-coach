"use client";

import Link from "next/link";
import { DiagnosticReportContent } from "./DiagnosticReportContent";
import { useRouter } from "next/navigation";
import { VoiceTranscriptDiagnostics } from "./VoiceTranscriptDiagnostics";
import type { VoiceTranscriptDiagnostics as TranscriptDiagnostics } from "@/app/lib/voice-transcript-diagnostics";
import { useEffect, useMemo, useState } from "react";
import type { buildReportInsights } from "@/app/lib/report-insights";

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
  action?: string;
  evaluator?: string;
  totalScore?: number;
  reliability?: Reliability;
  evidence?: string[];
  strengths?: string[];
  gaps?: string[];
  disclaimer?: string;
  semantic?: {
    criteria?: { criterion: string; score: number; evidence: string[] }[];
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
  status?: string;
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
      | "posterior_adaptive" | "targeted_practice" | "transfer_check";
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
  diagnosis: ReturnType<typeof buildReportInsights>;
  reviewGuidance: Record<string, string[]>;
  generatedAt: string;
  assessmentStatus: "INSUFFICIENT_EVIDENCE" | "AVAILABLE";
  interview: Interview;
  trainingRecommendation?: {
    focusSkill: string; topic: string;
    kind: "gap" | "insufficient_evidence" | "reinforcement";
    reason: string; learningPoints: string[];
  } | null;
  trainingOutcome?: {
    sourceInterviewId: string; focusSkill: string; topic: string;
    completed: boolean; transferScore: number | null; message: string;
    evidenceComparison?: { criterion: string; before: string; beforeQuote: string | null; after: string; afterQuote: string | null }[];
    baselineEvidence?: { criterion: string; label: string; quote: string | null; sequenceNumber: number }[];
  } | null;
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
    voiceTranscriptDiagnostics?: TranscriptDiagnostics;
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
      agentReadyLatency: {
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
  const router = useRouter();
  const [startingTraining, setStartingTraining] = useState(false);
  const [trainingError, setTrainingError] = useState("");
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
      <main id="main-content" tabIndex={-1} className="practice-ui completion-shell">
        <section className="completion-card">
          <p className="eyebrow">{error ? "报告不可用" : "正在生成报告"}</p>
          <h1>{error ? "暂时无法读取诊断结果。" : "正在整理回答证据…"}</h1>
          <p>{error || "正在整理本次表现、回答证据和训练建议。"}</p>
          {error ? (
            <Link className="secondary-button" href="/">
              返回首页
            </Link>
          ) : null}
        </section>
      </main>
    );
  }

  const nextSkill = report.trainingRecommendation
    ? labels[report.trainingRecommendation.focusSkill] : "回答复盘";
  const priorityGap = report.diagnosis.find(item => item.status === "practice");
  async function startTraining() {
    setStartingTraining(true);
    setTrainingError("");
    try {
      const response = await fetch("/api/interviews", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "training", sourceInterviewId: interviewId }) });
      const result = await response.json() as { interview?: { id: string }; error?: { message: string } };
      if (!response.ok || !result.interview?.id) throw new Error(result.error?.message ?? "暂时无法开始专项训练。");
      router.push(`/interview/${result.interview.id}`);
    } catch (failure) {
      setTrainingError(failure instanceof Error ? failure.message : "暂时无法开始专项训练。");
      setStartingTraining(false);
    }
  }
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
    <main id="main-content" tabIndex={-1} className="practice-ui report-shell">
      <header className="report-header">
        <Link className="brand compact" href="/">
          <span className="brand-mark">S</span>
          <strong>StatInterview</strong>
        </Link>
        <span>
          {report.interview.status === "PAUSED" ? "阶段报告" : "诊断报告"} ·{" "}
          {interviewId.slice(0, 12)}
        </span>
      </header>

      <section className="report-hero">
        <div>
          <p className="eyebrow">
            {report.interview.status === "PAUSED"
              ? "暂停检查点 · 阶段性证据"
              : report.trainingOutcome ? "专项训练与新场景复测" : "证据型能力诊断"}
          </p>
          <h1>{view.usesDemoFixture ? "了解诊断如何指导训练" : report.trainingOutcome ? `新场景复测：${report.trainingOutcome.topic}` : report.trainingRecommendation ? `${report.trainingRecommendation.kind === "insufficient_evidence" ? "本次先确认" : "本次先练"}：${report.trainingRecommendation.topic}` : priorityGap ? `先复盘：${priorityGap.topics?.[0] ?? priorityGap.label}` : report.diagnosis.some(item => item.accepted.length) ? "把本次表现，带到新的场景里" : "先补充证据，再判断训练重点"}</h1>
          <p className="diagnosis-role">目标岗位 · {report.interview.jobTitle}</p>
          <p>{view.usesDemoFixture ? "演示回答用于说明报告结构，不代表你的实际能力。" : report.diagnosis.find(item => item.status === "practice")
            ? "下面的建议来自本次具体题目的回答，不代表整个方向的能力结论。先核对已体现的内容，再练尚未说清的部分。"
            : report.diagnosis.some(item => item.accepted.length) ? "已有回答获得可靠评价。未观察到的不足不等于已经掌握，建议通过新场景继续确认。"
            : "本次还不能形成可靠的能力结论。未测清楚的方向会标为待确认，不会直接视为短板。"}</p>
          <div className="report-status"><span>{report.metrics.completedTurns} 轮回答</span><span>覆盖 {report.diagnosis.filter(item => item.answered.length).length} / 4 个方向</span><span>{report.diagnosis.reduce((sum, item) => sum + item.accepted.length, 0)} 轮可用于判断</span><span>{report.diagnosis.reduce((sum, item) => sum + item.answered.length - item.accepted.length, 0)} 轮待确认</span></div>
          {report.diagnosis.some(item => item.answered.length > item.accepted.length) && <a href="#pending-evidence" className="report-caption">查看待确认原因与下一步 →</a>}
          <p className="report-caption">仅反映本次回答；训练反馈不代表录用预测。低可靠性回答不会直接改变能力状态。</p>
        </div>
        <div className="report-summary">
          <span>建议下一步</span>
          <strong>{report.trainingRecommendation ? `${report.trainingRecommendation.kind === "insufficient_evidence" ? "补充诊断" : report.trainingRecommendation.kind === "gap" ? "优先练习" : "迁移巩固"}：${report.trainingRecommendation.topic}` : "复盘本次回答"}</strong><p>{report.trainingRecommendation ? `${nextSkill} · 约 10 分钟 · 两题练习＋一道新题复测` : "查看下方逐题复盘，整理回答中的判断依据。"}</p>
          <p>
            {report.trainingRecommendation?.reason ?? (view.usesDemoFixture
              ? "演示结束后，可以从首页开始一次自己的诊断。"
              : "当前证据或未见场景题不足以安排三题专项训练。可先复盘回答，再开始新诊断；新诊断可能重复题目。")}
          </p>
          {report.trainingRecommendation ? (
            <button className="primary-button" type="button" disabled={startingTraining} onClick={startTraining}>
              {startingTraining ? "正在准备专项训练…" : report.trainingRecommendation.kind === "insufficient_evidence" ? "补充诊断并用新题确认" : "开始两题练习与新题复测"}
            </button>
          ) : null}
          {trainingError ? <p className="form-error" role="alert">{trainingError}</p> : null}
          <Link
            className="secondary-button"
            href={
              report.interview.status === "PAUSED"
                ? `/interview/${interviewId}`
                : "/"
            }
          >
            {report.interview.status === "PAUSED" ? "继续面试" : "开始新的完整诊断"}
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
          本次部分回答仅完成表达结构检查，未用于能力判断。
          请先核对原回答；这些反馈不能直接视为知识短板。
        </aside>
      ) : view.usesSemanticScorer ? (
        <aside className="evaluation-notice">
          <p>本次由 AI 按题目量表给出反馈，结果用于帮助你复盘。评分仍可能有偏差，请结合原回答和待补证据理解，不作为招聘判断依据。</p>
          <details>
            <summary>评分方法与验证进展</summary>
            <p>每个评分点经过初评和复核，并核对原回答中的引用证据。证据可靠性反映两次评分的一致程度和证据覆盖，不代表回答正确或能力优秀。</p>
            <p>正式评分验证状态：{report.scorerReleaseGate.status === "PASS" ? "已通过" : report.scorerReleaseGate.status === "FAIL" ? "未通过" : "尚未完成"}（{report.scorerReleaseGate.status}）。该状态用于说明评分器的验证进展，不是你的练习结果；正式验证完成前，不能声称它是经过验证的评分器或能预测招聘结果。</p>
          </details>
        </aside>
      ) : null}

      <section className="report-grid">
        {report.trainingOutcome ? (
          <article className="report-card report-training-outcome">
            <h2>专项训练与独立复测</h2>
            <p>{report.trainingOutcome.topic} · {report.trainingOutcome.transferScore === null
              ? "尚无可靠复测分数" : `新场景复测 ${(report.trainingOutcome.transferScore * 4).toFixed(1)} / 4`}</p>
            <p>{report.trainingOutcome.message}</p>
            {!!report.trainingOutcome.evidenceComparison?.length && <div className="evidence-comparison">
              <h3>同一评分点的证据对照</h3><p>只比较相同评分要求；不把不同题目的总分差解释为能力提升。</p>
              {!!report.trainingOutcome.baselineEvidence?.length && <details className="diagnosis-estimates"><summary>回看训练前同主题的具体证据</summary>
                <p>新场景的要求可能不同。以下保留初次回答的原要求与原话，供你对照；不自动判定进步。</p>
                {report.trainingOutcome.baselineEvidence.map((item, index) => <section key={index}><h4>第 {item.sequenceNumber} 题 · {item.label}</h4><p>{item.criterion}</p>{item.quote && <blockquote>“{item.quote}”</blockquote>}</section>)}
              </details>}
              {report.trainingOutcome.evidenceComparison.map((item, index) => <section className="comparison-item" key={index}>
                <h4>{item.criterion}</h4><div className="comparison-columns">
                  <div><strong>训练前 · {item.before}</strong>{item.beforeQuote && <blockquote>“{item.beforeQuote}”</blockquote>}</div>
                  <div><strong>独立复测 · {item.after}</strong>{item.afterQuote && <blockquote>“{item.afterQuote}”</blockquote>}</div>
                </div>
              </section>)}
            </div>}
            <Link href={`/report/${report.trainingOutcome.sourceInterviewId}`}>查看训练前的诊断证据</Link>
          </article>
        ) : null}

        <DiagnosticReportContent report={report} />
      </section>

      {report.turns.some((turn) => turn.inputMode === "voice") ? (
        <details className="transcript-audit-card">
          <summary>查看语音原始转写与校对记录</summary>
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
        </details>
      ) : null}

        <details className="report-technical report-card-wide">
          <summary>查看语音质量与连接记录</summary>
        {report.metrics.voiceTranscriptDiagnostics && (
          <VoiceTranscriptDiagnostics diagnostics={report.metrics.voiceTranscriptDiagnostics} />
        )}
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
                面试官就绪 p50 {formatLatency(
                  report.metrics.voiceTelemetry.agentReadyLatency.p50Ms,
                )}
              </span>
              <span>
                面试官就绪 p95 {formatLatency(
                  report.metrics.voiceTelemetry.agentReadyLatency.p95Ms,
                )}
              </span>
              <span>
                房间连接 p50 {formatLatency(
                  report.metrics.voiceTelemetry.connectionLatency.p50Ms,
                )}
              </span>
              <span>
                房间连接 p95 {formatLatency(
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
              当前样本包含 {report.metrics.voiceTelemetry.committedTurnCount} 条浏览器保存检查点记录、
              {report.metrics.voiceTelemetry.finalTranscriptSegmentCount} 个最终转写片段和
              {report.metrics.voiceTelemetry.failedConnectionCount} 次连接失败。样本量不足时只展示原始观测，不做质量结论。
              推理费用按观测用量与版本化目录价估算，不扣除免费额度，
              也不等同于最终账单；LiveKit 之外的评分模型需单独配置价格，
              未知模型会标为未计价，不会按零成本处理。
            </p>
          </article>
        ) : null}

        </details>

      <details className="policy-audit-card">
        <summary>查看 Agent 决策与回放</summary>
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
                          : step.context.selectionPhase === "targeted_practice"
                            ? "专项练习"
                            : step.context.selectionPhase === "transfer_check"
                              ? "新场景复测"
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
      </details>

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
          <div className="rating-row" role="group" aria-label="报告评分">
            {[1, 2, 3, 4, 5].map((rating) => (
              <button
                className={feedbackRating === rating ? "selected" : ""}
                key={rating}
                type="button"
                aria-label={`报告帮助程度 ${rating} 分，满分 5 分`}
                aria-pressed={feedbackRating === rating}
                onClick={() => void submitFeedback(rating)}
              >
                {rating}
              </button>
            ))}
            <span role="status">{feedbackStatus}</span>
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
