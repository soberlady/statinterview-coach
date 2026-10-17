import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRubricMessages,
  buildRubricRequestBody,
  buildTranscriptRepairRequestBody,
  combineRubricPasses,
  evaluateAnswerStrict,
  guardEvaluationForTranscriptConfidence,
  scorerFailureTelemetry,
  selectScorerApiKey,
  validateTranscriptRepair,
} from "../app/lib/rubric-evaluator";
import {
  evaluateAnswer,
  updateAbility,
} from "../app/lib/agent-policy";
import {
  getInterviewQuestion,
  type InterviewQuestion,
} from "../app/lib/question-bank";
import type { SkillState } from "../db/schema";

const question: InterviewQuestion = {
  id: "statistics_ml_test",
  sourceQuestionId: "statistics_ml_test",
  skill: "statistics_ml",
  difficulty: 3,
  jobTags: ["统计"],
  question: "如何判断模型是否过拟合？",
  expectedSeconds: 120,
  isAnchor: false,
  questionType: "adaptive",
  rubric: [
    {
      criterion: "比较训练集与验证集表现",
      weight: 0.6,
    },
    {
      criterion: "提出交叉验证或学习曲线",
      weight: 0.4,
    },
  ],
  verificationQuestions: ["你会怎样画学习曲线？"],
};

test("gpt-5-mini request omits unsupported sampling parameters", () => {
  const body = buildRubricRequestBody({
    model: "gpt-5-mini",
    reviewer: false,
    question: question.question,
    criteria: question.rubric.map((criterion, criterionIndex) => ({
      criterionIndex,
      description: criterion.criterion,
      weight: criterion.weight,
    })),
    candidateAnswer: "我会比较训练集和验证集。",
  });

  assert.equal(body.model, "gpt-5-mini");
  assert.ok(!("temperature" in body));
  assert.ok(!("top_p" in body));
  assert.equal(body.response_format.type, "json_object");
  assert.ok(!("thinking" in body));
});

test("deepseek scoring uses low-latency non-thinking JSON mode", () => {
  const body = buildRubricRequestBody({
    model: "deepseek-v4-flash",
    reviewer: true,
    question: question.question,
    criteria: question.rubric.map((criterion, criterionIndex) => ({
      criterionIndex,
      description: criterion.criterion,
      weight: criterion.weight,
    })),
    candidateAnswer: "我会比较训练集和验证集。",
  });

  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.equal(body.response_format.type, "json_object");
  assert.ok(!("temperature" in body));
});

test("provider-specific scorer keys cannot cross providers", () => {
  const runtime = {
    STATINTERVIEW_SCORER_API_KEY: "openai-secret",
    STATINTERVIEW_DEEPSEEK_API_KEY: "deepseek-secret",
  };

  assert.equal(selectScorerApiKey("gpt-5-mini", runtime), "openai-secret");
  assert.equal(
    selectScorerApiKey("deepseek-v4-flash", runtime),
    "deepseek-secret",
  );
  assert.equal(
    selectScorerApiKey("deepseek-v4-flash", {
      STATINTERVIEW_SCORER_API_KEY: "openai-secret",
    }),
    undefined,
  );
});

test("scorer failure telemetry excludes messages and request content", () => {
  const telemetry = scorerFailureTelemetry(
    new TypeError("secret prompt and credential must not be logged"),
  );

  assert.deepEqual(telemetry, {
    category: "network",
    status: null,
    errorType: "TypeError",
    errorCode: null,
    requestId: null,
  });
  assert.doesNotMatch(JSON.stringify(telemetry), /secret|credential/);
});

test("transcript hint helps interpretation but cannot become evidence", () => {
  const messages = buildRubricMessages({
    reviewer: false,
    question: "留存率如何解释？",
    criteria: [{ criterionIndex: 0, description: "解释比例", weight: 1 }],
    candidateAnswer: "留存率是30",
    transcriptScoringHint: "留存率是30%",
  });
  const system = messages[0].content;
  const user = JSON.parse(messages[1].content);

  assert.match(system, /不能引用转写理解辅助/);
  assert.match(system, /冲突时，以回答原文为准/);
  assert.match(system, /不得用于补全原文中缺失的否定词/);
  assert.equal(user.candidateAnswer, "留存率是30");
  assert.equal(user.transcriptScoringHint, "留存率是30%");
});

