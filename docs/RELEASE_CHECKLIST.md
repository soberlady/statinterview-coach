# Release checklist

This separates work that code can prove automatically from claims that require
people or real sessions. A green build does not turn synthetic evidence into a
user-study result.

## Machine gate

Run `npm run verify` from a clean checkout. The gate must pass all of the
following:

- configuration shape and browser-secret preflight;
- 24-question bank validation;
- lint and production build;
- Python policy, scoring, cost, transcript and voice-turn tests;
- TypeScript policy parity, telemetry, replay and guided-demo tests;
- local D1 end-to-end flow, including `/api/health`, rollback, stale-checkpoint
  recovery, pause/resume and policy tamper detection;
- deterministic regeneration of policy, scorer and voice evidence artifacts.

GitHub Actions runs the same gate on every push and pull request and verifies
that generation leaves the repository unchanged.

## Private demo gate

- LiveKit, scorer and API values pass `npm run doctor`.
- `/api/health` reports database, question bank and policy as ready.
- One text guided demo reaches the report and replays every decision.
- One credential-dependent voice smoke test is performed after deployment.
- No real candidate data is used in the demo account.

## Public portfolio demo gate

- Set `STATINTERVIEW_PUBLIC_SHOWCASE=1` in the public Sites deployment.
- Confirm `/` redirects to `/showcase`.
- Confirm `/api/interviews` and `/api/interviews/:id/voice-token` return
  `403 PUBLIC_SHOWCASE_READ_ONLY`.
- Confirm `/showcase` uses only fixed synthetic browser state and writes no
  interview, transcript or feedback records.
- Keep the full data-bearing deployment owner-only.

## Public beta gate — not complete

- Add authenticated per-user ownership to every interview, turn, event,
  feedback, report and voice-token operation.
- Complete the frozen 30-session voice protocol.
- Complete the 48–72-answer double-labeled scoring pilot, then the 200-answer
  locked evaluation.
- Complete the 10–20-user blind usefulness study.
- Publish negative cases, sample sizes and confidence intervals.
- Define retention/deletion behavior and obtain participant consent.

Until every public-beta item is complete, describe the deployed system as an
owner-only interview demo and offline experiment system—not a production
multi-user product or validated hiring predictor.
