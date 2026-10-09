import legacyQuestionBank from "@/content/legacy/question-bank.v1.json";
import coachingQuestionBank from "@/content/legacy/question-bank.coaching-v1.json";

export const LEGACY_QUESTION_BANK_VERSION = "question-bank-v1";
export const COACHING_QUESTION_BANK_VERSION = "coaching-bank-v1";
export const CURRENT_QUESTION_BANK_VERSION = COACHING_QUESTION_BANK_VERSION;
export type QuestionBankVersion = typeof LEGACY_QUESTION_BANK_VERSION | typeof COACHING_QUESTION_BANK_VERSION;

export const SKILL_LABELS = {
  statistics_ml: "统计与机器学习",
  experiment_causal: "实验与因果",
  sql_python: "SQL 与 Python",
  business_analytics: "业务分析",
} as const;

export type SkillKey = keyof typeof SKILL_LABELS;
export type QuestionType = "anchor" | "adaptive" | "verification";

export type RubricCriterion = {
  criterion: string;
  weight: number;
};

export type BankQuestion = {
  id: string;
  skill: SkillKey;
  difficulty: number;
  jobTags: string[];
  question: string;
  expectedSeconds: number;
  isAnchor: boolean;
  rubric: RubricCriterion[];
  verificationQuestions: string[];
  topic?: string;
  family?: string;
  learningPoints?: string[];
  verificationRubrics?: Array<{
    criterionIndexes: number[];
    difficulty: number;
    rubric: RubricCriterion[];
  }>;
};

export type InterviewQuestion = BankQuestion & {
  questionType: QuestionType;
  sourceQuestionId: string;
};

const banks: Record<QuestionBankVersion, BankQuestion[]> = {
  [LEGACY_QUESTION_BANK_VERSION]: legacyQuestionBank.questions as BankQuestion[],
  [COACHING_QUESTION_BANK_VERSION]: coachingQuestionBank.questions as BankQuestion[],
};

export function listQuestions(version: QuestionBankVersion = CURRENT_QUESTION_BANK_VERSION): readonly BankQuestion[] {
  const questions = banks[version];
  if (!questions) throw new Error("Unsupported question bank version");
  return questions;
}

export function listLegacyQuestions(): readonly BankQuestion[] {
  return listQuestions(LEGACY_QUESTION_BANK_VERSION);
}

export function getLegacyInterviewQuestion(questionId: string) {
  return getInterviewQuestion(questionId, LEGACY_QUESTION_BANK_VERSION);
}

export function listAnchorQuestions(version: QuestionBankVersion = CURRENT_QUESTION_BANK_VERSION): InterviewQuestion[] {
  return listQuestions(version)
    .filter((question) => question.isAnchor)
    .map((question) => toInterviewQuestion(question, "anchor"));
}

export function getInterviewQuestion(
  questionId: string,
  version: QuestionBankVersion = CURRENT_QUESTION_BANK_VERSION,
): InterviewQuestion | undefined {
  const questions = listQuestions(version);
  const targetedVerification = questionId.match(/^(.+)__verify_v3_(\d+)$/);
  if (targetedVerification) {
    const source = questions.find((question) => question.id === targetedVerification[1]);
    const index = Number(targetedVerification[2]);
    const specification = source?.verificationRubrics?.[index];
    const question = source?.verificationQuestions[index];
    if (!source || !specification || !question) return undefined;
    return {
      ...source, id: questionId, question, difficulty: specification.difficulty,
      expectedSeconds: Math.min(source.expectedSeconds, 90), isAnchor: false,
      questionType: "verification", sourceQuestionId: source.id,
      rubric: specification.rubric,
    };
  }
  const roleAnchorMatch = questionId.match(/^(.+)__role_anchor$/);
  if (roleAnchorMatch) {
    const source = questions.find(
      (question) => question.id === roleAnchorMatch[1],
    );
    return source ? toRoleAnchorQuestion(source) : undefined;
  }

  const verificationMatch = questionId.match(
    /^(?<source>.+)__verify_(?<index>\d+)$/,
  );
  if (verificationMatch?.groups) {
    const source = questions.find(
      (question) => question.id === verificationMatch.groups?.source,
    );
    const index = Number(verificationMatch.groups.index);
    const verificationText = source?.verificationQuestions[index];
    if (!source || verificationText === undefined) return undefined;
    return {
      ...source,
      id: questionId,
      question: verificationText,
      expectedSeconds: Math.min(source.expectedSeconds, 90),
      isAnchor: false,
      questionType: "verification",
      sourceQuestionId: source.id,
      rubric: [
        {
          criterion: `直接回答限定追问，并给出可以核验的判断依据：${verificationText}`,
          weight: 1,
        },
      ],
    };
  }

  const source = questions.find((question) => question.id === questionId);
  if (!source) return undefined;
  return toInterviewQuestion(
    source,
    source.isAnchor ? "anchor" : "adaptive",
  );
}

export function toRoleAnchorQuestion(
  question: BankQuestion,
): InterviewQuestion {
  return {
    ...question,
    id: `${question.id}__role_anchor`,
    isAnchor: true,
    questionType: "anchor",
    sourceQuestionId: question.id,
  };
}

export function toPublicQuestion(question: InterviewQuestion) {
  return {
    id: question.id,
    sourceQuestionId: question.sourceQuestionId,
    skill: question.skill,
    skillLabel: SKILL_LABELS[question.skill],
    text: question.question,
    difficulty: question.difficulty,
    expectedSeconds: question.expectedSeconds,
    questionType: question.questionType,
  };
}

function toInterviewQuestion(
  question: BankQuestion,
  questionType: QuestionType,
): InterviewQuestion {
  return {
    ...question,
    questionType,
    sourceQuestionId: question.id,
  };
}
