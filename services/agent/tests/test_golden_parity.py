from __future__ import annotations

import json
from math import log
from pathlib import Path

import pytest

from statinterview_agent import AbilityEstimator, SkillDimension


FIXTURE = json.loads(
    (
        Path(__file__).resolve().parents[3]
        / "tests"
        / "fixtures"
        / "policy-parity.json"
    ).read_text(encoding="utf-8")
)


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=lambda case: case["name"])
def test_python_policy_matches_shared_golden_fixture(case) -> None:
    prior = AbilityEstimator.create_prior(
        SkillDimension.STATISTICS_ML,
        mean=FIXTURE["prior"]["mean"],
        standard_deviation=FIXTURE["prior"]["standardDeviation"],
    )
    posterior = AbilityEstimator.update(
        prior,
        difficulty=case["difficulty"],
        outcome=case["outcome"],
    )
    summary = AbilityEstimator.summary(posterior)
    utility_input = FIXTURE["utilityInput"]
    information_gain = AbilityEstimator.expected_information_gain(
        posterior,
        difficulty=utility_input["difficulty"],
    )
    normalized_information_gain = min(
        max(information_gain / log(2.0), 0.0),
        1.0,
    )
    jd_relevance = min(
        max(
            0.5 * utility_input["questionRelevance"]
            + 0.5
            * utility_input["skillJobWeight"]
            / utility_input["maxJobWeight"],
            0.0,
        ),
        1.0,
    )
    coverage_need = 1.0 / (utility_input["answeredCount"] + 1)
    difficulty_match = max(
        0.0,
        1.0
        - abs(
            utility_input["difficulty"]
            - utility_input["preferredDifficulty"]
        )
        / 3.0,
    )
    time_cost = min(
        utility_input["expectedSeconds"]
        / utility_input["remainingSeconds"],
        1.0,
    )
    utility = (
        0.45 * normalized_information_gain
        + 0.25 * jd_relevance
        + 0.15 * coverage_need
        + 0.15 * difficulty_match
        - 0.10 * time_cost
    )
    expected = case["expected"]

    assert summary.mean == pytest.approx(expected["mean"], abs=1e-10)
    assert summary.standard_deviation == pytest.approx(
        expected["standardDeviation"], abs=1e-10
    )
    assert summary.lower_credible_bound == expected["lowerCredibleBound"]
    assert summary.upper_credible_bound == expected["upperCredibleBound"]
    assert summary.entropy == pytest.approx(expected["entropy"], abs=1e-10)
    assert information_gain == pytest.approx(
        expected["informationGain"], abs=1e-10
    )
    assert normalized_information_gain == pytest.approx(
        expected["normalizedInformationGain"], abs=1e-10
    )
    assert jd_relevance == pytest.approx(
        expected["jdRelevance"], abs=1e-10
    )
    assert coverage_need == pytest.approx(
        expected["coverageNeed"], abs=1e-10
    )
    assert difficulty_match == pytest.approx(
        expected["difficultyMatch"], abs=1e-10
    )
    assert time_cost == pytest.approx(expected["timeCost"], abs=1e-10)
    assert utility == pytest.approx(expected["utility"], abs=1e-10)
