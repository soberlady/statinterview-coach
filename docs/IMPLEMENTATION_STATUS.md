# Implementation status

Updated: 2026-08-01

## Complete

- polished responsive landing, interview and report surfaces;
- D1 schema, generated migration and local migration command;
- create/read/update interview APIs with atomic session-plus-prior
  initialization;
- turn, event, report and feedback APIs;
- approved 24-question Chinese bank and validator;
- fixed anchors, adaptive utility, bounded verification and abstention;
- versioned per-turn checkpoints and resume endpoint;
- evidence-linked report based on persisted data;
- Python deterministic policy kernel and scorer evaluator with 32 passing
  tests;
- shared Python/TypeScript golden parity fixtures for posterior and utility
  signals;
- optional double-pass semantic rubric scorer with verbatim-evidence
  validation, reviewer-disagreement gating, version fingerprints, strict
  offline mode and provider-failure fallback;
- LiveKit 1.6 AgentServer worker using raw final transcripts;
- browser microphone/room connection and short-lived token endpoint with
  explicit Agent dispatch;
- deterministic 4,000-candidate adaptive/fixed/random benchmark;
- in-product `/lab` experiment page with assumptions, ablation and claim
  boundary;
- deterministic policy replay from persisted turns, SHA-256 decision
  fingerprint, invariant checks and top-three candidate utility breakdowns;
- counterfactual tamper test that replaces a selected question with another
  approved question and verifies that the audit detects the mismatch;
- write-time policy guard that rejects an approved but policy-inconsistent
  question and an out-of-order turn before state mutation;
- atomic D1 turn batch covering the turn, posterior, checkpoint and Agent
  event, with end-to-end rollback and concurrent-cancel fault-injection tests;
- checkpoint-version compare-and-swap prevents a stale semantic-scoring
  response from overwriting a concurrent pause or cancel;
- client-facing interview updates restricted to matching
  complete/pause/resume/cancel state transitions; clients cannot overwrite
  posterior or checkpoint data, or reserve internal event idempotency keys;
- the interview UI writes a durable pause before exiting, automatically enters
  recovery on return, and safely completes a paused finalizing checkpoint only
  when the policy has no remaining question;
- structure-only fallback that provides feedback but cannot update ability;
- bounded one-criterion rubrics for verification questions;
- self-contained local API end-to-end test using a deterministic strict scorer
  for six accepted turns and a 6/6 replay;
- frozen three-file semantic-scoring dataset protocol, strict inference runner,
  12-answer synthetic smoke fixture, grouped bootstrap, baselines,
  risk-coverage and a deliberate `NOT_READY` gate;
- formal scoring metrics use only `locked_test`; the gate requires a separate
  dev split, one frozen run/model/prompt, and perturbation-parent split
  integrity;
- successful production build.

## Next

1. configure a real LiveKit Cloud project and record measured voice latency,
   disconnect recovery and final-transcript quality;
2. run a 48–72 answer double-labeled scorer pilot, freeze the protocol, then
   collect 200 consented anonymous answers for the formal release gate;
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

## Access boundary

The current Sites release remains owner-only. Per-user ownership and service
authentication must be added before a public beta; until then the project
should be described as a private interview demo and offline experiment system,
not a multi-tenant public service.
