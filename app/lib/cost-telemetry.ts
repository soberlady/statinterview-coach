export type CostTelemetryEvent = {
  eventType: string;
  estimatedCostMicrousd: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  payload: Record<string, unknown>;
};

export type CostTelemetrySummary = {
  status: "NOT_MEASURED" | "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
  estimatedCostMicrousd: number | null;
  pricedEventCount: number;
  voiceUsageEventCount: number;
  scorerUsageEventCount: number;
  pricedUsageCount: number;
  unpricedUsageCount: number;
  pricingVersions: string[];
  allowancesApplied: false;
};

/**
 * Summarize observed inference usage without treating missing prices as free.
 * Monetary values are list-price estimates, not invoice reconciliation.
 */
export function summarizeCostTelemetry(
  events: CostTelemetryEvent[],
): CostTelemetrySummary {
  const pricedEvents = events.filter(
    (event) => event.estimatedCostMicrousd !== null,
  );
  const voiceUsageEvents = events.filter(
    (event) => event.eventType === "voice.usage",
  );
  const scorerUsageEvents = events.filter((event) => {
    if (event.eventType !== "turn_evaluated") return false;
    const status = nestedCostString(event.payload, "status");
    return (
      status === "PRICED" ||
      status === "UNPRICED" ||
      typeof event.inputTokens === "number" ||
      typeof event.outputTokens === "number"
    );
  });
  const voicePricedUsageCount = voiceUsageEvents.reduce(
    (sum, event) =>
      sum + nestedNonNegativeInteger(event.payload, "pricedUsageCount"),
    0,
  );
  const voiceUnpricedUsageCount = voiceUsageEvents.reduce(
    (sum, event) =>
      sum + nestedNonNegativeInteger(event.payload, "unpricedUsageCount"),
    0,
  );
  const scorerPricedUsageCount = scorerUsageEvents.filter(
    (event) => nestedCostString(event.payload, "status") === "PRICED",
  ).length;
  const scorerUnpricedUsageCount =
    scorerUsageEvents.length - scorerPricedUsageCount;
  const pricedUsageCount =
    voicePricedUsageCount + scorerPricedUsageCount;
  const unpricedUsageCount =
    voiceUnpricedUsageCount + scorerUnpricedUsageCount;
  const pricingVersions = Array.from(
    new Set(
      [
        ...voiceUsageEvents.map((event) =>
          nestedPricingString(event.payload, "version"),
        ),
        ...scorerUsageEvents.map((event) =>
          nestedCostString(event.payload, "version"),
        ),
      ]
        .filter((value): value is string => value !== null),
    ),
  ).sort();
  const estimatedCostMicrousd =
    pricedEvents.length === 0
      ? null
      : pricedEvents.reduce(
          (sum, event) => sum + (event.estimatedCostMicrousd ?? 0),
          0,
        );

  let status: CostTelemetrySummary["status"];
  if (
    voiceUsageEvents.length === 0 &&
    scorerUsageEvents.length === 0 &&
    pricedEvents.length === 0
  ) {
    status = "NOT_MEASURED";
  } else if (pricedEvents.length === 0) {
    status = "UNAVAILABLE";
  } else if (unpricedUsageCount > 0) {
    status = "PARTIAL";
  } else {
    status = "AVAILABLE";
  }

  return {
    status,
    estimatedCostMicrousd,
    pricedEventCount: pricedEvents.length,
    voiceUsageEventCount: voiceUsageEvents.length,
    scorerUsageEventCount: scorerUsageEvents.length,
    pricedUsageCount,
    unpricedUsageCount,
    pricingVersions,
    allowancesApplied: false,
  };
}

function nestedNonNegativeInteger(
  payload: Record<string, unknown>,
  key: string,
): number {
  const totals = payload.totals;
  if (!isObject(totals)) return 0;
  const value = totals[key];
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : 0;
}

function nestedPricingString(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const pricing = payload.pricing;
  if (!isObject(pricing)) return null;
  const value = pricing[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nestedCostString(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const cost = payload.cost;
  if (!isObject(cost)) return null;
  const value = cost[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
