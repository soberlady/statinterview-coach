# Voice evaluation protocol

Status: `IMPLEMENTED_NOT_MEASURED`

The realtime path is operational and instrumented, but no aggregate voice-
quality claim is made until the planned sessions are collected. Client-
observed measurements are persisted as Agent events and summarized separately
from scorer latency in the report API.

## Measurements

| Measurement | Start | Stop | Event |
| --- | --- | --- | --- |
| Connection latency | voice-token request | microphone published | `voice.connected` |
| Transcript-to-checkpoint latency | first final transcript segment | browser observes the incremented checkpoint | `voice.turn_committed` |
| In-room recovery latency | LiveKit reconnecting callback | reconnected callback | `voice.reconnected` |
| Final transcript segments | final candidate transcription | same callback | `voice.transcript_final` |
| Failed connection | voice start attempt | configuration, room or microphone failure | `voice.connection_failed` |

The events contain a voice-session identifier, sequence number, character
count and timings. They do not duplicate the raw answer. Raw answer text
continues to live only in the interview turn required for evidence review.
Voice and camera recording remain disabled by default.

The report exposes:

- successful voice sessions and recovery count;
- connection p50 and p95;
- final-transcript-to-checkpoint p50 and p95;
- final segment, committed turn and failed-connection counts.

These are operational metrics only. They never update the ability posterior,
score reliability or question-selection policy.

## Offline controller failure matrix

The media providers cannot be truthfully benchmarked without real audio, but
the Worker decision boundary can be tested without LiveKit Cloud. The
transport-independent controller has deterministic coverage for:

| Injected condition | Required behavior |
| --- | --- |
| Transcript shorter than ten characters | Do not call the turn API; request a fresh complete answer. |
| Turn request timeout | Keep the current question and sequence number. |
| HTTP 409 stale checkpoint | Discard the old buffer and load the authoritative next question. |
| Checkpoint reload failure | Do not guess a question or advance state. |
| Non-409 server rejection | Keep the current question and request a fresh answer. |
| Malformed successful response | Reload the checkpoint instead of falsely completing. |
| Final lifecycle PATCH timeout | Keep the saved final answer and let browser recovery finish; never ask for duplicate evidence. |

These tests establish orchestration behavior only. They do not measure
recognition accuracy, speech naturalness or realtime network latency.

## Planned 30-session acceptance run

Use at least two quiet-network conditions and one deliberately interrupted
condition. Keep the question bank and model configuration fixed for the run.

1. Ten cold joins covering the first and later interview questions.
2. Ten answers with mixed terms such as SQL, Python, A/B, p value, FDR,
   Bonferroni and window-function names.
3. Ten recovery attempts: leave and re-enter the voice room, plus forced short
   network interruptions where practical.

For every answer, save a consented human reference transcript outside the
product database and compare it with the stored final transcript. Report
Chinese character error rate and domain-term accuracy, not a subjective
“sounds accurate” claim.

Initial engineering targets:

| Metric | Target |
| --- | ---: |
| Checkpoint restored to the correct question | 100% |
| Connection p95 | <= 4 s |
| Final transcript to browser checkpoint p95 | <= 5 s |
| Chinese character error rate | <= 15% |
| Domain-term accuracy | >= 90% |
| Duplicate committed turns | 0 |

Targets are acceptance criteria, not measured results. If a target fails,
retain the raw sample count and failure cases, change one variable at a time,
and rerun under a new configuration version.

## Reproduction

1. Start the web app and LiveKit worker as described in
   `docs/LIVEKIT_RUNBOOK.md`.
2. Create a fresh diagnostic interview and use voice mode.
3. Complete a full answer and click **我已回答完**.
4. Re-enter voice mode during a later question to exercise checkpoint
   recovery.
5. Open the final report. The **VOICE OBSERVABILITY** card shows the collected
   operational measurements.
6. Use `GET /api/interviews/:id/events` for the event-level audit trail.

Do not publish aggregate latency or transcription-quality claims with fewer
than 30 sessions, and always report the sample size and configuration.

The offline evaluator can be smoke-tested without claiming real quality:

```powershell
npm run eval:voice:fixture
```

It writes `content/voice-benchmark.json`, which is displayed on `/lab` with a
hard `NOT_MEASURED` status because the checked-in records are synthetic.
