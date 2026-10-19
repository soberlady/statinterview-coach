import { SKILL_LABELS, type SkillKey } from "./question-bank";

export type DiagnosticTurn = {
  id: string;
  sequenceNumber: number;
  questionId?: string | null;
  questionText: string;
  questionType?: string;
  topic?: string;
  answerText: string;
  status?: string;
  skill: string;
  reliability: string | null;
  evaluation: {
    action?: string;
    evaluator?: string;
    reliability?: string;
    totalScore?: number;
    evidence?: string[];
    strengths?: string[];
    gaps?: string[];
    disclaimer?: string;
    signals?: { reviewDisagreement?: number; evidenceCoverage?: number };
    semantic?: { criteria?: { criterion: string; score: number; evidence: string[]; note?: string }[] };
  };
};

export function confirmationReason(turn: DiagnosticTurn) {
  if (isAcceptedEvidence(turn)) return null;
  const text = [...(turn.evaluation.gaps ?? []), turn.evaluation.disclaimer ?? ""].join(" ");
  if (/转写置信度较低|转写质量|未听清/.test(text)) return {
    code: "transcript", title: "语音识别待核对",
    explanation: "系统未能可靠识别这次回答，暂不据此判断你的能力。",
    action: "先核对下方原始转写；在补充诊断时切换文字输入，重新说明核心判断。",
  };
  if (turn.evaluation.evaluator === "DEMO_FIXTURE") return {
    code: "demo", title: "演示回答", explanation: "这条回答仅用于演示，不是你的能力证据。", action: "从首页开始自己的诊断。",
  };
  if (turn.evaluation.evaluator !== "RUBRIC_DOUBLE_PASS") return {
    code: "scorer", title: "内容评分未完成", explanation: "本题未获得完整语义评分，不能把系统限制当成能力不足。", action: "服务恢复后重新诊断；本次原回答仍可复盘。",
  };
  if ((turn.evaluation.signals?.reviewDisagreement ?? 0) > .8) return {
    code: "disagreement", title: "评审意见不一致", explanation: "两次评审对回答存在较大分歧，暂不下能力结论。", action: "补充结论成立的条件和判断依据，再用新题确认。",
  };
  return { code: "evidence", title: "判断依据待补充", explanation: "现有记录不足以形成可靠判断，不等于回答错误。", action: "用“结论—依据—验证方法”重新组织回答，在补充诊断中确认。" };
}

// A quotation proves what was said, not that it was correct. Score 0/1 must
// never be upgraded to a demonstrated strength just because a quote exists.
export function criterionFeedback(turn: DiagnosticTurn) {
  const accepted = isAcceptedEvidence(turn);
  return (turn.evaluation.semantic?.criteria ?? []).map(item => {
    const quote = item.evidence.find(text => text.trim() && turn.answerText.includes(text)) ?? null;
    const state = !accepted || !Number.isFinite(item.score) || !quote ? "uncertain"
      : item.score >= 3 ? "demonstrated" : item.score >= 2 ? "partial" : "revisit";
    const label = { demonstrated: "已体现", partial: "部分体现", revisit: "尚未充分体现", uncertain: "无法判断" }[state];
    const next = state === "demonstrated" ? "保留这部分判断，并尝试用于新场景。"
      : state === "partial" ? "已有部分证据；对照这个要求，补充尚未说清的条件、口径或验证方法。"
        : state === "revisit" ? "这部分需要重新说明；原话仅用于定位，不代表判断正确。"
          : "先核对原回答并补充依据，暂不把这项列为已确认短板。";
    return { criterion: item.criterion, score: item.score, quote, state, label, next,
      note: accepted && typeof item.note === "string" ? item.note.trim().slice(0, 800) : null };
  });
}

export function compareEvidence(before: DiagnosticTurn[], after?: DiagnosticTurn) {
  if (!after) return [];
  return criterionFeedback(after).map(current => {
    const matching = before.filter(isAcceptedEvidence).flatMap(turn =>
      criterionFeedback(turn).filter(item => item.criterion === current.criterion)
        .map(item => ({ ...item, sequenceNumber: turn.sequenceNumber })));
    // Preserve contradictory observations rather than cherry-picking the best score.
    const previous = matching.at(-1);
    const consistent = matching.length > 0 && matching.every(item => item.state === previous?.state);
    return { criterion: current.criterion,
      before: !matching.length ? "未找到相同评分点，暂不比较" : !consistent ? "先前证据不一致，需继续确认" : previous!.label,
      beforeQuote: consistent ? previous?.quote ?? null : null,
      after: current.label, afterQuote: current.quote,
    };
  });
}

