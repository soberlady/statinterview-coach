"""Room identity helpers shared by the LiveKit transport and tests."""

from __future__ import annotations

import json


def resolve_interview_id(
    room_name: str,
    *,
    job_metadata: str = "",
    configured_interview_id: str = "",
) -> str:
    """Resolve the persistent interview behind an ephemeral voice room."""

    configured = configured_interview_id.strip()
    if configured:
        return configured

    if job_metadata.strip():
        try:
            metadata = json.loads(job_metadata)
        except (json.JSONDecodeError, TypeError):
            metadata = None
        if isinstance(metadata, dict):
            interview_id = metadata.get("interviewId")
            if isinstance(interview_id, str) and interview_id.strip():
                return interview_id.strip()

    prefix = "statinterview--"
    if room_name.startswith(prefix) and len(room_name) > len(prefix):
        interview_id, _, _voice_session_id = room_name[len(prefix) :].partition(
            "--"
        )
        if interview_id:
            return interview_id

    raise RuntimeError(
        "Room name must be statinterview--<interview_id>"
        "[--<voice_session_id>], or the dispatch metadata must include "
        "interviewId."
    )


def resolve_voice_session_id(room_name: str, *, job_id: str) -> str:
    """Return the browser session id, with the LiveKit job as a fallback."""

    prefix = "statinterview--"
    if room_name.startswith(prefix):
        _interview_id, separator, voice_session_id = room_name[
            len(prefix) :
        ].partition("--")
        if separator and voice_session_id.strip():
            return voice_session_id.strip()
    return job_id.strip() or room_name
