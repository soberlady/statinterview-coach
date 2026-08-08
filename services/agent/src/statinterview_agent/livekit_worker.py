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

from .voice_cost import estimate_livekit_inference_cost
from .voice_room import resolve_interview_id, resolve_voice_session_id
from .voice_speech import build_opening_prompt, prepare_question_for_speech
from .voice_transcript import CommittedTranscriptBuffer

load_dotenv(".env.local")
load_dotenv()

logger = logging.getLogger(__name__)

STT_KEYTERMS = [
    "SQL",
    "Python",
    "A/B 测试",
    "点击率",
    "转化率",
    "留存率",
    "显著性水平",
    "统计功效",
    "样本量",
    "p 值",
    "置信区间",
    "假阳性",
    "假阴性",
    "多重比较",
    "碰巧显著",
    "主指标",
    "Bonferroni 校正",
    "Benjamini-Hochberg",
    "FDR",
    "错误发现率",
    "窗口函数",
    "ROW_NUMBER",
    "RANK",
    "DENSE_RANK",
    "因果推断",
]


@dataclass
class VoiceRuntime:
    interview_id: str
    api_base_url: str
    sequence_number: int
    current_question: dict[str, Any] | None
    transcript_buffer: CommittedTranscriptBuffer = field(
        default_factory=CommittedTranscriptBuffer
    )
    submit_lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class StatInterviewVoiceAgent(Agent):
    """Thin voice controller that cannot bypass the deterministic policy API."""

    def __init__(self, first_question: dict[str, Any] | None) -> None:
        question_text = (
            first_question["text"]
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
三、工具保存的是 LiveKit 的最终原始转写，不得改写、总结或美化候选人证据。
四、工具返回 next_question 时，只做一句简短承接，然后逐字询问其中的 text。
五、工具返回 COMPLETE 时，告知诊断已完成并引导候选人查看网页报告。
六、不要分析表情、音色、口音、情绪或性别，不做录用决策。
七、不得自行创建题目，不得跳过可靠性追问。
八、不要向候选人口播连接异常、HTTP 状态或系统内部错误。
九、工具返回 RESYNCED 时，以 next_question 为唯一事实并逐字提问，不要重复提交旧回答。
十、全程使用标准普通话语调。遇到 spoken_question 时必须原样朗读，不自行改写题目。
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
        async with runtime.submit_lock:
            transcript = runtime.transcript_buffer.text
            question = runtime.current_question
            if len(transcript) < 10:
                runtime.transcript_buffer.clear()
                return json.dumps(
                    {
                        "status": "TRANSCRIPT_TOO_SHORT",
                        "instruction": (
                            "不要提及系统或连接问题。请说："
                            "我没有完整收到这段回答，请再完整说一遍。"
                        ),
                    },
                    ensure_ascii=False,
                )
            if not question:
                return json.dumps(
                    {
                        "status": "COMPLETE",
                        "instruction": "诊断已完成，请查看网页报告。",
                    },
                    ensure_ascii=False,
                )

            payload = {
                "sequenceNumber": runtime.sequence_number,
                "questionId": question["id"],
                "answerText": transcript,
                "inputMode": "voice",
            }
            endpoint = (
                f"{runtime.api_base_url}/api/interviews/"
                f"{runtime.interview_id}/turns"
            )
            try:
                async with httpx.AsyncClient(timeout=15.0) as client:
                    response = await client.post(endpoint, json=payload)
            except httpx.RequestError:
                logger.warning(
                    "turn submission transport failed",
                    exc_info=True,
                    extra={"interview_id": runtime.interview_id},
                )
                runtime.transcript_buffer.clear()
                return json.dumps(
                    {
                        "status": "REPEAT_CURRENT_ANSWER",
                        "instruction": (
                            "不要提及系统或连接问题。请说："
                            "我没有完整收到这段回答，请再完整说一遍。"
                        ),
                    },
                    ensure_ascii=False,
                )

            if response.status_code == 409:
                try:
                    await _resync_runtime(runtime)
                except httpx.HTTPError:
                    logger.warning(
                        "turn conflict resync failed",
                        exc_info=True,
                        extra={"interview_id": runtime.interview_id},
                    )
                    runtime.transcript_buffer.clear()
                    return json.dumps(
                        {
                            "status": "REPEAT_CURRENT_ANSWER",
                            "instruction": (
                                "不要提及系统或连接问题。请说："
                                "我没有完整收到这段回答，请再完整说一遍。"
                            ),
                        },
                        ensure_ascii=False,
                    )

                runtime.transcript_buffer.clear()
                return json.dumps(
                    {
                        "status": "RESYNCED",
                        "next_question": runtime.current_question,
                        "spoken_question": prepare_question_for_speech(
                            str(runtime.current_question.get("text", ""))
                        )
                        if runtime.current_question
                        else None,
                        "instruction": (
                            "不要提及冲突、连接或系统错误。"
                            "以 next_question 为准，原样朗读 spoken_question。"
                        ),
                    },
                    ensure_ascii=False,
                )

            if response.is_error:
                logger.warning(
                    "turn submission rejected with status %s",
                    response.status_code,
                    extra={"interview_id": runtime.interview_id},
                )
                runtime.transcript_buffer.clear()
                return json.dumps(
                    {
                        "status": "REPEAT_CURRENT_ANSWER",
                        "instruction": (
                            "不要提及系统或连接问题。请说："
                            "我没有完整收到这段回答，请再完整说一遍。"
                        ),
                    },
                    ensure_ascii=False,
                )

            result = response.json()

            runtime.transcript_buffer.clear()
            runtime.current_question = result.get("nextQuestion")
            progress = result.get("progress") or {}
            runtime.sequence_number = int(
                progress.get("completedTurns", runtime.sequence_number)
            ) + 1

            if runtime.current_question is None:
                await _complete_interview(
                    runtime.api_base_url, runtime.interview_id
                )
                return json.dumps(
                    {
                        "status": "COMPLETE",
                        "decision": result.get("decision"),
                        "instruction": "诊断已完成，请候选人查看网页报告。",
                    },
                    ensure_ascii=False,
                )

            return json.dumps(
                {
                    "status": "CONTINUE",
                    "decision": result.get("decision"),
                    "reliability": (result.get("evaluation") or {}).get(
                        "reliability"
                    ),
                    "next_question": runtime.current_question,
                    "spoken_question": prepare_question_for_speech(
                        str(runtime.current_question.get("text", ""))
                    ),
                    "instruction": "简短承接后，原样朗读 spoken_question。",
                },
                ensure_ascii=False,
            )


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
            extra_kwargs={"keyterm": STT_KEYTERMS},
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
                "min_delay": 0.8,
                "max_delay": 3.0,
            }
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
            runtime.transcript_buffer.add(event.item.id, transcript)

    await session.start(
        room=ctx.room,
        agent=StatInterviewVoiceAgent(runtime.current_question),
    )

    async def export_final_usage(shutdown_reason: str) -> None:
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
    await ctx.connect()

    if runtime.current_question:
        session.say(
            build_opening_prompt(
                runtime.sequence_number,
                str(runtime.current_question["text"]),
            ),
        )
    else:
        session.say("这次诊断已经完成，请回到网页查看报告。")


async def _load_next_question(
    api_base_url: str,
    interview_id: str,
) -> dict[str, Any]:
    endpoint = (
        f"{api_base_url}/api/interviews/{interview_id}/next-question"
    )
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(endpoint)
        response.raise_for_status()
        return response.json()


async def _resync_runtime(runtime: VoiceRuntime) -> None:
    authoritative = await _load_next_question(
        runtime.api_base_url,
        runtime.interview_id,
    )
    progress = authoritative.get("progress") or {}
    runtime.sequence_number = int(progress.get("completedTurns", 0)) + 1
    runtime.current_question = authoritative.get("nextQuestion")


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
            response = await client.post(endpoint, json=event)
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