test("transcript repair is constrained to ASR correction", () => {
  const body = buildTranscriptRepairRequestBody({
    model: "deepseek-v4-flash",
    question: "正样本只占0.5%，如何选择评价指标？",
    rubric: ["解释精确率、召回率和PR-AUC"],
    rawTranscript: "中央本只占0.5，使用PRR",
    deterministicHint: "正样本只占0.5%，使用PRR",
  });
  const system = body.messages[0].content;
  const user = JSON.parse(body.messages[1].content);

  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.match(system, /不得补充新知识/);
  assert.match(system, /保持原句顺序/);
  assert.equal(user.rawTranscript, "中央本只占0.5，使用PRR");
});

test("transcript repair preserves numeric and negative evidence", () => {
  assert.equal(
    validateTranscriptRepair(
      "正样本只占0.5%，不建议直接上线，使用PRR",
      "正样本只占0.5%，不建议直接上线，使用PR-AUC",
    ),
    "正样本只占0.5%，不建议直接上线，使用PR-AUC",
  );
  assert.throws(
    () => validateTranscriptRepair("提升5%，不建议上线", "提升15%，不建议上线"),
    /numeric evidence/,
  );
  assert.throws(
    () => validateTranscriptRepair("不建议上线", "建议上线"),
    /negation evidence/,
  );
});

test("low voice transcript confidence forces verification", () => {
  const evaluation = evaluateAnswer(
    question,
    "我会比较训练集与验证集表现，并使用交叉验证和学习曲线判断。",
  );
  const guarded = guardEvaluationForTranscriptConfidence(evaluation, 0.61);

  assert.equal(guarded.reliability, "LOW");
  assert.equal(guarded.action, "VERIFY");
  assert.match(guarded.disclaimer, /不会直接写入能力后验/);
});

test("double-pass rubric keeps only verbatim evidence", () => {
  const answer =
    "我会比较训练集与验证集表现，再使用交叉验证观察稳定性，并检查学习曲线，最后用独立测试集确认结论。";
  const evaluation = combineRubricPasses({
    question,
    answer,
    primary: {
      criteria: [
        {
          criterionIndex: 0,
          score: 4,
          evidence: ["比较训练集与验证集表现"],
          note: "完整",
        },
        {
          criterionIndex: 1,
          score: 4,
          evidence: ["使用交叉验证观察稳定性"],
          note: "完整",
        },
      ],
    },
    review: {
      criteria: [
        {
          criterionIndex: 0,
          score: 3.5,
          evidence: ["比较训练集与验证集表现", "回答里不存在的句子"],
          note: "基本充分",
        },
        {
          criterionIndex: 1,
          score: 3.5,
          evidence: ["检查学习曲线"],
          note: "基本充分",
        },
      ],
    },
    model: "fixture-model",
    latencyMs: 120,
    inputTokens: 200,
    outputTokens: 80,
    promptVersion: "rubric-double-pass-v1",
    questionFingerprint: "question-fixture",
    requestFingerprint: "request-fixture",
  });

  assert.equal(evaluation.evaluator, "RUBRIC_DOUBLE_PASS");
  assert.equal(evaluation.scoreOutOfFour, 3.75);
  assert.equal(evaluation.reliability, "MEDIUM");
  assert.ok(
    !evaluation.evidence.includes("回答里不存在的句子"),
  );
  assert.equal(evaluation.signals.evidenceCoverage, 1);
  assert.equal(evaluation.telemetry?.inputTokens, 200);
  assert.equal(
    evaluation.semantic?.promptVersion,
    "rubric-double-pass-v1",
  );
  assert.equal(evaluation.semantic?.passes?.primary.length, 2);
  assert.equal(evaluation.semantic?.passes?.review.length, 2);
});

