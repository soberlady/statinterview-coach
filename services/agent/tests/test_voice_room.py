import pytest

from statinterview_agent.voice_room import (
    resolve_interview_id,
    resolve_voice_session_id,
)


def test_dispatch_metadata_is_the_source_of_truth() -> None:
    assert (
        resolve_interview_id(
            "statinterview--wrong--voice-session",
            job_metadata='{"interviewId":"int_expected"}',
        )
        == "int_expected"
    )


@pytest.mark.parametrize(
    ("room_name", "expected"),
    [
        ("statinterview--int_legacy", "int_legacy"),
        (
            "statinterview--int_reconnect--voice-session",
            "int_reconnect",
        ),
    ],
)
def test_room_name_remains_a_compatible_fallback(
    room_name: str,
    expected: str,
) -> None:
    assert resolve_interview_id(room_name) == expected


def test_configured_console_interview_takes_precedence() -> None:
    assert (
        resolve_interview_id(
            "console-room",
            configured_interview_id=" int_console ",
        )
        == "int_console"
    )


def test_invalid_room_without_metadata_is_rejected() -> None:
    with pytest.raises(RuntimeError):
        resolve_interview_id("unrelated-room", job_metadata="not-json")


def test_resolves_voice_session_suffix() -> None:
    assert (
        resolve_voice_session_id(
            "statinterview--int_123--voice_456", job_id="job_789"
        )
        == "voice_456"
    )


def test_voice_session_falls_back_to_job_id() -> None:
    assert (
        resolve_voice_session_id(
            "statinterview--int_123", job_id="job_789"
        )
        == "job_789"
    )
