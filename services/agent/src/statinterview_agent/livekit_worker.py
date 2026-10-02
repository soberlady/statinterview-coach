"""LiveKit voice transport for the StatInterview policy API.

The worker intentionally keeps media transport and interview decisions
separate. LiveKit handles realtime audio, transcription, turn detection and
speech. The StatInterview API remains the source of truth for approved
questions, checkpoints, reliability policy and adaptive selection.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass, field
from typing import Any

import httpx
from dotenv import load_dotenv
from livekit import rtc
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    ChatMessage,
    ConversationItemAddedEvent,
    JobContext,
    RunContext,
    cli,
    function_tool,
    inference,
)
from livekit.agents.llm.tool_context import ToolFlag

from .api_auth import api_request_headers as _api_request_headers
from .voice_cost import estimate_livekit_inference_cost
from .voice_control import matches_question, question_snapshot
from .voice_room import resolve_interview_id, resolve_voice_session_id
from .voice_speech import build_opening_prompt, prepare_question_for_speech
from .voice_terms import build_question_keyterms
from .voice_transcript import CommittedTranscriptBuffer
from .voice_turn import (
    VoiceApiResponse,
    VoiceTurnTransportError,
    recover_pending_answer,
    process_voice_answer,
    wait_for_transcript_stability,
)

load_dotenv(".env.local")
load_dotenv()

logger = logging.getLogger(__name__)

@dataclass
class VoiceRuntime:
    interview_id: str
    api_base_url: str
    sequence_number: int
    current_question: dict[str, Any] | None
    minimum_transcript_confidence: float = 0.72
    transcript_stability_seconds: float = 4.0
    low_confidence_retries: int = 0
    last_transcript_at: float | None = None
    processing_stage: str = "listening"
    submission_pending: bool = False
    last_recovery_check: float = 0.0
    transcript_buffer: CommittedTranscriptBuffer = field(
        default_factory=CommittedTranscriptBuffer
    )
    submit_lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class StatInterviewVoiceAgent(Agent):
    """Thin voice controller that cannot bypass the deterministic policy API."""

    def __init__(self, first_question: dict[str, Any] | None) -> None:
        question_text = (
            prepare_question_for_speech(first_question["text"])
            if first_question
            else "本次诊断已经完成，请提醒候选人查看报告。"
        )
        super().__init__(
            instructions=f"""
你是中文数据分析实习面试官，只负责控制对话，不自行打分或选题。

当前问题是：{question_text}

