export type TokenCostEstimate = {
  status: "NOT_MEASURED" | "PRICED" | "UNPRICED";
  estimatedCostMicrousd: number | null;
  pricingVersion: string | null;
  inputUsdPerMillionTokens: number | null;
  outputUsdPerMillionTokens: number | null;
};

/**
 * Estimate an OpenAI-compatible scorer call from its reported token usage.
 * One dollar per million tokens equals one micro-dollar per token, so the
 * arithmetic can remain in integer micro-USD at the persistence boundary.
 */
export function estimateTokenCost(input: {
  inputTokens: number | null;
  outputTokens: number | null;
  inputUsdPerMillionTokens?: string;
  outputUsdPerMillionTokens?: string;
  pricingVersion?: string;
}): TokenCostEstimate {
  if (input.inputTokens === null || input.outputTokens === null) {
    return unmeasured();
  }

  const inputRate = parseRate(input.inputUsdPerMillionTokens);
  const outputRate = parseRate(input.outputUsdPerMillionTokens);
  const pricingVersion = input.pricingVersion?.trim() || null;
  if (inputRate === null || outputRate === null || pricingVersion === null) {
    return {
      status: "UNPRICED",
      estimatedCostMicrousd: null,
      pricingVersion,
      inputUsdPerMillionTokens: inputRate,
      outputUsdPerMillionTokens: outputRate,
    };
  }

  const estimatedCostMicrousd = Math.round(
    Math.max(0, input.inputTokens) * inputRate +
      Math.max(0, input.outputTokens) * outputRate,
  );
  if (!Number.isSafeInteger(estimatedCostMicrousd)) {
    return {
      status: "UNPRICED",
      estimatedCostMicrousd: null,
      pricingVersion,
      inputUsdPerMillionTokens: inputRate,
      outputUsdPerMillionTokens: outputRate,
    };
  }

  return {
    status: "PRICED",
    estimatedCostMicrousd,
    pricingVersion,
    inputUsdPerMillionTokens: inputRate,
    outputUsdPerMillionTokens: outputRate,
  };
}

function parseRate(value: string | undefined): number | null {
  if (value === undefined || value.trim().length === 0) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function unmeasured(): TokenCostEstimate {
  return {
    status: "NOT_MEASURED",
    estimatedCostMicrousd: null,
    pricingVersion: null,
    inputUsdPerMillionTokens: null,
    outputUsdPerMillionTokens: null,
  };
}
