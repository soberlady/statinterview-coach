import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import authoringBank from "../content/question-bank.json";
import { getInterviewQuestion, listQuestions, LEGACY_QUESTION_BANK_VERSION, COACHING_QUESTION_BANK_VERSION } from "../app/lib/question-bank";
import { interviewQuestionBankVersion, readPolicyConfig } from "../app/lib/practice-plan";
import { syntheticSession } from "../experiments/run_coaching_benchmark";

test("pre-versioned sessions resolve to their original question bank", () => {
  assert.equal(interviewQuestionBankVersion({ policyConfig: "{}" }), LEGACY_QUESTION_BANK_VERSION);
  assert.equal(interviewQuestionBankVersion({ policyConfig: '{"version":"coaching-v3"}' }), COACHING_QUESTION_BANK_VERSION);
  assert.equal(listQuestions(LEGACY_QUESTION_BANK_VERSION).length, 24);
  assert.equal(getInterviewQuestion("sql_python_008", LEGACY_QUESTION_BANK_VERSION), undefined);
  assert.ok(getInterviewQuestion("statistics_ml_002__verify_0", LEGACY_QUESTION_BANK_VERSION));
  assert.throws(() => readPolicyConfig('{"version":"coaching-v3","questionBankVersion":"unknown"}'));
});

test("authoring changes cannot alter persisted v2 or v3 policy replay", () => {
  const profile = { jobDescription: "统计 实验 SQL 业务", candidateBackground: "有课程经验", durationMinutes: 20, verificationCount: 0 };
  for (const policyConfig of ["{}", '{"version":"coaching-v3"}', JSON.stringify({ version: "coaching-v3", questionBankVersion: COACHING_QUESTION_BANK_VERSION })]) {
    const baseline = syntheticSession({ ...profile, policyConfig }, 0.5);
    const question = authoringBank.questions[0];
    const original = structuredClone(question);
    try {
      question.difficulty = 5;
      question.expectedSeconds = 1;
      question.question = "Unreleased authoring edit";
      question.rubric = [{ criterion: "Unreleased rubric", weight: 1 }];
      assert.deepEqual(syntheticSession({ ...profile, policyConfig }, 0.5), baseline);
    } finally { Object.assign(question, original); }
  }
});

test("published bank snapshots are immutable and authoring matches the current release", async () => {
  assert.deepEqual(listQuestions(), authoringBank.questions);
  for (const [file, hash] of [
    ["question-bank.v1.json", "fccd53c1100f5c4b1543680c483a1a60af9d1e3e61c1d4277ac2ab99c512d3ec"],
    ["question-bank.coaching-v1.json", "5e0705e4c995c73c804c836bff2400e050bc7f025e6cf76260f638e5df0c3020"],
  ]) {
    const bytes = await readFile(new URL(`../content/legacy/${file}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), hash, "Publish a new version; do not edit a historical snapshot");
  }
});
