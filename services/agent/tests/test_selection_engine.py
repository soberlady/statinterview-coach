from __future__ import annotations

from statinterview_agent import (
    AbilityEstimator,
    InterviewAction,
    InterviewPolicyEngine,
    Question,
    QuestionSelector,
    ReliabilitySignals,
    RubricCriterion,
    SelectionContext,
    SkillDimension,
    VerificationBudget,
)


def _question(
    question_id: str,
    skill: SkillDimension,
    difficulty: float,
    *,
    relevance: float = 0.5,
) -> Question:
    return Question(
        id=question_id,
        skill=skill,
        difficulty=difficulty,
        jd_relevance=relevance,
        expected_seconds=90,
        prompt=f"Question {question_id}",
        rubric=(
            RubricCriterion(id="core", description="核心知识点", weight=1.0),
        ),
    )


def test_selector_prefers_information_rich_question_when_other_signals_equal() -> None:
    skill = SkillDimension.STATISTICS_ML
    prior = AbilityEstimator.create_prior(skill)
    questions = (
        _question("near", skill, 0.75),
        _question("extreme", skill, 3.0),
    )
    decision = QuestionSelector().select_next(
        questions=questions,
        posteriors={skill: prior},
        context=SelectionContext(
            questions_answered_by_skill={skill: 1},
            job_weights={skill: 1.0},
        ),
    )

    assert decision.question_id == "near"
    assert decision.difficulty_match == 0.75


def test_selector_prevents_three_consecutive_questions_for_same_skill() -> None:
    statistics = SkillDimension.STATISTICS_ML
    business = SkillDimension.BUSINESS_ANALYSIS
    posteriors = {
        statistics: AbilityEstimator.create_prior(statistics),
        business: AbilityEstimator.create_prior(business),
    }
    questions = (
        _question("stats", statistics, 0.0, relevance=1.0),
        _question("business", business, 0.0, relevance=0.1),
    )
    decision = QuestionSelector().select_next(
        questions=questions,
        posteriors=posteriors,
        context=SelectionContext(
            last_skill=statistics,
            consecutive_same_skill=2,
            job_weights={statistics: 1.0, business: 0.1},
        ),
    )

    assert decision.question_id == "business"


def test_engine_does_not_update_ability_before_verification(basic_question) -> None:
    prior = AbilityEstimator.create_prior(basic_question.skill)
    result = InterviewPolicyEngine().process_turn(
        question=basic_question,
        posterior=prior,
        outcome=0.8,
        reliability_signals=ReliabilitySignals(
            evidence_coverage=0.2,
            transcript_completeness=0.95,
            answer_units=50,
            primary_score=3.2,
        ),
        verification_budget=VerificationBudget(),
        missing_points=("样本量与统计功效",),
    )

    assert result.action is InterviewAction.VERIFY
    assert result.updated_posterior is None
    assert result.verification_question == "请说明如何估计实验所需样本量。"


def test_engine_updates_ability_for_accepted_evidence(basic_question) -> None:
    prior = AbilityEstimator.create_prior(basic_question.skill)
    prior_mean = AbilityEstimator.summary(prior).mean
    result = InterviewPolicyEngine().process_turn(
        question=basic_question,
        posterior=prior,
        outcome=1.0,
        reliability_signals=ReliabilitySignals(
            evidence_coverage=1.0,
            transcript_completeness=1.0,
            answer_units=80,
            primary_score=3.5,
            review_score=3.4,
        ),
        verification_budget=VerificationBudget(),
    )

    assert result.action is InterviewAction.ACCEPT
    assert result.updated_posterior is not None
    assert AbilityEstimator.summary(result.updated_posterior).mean > prior_mean
