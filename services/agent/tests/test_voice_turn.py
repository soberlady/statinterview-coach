import asyncio
from dataclasses import dataclass, field
from typing import Any

from statinterview_agent.voice_transcript import CommittedTranscriptBuffer
from statinterview_agent.voice_turn import (
    VoiceApiResponse,
    VoiceTurnTransportError,
    process_voice_answer,
)


@dataclass
class Runtime:
    interview_id: str = "int_test"
    sequence_number: int = 2
    current_question: dict[str, Any] | None = field(
        default_factory=lambda: {"id": "q_2", "text": "请解释 p 值。"}
    )
    transcript_buffer: CommittedTranscriptBuffer = field(
        default_factory=CommittedTranscriptBuffer
    )


def test_success_preserves_verbatim_evidence_and_advances_question() -> None:
    runtime = Runtime()
    answer = "p 值是在原假设成立时，观察到当前或更极端结果的概率。"
    runtime.transcript_buffer.add("item-1", answer)
    captured_payload: dict[str, Any] = {}

    async def scenario() -> dict[str, Any]:
        async def post(payload: dict[str, Any]) -> VoiceApiResponse:
            captured_payload.update(payload)
            return VoiceApiResponse(
                201,
                {
                    "nextQuestion": {
                        "id": "q_3",
                        "text": "SQL 中 ROW_NUMBER 有什么作用？",
                    },
                    "progress": {"completedTurns": 2},
                    "evaluation": {"reliability": "HIGH"},
                    "decision": {"action": "ACCEPT"},
                },
            )

        return await process_voice_answer(
            runtime,
            post_turn=post,
            load_authoritative_state=unexpected_load,
            complete_interview=unexpected_complete,
        )

    result = asyncio.run(scenario())

    assert captured_payload == {
        "sequenceNumber": 2,
        "questionId": "q_2",
        "answerText": answer,
        "inputMode": "voice",
    }
    assert result["status"] == "CONTINUE"
    assert result["reliability"] == "HIGH"
    assert result["spoken_question"] == (
        "S Q L 中 row number 有什么作用？"
    )
    assert runtime.sequence_number == 3
    assert runtime.current_question and runtime.current_question["id"] == "q_3"
    assert runtime.transcript_buffer.text == ""


def test_voice_payload_keeps_raw_answer_and_adds_conservative_scoring_hint() -> None:
    runtime = Runtime(
        current_question={"id": "q_rate", "text": "留存率为30%时如何解释？"}
    )
    raw = "嗯，留存率为百分之三十，还要看 user ID 分组。"
    runtime.transcript_buffer.add("item-1", raw)
    captured: dict[str, Any] = {}

    async def post(payload: dict[str, Any]) -> VoiceApiResponse:
        captured.update(payload)
        return VoiceApiResponse(
            201,
            {"nextQuestion": None, "progress": {"completedTurns": 2}},
        )

    async def complete() -> None:
        return None

    asyncio.run(
        process_voice_answer(
            runtime,
            post_turn=post,
            load_authoritative_state=unexpected_load,
            complete_interview=complete,
        )
    )

    assert captured["answerText"] == raw
    assert captured["transcriptScoringHint"] == (
        "留存率为30%，还要看 user_id 分组。"
    )


def test_short_transcript_never_reaches_the_api() -> None:
    runtime = Runtime()
    runtime.transcript_buffer.add("item-1", "太短了")

    result = asyncio.run(
        process_voice_answer(
            runtime,
            post_turn=unexpected_post,
            load_authoritative_state=unexpected_load,
            complete_interview=unexpected_complete,
        )
    )

    assert result["status"] == "REPEAT_CURRENT_ANSWER"
    assert result["reason"] == "TRANSCRIPT_TOO_SHORT"
    assert runtime.transcript_buffer.text == ""


def test_terminal_checkpoint_does_not_request_a_nonexistent_answer() -> None:
    runtime = Runtime(current_question=None)

    result = asyncio.run(
        process_voice_answer(
            runtime,
            post_turn=unexpected_post,
            load_authoritative_state=unexpected_load,
            complete_interview=unexpected_complete,
        )
    )

    assert result["status"] == "COMPLETE"
    assert "再完整说一遍" not in result["instruction"]


def test_transport_failure_repeats_without_advancing_checkpoint() -> None:
    runtime = Runtime()
    runtime.transcript_buffer.add("item-1", "这是一段长度足够但提交失败的回答内容。")

    async def failed_post(_payload: dict[str, Any]) -> VoiceApiResponse:
        raise VoiceTurnTransportError("timeout")

    result = asyncio.run(
        process_voice_answer(
            runtime,
            post_turn=failed_post,
            load_authoritative_state=unexpected_load,
            complete_interview=unexpected_complete,
        )
    )

    assert result["reason"] == "TURN_TRANSPORT_FAILED"
    assert runtime.sequence_number == 2
    assert runtime.current_question and runtime.current_question["id"] == "q_2"


def test_conflict_discards_old_answer_and_restores_authoritative_question() -> None:
    runtime = Runtime()
    runtime.transcript_buffer.add("item-1", "这段回答其实已经由前一个连接成功保存了。")

    async def conflict(_payload: dict[str, Any]) -> VoiceApiResponse:
        return VoiceApiResponse(409, {})

    async def load() -> dict[str, Any]:
        return {
            "nextQuestion": {"id": "q_5", "text": "解释置信区间。"},
            "progress": {"completedTurns": 4},
        }

    result = asyncio.run(
        process_voice_answer(
            runtime,
            post_turn=conflict,
            load_authoritative_state=load,
            complete_interview=unexpected_complete,
        )
    )

    assert result["status"] == "RESYNCED"
    assert runtime.sequence_number == 5
    assert runtime.current_question and runtime.current_question["id"] == "q_5"
    assert runtime.transcript_buffer.text == ""


