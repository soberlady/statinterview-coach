from __future__ import annotations

import pytest

from statinterview_agent import (
    AnswerEvaluation,
    CriterionAssessment,
    CriterionVerdict,
    InterviewAction,
    ReliabilityClassifier,
    ReliabilityLevel,
    ReliabilitySignals,
    VerificationBudget,
    score_rubric_answer,
)


def test_rubric_score_is_aggregated_in_code(basic_question) -> None:
    evaluation = AnswerEvaluation(
        question_id=basic_question.id,
        assessments=(
            CriterionAssessment(
                criterion_id="hypothesis",
                verdict=CriterionVerdict.MET,
                evidence=("我会先定义原假设。",),
            ),
            CriterionAssessment(
                criterion_id="power",
                verdict=CriterionVerdict.PARTIAL,
                evidence=("样本不能太少。",),
            ),
        ),
    )

    result = score_rubric_answer(basic_question, evaluation)

    assert result.normalized_score == pytest.approx(0.75)
    assert result.score_out_of_four == pytest.approx(3.0)
    assert result.evidence_coverage == pytest.approx(1.0)


def test_missing_criterion_is_rejected(basic_question) -> None:
    evaluation = AnswerEvaluation(
        question_id=basic_question.id,
        assessments=(
            CriterionAssessment(
                criterion_id="hypothesis",
                verdict=CriterionVerdict.MET,
            ),
        ),
    )

    with pytest.raises(ValueError, match="criterion mismatch"):
        score_rubric_answer(basic_question, evaluation)


def test_high_reliability_is_accepted() -> None:
    decision = ReliabilityClassifier().decide(
        ReliabilitySignals(
            evidence_coverage=0.9,
            transcript_completeness=0.95,
            answer_units=80,
            primary_score=3.2,
            review_score=3.0,
        ),
        VerificationBudget(),
    )

    assert decision.reliability is ReliabilityLevel.HIGH
    assert decision.action is InterviewAction.ACCEPT


def test_low_reliability_requests_bounded_verification() -> None:
    decision = ReliabilityClassifier().decide(
        ReliabilitySignals(
            evidence_coverage=0.2,
            transcript_completeness=0.9,
            answer_units=50,
            primary_score=2.0,
        ),
        VerificationBudget(),
    )

    assert decision.reliability is ReliabilityLevel.LOW
    assert decision.action is InterviewAction.VERIFY


def test_low_reliability_abstains_when_budget_is_exhausted() -> None:
    decision = ReliabilityClassifier().decide(
        ReliabilitySignals(
            evidence_coverage=0.2,
            transcript_completeness=0.4,
            answer_units=3,
            primary_score=2.0,
        ),
        VerificationBudget(total_verifications=3),
    )

    assert decision.action is InterviewAction.ABSTAIN
    assert "verification budget is exhausted" in decision.reasons

