import type {
  Interview,
  InterviewTurn,
  SkillState,
} from "@/db/schema";
import {
  getInterviewQuestion,
  listAnchorQuestions,
  listQuestions,
  type BankQuestion,
  type InterviewQuestion,
  type SkillKey,
} from "./question-bank";

export type Reliability = "HIGH" | "MEDIUM" | "LOW";
export type AgentAction = "ACCEPT" | "VERIFY" | "ABSTAIN";

export type HeuristicEvaluation = {
  evaluator: "STRUCTURE_HEURISTIC";
  totalScore: number;
  scoreOutOfFour: number;
  reliability: Reliability;
  action: AgentAction;
  evidence: string[];
  strengths: string[];
  gaps: string[];
  signals: {
    answerCharacters: number;
    domainKeywords: string[];
    reasoningSignals: string[];
  };
  disclaimer: string;
};

export type AbilityUpdate = {
  posteriorMean: number;
  uncertainty: number;
  posterior: Array<{ theta: number; probability: number }>;
  supportingEvidence: unknown[];
  commonErrors: string[];
  sourceTurnCount: number;
};

export type SelectionResult = {
  nextQuestion: InterviewQuestion | null;
  action: AgentAction | "COMPLETE";
  reason: string;
  utility: number | null;
};

const DOMAIN_KEYWORDS: Record<SkillKey, string[]> = {
  statistics_ml: [
    "准确率",
    "召回",
    "精确率",
    "f1",
    "auc",
    "类别",
    "不平衡",
    "测试集",
    "交叉验证",
    "基线",
    "置信区间",
    "样本",
    "偏差",
    "方差",
    "过拟合",
  ],
  experiment_causal: [
    "显著",
    "p值",
    "置信区间",
    "样本量",
    "功效",
    "随机",
    "分流",
    "护栏",
    "多重",
    "业务",
    "效应",
    "a/a",
    "srm",
    "因果",
  ],
  sql_python: [
    "分区",
    "索引",
    "聚合",
    "窗口",
    "cte",
    "执行计划",
    "分批",
    "校验",
    "去重",
    "主键",
    "日期",
    "口径",
    "null",
    "抽样",
    "python",
  ],
  business_analytics: [
    "指标",
    "维度",
    "漏斗",
    "用户",
    "渠道",
    "版本",
    "地区",
    "分群",
    "假设",
    "验证",
    "优先级",
    "因果",
    "数据质量",
    "季节",
    "基线",
  ],
};

const REASONING_SIGNALS = [
  "首先",
  "其次",
  "然后",
  "最后",
  "如果",
  "因为",
  "因此",
  "验证",
  "检查",
  "对比",
  "假设",
  "排除",
];

const DEFAULT_GAPS: Record<SkillKey, string[]> = {
  statistics_ml: ["补充指标选择、数据划分与反例验证。"],
  experiment_causal: ["补充样本量、护栏指标与业务显著性的决策条件。"],
  sql_python: ["补充数据口径、性能方案与结果校验步骤。"],
  business_analytics: ["补充拆解维度、优先级依据与可证伪假设。"],
};