def test_failed_conflict_recovery_requests_a_fresh_answer() -> None:
    runtime = Runtime()
    runtime.transcript_buffer.add("item-1", "这段回答提交时遇到了版本冲突。")

    async def conflict(_payload: dict[str, Any]) -> VoiceApiResponse:
        return VoiceApiResponse(409, {})

    async def failed_load() -> dict[str, Any]:
        raise VoiceTurnTransportError("offline")

    result = asyncio.run(
        process_voice_answer(
            runtime,
            post_turn=conflict,
            load_authoritative_state=failed_load,
            complete_interview=unexpected_complete,
        )
    )

    assert result["reason"] == "RESYNC_FAILED"
    assert runtime.sequence_number == 2


def test_final_turn_is_completed_without_requesting_more_evidence() -> None:
    runtime = Runtime(sequence_number=6)
    runtime.transcript_buffer.add("item-1", "最后一题回答已经足够完整，可以结束本次诊断。")
    completed = False

    async def post(_payload: dict[str, Any]) -> VoiceApiResponse:
        return VoiceApiResponse(
            201,
            {
                "nextQuestion": None,
                "progress": {"completedTurns": 6},
                "decision": {"action": "COMPLETE"},
            },
        )

    async def complete() -> None:
        nonlocal completed
        completed = True

    result = asyncio.run(
        process_voice_answer(
            runtime,
            post_turn=post,
            load_authoritative_state=unexpected_load,
            complete_interview=complete,
        )
    )

    assert completed is True
    assert result["status"] == "COMPLETE"
    assert result["completion_sync"] == "COMMITTED"
    assert runtime.current_question is None
    assert runtime.sequence_number == 7


def test_completion_sync_failure_does_not_repeat_a_saved_final_answer() -> None:
    runtime = Runtime(sequence_number=6)
    runtime.transcript_buffer.add("item-1", "最后一题已经成功保存，但完成状态暂时同步失败。")

    async def post(_payload: dict[str, Any]) -> VoiceApiResponse:
        return VoiceApiResponse(
            201,
            {"nextQuestion": None, "progress": {"completedTurns": 6}},
        )

    async def failed_complete() -> None:
        raise VoiceTurnTransportError("completion timeout")

    result = asyncio.run(
        process_voice_answer(
            runtime,
            post_turn=post,
            load_authoritative_state=unexpected_load,
            complete_interview=failed_complete,
        )
    )

    assert result["status"] == "COMPLETE"
    assert result["completion_sync"] == "PENDING"
    assert "重新回答" not in result["instruction"]


def test_server_rejection_does_not_mutate_the_question() -> None:
    runtime = Runtime()
    runtime.transcript_buffer.add("item-1", "这段回答会被服务端拒绝但不会推进题目。")

    async def rejected(_payload: dict[str, Any]) -> VoiceApiResponse:
        return VoiceApiResponse(503, {})

    result = asyncio.run(
        process_voice_answer(
            runtime,
            post_turn=rejected,
            load_authoritative_state=unexpected_load,
            complete_interview=unexpected_complete,
        )
    )

    assert result["reason"] == "TURN_REJECTED"
    assert runtime.current_question and runtime.current_question["id"] == "q_2"


def test_malformed_success_response_resyncs_instead_of_false_completion() -> None:
    runtime = Runtime()
    runtime.transcript_buffer.add("item-1", "服务端已保存回答，但响应正文缺少检查点字段。")

    async def malformed(_payload: dict[str, Any]) -> VoiceApiResponse:
        return VoiceApiResponse(201, {"decision": {"action": "ACCEPT"}})

    async def load() -> dict[str, Any]:
        return {
            "nextQuestion": {"id": "q_3", "text": "解释统计功效。"},
            "progress": {"completedTurns": 2},
        }

    result = asyncio.run(
        process_voice_answer(
            runtime,
            post_turn=malformed,
            load_authoritative_state=load,
            complete_interview=unexpected_complete,
        )
    )

    assert result["status"] == "RESYNCED"
    assert runtime.current_question and runtime.current_question["id"] == "q_3"
    assert runtime.sequence_number == 3


def test_malformed_checkpoint_cannot_partially_advance_runtime() -> None:
    runtime = Runtime()
    runtime.transcript_buffer.add("item-1", "冲突后的检查点包含无效题目，不能部分覆盖本地状态。")

    async def conflict(_payload: dict[str, Any]) -> VoiceApiResponse:
        return VoiceApiResponse(409, {})

    async def malformed_load() -> dict[str, Any]:
        return {
            "nextQuestion": {"id": "", "text": ""},
            "progress": {"completedTurns": 99},
        }

    result = asyncio.run(
        process_voice_answer(
            runtime,
            post_turn=conflict,
            load_authoritative_state=malformed_load,
            complete_interview=unexpected_complete,
        )
    )

    assert result["reason"] == "RESYNC_FAILED"
    assert runtime.sequence_number == 2
    assert runtime.current_question and runtime.current_question["id"] == "q_2"


async def unexpected_post(_payload: dict[str, Any]) -> VoiceApiResponse:
    raise AssertionError("post_turn should not be called")


async def unexpected_load() -> dict[str, Any]:
    raise AssertionError("load_authoritative_state should not be called")


async def unexpected_complete() -> None:
    raise AssertionError("complete_interview should not be called")
