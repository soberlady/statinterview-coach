from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from statinterview_agent import (
    ScoringDatasetError,
    evaluate_scoring_records,
    quadratic_weighted_kappa,
    spearman_correlation,
)


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
FIXTURES = REPOSITORY_ROOT / "tests" / "fixtures" / "scoring-evaluation"


def test_synthetic_fixture_runs_the_complete_evaluation_pipeline() -> None:
    inputs = load_fixture_inputs()
    first = evaluate_scoring_records(**inputs, bootstrap_replicates=100)
    second = evaluate_scoring_records(**inputs, bootstrap_replicates=100)

    assert first == second
    assert first["design"]["sampleCount"] == 12
    assert first["design"]["participantGroupCount"] == 6
    assert (
        first["annotationAgreement"][
            "criterionQuadraticWeightedKappa"
        ]
        > 0.9
    )
    assert first["evidence"]["verbatimRate"] == 1
    assert first["engineering"]["telemetryCoverage"] == 0
    assert first["releaseGate"]["status"] == "NOT_READY"
    assert (
        first["releaseGate"]["checks"]["consentedRealDataset"]
        is False
    )
    assert (
        first["releaseGate"]["checks"]["predictionRecordsVersioned"]
        is False
    )
    assert (
        first["releaseGate"]["checks"][
            "riskDoesNotIncreaseAsCoverageFalls"
        ]
        is True
    )


def test_semantic_benchmark_rejects_fallback_predictions() -> None:
    inputs = load_fixture_inputs()
    predictions = json.loads(json.dumps(inputs["predictions"]))
    predictions[0]["evaluator"] = "STRUCTURE_HEURISTIC"

    with pytest.raises(ScoringDatasetError, match="forbids fallback"):
        evaluate_scoring_records(
            **{**inputs, "predictions": predictions},
            bootstrap_replicates=0,
        )


def test_release_gate_requires_explicit_data_governance_metadata() -> None:
    inputs = expand_as_formal_dataset(load_fixture_inputs(), copies=17)

    result = evaluate_scoring_records(
        **inputs,
        bootstrap_replicates=0,
    )

    assert result["design"]["sampleCount"] == 204
    assert result["releaseGate"]["status"] == "FAIL"
    assert (
        result["releaseGate"]["checks"][
            "consentAndAnonymizationConfirmed"
        ]
        is False
    )
    assert (
        result["releaseGate"]["checks"][
            "blindHumanAnnotationsDeclared"
        ]
        is False
    )


def test_formal_release_uses_only_one_frozen_locked_test_run() -> None:
    inputs = make_passing_formal_dataset()

    result = evaluate_scoring_records(
        **inputs,
        bootstrap_replicates=0,
    )

    assert result["releaseGate"]["status"] == "PASS"
    assert result["design"]["modelMetricScope"] == "locked_test"
    assert result["design"]["splitCounts"] == {
        "dev": 60,
        "locked_test": 144,
    }
    assert result["modelAgreement"]["totalScoreMae"] == pytest.approx(
        0.4417,
    )
    assert result["developmentMetrics"]["sampleCount"] == 60


def test_development_predictions_cannot_improve_release_metrics() -> None:
    inputs = make_passing_formal_dataset()
    baseline = evaluate_scoring_records(
        **inputs,
        bootstrap_replicates=0,
    )
    answers_by_id = {
        answer["answerId"]: answer for answer in inputs["answers"]
    }
    for prediction in inputs["predictions"]:
        if answers_by_id[prediction["answerId"]]["split"] != "dev":
            continue
        for criterion in prediction["criteria"]:
            criterion["score"] = 0
        prediction["scoreOutOfFour"] = 0

    changed = evaluate_scoring_records(
        **inputs,
        bootstrap_replicates=0,
    )

    assert changed["modelAgreement"] == baseline["modelAgreement"]
    assert changed["developmentMetrics"] != baseline["developmentMetrics"]


@pytest.mark.parametrize(
    ("field", "value", "check"),
    [
        ("runId", "second-run", "singleFrozenRun"),
        ("model", "second-model", "singleModel"),
        ("promptVersion", "second-prompt", "singlePromptVersion"),
    ],
)
def test_formal_gate_rejects_mixed_prediction_versions(
    field: str,
    value: str,
    check: str,
) -> None:
    inputs = make_passing_formal_dataset()
    prediction = inputs["predictions"][0]
    prediction[field] = value
    if field in {"model", "promptVersion"}:
        answer = next(
            record
            for record in inputs["answers"]
            if record["answerId"] == prediction["answerId"]
        )
        prediction["requestFingerprint"] = sha256_json(
            {
                "promptVersion": prediction["promptVersion"],
                "questionFingerprint": prediction["questionFingerprint"],
                "answer": answer["answerText"],
                "model": prediction["model"],
            },
        )

    result = evaluate_scoring_records(
        **inputs,
        bootstrap_replicates=0,
    )

    assert result["releaseGate"]["status"] == "FAIL"
    assert result["releaseGate"]["checks"][check] is False


