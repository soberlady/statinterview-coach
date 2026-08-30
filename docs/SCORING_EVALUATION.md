# Semantic scorer evaluation protocol

Updated: 2026-08-01

## Status

The evaluation pipeline is implemented, but the semantic scorer release gate is
`NOT_READY`. The checked-in 12-answer dataset is synthetic and exists only to
prove that validation, aggregation, grouped bootstrap and failure reporting are
reproducible. It is not model-performance evidence.

The first real-data milestone is a 48–72 answer pilot. The formal release gate
remains 200 consented, anonymized, double-labeled answers.

## Frozen records

The study uses three append-only JSONL surfaces:

1. `scoring-answer-v1`
   - randomized answer and participant-group ids;
   - approved question id and raw answer text;
   - input mode, split, provenance and perturbation type;
   - for real data, explicit `consentConfirmed` and
     `anonymizationReviewed` flags;
   - SHA-256 of the answer text.
2. `scoring-annotation-v1`
   - one blind annotator id;
   - for the formal gate, `blind: true` and `annotatorKind: "human"`;
   - question-bank SHA-256;
   - one 0–4 score for every rubric criterion;
   - optional evidence spans and adjudication notes.
3. `scoring-prediction-v1`
   - run, model and prompt versions;
   - question-bank, question and request fingerprints;
   - primary, review and combined criterion scores;
   - verbatim evidence, reliability, action and telemetry.

Every answer must have exactly two annotations with distinct annotator ids.
Formal real-data records must additionally declare that both annotators were
human and blind. Annotators score criteria only; the evaluator calculates
weighted totals from the versioned question bank. A missing criterion,
duplicate id, stale question-bank hash, wrong request fingerprint or fallback
evaluator fails the run instead of being silently repaired. Missing formal
governance metadata or a non-verbatim model quote makes the release gate fail;
it is never silently repaired.

Real answers and raw provider outputs belong under the ignored
`evaluation/scoring/private` and `evaluation/scoring/predictions` directories.
Do not commit them without explicit participant consent. Only synthetic
fixtures, dataset manifests, hashes and aggregate reports belong in GitHub.

## Metrics

Label quality is checked before model quality:

- criterion-level quadratic weighted Cohen's kappa;
- total-score Spearman correlation and MAE between annotators.

Model agreement is then reported against the mean criterion-level human
consensus:

- criterion-level quadratic weighted kappa;
- total-score Spearman correlation and MAE;
- severe error rate, defined as absolute total-score error at least 1 point;
- participant-grouped bootstrap 95% intervals;
- per-skill error slices;
- largest named failure cases.

Development metrics are reported separately. Release kappa, MAE,
risk-coverage, bootstrap intervals, skill slices and largest errors are
calculated only from `locked_test`; dev records can never improve a release
decision. One aggregate report must contain exactly one run id, model and
prompt version.

The report also records telemetry coverage, p50/p95 scorer latency and mean
input/output tokens. A formal gate requires complete telemetry. Monetary cost
must be calculated from the frozen provider price sheet used for that run;
token counts are not silently converted with a mutable current price.

Reliability is evaluated at three coverage points: `HIGH`, `HIGH+MEDIUM` and
all predictions. The release check requires error not to increase when coverage
falls. A global-mean baseline, the primary rubric pass and the combined
double-pass prediction are evaluated on the same answers.

## Synthetic smoke result

The deterministic fixture currently produces:

| Check | Fixture result |
| --- | ---: |
| Answers / participant groups | 12 / 6 |
| Fixture-annotation criterion weighted kappa | 0.9065 |
| Model criterion weighted kappa | 0.7690 |
| Model total-score MAE | 0.4417 |
| Verbatim evidence rate | 100% |
| Release status | `NOT_READY` |

These numbers are deliberately shaped test data. They may be used to explain
the metric implementation, not to claim scorer accuracy.

## Reproduce the smoke report

```powershell
npm run eval:scorer:fixture
```

The command validates all three fixture files and regenerates
`content/scoring-benchmark.json` with a fixed seed.

## Run strict provider inference

Configure the three `STATINTERVIEW_SCORER_*` values from `.env.example`, then
run:

```powershell
npm run eval:scorer:predict -- `
  --answers evaluation/scoring/private/answers.v1.jsonl `
  --output evaluation/scoring/predictions/pilot-v1.jsonl `
  --run-id pilot-v1
```

The inference runner calls the strict scorer path. Missing credentials,
provider failures, schema errors or a fallback result stop the run.

Generate an aggregate report with:

```powershell
node scripts/run-python.mjs experiments/evaluate_scoring_benchmark.py `
  --answers evaluation/scoring/private/answers.v1.jsonl `
  --annotations evaluation/scoring/private/annotations.v1.jsonl `
  --predictions evaluation/scoring/predictions/pilot-v1.jsonl `
  --output evaluation/scoring/private/pilot-v1-report.json
```

## Pilot and release protocol

1. Recruit participants with explicit training-study consent.
2. Remove names, employers, contacts and other identifiers before scoring.
3. Assign participant-group ids before the dev/test split so one person's
   answers never cross splits.
4. Collect 48–72 pilot answers across all four skills; use them to fix the
   annotation guide and thresholds only.
5. Freeze the question-bank hash, prompt version, adjudication rule and metric
   code.
6. Expand to at least 200 double-labeled answers, with at least 40 per skill.
7. Tune on dev. Run the locked test split once.
8. Publish sample size, intervals, failure cases and cost, including negative
   results.

The minimum model-agreement gate is criterion weighted kappa at least 0.65.
Passing that threshold does not establish hiring validity.

The evaluator enforces record versions, answer hashes, exact question-bank
hashes, recomputed request fingerprints when supplied, per-skill counts,
participant split isolation, explicit consent/anonymization declarations,
blind-human annotation declarations, evidence verbatimness, complete
latency/token telemetry, a single frozen run/model/prompt and the quantitative
thresholds. When a perturbation declares a parent, the evaluator requires that
parent to exist and share its participant group, question and split. Consent
collection, anonymization quality, annotator identity, the applicable provider
price sheet and the “locked test is run once” rule also require a procedural
audit; a JSON flag alone cannot prove those real-world facts.
