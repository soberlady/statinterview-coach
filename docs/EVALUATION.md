# Evaluation plan

The project should not claim “better interviewing” from screenshots. Each claim
maps to a measurable offline or online test.

## Current automated checks

- question-bank schema: 24 questions, four skills, with two public anchors;
- Python policy kernel, scoring evaluator and voice helpers: 88 tests covering state
  transitions, ability updates, selection, reliability, verification budget,
  agreement metrics, strict dataset validation and shared golden fixtures;
- TypeScript policy: three shared golden parity fixtures for posterior update,
  uncertainty, information gain and utility signals;
- web production build;
- local end-to-end API scenario: create interview, reject an approved but
  policy-inconsistent question before persistence, score seven turns through a
  deterministic semantic-scorer stub, retrieve the evidence report and
  reproduce all seven question decisions;
- D1 batch fault injection: force the final event write to violate a unique
  key, then verify that turn, posterior and interview counters all remain
  unchanged;
- concurrent lifecycle fault injection: block semantic scoring, cancel the
  interview, release the scorer, and verify that the stale turn is rejected
  without changing the cancellation or posterior;
- pause/resume lifecycle: a paused active interview rejects turns, resumes,
  accepts the expected next answer, and a paused finalizing interview can only
  complete when the deterministic policy has no remaining question;
- guided-demo isolation: the recommended deterministic path triggers
  `VERIFY`, then `ABSTAIN`, completes six accepted fixture turns and three
  adaptive turns, replays all 8/8 decisions, makes zero scorer calls and
  rejects attempts to save demo feedback;
- policy audit checks: deterministic 7/7 replay, stable SHA-256 fingerprint,
  sorted candidate utilities and detection of an approved-but-counterfactual
  replacement question;
- missing-credential voice fallback: token endpoint returns an explicit 503
  while leaving text mode usable.
- voice observability: client events record connection, final transcript,
  checkpoint commit and recovery timings without copying raw answers; unit
  tests verify percentile aggregation and the API end-to-end scenario verifies
  persisted report metrics.
- voice-turn fault injection: a transport-independent controller proves that
  verbatim evidence crosses the API boundary, stale writes reload the
  authoritative checkpoint, malformed 2xx responses cannot falsely complete
  an interview, and a saved final answer is never requested again solely
  because lifecycle finalization timed out.
- voice-quality fixture: deterministic character error rate, domain-term,
  checkpoint, duplicate-turn and latency calculations with a synthetic-only
  `NOT_MEASURED` gate and a 30-sample consented-pilot minimum.
- inference cost telemetry: final LiveKit session usage is priced by the
  provider's actual billing unit, semantic-scorer calls use an explicit custom
  token-price profile, unknown models stay unpriced, and unit plus API
  end-to-end checks distinguish `NOT_MEASURED`, `PARTIAL`, `AVAILABLE` and
  `UNAVAILABLE` instead of reporting missing data as zero cost.
- semantic scorer fixture: 12 synthetic answers, two fixture annotations per
  answer, strict no-fallback predictions, grouped bootstrap, baselines,
  risk-coverage and a deliberate `NOT_READY` release status.
- formal scorer gate tests: dev predictions cannot affect release metrics,
  mixed run/model/prompt versions fail, and perturbation parents cannot cross
  participant groups, questions or data splits.

## Completed synthetic policy benchmark

The reproducible script is `experiments/run_policy_benchmark.py`; generated
results are checked into `content/policy-benchmark.json`.

| Strategy | Job-weighted MAE | Job-weighted RMSE | Mean selected job weight |
| --- | ---: | ---: | ---: |
| Adaptive | 0.672 | 0.841 | 0.281 |
| Fixed | 0.699 | 0.873 | 0.169 |
| Random valid | 0.688 | 0.861 | 0.240 |

With 4,000 simulated candidates, adaptive minus fixed weighted MAE was
`-0.0268`, paired 95% interval `[-0.0312, -0.0223]`, a relative reduction of
3.83%. The nominal 90% credible interval coverage was 90.0%.

Interpretation: the benefit varies by role profile and is largest for the
data-engineering profile. The experiment validates the policy under a
one-parameter logistic response simulation; it does not establish real
interview validity.

## Release gates

| Claim | Dataset / test | Metric | Initial gate |
| --- | --- | --- | --- |
| Rubric scoring agrees with experts | 200 consented, anonymized answers, blindly double labeled; ≥40 per skill | weighted kappa, Spearman, latency/tokens | κ ≥ 0.65 plus governance and telemetry checks |
| Reliability policy detects unsafe scores | disagreement / transcript corruption set | risk-coverage curve | error falls as coverage falls |
| Adaptive questions are useful to humans | blind expert pairwise review | preference rate | > 60% over random valid question |
| Anchors remain comparable | repeated anchor responses | score drift | monitor by question/version |
| Recovery is real | forced refresh/network interruption | resumed turn accuracy | 100% checkpoint recovery |
| Voice is usable | 30 Chinese sessions | character error rate, domain-term accuracy, p95 turn latency | publish measured values only |
| Users find reports actionable | beta feedback + interviews | ≥4/5 share, task completion | report raw sample size |

## Required ablations

1. random valid question versus uncertainty-only selection;
2. uncertainty-only versus full utility with JD/time constraints;
3. single-pass score versus reliability verification;
4. generated summary evidence versus verbatim source evidence;
5. text input versus LiveKit voice transcription.

## Known limitations

- question difficulty is expert-authored, not psychometrically calibrated;
- the current fallback evaluator measures structure and terminology, not
  semantic correctness, and is prohibited from changing the ability posterior;
- no employment-validity claim is made;
- ability posteriors become externally meaningful only after real-answer
  calibration; current parity tests establish implementation consistency, not
  psychometric validity.
- `DEMO_FIXTURE` posteriors are presentation fixtures and must never be mixed
  with real-user calibration or scoring-validation claims.
