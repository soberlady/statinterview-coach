import type { InterviewTurn, SkillState } from "@/db/schema";
import { getInterviewQuestion, listQuestions, SKILL_LABELS, COACHING_QUESTION_BANK_VERSION, CURRENT_QUESTION_BANK_VERSION, LEGACY_QUESTION_BANK_VERSION, type QuestionBankVersion, type SkillKey } from "./question-bank";

export const COACHING_POLICY_VERSION = "coaching-v3";
export type ExperienceBand = "beginner" | "intermediate" | "advanced";
export type TrainingPlan = {
  version: "practice-plan-v1";
  sourceInterviewId: string;
  focusSkill: SkillKey;
  topic: string;
  kind: "gap" | "insufficient_evidence" | "reinforcement";
  reason: string;
  questionIds: string[];
  seenQuestionIds: string[];
  learningPoints: string[];
};
export type PolicyConfig = {
  version: typeof COACHING_POLICY_VERSION;
  questionBankVersion?: QuestionBankVersion;
  experienceBand?: ExperienceBand;
  trainingPlan?: TrainingPlan;
};

export function readPolicyConfig(value?: string): PolicyConfig | null {
  if (value === undefined) return { version: COACHING_POLICY_VERSION, questionBankVersion: CURRENT_QUESTION_BANK_VERSION };
  const parsed = JSON.parse(value) as Partial<PolicyConfig>;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid policy configuration");
  // Rows predating this migration keep the frozen v2 policy.
  if (Object.keys(parsed).length === 0) return null;
  if (parsed.version !== COACHING_POLICY_VERSION) throw new Error("Unsupported policy version");
  // Missing versions on existing v3 sessions always resolve to their original bank.
  if (parsed.questionBankVersion !== undefined && parsed.questionBankVersion !== COACHING_QUESTION_BANK_VERSION) throw new Error("Unsupported coaching question bank version");
  if (parsed.experienceBand && !["beginner", "intermediate", "advanced"].includes(parsed.experienceBand)) throw new Error("Invalid experience band");
  const plan = parsed.trainingPlan;
  if (plan) {
    if (plan.version !== "practice-plan-v1" || !(plan.focusSkill in SKILL_LABELS) ||
      !Array.isArray(plan.questionIds) || plan.questionIds.length !== 3 || new Set(plan.questionIds).size !== 3 ||
      !Array.isArray(plan.seenQuestionIds) || !Array.isArray(plan.learningPoints) ||
      plan.questionIds.some((id) => {
        const question = getInterviewQuestion(id, parsed.questionBankVersion ?? COACHING_QUESTION_BANK_VERSION);
        return !question || question.isAnchor || question.skill !== plan.focusSkill || plan.seenQuestionIds.includes(id);
      })) throw new Error("Invalid training plan");
  }
  return parsed as PolicyConfig;
}

export function interviewQuestionBankVersion(interview: { policyConfig?: string }): QuestionBankVersion {
  const config = readPolicyConfig(interview.policyConfig);
  return config ? config.questionBankVersion ?? COACHING_QUESTION_BANK_VERSION : LEGACY_QUESTION_BANK_VERSION;
}

export function targetQuestionCount(interview: { policyConfig?: string }): number {
  return readPolicyConfig(interview.policyConfig)?.trainingPlan ? 3 : 7;
}

