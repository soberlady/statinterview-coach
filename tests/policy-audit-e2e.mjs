import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const execFileAsync = promisify(execFile);
const concurrentAnswerMarker = "STATINTERVIEW_CONCURRENCY_GUARD";
let blockedScorerRequests = 0;
let releaseBlockedScorer;
let resolveBlockedScorerReady;
const blockedScorerReady = new Promise((resolve) => {
  resolveBlockedScorerReady = resolve;
});
const blockedScorerRelease = new Promise((resolve) => {
  releaseBlockedScorer = resolve;
});
const scorerServer = createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const userMessage = payload.messages?.find(
      (message) => message.role === "user",
    );
    const rubricRequest = JSON.parse(userMessage?.content ?? "{}");
    const answer = rubricRequest.candidateAnswer ?? "";
    if (answer.includes(concurrentAnswerMarker)) {
      blockedScorerRequests += 1;
      if (blockedScorerRequests === 2) resolveBlockedScorerReady();
      await blockedScorerRelease;
    }
    const evidence = answer.split(/[。！？!?\n]/).find(Boolean) ?? answer;
    const criteria = (rubricRequest.criteria ?? []).map((criterion) => ({
      criterionIndex: criterion.criterionIndex,
      score: 3.5,
      evidence: evidence ? [evidence] : [],
      note: "deterministic end-to-end scorer",
    }));
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({ criteria }),
            },
          },
        ],
        usage: {
          prompt_tokens: 120,
          completion_tokens: 40,
        },
      }),
    );
  } catch (error) {
    response.writeHead(500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: String(error) }));
  }
});
scorerServer.listen(0, "127.0.0.1");
await once(scorerServer, "listening");
const scorerAddress = scorerServer.address();
assert.ok(scorerAddress && typeof scorerAddress !== "string");

const port =
  Number(process.env.STATINTERVIEW_E2E_PORT) ||
  32_000 + Math.floor(Math.random() * 1_000);
