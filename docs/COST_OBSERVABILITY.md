# Inference cost observability

## Claim boundary

The report shows a **marginal LiveKit Inference list-price estimate**, not a
reconciled invoice. It uses observed model usage but does not deduct monthly
credits, apply Enterprise agreements, add tax, or include hosted Agent session
minutes, WebRTC transport, or observability storage. The optional semantic
scorer is included only when its model-specific price profile is configured;
otherwise its observed token usage is explicitly marked unpriced.

This boundary is intentional: missing price metadata is shown as unpriced
usage and never silently treated as free.

## Measurement path

The worker reads the final cumulative `AgentSession.usage` snapshot after the
session is closed. One idempotent `voice.usage` event is written for each
LiveKit job. Re-entering voice mode creates a new room and job, so reconnect
costs accumulate as separate observed sessions without double-counting a
single job.

The event includes:

- LLM input, cached-input, and output tokens by provider/model;
- STT processed audio duration by provider/model;
- TTS synthesized characters and output-audio duration by provider/model;
- the versioned pricing profile and plan;
- priced and unpriced line-item counts;
- an integer micro-USD estimate for safely summing small values.

Each persisted `turn_evaluated` event also carries the semantic scorer's
combined two-pass input/output tokens. Set all three scorer pricing variables
to include those calls in the interview total:

- `STATINTERVIEW_SCORER_INPUT_USD_PER_MILLION_TOKENS`;
- `STATINTERVIEW_SCORER_OUTPUT_USD_PER_MILLION_TOKENS`;
- `STATINTERVIEW_SCORER_PRICING_VERSION`.

If any value or the provider's token report is missing, the call remains
unpriced. This lets the report total LiveKit and scorer costs while preserving
the coverage boundary.

The report exposes four states:

| State | Meaning |
| --- | --- |
| `NOT_MEASURED` | No inference usage snapshot has been saved. |
| `AVAILABLE` | Every observed line item has a known price. |
| `PARTIAL` | Some observed models are priced and some are not. |
| `UNAVAILABLE` | Usage exists, but none of its models have a known price. |

## Frozen pricing profile

`livekit-list-2026-08-08` is limited to the project's current pipeline:

| Component | Model | Billing unit |
| --- | --- | --- |
| LLM | `google/gemma-4-31b-it` | input/cached/output tokens |
| STT | `deepgram/nova-3` | processed audio minute |
| TTS | `cartesia/sonic-3.5` | synthesized characters |

The default profile is Build/Ship. Set
`STATINTERVIEW_LIVEKIT_PRICING_PLAN=scale` only when the LiveKit project is on
that plan. The catalog date must change when rates change; historical events
retain their original version instead of being silently repriced.

Rates and units were frozen from the official
[LiveKit Inference pricing page](https://livekit.com/pricing/inference). The
usage fields and final-session collection pattern follow LiveKit's official
[metrics and usage documentation](https://docs.livekit.io/deploy/observability/data/).

## Verification

Python tests cover exact LLM cached-token arithmetic, STT/TTS plan rates,
unknown-model handling, empty measurements, and invalid plans. TypeScript tests
cover scorer token arithmetic and report aggregation states. The local API
end-to-end scenario prices six double-pass scorer turns, persists a synthetic
`voice.usage` event, and verifies the combined report total and coverage
metadata.

A real cost-per-completed-interview result still requires a completed voice
session. After the next manual voice run, close the room normally and open the
report. Preserve the raw `voice.usage` payload when documenting the result so
the estimate can be reproduced from its usage and pricing version.
