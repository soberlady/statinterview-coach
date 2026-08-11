import assert from "node:assert/strict";
import test from "node:test";
import { inspectConfiguration, parseEnvText } from "../scripts/config-doctor.mjs";

const options = {
  nodeVersion: "22.13.0",
  fileExists: () => true,
};

test("empty optional configuration is safe but reports warnings", () => {
  const report = inspectConfiguration({}, options);
  assert.equal(report.ok, true);
  assert.equal(report.summary.errors, 0);
  assert.ok(report.summary.warnings >= 2);
});

test("partial LiveKit configuration fails without leaking values", () => {
  const secret = "do-not-print-this";
  const report = inspectConfiguration({ LIVEKIT_API_SECRET: secret }, options);
  assert.equal(report.ok, false);
  assert.ok(report.checks.some((check) => check.code === "LIVEKIT_PARTIAL"));
  assert.equal(JSON.stringify(report).includes(secret), false);
});

test("complete voice and scorer configuration passes", () => {
  const report = inspectConfiguration(
    {
      LIVEKIT_URL: "wss://demo.livekit.cloud",
      LIVEKIT_API_KEY: "key",
      LIVEKIT_API_SECRET: "secret",
      STATINTERVIEW_API_BASE_URL: "https://demo.example",
      STATINTERVIEW_LIVEKIT_PRICING_PLAN: "build_ship",
      STATINTERVIEW_TTS_SPEED: "0.92",
      STATINTERVIEW_SCORER_ENDPOINT: "https://model.example/v1/chat/completions",
      STATINTERVIEW_SCORER_API_KEY: "key",
      STATINTERVIEW_SCORER_MODEL: "model",
      STATINTERVIEW_SCORER_STRICT: "1",
      STATINTERVIEW_SCORER_INPUT_USD_PER_MILLION_TOKENS: "1",
      STATINTERVIEW_SCORER_OUTPUT_USD_PER_MILLION_TOKENS: "2",
      STATINTERVIEW_SCORER_PRICING_VERSION: "2026-08",
    },
    options,
  );
  assert.equal(report.ok, true);
  assert.equal(report.summary.errors, 0);
});

test("partial scorer pricing fails", () => {
  const report = inspectConfiguration(
    { STATINTERVIEW_SCORER_INPUT_USD_PER_MILLION_TOKENS: "1" },
    options,
  );
  assert.ok(report.checks.some((check) => check.code === "SCORER_PRICING_PARTIAL"));
  assert.equal(report.ok, false);
});

test("browser-visible secret-like variables fail", () => {
  const report = inspectConfiguration({ NEXT_PUBLIC_API_KEY: "unsafe" }, options);
  assert.ok(report.checks.some((check) => check.code === "PUBLIC_SECRET_EXPOSURE"));
  assert.equal(report.ok, false);
});

test("unsupported Node.js versions fail", () => {
  const report = inspectConfiguration({}, { ...options, nodeVersion: "20.19.0" });
  assert.ok(report.checks.some((check) => check.code === "NODE_VERSION_UNSUPPORTED"));
  assert.equal(report.ok, false);
});

test("env parser supports comments, export and quoted values", () => {
  assert.deepEqual(parseEnvText("# comment\nexport A='one'\nB=\"two\"\nC=three\n"), {
    A: "one",
    B: "two",
    C: "three",
  });
});
