"""LiveKit voice transport for the StatInterview policy API.

The worker intentionally keeps media transport and interview decisions
separate. LiveKit handles realtime audio, transcription, turn detection and
speech. The StatInterview API remains the source of truth for approved
questions, checkpoints, reliability policy and adaptive selection.
"""

from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass, field
from typing import Any

import httpx
from dotenv import load_dotenv
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    RunContext,
    UserInputTranscribedEvent,
    cli,
    function_tool,
    inference,
)
from livekit.agents.llm.tool_context import ToolFlag

load_dotenv(".env.local")
load_dotenv()


@dataclass
class VoiceRuntime:
    interview_id: str
    api_base_url: str
    sequence_number: int
    current_question: dict[str, Any] | None
    last_final_transcript: str = ""
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
            transcript = runtime.last_final_transcript.strip()
            question = runtime.current_question
            if not transcript:
                return json.dumps(
                    {
                        "status": "NO_FINAL_TRANSCRIPT",
                        "instruction": "请候选人再说一遍，暂时不要评分。",
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
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.post(endpoint, json=payload)
                response.raise_for_status()
                result = response.json()

            runtime.last_final_transcript = ""
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
                    "instruction": "简短承接后，逐字询问 next_question.text。",
                },
                ensure_ascii=False,
            )


server = AgentServer()


@server.rtc_session(agent_name="statinterview-coach")
async def statinterview_session(ctx: JobContext) -> None:
    interview_id = _resolve_interview_id(ctx.room.name)
    api_base_url = os.environ.get(
        "STATINTERVIEW_API_BASE_URL", "http://localhost:3000"
    ).rstrip("/")
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
            language="multi",
        ),
        llm=inference.LLM(
            model=os.environ.get(
                "STATINTERVIEW_LLM_MODEL", "google/gemma-4-31b-it"
            )
        ),
        tts=inference.TTS(
            model=os.environ.get(
                "STATINTERVIEW_TTS_MODEL", "cartesia/sonic-3"
            ),
            voice=os.environ.get(
                "STATINTERVIEW_TTS_VOICE",
                "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc",
            ),
        ),
    )

    @session.on("user_input_transcribed")
    def capture_final_transcript(event: UserInputTranscribedEvent) -> None:
        if event.is_final and event.transcript.strip():
            runtime.last_final_transcript = event.transcript

    await session.start(
        room=ctx.room,
        agent=StatInterviewVoiceAgent(runtime.current_question),
    )
    await ctx.connect()

    if runtime.current_question:
        session.say(
            "你好，我会根据你的回答动态选择问题。"
            "评分只基于回答内容。第一题，"
            + str(runtime.current_question["text"]),
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


def _resolve_interview_id(room_name: str) -> str:
    configured = os.environ.get("STATINTERVIEW_INTERVIEW_ID", "").strip()
    if configured:
        return configured
    prefix = "statinterview--"
    if room_name.startswith(prefix) and len(room_name) > len(prefix):
        return room_name[len(prefix) :]
    raise RuntimeError(
        "Room name must be statinterview--<interview_id>, or set "
        "STATINTERVIEW_INTERVIEW_ID for console development."
    )


if __name__ == "__main__":
    cli.run_app(server)
