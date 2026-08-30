import type {
  Interview,
  InterviewTurn,
  SkillState,
} from "@/db/schema";
import {
  getInterviewQuestion,
  listQuestions,
  SKILL_LABELS,
  toRoleAnchorQuestion,
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
  evaluator: "STRUCTURE_HEURISTIC" | "RUBRIC_DOUBLE_PASS" | "DEMO_FIXTURE";
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
    structureConfidence?: Reliability;
  };
  disclaimer: string;
  semantic?: {
    model: string;
    promptVersion?: string;
    questionFingerprint?: string;
    requestFingerprint?: string;
    criteria: Array<{
      criterion: string;
      score: number;
      evidence: string[];
    }>;
    primaryScore: number;
    reviewScore: number;
    passes?: {
      primary: Array<{
        criterionIndex: number;
        score: number;
        evidence: string[];
      }>;
      review: Array<{
        criterionIndex: number;
        score: number;
        evidence: string[];
      }>;
    };
  };
  telemetry?: {
    model: string;
    latencyMs: number;
    inputTokens: number | null;
    outputTokens: number | null;
    estimatedCostMicrousd: number | null;
    pricingStatus: "NOT_MEASURED" | "PRICED" | "UNPRICED";
    pricingVersion: string | null;
  };
  fixture?: {
    scenarioVersion: string;
    answerVariant: "strong" | "weak";
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
  routing: {
    targetDifficulty: number;
    scenarioMatch: number;
  } | null;
};

export type SelectionContext = {
  policyVersion: typeof SELECTION_POLICY_VERSION;
  selectionPhase: SelectionPhase;
  remainingSeconds: number;
  jobWeights: Record<SkillKey, number>;
  candidateRouting: CandidateRouting;
};

export type SelectionPhase =
  | "public_anchor"
  | "jd_directed_baseline"
  | "posterior_adaptive";

export type CandidateRouting = {
  experienceBand: "beginner" | "intermediate" | "advanced";
  preferredDifficulty: 2 | 3 | 4;
  scenarioTags: string[];
};

export const SELECTION_POLICY_VERSION = "three-stage-v2";
export const TARGET_SUBSTANTIVE_TURNS = 7;
const PUBLIC_ANCHOR_IDS = [
  "statistics_ml_002",
  "business_analytics_002",
] as const;
const PUBLIC_ANCHOR_COUNT = PUBLIC_ANCHOR_IDS.length;
const JD_BASELINE_COUNT = 2;
const MAX_VERIFICATIONS = 2;

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

  const structureConfidence: Reliability =
    normalized.length >= 180 &&
    domainKeywords.length >= 5 &&
    reasoningSignals.length >= 3
      ? "HIGH"
      : normalized.length >= 80 &&
          domainKeywords.length >= 2 &&
          reasoningSignals.length >= 1
        ? "MEDIUM"
        : "LOW";
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
    reliability: "LOW",
    action: "ABSTAIN",
    evidence,
    strengths,
    gaps,
    signals: {
      answerCharacters: normalized.length,
      domainKeywords,
      reasoningSignals,
      structureConfidence,
    },
    disclaimer:
      "当前为无模型密钥时的结构化降级评估，只衡量可观察的回答结构与术语覆盖，不替代语义评分，也不会写入能力后验。",
  };
}

export function updateAbility(
  previous: SkillState,
  question: InterviewQuestion,
  evaluation: HeuristicEvaluation,
  turnId: string,
): AbilityUpdate {
  const accepted = evaluation.action === "ACCEPT";
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
  if (!accepted) {
    return {
      posteriorMean: previous.posteriorMean,
      uncertainty: previous.uncertainty,
      posterior: parseStoredPosterior(previous.posterior),
      supportingEvidence,
      commonErrors,
      sourceTurnCount: previous.sourceTurnCount,
    };
  }

  const prior = parsePosterior(
    previous.posterior,
    previous.posteriorMean,
    previous.uncertainty,
  );
  const posterior = updatePosterior(
    prior,
    normalizeDifficulty(question.difficulty),
    evaluation.totalScore,
  );
  const summary = summarizePosterior(posterior);

  return {
    posteriorMean: round(summary.mean),
    uncertainty: round(summary.standardDeviation),
    posterior: posterior.map((point) => ({
      theta: point.theta,
      probability: round(point.probability, 10),
    })),
    supportingEvidence,
    commonErrors,
    sourceTurnCount: previous.sourceTurnCount + 1,
  };
}

