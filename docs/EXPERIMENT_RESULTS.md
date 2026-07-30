# Offline experiment results

Updated: 2026-07-30

## Question

With the same six-question budget, can the Agent estimate abilities that matter
to a target role more accurately than a fixed or random valid question
sequence?

## Design

- Four fixed anchors: one for each ability dimension.
- Two remaining questions:
  - adaptive: expected information gain + JD relevance + coverage − time cost;
  - fixed: the same two medium-difficulty questions for every role;
  - random: two valid non-anchor questions.
- Four role profiles: balanced, growth analytics, experiment analysis and data
  engineering.
- 1,000 simulated candidates per profile, 4,000 total.
- Candidate ability is drawn from a clipped standard normal distribution.
- Potential responses use a one-parameter logistic Rasch model.
- All strategies share the same candidate abilities and deterministic
  question-level potential responses.
- Seed: `20260730`.

## Results

| Strategy | Weighted MAE | Weighted RMSE | 90% interval coverage |
| --- | ---: | ---: | ---: |
| Adaptive | 0.6906 | 0.8626 | 89.77% |
| Fixed | 0.7067 | 0.8808 | 89.71% |
| Random valid | 0.7043 | 0.8813 | 89.78% |

Adaptive versus fixed weighted MAE:

- absolute paired difference: `-0.01618`;
- paired 95% interval: `[-0.02144, -0.01092]`;
- relative change: `-2.29%`.

The balanced profile had little difference. The clearest improvement occurred
for data-engineering analysis, where the adaptive policy allocated both
follow-ups to the most job-relevant dimension.

## Reliability fault injection

The second experiment injects a detected final-transcript inversion. An
always-accept baseline updates ability using the corrupted response. The
guarded policy asks one approved verification and abstains when the evidence
conflicts.

| Policy | Mean absolute deviation from oracle | Unsafe update rate |
| --- | ---: | ---: |
| Always accept | 0.8142 | 100% |
| Verify / abstain | 0.4071 | 0% |

This is a policy-response test after corruption has been detected. It does not
measure the detection model's recall or precision.

## What may be claimed

> In a deterministic 4,000-candidate Rasch simulation, the full adaptive policy
> reduced job-weighted ability MAE by 2.29% versus a fixed sequence under the
> same six-question budget. The gain was concentrated in job profiles with
> uneven skill weights.

## What may not be claimed

- that the Agent predicts hiring outcomes;
- that real candidates improve by 2.29%;
- that authored question difficulties are calibrated;
- that detected-transcript fault results measure real detection recall;
- that synthetic results replace a labeled human-answer study.

## Reproduce

```powershell
services\agent\.venv\Scripts\python.exe `
  experiments\run_policy_benchmark.py `
  --candidates-per-profile 1000 `
  --fault-samples 4000 `
  --seed 20260730
```