export function createTrainingPlan(input: {
  sourceInterviewId: string;
  turns: InterviewTurn[];
  states: SkillState[];
  jobWeights: Record<SkillKey, number>;
  previousPlan?: TrainingPlan;
  questionBankVersion?: QuestionBankVersion;
}): TrainingPlan | null {
  const bankVersion = input.questionBankVersion ?? CURRENT_QUESTION_BANK_VERSION;
  const bank = listQuestions(bankVersion);
  const getQuestion = (id: string) => getInterviewQuestion(id, bankVersion);
  const completed = input.turns.filter((turn) => turn.status === "completed" && turn.answerText.trim());
  if (!completed.length) return null;
  const evidence = completed.flatMap((turn) => {
    const question = turn.questionId ? getQuestion(turn.questionId) : undefined;
    if (!question) return [];
    try {
      const evaluation = JSON.parse(turn.evaluation);
      if (evaluation.evaluator === "DEMO_FIXTURE") return [];
      const accepted = evaluation.action === "ACCEPT" && evaluation.evaluator === "RUBRIC_DOUBLE_PASS";
      const score = typeof evaluation.totalScore === "number" && Number.isFinite(evaluation.totalScore)
        ? evaluation.totalScore : 1;
      return [{ question, accepted, score }];
    } catch { return []; }
  });
  if (!evidence.length) return null;
  const seenQuestionIds = [...new Set([
    ...(input.previousPlan?.seenQuestionIds ?? []),
    ...evidence.map(({ question }) => question.sourceQuestionId),
  ])];
  const seenFamilies = new Set(seenQuestionIds.map((id) => getQuestion(id)?.family).filter(Boolean));
  const weak = evidence.filter((item) => item.accepted && item.score < 0.625)
    .sort((a, b) => (1 - b.score) * input.jobWeights[b.question.skill] - (1 - a.score) * input.jobWeights[a.question.skill] || a.question.id.localeCompare(b.question.id));
  const skills = (Object.keys(SKILL_LABELS) as SkillKey[]).sort((a, b) => {
    const aCount = evidence.filter((e) => e.question.skill === a && e.accepted).length;
    const bCount = evidence.filter((e) => e.question.skill === b && e.accepted).length;
    const aUncertainty = input.states.find((state) => state.skill === a)?.uncertainty ?? 1;
    const bUncertainty = input.states.find((state) => state.skill === b)?.uncertainty ?? 1;
    return Number(bCount === 0) - Number(aCount === 0) ||
      bUncertainty * input.jobWeights[b] - aUncertainty * input.jobWeights[a] || a.localeCompare(b);
  });
  // Rank evidence-backed gaps first, then other topics by the existing skill
  // priority. Exhausting one topic must not discard all other eligible plans.
  const targets = [
    ...weak.map(({ question }) => ({ skill: question.skill, topic: question.topic })),
    ...skills.flatMap((skill) => {
      const observedTopics = evidence.filter((item) => item.question.skill === skill).map((item) => item.question.topic);
      const topics = [...new Set([...observedTopics, ...bank.filter((q) => q.skill === skill).map((q) => q.topic)])];
      return topics.map((topic) => ({ skill, topic }));
    }),
  ].filter((target, index, all) => target.topic && all.findIndex((item) => item.skill === target.skill && item.topic === target.topic) === index);
  for (const [targetIndex, { skill: focusSkill, topic }] of targets.entries()) {
    if (!topic) continue;
    const topicEvidence = evidence.filter((item) => item.question.skill === focusSkill && item.question.topic === topic);
    const gap = weak.find((item) => item.question.skill === focusSkill && item.question.topic === topic);
    const source = gap?.question ?? topicEvidence[0]?.question;
    const kind = gap ? "gap" : topicEvidence.some((item) => item.accepted) ? "reinforcement" : "insufficient_evidence";
    const targetDifficulty = gap ? Math.max(1, gap.question.difficulty - 1) : 2;
    const candidates = bank.filter((question) => question.skill === focusSkill && question.topic === topic && !question.isAnchor && !seenQuestionIds.includes(question.id))
      .sort((a, b) => Math.abs(a.difficulty - targetDifficulty) - Math.abs(b.difficulty - targetDifficulty) || a.id.localeCompare(b.id));
    for (const transfer of candidates.filter((q) => q.family && !seenFamilies.has(q.family))) {
      const practice = candidates.filter((q) => q.id !== transfer.id && q.family !== transfer.family).slice(0, 2);
      if (practice.length !== 2) continue;
      const reason = kind === "gap"
        ? `本轮在“${topic}”已有可靠低分证据，先练习相关方法，再用新场景复测。`
        : kind === "insufficient_evidence"
          ? `本轮对“${topic}”的可靠证据不足；本次用于补充观察，不将未测清楚视为能力薄弱。`
          : `用“${topic}”的新场景检查方法是否能够迁移，单次结果不代表稳定能力。`;
      return {
        version: "practice-plan-v1", sourceInterviewId: input.sourceInterviewId,
        focusSkill, topic, kind, seenQuestionIds,
        reason: targetIndex > 0 ? `优先主题暂缺完整的未见题组，本次转向“${topic}”。${reason}` : reason,
        questionIds: [...practice.map((q) => q.id), transfer.id],
        learningPoints: source?.learningPoints ?? source?.rubric.map((item) => item.criterion) ?? practice[0].learningPoints ?? [],
      };
    }
  }
  return null;
}

export function publicTrainingContext(interview: { policyConfig?: string }, turns: InterviewTurn[], nextQuestionId?: string) {
  const plan = readPolicyConfig(interview.policyConfig)?.trainingPlan;
  if (!plan) return null;
  const getQuestion = (id: string) => getInterviewQuestion(id, interviewQuestionBankVersion(interview));
  const completed = turns.filter((turn) => turn.status === "completed" && turn.questionType !== "verification");
  const next = nextQuestionId ? getQuestion(nextQuestionId) : undefined;
  // A follow-up to practice 2 still belongs to practice, even though two main
  // answers are saved. Only the reserved transfer question crosses the boundary.
  const stage = next ? (next.sourceQuestionId === plan.questionIds[2] ? "transfer" : "practice")
    : completed.length >= 2 ? "transfer" : "practice";
  const previous = turns.filter((turn) => turn.status === "completed").at(-1);
  let feedback: { strengths: string[]; gaps: string[]; learningPoints: string[] } | null = null;
  if (previous?.questionId && completed.length <= 2) {
    try {
      const evaluation = JSON.parse(previous.evaluation);
      const question = getQuestion(previous.questionId);
      feedback = { strengths: evaluation.strengths ?? [], gaps: evaluation.gaps ?? [], learningPoints: question?.learningPoints ?? [] };
    } catch { /* A corrupt feedback record must not expose a future answer. */ }
  }
  return { focusSkill: plan.focusSkill, topic: plan.topic, reason: plan.reason, stage,
    learningPoints: stage === "practice" ? plan.learningPoints : [], feedback };
}
