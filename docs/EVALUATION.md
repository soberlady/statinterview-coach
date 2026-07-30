# Evaluation plan

The project should not claim “better interviewing” from screenshots. Each claim
maps to a measurable offline or online test.

## Current automated checks

- question-bank schema: 24 questions, four skills, one anchor per skill;
- Python policy kernel: 20 tests covering state transitions, ability updates,
  selection, reliability, verification budget and shared golden fixtures;
- TypeScript policy: three shared golden parity fixtures for posterior update,
  uncertainty, information gain and utility signals;
- web production build;
- local end-to-end API scenario: create interview, answer six turns, complete
  session, persist a 61-point posterior, retrieve the evidence report and
  reproduce all six question decisions;
- policy audit checks: deterministic 6/6 replay, stable SHA-256 fingerprint,
  sorted candidate utilities and detection of an approved-but-counterfactual
  replacement question;
- missing-credential voice fallback: token endpoint returns an explicit 503
  while leaving text mode usable.

## Completed synthetic policy benchmark

The reproducible script is `experiments/run_policy_benchmark.py`; generated
results are checked into `content/policy-benchmark.json`.

| Strategy | Job-weighted MAE | Job-weighted RMSE | Mean selected job weight |
| --- | ---: | ---: | ---: |
| Adaptive | 0.691 | 0.863 | 0.363 |
| Fixed | 0.707 | 0.881 | 0.238 |
| Random valid | 0.704 | 0.881 | 0.250 |

With 4,000 simulated candidates, adaptive minus fixed weighted MAE was
`-0.0162`, paired 95% interval `[-0.0214, -0.0109]`, a relative reduction of
2.29%. The nominal 90% credible interval coverage was 89.8%.

Interpretation: the overall benefit comes primarily from roles with uneven
skill weights. For a balanced role the difference is small. The experiment
validates the policy under a one-parameter logistic response simulation; it
does not establish real interview validity.

## Release gates

| Claim | Dataset / test | Metric | Initial gate |
| --- | --- | --- | --- |
| Rubric scoring agrees with experts | 200 anonymized answers, double labeled | weighted kappa, Spearman | κ ≥ 0.65 |
| Reliability policy detects unsafe scores | disagreement / transcript corruption set | risk-coverage curve | error falls as coverage falls |
| Adaptive questions are useful to humans | blind expert pairwise review | preference rate | > 60% over random valid question |
| Anchors remain comparable | repeated anchor responses | score drift | monitor by question/version |
| Recovery is real | forced refresh/network interruption | resumed turn accuracy | 100% checkpoint recovery |
| Voice is usable | 30 Chinese sessions | final transcript WER, p95 turn latency | publish measured values only |
| Users find reports actionable | beta feedback + interviews | ≥4/5 share, task completion | report raw sample size |

## Required ablations

1. random valid question versus uncertainty-only selection;
2. uncertainty-only versus full utility with JD/time constraints;
3. single-pass score versus reliability verification;
4. generated summary evidence versus verbatim source evidence;
5. text input versus LiveKit voice transcription.

## Known limitations

- question difficulty is expert-authored, not psychometrically calibrated;
- current public fallback evaluator measures structure and terminology, not
  semantic correctness;
- no employment-validity claim is made;
- ability posteriors become externally meaningful only after real-answer
  calibration; current parity tests establish implementation consistency, not
  psychometric validity.