def test_perturbation_parent_cannot_cross_splits() -> None:
    inputs = make_passing_formal_dataset()
    dev_answer = next(
        answer for answer in inputs["answers"] if answer["split"] == "dev"
    )
    locked_answer = next(
        answer
        for answer in inputs["answers"]
        if answer["split"] == "locked_test"
        and answer["questionId"] == dev_answer["questionId"]
    )
    locked_answer["participantGroupId"] = dev_answer["participantGroupId"]
    locked_answer["perturbation"] = {
        "type": "paraphrase",
        "parentAnswerId": dev_answer["answerId"],
    }

    with pytest.raises(ScoringDatasetError, match="share the split"):
        evaluate_scoring_records(
            **inputs,
            bootstrap_replicates=0,
        )


def test_frozen_schema_version_is_enforced() -> None:
    inputs = load_fixture_inputs()
    inputs["answers"][0]["schemaVersion"] = "scoring-answer-v0"

    with pytest.raises(ScoringDatasetError, match="schemaVersion"):
        evaluate_scoring_records(
            **inputs,
            bootstrap_replicates=0,
        )


def test_incorrect_prediction_fingerprint_is_rejected() -> None:
    inputs = load_fixture_inputs()
    inputs["predictions"][0]["questionFingerprint"] = "0" * 64

    with pytest.raises(
        ScoringDatasetError,
        match="questionFingerprint does not match",
    ):
        evaluate_scoring_records(
            **inputs,
            bootstrap_replicates=0,
        )


def test_core_agreement_metrics_handle_ties_and_reverse_order() -> None:
    scores = [0, 1, 2, 3, 4]

    assert quadratic_weighted_kappa(scores, scores) == pytest.approx(1)
    assert spearman_correlation(scores, scores) == pytest.approx(1)
    assert spearman_correlation(scores, list(reversed(scores))) == pytest.approx(
        -1,
    )


def load_fixture_inputs() -> dict:
    bank_path = REPOSITORY_ROOT / "content" / "question-bank.json"
    bank_bytes = bank_path.read_bytes()
    return {
        "question_bank": json.loads(bank_bytes),
        "question_bank_sha256": hashlib.sha256(bank_bytes).hexdigest(),
        "answers": read_jsonl(FIXTURES / "answers.v1.jsonl"),
        "annotations": read_jsonl(FIXTURES / "annotations.v1.jsonl"),
        "predictions": read_jsonl(FIXTURES / "predictions.v1.jsonl"),
    }


def read_jsonl(path: Path) -> list[dict]:
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def expand_as_formal_dataset(inputs: dict, *, copies: int) -> dict:
    expanded = {
        **inputs,
        "answers": [],
        "annotations": [],
        "predictions": [],
    }
    for copy_index in range(copies):
        suffix = f"copy_{copy_index:02d}"
        for answer in inputs["answers"]:
            cloned_answer = json.loads(json.dumps(answer))
            original_id = cloned_answer["answerId"]
            cloned_id = f"{original_id}_{suffix}"
            cloned_answer.update(
                {
                    "answerId": cloned_id,
                    "participantGroupId": f"{cloned_id}_participant",
                    "source": "consented_beta",
                    "split": "locked_test",
                },
            )
            expanded["answers"].append(cloned_answer)

            for annotation in inputs["annotations"]:
                if annotation["answerId"] != original_id:
                    continue
                cloned_annotation = json.loads(json.dumps(annotation))
                cloned_annotation["answerId"] = cloned_id
                expanded["annotations"].append(cloned_annotation)

            prediction = next(
                record
                for record in inputs["predictions"]
                if record["answerId"] == original_id
            )
            cloned_prediction = json.loads(json.dumps(prediction))
            cloned_prediction["answerId"] = cloned_id
            expanded["predictions"].append(cloned_prediction)
    return expanded


def make_passing_formal_dataset() -> dict:
    inputs = expand_as_formal_dataset(load_fixture_inputs(), copies=17)
    answers_by_id = {}
    for answer in inputs["answers"]:
        copy_index = int(answer["answerId"].rsplit("copy_", 1)[1])
        answer.update(
            {
                "split": "dev" if copy_index < 5 else "locked_test",
                "consentConfirmed": True,
                "anonymizationReviewed": True,
            },
        )
        answers_by_id[answer["answerId"]] = answer

    for annotation in inputs["annotations"]:
        annotation.update({"blind": True, "annotatorKind": "human"})

    questions_by_id = {
        question["id"]: question
        for question in inputs["question_bank"]["questions"]
    }
    for prediction in inputs["predictions"]:
        answer = answers_by_id[prediction["answerId"]]
        question = questions_by_id[answer["questionId"]]
        question_fingerprint = sha256_json(
            {
                "sourceQuestionId": question["id"],
                "question": question["question"],
                "rubric": question["rubric"],
            },
        )
        prediction.update(
            {
                "questionFingerprint": question_fingerprint,
                "requestFingerprint": sha256_json(
                    {
                        "promptVersion": prediction["promptVersion"],
                        "questionFingerprint": question_fingerprint,
                        "answer": answer["answerText"],
                        "model": prediction["model"],
                    },
                ),
                "telemetry": {
                    "latencyMs": 750,
                    "inputTokens": 900,
                    "outputTokens": 220,
                },
            },
        )
    return inputs


def sha256_json(value: dict) -> str:
    serialized = json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()
