"""Deterministic offline evaluation for rubric-scoring experiments."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
import hashlib
import json
import math
import random
from statistics import fmean
from typing import Any, Iterable, Mapping, Sequence


class ScoringDatasetError(ValueError):
    """Raised when an offline scoring record violates the frozen schema."""


@dataclass(frozen=True)
class ScoringSample:
    answer_id: str
    participant_group_id: str
    question_id: str
    skill: str
    split: str
    source: str
    consent_confirmed: bool
    anonymization_reviewed: bool
    blind_human_annotations: bool
    prediction_versioned: bool
    prediction_run_id: str
    prediction_model: str
    prediction_prompt_version: str
    latency_ms: float | None
    input_tokens: float | None
    output_tokens: float | None
    human_a_criteria: tuple[float, ...]
    human_b_criteria: tuple[float, ...]
    human_consensus_criteria: tuple[float, ...]
    human_a_total: float
    human_b_total: float
    human_consensus_total: float
    model_criteria: tuple[float, ...]
    model_total: float
    primary_total: float
    reliability: str
    verbatim_evidence: int
    total_evidence: int

    @property
    def absolute_error(self) -> float:
        return abs(self.model_total - self.human_consensus_total)


def evaluate_scoring_records(
    *,
    question_bank: Mapping[str, Any],
    question_bank_sha256: str,
    answers: Sequence[Mapping[str, Any]],
    annotations: Sequence[Mapping[str, Any]],
    predictions: Sequence[Mapping[str, Any]],
    bootstrap_replicates: int = 2_000,
    seed: int = 20_260_730,
) -> dict[str, Any]:
    """Validate frozen records and return deterministic aggregate metrics."""

    if bootstrap_replicates < 0:
        raise ScoringDatasetError("bootstrap_replicates must be non-negative")
    samples, provenance = _materialize_samples(
        question_bank=question_bank,
        question_bank_sha256=question_bank_sha256,
        answers=answers,
        annotations=annotations,
        predictions=predictions,
    )
    if not samples:
        raise ScoringDatasetError("the scoring dataset contains no samples")

    development_samples = [
        sample for sample in samples if sample.split == "dev"
    ]
    locked_test_samples = [
        sample for sample in samples if sample.split == "locked_test"
    ]
    model_evaluation_samples = locked_test_samples or samples
    model_metric_scope = (
        "locked_test"
        if locked_test_samples
        else "all_records_smoke_only"
    )

    human_a_totals = [sample.human_a_total for sample in samples]
    human_b_totals = [sample.human_b_total for sample in samples]
    consensus_totals = [
        sample.human_consensus_total
        for sample in model_evaluation_samples
    ]
    model_totals = [
        sample.model_total for sample in model_evaluation_samples
    ]
    primary_totals = [
        sample.primary_total for sample in model_evaluation_samples
    ]
    human_a_criteria = _flatten(
        sample.human_a_criteria for sample in samples
    )
    human_b_criteria = _flatten(
        sample.human_b_criteria for sample in samples
    )
    consensus_criteria = _flatten(
        sample.human_consensus_criteria
        for sample in model_evaluation_samples
    )
    model_criteria = _flatten(
        sample.model_criteria for sample in model_evaluation_samples
    )
    global_mean = fmean(consensus_totals)
    constant_baseline = [global_mean] * len(model_evaluation_samples)

    risk_coverage = _risk_coverage(model_evaluation_samples)
    total_evidence = sum(
        sample.total_evidence for sample in model_evaluation_samples
    )
    verbatim_evidence = sum(
        sample.verbatim_evidence for sample in model_evaluation_samples
    )
    model_kappa = quadratic_weighted_kappa(
        consensus_criteria,
        model_criteria,
    )
    human_kappa = quadratic_weighted_kappa(
        human_a_criteria,
        human_b_criteria,
    )
    model_spearman = spearman_correlation(
        consensus_totals,
        model_totals,
    )
    model_mae = mean_absolute_error(consensus_totals, model_totals)
    telemetry_samples = [
        sample
        for sample in samples
        if sample.latency_ms is not None
        and sample.input_tokens is not None
        and sample.output_tokens is not None
    ]

    bootstrap = _clustered_bootstrap(
        model_evaluation_samples,
        replicates=bootstrap_replicates,
        seed=seed,
    )
    by_skill = {
        skill: _group_metrics(group)
        for skill, group in sorted(
            _group_by(model_evaluation_samples, "skill").items()
        )
    }
    skill_counts = {
        skill: len(group)
        for skill, group in sorted(_group_by(samples, "skill").items())
    }
    split_counts = {
        split: len(group)
        for split, group in sorted(_group_by(samples, "split").items())
    }
    participant_splits: dict[str, set[str]] = defaultdict(set)
    for sample in samples:
        participant_splits[sample.participant_group_id].add(sample.split)
    run_ids = {sample.prediction_run_id for sample in samples}
    model_names = {sample.prediction_model for sample in samples}
    prompt_versions = {
        sample.prediction_prompt_version for sample in samples
    }
    provenance_ready = provenance == {"consented_beta"}
    risk_monotonic = _risk_is_monotonic(risk_coverage)
    checks = {
        "consentedRealDataset": provenance_ready,
        "sampleCountAtLeast200": len(samples) >= 200,
        "atLeast40AnswersPerSkill":
            len(skill_counts) == 4
            and all(count >= 40 for count in skill_counts.values()),
        "consentAndAnonymizationConfirmed": all(
            sample.consent_confirmed and sample.anonymization_reviewed
            for sample in samples
        ),
        "blindHumanAnnotationsDeclared": all(
            sample.blind_human_annotations for sample in samples
        ),
        "participantGroupsStayInOneSplit": all(
            len(splits) == 1 for splits in participant_splits.values()
        ),
        "hasDevelopmentAndLockedTestSplits": (
            bool(development_samples) and bool(locked_test_samples)
        ),
        "singleFrozenRun": len(run_ids) == 1,
        "singleModel": len(model_names) == 1,
        "singlePromptVersion": len(prompt_versions) == 1,
        "predictionRecordsVersioned": all(
            sample.prediction_versioned for sample in samples
        ),
        "predictionTelemetryComplete":
            len(telemetry_samples) == len(samples),
        "allAnswersDoubleLabeled": True,
        "annotationWeightedKappaAtLeast065":
            human_kappa is not None and human_kappa >= 0.65,
        "modelWeightedKappaAtLeast065":
            model_kappa is not None and model_kappa >= 0.65,
        "riskDoesNotIncreaseAsCoverageFalls": risk_monotonic,
        "allModelEvidenceVerbatim":
            total_evidence > 0 and verbatim_evidence == total_evidence,
    }
    if not provenance_ready or len(samples) < 200:
        gate_status = "NOT_READY"
    else:
        gate_status = "PASS" if all(checks.values()) else "FAIL"

    worst_cases = sorted(
        model_evaluation_samples,
        key=lambda sample: (-sample.absolute_error, sample.answer_id),
    )[:5]

    return {
        "schemaVersion": "scoring-benchmark-v1",
        "design": {
            "sampleCount": len(samples),
            "participantGroupCount": len(
                {sample.participant_group_id for sample in samples}
            ),
            "criterionJudgmentPairs": len(human_a_criteria),
            "provenance": sorted(provenance),
            "splitCounts": split_counts,
            "skillCounts": skill_counts,
            "modelMetricScope": model_metric_scope,
            "modelMetricSampleCount": len(model_evaluation_samples),
            "predictionRunIds": sorted(run_ids),
            "predictionModels": sorted(model_names),
            "predictionPromptVersions": sorted(prompt_versions),
            "questionBankSha256": question_bank_sha256,
            "bootstrapReplicates": bootstrap_replicates,
            "bootstrapSeed": seed,
        },
        "annotationAgreement": {
            "criterionQuadraticWeightedKappa": _round_optional(human_kappa),
            "totalScoreSpearman": _round_optional(
                spearman_correlation(human_a_totals, human_b_totals),
            ),
            "totalScoreMae": round(
                mean_absolute_error(human_a_totals, human_b_totals),
                4,
            ),
        },
        "developmentMetrics": (
            _model_agreement_summary(development_samples)
            if development_samples
            else None
        ),
        "modelAgreement": {
            "criterionQuadraticWeightedKappa": _round_optional(model_kappa),
            "totalScoreSpearman": _round_optional(model_spearman),
            "totalScoreMae": round(model_mae, 4),
            "severeErrorRate": round(
                fmean(
                    sample.absolute_error >= 1
                    for sample in model_evaluation_samples
                ),
                4,
            ),
            "mae95pctClusterBootstrap": bootstrap["mae"],
            "spearman95pctClusterBootstrap": bootstrap["spearman"],
        },
        "baselines": {
            "globalMean": {
                "scoreOutOfFour": round(global_mean, 4),
                "mae": round(
                    mean_absolute_error(
                        consensus_totals,
                        constant_baseline,
                    ),
                    4,
                ),
            },
            "singlePassRubric": {
                "mae": round(
                    mean_absolute_error(consensus_totals, primary_totals),
                    4,
                ),
                "spearman": _round_optional(
                    spearman_correlation(
                        consensus_totals,
                        primary_totals,
                    ),
                ),
            },
            "doublePassRubric": {
                "mae": round(model_mae, 4),
                "spearman": _round_optional(model_spearman),
            },
        },
        "riskCoverage": risk_coverage,
        "evidence": {
            "quotedSpanCount": total_evidence,
            "verbatimSpanCount": verbatim_evidence,
            "verbatimRate":
                round(verbatim_evidence / total_evidence, 4)
                if total_evidence
                else None,
        },
        "engineering": _engineering_metrics(telemetry_samples, len(samples)),
        "bySkill": by_skill,
        "largestErrors": [
            {
                "answerId": sample.answer_id,
                "questionId": sample.question_id,
                "reliability": sample.reliability,
                "consensusScore": round(sample.human_consensus_total, 4),
                "modelScore": round(sample.model_total, 4),
                "absoluteError": round(sample.absolute_error, 4),
            }
            for sample in worst_cases
        ],
        "releaseGate": {
            "status": gate_status,
            "checks": checks,
            "claimBoundary": (
                "Synthetic fixtures validate the evaluation pipeline only; "
                "a performance claim requires 200 consented, anonymized, "
                "blind double-labeled answers with at least 40 per skill."
                if not provenance_ready
                else
                "This report is an engineering agreement study, not evidence "
                "of hiring validity. Procedural consent and locked-test "
                "controls must also be independently audited."
            ),
        },
    }


def quadratic_weighted_kappa(
    left: Sequence[float],
    right: Sequence[float],
    *,
    minimum: int = 0,
    maximum: int = 4,
) -> float | None:
    """Quadratic weighted Cohen's kappa on a fixed ordinal scale."""

    if len(left) != len(right):
        raise ScoringDatasetError("kappa vectors must have equal length")
    if not left:
        return None
    categories = maximum - minimum + 1
    observed = [[0 for _ in range(categories)] for _ in range(categories)]
    rows = [0 for _ in range(categories)]
    columns = [0 for _ in range(categories)]
    for left_value, right_value in zip(left, right, strict=True):
        left_index = _ordinal(left_value, minimum, maximum) - minimum
        right_index = _ordinal(right_value, minimum, maximum) - minimum
        observed[left_index][right_index] += 1
        rows[left_index] += 1
        columns[right_index] += 1

    denominator = (categories - 1) ** 2
    observed_disagreement = 0.0
    expected_disagreement = 0.0
    sample_count = len(left)
    for row in range(categories):
        for column in range(categories):
            weight = ((row - column) ** 2) / denominator
            observed_disagreement += (
                weight * observed[row][column] / sample_count
            )
            expected_disagreement += (
                weight
                * rows[row]
                * columns[column]
                / (sample_count * sample_count)
            )
    if expected_disagreement == 0:
        return 1.0 if observed_disagreement == 0 else 0.0
    return 1 - observed_disagreement / expected_disagreement


