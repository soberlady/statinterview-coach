"use client";

import type { buildReportInsights, DiagnosticTurn } from "@/app/lib/report-insights";

type Report = {
  diagnosis: ReturnType<typeof buildReportInsights>;
  turns: DiagnosticTurn[];
  reviewGuidance: Record<string, string[]>;
  skillStates: { skill: string; sourceTurnCount: number; posteriorMean: number; uncertainty: number }[];
};

export function DiagnosticReportContent({ report }: { report: Report }) {
  const completed = report.turns.filter(t => t.answerText.trim() && (!t.status || t.status === "completed"));
  return <>
    <article className="report-card report-card-wide diagnosis-priorities">
      <p className="card-index">先处理最值得投入的地方</p><h2>本次训练重点</h2>
      <p className="report-caption">结合岗位相关性与本次回答证据排序。待确认项需要补测；练习题组以上方建议为准。</p>
      <div className="diagnosis-priority-grid">{report.diagnosis.slice(0, 2).map((item, index) => {
        const observation = item.observations[0];
        return <section className="diagnosis-focus" key={item.skill}>
          <span className="diagnosis-index">0{index + 1} · {statusLabel(item.status)}</span>
          <h3>{item.label}</h3><p>{item.goal}</p>
          {observation ? <>
            <p className="report-caption">依据：第 {observation.turn.sequenceNumber} 题 · {observation.turn.questionText}</p>
            <blockquote>{observation.quote ? `“${observation.quote}”` : `原回答节选：${observation.turn.answerText.slice(0, 180)}${observation.turn.answerText.length > 180 ? "…" : ""}`}</blockquote>
            <a href={`#review-${observation.turn.id}`} onClick={() => document.getElementById(`review-${observation.turn.id}`)?.setAttribute("open", "")}>查看这题的回答与改进要点 →</a>
          </> : <p className="report-caption">{item.answered.length ? item.accepted.length ? "已有可靠回答，可通过新场景检查迁移表现。" : "已有回答尚不足以形成可靠结论，需要在新题中补充判断依据。" : "本次尚未考察该方向，不能据此判断能力高低。"}</p>}
        </section>;
      })}</div>
    </article>
    <article className="report-card report-card-wide">
      <p className="card-index">本次覆盖与观察</p><h2>能力概览</h2>
      <p className="report-caption">综合该方向的可靠回答，区分需要练习、需要确认和尚未考察的内容。单次表现不代表稳定能力等级。</p>
      <div className="diagnosis-skill-grid">{report.diagnosis.map(item => <section key={item.skill} className={`diagnosis-skill diagnosis-${item.status}`}>
        <div className="skill-title"><h3>{item.label}</h3><span>{statusLabel(item.status)}</span></div>
        <p>{item.strength ?? item.goal}</p>
        <small>{item.confidence} · {item.answered.length} 轮回答 / {item.accepted.length} 轮可靠证据</small>
        {item.observations.length ? <p className="report-caption">待改进：{item.observations[0].gap.replace(/^待补充[：:]/, "")}</p> : null}
      </section>)}</div>
      <details className="diagnosis-estimates"><summary>查看能力估计的计算数值</summary>
        <p>这些数值供理解模型状态使用，未经能力等级校准，不是答对率、百分制成绩或录用概率。</p>
        {report.skillStates.map(state => <p key={state.skill}>{report.diagnosis.find(item => item.skill === state.skill)?.label}：{state.sourceTurnCount ? `估计值 ${state.posteriorMean.toFixed(2)} · 不确定性 ${state.uncertainty.toFixed(2)}` : "尚无可靠证据"}</p>)}
      </details>
    </article>
    <article className="report-card report-card-wide diagnosis-reviews">
      <p className="card-index">从原回答到下一次表达</p><h2>逐题复盘</h2>
      <p className="report-caption">先核对原回答，再查看具体反馈。改进要点来自题目量表，是复习参考。</p>
      {completed.map(turn => {
        const accepted = report.diagnosis.some(item => item.accepted.some(source => source.id === turn.id));
        return <details className="diagnosis-review" id={`review-${turn.id}`} key={turn.id}>
          <summary><span>第 {turn.sequenceNumber} 题 · {report.diagnosis.find(item => item.skill === turn.skill)?.label}</span><strong>{turn.questionText}</strong><small>{accepted ? "有可靠评价" : "待确认 · 暂不作能力结论"}</small></summary>
          <div className="diagnosis-review-body">
            <h3>你的原回答</h3><p className="diagnosis-answer">{turn.answerText}</p>
            <h3>{accepted ? "从这次回答观察到" : "待核对的反馈"}</h3>
            {!accepted && <p>本题证据不足或并非语义评分，以下反馈仅供复盘，不能直接视为能力短板。</p>}
            {!!turn.evaluation.strengths?.length && <><h4>已体现的内容</h4><ul>{turn.evaluation.strengths.map((text, i) => <li key={i}>{text}</li>)}</ul></>}
            {!!turn.evaluation.gaps?.length && <><h4>需要补充的内容</h4><ul>{turn.evaluation.gaps.map((text, i) => <li key={i}>{text}</li>)}</ul></>}
            <h3>下次回答可检查</h3>
            <ul>{(report.reviewGuidance[turn.id]?.length ? report.reviewGuidance[turn.id] : ["说明结论成立的条件、判断依据和验证步骤。"]).map((point, i) => <li key={i}>{point}</li>)}</ul>
          </div>
        </details>;
      })}
      {!completed.length && <p>还没有已保存的回答。继续诊断后，这里会展示逐题复盘。</p>}
    </article>
  </>;
}

function statusLabel(status: string): string {
  return ({ practice: "观察到待改进项", uncertain: "需要补充确认", uncovered: "本次尚未考察", transfer: "建议迁移巩固" } as Record<string, string>)[status] ?? "待确认";
}

