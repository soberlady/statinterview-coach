"""Explicit and recoverable interview lifecycle."""

from __future__ import annotations

from dataclasses import dataclass

from .models import (
    InterviewSnapshot,
    InterviewState,
    StateTransition,
)


class InvalidStateTransition(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class StatePolicy:
    max_duration_seconds: int
    max_retries: int
    allowed_tools: tuple[str, ...]


STATE_POLICIES: dict[InterviewState, StatePolicy] = {
    InterviewState.CREATED: StatePolicy(60, 0, ()),
    InterviewState.PREPARING: StatePolicy(
        120, 2, ("analyze_job_description", "load_interview_context")
    ),
    InterviewState.ANCHOR_INTERVIEW: StatePolicy(
        600,
        2,
        ("retrieve_questions", "evaluate_answer", "update_ability_state", "save_checkpoint"),
    ),
    InterviewState.ADAPTIVE_INTERVIEW: StatePolicy(
        900,
        2,
        (
            "retrieve_questions",
            "evaluate_answer",
            "update_ability_state",
            "select_next_question",
            "save_checkpoint",
        ),
    ),
    InterviewState.VERIFYING: StatePolicy(
        180, 1, ("evaluate_answer", "update_ability_state", "save_checkpoint")
    ),
    InterviewState.FINALIZING: StatePolicy(
        180, 2, ("generate_training_report", "save_checkpoint")
    ),
    InterviewState.COMPLETED: StatePolicy(0, 0, ()),
    InterviewState.PAUSED: StatePolicy(86_400, 0, ("save_checkpoint",)),
    InterviewState.RECOVERING: StatePolicy(
        120, 2, ("load_interview_context", "save_checkpoint")
    ),
    InterviewState.FAILED: StatePolicy(0, 0, ()),
    InterviewState.CANCELLED: StatePolicy(0, 0, ()),
}


_ALLOWED_TRANSITIONS: dict[InterviewState, frozenset[InterviewState]] = {
    InterviewState.CREATED: frozenset(
        {InterviewState.PREPARING, InterviewState.FAILED, InterviewState.CANCELLED}
    ),
    InterviewState.PREPARING: frozenset(
        {
            InterviewState.ANCHOR_INTERVIEW,
            InterviewState.PAUSED,
            InterviewState.FAILED,
            InterviewState.CANCELLED,
        }
    ),
    InterviewState.ANCHOR_INTERVIEW: frozenset(
        {
            InterviewState.ADAPTIVE_INTERVIEW,
            InterviewState.VERIFYING,
            InterviewState.FINALIZING,
            InterviewState.PAUSED,
            InterviewState.FAILED,
            InterviewState.CANCELLED,
        }
    ),
    InterviewState.ADAPTIVE_INTERVIEW: frozenset(
        {
            InterviewState.VERIFYING,
            InterviewState.FINALIZING,
            InterviewState.PAUSED,
            InterviewState.FAILED,
            InterviewState.CANCELLED,
        }
    ),
    InterviewState.VERIFYING: frozenset(
        {
            InterviewState.ANCHOR_INTERVIEW,
            InterviewState.ADAPTIVE_INTERVIEW,
            InterviewState.FINALIZING,
            InterviewState.PAUSED,
            InterviewState.FAILED,
            InterviewState.CANCELLED,
        }
    ),
    InterviewState.FINALIZING: frozenset(
        {
            InterviewState.COMPLETED,
            InterviewState.PAUSED,
            InterviewState.FAILED,
            InterviewState.CANCELLED,
        }
    ),
    InterviewState.PAUSED: frozenset(
        {InterviewState.RECOVERING, InterviewState.FAILED, InterviewState.CANCELLED}
    ),
    InterviewState.RECOVERING: frozenset(
        {
            InterviewState.PREPARING,
            InterviewState.ANCHOR_INTERVIEW,
            InterviewState.ADAPTIVE_INTERVIEW,
            InterviewState.VERIFYING,
            InterviewState.FINALIZING,
            InterviewState.FAILED,
            InterviewState.CANCELLED,
        }
    ),
    InterviewState.COMPLETED: frozenset(),
    InterviewState.FAILED: frozenset(),
    InterviewState.CANCELLED: frozenset(),
}


class InterviewStateMachine:
    def __init__(
        self,
        session_id: str,
        snapshot: InterviewSnapshot | None = None,
    ) -> None:
        self._snapshot = snapshot or InterviewSnapshot(session_id=session_id)
        if self._snapshot.session_id != session_id:
            raise ValueError("snapshot belongs to a different session")

    @property
    def snapshot(self) -> InterviewSnapshot:
        return self._snapshot

    @property
    def state(self) -> InterviewState:
        return self._snapshot.state

    @property
    def policy(self) -> StatePolicy:
        return STATE_POLICIES[self.state]

    def transition(
        self,
        target: InterviewState,
        *,
        reason: str,
    ) -> InterviewSnapshot:
        current = self.state
        if target not in _ALLOWED_TRANSITIONS[current]:
            raise InvalidStateTransition(f"{current} cannot transition to {target}")

        if current is InterviewState.RECOVERING and target not in {
            InterviewState.FAILED,
            InterviewState.CANCELLED,
        }:
            if target is not self._snapshot.resume_state:
                raise InvalidStateTransition(
                    f"recovery must resume {self._snapshot.resume_state}, not {target}"
                )

        resume_state = self._snapshot.resume_state
        if target is InterviewState.PAUSED:
            resume_state = current
        elif current is InterviewState.RECOVERING and target is resume_state:
            resume_state = None

        next_version = self._snapshot.version + 1
        record = StateTransition(
            from_state=current,
            to_state=target,
            reason=reason,
            version=next_version,
        )
        self._snapshot = self._snapshot.model_copy(
            update={
                "state": target,
                "resume_state": resume_state,
                "version": next_version,
                "history": self._snapshot.history + (record,),
            }
        )
        return self._snapshot

    def pause(self, *, reason: str) -> InterviewSnapshot:
        return self.transition(InterviewState.PAUSED, reason=reason)

    def begin_recovery(self, *, reason: str) -> InterviewSnapshot:
        return self.transition(InterviewState.RECOVERING, reason=reason)

    def complete_recovery(self, *, reason: str) -> InterviewSnapshot:
        if self.state is not InterviewState.RECOVERING:
            raise InvalidStateTransition("session is not recovering")
        if self._snapshot.resume_state is None:
            raise InvalidStateTransition("session has no recovery target")
        return self.transition(self._snapshot.resume_state, reason=reason)

