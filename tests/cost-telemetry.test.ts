import assert from "node:assert/strict";
import test from "node:test";
import { summarizeCostTelemetry } from "../app/lib/cost-telemetry";

test("cost telemetry sums priced events and reports full coverage", () => {
  const summary = summarizeCostTelemetry([
    event(214_400, 3, 0, "livekit-list-2026-08-08"),
    {
      eventType: "voice.connected",
      estimatedCostMicrousd: null,
      payload: {},
    },
  ]);

  assert.deepEqual(summary, {
    status: "AVAILABLE",
    estimatedCostMicrousd: 214_400,
    pricedEventCount: 1,
    voiceUsageEventCount: 1,
    scorerUsageEventCount: 0,
    pricedUsageCount: 3,
    unpricedUsageCount: 0,
    pricingVersions: ["livekit-list-2026-08-08"],
    allowancesApplied: false,
  });
});

test("cost telemetry exposes partial pricing coverage", () => {
  const summary = summarizeCostTelemetry([
    event(5_000, 1, 1, "livekit-list-2026-08-08"),
    scorerEvent(null, "UNPRICED", null),
  ]);

  assert.equal(summary.status, "PARTIAL");
  assert.equal(summary.estimatedCostMicrousd, 5_000);
  assert.equal(summary.unpricedUsageCount, 2);
  assert.equal(summary.scorerUsageEventCount, 1);
});

test("cost telemetry combines priced scorer turns with voice usage", () => {
  const summary = summarizeCostTelemetry([
    event(214_400, 3, 0, "livekit-list-2026-08-08"),
    scorerEvent(400, "PRICED", "scorer-v1"),
    scorerEvent(400, "PRICED", "scorer-v1"),
  ]);

  assert.equal(summary.status, "AVAILABLE");
  assert.equal(summary.estimatedCostMicrousd, 215_200);
  assert.equal(summary.pricedEventCount, 3);
  assert.equal(summary.pricedUsageCount, 5);
  assert.equal(summary.scorerUsageEventCount, 2);
  assert.deepEqual(summary.pricingVersions, [
    "livekit-list-2026-08-08",
    "scorer-v1",
  ]);
});

test("cost telemetry distinguishes absent and unpriced measurements", () => {
  assert.equal(summarizeCostTelemetry([]).status, "NOT_MEASURED");
  assert.equal(summarizeCostTelemetry([]).estimatedCostMicrousd, null);

  const unavailable = summarizeCostTelemetry([
    event(null, 0, 1, "livekit-list-2026-08-08"),
  ]);
  assert.equal(unavailable.status, "UNAVAILABLE");
  assert.equal(unavailable.estimatedCostMicrousd, null);
});

test("legacy scorer tokens remain unpriced when price metadata is absent", () => {
  const summary = summarizeCostTelemetry([
    {
      eventType: "turn_evaluated",
      estimatedCostMicrousd: null,
      inputTokens: 240,
      outputTokens: 80,
      payload: {},
    },
  ]);

  assert.equal(summary.status, "UNAVAILABLE");
  assert.equal(summary.scorerUsageEventCount, 1);
  assert.equal(summary.unpricedUsageCount, 1);
});

function event(
  estimatedCostMicrousd: number | null,
  pricedUsageCount: number,
  unpricedUsageCount: number,
  version: string,
) {
  return {
    eventType: "voice.usage",
    estimatedCostMicrousd,
    payload: {
      pricing: { version },
      totals: { pricedUsageCount, unpricedUsageCount },
    },
  };
}

function scorerEvent(
  estimatedCostMicrousd: number | null,
  status: "PRICED" | "UNPRICED",
  version: string | null,
) {
  return {
    eventType: "turn_evaluated",
    estimatedCostMicrousd,
    payload: { cost: { status, version } },
  };
}
