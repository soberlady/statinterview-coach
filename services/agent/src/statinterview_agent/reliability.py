"""Observable-signal reliability classification and bounded verification."""

from __future__ import annotations

from .models import (
    InterviewAction,
    ReliabilityLevel,
    ReliabilitySignals,
    VerificationBudget,
    VerificationDecision,
)


class ReliabilityClassifier:
    """Rule policy that does not consume a model's self-reported confidence."""

    def classify(self, signals: ReliabilitySignals) -> tuple[ReliabilityLevel, tuple[str, ...]]:
        low_reasons: list[str] = []
        medium_reasons: list[str] = []

        if not signals.schema_valid:
            low_reasons.append("structured evaluation failed schema validation")
        if signals.evidence_coverage < 0.40:
            low_reasons.append("supporting evidence coverage is below 40%")
        elif signals.evidence_coverage < 0.70:
            medium_reasons.append("supporting evidence coverage is below 70%")

        if signals.transcript_completeness < 0.65:
            low_reasons.append("transcript appears substantially incomplete")
        elif signals.transcript_completeness < 0.85:
            medium_reasons.append("transcript may be incomplete")

        if signals.answer_units < 8:
            low_reasons.append("answer is too short to support a stable score")
        elif signals.answer_units < 20:
            medium_reasons.append("answer contains limited detail")

        if signals.review_score is not None:
            disagreement = abs(signals.primary_score - signals.review_score)
            if disagreement >= 1.0:
                low_reasons.append("primary and review scorers differ by at least 1 point")
            elif disagreement >= 0.5:
                medium_reasons.append("primary and review scorers disagree")

        if abs(signals.primary_score - signals.mastery_threshold) <= 0.25:
            medium_reasons.append("score is near the mastery decision boundary")

        if low_reasons:
            return ReliabilityLevel.LOW, tuple(low_reasons + medium_reasons)
        if medium_reasons:
            return ReliabilityLevel.MEDIUM, tuple(medium_reasons)
        return ReliabilityLevel.HIGH, ()

    def decide(
        self,
        signals: ReliabilitySignals,
        budget: VerificationBudget,
    ) -> VerificationDecision:
        reliability, reasons = self.classify(signals)
        if reliability is ReliabilityLevel.LOW:
            action = (
                InterviewAction.VERIFY
                if budget.available
                else InterviewAction.ABSTAIN
            )
            if action is InterviewAction.ABSTAIN:
                reasons = reasons + ("verification budget is exhausted",)
        else:
            action = InterviewAction.ACCEPT
        return VerificationDecision(
            reliability=reliability,
            action=action,
            reasons=reasons,
        )


def build_verification_question(
    *,
    missing_points: tuple[str, ...],
    approved_questions: tuple[str, ...] = (),
) -> str:
    """Choose an approved follow-up, or build one bounded evidence request."""

    if approved_questions:
        return approved_questions[0]
    if missing_points:
        return f"请具体补充说明：{missing_points[0]}。"
    return "请用一个具体例子说明你刚才结论的依据。"

