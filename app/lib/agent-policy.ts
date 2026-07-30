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
import {
  normalizeDifficulty,
  parsePosterior,
  scoreQuestionUtility,
  summarizePosterior,
  updatePosterior,
  type UtilitySignals,
} from "./rasch-policy";

export type Reliability = "HIGH" | "MEDIUM" | "LOW";
export type AgentAction = "ACCEPT" | "VERIFY" | "ABSTAIN";

export type AnswerEvaluation = {
  evaluator: "STRUCTURE_HEURISTIC" | "RUBRIC_DOUBLE_PASS";
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
    evidenceCoverage?: number;
    reviewDisagreement?: number;
  };
  disclaimer: string;
  semantic?: {
    model: string;
    criteria: Array<{
      criterion: string;
      score: number;
      evidence: string[];
    }>;
    primaryScore: number;
    reviewScore: number;
  };
  telemetry?: {
    model: string;
    latencyMs: number;
    inputTokens: number | null;
    outputTokens: number | null;
  };
};

export type HeuristicEvaluation = AnswerEvaluation;

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
  ranking: SelectionCandidate[];
  context: SelectionContext | null;
};

export type SelectionCandidate = {
  questionId: string;
  questionText: string;
  skill: SkillKey;
  difficulty: number;
  expectedSeconds: number;
  utility: number;
  signals: UtilitySignals;
};

export type SelectionContext = {
  remainingSeconds: number;
  jobWeights: Record<SkillKey, number>;
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
  const prior = parsePosterior(
    previous.posterior,
    previous.posteriorMean,
    previous.uncertainty,
  );
  const posterior = accepted
    ? updatePosterior(
        prior,
        normalizeDifficulty(question.difficulty),
        evaluation.totalScore,
      )
    : prior;
  const summary = summarizePosterior(posterior);
  const posteriorMean = summary.mean;
  const uncertainty = summary.standardDeviation;

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
    posterior: posterior.map((point) => ({
      theta: point.theta,
      probability: round(point.probability, 10),
    })),
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
          ranking: [],
          context: null,
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
      ranking: [],
      context: null,
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
      ranking: [],
      context: null,
    };
  }

  const stateBySkill = new Map(
    skillStates.map((state) => [state.skill, state]),
  );
  const jobWeights = inferJobWeights(interview.jobDescription);
  const maxJobWeight = Math.max(...Object.values(jobWeights), 1e-9);
  const answeredBySkill = new Map<SkillKey, number>();
  for (const turn of substantiveTurns) {
    if (!(turn.skill in jobWeights)) continue;
    const skill = turn.skill as SkillKey;
    answeredBySkill.set(skill, (answeredBySkill.get(skill) ?? 0) + 1);
  }
  const candidates = listQuestions().filter(
    (question) => !question.isAnchor && !askedSourceIds.has(question.id),
  );
  const remainingSeconds = Math.max(
    interview.durationMinutes * 60 -
      substantiveTurns.reduce(
        (total, turn) =>
          total +
          (turn.questionId
            ? (getInterviewQuestion(turn.questionId)?.expectedSeconds ?? 120)
            : 120),
        0,
      ),
    1,
  );
  const scored = candidates
    .map((question) => ({
      question,
      signals: selectionSignals(
        question,
        stateBySkill.get(question.skill),
        interview.jobDescription,
        jobWeights,
        maxJobWeight,
        answeredBySkill.get(question.skill) ?? 0,
        remainingSeconds,
      ),
    }))
    .sort(
      (left, right) =>
        right.signals.utility - left.signals.utility ||
        left.question.id.localeCompare(right.question.id),
    );
  const winner = scored[0];
  if (!winner) {
    return {
      nextQuestion: null,
      action: "ABSTAIN",
      reason: "题库中没有满足约束的未作答问题。",
      utility: null,
      ranking: [],
      context: {
        remainingSeconds,
        jobWeights: roundWeights(jobWeights),
      },
    };
  }

  const ranking = scored.slice(0, 5).map(({ question, signals }) => ({
    questionId: question.id,
    questionText: question.question,
    skill: question.skill,
    difficulty: question.difficulty,
    expectedSeconds: question.expectedSeconds,
    utility: round(signals.utility),
    signals: roundUtilitySignals(signals),
  }));

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
    utility: round(winner.signals.utility),
    ranking,
    context: {
      remainingSeconds,
      jobWeights: roundWeights(jobWeights),
    },
  };
}

function selectionSignals(
  question: BankQuestion,
  state: SkillState | undefined,
  jobDescription: string,
  jobWeights: Record<SkillKey, number>,
  maxJobWeight: number,
  answeredCount: number,
  remainingSeconds: number,
): UtilitySignals {
  const jd = jobDescription.toLowerCase();
  const tagHits = question.jobTags.filter((tag) =>
    jd.includes(tag.toLowerCase()),
  ).length;
  const questionRelevance = Math.min(1, 0.35 + tagHits * 0.2);
  const posterior = parsePosterior(
    state?.posterior ?? "[]",
    state?.posteriorMean ?? 0,
    state?.uncertainty ?? 1,
  );
  return scoreQuestionUtility({
    posterior,
    difficulty: normalizeDifficulty(question.difficulty),
    questionRelevance,
    skillJobWeight: jobWeights[question.skill],
    maxJobWeight,
    answeredCount,
    expectedSeconds: question.expectedSeconds,
    remainingSeconds,
  });
}

const JOB_SKILL_TERMS: Record<SkillKey, string[]> = {
  statistics_ml: [
    "统计",
    "机器学习",
    "预测",
    "分类",
    "回归",
    "模型",
  ],
  experiment_causal: [
    "实验",
    "a/b",
    "ab测试",
    "因果",
    "策略",
    "增长",
  ],
  sql_python: [
    "sql",
    "python",
    "数据处理",
    "etl",
    "数仓",
    "工程",
  ],
  business_analytics: [
    "业务",
    "指标",
    "分析",
    "运营",
    "产品",
    "商业",
  ],
};

function inferJobWeights(jobDescription: string): Record<SkillKey, number> {
  const normalized = jobDescription.toLowerCase();
  const raw = Object.fromEntries(
    Object.entries(JOB_SKILL_TERMS).map(([skill, terms]) => [
      skill,
      1 + terms.filter((term) => normalized.includes(term)).length,
    ]),
  ) as Record<SkillKey, number>;
  const total = Object.values(raw).reduce(
    (sum, weight) => sum + weight,
    0,
  );
  return Object.fromEntries(
    Object.entries(raw).map(([skill, weight]) => [
      skill,
      weight / total,
    ]),
  ) as Record<SkillKey, number>;
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

function roundUtilitySignals(signals: UtilitySignals): UtilitySignals {
  return {
    utility: round(signals.utility),
    informationGain: round(signals.informationGain, 6),
    normalizedInformationGain: round(
      signals.normalizedInformationGain,
      6,
    ),
    jdRelevance: round(signals.jdRelevance, 6),
    coverageNeed: round(signals.coverageNeed, 6),
    timeCost: round(signals.timeCost, 6),
  };
}

function roundWeights(
  weights: Record<SkillKey, number>,
): Record<SkillKey, number> {
  return Object.fromEntries(
    Object.entries(weights).map(([skill, value]) => [
      skill,
      round(value, 6),
    ]),
  ) as Record<SkillKey, number>;
}

function round(value: number, precision = 4): number {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}
