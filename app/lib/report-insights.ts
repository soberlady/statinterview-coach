import { SKILL_LABELS, type SkillKey } from "./question-bank";

export type DiagnosticTurn = {
  id: string;
  sequenceNumber: number;
  questionId?: string | null;
  questionText: string;
  questionType?: string;
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
    semantic?: { criteria?: { criterion: string; score: number; evidence: string[] }[] };
  };
};

export function isAcceptedEvidence(turn: DiagnosticTurn) {
  return Boolean(turn.answerText.trim()) && (!turn.status || turn.status === "completed")
    && turn.evaluation.action === "ACCEPT"
    && turn.evaluation.evaluator === "RUBRIC_DOUBLE_PASS"
    && ["HIGH", "MEDIUM"].includes(turn.reliability ?? turn.evaluation.reliability ?? "LOW");
}

export function buildReportInsights(turns: DiagnosticTurn[], jobWeights: Record<string, number> = {}) {
  return Object.entries(SKILL_LABELS).map(([key, label]) => {
    const skill = key as SkillKey;
    const answered = turns.filter(t => t.skill === skill && t.answerText.trim() && (!t.status || t.status === "completed"));
    const accepted = answered.filter(isAcceptedEvidence);
    const observations = accepted.flatMap(turn => (turn.evaluation.gaps ?? []).map(gap => {
      const criterion = turn.evaluation.semantic?.criteria?.find(item => gap === `待补充：${item.criterion}`);
      const quote = criterion?.evidence.find(text => text.trim() && turn.answerText.includes(text));
      return { gap, turn, quote: quote ?? null };
    }));
    const unique = observations.filter((item, index) => observations.findIndex(other => other.gap === item.gap) === index);
    const status = !answered.length ? "uncovered" : !accepted.length ? "uncertain" : unique.length ? "practice" : "transfer";
    // Follow-up answers to the same source question do not count as independent coverage.
    const independent = new Set(accepted.map(t => (t.questionId ?? t.id).replace(/__(verify_(?:v3_)?\d+|role_anchor)$/, ""))).size;
    const confidence = independent >= 2 && accepted.every(t => (t.reliability ?? t.evaluation.reliability) === "HIGH") ? "多题支持" : accepted.length ? "初步观察" : "暂不判断";
    const strength = accepted.flatMap(t => t.evaluation.strengths ?? [])[0];
    const goal = unique[0]?.gap ?? (status === "uncovered" ? `补充考察${label}，先建立回答证据。` : status === "uncertain" ? `用一道新题重新说明${label}的判断过程，确认当前表现。` : `换一个场景练习${label}，检查能否独立迁移。`);
    const weight = jobWeights[skill] ?? .25;
    return { skill, label, answered, accepted, observations: unique, status, confidence, strength, goal,
      priority: weight * (status === "practice" ? 3 : status === "uncertain" ? 2.5 : status === "uncovered" ? 2 : 1),
      kind: status === "practice" ? "practice" as const : status === "transfer" ? "transfer" as const : "verify" as const };
  }).sort((a, b) => b.priority - a.priority || a.skill.localeCompare(b.skill));
}
