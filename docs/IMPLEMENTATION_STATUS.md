# Implementation status

Updated: 2026-08-30

## Complete

- polished responsive landing, interview and report surfaces;
- D1 schema, generated migration and local migration command;
- create/read/update interview APIs with atomic session-plus-prior
  initialization;
- turn, event, report and feedback APIs;
- approved 24-question Chinese bank and validator;
- two public anchors, two frozen JD-directed baselines, three posterior-adaptive
  questions, bounded verification and abstention;
- versioned per-turn checkpoints and resume endpoint;
- evidence-linked report based on persisted data;
- Python deterministic policy kernel, scorer evaluator and voice helpers with 78 passing
  tests;
- shared Python/TypeScript golden parity fixtures for posterior and utility
  signals;
- optional double-pass semantic rubric scorer with verbatim-evidence
  validation, reviewer-disagreement gating, version fingerprints, strict
  offline mode and provider-failure fallback;
- LiveKit 1.6 AgentServer worker using raw final transcripts;
- reconnect-safe LiveKit rooms, lossless committed-transcript accumulation,
  Mandarin-first TTS and mixed Chinese/English term normalization;
- transport-independent voice-turn controller with offline failure injection:
  raw-evidence preservation, short transcript, timeout, rejected response,
  409 checkpoint restore, malformed-success recovery and durable final-turn
  behavior when lifecycle completion is temporarily unavailable;
- browser microphone/room connection and short-lived token endpoint with
  explicit Agent dispatch;
- privacy-bounded voice observability for connection, final-transcript,
  checkpoint, disconnect and recovery events, with separate p50/p95 report
  metrics and end-to-end coverage;
- deterministic Chinese transcript evaluator for character error rate,
  domain-term accuracy, recovery correctness, duplicate commits and p95
  latency; synthetic fixtures are hard-gated as `NOT_MEASURED`;
- final LiveKit session-usage export with per-model token, audio-duration and
  character counts; versioned Build/Ship or Scale list-price estimation,
  optional semantic-scorer token pricing, idempotent persistence and explicit
  partial/unavailable completed-interview cost coverage;
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
- isolated `guided_demo` mode with server-generated synthetic answer options,
  a deterministic `DEMO_FIXTURE` evaluator, visible report disclaimers and a
  server-side prohibition on saving demo feedback as user-study data;
- guided-demo end-to-end proof: eight stored turns, one verification, six
  accepted fixture turns, three adaptive decisions, 8/8 policy replay and zero
  semantic-model calls;
- bounded one-criterion rubrics for verification questions;
- self-contained local API end-to-end test using a deterministic strict scorer
  for seven accepted turns and a 7/7 replay;
- frozen three-file semantic-scoring dataset protocol, strict inference runner,
  12-answer synthetic smoke fixture, grouped bootstrap, baselines,
  risk-coverage and a deliberate `NOT_READY` gate;
- formal scoring metrics use only `locked_test`; the gate requires a separate
  dev split, one frozen run/model/prompt, and perturbation-parent split
  integrity;
- successful production build;
- secret-safe local configuration doctor with all-or-none credential checks,
  URL/range validation and browser-secret detection;
- non-secret `/api/health` readiness endpoint covered by the local D1
  end-to-end test;
- one-command clean-checkout verification and GitHub Actions CI across Node,
  Python, build, local D1 and deterministic evidence regeneration;
- public-repository hygiene: Apache-2.0 license, security boundary,
  contribution rules, dependency updates and a release checklist.
- read-only public portfolio route that interactively replays
  `VERIFY -> ABSTAIN -> ACCEPT`, adaptive ranking and policy fingerprints with
  fixed synthetic data; a Worker-level showcase switch blocks operational
  APIs and redirects interview/report pages without changing the owner-only
  full deployment behavior.

## Human-dependent next steps

1. run the frozen 30-session voice protocol and publish measured latency,
   disconnect recovery, Chinese character error rate and domain-term accuracy;
2. run a 48–72 answer double-labeled scorer pilot, freeze the protocol, then
   collect 200 consented anonymous answers for the formal release gate;
3. recruit 10–20 beta users and run the blind follow-up usefulness study;
4. calibrate question difficulties from real answers;
5. add authenticated per-user history only after the core experiment is
   complete.

## Credential-dependent work

The following values are intentionally not invented or committed:

- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`

The browser token endpoint, room connection and explicit dispatch are
implemented. A developer-local LiveKit project has produced audible calls, but
formal aggregate voice-quality claims remain blocked on the 30-session
protocol. The browser remains fully usable through the text channel.

## Access boundary

The current Sites release remains owner-only. Per-user ownership and service
authentication must be added before a public beta; until then the project
should be described as a private interview demo and offline experiment system,
not a multi-tenant public service.
