"use client";

import { useState } from "react";
import { criterionFeedback, confirmationReason, type buildReportInsights, type DiagnosticTurn } from "@/app/lib/report-insights";

type Report = {
  diagnosis: ReturnType<typeof buildReportInsights>;
  turns: DiagnosticTurn[];
  reviewGuidance: Record<string, string[]>;
  skillStates: { skill: string; sourceTurnCount: number; posteriorMean: number; uncertainty: number }[];
};

export function DiagnosticReportContent({ report }: { report: Report }) {
  const completed = report.turns.filter(t => t.answerText.trim() && (!t.status || t.status === "completed"));
  const pending = completed.map(turn => ({ turn, reason: confirmationReason(turn) })).filter(item => item.reason);
  return <>
    {pending.length > 0 && <article id="pending-evidence" className="report-card report-card-wide pending-evidence">
      <h2>{pending.length} 轮回答还需要确认</h2>
      <p>这些回答暂不用于能力结论。先处理识别或评分问题，再决定是否需要补练。</p>
      <div className="pending-reasons">{[...new Set(pending.map(item => item.reason!.code))].map(code => {
        const group = pending.filter(item => item.reason!.code === code);
        return <section key={code}><h3>{group[0].reason!.title} · {group.length} 轮</h3>
          <p>{group[0].reason!.action}</p>
          {group.map(({ turn }) => <a key={turn.id} href={`#review-${turn.id}`} onClick={() => document.getElementById(`review-${turn.id}`)?.setAttribute("open", "")}>查看第 {turn.sequenceNumber} 题 → </a>)}
        </section>;
      })}</div>
    </article>}
    <article className="report-card report-card-wide diagnosis-priorities">
      <p className="card-index">先处理最值得投入的地方</p><h2>本次训练重点</h2>
      <p className="report-caption">结合岗位相关性与本次回答证据排序。待确认项需要补测；练习题组以上方建议为准。</p>
      <div className="diagnosis-priority-grid">{report.diagnosis.slice(0, 2).map((item, index) => {
        const observation = item.observations[0];
        return <section className="diagnosis-focus" key={item.skill}>
          <span className="diagnosis-index">0{index + 1} · {statusLabel(item.status)}</span>
          <h3>{observation?.turn.topic ?? item.topics?.[0] ?? item.label}</h3>
          <p className="report-caption">{item.label} · {item.confidence}</p><p>{item.goal}</p>
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
      <p className="report-caption">这里只描述本次考察的具体主题，不代表整个方向的能力。未考察的知识点仍需另行确认。</p>
      <div className="diagnosis-skill-grid">{report.diagnosis.map(item => <section key={item.skill} className={`diagnosis-skill diagnosis-${item.status}`}>
        <div className="skill-title"><h3>{item.label}</h3><span>{statusLabel(item.status)}</span></div>
        <p>{item.topics?.length ? `本次主题：${item.topics.join("、")}` : "本次尚无明确主题证据"}</p>
        <small>{item.confidence} · {item.answered.length} 轮回答 / {item.accepted.length} 轮可靠证据</small>
        {item.strength ? <p className="report-caption">{item.strength}</p> : null}
        {item.answered.length > item.accepted.length ? <p className="report-caption">另有 {item.answered.length - item.accepted.length} 轮待确认，原因见逐题复盘。</p> : null}
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
        const feedback = criterionFeedback(turn);
        const reason = confirmationReason(turn);
        const focus = feedback.find(item => item.state === "partial" || item.state === "revisit");
        return <details className="diagnosis-review" id={`review-${turn.id}`} key={turn.id}>
          <summary><span>第 {turn.sequenceNumber} 题 · {turn.topic ?? report.diagnosis.find(item => item.skill === turn.skill)?.label}</span><strong>{turn.questionText}</strong><small>{accepted ? "可用于本次判断" : `待确认 · ${reason?.title ?? "暂不作能力结论"}`}</small></summary>
          <div className="diagnosis-review-body">
            <h3>你的原回答</h3><p className="diagnosis-answer">{turn.answerText}</p>
            <h3>{accepted ? "从这次回答观察到" : "待核对的反馈"}</h3>
            {reason && <aside className="diagnosis-reason"><strong>{reason.title}</strong><p>{reason.explanation}</p><p>下一步：{reason.action}</p></aside>}
            {feedback.length ? <div className="criterion-feedback">{feedback.map((item, i) => <section key={i} className={`criterion-item criterion-${item.state}`}>
              <span className="criterion-label">{item.label}</span><h4>{item.criterion}</h4>
              {item.quote ? <blockquote>相关原话：“{item.quote}”</blockquote> : <p>暂无可核对的原话证据。</p>}
              {item.note && <p>评审说明：{item.note}</p>}
              <p>{item.next}</p>
            </section>)}</div> : <p>旧记录未保存逐项评分证据，暂不把整条量表要求当成已确认缺口。请结合原回答复盘。</p>}
            <AnswerRehearsal focus={focus?.criterion} topic={turn.topic} uncertain={!accepted} />
            <details className="diagnosis-estimates"><summary>查看完整回答检查清单</summary>
              <p>这是本题的完整参考要求，不表示每一项都是你的不足。</p>
              <ul>{(report.reviewGuidance[turn.id]?.length ? report.reviewGuidance[turn.id] : ["说明结论成立的条件、判断依据和验证步骤。"]).map((point, i) => <li key={i}>{point}</li>)}</ul>
            </details>
          </div>
        </details>;
      })}
      {!completed.length && <p>还没有已保存的回答。继续诊断后，这里会展示逐题复盘。</p>}
    </article>
  </>;
}

function AnswerRehearsal({ focus, topic, uncertain }: { focus?: string; topic?: string; uncertain: boolean }) {
  const [draft, setDraft] = useState("");
  return <section className="answer-rehearsal">
    <h3>{uncertain ? "先用文字重新说明" : "用 60 秒补充一段回答"}</h3>
    <p>{focus ? `这次只检查一个要求：${focus}` : `围绕${topic ?? "本题"}，说明结论、判断依据和验证方式。`}</p>
    <p className="report-caption">表达框架：“我的判断是……；成立的条件是……；我会用……验证；如果……，则调整为……。”请填入自己的具体内容。</p>
    <label>补答草稿<textarea value={draft} onChange={event => setDraft(event.target.value)} rows={4} placeholder="先核对原回答，再写出你希望补充或更正的内容。" /></label>
    <small>此处仅供即时整理，不保存、不重新评分。正式验证请使用报告顶部的专项训练或补充诊断。</small>
  </section>;
}

function statusLabel(status: string): string {
  return ({ practice: "观察到待改进项", uncertain: "需要补充确认", uncovered: "本次尚未考察", transfer: "建议迁移巩固" } as Record<string, string>)[status] ?? "待确认";
}

