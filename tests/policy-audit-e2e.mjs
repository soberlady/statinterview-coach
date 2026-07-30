import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
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
  const created = await requestJson("/api/interviews", {
    method: "POST",
    body: JSON.stringify({
      jobTitle: "数据分析实习生",
      jobDescription:
        "负责 SQL、Python、A/B 实验、业务指标分析与统计建模。",
      durationMinutes: 15,
      mode: "diagnostic",
      cameraEnabled: false,
      recordingEnabled: false,
    }),
  });
  const interviewId = created.interview?.id;
  assert.equal(typeof interviewId, "string");

  let selection = await requestJson(
    `/api/interviews/${interviewId}/next-question`,
  );
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
  await stopServer();
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
