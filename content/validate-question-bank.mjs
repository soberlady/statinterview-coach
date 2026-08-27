import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const EXPECTED_SKILLS = [
  "statistics_ml",
  "experiment_causal",
  "sql_python",
  "business_analytics",
];

const bankPath = fileURLToPath(new URL("./question-bank.json", import.meta.url));
const raw = await readFile(bankPath, "utf8");

let bank;
try {
  bank = JSON.parse(raw);
} catch (error) {
  throw new Error(`question-bank.json 不是合法 JSON：${error.message}`);
}

const errors = [];
const questions = bank?.questions;

function check(condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

check(bank?.schemaVersion === "1.0.0", "schemaVersion 必须为 1.0.0");
check(bank?.locale === "zh-CN", "locale 必须为 zh-CN");
check(Array.isArray(questions), "questions 必须是数组");

if (Array.isArray(questions)) {
  check(questions.length === 24, `题目总数应为 24，实际为 ${questions.length}`);

  const ids = new Set();

  for (const [index, question] of questions.entries()) {
    const label = question?.id ?? `questions[${index}]`;

    check(
      typeof question?.id === "string" &&
        /^[a-z][a-z0-9_]*_\d{3}$/.test(question.id),
      `${label}: id 格式不合法`,
    );
    check(!ids.has(question?.id), `${label}: id 重复`);
    ids.add(question?.id);

    check(EXPECTED_SKILLS.includes(question?.skill), `${label}: skill 不在允许列表`);
    check(
      Number.isInteger(question?.difficulty) &&
        question.difficulty >= 1 &&
        question.difficulty <= 5,
      `${label}: difficulty 必须是 1-5 的整数`,
    );
    check(
      Array.isArray(question?.jobTags) &&
        question.jobTags.length > 0 &&
        question.jobTags.every((tag) => typeof tag === "string" && tag.length > 0),
      `${label}: jobTags 必须是非空字符串数组`,
    );
    check(
      typeof question?.question === "string" && question.question.length >= 15,
      `${label}: question 过短或缺失`,
    );
    check(
      Number.isInteger(question?.expectedSeconds) &&
        question.expectedSeconds >= 30 &&
        question.expectedSeconds <= 300,
      `${label}: expectedSeconds 必须是 30-300 的整数`,
    );
    check(typeof question?.isAnchor === "boolean", `${label}: isAnchor 必须是布尔值`);

    check(
      Array.isArray(question?.rubric) &&
        question.rubric.length >= 3 &&
        question.rubric.length <= 5,
      `${label}: rubric 必须包含 3-5 条`,
    );

    if (Array.isArray(question?.rubric)) {
      const weightSum = question.rubric.reduce(
        (sum, item) => sum + (typeof item?.weight === "number" ? item.weight : 0),
        0,
      );

      check(
        question.rubric.every(
          (item) =>
            typeof item?.criterion === "string" &&
            item.criterion.length >= 10 &&
            typeof item?.weight === "number" &&
            item.weight > 0 &&
            item.weight <= 1,
        ),
        `${label}: rubric 条目必须包含可读 criterion 和 0-1 的 weight`,
      );
      check(
        Math.abs(weightSum - 1) < 1e-9,
        `${label}: rubric 权重和必须为 1，实际为 ${weightSum}`,
      );
    }

    check(
      Array.isArray(question?.verificationQuestions) &&
        question.verificationQuestions.length >= 2 &&
        question.verificationQuestions.every(
          (item) => typeof item === "string" && item.length >= 10,
        ),
      `${label}: verificationQuestions 至少包含 2 条有效追问`,
    );
  }

  for (const skill of EXPECTED_SKILLS) {
    const skillQuestions = questions.filter((question) => question.skill === skill);
    const anchors = skillQuestions.filter((question) => question.isAnchor);
    const difficulties = new Set(skillQuestions.map((question) => question.difficulty));

    check(
      skillQuestions.length === 6,
      `${skill}: 应有 6 题，实际为 ${skillQuestions.length}`,
    );
    check(
      anchors.length === 1,
      `${skill}: 应恰好有 1 道锚点题，实际为 ${anchors.length}`,
    );
    check(
      difficulties.has(1) && difficulties.has(5) && difficulties.size >= 4,
      `${skill}: 难度必须覆盖基础到进阶（含 1、5 且至少 4 个等级）`,
    );
  }
}

if (errors.length > 0) {
  console.error(`题库校验失败，共 ${errors.length} 项：`);
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log("题库校验通过：24 道题、4 个能力维度、每类 6 题且恰好 1 道锚点题。");
}
