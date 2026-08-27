import {
  evaluateAnswer,
  type AnswerEvaluation,
} from "./agent-policy";
import type { InterviewQuestion } from "./question-bank";

export const GUIDED_DEMO_MODE = "guided_demo";
export const GUIDED_DEMO_VERSION = "sql-analyst-v1";

export const GUIDED_DEMO_REQUEST = {
  jobTitle: "增长数据分析实习生（引导演示）",
  jobDescription:
    "负责增长漏斗和留存分析，熟练使用 SQL 与 Python 完成数据提取、口径校验和异常排查；参与 A/B 测试设计、实验指标分析与业务复盘。",
  candidateBackground:
    "演示候选人：应用统计研一，掌握统计推断、SQL、Python 和基础实验设计。所有回答均为可复现的合成演示数据。",
  durationMinutes: 15,
  cameraEnabled: false,
  recordingEnabled: false,
  mode: GUIDED_DEMO_MODE,
} as const;

export type GuidedDemoAnswerOption = {
  id: "strong" | "weak";
  label: string;
  description: string;
  answer: string;
  recommended: boolean;
};

export type GuidedDemoPayload = {
  version: string;
  synthetic: true;
  step: string;
  instruction: string;
  answerOptions: GuidedDemoAnswerOption[];
};

export function buildGuidedDemoPayload(input: {
  question: InterviewQuestion;
  completedTurns: number;
  substantiveTurns: number;
}): GuidedDemoPayload {
  const firstQuestion =
    input.completedTurns === 0 && input.substantiveTurns === 0;
  const verification = input.question.questionType === "verification";
  const recommendWeak = firstQuestion || verification;

  return {
    version: GUIDED_DEMO_VERSION,
    synthetic: true,
    step: verification
      ? "步骤 2 · 让限定追问仍然缺少证据，观察 ABSTAIN"
      : firstQuestion
        ? "步骤 1 · 先提交弱回答，稳定触发 VERIFY"
        : input.question.questionType === "adaptive"
          ? "步骤 4 · 观察岗位权重驱动的自适应选题"
          : "步骤 3 · 使用完整回答建立能力证据",
    instruction: verification
      ? "推荐载入“仍然不足”：Agent 会保留先验并继续，而不是编造能力结论。"
      : firstQuestion
        ? "推荐先载入“证据不足”：下一轮会进入一次受限追问。"
        : "推荐载入“完整证据”：该回答会以演示夹具评分，更新能力状态。",
    answerOptions: [
      {
        id: "strong",
        label: "载入完整证据回答",
        description: "演示 ACCEPT 与能力后验更新",
        answer: buildStrongDemoAnswer(input.question),
        recommended: !recommendWeak,
      },
      {
        id: "weak",
        label: verification ? "载入仍然不足回答" : "载入证据不足回答",
        description: verification
          ? "演示限定追问后的 ABSTAIN"
          : "演示低可靠性 VERIFY",
        answer: buildWeakDemoAnswer(input.question),
        recommended: recommendWeak,
      },
    ],
  };
}

export function evaluateGuidedDemoAnswer(
  question: InterviewQuestion,
  answer: string,
): AnswerEvaluation {
  const normalized = answer.trim();
  const strongAnswer = buildStrongDemoAnswer(question);
  const weakAnswer = buildWeakDemoAnswer(question);

  if (normalized === strongAnswer) {
    const scoreOutOfFour = round(
      Math.max(2.8, Math.min(3.6, 3.35 - (question.difficulty - 2) * 0.08)),
    );
    const evidence = criterionSentences(question).slice(0, 4);
    return {
      evaluator: "DEMO_FIXTURE",
      totalScore: round(scoreOutOfFour / 4),
      scoreOutOfFour,
      reliability: "HIGH",
      action: "ACCEPT",
      evidence,
      strengths: [
        "演示回答覆盖了量表要求的判断、条件和验证动作。",
        "每条演示证据都可以在回答原文中逐字定位。",
      ],
      gaps: ["这是合成演示证据，不能作为真实候选人能力结论。"],
      signals: {
        answerCharacters: normalized.length,
        domainKeywords: [],
        reasoningSignals: ["判断", "条件", "验证"],
        evidenceCoverage: 1,
        reviewDisagreement: 0,
      },
      fixture: {
        scenarioVersion: GUIDED_DEMO_VERSION,
        answerVariant: "strong",
      },
      disclaimer:
        "本轮使用明确标记的确定性演示夹具，目的是复现 Agent 状态转移，不是模型评分或真实能力测量。",
    };
  }

  if (normalized === weakAnswer) {
    const afterVerification = question.questionType === "verification";
    return {
      evaluator: "DEMO_FIXTURE",
      totalScore: 0.15,
      scoreOutOfFour: 0.6,
      reliability: "LOW",
      action: afterVerification ? "ABSTAIN" : "VERIFY",
      evidence: [weakAnswer],
      strengths: [],
      gaps: [
        afterVerification
          ? "限定追问后仍没有新增可核验依据，因此拒绝更新能力。"
          : "缺少数据口径、判断条件和验证动作，需要一次限定追问。",
      ],
      signals: {
        answerCharacters: normalized.length,
        domainKeywords: [],
        reasoningSignals: [],
        evidenceCoverage: 0.1,
        reviewDisagreement: 0,
      },
      fixture: {
        scenarioVersion: GUIDED_DEMO_VERSION,
        answerVariant: "weak",
      },
      disclaimer:
        "本轮使用明确标记的确定性演示夹具，目的是复现 VERIFY/ABSTAIN 边界，不是模型评分或真实能力测量。",
    };
  }

  return {
    ...evaluateAnswer(question, answer),
    disclaimer:
      "你修改了引导演示回答，因此本轮只运行结构化降级反馈，不会把结果写入能力后验。",
  };
}

function buildStrongDemoAnswer(question: InterviewQuestion): string {
  return [
    "这是引导演示中的合成完整回答，我会按判断、条件和验证动作展开。",
    ...criterionSentences(question),
    "最后，我会保留原始口径、查询或实验记录，让上述判断可以被另一位分析师复核。",
  ].join("\n");
}

function buildWeakDemoAnswer(question: InterviewQuestion): string {
  return question.questionType === "verification"
    ? "我暂时只能重复上一轮结论，没有新的数据、计算过程或可核验的判断标准可以补充。"
    : "我会先看最终指标有没有上涨；如果上涨就认为方案有效，暂时不检查样本偏差、指标口径或其他条件。";
}

function criterionSentences(question: InterviewQuestion): string[] {
  const prefixes = ["第一", "第二", "第三", "第四", "第五"];
  return question.rubric.map((criterion, index) => {
    const content = criterion.criterion.replace(/[。！？!?]+$/u, "");
    return `${prefixes[index] ?? `第 ${index + 1} 点`}，${content}。`;
  });
}

function round(value: number, precision = 4): number {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}
