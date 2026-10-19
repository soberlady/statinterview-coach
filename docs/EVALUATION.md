# Evaluation and evidence boundaries

Reviewed 2026-10-19. Engineering correctness, synthetic policy behavior and human
validity are separate claims. This document changes no experiment or gate.

## Verified engineering baseline

[CI for code baseline 17368d4](https://github.com/soberlady/statinterview-coach/actions/runs/39247270245)
passed on Ubuntu / Node 22.13 / Python 3.11. Final counts were 107 Python tests
after voice extras, 30 engineering JavaScript tests and 132 TypeScript tests.
The initial kernel-only run had 106 passes and one optional-runtime skip; the
later voice run had no skips. These counts are dated execution evidence, not a
coverage percentage or a promise that future versions keep identical counts.

| Contract | Executable evidence |
| --- | --- |
| Current 48-main / 97-follow-up bank and frozen legacy versions | `npm run validate:content`, question-bank version tests |
| Types, toolchain and rendered output | `npm run lint`, `npm run typecheck`, production build and engineering JS tests |
| Evidence gating and raw transcript repair | rubric-evaluator tests: missing quotes, grounded incorrect answers, numeric/negation/semantic changes and provider fallback |
| API resource boundary | HTTP tests and actual streamed oversized request returning 413 in local E2E |
| Policy and report interpretation | policy, report-insights and demo tests; legacy/JD verification association and transfer evidence |
| Transaction and concurrency safety | D1 unique-event fault rolls back the whole batch; cancellation during scoring rejects the stale write |
| Recovery | saved-answer replay, paused/finalizing state, draft refresh, lost response, final completion failure and browser training recovery |
| Voice controller | raw transcripts, participant/question-bound controls, malformed success, checkpoint restore and late-response recovery |
| Dependency safety | npm gate plus complete installed Python audit, including test/build/voice tools; explicit handling of skipped source package |

`npm run verify` runs the code gate, local D1/browser E2E and artifact regeneration.
The [workflow](../.github/workflows/ci.yml) separately installs production voice
dependencies, checks imports and compatibility, audits Python and reruns its
tests. Frozen evidence must leave no diff. [Development setup](../CONTRIBUTING.md)
documents prerequisites; audits require network access. No paid model call is
required for these regressions.

## Evidence sources

| Evidence | Current result | What it can establish |
| --- | --- | --- |
| [Agent trace](../content/agent-demo.json) | 8/8 replay, 3 adaptive decisions; legal-question substitution detected | Production TS policy behavior with fixture scores |
| [Frozen v2 policy benchmark](EXPERIMENT_RESULTS.md) | 4,000 simulated candidates, seven-question budget; weighted MAE 0.672 adaptive vs 0.699 fixed, relative reduction 3.83%; paired difference 95% interval [-0.0312, -0.0223] | Behavior under the stated Rasch assumptions and original 24-question bank |
| [Current coaching-v3 regression](../content/coaching-benchmark.json) | 12 injected-score scenarios; budget and 7/7 replay per scenario | Routing sensitivity, not MAE or learning gains |
| [Scorer protocol](SCORING_EVALUATION.md) | 12 synthetic answers; release gate NOT_READY | Metric/data-validation pipeline, not model accuracy or expert agreement |
| [Voice protocol](VOICE_EVALUATION.md) | 6 synthetic samples; NOT_MEASURED | Evaluation calculations, not actual audio quality |
| [Cost protocol](COST_OBSERVABILITY.md) | Distinguishes measured, partial and unpriced data | Reported usage accounting boundaries, not a complete provider bill |

## Uncompleted human gates

- Scoring: independent double-labeled 48–72 answer pilot, then 200 consented,
  anonymized answers under the existing frozen split/run protocol. The formal
  gate uses locked_test only and the existing κ ≥0.65 plus governance/telemetry checks.
- Voice: the existing 30-session protocol, with raw sample sizes, failures,
  character error rate, technical-term accuracy, checkpoint recovery and latency percentiles.
- Usefulness: blind follow-up preference (>60% over a random valid question is
  the planned gate), report comprehension and task completion; not yet measured.
- Training: separate guided practice from unhinted transfer; record attrition
  and negative cases before making learning claims.

The protocols retain their existing ablations: random/uncertainty/full utility,
single/double-pass scoring with reliability, generated versus verbatim evidence,
and text versus voice. No result here changes those frozen rules.

## Limits

Question difficulties are authored rather than calibrated from people. Shared
Python/TS fixtures check mathematics and utility signals, not full policy
equivalence; the Python utility golden test evaluates the formula rather than
the complete selector. SHA-256 replay fingerprints do not validate semantic
scoring or prevent an administrator rewriting evidence. Unique stored turns
do not eliminate duplicate in-flight scorer calls. Synthetic observations,
one successful voice session or one transfer score do not establish hiring
validity, production reliability or lasting learning improvement.

Outstanding work is consolidated in the [roadmap](NEXT_STEPS_ZH.md), with
separate [release checks](RELEASE_CHECKLIST.md) and [security scope](../SECURITY.md).