def spearman_correlation(
    left: Sequence[float],
    right: Sequence[float],
) -> float | None:
    """Spearman correlation with average ranks for ties."""

    if len(left) != len(right):
        raise ScoringDatasetError("correlation vectors must have equal length")
    if len(left) < 2:
        return None
    return _pearson(_average_ranks(left), _average_ranks(right))


def mean_absolute_error(
    truth: Sequence[float],
    predicted: Sequence[float],
) -> float:
    if len(truth) != len(predicted) or not truth:
        raise ScoringDatasetError(
            "MAE vectors must have equal, non-zero length",
        )
    return fmean(
        abs(left - right)
        for left, right in zip(truth, predicted, strict=True)
    )


def _materialize_samples(
    *,
    question_bank: Mapping[str, Any],
    question_bank_sha256: str,
    answers: Sequence[Mapping[str, Any]],
    annotations: Sequence[Mapping[str, Any]],
    predictions: Sequence[Mapping[str, Any]],
) -> tuple[list[ScoringSample], set[str]]:
    questions = {
        _required_text(question, "id", "question"): question
        for question in _required_list(question_bank, "questions", "bank")
    }
    answer_by_id = _unique_by(answers, "answerId", "answer")
    prediction_by_id = _unique_by(predictions, "answerId", "prediction")
    annotations_by_id: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for annotation in annotations:
        _validate_schema_version(
            annotation,
            "scoring-annotation-v1",
            "annotation",
        )
        answer_id = _required_text(
            annotation,
            "answerId",
            "annotation",
        )
        annotations_by_id[answer_id].append(annotation)

    if set(answer_by_id) != set(prediction_by_id):
        raise ScoringDatasetError(
            "answers and predictions must contain identical answer ids",
        )
    if set(answer_by_id) != set(annotations_by_id):
        raise ScoringDatasetError(
            "answers and annotations must contain identical answer ids",
        )

    samples: list[ScoringSample] = []
    provenance: set[str] = set()
    for answer_id in sorted(answer_by_id):
        answer = answer_by_id[answer_id]
        prediction = prediction_by_id[answer_id]
        _validate_schema_version(
            answer,
            "scoring-answer-v1",
            answer_id,
        )
        _validate_schema_version(
            prediction,
            "scoring-prediction-v1",
            answer_id,
        )
        question_id = _required_text(answer, "questionId", answer_id)
        question = questions.get(question_id)
        if question is None:
            raise ScoringDatasetError(
                f"{answer_id}: unknown questionId {question_id}",
            )
        answer_text = _required_text(answer, "answerText", answer_id)
        expected_hash = hashlib.sha256(
            answer_text.encode("utf-8"),
        ).hexdigest()
        if answer.get("contentSha256") != expected_hash:
            raise ScoringDatasetError(
                f"{answer_id}: contentSha256 does not match answerText",
            )
        source = _required_text(answer, "source", answer_id)
        provenance.add(source)
        split = _required_text(answer, "split", answer_id)
        participant_group_id = _required_text(
            answer,
            "participantGroupId",
            answer_id,
        )
        input_mode = _required_text(answer, "inputMode", answer_id)
        if input_mode not in {"text", "voice"}:
            raise ScoringDatasetError(
                f"{answer_id}: inputMode must be text or voice",
            )
        perturbation = answer.get("perturbation")
        if not isinstance(perturbation, Mapping):
            raise ScoringDatasetError(
                f"{answer_id}: perturbation must be an object",
            )
        perturbation_type = _required_text(
            perturbation,
            "type",
            f"{answer_id}.perturbation",
        )
        parent_answer_id = perturbation.get("parentAnswerId")
        if parent_answer_id is not None and (
            not isinstance(parent_answer_id, str)
            or not parent_answer_id.strip()
        ):
            raise ScoringDatasetError(
                f"{answer_id}: perturbation parentAnswerId is invalid",
            )
        if perturbation_type == "none" and parent_answer_id is not None:
            raise ScoringDatasetError(
                f"{answer_id}: unperturbed answers cannot have a parent",
            )
        if parent_answer_id is not None:
            parent_id = parent_answer_id.strip()
            if parent_id == answer_id:
                raise ScoringDatasetError(
                    f"{answer_id}: perturbation cannot reference itself",
                )
            parent = answer_by_id.get(parent_id)
            if parent is None:
                raise ScoringDatasetError(
                    f"{answer_id}: perturbation parent does not exist",
                )
            if _required_text(
                parent,
                "participantGroupId",
                parent_id,
            ) != participant_group_id:
                raise ScoringDatasetError(
                    f"{answer_id}: perturbation parent must share the "
                    "participant group",
                )
            if _required_text(parent, "split", parent_id) != split:
                raise ScoringDatasetError(
                    f"{answer_id}: perturbation parent must share the split",
                )
            if _required_text(parent, "questionId", parent_id) != question_id:
                raise ScoringDatasetError(
                    f"{answer_id}: perturbation parent must share the question",
                )
        rubric = _required_list(question, "rubric", question_id)
        weights = tuple(
            _bounded_number(criterion.get("weight"), 0, 1, question_id)
            for criterion in rubric
        )
        if not math.isclose(sum(weights), 1, abs_tol=1e-6):
            raise ScoringDatasetError(
                f"{question_id}: rubric weights must sum to one",
            )

        labels = sorted(
            annotations_by_id[answer_id],
            key=lambda item: _required_text(
                item,
                "annotatorId",
                answer_id,
            ),
        )
        if len(labels) != 2:
            raise ScoringDatasetError(
                f"{answer_id}: exactly two blind annotations are required",
            )
        if labels[0]["annotatorId"] == labels[1]["annotatorId"]:
            raise ScoringDatasetError(
                f"{answer_id}: annotators must be distinct",
            )
        for label in labels:
            _validate_bank_hash(
                label,
                question_bank_sha256,
                answer_id,
            )
            if label.get("scorable") is not True:
                raise ScoringDatasetError(
                    f"{answer_id}: fixture contains an unscorable label",
                )
        human_a = _criterion_scores(labels[0], len(weights), answer_id)
        human_b = _criterion_scores(labels[1], len(weights), answer_id)
        blind_human_annotations = all(
            label.get("blind") is True
            and label.get("annotatorKind") == "human"
            for label in labels
        )
        consensus = tuple(
            (left + right) / 2
            for left, right in zip(human_a, human_b, strict=True)
        )

        _validate_bank_hash(
            prediction,
            question_bank_sha256,
            answer_id,
        )
        if prediction.get("evaluator") != "RUBRIC_DOUBLE_PASS":
            raise ScoringDatasetError(
                f"{answer_id}: semantic benchmark forbids fallback output",
            )
        run_id = _required_text(prediction, "runId", answer_id)
        model_name = _required_text(prediction, "model", answer_id)
        prompt_version = _required_text(
            prediction,
            "promptVersion",
            answer_id,
        )
        expected_question_fingerprint = _sha256_json(
            {
                "sourceQuestionId": question_id,
                "question": _required_text(
                    question,
                    "question",
                    question_id,
                ),
                "rubric": rubric,
            },
        )
        expected_request_fingerprint = _sha256_json(
            {
                "promptVersion": prompt_version,
                "questionFingerprint": expected_question_fingerprint,
                "answer": answer_text,
                "model": model_name,
            },
        )
        question_fingerprint = prediction.get("questionFingerprint")
        request_fingerprint = prediction.get("requestFingerprint")
        if (
            question_fingerprint is not None
            and question_fingerprint != expected_question_fingerprint
        ):
            raise ScoringDatasetError(
                f"{answer_id}: questionFingerprint does not match",
            )
        if (
            request_fingerprint is not None
            and request_fingerprint != expected_request_fingerprint
        ):
            raise ScoringDatasetError(
                f"{answer_id}: requestFingerprint does not match",
            )
        prediction_versioned = (
            question_fingerprint == expected_question_fingerprint
            and request_fingerprint == expected_request_fingerprint
        )
        model = _criterion_scores(
            prediction,
            len(weights),
            answer_id,
        )
        passes = prediction.get("passes")
        if not isinstance(passes, Mapping):
            raise ScoringDatasetError(
                f"{answer_id}: prediction passes must be an object",
            )
        primary = _criterion_scores(
            {"criteria": passes.get("primary")},
            len(weights),
            f"{answer_id}.primary",
        )
        _criterion_scores(
            {"criteria": passes.get("review")},
            len(weights),
            f"{answer_id}.review",
        )
        reliability = prediction.get("reliability")
        if reliability not in {"HIGH", "MEDIUM", "LOW"}:
            raise ScoringDatasetError(
                f"{answer_id}: invalid reliability",
            )
        action = prediction.get("action")
        if action not in {"ACCEPT", "VERIFY", "ABSTAIN"}:
            raise ScoringDatasetError(
                f"{answer_id}: invalid action",
            )
        computed_model_total = _weighted_total(model, weights)
        reported_model_total = _bounded_number(
            prediction.get("scoreOutOfFour"),
            0,
            4,
            f"{answer_id}.scoreOutOfFour",
        )
        if not math.isclose(
            computed_model_total,
            reported_model_total,
            abs_tol=1e-4,
        ):
            raise ScoringDatasetError(
                f"{answer_id}: scoreOutOfFour does not match criteria",
            )
        telemetry = prediction.get("telemetry")
        if telemetry is not None and not isinstance(telemetry, Mapping):
            raise ScoringDatasetError(
                f"{answer_id}: telemetry must be an object",
            )
        latency_ms = _optional_nonnegative_number(
            telemetry,
            "latencyMs",
            f"{answer_id}.telemetry",
        )
        input_tokens = _optional_nonnegative_number(
            telemetry,
            "inputTokens",
            f"{answer_id}.telemetry",
        )
        output_tokens = _optional_nonnegative_number(
            telemetry,
            "outputTokens",
            f"{answer_id}.telemetry",
        )
        total_evidence, verbatim_evidence = _evidence_counts(
            prediction,
            answer_text,
            len(weights),
            answer_id,
        )

        samples.append(
            ScoringSample(
                answer_id=answer_id,
                participant_group_id=participant_group_id,
                question_id=question_id,
                skill=_required_text(question, "skill", question_id),
                split=split,
                source=source,
                consent_confirmed=answer.get("consentConfirmed") is True,
                anonymization_reviewed=(
                    answer.get("anonymizationReviewed") is True
                ),
                blind_human_annotations=blind_human_annotations,
                prediction_versioned=prediction_versioned,
                prediction_run_id=run_id,
                prediction_model=model_name,
                prediction_prompt_version=prompt_version,
                latency_ms=latency_ms,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                human_a_criteria=human_a,
                human_b_criteria=human_b,
                human_consensus_criteria=consensus,
                human_a_total=_weighted_total(human_a, weights),
                human_b_total=_weighted_total(human_b, weights),
                human_consensus_total=_weighted_total(
                    consensus,
                    weights,
                ),
                model_criteria=model,
                model_total=computed_model_total,
                primary_total=_weighted_total(primary, weights),
                reliability=reliability,
                verbatim_evidence=verbatim_evidence,
                total_evidence=total_evidence,
            ),
        )
    return samples, provenance


