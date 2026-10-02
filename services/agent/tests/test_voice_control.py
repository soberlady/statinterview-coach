import asyncio
import json
from types import SimpleNamespace

import pytest

from statinterview_agent.voice_control import matches_question, question_snapshot


def test_controls_are_bound_to_exact_question_and_integer_sequence():
    runtime = SimpleNamespace(sequence_number=2, current_question={"id": "q2"})
    assert matches_question(runtime, question_snapshot(runtime))
    assert not matches_question(runtime, {"questionId": "q2", "sequenceNumber": True})
    assert not matches_question(runtime, {"questionId": "q1", "sequenceNumber": 2})
    assert not matches_question(runtime, {"questionId": "q2", "sequenceNumber": 1})
    runtime.current_question = None
    assert not matches_question(runtime, question_snapshot(runtime))


def test_worker_waits_for_listener_and_controls_commit_once(monkeypatch):
    pytest.importorskip("livekit.agents")
    from statinterview_agent import livekit_worker as worker

    events, handlers, sessions, submissions = [], {}, [], []
    async def load(*args):
        return {"progress": {"completedTurns": 1}, "nextQuestion": {"id": "q2", "text": "当前问题"}}
    async def stable(*args, **kwargs):
        return True
    async def process(runtime, **kwargs):
        submissions.append(runtime.transcript_buffer.text)
        runtime.sequence_number = 3
        runtime.current_question = {"id": "q3", "text": "下一题"}
        runtime.transcript_buffer.clear()
        return {"status": "CONTINUE", "spoken_question": "下一题"}
    class Session:
        def __class_getitem__(cls, item):
            return cls
        def __init__(self, **kwargs):
            self.runtime = kwargs["userdata"]
            sessions.append(self)
        def on(self, event):
            return lambda handler: handler
        async def start(self, **kwargs):
            events.append("start")
        def say(self, text):
            events.append(text)
        def interrupt(self):
            pass
        async def commit_user_turn(self, **kwargs):
            assert kwargs["skip_reply"] is True
            events.append("commit")
            self.runtime.transcript_buffer.add("final", "这是未经改写的最终原始回答。")
        def update_options(self, **kwargs):
            pass
    class Participant:
        def register_rpc_method(self, name):
            def register(handler):
                handlers[name] = handler
                return handler
            return register
    class Context:
        room = SimpleNamespace(name="statinterview--int_test--session", local_participant=Participant())
        job = SimpleNamespace(id="job", metadata='{"interviewId":"int_test"}')
        async def connect(self):
            events.append("connect")
        async def wait_for_participant(self):
            events.append("listener")
            return SimpleNamespace(identity="candidate-test")
        def add_shutdown_callback(self, callback):
            pass
    monkeypatch.setattr(worker, "_load_next_question", load)
    monkeypatch.setattr(worker, "AgentSession", Session)
    monkeypatch.setattr(worker, "wait_for_transcript_stability", stable)
    monkeypatch.setattr(worker, "process_voice_answer", process)
    for name in ["STT", "LLM", "TTS"]:
        monkeypatch.setattr(worker.inference, name, lambda **kwargs: None)
    async def run():
        await worker.statinterview_session(Context())
        assert events[:3] == ["connect", "listener", "start"]
        control = handlers["statinterview.control"]
        status = handlers["statinterview.status"]
        snapshot = json.loads(await status(SimpleNamespace(caller_identity="candidate-test")))
        assert snapshot == {"sequenceNumber": 2, "questionId": "q2", "stage": "listening"}
        with pytest.raises(worker.rtc.RpcError):
            await status(SimpleNamespace(caller_identity="intruder"))
        def request(action="finish", caller="candidate-test", sequence=2, question="q2"):
            return SimpleNamespace(caller_identity=caller, payload=json.dumps({
                "action": action, "sequenceNumber": sequence, "questionId": question,
            }))
        with pytest.raises(worker.rtc.RpcError):
            await control(request(caller="intruder"))
        assert json.loads(await control(request("repeat")))["status"] == "ACCEPTED"
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert submissions == []
        assert events[-1] == "当前问题"
        assert json.loads(await control(request()))["status"] == "ACCEPTED"
        assert json.loads(await control(request()))["status"] == "BUSY"
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert submissions == ["这是未经改写的最终原始回答。"]
        assert events[-1] == "下一题"
        assert json.loads(await control(request()))["status"] == "STALE"
        assert len(submissions) == 1
        # A timed-out answer becomes durable later: status checks recover it,
        # without posting again or reading a stale question.
        async def late_checkpoint(runtime):
            return {"progress": {"completedTurns": 3}, "nextQuestion": {"id": "q4", "text": "恢复后的问题"}}
        monkeypatch.setattr(worker, "_load_authoritative_for_turn", late_checkpoint)
        sessions[0].runtime.submission_pending = True
        sessions[0].runtime.processing_stage = "recovery"
        await status(SimpleNamespace(caller_identity="candidate-test"))
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert sessions[0].runtime.submission_pending is False
        assert sessions[0].runtime.sequence_number == 4
        assert events[-1] == "恢复后的问题"
        assert len(submissions) == 1
    asyncio.run(run())
