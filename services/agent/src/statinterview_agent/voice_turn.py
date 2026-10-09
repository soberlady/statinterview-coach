"""Testable voice-turn controller separated from LiveKit and HTTP clients."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Mapping, Protocol

from .voice_speech import prepare_interview_question_for_speech
from .voice_terms import answer_contains_english_fragment, extract_question_keyterms
from .voice_transcript import prepare_transcript_for_scoring


class TranscriptBuffer(Protocol):
    @property
    def text(self) -> str: ...

    def clear(self) -> None: ...

    @property
    def confidence(self) -> float | None: ...

    @property
    def revision(self) -> int: ...


class VoiceTurnRuntime(Protocol):
    interview_id: str
    sequence_number: int
    current_question: dict[str, Any] | None
    transcript_buffer: TranscriptBuffer


@dataclass(frozen=True)
class VoiceApiResponse:
    status_code: int
    body: Mapping[str, Any]


class VoiceTurnTransportError(RuntimeError):
    """A safe boundary for HTTP transport or malformed-response failures."""


PostTurn = Callable[[dict[str, Any]], Awaitable[VoiceApiResponse]]
LoadAuthoritativeState = Callable[[], Awaitable[Mapping[str, Any]]]
CompleteInterview = Callable[[], Awaitable[None]]


async def wait_for_transcript_stability(
    runtime: VoiceTurnRuntime,
    *,
    quiet_seconds: float,
    max_wait_seconds: float = 45.0,
    poll_seconds: float = 0.1,
) -> bool:
    """Wait until no committed transcript fragment arrives for a quiet period.

    LiveKit may finalize several conversation items during one long spoken
    answer. Submitting on the first item can clear half an answer and assign
    its continuation to the next question. The monotonic buffer revision lets
    the tool reset its quiet timer whenever another item arrives.
    """

    quiet_seconds = max(0.0, quiet_seconds)
    max_wait_seconds = max(0.0, max_wait_seconds)
    poll_seconds = max(0.01, min(poll_seconds, max(quiet_seconds, 0.01)))
    loop = asyncio.get_running_loop()
    started_at = loop.time()
    # The model may already have spent several seconds deciding to submit.
    # Count that existing quiet period instead of starting another full wait.
    last_transcript_at = getattr(runtime, "last_transcript_at", None)
    last_speech_at = getattr(runtime, "last_speech_at", None)
    observed_times = [value for value in (last_transcript_at, last_speech_at) if isinstance(value, (int, float))]
    stable_since = min(started_at, max(observed_times)) if observed_times else started_at
    revision = runtime.transcript_buffer.revision

    while True:
        now = loop.time()
        # A final transcript can lag behind speech or remain unchanged during
        # a thinking pause. Never treat a quiet transcript as a silent speaker.
        speaking = getattr(runtime, "user_speaking", False)
        speech_at = getattr(runtime, "last_speech_at", None)
        if speaking:
            stable_since = now
        elif isinstance(speech_at, (int, float)):
            stable_since = max(stable_since, min(now, speech_at))
        if not speaking and now - stable_since >= quiet_seconds:
            return True
        if now - started_at >= max_wait_seconds:
            return False
        await asyncio.sleep(
            max(0.001, min(poll_seconds, max_wait_seconds - (now - started_at)))
        )
        current_revision = runtime.transcript_buffer.revision
        if current_revision != revision:
            revision = current_revision
            stable_since = loop.time()


async def process_voice_answer(
    runtime: VoiceTurnRuntime,
    *,
    post_turn: PostTurn,
    load_authoritative_state: LoadAuthoritativeState,
    complete_interview: CompleteInterview,
) -> dict[str, Any]:
    """Commit one raw transcript and return a safe instruction for the LLM.

    All evidence and policy decisions cross explicit boundaries: the caller
    provides the verbatim committed transcript and the API provides the next
    approved question. Transport details never appear in the returned speech
    instruction.
    """

    transcript = runtime.transcript_buffer.text
    transcript_confidence = runtime.transcript_buffer.confidence
    question = runtime.current_question
    if not question:
        runtime.transcript_buffer.clear()
        return {
            "status": "COMPLETE",
            "instruction": "诊断已完成，请查看网页报告。",
        }

    if len(transcript) < 10:
        runtime.transcript_buffer.clear()
        return _repeat_result("TRANSCRIPT_TOO_SHORT")

    question_text = str(question.get("text", ""))
    minimum_confidence = float(
        getattr(runtime, "minimum_transcript_confidence", 0.72)
    )
    retries = int(getattr(runtime, "low_confidence_retries", 0))
    if (
        transcript_confidence is not None
        and transcript_confidence < minimum_confidence
        and extract_question_keyterms(question_text)
        and answer_contains_english_fragment(transcript)
        and retries < 1
    ):
        setattr(runtime, "low_confidence_retries", retries + 1)
        runtime.transcript_buffer.clear()
        return {
            "status": "REPEAT_CURRENT_ANSWER",
            "reason": "ENGLISH_TERM_LOW_CONFIDENCE",
            "instruction": (
                "不要猜测候选人说了哪个术语。请说："
                "我没有听清其中的英文词组，请把英文词组逐个字母说一遍，"
                "再把包含它的这一句重说一次。"
            ),
        }

    payload = {
        "sequenceNumber": runtime.sequence_number,
        "questionId": question["id"],
        "answerText": transcript,
        "inputMode": "voice",
    }
    if transcript_confidence is not None:
        payload["transcriptConfidence"] = transcript_confidence
    scoring_hint = prepare_transcript_for_scoring(
        transcript, question_text
    )
    if scoring_hint != transcript:
        payload["transcriptScoringHint"] = scoring_hint
    try:
        response = await post_turn(payload)
    except VoiceTurnTransportError:
        return await recover_pending_answer(runtime, load_authoritative_state, "TURN_TRANSPORT_FAILED")

    if response.status_code == 409:
        return await recover_pending_answer(runtime, load_authoritative_state, "RESYNC_FAILED")

    if response.status_code >= 400:
        return _pending_result("TURN_REJECTED")

    result = response.body
    try:
        _apply_authoritative_state(runtime, result)
    except ValueError:
        # A 2xx response with a malformed body is ambiguous: the turn may be
        # durable. Reload the checkpoint instead of blindly submitting the
        # same evidence again or falsely declaring completion.
        return await recover_pending_answer(runtime, load_authoritative_state, "RESPONSE_RESYNC_FAILED")

    runtime.transcript_buffer.clear()
    setattr(runtime, "low_confidence_retries", 0)

    if runtime.current_question is None:
        completion_sync = "COMMITTED"
        try:
            await complete_interview()
        except VoiceTurnTransportError:
            # The final turn is already durable. The browser checkpoint poll or
            # a later recovery can complete the lifecycle without asking the
            # candidate to repeat valid evidence.
            completion_sync = "PENDING"
        return {
            "status": "COMPLETE",
            "completion_sync": completion_sync,
            "decision": result.get("decision"),
            "instruction": (
                "诊断已完成，请候选人查看网页报告。"
                if completion_sync == "COMMITTED"
                else "回答已保存，报告正在生成，请候选人回到网页查看。"
            ),
        }

    evaluation = result.get("evaluation")
    reliability = (
        evaluation.get("reliability")
        if isinstance(evaluation, Mapping)
        else None
    )
    return {
        "status": "CONTINUE",
        "decision": result.get("decision"),
        "reliability": reliability,
        "next_question_id": runtime.current_question["id"],
        "spoken_question": _spoken_question(runtime.current_question),
        "instruction": "简短承接后，原样朗读 spoken_question。",
    }


async def recover_pending_answer(runtime, load_authoritative_state, reason):
    """An HTTP timeout is not proof of failure. Never clear or blindly repost."""
    try:
        authoritative = await load_authoritative_state()
        completed = (authoritative.get("progress") or {}).get("completedTurns")
        if type(completed) is not int or completed < runtime.sequence_number:
            return _pending_result(reason)
        _apply_authoritative_state(runtime, authoritative)
    except (VoiceTurnTransportError, ValueError, TypeError, AttributeError):
        return _pending_result(reason)
    runtime.transcript_buffer.clear()
    return _resynced_result(runtime.current_question)


def _pending_result(reason):
    return {
        "status": "SAVE_PENDING",
        "reason": reason,
        "instruction": "暂时未确认保存，回答已保留。请在网页核对保存状态，必要时切换文本提交；无需重新口述，不要再次自动提交。",
    }


def _apply_authoritative_state(
    runtime: VoiceTurnRuntime,
    authoritative: Mapping[str, Any],
) -> None:
    progress = authoritative.get("progress")
    completed_turns = (
        progress.get("completedTurns")
        if isinstance(progress, Mapping)
        else None
    )
    if (
        isinstance(completed_turns, bool)
        or not isinstance(completed_turns, int)
        or completed_turns < 0
        or "nextQuestion" not in authoritative
    ):
        raise ValueError("authoritative voice state is malformed")
    next_sequence_number = completed_turns + 1
    next_question = _question_or_none(authoritative["nextQuestion"])
    runtime.sequence_number = next_sequence_number
    runtime.current_question = next_question


def _question_or_none(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    if not isinstance(value, Mapping):
        raise ValueError("nextQuestion must be an object or null")
    question = dict(value)
    if (
        not isinstance(question.get("id"), str)
        or not question["id"].strip()
        or not isinstance(question.get("text"), str)
        or not question["text"].strip()
    ):
        raise ValueError("nextQuestion is missing id or text")
    return question


def _spoken_question(question: Mapping[str, Any] | None) -> str | None:
    if question is None:
        return None
    return prepare_interview_question_for_speech(
        str(question.get("text", "")), question.get("questionType")
    )


def _repeat_result(reason: str) -> dict[str, Any]:
    return {
        "status": "REPEAT_CURRENT_ANSWER",
        "reason": reason,
        "instruction": (
            "不要提及系统或连接问题。请说："
            "我没有完整收到这段回答，请再完整说一遍。"
        ),
    }


def _resynced_result(
    question: Mapping[str, Any] | None,
) -> dict[str, Any]:
    if question is None:
        return {"status": "COMPLETE", "instruction": "回答已保存，请回到网页查看报告。"}
    return {
        "status": "RESYNCED",
        "next_question_id": question.get("id") if question else None,
        "spoken_question": _spoken_question(question),
        "instruction": (
            "不要提及冲突、连接或系统错误。"
            "以 spoken_question 为准并原样朗读。"
        ),
    }