def _criterion_scores(
    record: Mapping[str, Any],
    expected_count: int,
    context: str,
) -> tuple[float, ...]:
    raw = record.get("criteria")
    if not isinstance(raw, list) or len(raw) != expected_count:
        raise ScoringDatasetError(
            f"{context}: criteria count does not match the question rubric",
        )
    ordered = sorted(raw, key=lambda item: item.get("criterionIndex", -1))
    scores: list[float] = []
    for index, criterion in enumerate(ordered):
        if not isinstance(criterion, Mapping):
            raise ScoringDatasetError(
                f"{context}: criterion must be an object",
            )
        if criterion.get("criterionIndex") != index:
            raise ScoringDatasetError(
                f"{context}: criterion indexes must be continuous",
            )
        scores.append(
            _bounded_number(
                criterion.get("score"),
                0,
                4,
                f"{context}.criteria[{index}]",
            ),
        )
    return tuple(scores)


def _evidence_counts(
    prediction: Mapping[str, Any],
    answer_text: str,
    expected_count: int,
    context: str,
) -> tuple[int, int]:
    criteria = prediction.get("criteria")
    if not isinstance(criteria, list) or len(criteria) != expected_count:
        raise ScoringDatasetError(f"{context}: invalid prediction criteria")
    total = 0
    verbatim = 0
    for criterion in criteria:
        evidence = criterion.get("evidence", [])
        if not isinstance(evidence, list) or any(
            not isinstance(quote, str) for quote in evidence
        ):
            raise ScoringDatasetError(
                f"{context}: evidence must be a string array",
            )
        for quote in evidence:
            total += 1
            if quote and quote in answer_text:
                verbatim += 1
    return total, verbatim


