# LiveKit runbook

## What is implemented

- The browser requests a short-lived participant token from
  `/api/interviews/:id/voice-token`.
- The token is scoped to a unique room and explicitly dispatches the
  `statinterview-coach` Agent.
- The browser publishes microphone audio and subscribes to Agent audio.
- The Python worker captures LiveKit's final raw transcript and submits it to
  the normal interview API with `inputMode=voice`.
- The deterministic API—not the conversational LLM—selects the next approved
  question and applies verification/abstention.
- When the final turn completes, the worker marks the interview complete.
- Every fresh room resolves the authoritative API checkpoint, so re-entry does
  not assume question one.
- The browser records privacy-bounded connection, transcript-to-checkpoint and
  recovery timing events; the report keeps them separate from scorer latency.
- Job shutdown flushes LiveKit's cumulative per-model usage and writes one
  idempotent cost snapshot for the report.

## Configure

Use the project's existing local environment configuration (see
[development setup](../CONTRIBUTING.md)); the web process and Python worker
must receive the same LiveKit values. Fill only private environment files:

```dotenv
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
STATINTERVIEW_API_BASE_URL=http://localhost:3000
STATINTERVIEW_LIVEKIT_PRICING_PLAN=build_ship
```

The same three LiveKit values must be available to the web process that issues
tokens and to the Python worker. Never expose the API secret in browser code.

Create the dedicated environment as described in the development setup, then
install the pinned production voice dependencies and test tools from the repository root:

```powershell
services\agent\.venv\Scripts\python.exe -m pip install -e "./services/agent[dev]" -r services/agent/requirements.txt
```

Run the web app and worker in separate terminals:

```powershell
npm run dev
```

```powershell
services\agent\.venv\Scripts\python.exe `
  -m statinterview_agent.livekit_worker dev
```

## Control and recovery contract

Manual finish is participant-authorized and bound to the current question and
sequence; automatic and manual submission share a runtime lock. Stale controls
cannot submit the next question, and repeated in-flight controls return BUSY.
Repeat-question speaks the approved current question without saving an answer.
This runtime lock does not deduplicate calls across workers or rooms.

The worker flushes final STT and waits for transcript stability before submission.
On a lost response or malformed success, it reads the authoritative checkpoint
before deciding whether to retry; unconfirmed transcripts remain available.
A durable final answer is not requested again solely because completion failed.
Question-bound status messages contain phase information, not raw transcripts.
Timeouts and stability windows are defined in the current worker/controller;
dated iteration records are not configuration sources.

Voice readiness preloads the SDK without acquiring the microphone or starting
an Agent. After the audio track arrives, the browser checks the webpage question
against Agent state before enabling the microphone. The events distinguish room
connection, track arrival, question validation and microphone enablement; these
boundaries enable measurement but do not establish a measured speedup.

## Acceptance checklist

- Creating a text interview still works with no LiveKit credentials.
- Missing credentials return `503 VOICE_NOT_CONFIGURED`.
- One browser click obtains microphone permission and joins a unique room.
- Exactly one Agent worker joins.
- Agent audio is audible and interruption does not create duplicate turns.
- The stored turn has `inputMode=voice` and contains the final raw transcript.
- A weak transcript triggers an approved verification question.
- After seven substantive questions (plus any bounded verification), the room completes and the report opens.
- Refreshing the browser restores the latest API checkpoint.
- Leaving voice mode saves one `voice.usage` event; the report shows a
  versioned price, or clearly marks any unknown model as unpriced.
- `services/agent` tests pass the complete offline voice-turn failure matrix;
  no cloud credentials are needed for those checks.
- Record p50/p95 connection time, answer-to-next-question latency and at least
  30 final-transcript comparisons before making a voice-quality claim.

The exact measurement definitions, 30-session sampling plan and initial
engineering targets are frozen in `docs/VOICE_EVALUATION.md`.
The list-price scope and scorer-price variables are defined in
`docs/COST_OBSERVABILITY.md`.
