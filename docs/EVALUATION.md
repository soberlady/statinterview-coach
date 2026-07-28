# Evaluation plan

The project should not claim “better interviewing” from screenshots. Each claim
maps to a measurable offline or online test.

## Current automated checks

- question-bank schema: 24 questions, four skills, one anchor per skill;
- Python policy kernel: state transitions, ability updates, selection,
  reliability and verification budget;
- web production build;
- local end-to-end API scenario: create interview, answer six turns, complete
  session, retrieve evidence report.

## Release gates

| Claim | Dataset / test | Metric | Initial gate |
| --- | --- | --- | --- |
| Rubric scoring agrees with experts | 200 anonymized answers, double labeled | weighted kappa, Spearman | κ ≥ 0.65 |
| Reliability policy detects unsafe scores | disagreement / transcript corruption set | risk-coverage curve | error falls as coverage falls |
| Adaptive questions are useful | blind expert pairwise review | preference rate | > 60% over random valid question |
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
- ability posteriors become meaningful only after calibration data and parity
  tests are complete.