def _risk_coverage(samples: Sequence[ScoringSample]) -> list[dict[str, Any]]:
    tiers = (
        ("HIGH", {"HIGH"}),
        ("HIGH_MEDIUM", {"HIGH", "MEDIUM"}),
        ("ALL", {"HIGH", "MEDIUM", "LOW"}),
    )
    result: list[dict[str, Any]] = []
    for label, accepted in tiers:
        selected = [
            sample
            for sample in samples
            if sample.reliability in accepted
        ]
        if selected:
            mae = fmean(sample.absolute_error for sample in selected)
            severe = fmean(
                sample.absolute_error >= 1 for sample in selected
            )
        else:
            mae = None
            severe = None
        result.append(
            {
                "threshold": label,
                "accepted": len(selected),
                "coverage": round(len(selected) / len(samples), 4),
                "mae": _round_optional(mae),
                "severeErrorRate": _round_optional(severe),
            },
        )
    return result


def _engineering_metrics(
    samples: Sequence[ScoringSample],
    total_count: int,
) -> dict[str, Any]:
    if not samples:
        return {
            "recordsWithTelemetry": 0,
            "telemetryCoverage": 0.0,
            "latencyMsP50": None,
            "latencyMsP95": None,
            "meanInputTokens": None,
            "meanOutputTokens": None,
        }
    latencies = sorted(
        float(sample.latency_ms)
        for sample in samples
        if sample.latency_ms is not None
    )
    input_tokens = [
        float(sample.input_tokens)
        for sample in samples
        if sample.input_tokens is not None
    ]
    output_tokens = [
        float(sample.output_tokens)
        for sample in samples
        if sample.output_tokens is not None
    ]
    return {
        "recordsWithTelemetry": len(samples),
        "telemetryCoverage": round(len(samples) / total_count, 4),
        "latencyMsP50": round(_quantile(latencies, 0.5), 4),
        "latencyMsP95": round(_quantile(latencies, 0.95), 4),
        "meanInputTokens": round(fmean(input_tokens), 4),
        "meanOutputTokens": round(fmean(output_tokens), 4),
    }