export function evaluateAnswer(
  question: InterviewQuestion,
  answer: string,
): HeuristicEvaluation {
  const normalized = answer.trim().toLowerCase();
  const domainKeywords = DOMAIN_KEYWORDS[question.skill].filter((keyword) =>
    normalized.includes(keyword),
  );
  const reasoningSignals = REASONING_SIGNALS.filter((signal) =>
    normalized.includes(signal),
  );
  const sentences = answer
    .split(/[。！？!?\n]/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const evidence = sentences
    .filter((sentence) =>
      [...domainKeywords, ...reasoningSignals].some((keyword) =>
        sentence.toLowerCase().includes(keyword),
      ),
    )
    .slice(0, 3);

  const lengthScore = Math.min(normalized.length / 260, 1);
  const domainScore = Math.min(domainKeywords.length / 6, 1);
  const reasoningScore = Math.min(reasoningSignals.length / 4, 1);
  const evidenceScore = Math.min(evidence.length / 3, 1);
  const totalScore = round(
    0.2 * lengthScore +
      0.4 * domainScore +
      0.25 * reasoningScore +
      0.15 * evidenceScore,
  );

  const reliability: Reliability =
    normalized.length >= 180 &&
    domainKeywords.length >= 5 &&
    reasoningSignals.length >= 3
      ? "HIGH"
      : normalized.length >= 80 &&
          domainKeywords.length >= 2 &&
          reasoningSignals.length >= 1
        ? "MEDIUM"
        : "LOW";
  const action: AgentAction =
    reliability === "LOW" ? "VERIFY" : "ACCEPT";

  const strengths: string[] = [];
  if (domainKeywords.length >= 2) {
    strengths.push(`回答覆盖了 ${domainKeywords.slice(0, 4).join("、")} 等关键概念。`);
  }
  if (reasoningSignals.length >= 2) {
    strengths.push("回答包含条件、判断与验证步骤，而不只是给出结论。");
  }
  if (evidence.length >= 2) {
    strengths.push("可以从原回答中定位多条支撑判断的文本证据。");
  }

  const gaps: string[] = [];
  if (domainKeywords.length < 3) {
    gaps.push(DEFAULT_GAPS[question.skill][0]);
  }
  if (reasoningSignals.length < 2) {
    gaps.push("把结论改写成“假设—所需数据—判断标准—验证动作”的完整链条。");
  }
  if (normalized.length < 80) {
    gaps.push("当前回答较短，证据不足，系统不会把它当作稳定能力结论。");
  }

  return {
    evaluator: "STRUCTURE_HEURISTIC",
    totalScore,
    scoreOutOfFour: round(totalScore * 4),
    reliability,
    action,
    evidence,
    strengths,
    gaps,
    signals: {
      answerCharacters: normalized.length,
      domainKeywords,
      reasoningSignals,
    },
    disclaimer:
      "当前为无模型密钥时的结构化降级评估，只衡量可观察的回答结构与术语覆盖，不替代语义评分。",
  };
}

export function updateAbility(
  previous: SkillState,
  question: InterviewQuestion,
  evaluation: HeuristicEvaluation,
  turnId: string,
): AbilityUpdate {
  const accepted = evaluation.action === "ACCEPT";
  const difficulty = (question.difficulty - 3) * 0.75;
  const prediction = sigmoid(previous.posteriorMean - difficulty);
  const learningRate = evaluation.reliability === "HIGH" ? 0.9 : 0.65;
  const posteriorMean = accepted
    ? clamp(
        previous.posteriorMean +
          previous.uncertainty *
            learningRate *
            (evaluation.totalScore - prediction),
        -3,
        3,
      )
    : previous.posteriorMean;
  const uncertainty = accepted
    ? Math.max(
        0.22,
        previous.uncertainty *
          (evaluation.reliability === "HIGH" ? 0.72 : 0.84),
      )
    : Math.max(0.22, previous.uncertainty * 0.98);

  const priorEvidence = parseArray(previous.supportingEvidence);
  const priorErrors = parseArray(previous.commonErrors).filter(
    (item): item is string => typeof item === "string",
  );
  const supportingEvidence = accepted
    ? [
        ...priorEvidence,
        {
          turnId,
          questionId: question.id,
          score: evaluation.totalScore,
          reliability: evaluation.reliability,
          quotes: evaluation.evidence,
        },
      ].slice(-12)
    : priorEvidence;
  const commonErrors = [...new Set([...priorErrors, ...evaluation.gaps])].slice(
    -12,
  );

  return {
    posteriorMean: round(posteriorMean),
    uncertainty: round(uncertainty),
    posterior: approximatePosterior(posteriorMean, uncertainty),
    supportingEvidence,
    commonErrors,
    sourceTurnCount: previous.sourceTurnCount + (accepted ? 1 : 0),
  };
}

export function selectNextQuestion(input: {
  interview: Pick<
    Interview,
    "jobDescription" | "durationMinutes" | "verificationCount"
  >;
  turns: InterviewTurn[];
  skillStates: SkillState[];
}): SelectionResult {
  const { interview, turns, skillStates } = input;
  const completedTurns = turns.filter(
    (turn) => turn.status === "completed" && turn.answerText.trim().length > 0,
  );
  const lastTurn = completedTurns.at(-1);
  const lastEvaluation = lastTurn
    ? parseObject(lastTurn.evaluation)
    : undefined;

  if (
    lastTurn &&
    lastTurn.questionType !== "verification" &&
    lastEvaluation?.reliability === "LOW" &&
    interview.verificationCount < 2
  ) {
    const source = lastTurn.questionId
      ? getInterviewQuestion(lastTurn.questionId)
      : undefined;
    if (source?.verificationQuestions[0]) {
      const verification = getInterviewQuestion(
        `${source.sourceQuestionId}__verify_0`,
      );
      if (verification) {
        return {
          nextQuestion: verification,
          action: "VERIFY",
          reason: "上一轮证据可靠性为 LOW，先用限定追问验证，再决定是否更新能力。",
          utility: null,
        };
      }
    }
  }

  const shouldAbstainFromLastQuestion =
    lastEvaluation?.reliability === "LOW" &&
    (lastTurn?.questionType === "verification" ||
      interview.verificationCount >= 2);

  const askedSourceIds = new Set(
    completedTurns
      .map((turn) => turn.questionId)
      .filter((id): id is string => Boolean(id))
      .map((id) => id.split("__verify_")[0]),
  );
  const nextAnchor = listAnchorQuestions().find(
    (question) => !askedSourceIds.has(question.id),
  );
  if (nextAnchor) {
    return {
      nextQuestion: nextAnchor,
      action: shouldAbstainFromLastQuestion ? "ABSTAIN" : "ACCEPT",
      reason: shouldAbstainFromLastQuestion
        ? "限定追问后证据仍不足，放弃上一题评分并继续下一个固定锚点。"
        : "固定锚点用于建立四个能力维度之间可比较的初始状态。",
      utility: null,
    };
  }

  const substantiveTurns = completedTurns.filter(
    (turn) => turn.questionType !== "verification",
  );
  if (substantiveTurns.length >= 6) {
    return {
      nextQuestion: null,
      action: "COMPLETE",
      reason: "已完成四道锚点题和两道信息增益最高的自适应题。",
      utility: null,
    };
  }

  const stateBySkill = new Map(
    skillStates.map((state) => [state.skill, state]),
  );
  const candidates = listQuestions().filter(
    (question) => !question.isAnchor && !askedSourceIds.has(question.id),
  );
  const scored = candidates
    .map((question) => ({
      question,
      utility: selectionUtility(
        question,
        stateBySkill.get(question.skill),
        interview.jobDescription,
        interview.durationMinutes,
      ),
    }))
    .sort(
      (left, right) =>
        right.utility - left.utility ||
        left.question.id.localeCompare(right.question.id),
    );
  const winner = scored[0];
  if (!winner) {
    return {
      nextQuestion: null,
      action: "ABSTAIN",
      reason: "题库中没有满足约束的未作答问题。",
      utility: null,
    };
  }

  return {
    nextQuestion: {
      ...winner.question,
      questionType: "adaptive",
      sourceQuestionId: winner.question.id,
    },
    action: shouldAbstainFromLastQuestion ? "ABSTAIN" : "ACCEPT",
    reason: shouldAbstainFromLastQuestion
      ? "上一题在追问后仍证据不足，Agent 拒绝评分；随后按信息价值选择新的能力题。"
      : "综合当前能力不确定性、题目难度匹配、岗位关键词和剩余时长后，该题的信息价值最高。",
    utility: round(winner.utility),
  };
}

function selectionUtility(
  question: BankQuestion,
  state: SkillState | undefined,
  jobDescription: string,
  durationMinutes: number,
): number {
  const mean = state?.posteriorMean ?? 0;
  const uncertainty = state?.uncertainty ?? 1;
  const difficulty = (question.difficulty - 3) * 0.75;
  const difficultyMatch = 1 - Math.min(Math.abs(mean - difficulty) / 3, 1);
  const jd = jobDescription.toLowerCase();
  const tagHits = question.jobTags.filter((tag) =>
    jd.includes(tag.toLowerCase()),
  ).length;
  const jdRelevance = Math.min(1, 0.35 + tagHits * 0.2);
  const timeCost = Math.min(
    1,
    question.expectedSeconds / Math.max(durationMinutes * 60, 1),
  );
  return (
    uncertainty * 0.46 +
    difficultyMatch * 0.28 +
    jdRelevance * 0.2 -
    timeCost * 0.06
  );
}

function approximatePosterior(mean: number, uncertainty: number) {
  const grid = [-3, -2, -1, 0, 1, 2, 3];
  const sigma = Math.max(uncertainty, 0.22);
  const weights = grid.map((theta) =>
    Math.exp(-((theta - mean) ** 2) / (2 * sigma ** 2)),
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return grid.map((theta, index) => ({
    theta,
    probability: round(weights[index] / total),
  }));
}

function parseArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, precision = 4): number {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}
