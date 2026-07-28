"""Discrete Bayesian ability estimation with a simplified Rasch model."""

from __future__ import annotations

from math import exp, log, sqrt

from .models import AbilityPosterior, AbilitySummary, SkillDimension


_EPSILON = 1e-12


def _sigmoid(value: float) -> float:
    if value >= 0:
        inverse = exp(-value)
        return 1.0 / (1.0 + inverse)
    direct = exp(value)
    return direct / (1.0 + direct)


def _normalise(values: list[float]) -> tuple[float, ...]:
    total = sum(values)
    if total <= 0.0:
        raise ValueError("posterior has zero probability mass")
    return tuple(value / total for value in values)


def _entropy(probabilities: tuple[float, ...]) -> float:
    return -sum(
        probability * log(probability)
        for probability in probabilities
        if probability > 0.0
    )


class AbilityEstimator:
    """Pure functions for creating, updating, and summarising ability beliefs."""

    @staticmethod
    def create_prior(
        skill: SkillDimension,
        *,
        lower: float = -3.0,
        upper: float = 3.0,
        step: float = 0.1,
        mean: float = 0.0,
        standard_deviation: float = 1.0,
    ) -> AbilityPosterior:
        if lower >= upper:
            raise ValueError("lower must be less than upper")
        if step <= 0.0:
            raise ValueError("step must be positive")
        if standard_deviation <= 0.0:
            raise ValueError("standard_deviation must be positive")

        count = int(round((upper - lower) / step))
        theta_grid = tuple(round(lower + index * step, 10) for index in range(count + 1))
        unnormalised = [
            exp(-0.5 * ((theta - mean) / standard_deviation) ** 2)
            for theta in theta_grid
        ]
        return AbilityPosterior(
            skill=skill,
            theta_grid=theta_grid,
            probabilities=_normalise(unnormalised),
        )

    @staticmethod
    def probability_correct(theta: float, difficulty: float) -> float:
        return _sigmoid(theta - difficulty)

    @classmethod
    def update(
        cls,
        posterior: AbilityPosterior,
        *,
        difficulty: float,
        outcome: float,
    ) -> AbilityPosterior:
        """Update from binary or fractional rubric evidence in ``[0, 1]``."""

        if not 0.0 <= outcome <= 1.0:
            raise ValueError("outcome must be in [0, 1]")
        likelihood_weighted: list[float] = []
        for theta, prior_probability in zip(
            posterior.theta_grid, posterior.probabilities
        ):
            correct_probability = min(
                max(cls.probability_correct(theta, difficulty), _EPSILON),
                1.0 - _EPSILON,
            )
            likelihood = (
                correct_probability**outcome
                * (1.0 - correct_probability) ** (1.0 - outcome)
            )
            likelihood_weighted.append(prior_probability * likelihood)

        return posterior.model_copy(
            update={"probabilities": _normalise(likelihood_weighted)}
        )

    @classmethod
    def expected_information_gain(
        cls,
        posterior: AbilityPosterior,
        *,
        difficulty: float,
    ) -> float:
        """Expected entropy reduction for a binary response to one question."""

        response_probabilities = [
            cls.probability_correct(theta, difficulty)
            for theta in posterior.theta_grid
        ]
        predictive_correct = sum(
            prior * response
            for prior, response in zip(
                posterior.probabilities, response_probabilities
            )
        )
        correct_posterior = cls.update(
            posterior, difficulty=difficulty, outcome=1.0
        )
        incorrect_posterior = cls.update(
            posterior, difficulty=difficulty, outcome=0.0
        )
        expected_entropy = (
            predictive_correct * _entropy(correct_posterior.probabilities)
            + (1.0 - predictive_correct)
            * _entropy(incorrect_posterior.probabilities)
        )
        return max(0.0, _entropy(posterior.probabilities) - expected_entropy)

    @staticmethod
    def summary(
        posterior: AbilityPosterior,
        *,
        credible_mass: float = 0.90,
    ) -> AbilitySummary:
        if not 0.0 < credible_mass < 1.0:
            raise ValueError("credible_mass must be in (0, 1)")

        mean = sum(
            theta * probability
            for theta, probability in zip(
                posterior.theta_grid, posterior.probabilities
            )
        )
        variance = sum(
            probability * (theta - mean) ** 2
            for theta, probability in zip(
                posterior.theta_grid, posterior.probabilities
            )
        )
        tail = (1.0 - credible_mass) / 2.0
        lower = AbilityEstimator._quantile(posterior, tail)
        upper = AbilityEstimator._quantile(posterior, 1.0 - tail)
        return AbilitySummary(
            skill=posterior.skill,
            mean=mean,
            standard_deviation=sqrt(max(0.0, variance)),
            lower_credible_bound=lower,
            upper_credible_bound=upper,
            entropy=_entropy(posterior.probabilities),
        )

    @staticmethod
    def _quantile(posterior: AbilityPosterior, probability: float) -> float:
        cumulative = 0.0
        for theta, mass in zip(posterior.theta_grid, posterior.probabilities):
            cumulative += mass
            if cumulative >= probability:
                return theta
        return posterior.theta_grid[-1]

