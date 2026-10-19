# Implementation status

Reviewed against code baseline `17368d4`, 2026-10-19. This is a source/verification inventory, not a deployment announcement.

## Implemented

| Area | Current behavior | Reference |
| --- | --- | --- |
| Decision policy | coaching-v3, 48 main questions / 97 verification questions, 2+2+3 substantive budget and bounded verification | [Architecture](ARCHITECTURE.md) |
| Scoring | Two rubric passes, per-pass evidence gates, raw-answer repair baseline; structure-only fallback cannot update ability | [Report design](REPORT_REFINEMENT_ZH.md) |
| Persistence | D1 batch, checkpoint CAS, frozen question-bank versions, saved-answer replay and recoverable completion | [Architecture](ARCHITECTURE.md) |
| Training | Persisted two-practice / one-unhinted-transfer plan with exclusions and separate interpretation | [Report design](REPORT_REFINEMENT_ZH.md) |
| Voice | LiveKit worker, raw final transcripts, question-bound controls, checkpoint recovery and observability | [Runbook](LIVEKIT_RUNBOOK.md) |
| Audit/demo | Production policy with synthetic scores, replay, candidate rankings and reproducibility fingerprint | [Code guide](PROJECT_GUIDE_ZH.md) |
| Verification | Types, build, unit/integration/browser tests, frozen evidence regeneration, npm/Python security gates | [Evaluation](EVALUATION.md) |

## Verified code baseline

[CI for 17368d4](https://github.com/soberlady/statinterview-coach/actions/runs/39247270245) passed on Ubuntu 24.04.5 / Python 3.11.17 / Node 22.13.0: 30 engineering JavaScript tests, 132 TypeScript tests and 107 Python tests after production voice dependencies were installed. The earlier kernel-only pass had 106 passing and one optional test skipped; the final voice pass had no skips. Python audit checked 96 packages, excluding only this editable source package.

The same workflow exercised local D1/browser recovery and regenerated frozen artifacts without a diff. This does not measure real audio, model accuracy or user learning. See [dependency risk](DEPENDENCY_UPGRADE_ZH.md) for the existing npm exception and Python locking limits.

## Not yet established

- Expert-calibrated question difficulty and human-labeled scorer validity (`NOT_READY`).
- Formal 30-session voice-quality measurements (`NOT_MEASURED`).
- Long-term learning gains, blind usefulness results or hiring validity.
- Cross-instance in-flight scoring-call deduplication; saved-turn uniqueness is narrower.
- Multi-user ownership, public-beta authorization and complete retention/deletion rules.
- Full Python/TypeScript session-policy equivalence.

The full data-bearing system remains owner-only; public showcase mode is synthetic/read-only. Current next steps live in the [validation roadmap](NEXT_STEPS_ZH.md), with separate [release gates](RELEASE_CHECKLIST.md). Historical changes are indexed in [archive](archive/README.md).
