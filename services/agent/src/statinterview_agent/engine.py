"""Small facade combining the deterministic decision policies."""

from __future__ import annotations

from .ability import AbilityEstimator
from .models import (
    AbilityPosterior,
    InterviewAction,
    Question,
    ReliabilitySignals,
    TurnPolicyResult,
    VerificationBudget,
)
from .reliability import ReliabilityClassifier, build_verification_question


class InterviewPolicyEngine:
    """Apply reliability policy before allowing evidence to change ability."""

    def __init__(
        self,
        reliability_classifier: ReliabilityClassifier | None = None,
    ) -> None:
        self.reliability_classifier = (
            reliability_classifier or ReliabilityClassifier()
        )

    def process_turn(
        self,
        *,
        question: Question,
        posterior: AbilityPosterior,
        outcome: float,
        reliability_signals: ReliabilitySignals,
        verification_budget: VerificationBudget,
        missing_points: tuple[str, ...] = (),
    ) -> TurnPolicyResult:
        if posterior.skill is not question.skill:
            raise ValueError("question and posterior skill do not match")

        decision = self.reliability_classifier.decide(
            reliability_signals,
            verification_budget,
        )
        if decision.action is InterviewAction.ACCEPT:
            updated = AbilityEstimator.update(
                posterior,
                difficulty=question.difficulty,
                outcome=outcome,
            )
            follow_up = None
        elif decision.action is InterviewAction.VERIFY:
            updated = None
            follow_up = build_verification_question(
                missing_points=missing_points,
                approved_questions=question.verification_questions,
            )
        else:
            updated = None
            follow_up = None

        return TurnPolicyResult(
            reliability=decision.reliability,
            action=decision.action,
            reasons=decision.reasons,
            updated_posterior=updated,
            verification_question=follow_up,
        )