规则：
一、一次只问一个问题，表达简短、自然，不给标准答案或暗示。
二、候选人完成一次回答后，必须调用 submit_current_answer，且每轮只调用一次。
二点一、短暂停顿不代表回答结束。候选人仍在继续说时保持安静，不得催促、清空转写或切换题目。
三、工具保存的是 LiveKit 的最终原始转写，不得改写、总结或美化候选人证据。
四、工具返回 CONTINUE 时，只做一句简短承接，然后原样朗读 spoken_question；不要读取或复述其他字段。
五、工具返回 COMPLETE 时，告知诊断已完成并引导候选人查看网页报告。
六、不要分析表情、音色、口音、情绪或性别，不做录用决策。
七、不得自行创建题目，不得跳过可靠性追问。
八、不要向候选人口播连接异常、HTTP 状态或系统内部错误。
九、工具返回 RESYNCED 时，以 spoken_question 为唯一题目并原样朗读，不要重复提交旧回答。
十、全程使用标准普通话语调。spoken_question 已为朗读优化，必须原样朗读，不自行改写题目。
""".strip(),
        )

    @function_tool(flags=ToolFlag.IGNORE_ON_ENTER)
    async def submit_current_answer(
        self,
        context: RunContext[VoiceRuntime],
    ) -> str:
        """Save the candidate's final raw transcript and obtain the next policy action.

        Call this exactly once after the candidate has completed an answer.
        This tool has no arguments because evidence must come from LiveKit's
        final transcript rather than an LLM-authored paraphrase.
        """

        runtime = context.userdata
        expected = question_snapshot(runtime)
        async with runtime.submit_lock:
            if runtime.submission_pending:
                return json.dumps({"status": "SAVE_PENDING", "instruction": "请在网页核对保存状态，必要时切换文本提交；不要自动重试或要求重新口述。"}, ensure_ascii=False)
            if not matches_question(runtime, expected):
                return json.dumps({"status": "ALREADY_HANDLED", "instruction": "该回答已处理，保持安静，不再提交或重复读题。"}, ensure_ascii=False)
            runtime.processing_stage = "transcribing"
            stable = await wait_for_transcript_stability(
                runtime,
                quiet_seconds=runtime.transcript_stability_seconds,
            )
            if not stable:
                runtime.processing_stage = "listening"
                return json.dumps(
                    {
                        "status": "WAITING_FOR_MORE",
                        "instruction": (
                            "候选人的回答仍在继续。保持安静并继续聆听，"
                            "不要清空转写、提交答案或朗读下一题。"
                        ),
                    },
                    ensure_ascii=False,
                )
            result = await process_voice_answer(
                runtime,
                post_turn=lambda payload: _post_voice_turn(
                    runtime, payload
                ),
                load_authoritative_state=lambda: _load_authoritative_for_turn(
                    runtime
                ),
                complete_interview=lambda: _complete_for_turn(runtime),
            )
            next_question = runtime.current_question
            runtime.submission_pending = result.get("status") == "SAVE_PENDING"
            runtime.processing_stage = "saved" if result.get("status") in {"CONTINUE", "COMPLETE", "RESYNCED"} else "recovery"
            context.session.update_options(
                keyterms=build_question_keyterms(
                    str(next_question.get("text", ""))
                    if next_question
                    else ""
                )
            )
            internal_reason = result.pop("reason", None)
            if internal_reason:
                logger.warning(
                    "voice turn requested retry: %s",
                    internal_reason,
                    extra={"interview_id": runtime.interview_id},
                )
            return json.dumps(result, ensure_ascii=False)


server = AgentServer()


@server.rtc_session(agent_name="statinterview-coach")
async def statinterview_session(ctx: JobContext) -> None:
    interview_id = resolve_interview_id(
        ctx.room.name,
        job_metadata=ctx.job.metadata,
        configured_interview_id=os.environ.get(
            "STATINTERVIEW_INTERVIEW_ID", ""
        ),
    )
    api_base_url = os.environ.get(
        "STATINTERVIEW_API_BASE_URL", "http://localhost:3000"
    ).rstrip("/")
    voice_session_id = resolve_voice_session_id(
        ctx.room.name,
        job_id=ctx.job.id,
    )
    initial = await _load_next_question(api_base_url, interview_id)
    progress = initial.get("progress") or {}
    runtime = VoiceRuntime(
        interview_id=interview_id,
        api_base_url=api_base_url,
        sequence_number=int(progress.get("completedTurns", 0)) + 1,
        current_question=initial.get("nextQuestion"),
        minimum_transcript_confidence=_minimum_transcript_confidence(),
        transcript_stability_seconds=_transcript_stability_seconds(),
    )
    ctx.log_context_fields = {
        "room": ctx.room.name,
        "interview_id": interview_id,
    }

    session = AgentSession[VoiceRuntime](
        userdata=runtime,
        stt=inference.STT(
            model=os.environ.get(
                "STATINTERVIEW_STT_MODEL", "deepgram/nova-3"
            ),
            language=os.environ.get(
                "STATINTERVIEW_STT_LANGUAGE", "zh-CN"
            ),
        ),
        llm=inference.LLM(
            model=os.environ.get(
                "STATINTERVIEW_LLM_MODEL", "google/gemma-4-31b-it"
            )
        ),
        tts=inference.TTS(
            model=os.environ.get(
                "STATINTERVIEW_TTS_MODEL", "cartesia/sonic-3.5"
            ),
            voice=os.environ.get(
                "STATINTERVIEW_TTS_VOICE",
                "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc",
            ),
            language=os.environ.get(
                "STATINTERVIEW_TTS_LANGUAGE", "zh"
            ),
            extra_kwargs={
                "speed": float(
                    os.environ.get("STATINTERVIEW_TTS_SPEED", "0.92")
                )
            },
        ),
        turn_handling={
            "endpointing": {
                "min_delay": 1.5,
                "max_delay": 6.0,
            }
        },
        stt_context_options={
            "keyterms": build_question_keyterms(
                str((initial.get("nextQuestion") or {}).get("text", ""))
            ),
            "keyterm_detection": False,
        },
    )

    @session.on("conversation_item_added")
    def capture_committed_user_turn(
        event: ConversationItemAddedEvent,
    ) -> None:
        if not isinstance(event.item, ChatMessage):
            return
        if event.item.role != "user":
            return
        transcript = (event.item.text_content or "").strip()
        if transcript:
            runtime.last_transcript_at = asyncio.get_running_loop().time()
            if runtime.processing_stage == "saved":
                runtime.processing_stage = "listening"
            runtime.transcript_buffer.add(
                event.item.id,
                transcript,
                event.item.transcript_confidence,
            )

    # A pre-dispatched agent can start before the browser joins. Do not speak
    # the opening question into an empty room.
    await ctx.connect()
    candidate = await ctx.wait_for_participant()

    control_tasks: set[asyncio.Task[Any]] = set()

    async def run_control(payload: dict[str, Any]) -> None:
        try:
            async with runtime.submit_lock:
                if not matches_question(runtime, payload):
                    return  # Automatic submission won the race; never submit the next question.
                if payload["action"] == "finish":
                    if runtime.submission_pending:
                        runtime.processing_stage = "recovery"
                        return
                    runtime.processing_stage = "transcribing"
                    session.interrupt()
                    await session.commit_user_turn(transcript_timeout=5.0, skip_reply=True)
                    stable = await wait_for_transcript_stability(
                        runtime, quiet_seconds=0.5,
                        max_wait_seconds=10.0,
                    )
                    if not stable:
                        runtime.processing_stage = "recovery"
                        return  # Browser timeout keeps the draft and offers recovery.
                    result = await process_voice_answer(
                        runtime,
                        post_turn=lambda value: _post_voice_turn(runtime, value),
                        load_authoritative_state=lambda: _load_authoritative_for_turn(runtime),
                        complete_interview=lambda: _complete_for_turn(runtime),
                    )
                    session.update_options(keyterms=build_question_keyterms(
                        str((runtime.current_question or {}).get("text", ""))
                    ))
                    runtime.processing_stage = "saved" if result.get("status") in {"CONTINUE", "COMPLETE", "RESYNCED"} else "recovery"
                    runtime.submission_pending = result.get("status") == "SAVE_PENDING"
                    if result.get("status") == "COMPLETE":
                        session.say("本次练习已完成，请回到网页查看报告。")
                    elif result.get("spoken_question"):
                        session.say(result["spoken_question"])
                    else:
                        session.say("这段回答尚未保存，请在网页核对转写后继续回答，或切换文字提交。")
                else:
                    session.interrupt()
                    session.say(prepare_question_for_speech(runtime.current_question["text"]))
        except Exception:
            runtime.processing_stage = "recovery"
            # Never log answer content or credentials on the control path.
            logger.warning("voice control failed", extra={"interview_id": runtime.interview_id})

    async def reconcile_pending() -> None:
        async with runtime.submit_lock:
            if not runtime.submission_pending:
                return
            result = await recover_pending_answer(
                runtime, lambda: _load_authoritative_for_turn(runtime), "SAVE_NOT_CONFIRMED",
            )
            if result["status"] in {"RESYNCED", "COMPLETE"}:
                runtime.submission_pending = False
                runtime.processing_stage = "saved"
                session.update_options(keyterms=build_question_keyterms(
                    str((runtime.current_question or {}).get("text", ""))
                ))
                session.say(result.get("spoken_question") or "回答已保存，请回到网页查看报告。")

    @ctx.room.local_participant.register_rpc_method("statinterview.status")
    async def status(data: rtc.RpcInvocationData) -> str:
        if data.caller_identity != candidate.identity:
            raise rtc.RpcError(1403, "Not the session participant")
        now = asyncio.get_running_loop().time()
        if runtime.submission_pending and not control_tasks and now - runtime.last_recovery_check >= 5:
            runtime.last_recovery_check = now
            task = asyncio.create_task(reconcile_pending())
            control_tasks.add(task)
            task.add_done_callback(control_tasks.discard)
        return json.dumps({**question_snapshot(runtime), "stage": runtime.processing_stage})

    @ctx.room.local_participant.register_rpc_method("statinterview.control")
    async def control(data: rtc.RpcInvocationData) -> str:
        if data.caller_identity != candidate.identity:
            raise rtc.RpcError(1403, "Not the session participant")
        try:
            payload = json.loads(data.payload)
        except (ValueError, TypeError):
            raise rtc.RpcError(1400, "Invalid control")
        if not isinstance(payload, dict) or payload.get("action") not in {"finish", "repeat"}:
            raise rtc.RpcError(1400, "Invalid control")
        if not matches_question(runtime, payload):
            return json.dumps({"status": "STALE"})
        if control_tasks:
            return json.dumps({"status": "BUSY"})
        task = asyncio.create_task(run_control(payload))
        control_tasks.add(task)
        task.add_done_callback(control_tasks.discard)
        return json.dumps({"status": "ACCEPTED"})

    await session.start(
        room=ctx.room,
        agent=StatInterviewVoiceAgent(runtime.current_question),
    )

    async def export_final_usage(shutdown_reason: str) -> None:
        pending_controls = list(control_tasks)
        for task in pending_controls:
            task.cancel()
        if pending_controls:
            await asyncio.gather(*pending_controls, return_exceptions=True)
        # AgentSession also closes itself during job shutdown. Calling the
        # public idempotent close method here guarantees that pending STT/TTS
        # metrics are flushed before the final cumulative snapshot is read.
        await session.aclose()
        await _export_voice_usage(
            session=session,
            runtime=runtime,
            voice_session_id=voice_session_id,
            livekit_job_id=ctx.job.id,
            shutdown_reason=shutdown_reason,
        )

    ctx.add_shutdown_callback(export_final_usage)
    if runtime.current_question:
        session.say(
            build_opening_prompt(
                runtime.sequence_number,
                str(runtime.current_question["text"]),
            ),
        )
    else:
        session.say("这次诊断已经完成，请回到网页查看报告。")


def _minimum_transcript_confidence() -> float:
    raw = os.environ.get("STATINTERVIEW_STT_MIN_CONFIDENCE", "0.72")
    try:
        return min(1.0, max(0.0, float(raw)))
    except ValueError:
        logger.warning("invalid STT confidence threshold; using 0.72")
        return 0.72


def _transcript_stability_seconds() -> float:
    raw = os.environ.get("STATINTERVIEW_TRANSCRIPT_STABILITY_SECONDS", "4.0")
    try:
        return min(8.0, max(1.0, float(raw)))
    except ValueError:
        logger.warning("invalid transcript stability delay; using 4.0")
        return 4.0


async def _load_next_question(
    api_base_url: str,
    interview_id: str,
) -> dict[str, Any]:
    endpoint = (
        f"{api_base_url}/api/interviews/{interview_id}/next-question"
    )
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(
            endpoint,
            headers=_api_request_headers(),
        )
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError("next-question response must be an object")
        return payload


async def _post_voice_turn(
    runtime: VoiceRuntime,
    payload: dict[str, Any],
) -> VoiceApiResponse:
    endpoint = (
        f"{runtime.api_base_url}/api/interviews/"
        f"{runtime.interview_id}/turns"
    )
    try:
        runtime.processing_stage = "scoring"
        # Repair (15s) + parallel scoring (20s) + persistence/network margin.
        # An outer deadline also bounds connect/write/read time together.
        async with httpx.AsyncClient(timeout=httpx.Timeout(50.0, connect=10.0)) as client:
            response = await asyncio.wait_for(client.post(
                endpoint,
                json=payload,
                headers=_api_request_headers(),
            ), timeout=55.0)
        body: dict[str, Any] = {}
        if response.status_code < 400:
            parsed = response.json()
            if not isinstance(parsed, dict):
                raise ValueError("turn response must be an object")
            body = parsed
        return VoiceApiResponse(response.status_code, body)
    except (httpx.RequestError, ValueError, asyncio.TimeoutError) as error:
        logger.warning(
            "turn submission transport or response failed",
            exc_info=True,
            extra={"interview_id": runtime.interview_id},
        )
        raise VoiceTurnTransportError from error


async def _load_authoritative_for_turn(
    runtime: VoiceRuntime,
) -> dict[str, Any]:
    try:
        return await asyncio.wait_for(_load_next_question(
            runtime.api_base_url,
            runtime.interview_id,
        ), timeout=10.0)
    except (httpx.HTTPError, ValueError, asyncio.TimeoutError) as error:
        logger.warning(
            "turn conflict resync failed",
            exc_info=True,
            extra={"interview_id": runtime.interview_id},
        )
        raise VoiceTurnTransportError from error


async def _complete_for_turn(runtime: VoiceRuntime) -> None:
    try:
        await _complete_interview(
            runtime.api_base_url,
            runtime.interview_id,
        )
    except httpx.HTTPError as error:
        logger.warning(
            "final turn saved but completion sync failed",
            exc_info=True,
            extra={"interview_id": runtime.interview_id},
        )
        raise VoiceTurnTransportError from error


async def _complete_interview(
    api_base_url: str,
    interview_id: str,
) -> None:
    endpoint = f"{api_base_url}/api/interviews/{interview_id}"
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.patch(
            endpoint,
            json={
                "status": "COMPLETED",
                "currentStage": "COMPLETED",
            },
            headers=_api_request_headers(),
        )
        response.raise_for_status()


async def _export_voice_usage(
    *,
    session: AgentSession[VoiceRuntime],
    runtime: VoiceRuntime,
    voice_session_id: str,
    livekit_job_id: str,
    shutdown_reason: str,
) -> None:
    """Persist one idempotent final inference-usage snapshot per agent job."""

    try:
        estimate = estimate_livekit_inference_cost(
            session.usage.model_usage,
            plan=os.environ.get(
                "STATINTERVIEW_LIVEKIT_PRICING_PLAN", "build_ship"
            ),
        )
    except (TypeError, ValueError):
        logger.warning(
            "voice usage could not be estimated",
            exc_info=True,
            extra={"interview_id": runtime.interview_id},
        )
        return

    line_items = estimate["lineItems"]
    if not line_items:
        logger.info(
            "voice session closed without model usage",
            extra={"interview_id": runtime.interview_id},
        )
        return

    totals = estimate["totals"]
    event: dict[str, Any] = {
        "eventType": "voice.usage",
        "model": "livekit-inference",
        "inputTokens": totals["inputTokens"],
        "outputTokens": totals["outputTokens"],
        "idempotencyKey": f"worker:voice:{livekit_job_id}:usage",
        "payload": {
            **estimate,
            "voiceSessionId": voice_session_id,
            "livekitJobId": livekit_job_id,
            "shutdownReason": shutdown_reason,
        },
    }
    if totals["pricedUsageCount"] > 0:
        event["estimatedCostMicrousd"] = totals[
            "estimatedCostMicrousd"
        ]

    endpoint = (
        f"{runtime.api_base_url}/api/interviews/"
        f"{runtime.interview_id}/events"
    )
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                endpoint,
                json=event,
                headers=_api_request_headers(),
            )
            response.raise_for_status()
    except httpx.HTTPError:
        logger.warning(
            "voice usage export failed",
            exc_info=True,
            extra={
                "interview_id": runtime.interview_id,
                "livekit_job_id": livekit_job_id,
            },
        )


if __name__ == "__main__":
    cli.run_app(server)
