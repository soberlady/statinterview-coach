from __future__ import annotations

import pytest

from statinterview_agent import AbilityEstimator, SkillDimension


def test_prior_is_normalized_and_symmetric() -> None:
    prior = AbilityEstimator.create_prior(SkillDimension.STATISTICS_ML)
    summary = AbilityEstimator.summary(prior)

    assert sum(prior.probabilities) == pytest.approx(1.0)
    assert summary.mean == pytest.approx(0.0, abs=1e-12)
    assert summary.lower_credible_bound == pytest.approx(
        -summary.upper_credible_bound
    )


def test_correct_and_incorrect_answers_move_mean_in_opposite_directions() -> None:
    prior = AbilityEstimator.create_prior(SkillDimension.STATISTICS_ML)
    correct = AbilityEstimator.update(prior, difficulty=0.0, outcome=1.0)
    incorrect = AbilityEstimator.update(prior, difficulty=0.0, outcome=0.0)

    assert AbilityEstimator.summary(correct).mean > 0.0
    assert AbilityEstimator.summary(incorrect).mean < 0.0


def test_fractional_outcome_is_supported() -> None:
    prior = AbilityEstimator.create_prior(SkillDimension.BUSINESS_ANALYSIS)
    posterior = AbilityEstimator.update(prior, difficulty=0.5, outcome=0.75)

    assert sum(posterior.probabilities) == pytest.approx(1.0)
    assert AbilityEstimator.summary(posterior).mean > AbilityEstimator.summary(prior).mean


def test_information_gain_is_higher_near_current_ability() -> None:
    prior = AbilityEstimator.create_prior(SkillDimension.STATISTICS_ML)
    centered = AbilityEstimator.expected_information_gain(prior, difficulty=0.0)
    extreme = AbilityEstimator.expected_information_gain(prior, difficulty=3.0)

    assert centered > extreme
    assert centered > 0.0

