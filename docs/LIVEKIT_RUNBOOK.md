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

## Configure

Create one LiveKit Cloud project and copy `.env.example` to `.env`. Fill:

```dotenv
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
STATINTERVIEW_API_BASE_URL=http://localhost:3000
```

The same three LiveKit values must be available to the web process that issues
tokens and to the Python worker. Never expose the API secret in browser code.

Install the voice dependencies:

```powershell
services\agent\.venv\Scripts\python.exe -m pip install -e "services\agent[voice,dev]"
```

Run the web app and worker in separate terminals:

```powershell
npm run dev
```

```powershell
services\agent\.venv\Scripts\python.exe `
  -m statinterview_agent.livekit_worker dev
```

## Acceptance checklist

- Creating a text interview still works with no LiveKit credentials.
- Missing credentials return `503 VOICE_NOT_CONFIGURED`.
- One browser click obtains microphone permission and joins a unique room.
- Exactly one Agent worker joins.
- Agent audio is audible and interruption does not create duplicate turns.
- The stored turn has `inputMode=voice` and contains the final raw transcript.
- A weak transcript triggers an approved verification question.
- After six substantive questions, the room completes and the report opens.
- Refreshing the browser restores the latest API checkpoint.
- Record p50/p95 connection time, answer-to-next-question latency and at least
  30 final-transcript comparisons before making a voice-quality claim.
