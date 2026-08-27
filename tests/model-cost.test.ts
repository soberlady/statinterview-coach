import assert from "node:assert/strict";
import test from "node:test";
import { estimateTokenCost } from "../app/lib/model-cost";

test("token cost uses per-million USD rates as micro-USD per token", () => {
  assert.deepEqual(
    estimateTokenCost({
      inputTokens: 240,
      outputTokens: 80,
      inputUsdPerMillionTokens: "1",
      outputUsdPerMillionTokens: "2",
      pricingVersion: "fixture-v1",
    }),
    {
      status: "PRICED",
      estimatedCostMicrousd: 400,
      pricingVersion: "fixture-v1",
      inputUsdPerMillionTokens: 1,
      outputUsdPerMillionTokens: 2,
    },
  );
});

test("token cost keeps observed tokens unpriced without a complete profile", () => {
  const estimate = estimateTokenCost({
    inputTokens: 240,
    outputTokens: 80,
    inputUsdPerMillionTokens: "1",
  });

  assert.equal(estimate.status, "UNPRICED");
  assert.equal(estimate.estimatedCostMicrousd, null);
});

test("token cost distinguishes missing usage from zero usage", () => {
  assert.equal(
    estimateTokenCost({ inputTokens: null, outputTokens: null }).status,
    "NOT_MEASURED",
  );
  assert.equal(
    estimateTokenCost({
      inputTokens: 0,
      outputTokens: 0,
      inputUsdPerMillionTokens: "1",
      outputUsdPerMillionTokens: "2",
      pricingVersion: "fixture-v1",
    }).estimatedCostMicrousd,
    0,
  );
});
