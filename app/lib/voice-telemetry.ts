export type VoiceTelemetryEvent = {
  eventType: string;
  latencyMs: number | null;
  payload: Record<string, unknown>;
};

export type LatencySummary = {
  count: number;
  p50Ms: number | null;
  p95Ms: number | null;
};

export type VoiceTelemetrySummary = {
  sessionCount: number;
  reconnectCount: number;
  failedConnectionCount: number;
  finalTranscriptSegmentCount: number;
  committedTurnCount: number;
  connectionLatency: LatencySummary;
  transcriptToCommitLatency: LatencySummary;
};

/**
 * Summarize client-observed voice events without mixing them into scoring
 * latency. These measurements are operational evidence, never policy input.
 */
export function summarizeVoiceTelemetry(
  events: VoiceTelemetryEvent[],
): VoiceTelemetrySummary {
  const connected = events.filter(
    (event) => event.eventType === "voice.connected",
  );
  const sessionIds = new Set(
    connected
      .map((event) => event.payload.voiceSessionId)
      .filter((value): value is string => typeof value === "string"),
  );
  const committed = events.filter(
    (event) => event.eventType === "voice.turn_committed",
  );
  const inRoomReconnects = events.filter(
    (event) => event.eventType === "voice.reconnected",
  ).length;

  return {
    sessionCount: sessionIds.size,
    reconnectCount: Math.max(0, sessionIds.size - 1) + inRoomReconnects,
    failedConnectionCount: events.filter(
      (event) => event.eventType === "voice.connection_failed",
    ).length,
    finalTranscriptSegmentCount: events.filter(
      (event) => event.eventType === "voice.transcript_final",
    ).length,
    committedTurnCount: committed.length,
    connectionLatency: summarizeLatencies(connected),
    transcriptToCommitLatency: summarizeLatencies(committed),
  };
}

function summarizeLatencies(events: VoiceTelemetryEvent[]): LatencySummary {
  const latencies = events
    .map((event) => event.latencyMs)
    .filter(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value) && value >= 0,
    )
    .sort((left, right) => left - right);

  return {
    count: latencies.length,
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
  };
}

function percentile(sorted: number[], quantile: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return Math.round(sorted[0]);
  const position = (sorted.length - 1) * quantile;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  return Math.round(lower + (upper - lower) * (position - lowerIndex));
}