def _risk_is_monotonic(points: Sequence[Mapping[str, Any]]) -> bool:
    risks = [point["mae"] for point in points]
    if any(risk is None for risk in risks):
        return False
    return all(
        left <= right + 1e-9
        for left, right in zip(risks, risks[1:])
    )


def _clustered_bootstrap(
    samples: Sequence[ScoringSample],
    *,
    replicates: int,
    seed: int,
) -> dict[str, list[float] | None]:
    if replicates == 0:
        return {"mae": None, "spearman": None}
    groups = _group_by(samples, "participant_group_id")
    group_ids = sorted(groups)
    if len(group_ids) < 2:
        return {"mae": None, "spearman": None}
    rng = random.Random(seed)
    maes: list[float] = []
    correlations: list[float] = []
    for _ in range(replicates):
        draw = [rng.choice(group_ids) for _ in group_ids]
        resampled = [
            sample
            for group_id in draw
            for sample in groups[group_id]
        ]
        truth = [
            sample.human_consensus_total for sample in resampled
        ]
        model = [sample.model_total for sample in resampled]
        maes.append(mean_absolute_error(truth, model))
        correlation = spearman_correlation(truth, model)
        if correlation is not None:
            correlations.append(correlation)
    return {
        "mae": _interval(maes),
        "spearman": _interval(correlations),
    }