export function selectNextQuestion(input: {
  interview: Pick<
    Interview,
    | "jobDescription"
    | "candidateBackground"
    | "durationMinutes"
    | "verificationCount"
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
  const lastAction = lastEvaluation?.action;

  if (
    lastTurn &&
    lastTurn.questionType !== "verification" &&
    lastAction === "VERIFY" &&
    interview.verificationCount < MAX_VERIFICATIONS
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
    lastAction === "ABSTAIN" ||
    (lastAction === "VERIFY" &&
      (lastTurn?.questionType === "verification" ||
        interview.verificationCount >= 2));
  const abstentionReason =
    lastEvaluation?.evaluator === "STRUCTURE_HEURISTIC"
      ? "当前仅有结构化反馈，未把它当作语义能力证据；保留先验并继续下一题。"
      : "限定追问后证据仍不足，放弃上一题评分并继续下一题。";

  const askedSourceIds = new Set(
    completedTurns
      .map((turn) => turn.questionId)
      .filter((id): id is string => Boolean(id))
      .map((id) => getInterviewQuestion(id)?.sourceQuestionId ?? id),
  );
  const substantiveTurns = completedTurns.filter(
    (turn) => turn.questionType !== "verification",
  );
  const candidateRouting = inferCandidateRouting(
    interview.candidateBackground,
  );
  const jobWeights = inferJobWeights(interview.jobDescription);
  const remainingSeconds = calculateRemainingSeconds(
    interview.durationMinutes,
    completedTurns,
  );

  if (substantiveTurns.length < PUBLIC_ANCHOR_COUNT) {
    const nextAnchor = getInterviewQuestion(
      PUBLIC_ANCHOR_IDS[substantiveTurns.length],
    );
    if (!nextAnchor) {
      throw new Error("configured public anchor is missing from the bank");
    }
    return {
      nextQuestion: nextAnchor,
      action: shouldAbstainFromLastQuestion ? "ABSTAIN" : "ACCEPT",
      reason: shouldAbstainFromLastQuestion
        ? abstentionReason
        : "公共锚点不读取 JD、候选人背景或能力后验，用于建立跨会话可比基线。",
      utility: null,
      ranking: [],
      context: selectionContext(
        "public_anchor",
        remainingSeconds,
        jobWeights,
        candidateRouting,
      ),
    };
  }

  if (
    substantiveTurns.length <
    PUBLIC_ANCHOR_COUNT + JD_BASELINE_COUNT
  ) {
    const frozenBaselineSeconds = Math.max(
      interview.durationMinutes * 60 -
        PUBLIC_ANCHOR_IDS.reduce(
          (total, id) =>
            total + (getInterviewQuestion(id)?.expectedSeconds ?? 120),
          0,
        ),
      1,
    );
    const baselineIndex =
      substantiveTurns.length - PUBLIC_ANCHOR_COUNT;
    const targetSkill = rankedJobSkills(jobWeights)[baselineIndex];
    const maxJobWeight = Math.max(...Object.values(jobWeights), 1e-9);
    const scored = listQuestions()
      .filter(
        (question) =>
          question.skill === targetSkill &&
          !askedSourceIds.has(question.id),
      )
      .map((question) => {
        const signals = baselineSignals(
          question,
          interview.jobDescription,
          jobWeights,
          maxJobWeight,
          candidateRouting,
          frozenBaselineSeconds,
        );
        return {
          question,
          signals,
          scenarioMatch: countScenarioMatches(
            question,
            candidateRouting.scenarioTags,
          ),
        };
      })
      .sort(
        (left, right) =>
          right.signals.utility - left.signals.utility ||
          right.scenarioMatch - left.scenarioMatch ||
          left.question.expectedSeconds - right.question.expectedSeconds ||
          left.question.id.localeCompare(right.question.id),
      );
    const winner = scored[0];
    if (!winner) {
      return noEligibleQuestion(
        remainingSeconds,
        jobWeights,
        candidateRouting,
        "jd_directed_baseline",
      );
    }
    const ranking = scored.slice(0, 5).map(
      ({ question, signals, scenarioMatch }) =>
        selectionCandidate(
          toRoleAnchorQuestion(question),
          signals,
          candidateRouting.preferredDifficulty,
          scenarioMatch,
        ),
    );
    return {
      nextQuestion: toRoleAnchorQuestion(winner.question),
      action: shouldAbstainFromLastQuestion ? "ABSTAIN" : "ACCEPT",
      reason: shouldAbstainFromLastQuestion
        ? `${abstentionReason}随后进入已冻结的 JD 定向基线阶段。`
        : `面试开始时已将“${SKILL_LABELS[targetSkill]}”冻结为第 ${baselineIndex + 1} 个 JD 定向基线维度；背景路由仅用于选择难度档位和场景，不参与评分。`,
      utility: round(winner.signals.utility),
      ranking,
      context: selectionContext(
        "jd_directed_baseline",
        frozenBaselineSeconds,
        jobWeights,
        candidateRouting,
      ),
    };
  }

  if (substantiveTurns.length >= TARGET_SUBSTANTIVE_TURNS) {
    return {
      nextQuestion: null,
      action: "COMPLETE",
      reason:
        "已完成两道公共锚点题、两道 JD 定向基线题和三道后验自适应题。",
      utility: null,
      ranking: [],
      context: selectionContext(
        "posterior_adaptive",
        remainingSeconds,
        jobWeights,
        candidateRouting,
      ),
    };
  }

  const stateBySkill = new Map(
    skillStates.map((state) => [state.skill, state]),
  );
  const maxJobWeight = Math.max(...Object.values(jobWeights), 1e-9);
  const answeredBySkill = new Map<SkillKey, number>();
  for (const turn of substantiveTurns) {
    if (!(turn.skill in jobWeights)) continue;
    const skill = turn.skill as SkillKey;
    answeredBySkill.set(skill, (answeredBySkill.get(skill) ?? 0) + 1);
  }
  const lastTwoSkills = substantiveTurns.slice(-2).map((turn) => turn.skill);
  const blockedSkill =
    lastTwoSkills.length === 2 && lastTwoSkills[0] === lastTwoSkills[1]
      ? lastTwoSkills[0]
      : null;
  const candidates = listQuestions().filter(
    (question) =>
      !question.isAnchor &&
      !askedSourceIds.has(question.id) &&
      question.skill !== blockedSkill,
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
        candidateRouting,
      ),
    }))
    .sort(
      (left, right) =>
        right.signals.utility - left.signals.utility ||
        left.question.id.localeCompare(right.question.id),
    );
  const winner = scored[0];
  if (!winner)
    return noEligibleQuestion(
      remainingSeconds,
      jobWeights,
      candidateRouting,
      "posterior_adaptive",
    );

  const ranking = scored
    .slice(0, 5)
    .map(({ question, signals }) =>
      selectionCandidate(
        question,
        signals,
        candidateRouting.preferredDifficulty,
        0,
      ),
    );

  return {
    nextQuestion: {
      ...winner.question,
      questionType: "adaptive",
      sourceQuestionId: winner.question.id,
    },
    action: shouldAbstainFromLastQuestion ? "ABSTAIN" : "ACCEPT",
    reason: shouldAbstainFromLastQuestion
      ? `${abstentionReason}随后按信息价值选择新的能力题。`
      : "综合能力后验不确定性、JD 相关度、覆盖需求、难度匹配和剩余时长后，该题效用最高。",
    utility: round(winner.signals.utility),
    ranking,
    context: selectionContext(
      "posterior_adaptive",
      remainingSeconds,
      jobWeights,
      candidateRouting,
    ),
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
  candidateRouting: CandidateRouting,
): UtilitySignals {
  const questionRelevance = questionJdRelevance(
    question,
    jobDescription,
  );
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
    difficultyMatch: difficultyMatch(
      question.difficulty,
      candidateRouting.preferredDifficulty,
    ),
  });
}

