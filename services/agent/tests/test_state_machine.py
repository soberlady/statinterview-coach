from __future__ import annotations

import pytest

from statinterview_agent import (
    InterviewState,
    InterviewStateMachine,
    InvalidStateTransition,
)


def test_happy_path_reaches_completed() -> None:
    machine = InterviewStateMachine("session-1")
    for target in (
        InterviewState.PREPARING,
        InterviewState.ANCHOR_INTERVIEW,
        InterviewState.ADAPTIVE_INTERVIEW,
        InterviewState.FINALIZING,
        InterviewState.COMPLETED,
    ):
        machine.transition(target, reason=f"move to {target}")

    assert machine.state is InterviewState.COMPLETED
    assert machine.snapshot.version == 5
    assert len(machine.snapshot.history) == 5


def test_invalid_transition_is_rejected() -> None:
    machine = InterviewStateMachine("session-2")
    with pytest.raises(InvalidStateTransition):
        machine.transition(InterviewState.COMPLETED, reason="skip all work")


def test_pause_and_recovery_restore_exact_state() -> None:
    machine = InterviewStateMachine("session-3")
    machine.transition(InterviewState.PREPARING, reason="configuration ready")
    machine.transition(InterviewState.ANCHOR_INTERVIEW, reason="start anchors")
    machine.transition(InterviewState.ADAPTIVE_INTERVIEW, reason="anchors complete")

    machine.pause(reason="connection lost")
    assert machine.snapshot.resume_state is InterviewState.ADAPTIVE_INTERVIEW
    machine.begin_recovery(reason="participant reconnected")
    machine.complete_recovery(reason="checkpoint loaded")

    assert machine.state is InterviewState.ADAPTIVE_INTERVIEW
    assert machine.snapshot.resume_state is None


def test_terminal_state_cannot_be_reopened() -> None:
    machine = InterviewStateMachine("session-4")
    machine.transition(InterviewState.CANCELLED, reason="user cancelled")
    with pytest.raises(InvalidStateTransition):
        machine.transition(InterviewState.PREPARING, reason="reopen")