def _group_metrics(samples: Sequence[ScoringSample]) -> dict[str, Any]:
    truth = [sample.human_consensus_total for sample in samples]
    model = [sample.model_total for sample in samples]
    return {
        "sampleCount": len(samples),
        "mae": round(mean_absolute_error(truth, model), 4),
        "spearman": _round_optional(spearman_correlation(truth, model)),
    }


def _model_agreement_summary(
    samples: Sequence[ScoringSample],
) -> dict[str, Any]:
    consensus_criteria = _flatten(
        sample.human_consensus_criteria for sample in samples
    )
    model_criteria = _flatten(sample.model_criteria for sample in samples)
    truth = [sample.human_consensus_total for sample in samples]
    predicted = [sample.model_total for sample in samples]
    return {
        "sampleCount": len(samples),
        "criterionQuadraticWeightedKappa": _round_optional(
            quadratic_weighted_kappa(consensus_criteria, model_criteria),
        ),
        "totalScoreSpearman": _round_optional(
            spearman_correlation(truth, predicted),
        ),
        "totalScoreMae": round(mean_absolute_error(truth, predicted), 4),
    }


def _weighted_total(
    scores: Sequence[float],
    weights: Sequence[float],
) -> float:
    return sum(
        score * weight
        for score, weight in zip(scores, weights, strict=True)
    )