function baselineSignals(
  question: BankQuestion,
  jobDescription: string,
  jobWeights: Record<SkillKey, number>,
  maxJobWeight: number,
  candidateRouting: CandidateRouting,
  remainingSeconds: number,
): UtilitySignals {
  const questionRelevance = questionJdRelevance(
    question,
    jobDescription,
  );
  const jdRelevance = Math.min(
    1,
    0.5 * questionRelevance +
      0.5 * (jobWeights[question.skill] / maxJobWeight),
  );
  const matchedDifficulty = difficultyMatch(
    question.difficulty,
    candidateRouting.preferredDifficulty,
  );
  const timeCost = Math.min(
    question.expectedSeconds / Math.max(remainingSeconds, 1),
    1,
  );
  return {
    utility:
      0.25 * jdRelevance +
      0.15 +
      0.15 * matchedDifficulty -
      0.1 * timeCost,
    informationGain: 0,
    normalizedInformationGain: 0,
    jdRelevance,
    difficultyMatch: matchedDifficulty,
    coverageNeed: 1,
    timeCost,
  };
}

function selectionCandidate(
  question: BankQuestion,
  signals: UtilitySignals,
  targetDifficulty: number,
  scenarioMatch: number,
): SelectionCandidate {
  return {
    questionId: question.id,
    questionText: question.question,
    skill: question.skill,
    difficulty: question.difficulty,
    expectedSeconds: question.expectedSeconds,
    utility: round(signals.utility),
    signals: roundUtilitySignals(signals),
    routing: {
      targetDifficulty,
      scenarioMatch,
    },
  };
}

