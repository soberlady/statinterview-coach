# Offline experiment results

Updated: 2026-08-30

## Question

With the same seven-question budget, can the Agent estimate abilities that matter
to a target role more accurately than a fixed or random valid question
sequence?

## Design

- Two public anchors: statistics reasoning and business analysis.
- Two JD-directed baseline questions: the two highest-weight skill dimensions,
  frozen before answers can affect routing.
- Three remaining questions:
  - adaptive: expected information gain + JD relevance + coverage + difficulty
    match − time cost;
  - fixed: the same three valid follow-ups;
  - random: three valid non-anchor questions.
- Candidate routing is held at the intermediate band with preferred bank
  difficulty 3, so this benchmark isolates policy allocation rather than
  background classification.
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
| Adaptive | 0.6725 | 0.8412 | 90.02% |
| Fixed | 0.6993 | 0.8731 | 90.07% |
| Random valid | 0.6880 | 0.8612 | 89.66% |

Adaptive versus fixed weighted MAE:

- absolute paired difference: `-0.02679`;
- paired 95% interval: `[-0.03124, -0.02233]`;
- relative change: `-3.83%`.

The growth-analytics profile had the smallest difference. The clearest
improvement occurred for data-engineering analysis, where the adaptive phase
allocated more evidence to the most job-relevant dimension without allowing
three consecutive questions from that dimension.

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
> reduced job-weighted ability MAE by 3.83% versus a fixed sequence under the
> same seven-question budget. The gain was concentrated in job profiles with
> uneven skill weights.

## What may not be claimed

- that the Agent predicts hiring outcomes;
- that real candidates improve by 3.83%;
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