def _ordinal(value: float, minimum: int, maximum: int) -> int:
    return min(maximum, max(minimum, math.floor(value + 0.5)))


def _average_ranks(values: Sequence[float]) -> list[float]:
    ordered = sorted(enumerate(values), key=lambda item: item[1])
    ranks = [0.0] * len(values)
    cursor = 0
    while cursor < len(ordered):
        end = cursor + 1
        while end < len(ordered) and ordered[end][1] == ordered[cursor][1]:
            end += 1
        average_rank = (cursor + 1 + end) / 2
        for index in range(cursor, end):
            ranks[ordered[index][0]] = average_rank
        cursor = end
    return ranks


def _pearson(left: Sequence[float], right: Sequence[float]) -> float | None:
    left_mean = fmean(left)
    right_mean = fmean(right)
    numerator = sum(
        (left_value - left_mean) * (right_value - right_mean)
        for left_value, right_value in zip(left, right, strict=True)
    )
    left_scale = math.sqrt(
        sum((value - left_mean) ** 2 for value in left),
    )
    right_scale = math.sqrt(
        sum((value - right_mean) ** 2 for value in right),
    )
    if left_scale == 0 or right_scale == 0:
        return None
    return numerator / (left_scale * right_scale)


def _interval(values: Sequence[float]) -> list[float] | None:
    if not values:
        return None
    ordered = sorted(values)
    return [
        round(_quantile(ordered, 0.025), 4),
        round(_quantile(ordered, 0.975), 4),
    ]


