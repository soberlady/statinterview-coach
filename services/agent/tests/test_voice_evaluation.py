import pytest

from statinterview_agent.voice_evaluation import (
    character_error_count,
    evaluate_voice_samples,
    normalize_transcript,
)


def test_normalization_preserves_chinese_and_normalizes_mixed_terms() -> None:
    assert normalize_transcript(" A/B 测试，SQL！ ") == "ab测试sql"


def test_character_error_count_uses_normalized_characters() -> None:
    assert character_error_count("SQL 窗口函数", "SQL 窗口函") == 1


def test_synthetic_fixture_can_never_open_the_release_gate() -> None:
    report = evaluate_voice_samples([sample("synthetic_fixture")])

    assert report["releaseGate"]["status"] == "NOT_MEASURED"
    assert report["metrics"]["characterErrorRate"] == 0
    assert report["metrics"]["domainTermAccuracy"] == 1


def test_small_consented_pilot_remains_not_ready() -> None:
    report = evaluate_voice_samples([sample("consented_pilot")])

    assert report["releaseGate"]["status"] == "NOT_READY"
    assert report["releaseGate"]["checks"]["sampleCount"] is False


def test_rejects_keyterms_not_present_in_reference() -> None:
    record = sample("synthetic_fixture")
    record["keyterms"] = ["FDR"]

    with pytest.raises(ValueError, match="absent from referenceText"):
        evaluate_voice_samples([record])


def sample(dataset_kind: str) -> dict[str, object]:
    return {
        "sampleId": f"sample-{dataset_kind}",
        "datasetKind": dataset_kind,
        "referenceText": "SQL 窗口函数",
        "hypothesisText": "SQL 窗口函数",
        "keyterms": ["SQL"],
        "checkpointRestored": True,
        "duplicateCommittedTurns": 0,
        "connectionLatencyMs": 1_000,
        "transcriptToCommitLatencyMs": 1_500,
    }
