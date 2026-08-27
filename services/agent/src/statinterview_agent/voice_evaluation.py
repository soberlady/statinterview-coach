"""Deterministic offline evaluation for consented Mandarin transcripts."""

from __future__ import annotations

import hashlib
import json
import math
import unicodedata
from collections.abc import Mapping, Sequence
from typing import Any


VOICE_THRESHOLDS = {
    "minimumSamples": 30,
    "maximumCharacterErrorRate": 0.15,
    "minimumDomainTermAccuracy": 0.90,
    "minimumCheckpointRestoreRate": 1.0,
    "maximumConnectionP95Ms": 4_000,
    "maximumTranscriptToCommitP95Ms": 5_000,
    "maximumDuplicateCommittedTurns": 0,
}


def normalize_transcript(text: str) -> str:
    """Normalize Chinese and Latin text for character-level comparison."""

    normalized = unicodedata.normalize("NFKC", text).casefold()
    return "".join(character for character in normalized if character.isalnum())


def character_error_count(reference: str, hypothesis: str) -> int:
    """Return Levenshtein edits after transcript normalization."""

    left = normalize_transcript(reference)
    right = normalize_transcript(hypothesis)
    if not left:
        raise ValueError("reference transcript is empty after normalization")
    previous = list(range(len(right) + 1))
    for left_index, left_character in enumerate(left, start=1):
        current = [left_index]
        for right_index, right_character in enumerate(right, start=1):
            substitution = previous[right_index - 1] + (
                left_character != right_character
            )
            current.append(
                min(
                    previous[right_index] + 1,
                    current[right_index - 1] + 1,
                    substitution,
                )
            )
        previous = current
    return previous[-1]


