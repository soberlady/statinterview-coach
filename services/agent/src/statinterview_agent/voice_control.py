"""Question-bound controls, shared by browser RPC and automatic turn handling."""

from typing import Any


def matches_question(runtime: Any, payload: dict[str, Any]) -> bool:
    sequence = payload.get("sequenceNumber")
    return (
        type(sequence) is int
        and sequence == runtime.sequence_number
        and runtime.current_question is not None
        and payload.get("questionId") == runtime.current_question.get("id")
    )


def question_snapshot(runtime: Any) -> dict[str, Any]:
    return {
        "sequenceNumber": runtime.sequence_number,
        "questionId": (runtime.current_question or {}).get("id"),
    }