export function isAcceptedEvidence(turn: DiagnosticTurn) {
  return Boolean(turn.answerText.trim()) && (!turn.status || turn.status === "completed")
    && turn.evaluation.action === "ACCEPT"
    && turn.evaluation.evaluator === "RUBRIC_DOUBLE_PASS"
    && ["HIGH", "MEDIUM"].includes(turn.reliability ?? turn.evaluation.reliability ?? "LOW");
}

export function verificationFollowups(turn: DiagnosticTurn, turns: DiagnosticTurn[]) {
  if (!turn.questionId || turn.questionType === "verification") return [];
  // Both historical and coaching banks use the same source ID underneath
  // the JD baseline wrapper. Do not resolve old records against today's bank.
  const sourceId = turn.questionId.replace(/__role_anchor$/, "");
  return turns.filter(candidate => candidate.sequenceNumber > turn.sequenceNumber
    && candidate.questionType === "verification" && isAcceptedEvidence(candidate)
    && candidate.questionId?.match(/^(.+)__verify_(?:v3_)?\d+$/)?.[1] === sourceId);
}

export function buildReportInsights(turns: DiagnosticTurn[], jobWeights: Record<string, number> = {}, recommendation?: { focusSkill: string; topic: string; reason: string } | null) {
  return Object.entries(SKILL_LABELS).map(([key, label]) => {
    const skill = key as SkillKey;
    const answered = turns.filter(t => t.skill === skill && t.answerText.trim() && (!t.status || t.status === "completed"));
    const accepted = answered.filter(isAcceptedEvidence);
    const observations = accepted.flatMap(turn => (turn.evaluation.gaps ?? []).map(gap => {
      const criterion = turn.evaluation.semantic?.criteria?.find(item => gap === `待补充：${item.criterion}`);
      const quote = criterion?.evidence.find(text => text.trim() && turn.answerText.includes(text));
      const feedback = criterionFeedback(turn).find(item => item.criterion === criterion?.criterion);
      const displayGap = feedback ? `${feedback.label}：${feedback.criterion}` : gap;
      return { gap: displayGap, turn, quote: quote ?? null };
    }));
    const unique = observations.filter((item, index) => observations.findIndex(other => other.gap === item.gap && other.turn.topic === item.turn.topic) === index);
    const preferred = recommendation?.focusSkill === skill ? recommendation : null;
    if (preferred) unique.sort((a, b) => Number(b.turn.topic === preferred.topic) - Number(a.turn.topic === preferred.topic));
    const status = !answered.length ? "uncovered" : !accepted.length ? "uncertain" : unique.length ? "practice" : "transfer";
    // Follow-up answers to the same source question do not count as independent coverage.
    const independent = new Set(accepted.map(t => (t.questionId ?? t.id).replace(/__(verify_(?:v3_)?\d+|role_anchor)$/, ""))).size;
    const confidence = independent >= 2 && accepted.every(t => (t.reliability ?? t.evaluation.reliability) === "HIGH") ? "多题支持" : accepted.length ? "初步观察" : "暂不判断";
    const strength = accepted.flatMap(t => t.evaluation.strengths ?? [])[0];
    const goal = unique[0]?.gap ?? (status === "uncovered" ? `补充考察${label}，先建立回答证据。` : status === "uncertain" ? `用一道新题重新说明${label}的判断过程，确认当前表现。` : `换一个场景练习${label}，检查能否独立迁移。`);
    const weight = jobWeights[skill] ?? .25;
    const topics = [...new Set(answered.map(t => t.topic).filter((topic): topic is string => Boolean(topic)))];
    return { skill, label, topics, answered, accepted, observations: unique, status, confidence, strength,
      focusTopic: preferred?.topic,
      goal: preferred && unique[0]?.turn.topic !== preferred.topic ? preferred.reason : goal,
      priority: weight * (status === "practice" ? 3 : status === "uncertain" ? 2.5 : status === "uncovered" ? 2 : 1),
      kind: status === "practice" ? "practice" as const : status === "transfer" ? "transfer" as const : "verify" as const };
  }).sort((a, b) => Number(b.skill === recommendation?.focusSkill) - Number(a.skill === recommendation?.focusSkill) || b.priority - a.priority || a.skill.localeCompare(b.skill));
}
