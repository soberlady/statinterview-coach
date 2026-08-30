import rawQuestionBank from "@/content/question-bank.json";

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
};

export type InterviewQuestion = BankQuestion & {
  questionType: QuestionType;
  sourceQuestionId: string;
};

const questions = rawQuestionBank.questions as BankQuestion[];

export function listQuestions(): readonly BankQuestion[] {
  return questions;
}

export function listAnchorQuestions(): InterviewQuestion[] {
  return questions
    .filter((question) => question.isAnchor)
    .map((question) => toInterviewQuestion(question, "anchor"));
}

export function getInterviewQuestion(
  questionId: string,
): InterviewQuestion | undefined {
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