def evaluate_voice_samples(
    records: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """Evaluate one frozen synthetic fixture or consented pilot dataset."""

    if not records:
        raise ValueError("voice evaluation requires at least one sample")

    sample_ids: set[str] = set()
    dataset_kinds: set[str] = set()
    sample_metrics: list[dict[str, Any]] = []
    total_reference_characters = 0
    total_edits = 0
    total_keyterms = 0
    matched_keyterms = 0
    exact_matches = 0
    restored_checkpoints = 0
    duplicate_committed_turns = 0
    connection_latencies: list[int] = []
    transcript_to_commit_latencies: list[int] = []

    for index, record in enumerate(records, start=1):
        context = f"sample {index}"
        sample_id = _required_text(record, "sampleId", context)
        if sample_id in sample_ids:
            raise ValueError(f"duplicate sampleId: {sample_id}")
        sample_ids.add(sample_id)

        dataset_kind = _required_text(record, "datasetKind", sample_id)
        if dataset_kind not in {"synthetic_fixture", "consented_pilot"}:
            raise ValueError(
                f"{sample_id}: datasetKind must be synthetic_fixture or consented_pilot"
            )
        dataset_kinds.add(dataset_kind)

        reference = _required_text(record, "referenceText", sample_id)
        hypothesis = _required_text(record, "hypothesisText", sample_id)
        normalized_reference = normalize_transcript(reference)
        normalized_hypothesis = normalize_transcript(hypothesis)
        if not normalized_reference:
            raise ValueError(f"{sample_id}: referenceText normalizes to empty")
        edits = character_error_count(reference, hypothesis)
        reference_characters = len(normalized_reference)
        total_edits += edits
        total_reference_characters += reference_characters
        if normalized_reference == normalized_hypothesis:
            exact_matches += 1

        keyterms = _required_text_list(record, "keyterms", sample_id)
        sample_keyterm_matches = 0
        for keyterm in keyterms:
            normalized_keyterm = normalize_transcript(keyterm)
            if not normalized_keyterm:
                raise ValueError(f"{sample_id}: keyterm normalizes to empty")
            if normalized_keyterm not in normalized_reference:
                raise ValueError(
                    f"{sample_id}: keyterm is absent from referenceText: {keyterm}"
                )
            total_keyterms += 1
            if normalized_keyterm in normalized_hypothesis:
                matched_keyterms += 1
                sample_keyterm_matches += 1

        checkpoint_restored = _required_bool(
            record, "checkpointRestored", sample_id
        )
        if checkpoint_restored:
            restored_checkpoints += 1
        sample_duplicates = _required_integer(
            record,
            "duplicateCommittedTurns",
            sample_id,
            minimum=0,
        )
        duplicate_committed_turns += sample_duplicates
        connection_latency = _required_integer(
            record, "connectionLatencyMs", sample_id, minimum=0
        )
        transcript_latency = _required_integer(
            record,
            "transcriptToCommitLatencyMs",
            sample_id,
            minimum=0,
        )
        connection_latencies.append(connection_latency)
        transcript_to_commit_latencies.append(transcript_latency)

        sample_metrics.append(
            {
                "sampleId": sample_id,
                "referenceCharacters": reference_characters,
                "characterEdits": edits,
                "characterErrorRate": _round(edits / reference_characters),
                "keyterms": len(keyterms),
                "matchedKeyterms": sample_keyterm_matches,
                "checkpointRestored": checkpoint_restored,
                "duplicateCommittedTurns": sample_duplicates,
            }
        )

    if len(dataset_kinds) != 1:
        raise ValueError("one evaluation run cannot mix dataset kinds")
    dataset_kind = next(iter(dataset_kinds))
    sample_count = len(records)
    character_error_rate = total_edits / total_reference_characters
    domain_term_accuracy = (
        matched_keyterms / total_keyterms if total_keyterms else 1.0
    )
    checkpoint_restore_rate = restored_checkpoints / sample_count
    connection_p95 = _percentile(connection_latencies, 0.95)
    transcript_p95 = _percentile(transcript_to_commit_latencies, 0.95)

    gate_checks = {
        "sampleCount": sample_count >= VOICE_THRESHOLDS["minimumSamples"],
        "characterErrorRate": character_error_rate
        <= VOICE_THRESHOLDS["maximumCharacterErrorRate"],
        "domainTermAccuracy": domain_term_accuracy
        >= VOICE_THRESHOLDS["minimumDomainTermAccuracy"],
        "checkpointRestoreRate": checkpoint_restore_rate
        >= VOICE_THRESHOLDS["minimumCheckpointRestoreRate"],
        "connectionP95Ms": connection_p95
        <= VOICE_THRESHOLDS["maximumConnectionP95Ms"],
        "transcriptToCommitP95Ms": transcript_p95
        <= VOICE_THRESHOLDS["maximumTranscriptToCommitP95Ms"],
        "duplicateCommittedTurns": duplicate_committed_turns
        <= VOICE_THRESHOLDS["maximumDuplicateCommittedTurns"],
    }
    if dataset_kind == "synthetic_fixture":
        gate_status = "NOT_MEASURED"
    elif sample_count < VOICE_THRESHOLDS["minimumSamples"]:
        gate_status = "NOT_READY"
    else:
        gate_status = "PASS" if all(gate_checks.values()) else "FAIL"

    canonical_records = json.dumps(
        list(records),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return {
        "schemaVersion": "voice-benchmark-v1",
        "dataset": {
            "kind": dataset_kind,
            "sampleCount": sample_count,
            "sha256": hashlib.sha256(canonical_records.encode()).hexdigest(),
        },
        "metrics": {
            "referenceCharacters": total_reference_characters,
            "characterEdits": total_edits,
            "characterErrorRate": _round(character_error_rate),
            "exactMatchRate": _round(exact_matches / sample_count),
            "domainTerms": total_keyterms,
            "matchedDomainTerms": matched_keyterms,
            "domainTermAccuracy": _round(domain_term_accuracy),
            "checkpointRestoreRate": _round(checkpoint_restore_rate),
            "connectionP95Ms": connection_p95,
            "transcriptToCommitP95Ms": transcript_p95,
            "duplicateCommittedTurns": duplicate_committed_turns,
        },
        "releaseGate": {
            "status": gate_status,
            "thresholds": VOICE_THRESHOLDS,
            "checks": gate_checks,
            "claimBoundary": (
                "Synthetic fixtures validate the evaluation code only; "
                "they are not measured voice quality."
                if dataset_kind == "synthetic_fixture"
                else "Pilot metrics apply only to the frozen consented dataset and configuration."
            ),
        },
        "samples": sample_metrics,
    }


def _required_text(
    record: Mapping[str, Any], key: str, context: str
) -> str:
    value = record.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{context}: {key} must be non-empty text")
    return value.strip()


def _required_text_list(
    record: Mapping[str, Any], key: str, context: str
) -> list[str]:
    value = record.get(key)
    if not isinstance(value, list):
        raise ValueError(f"{context}: {key} must be a list")
    result = []
    for item in value:
        if not isinstance(item, str) or not item.strip():
            raise ValueError(f"{context}: {key} contains invalid text")
        result.append(item.strip())
    return result


def _required_bool(
    record: Mapping[str, Any], key: str, context: str
) -> bool:
    value = record.get(key)
    if not isinstance(value, bool):
        raise ValueError(f"{context}: {key} must be boolean")
    return value


def _required_integer(
    record: Mapping[str, Any],
    key: str,
    context: str,
    *,
    minimum: int,
) -> int:
    value = record.get(key)
    if not isinstance(value, int) or isinstance(value, bool) or value < minimum:
        raise ValueError(f"{context}: {key} must be an integer >= {minimum}")
    return value


def _percentile(values: Sequence[int], quantile: float) -> int:
    if not values:
        raise ValueError("percentile requires at least one value")
    sorted_values = sorted(values)
    if len(sorted_values) == 1:
        return sorted_values[0]
    position = (len(sorted_values) - 1) * quantile
    lower_index = math.floor(position)
    upper_index = math.ceil(position)
    lower = sorted_values[lower_index]
    upper = sorted_values[upper_index]
    return round(lower + (upper - lower) * (position - lower_index))


def _round(value: float, precision: int = 4) -> float:
    return round(value, precision)