test("large reviewer disagreement blocks ability updates", () => {
  const answer =
    "我会比较训练集与验证集表现，再使用交叉验证观察稳定性，并检查学习曲线。";
  const evaluation = combineRubricPasses({
    question,
    answer,
    primary: {
      criteria: [
        {
          criterionIndex: 0,
          score: 4,
          evidence: ["比较训练集与验证集表现"],
          note: "充分",
        },
        {
          criterionIndex: 1,
          score: 4,
          evidence: ["使用交叉验证观察稳定性"],
          note: "充分",
        },
      ],
    },
    review: {
      criteria: [
        {
          criterionIndex: 0,
          score: 0,
          evidence: [],
          note: "无证据",
        },
        {
          criterionIndex: 1,
          score: 0,
          evidence: [],
          note: "无证据",
        },
      ],
    },
    model: "fixture-model",
    latencyMs: 120,
    inputTokens: null,
    outputTokens: null,
  });

  assert.equal(evaluation.reliability, "LOW");
  assert.equal(evaluation.action, "VERIFY");
  assert.equal(evaluation.signals.reviewDisagreement, 4);
});

test("verification questions use a bounded one-criterion rubric", () => {
  const source = getInterviewQuestion("statistics_ml_002");
  const verification = getInterviewQuestion(
    "statistics_ml_002__verify_0",
  );

  assert.ok(source);
  assert.ok(verification);
  assert.equal(verification.questionType, "verification");
  assert.equal(verification.sourceQuestionId, source.id);
  assert.equal(verification.rubric.length, 1);
  assert.equal(verification.rubric[0].weight, 1);
  assert.match(
    verification.rubric[0].criterion,
    new RegExp(verification.question.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.ok(verification.expectedSeconds <= 90);
});

test("structure-only fallback never changes the ability posterior", () => {
  const evaluation = evaluateAnswer(
    question,
    "首先比较训练集和验证集，再用交叉验证、学习曲线和独立测试集检查过拟合，最后根据偏差与方差定位问题并验证结论。",
  );
  const previous: SkillState = {
    id: "skill_test",
    interviewId: "interview_test",
    skill: question.skill,
    posteriorMean: 0,
    uncertainty: 1,
    posterior: "[]",
    supportingEvidence: "[]",
    commonErrors: "[]",
    sourceTurnCount: 0,
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
  };
  const updated = updateAbility(
    previous,
    question,
    evaluation,
    "turn_test",
  );

  assert.equal(evaluation.evaluator, "STRUCTURE_HEURISTIC");
  assert.equal(evaluation.reliability, "LOW");
  assert.equal(evaluation.action, "ABSTAIN");
  assert.equal(updated.posteriorMean, previous.posteriorMean);
  assert.equal(updated.uncertainty, previous.uncertainty);
  assert.equal(updated.sourceTurnCount, 0);
});

function initialSkillState(): SkillState {
  return {
    id: "skill_regression", interviewId: "interview_regression", skill: question.skill,
    posteriorMean: 0, uncertainty: 1, posterior: "[]", supportingEvidence: "[]",
    commonErrors: "[]", sourceTurnCount: 0, createdAt: "fixture", updatedAt: "fixture",
  };
}

for (const missingQuote of [[], ["这句话并不存在于原始回答"]]) {
  test(`unsupported rubric scores cannot update ability: ${missingQuote.length ? "fabricated" : "missing"} quotes`, () => {
    const answer = "我会比较训练集与验证集表现。";
    const pass = { criteria: [
      { criterionIndex: 0, score: 4, evidence: ["比较训练集与验证集表现"], note: "有证据" },
      { criterionIndex: 1, score: 4, evidence: missingQuote, note: "模型声称充分" },
    ] };
    const evaluation = combineRubricPasses({ question, answer, primary: structuredClone(pass),
      review: structuredClone(pass), model: "fixture", latencyMs: 1, inputTokens: 1, outputTokens: 1 });
    assert.equal(evaluation.action, "VERIFY");
    assert.equal(evaluation.reliability, "LOW");
    assert.ok(evaluation.totalScore < 1);
    assert.ok(!evaluation.strengths.some(text => text.includes(question.rubric[1].criterion)));
    assert.ok(evaluation.gaps.some(text => /证据不足|缺少.*证据/.test(text)));
    const previous = initialSkillState();
    const updated = updateAbility(previous, question, evaluation, "turn_regression");
    assert.equal(updated.posteriorMean, previous.posteriorMean);
    assert.equal(updated.uncertainty, previous.uncertainty);
    assert.equal(updated.sourceTurnCount, 0);
    assert.deepEqual(updated.posterior, []);
    assert.deepEqual(updated.supportingEvidence, []);
  });
}

test("a reviewer's quote cannot validate an unsupported positive primary score", () => {
  const answer = "我会比较训练集与验证集表现，并提出交叉验证。";
  const primary = { criteria: question.rubric.map((_, criterionIndex) => ({
    criterionIndex, score: 4, evidence: criterionIndex ? [] : [answer], note: "初评",
  })) };
  const review = { criteria: question.rubric.map((_, criterionIndex) => ({
    criterionIndex, score: 4, evidence: [answer], note: "复核",
  })) };
  const result = combineRubricPasses({ question, answer, primary, review,
    model: "fixture", latencyMs: 1, inputTokens: 1, outputTokens: 1 });
  assert.equal(result.action, "VERIFY");
  assert.ok(result.totalScore < 1);
  assert.ok(!result.strengths.some(text => text.includes(question.rubric[1].criterion)));
});

test("missing zero-score evidence is unknown, while quoted incorrect answers remain reliable low scores", () => {
  const answer = "训练集表现好就一定不会过拟合，不需要验证集，也不需要交叉验证。";
  const makeResult = (quoted: boolean) => {
    const pass = { criteria: question.rubric.map((_, criterionIndex) => ({
      criterionIndex, score: 0, evidence: quoted ? [answer] : [], note: "判断错误",
    })) };
    return combineRubricPasses({ question, answer, primary: structuredClone(pass),
      review: structuredClone(pass), model: "fixture", latencyMs: 1, inputTokens: 1, outputTokens: 1 });
  };
  const missing = makeResult(false);
  assert.equal(missing.action, "VERIFY");
  assert.ok(missing.gaps.every(text => /证据不足|缺少.*证据/.test(text)));
  assert.equal(updateAbility(initialSkillState(), question, missing, "missing").sourceTurnCount, 0);
  const incorrect = makeResult(true);
  assert.equal(incorrect.action, "ACCEPT");
  assert.equal(incorrect.reliability, "HIGH");
  assert.equal(incorrect.totalScore, 0);
  const updated = updateAbility(initialSkillState(), question, incorrect, "incorrect");
  assert.equal(updated.sourceTurnCount, 1);
  assert.ok(updated.posteriorMean < 0);
});

// Exercise the complete repair -> two-pass scorer path without real credentials
// or network access. The provider may echo a client hint or return invalid JSON.
async function runRepairFixture(options: {
  raw: string; hint?: string; repaired?: string; enable?: boolean;
  failure?: "http" | "timeout" | "network" | "malformed";
}) {
  const names = ["STATINTERVIEW_SCORER_ENDPOINT", "STATINTERVIEW_SCORER_API_KEY", "STATINTERVIEW_SCORER_MODEL"];
  const previous = names.map(name => process.env[name]);
  const previousFetch = globalThis.fetch;
  const repairRequests: Array<Record<string, unknown>> = [];
  const scoringHints: unknown[] = [];
  process.env.STATINTERVIEW_SCORER_ENDPOINT = "http://fixture.invalid/scorer";
  process.env.STATINTERVIEW_SCORER_API_KEY = "fixture-only";
  process.env.STATINTERVIEW_SCORER_MODEL = "fixture-model";
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const user = JSON.parse(body.messages[1].content);
    if ("rawTranscript" in user) {
      repairRequests.push(user);
      if (options.failure === "http") return Response.json({}, { status: 503 });
      if (options.failure === "timeout") throw new DOMException("fixture", "TimeoutError");
      if (options.failure === "network") throw new TypeError("fixture network failure");
      return Response.json({ choices: [{ message: { content: options.failure === "malformed"
        ? "not JSON" : JSON.stringify({ repairedTranscript: options.repaired ?? user.conservativeLocalHint }) } }] });
    }
    scoringHints.push(user.transcriptScoringHint);
    return Response.json({ choices: [{ message: { content: JSON.stringify({
      criteria: question.rubric.map((_, criterionIndex) => ({
        criterionIndex, score: 0, evidence: [options.raw], note: "本地模拟评分",
      })),
    }) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
  };
  try {
    const evaluation = await evaluateAnswerStrict(question, options.raw, {
      transcriptScoringHint: options.hint, enableTranscriptRepair: options.enable ?? true,
    });
    return { evaluation, repairRequests, scoringHints };
  } finally {
    globalThis.fetch = previousFetch;
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  }
}

for (const hint of [
  "p值是0.01，不应该拒绝原假设，因为证据不足。",
  "p值是0.5，应该拒绝原假设，因为证据充分。",
  "p值是0.5，不应该拒绝原假设，所以证据不足。",
]) {
  test(`client repair hint cannot replace the raw factual baseline: ${hint}`, async () => {
    const raw = "p值是0.5，不应该拒绝原假设，因为证据不足。";
    const { evaluation, repairRequests, scoringHints } = await runRepairFixture({ raw, hint });
    assert.equal(evaluation.semantic?.transcriptRepair?.applied, false);
    assert.ok(repairRequests.every(request => request.conservativeLocalHint === raw));
    assert.deepEqual(scoringHints, [raw, raw]);
  });
}

for (const failure of ["http", "timeout", "network", "malformed"] as const) {
  test(`repair ${failure} safely falls back to raw, never a forged client hint`, async () => {
    const raw = "p值是0.5，不应该拒绝原假设，因为证据不足。";
    const hint = "p值是0.01，应该拒绝原假设，因为证据充分。";
    const { evaluation, scoringHints } = await runRepairFixture({ raw, hint, failure });
    assert.equal(evaluation.semantic?.transcriptRepair?.applied, false);
    assert.deepEqual(scoringHints, [raw, raw]);
  });
}

test("client hint is not used when model repair is disabled", async () => {
  const raw = "不建议直接上线，应该继续检查随机分流。";
  const { evaluation, repairRequests, scoringHints } = await runRepairFixture({
    raw, hint: "建议直接上线，不应该继续检查随机分流。", enable: false,
  });
  assert.equal(repairRequests.length, 0);
  assert.equal(evaluation.semantic?.transcriptRepair?.applied, false);
  assert.deepEqual(scoringHints, [raw, raw]);
});

for (const [raw, repaired] of [
  ["提升5%，不建议直接上线，需要检查实验。", "提升15%，不建议直接上线，需要检查实验。"],
  ["不建议直接上线，建议继续检查随机分流。", "建议直接上线，不建议继续检查随机分流。"],
  ["只发现指标相关，因此不能说明因果关系。", "只发现指标相关，因此可以说明因果关系。"],
  ["因为随机分流失败，所以不能解释为因果。", "因为随机分流成功，所以不能解释为因果。"],
  ["提升5%，因此需要继续核查实验条件。", "提升5，因此需要继续核查实验条件。"],
]) {
  test(`model semantic changes fail closed against raw: ${repaired}`, async () => {
    const { evaluation, scoringHints } = await runRepairFixture({ raw, repaired });
    assert.equal(evaluation.semantic?.transcriptRepair?.applied, false);
    assert.deepEqual(scoringHints, [raw, raw]);
  });
}

test("allowlisted technical formatting repair preserves original quotes", async () => {
  const raw = "正样本只占0.5%，不建议直接上线，使用PRR检查模型。";
  const repaired = "正样本只占0.5%，不建议直接上线，使用PR-AUC检查模型。";
  const { evaluation, scoringHints } = await runRepairFixture({ raw, repaired });
  assert.equal(evaluation.semantic?.transcriptRepair?.repairedText, repaired);
  assert.deepEqual(scoringHints, [repaired, repaired]);
  assert.deepEqual(evaluation.evidence, [raw]);
});

test("explicit spoken percentages may be formatted without inferring a missing unit", async () => {
  const raw = "正样本只占百分之零点五，不建议直接上线，先核查样本和模型。";
  const repaired = "正样本只占0.5%，不建议直接上线，先核查样本和模型。";
  const { evaluation, scoringHints } = await runRepairFixture({ raw, repaired });
  assert.equal(evaluation.semantic?.transcriptRepair?.repairedText, repaired);
  assert.deepEqual(scoringHints, [repaired, repaired]);
  assert.deepEqual(evaluation.evidence, [raw]);
});

test("repair cannot change Chinese numeric evidence or infer a percentage from a bare number", () => {
  assert.throws(() => validateTranscriptRepair("样本有五个，继续检查。", "样本有十个，继续检查。"));
  assert.throws(() => validateTranscriptRepair("正样本只占0.5，需要核查。", "正样本只占0.5%，需要核查。"));
  assert.throws(() => validateTranscriptRepair("The signal is now here.", "The signal is nowhere."));
});