def _quantile(ordered: Sequence[float], probability: float) -> float:
    position = (len(ordered) - 1) * probability
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    fraction = position - lower
    return ordered[lower] * (1 - fraction) + ordered[upper] * fraction


def _validate_schema_version(
    record: Mapping[str, Any],
    expected: str,
    context: str,
) -> None:
    if record.get("schemaVersion") != expected:
        raise ScoringDatasetError(
            f"{context}: schemaVersion must be {expected}",
        )


def _sha256_json(value: Mapping[str, Any]) -> str:
    serialized = json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _unique_by(
    records: Sequence[Mapping[str, Any]],
    key: str,
    label: str,
) -> dict[str, Mapping[str, Any]]:
    result: dict[str, Mapping[str, Any]] = {}
    for record in records:
        value = _required_text(record, key, label)
        if value in result:
            raise ScoringDatasetError(
                f"duplicate {label} key: {value}",
            )
        result[value] = record
    return result


def _required_text(
    record: Mapping[str, Any],
    key: str,
    context: str,
) -> str:
    value = record.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ScoringDatasetError(f"{context}: {key} must be non-empty text")
    return value.strip()


def _required_list(
    record: Mapping[str, Any],
    key: str,
    context: str,
) -> list[Any]:
    value = record.get(key)
    if not isinstance(value, list):
        raise ScoringDatasetError(f"{context}: {key} must be an array")
    return value


def _bounded_number(
    value: Any,
    minimum: float,
    maximum: float,
    context: str,
) -> float:
    if (
        not isinstance(value, (int, float))
        or isinstance(value, bool)
        or not math.isfinite(value)
        or value < minimum
        or value > maximum
    ):
        raise ScoringDatasetError(
            f"{context}: score must be between {minimum} and {maximum}",
        )
    return float(value)


def _optional_nonnegative_number(
    record: Mapping[str, Any] | None,
    key: str,
    context: str,
) -> float | None:
    if record is None or record.get(key) is None:
        return None
    value = record.get(key)
    if (
        not isinstance(value, (int, float))
        or isinstance(value, bool)
        or not math.isfinite(value)
        or value < 0
    ):
        raise ScoringDatasetError(
            f"{context}: {key} must be a non-negative number",
        )
    return float(value)


def _validate_bank_hash(
    record: Mapping[str, Any],
    expected: str,
    context: str,
) -> None:
    if record.get("questionBankSha256") != expected:
        raise ScoringDatasetError(
            f"{context}: questionBankSha256 does not match",
        )


def _group_by(
    samples: Sequence[ScoringSample],
    attribute: str,
) -> dict[str, list[ScoringSample]]:
    groups: dict[str, list[ScoringSample]] = defaultdict(list)
    for sample in samples:
        groups[getattr(sample, attribute)].append(sample)
    return groups


def _flatten(values: Iterable[Iterable[float]]) -> list[float]:
    return [value for group in values for value in group]


def _round_optional(value: float | None) -> float | None:
    return None if value is None else round(value, 4)
