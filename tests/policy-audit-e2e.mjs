import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const execFileAsync = promisify(execFile);
const concurrentAnswerMarker = "STATINTERVIEW_CONCURRENCY_GUARD";
let blockedScorerRequests = 0;
let scorerRequestCount = 0;
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
    scorerRequestCount += 1;
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
const localEnvPath = join(projectRoot, ".env.local");
const localEnvBackupDirectory = join(projectRoot, "work", "e2e");
const localEnvBackupPath = join(
  localEnvBackupDirectory,
  ".env.local.backup",
);
mkdirSync(localEnvBackupDirectory, { recursive: true });
if (existsSync(localEnvBackupPath) && !existsSync(localEnvPath)) {
  renameSync(localEnvBackupPath, localEnvPath);
}
if (existsSync(localEnvBackupPath)) {
  throw new Error("Refusing to overwrite a stale .env.local E2E backup.");
}
let localEnvMoved = false;
if (existsSync(localEnvPath)) {
  renameSync(localEnvPath, localEnvBackupPath);
  localEnvMoved = true;
}
function restoreLocalEnvironment() {
  if (!localEnvMoved || !existsSync(localEnvBackupPath)) return;
  renameSync(localEnvBackupPath, localEnvPath);
  localEnvMoved = false;
}
process.once("exit", restoreLocalEnvironment);
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
      STATINTERVIEW_SCORER_INPUT_USD_PER_MILLION_TOKENS: "1",
      STATINTERVIEW_SCORER_OUTPUT_USD_PER_MILLION_TOKENS: "2",
      STATINTERVIEW_SCORER_PRICING_VERSION: "e2e-scorer-v1",
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
  const health = await requestJson("/api/health");
  assert.equal(health.status, "ok");
  assert.equal(health.checks.database, "ready");
  assert.equal(health.checks.questionBank.approvedQuestionCount, 24);
  assert.equal(health.checks.policy, "ready");
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
    pendingConcurrentTurn.then(async (response) => {
      const body = await response.clone().json();
      throw new Error(
        "semantic scorer returned before the concurrency gate: " +
          JSON.stringify({
            status: response.status,
            evaluator: body.evaluation?.evaluator,
            action: body.evaluation?.action,
            scorerRequestCount,
          }),
      );
    }),
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
  const voiceSessionA = `voice-e2e-a-${crypto.randomUUID()}`;
  const voiceSessionB = `voice-e2e-b-${crypto.randomUUID()}`;
  await requestJson(`/api/interviews/${interviewId}/events`, {
    method: "POST",
    body: JSON.stringify({
      eventType: "voice.connected",
      latencyMs: 1_400,
      idempotencyKey: `client:voice:${voiceSessionA}:connected`,
      payload: { voiceSessionId: voiceSessionA },
    }),
  });
  await requestJson(`/api/interviews/${interviewId}/events`, {
    method: "POST",
    body: JSON.stringify({
      eventType: "voice.transcript_final",
      idempotencyKey: `client:voice:${voiceSessionA}:transcript:one`,
      payload: {
        voiceSessionId: voiceSessionA,
        transcriptCharacters: 80,
      },
    }),
  });
  await requestJson(`/api/interviews/${interviewId}/events`, {
    method: "POST",
    body: JSON.stringify({
      eventType: "voice.turn_committed",
      latencyMs: 1_200,
      idempotencyKey: `client:voice:${voiceSessionA}:turn:6`,
      payload: { voiceSessionId: voiceSessionA },
    }),
  });
  await requestJson(`/api/interviews/${interviewId}/events`, {
    method: "POST",
    body: JSON.stringify({
      eventType: "voice.connected",
      latencyMs: 900,
      idempotencyKey: `client:voice:${voiceSessionB}:connected`,
      payload: { voiceSessionId: voiceSessionB },
    }),
  });
  await requestJson(`/api/interviews/${interviewId}/events`, {
    method: "POST",
    body: JSON.stringify({
      eventType: "voice.reconnected",
      latencyMs: 300,
      payload: { voiceSessionId: voiceSessionB },
    }),
  });
  await requestJson(`/api/interviews/${interviewId}/events`, {
    method: "POST",
    body: JSON.stringify({
      eventType: "voice.usage",
      model: "livekit-inference",
      inputTokens: 10_000,
      outputTokens: 1_000,
      estimatedCostMicrousd: 214_400,
      idempotencyKey: `worker:voice:${interviewId}:test-job:usage`,
      payload: {
        voiceSessionId: voiceSessionB,
        pricing: {
          version: "livekit-list-2026-08-08",
          plan: "build_ship",
          status: "COMPLETE",
          allowancesApplied: false,
        },
        totals: {
          pricedUsageCount: 3,
          unpricedUsageCount: 0,
        },
      },
    }),
  });
  const reportResult = await requestJson(
    `/api/interviews/${interviewId}/report`,
  );
  const report = reportResult.report;
  assert.ok(report);
  assert.equal(report.metrics.completedTurns, 7);
  assert.equal(report.metrics.acceptedTurns, 7);
  assert.deepEqual(report.metrics.voiceTelemetry, {
    sessionCount: 2,
    reconnectCount: 2,
    failedConnectionCount: 0,
    finalTranscriptSegmentCount: 1,
    committedTurnCount: 1,
    connectionLatency: { count: 2, p50Ms: 1_150, p95Ms: 1_375 },
    transcriptToCommitLatency: {
      count: 1,
      p50Ms: 1_200,
      p95Ms: 1_200,
    },
  });
  assert.equal(report.metrics.estimatedCostUsd, 0.2172);
  assert.deepEqual(report.metrics.costTelemetry, {
    status: "AVAILABLE",
    estimatedCostMicrousd: 217_200,
    pricedEventCount: 8,
    voiceUsageEventCount: 1,
    scorerUsageEventCount: 7,
    pricedUsageCount: 10,
    unpricedUsageCount: 0,
    pricingVersions: ["e2e-scorer-v1", "livekit-list-2026-08-08"],
    allowancesApplied: false,
  });
  assert.ok(
    report.turns.every(
      (turn) =>
        turn.evaluation.evaluator === "RUBRIC_DOUBLE_PASS" &&
        turn.evaluation.semantic?.promptVersion ===
          "rubric-double-pass-v2" &&
        /^[a-f0-9]{64}$/.test(
          turn.evaluation.semantic?.questionFingerprint ?? "",
        ) &&
        /^[a-f0-9]{64}$/.test(
          turn.evaluation.semantic?.requestFingerprint ?? "",
        ),
    ),
  );
  assert.equal(report.policyAudit.summary.replayedTurns, 7);
  assert.equal(report.policyAudit.summary.matchingSelections, 7);
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
  assert.equal(adaptiveSteps.length, 3);
  assert.ok(adaptiveSteps.every((step) => step.ranking.length === 3));

  const scorerRequestsBeforeDemo = scorerRequestCount;
  const demoCreated = await requestJson("/api/interviews", {
    method: "POST",
    body: JSON.stringify({
      jobTitle: "增长数据分析实习生（引导演示）",
      jobDescription:
        "负责增长漏斗和留存分析，熟练使用 SQL 与 Python 完成数据提取、口径校验和异常排查；参与 A/B 测试设计、实验指标分析与业务复盘。",
      candidateBackground: "合成演示候选人",
      durationMinutes: 20,
      cameraEnabled: false,
      recordingEnabled: false,
      mode: "guided_demo",
    }),
  });
  const demoInterviewId = demoCreated.interview?.id;
  assert.equal(typeof demoInterviewId, "string");
  assert.equal(demoCreated.interview.mode, "guided_demo");

  let demoSelection = await requestJson(
    `/api/interviews/${demoInterviewId}/next-question`,
  );
  assert.equal(demoSelection.demo?.synthetic, true);
  let recommendedDemoAnswer = demoSelection.demo.answerOptions.find(
    (option) => option.recommended,
  );
  assert.equal(recommendedDemoAnswer?.id, "weak");
  let demoSequence = 1;
  demoSelection = await requestJson(
    `/api/interviews/${demoInterviewId}/turns`,
    {
      method: "POST",
      body: JSON.stringify({
        sequenceNumber: demoSequence,
        questionId: demoSelection.nextQuestion.id,
        answerText: recommendedDemoAnswer.answer,
        inputMode: "text",
      }),
    },
  );
  assert.equal(demoSelection.evaluation.action, "VERIFY");
  assert.equal(demoSelection.nextQuestion.questionType, "verification");
  assert.equal(demoSelection.evaluation.evaluator, "DEMO_FIXTURE");

  demoSequence += 1;
  recommendedDemoAnswer = demoSelection.demo.answerOptions.find(
    (option) => option.recommended,
  );
  assert.equal(recommendedDemoAnswer?.id, "weak");
  demoSelection = await requestJson(
    `/api/interviews/${demoInterviewId}/turns`,
    {
      method: "POST",
      body: JSON.stringify({
        sequenceNumber: demoSequence,
        questionId: demoSelection.nextQuestion.id,
        answerText: recommendedDemoAnswer.answer,
        inputMode: "text",
      }),
    },
  );
  assert.equal(demoSelection.evaluation.action, "ABSTAIN");

  while (demoSelection.nextQuestion) {
    demoSequence += 1;
    assert.ok(demoSequence <= 9, "guided demo exceeded its bounded path");
    recommendedDemoAnswer = demoSelection.demo.answerOptions.find(
      (option) => option.recommended,
    );
    assert.equal(recommendedDemoAnswer?.id, "strong");
    demoSelection = await requestJson(
      `/api/interviews/${demoInterviewId}/turns`,
      {
        method: "POST",
        body: JSON.stringify({
          sequenceNumber: demoSequence,
          questionId: demoSelection.nextQuestion.id,
          answerText: recommendedDemoAnswer.answer,
          inputMode: "text",
        }),
      },
    );
  }
  await requestJson(`/api/interviews/${demoInterviewId}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "COMPLETED",
      currentStage: "COMPLETED",
    }),
  });
  const demoReportResult = await requestJson(
    `/api/interviews/${demoInterviewId}/report`,
  );
  const demoReport = demoReportResult.report;
  assert.ok(demoReport);
  assert.equal(demoReport.interview.mode, "guided_demo");
  assert.equal(demoReport.metrics.completedTurns, 8);
  assert.equal(demoReport.metrics.acceptedTurns, 6);
  assert.equal(demoReport.metrics.verificationTurns, 1);
  assert.equal(demoReport.policyAudit.summary.replayedTurns, 8);
  assert.equal(demoReport.policyAudit.summary.matchingSelections, 8);
  assert.equal(demoReport.policyAudit.summary.adaptiveDecisions, 3);
  assert.ok(
    demoReport.turns.every(
      (turn) => turn.evaluation.evaluator === "DEMO_FIXTURE",
    ),
  );
  const rejectedDemoFeedback = await fetch(
    `${baseUrl}/api/interviews/${demoInterviewId}/feedback`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating: 5, wouldUseAgain: true }),
    },
  );
  assert.equal(rejectedDemoFeedback.status, 409);
  const rejectedDemoFeedbackBody = await rejectedDemoFeedback.json();
  assert.equal(
    rejectedDemoFeedbackBody.error?.code,
    "DEMO_FEEDBACK_NOT_COLLECTED",
  );
  assert.equal(scorerRequestCount, scorerRequestsBeforeDemo);

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
        guidedDemo: {
          completedTurns: demoReport.metrics.completedTurns,
          acceptedTurns: demoReport.metrics.acceptedTurns,
          scorerCalls: scorerRequestCount - scorerRequestsBeforeDemo,
        },
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
  restoreLocalEnvironment();
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
