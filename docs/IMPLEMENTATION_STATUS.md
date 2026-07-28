# Implementation status

Updated: 2026-07-28

## Complete

- polished responsive landing, interview and report surfaces;
- D1 schema, generated migration and local migration command;
- create/read/update interview APIs;
- turn, event, report and feedback APIs;
- approved 24-question Chinese bank and validator;
- fixed anchors, adaptive utility, bounded verification and abstention;
- versioned per-turn checkpoints and resume endpoint;
- evidence-linked report based on persisted data;
- Python deterministic policy kernel and tests;
- LiveKit 1.6 AgentServer worker scaffold using raw final transcripts;
- successful local six-turn end-to-end test and production build.

## Next

1. add rubric-semantic evaluator with double-pass structured output;
2. add Python/TypeScript golden parity fixtures;
3. connect the browser to a LiveKit room and implement a server-side token
   endpoint after credentials are provided;
4. capture latency, token and cost metrics from model calls;
5. recruit 10–20 beta users and run the evaluation protocol;
6. add authenticated per-user history and cross-session ability memory.

## Credential-dependent work

The following values are intentionally not invented or committed:

- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`

The browser remains fully usable through the text channel until these are
configured.