function selectionContext(
  selectionPhase: SelectionPhase,
  remainingSeconds: number,
  jobWeights: Record<SkillKey, number>,
  candidateRouting: CandidateRouting,
): SelectionContext {
  return {
    policyVersion: SELECTION_POLICY_VERSION,
    selectionPhase,
    remainingSeconds,
    jobWeights: roundWeights(jobWeights),
    candidateRouting,
  };
}

function noEligibleQuestion(
  remainingSeconds: number,
  jobWeights: Record<SkillKey, number>,
  candidateRouting: CandidateRouting,
  selectionPhase: SelectionPhase,
): SelectionResult {
  return {
    nextQuestion: null,
    action: "ABSTAIN",
    reason: "题库中没有满足阶段、覆盖与连续维度约束的未作答问题。",
    utility: null,
    ranking: [],
    context: selectionContext(
      selectionPhase,
      remainingSeconds,
      jobWeights,
      candidateRouting,
    ),
  };
}

function calculateRemainingSeconds(
  durationMinutes: number,
  completedTurns: InterviewTurn[],
): number {
  return Math.max(
    durationMinutes * 60 -
      completedTurns.reduce(
        (total, turn) =>
          total +
          (turn.questionId
            ? (getInterviewQuestion(turn.questionId)?.expectedSeconds ?? 120)
            : 120),
        0,
      ),
    1,
  );
}

function rankedJobSkills(
  jobWeights: Record<SkillKey, number>,
): SkillKey[] {
  return (Object.keys(SKILL_LABELS) as SkillKey[]).sort(
    (left, right) =>
      jobWeights[right] - jobWeights[left] ||
      left.localeCompare(right),
  );
}

function questionJdRelevance(
  question: BankQuestion,
  jobDescription: string,
): number {
  const normalized = jobDescription.toLowerCase();
  const tagHits = question.jobTags.filter((tag) =>
    normalized.includes(tag.toLowerCase()),
  ).length;
  return Math.min(1, 0.35 + tagHits * 0.2);
}

function difficultyMatch(
  difficulty: number,
  preferredDifficulty: number,
): number {
  return Math.max(
    0,
    1 - Math.abs(difficulty - preferredDifficulty) / 4,
  );
}

const SCENARIO_TERMS: Record<string, string[]> = {
  ecommerce: ["电商", "订单", "商品", "销售", "支付"],
  experiment: ["实验", "a/b", "ab测试", "因果", "随机"],
  modeling: ["模型", "机器学习", "预测", "分类", "回归"],
  "data-engineering": [
    "数据工程",
    "etl",
    "数仓",
    "任务",
    "管道",
  ],
  growth: ["增长", "漏斗", "留存", "转化", "运营"],
};

function inferCandidateRouting(
  candidateBackground: string,
): CandidateRouting {
  const normalized = candidateBackground.toLowerCase();
  const beginnerTerms = [
    "零基础",
    "初学",
    "入门",
    "转行",
    "尚未",
    "没有项目",
  ];
  const advancedTerms = [
    "博士",
    "高级",
    "资深",
    "精通",
    "三年",
    "四年",
    "五年",
  ];
  const experienceBand = advancedTerms.some((term) =>
    normalized.includes(term),
  )
    ? "advanced"
    : beginnerTerms.some((term) => normalized.includes(term))
      ? "beginner"
      : "intermediate";
  const preferredDifficulty =
    experienceBand === "advanced"
      ? 4
      : experienceBand === "beginner"
        ? 2
        : 3;
  const scenarioTags = Object.entries(SCENARIO_TERMS)
    .filter(([, terms]) =>
      terms.some((term) => normalized.includes(term)),
    )
    .map(([tag]) => tag);
  return {
    experienceBand,
    preferredDifficulty,
    scenarioTags,
  };
}

function countScenarioMatches(
  question: BankQuestion,
  scenarioTags: string[],
): number {
  const haystack = `${question.question} ${question.jobTags.join(" ")}`.toLowerCase();
  return scenarioTags.reduce(
    (count, tag) =>
      count +
      (SCENARIO_TERMS[tag]?.some((term) =>
        haystack.includes(term),
      )
        ? 1
        : 0),
    0,
  );
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

function parseStoredPosterior(
  value: string,
): Array<{ theta: number; probability: number }> {
  return parseArray(value).filter(
    (point): point is { theta: number; probability: number } =>
      Boolean(point) &&
      typeof point === "object" &&
      typeof (point as { theta?: unknown }).theta === "number" &&
      Number.isFinite((point as { theta: number }).theta) &&
      typeof (point as { probability?: unknown }).probability === "number" &&
      Number.isFinite(
        (point as { probability: number }).probability,
      ),
  );
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
    difficultyMatch: round(signals.difficultyMatch, 6),
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
  const rounded = Math.round(value * scale) / scale;
  return Object.is(rounded, -0) ? 0 : rounded;
}