const baseUrl = `http://localhost:${port}`;
const serverOutput = [];
const server = spawn(
  process.execPath,
  ["node_modules/vinext/dist/cli.js", "dev", "--port", String(port)],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      NO_PROXY: "127.0.0.1,localhost",
      no_proxy: "127.0.0.1,localhost",
      WRANGLER_LOG_PATH: ".wrangler/wrangler.log",
      STATINTERVIEW_SCORER_ENDPOINT:
        `http://127.0.0.1:${scorerAddress.port}/v1/chat/completions`,
      STATINTERVIEW_SCORER_API_KEY: "e2e-only",
      STATINTERVIEW_SCORER_MODEL: "deterministic-e2e-scorer",
      STATINTERVIEW_SCORER_STRICT: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

server.stdout.on("data", (chunk) => rememberOutput(chunk));
server.stderr.on("data", (chunk) => rememberOutput(chunk));

const richAnswer =
  "首先我会确认业务指标、统计口径、样本和基线，再检查随机分流、A/A、显著性、置信区间、样本量和护栏指标。其次使用 SQL 窗口函数、分区、索引、主键和执行计划完成数据处理，并用 Python 分批校验、去重和抽样。然后按渠道、地区、版本和用户分群拆解漏斗，提出可以证伪的假设，对比测试集、交叉验证、准确率、召回率、F1、AUC、偏差和方差。最后检查数据质量、季节性与异常值；如果结果不稳定，就回到假设和数据口径，排除混杂并重新验证。";

try {
  await waitForServer();
  const interviewPayload = {
    jobTitle: "数据分析实习生",
    jobDescription:
      "负责 SQL、Python、A/B 实验、业务指标分析与统计建模。",
    durationMinutes: 15,
    mode: "diagnostic",
    cameraEnabled: false,
    recordingEnabled: false,
  };
  const atomicFixture = await requestJson("/api/interviews", {
    method: "POST",
    body: JSON.stringify(interviewPayload),
  });
  const atomicInterviewId = atomicFixture.interview?.id;
  assert.equal(typeof atomicInterviewId, "string");
  const atomicSelection = await requestJson(
    `/api/interviews/${atomicInterviewId}/next-question`,
  );
  await seedInternalEventConflict(atomicInterviewId, 1);
  const failedAtomicTurn = await fetch(
    `${baseUrl}/api/interviews/${atomicInterviewId}/turns`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sequenceNumber: 1,
        questionId: atomicSelection.nextQuestion.id,
        answerText: richAnswer,
        inputMode: "text",
      }),
    },
  );
  assert.equal(failedAtomicTurn.status, 409);
  const rolledBackInterview = await requestJson(
    `/api/interviews/${atomicInterviewId}`,
  );
  assert.equal(rolledBackInterview.turns.length, 0);
  assert.equal(rolledBackInterview.interview.turnCount, 0);
  assert.ok(
    rolledBackInterview.skillStates.every(
      (state) => state.sourceTurnCount === 0,
    ),
  );
  const rejectedInternalEventKey = await fetch(
    `${baseUrl}/api/interviews/${atomicInterviewId}/events`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType: "test.conflict",
        idempotencyKey: `internal:turn:${atomicInterviewId}:2`,
        payload: {},
      }),
    },
  );
  assert.equal(rejectedInternalEventKey.status, 400);
  const rejectedAuthorityWrite = await fetch(
    `${baseUrl}/api/interviews/${atomicInterviewId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "COMPLETED",
        currentStage: "COMPLETED",
        skillStates: [
          {
            skill: "statistics_ml",
            posteriorMean: 3,
            uncertainty: 0,
          },
        ],
      }),
    },
  );
  assert.equal(rejectedAuthorityWrite.status, 400);

  const lifecycleFixture = await requestJson("/api/interviews", {
    method: "POST",
    body: JSON.stringify(interviewPayload),
  });
  const lifecycleInterviewId = lifecycleFixture.interview?.id;
  assert.equal(typeof lifecycleInterviewId, "string");
  const lifecycleSelection = await requestJson(
    `/api/interviews/${lifecycleInterviewId}/next-question`,
  );
  await requestJson(`/api/interviews/${lifecycleInterviewId}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "PAUSED",
      currentStage: "PAUSED",
    }),
  });
  const rejectedPausedTurn = await fetch(
    `${baseUrl}/api/interviews/${lifecycleInterviewId}/turns`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sequenceNumber: 1,
        questionId: lifecycleSelection.nextQuestion.id,
        answerText: richAnswer,
        inputMode: "text",
      }),
    },
  );
  assert.equal(rejectedPausedTurn.status, 409);
  const resumedLifecycle = await requestJson(
    `/api/interviews/${lifecycleInterviewId}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        status: "RECOVERING",
        currentStage: "RECOVERING",
      }),
    },
  );
  assert.equal(resumedLifecycle.interview.status, "RECOVERING");
  const rejectedPrematureCompletion = await fetch(
    `${baseUrl}/api/interviews/${lifecycleInterviewId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "COMPLETED",
        currentStage: "COMPLETED",
      }),
    },
  );
  assert.equal(rejectedPrematureCompletion.status, 409);
  const prematureCompletionBody = await rejectedPrematureCompletion.json();
  assert.equal(
    prematureCompletionBody.error?.code,
    "INTERVIEW_POLICY_INCOMPLETE",
  );
  const resumedTurn = await requestJson(
    `/api/interviews/${lifecycleInterviewId}/turns`,
    {
      method: "POST",
      body: JSON.stringify({
        sequenceNumber: 1,
        questionId: lifecycleSelection.nextQuestion.id,
        answerText: richAnswer,
        inputMode: "text",
      }),
    },
  );
  assert.notEqual(resumedTurn.interview.status, "RECOVERING");
  const restoredLifecycle = await requestJson(
    `/api/interviews/${lifecycleInterviewId}`,
  );
  assert.equal(restoredLifecycle.turns.length, 1);

  const concurrencyFixture = await requestJson("/api/interviews", {
    method: "POST",
    body: JSON.stringify(interviewPayload),
  });
  const concurrencyInterviewId = concurrencyFixture.interview?.id;
  assert.equal(typeof concurrencyInterviewId, "string");
  const concurrencySelection = await requestJson(
    `/api/interviews/${concurrencyInterviewId}/next-question`,
  );
  const pendingConcurrentTurn = fetch(
    `${baseUrl}/api/interviews/${concurrencyInterviewId}/turns`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sequenceNumber: 1,
        questionId: concurrencySelection.nextQuestion.id,
        answerText: `${richAnswer} ${concurrentAnswerMarker}`,
        inputMode: "text",
      }),
    },
  );
  await Promise.race([
    blockedScorerReady,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("semantic scorer did not enter blocked state")),
        5_000,
      ),
    ),
  ]);
  await requestJson(`/api/interviews/${concurrencyInterviewId}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "CANCELLED",
      currentStage: "CANCELLED",
    }),
  });
  releaseBlockedScorer();
  const rejectedConcurrentTurn = await pendingConcurrentTurn;
  assert.equal(rejectedConcurrentTurn.status, 409);
  const rejectedConcurrentBody = await rejectedConcurrentTurn.json();
  assert.equal(
    rejectedConcurrentBody.error?.code,
    "INTERVIEW_STATE_CONFLICT",
  );
  const cancelledInterview = await requestJson(
    `/api/interviews/${concurrencyInterviewId}`,
  );
  assert.equal(cancelledInterview.interview.status, "CANCELLED");
  assert.equal(cancelledInterview.turns.length, 0);
  assert.ok(
    cancelledInterview.skillStates.every(
      (state) => state.sourceTurnCount === 0,
    ),
  );

  const created = await requestJson("/api/interviews", {
    method: "POST",
    body: JSON.stringify(interviewPayload),
  });
  const interviewId = created.interview?.id;
  assert.equal(typeof interviewId, "string");

  let selection = await requestJson(
    `/api/interviews/${interviewId}/next-question`,
  );
  assert.notEqual(selection.nextQuestion.id, "statistics_ml_001");
  const rejectedOutOfOrder = await fetch(
    `${baseUrl}/api/interviews/${interviewId}/turns`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sequenceNumber: 2,
        questionId: selection.nextQuestion.id,
        answerText: richAnswer,
        inputMode: "text",
      }),
    },
  );
  assert.equal(rejectedOutOfOrder.status, 409);
  const rejectedOutOfOrderBody = await rejectedOutOfOrder.json();
  assert.equal(
    rejectedOutOfOrderBody.error?.code,
    "TURN_SEQUENCE_OUT_OF_ORDER",
  );
  const rejectedCounterfactual = await fetch(
    `${baseUrl}/api/interviews/${interviewId}/turns`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sequenceNumber: 1,
        questionId: "statistics_ml_001",
        answerText: richAnswer,
        inputMode: "text",
      }),
    },
  );
  assert.equal(rejectedCounterfactual.status, 409);
  const rejectedBody = await rejectedCounterfactual.json();
  assert.equal(rejectedBody.error?.code, "QUESTION_POLICY_CONFLICT");
  const unmodifiedInterview = await requestJson(
    `/api/interviews/${interviewId}`,
  );
  assert.equal(unmodifiedInterview.turns.length, 0);

  let sequenceNumber = 1;
  while (selection.nextQuestion) {
    assert.ok(
      sequenceNumber <= 10,
      "interview exceeded the bounded turn budget",
    );
    const completedAt = new Date().toISOString();
    selection = await requestJson(
      `/api/interviews/${interviewId}/turns`,
      {
        method: "POST",
        body: JSON.stringify({
          sequenceNumber,
          questionId: selection.nextQuestion.id,
          answerText: richAnswer,
          inputMode: "text",
          startedAt: completedAt,
          completedAt,
        }),
      },
    );
    sequenceNumber += 1;
  }

  await requestJson(`/api/interviews/${interviewId}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "PAUSED",
      currentStage: "PAUSED",
    }),
  });
  const pausedAfterFinalTurn = await requestJson(
    `/api/interviews/${interviewId}/next-question`,
  );
  assert.equal(pausedAfterFinalTurn.interview.status, "PAUSED");
  assert.equal(pausedAfterFinalTurn.nextQuestion, null);
  await requestJson(`/api/interviews/${interviewId}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "COMPLETED",
      currentStage: "COMPLETED",
    }),
  });
  const reportResult = await requestJson(
    `/api/interviews/${interviewId}/report`,
  );
  const report = reportResult.report;
  assert.ok(report);
  assert.equal(report.metrics.completedTurns, 6);
  assert.equal(report.metrics.acceptedTurns, 6);
  assert.ok(
    report.turns.every(
      (turn) =>
        turn.evaluation.evaluator === "RUBRIC_DOUBLE_PASS" &&
        turn.evaluation.semantic?.promptVersion ===
          "rubric-double-pass-v1" &&
        /^[a-f0-9]{64}$/.test(
          turn.evaluation.semantic?.questionFingerprint ?? "",
        ) &&
        /^[a-f0-9]{64}$/.test(
          turn.evaluation.semantic?.requestFingerprint ?? "",
        ),
    ),
  );
  assert.equal(report.policyAudit.summary.replayedTurns, 6);
  assert.equal(report.policyAudit.summary.matchingSelections, 6);
  assert.equal(
    report.policyAudit.invariants.deterministicSelection,
    true,
  );
  assert.equal(
    report.policyAudit.invariants.reachesTerminalPolicyState,
    true,
  );
  assert.match(report.policyAudit.fingerprint, /^[a-f0-9]{64}$/);
  const adaptiveSteps = report.policyAudit.steps.filter(
    (step) => step.questionType === "adaptive",
  );
  assert.equal(adaptiveSteps.length, 2);
  assert.ok(adaptiveSteps.every((step) => step.ranking.length === 3));

  console.log(
    JSON.stringify(
      {
        interviewId,
        completedTurns: report.metrics.completedTurns,
        acceptedTurns: report.metrics.acceptedTurns,
        replayMatches:
          report.policyAudit.summary.matchingSelections,
        adaptiveDecisions:
          report.policyAudit.summary.adaptiveDecisions,
        fingerprint: report.policyAudit.fingerprint.slice(0, 16),
      },
      null,
      2,
    ),
  );
} catch (error) {
  if (serverOutput.length > 0) {
    console.error(serverOutput.join(""));
  }
  throw error;
} finally {
  releaseBlockedScorer?.();
  await stopServer();
  scorerServer.close();
  await once(scorerServer, "close");
}

async function seedInternalEventConflict(interviewId, sequenceNumber) {
  const idempotencyKey =
    `internal:turn:${interviewId}:${sequenceNumber}`;
  const statement = [
    "INSERT INTO agent_events",
    "(id, interview_id, event_type, payload, idempotency_key, created_at)",
    `VALUES (${sqlLiteral(`evt_e2e_${crypto.randomUUID()}`)},`,
    `${sqlLiteral(interviewId)}, 'test.conflict', '{}',`,
    `${sqlLiteral(idempotencyKey)}, CURRENT_TIMESTAMP);`,
  ].join(" ");
  await execFileAsync(
    process.execPath,
    [
      "scripts/run-wrangler.mjs",
      "d1",
      "execute",
      "site-creator-d1",
      "--local",
      "--config",
      "wrangler.local.jsonc",
      "--command",
      statement,
    ],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        WRANGLER_LOG_PATH: ".wrangler/wrangler.log",
      },
    },
  );
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function requestJson(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(
      `${init.method ?? "GET"} ${path} returned ${response.status}: ${text}`,
    );
  }
  return body;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`dev server exited with code ${server.exitCode}`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // The dev server is still warming up.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`dev server did not become ready at ${baseUrl}`);
}

function rememberOutput(chunk) {
  serverOutput.push(chunk.toString());
  if (serverOutput.length > 80) serverOutput.shift();
}

async function stopServer() {
  if (server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([
    once(server, "exit"),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (server.exitCode === null) {
    server.kill("SIGKILL");
  }
}
