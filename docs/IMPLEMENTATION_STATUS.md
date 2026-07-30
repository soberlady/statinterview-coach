# Implementation status

Updated: 2026-07-30

## Complete

- polished responsive landing, interview and report surfaces;
- D1 schema, generated migration and local migration command;
- create/read/update interview APIs;
- turn, event, report and feedback APIs;
- approved 24-question Chinese bank and validator;
- fixed anchors, adaptive utility, bounded verification and abstention;
- versioned per-turn checkpoints and resume endpoint;
- evidence-linked report based on persisted data;
- Python deterministic policy kernel and 20 passing tests;
- shared Python/TypeScript golden parity fixtures for posterior and utility
  signals;
- optional double-pass semantic rubric scorer with verbatim-evidence
  validation, reviewer-disagreement gating and provider-failure fallback;
- LiveKit 1.6 AgentServer worker using raw final transcripts;
- browser microphone/room connection and short-lived token endpoint with
  explicit Agent dispatch;
- deterministic 4,000-candidate adaptive/fixed/random benchmark;
- public `/lab` experiment page with assumptions, ablation and claim boundary;
- deterministic policy replay from persisted turns, SHA-256 decision
  fingerprint, invariant checks and top-three candidate utility breakdowns;
- counterfactual tamper test that replaces a selected question with another
  approved question and verifies that the audit detects the mismatch;
- self-contained local API end-to-end test for six turns and a 6/6 replay;
- successful local six-turn end-to-end test using a 61-point posterior and
  production build.

## Next

1. configure a real LiveKit Cloud project and record measured voice latency,
   disconnect recovery and final-transcript quality;
2. configure a scorer provider and collect 200 double-labeled anonymous
   answers for agreement and risk-coverage measurement;
3. estimate model cost per completed interview;
4. recruit 10–20 beta users and run the blind follow-up usefulness study;
5. calibrate question difficulties from real answers;
6. add authenticated per-user history only after the core experiment is
   complete.

## Credential-dependent work

The following values are intentionally not invented or committed:

- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`

The browser token endpoint, room connection and explicit dispatch are
implemented. A real end-to-end voice call cannot be claimed until these values
are configured and the worker is running. The browser remains fully usable
through the text channel.
