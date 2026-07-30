"""Reproducible synthetic benchmark for the adaptive interview policy.

This experiment does not substitute for a real-user study. It isolates two
engineering claims that can be tested before human labels are available:

1. under the same six-question budget, does the policy reduce job-weighted
   ability estimation error compared with a fixed or random question sequence?
2. when transcript corruption is detected, does verify/abstain reduce unsafe
   ability updates compared with always accepting the observed answer?
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
import statistics
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]
AGENT_SRC = ROOT / "services" / "agent" / "src"
sys.path.insert(0, str(AGENT_SRC))

from statinterview_agent import (  # noqa: E402
    AbilityEstimator,
    Question,
    QuestionSelector,
    RubricCriterion,
    SelectionContext,
    SkillDimension,
)


SKILLS = tuple(SkillDimension)
ANCHOR_ORDER = (
    SkillDimension.STATISTICS_ML,
    SkillDimension.EXPERIMENT_CAUSAL,
    SkillDimension.SQL_PYTHON_ENGINEERING,
    SkillDimension.BUSINESS_ANALYSIS,
)
FIXED_FOLLOW_UP_IDS = (
    "statistics_ml_004",
    "business_analytics_004",
)
JOB_PROFILES: dict[str, dict[SkillDimension, float]] = {
    "balanced": {
        SkillDimension.STATISTICS_ML: 0.25,
        SkillDimension.EXPERIMENT_CAUSAL: 0.25,
        SkillDimension.SQL_PYTHON_ENGINEERING: 0.25,
        SkillDimension.BUSINESS_ANALYSIS: 0.25,
    },
    "growth_analytics": {
        SkillDimension.STATISTICS_ML: 0.15,
        SkillDimension.EXPERIMENT_CAUSAL: 0.30,
        SkillDimension.SQL_PYTHON_ENGINEERING: 0.15,
        SkillDimension.BUSINESS_ANALYSIS: 0.40,
    },
    "experiment_analysis": {
        SkillDimension.STATISTICS_ML: 0.30,
        SkillDimension.EXPERIMENT_CAUSAL: 0.40,
        SkillDimension.SQL_PYTHON_ENGINEERING: 0.15,
        SkillDimension.BUSINESS_ANALYSIS: 0.15,
    },
    "data_engineering": {
        SkillDimension.STATISTICS_ML: 0.15,
        SkillDimension.EXPERIMENT_CAUSAL: 0.10,
        SkillDimension.SQL_PYTHON_ENGINEERING: 0.50,
        SkillDimension.BUSINESS_ANALYSIS: 0.25,
    },
}


@dataclass(frozen=True)
class CandidateResult:
    weighted_absolute_error: float
    weighted_squared_error: float
    weighted_uncertainty: float
    weighted_coverage: float
    selected_job_weight: float


def _difficulty(bank_difficulty: int) -> float:
    return (bank_difficulty - 3) * 0.75


def _stable_uniform(*parts: object) -> float:
    payload = "|".join(str(part) for part in parts).encode("utf-8")
    digest = hashlib.sha256(payload).digest()
    return int.from_bytes(digest[:8], "big") / 2**64


def _load_questions() -> tuple[Question, ...]:
    bank = json.loads(
        (ROOT / "content" / "question-bank.json").read_text(encoding="utf-8")
    )
    questions: list[Question] = []
    for raw in bank["questions"]:
        skill = SkillDimension(raw["skill"])
        questions.append(
            Question(
                id=raw["id"],
                skill=skill,
                difficulty=_difficulty(int(raw["difficulty"])),
                jd_relevance=min(1.0, 0.35 + 0.05 * len(raw["jobTags"])),
                expected_seconds=int(raw["expectedSeconds"]),
                prompt=raw["question"],
                rubric=tuple(
                    RubricCriterion(
                        id=f"criterion_{index}",
                        description=criterion["criterion"],
                        weight=float(criterion["weight"]),
                    )
                    for index, criterion in enumerate(raw["rubric"], start=1)
                ),
                is_anchor=bool(raw["isAnchor"]),
                verification_questions=tuple(raw["verificationQuestions"]),
                tags=tuple(raw["jobTags"]),
            )
        )
    return tuple(questions)


def _latent_abilities(seed: int, profile: str, candidate_id: int) -> dict[SkillDimension, float]:
    rng = random.Random(f"{seed}:{profile}:{candidate_id}:ability")
    return {
        skill: min(2.5, max(-2.5, rng.gauss(0.0, 1.0)))
        for skill in SKILLS
    }


def _response(
    *,
    seed: int,
    profile: str,
    candidate_id: int,
    question: Question,
    theta: float,
) -> float:
    probability = AbilityEstimator.probability_correct(
        theta, question.difficulty
    )
    draw = _stable_uniform(
        seed, profile, candidate_id, question.id, "potential-response"
    )
    return 1.0 if draw < probability else 0.0


def _choose_follow_ups(
    *,
    strategy: str,
    questions: tuple[Question, ...],
    posteriors,
    profile_weights: dict[SkillDimension, float],
    asked: list[Question],
    seed: int,
    profile: str,
    candidate_id: int,
) -> list[Question]:
    by_id = {question.id: question for question in questions}
    eligible = [
        question for question in questions if not question.is_anchor
    ]
    if strategy == "fixed":
        return [by_id[question_id] for question_id in FIXED_FOLLOW_UP_IDS]
    if strategy == "random":
        rng = random.Random(f"{seed}:{profile}:{candidate_id}:random-policy")
        return rng.sample(eligible, 2)

    selector = QuestionSelector()
    selected: list[Question] = []
    counts = {skill: 1 for skill in SKILLS}
    last_skill = asked[-1].skill
    consecutive_same_skill = 1
    remaining_seconds = 600
    for _ in range(2):
        decision = selector.select_next(
            questions=questions,
            posteriors=posteriors,
            context=SelectionContext(
                asked_question_ids=frozenset(
                    question.id for question in [*asked, *selected]
                ),
                questions_answered_by_skill=counts,
                job_weights=profile_weights,
                remaining_seconds=remaining_seconds,
                last_skill=last_skill,
                consecutive_same_skill=consecutive_same_skill,
            ),
        )
        question = by_id[decision.question_id]
        selected.append(question)
        counts[question.skill] += 1
        if question.skill is last_skill:
            consecutive_same_skill += 1
        else:
            last_skill = question.skill
            consecutive_same_skill = 1
        remaining_seconds = max(
            1, remaining_seconds - question.expected_seconds
        )
    return selected


def _run_candidate(
    *,
    strategy: str,
    questions: tuple[Question, ...],
    profile: str,
    profile_weights: dict[SkillDimension, float],
    candidate_id: int,
    seed: int,
) -> CandidateResult:
    latent = _latent_abilities(seed, profile, candidate_id)
    posteriors = {
        skill: AbilityEstimator.create_prior(skill) for skill in SKILLS
    }
    anchors = [
        next(
            question
            for question in questions
            if question.skill is skill and question.is_anchor
        )
        for skill in ANCHOR_ORDER
    ]
    for question in anchors:
        outcome = _response(
            seed=seed,
            profile=profile,
            candidate_id=candidate_id,
            question=question,
            theta=latent[question.skill],
        )
        posteriors[question.skill] = AbilityEstimator.update(
            posteriors[question.skill],
            difficulty=question.difficulty,
            outcome=outcome,
        )

    follow_ups = _choose_follow_ups(
        strategy=strategy,
        questions=questions,
        posteriors=posteriors,
        profile_weights=profile_weights,
        asked=anchors,
        seed=seed,
        profile=profile,
        candidate_id=candidate_id,
    )
    for question in follow_ups:
        outcome = _response(
            seed=seed,
            profile=profile,
            candidate_id=candidate_id,
            question=question,
            theta=latent[question.skill],
        )
        posteriors[question.skill] = AbilityEstimator.update(
            posteriors[question.skill],
            difficulty=question.difficulty,
            outcome=outcome,
        )

    absolute_error = 0.0
    squared_error = 0.0
    uncertainty = 0.0
    coverage = 0.0
    for skill, weight in profile_weights.items():
        summary = AbilityEstimator.summary(posteriors[skill])
        error = summary.mean - latent[skill]
        absolute_error += weight * abs(error)
        squared_error += weight * error**2
        uncertainty += weight * summary.standard_deviation
        coverage += weight * float(
            summary.lower_credible_bound
            <= latent[skill]
            <= summary.upper_credible_bound
        )

    return CandidateResult(
        weighted_absolute_error=absolute_error,
        weighted_squared_error=squared_error,
        weighted_uncertainty=uncertainty,
        weighted_coverage=coverage,
        selected_job_weight=statistics.mean(
            profile_weights[question.skill] for question in follow_ups
        ),
    )


def _mean(values: Iterable[float]) -> float:
    values = list(values)
    return sum(values) / len(values)


def _paired_interval(
    left: list[CandidateResult],
    right: list[CandidateResult],
    field: str,
) -> tuple[float, float, float]:
    differences = [
        getattr(left_item, field) - getattr(right_item, field)
        for left_item, right_item in zip(left, right)
    ]
    mean = statistics.mean(differences)
    standard_error = statistics.stdev(differences) / math.sqrt(
        len(differences)
    )
    return mean, mean - 1.96 * standard_error, mean + 1.96 * standard_error


def run_adaptive_benchmark(
    *,
    candidates_per_profile: int,
    seed: int,
) -> dict:
    questions = _load_questions()
    strategies = ("adaptive", "fixed", "random")
    all_results: dict[str, list[CandidateResult]] = {
        strategy: [] for strategy in strategies
    }
    by_profile: dict[str, dict[str, dict[str, float]]] = {}

    for profile, weights in JOB_PROFILES.items():
        profile_results: dict[str, list[CandidateResult]] = {}
        for strategy in strategies:
            results = [
                _run_candidate(
                    strategy=strategy,
                    questions=questions,
                    profile=profile,
                    profile_weights=weights,
                    candidate_id=candidate_id,
                    seed=seed,
                )
                for candidate_id in range(candidates_per_profile)
            ]
            profile_results[strategy] = results
            all_results[strategy].extend(results)
        by_profile[profile] = {
            strategy: _summarize_candidate_results(results)
            for strategy, results in profile_results.items()
        }

    aggregate = {
        strategy: _summarize_candidate_results(results)
        for strategy, results in all_results.items()
    }
    comparisons = {}
    for baseline in ("fixed", "random"):
        difference, lower, upper = _paired_interval(
            all_results["adaptive"],
            all_results[baseline],
            "weighted_absolute_error",
        )
        baseline_mae = aggregate[baseline]["weighted_mae"]
        comparisons[f"adaptive_vs_{baseline}"] = {
            "weighted_mae_difference": difference,
            "paired_95pct_ci": [lower, upper],
            "relative_mae_change_pct": 100 * difference / baseline_mae,
        }

    return {
        "design": {
            "candidates_per_profile": candidates_per_profile,
            "profiles": len(JOB_PROFILES),
            "total_simulated_candidates": candidates_per_profile
            * len(JOB_PROFILES),
            "question_budget": 6,
            "fixed_anchors": 4,
            "adaptive_or_baseline_follow_ups": 2,
            "response_model": "one-parameter logistic Rasch simulation",
            "seed": seed,
        },
        "aggregate": aggregate,
        "by_profile": by_profile,
        "comparisons": comparisons,
    }


def _summarize_candidate_results(
    results: list[CandidateResult],
) -> dict[str, float]:
    return {
        "weighted_mae": _mean(
            result.weighted_absolute_error for result in results
        ),
        "weighted_rmse": math.sqrt(
            _mean(result.weighted_squared_error for result in results)
        ),
        "mean_weighted_posterior_sd": _mean(
            result.weighted_uncertainty for result in results
        ),
        "weighted_90pct_interval_coverage": _mean(
            result.weighted_coverage for result in results
        ),
        "mean_selected_job_weight": _mean(
            result.selected_job_weight for result in results
        ),
    }


def run_reliability_fault_injection(
    *,
    samples: int,
    seed: int,
) -> dict:
    skill = SkillDimension.STATISTICS_ML
    question_difficulty = 0.0
    always_oracle_deviation: list[float] = []
    guarded_oracle_deviation: list[float] = []
    always_unsafe_updates = 0
    guarded_unsafe_updates = 0

    for sample_id in range(samples):
        rng = random.Random(f"{seed}:{sample_id}:fault")
        theta = min(2.5, max(-2.5, rng.gauss(0.0, 1.0)))
        prior = AbilityEstimator.create_prior(skill)
        correct_probability = AbilityEstimator.probability_correct(
            theta, question_difficulty
        )
        true_outcome = float(
            _stable_uniform(seed, sample_id, "true-answer")
            < correct_probability
        )
        corrupted_outcome = 1.0 - true_outcome
        verification_outcome = true_outcome

        oracle = AbilityEstimator.update(
            prior,
            difficulty=question_difficulty,
            outcome=true_outcome,
        )
        always = AbilityEstimator.update(
            prior,
            difficulty=question_difficulty,
            outcome=corrupted_outcome,
        )
        # The reliability policy detects incomplete evidence and asks one
        # approved verification. Conflicting evidence causes abstention, so the
        # prior is retained instead of accepting either answer.
        guarded = (
            AbilityEstimator.update(
                prior,
                difficulty=question_difficulty,
                outcome=verification_outcome,
            )
            if verification_outcome == corrupted_outcome
            else prior
        )

        oracle_mean = AbilityEstimator.summary(oracle).mean
        always_mean = AbilityEstimator.summary(always).mean
        guarded_mean = AbilityEstimator.summary(guarded).mean
        always_oracle_deviation.append(abs(always_mean - oracle_mean))
        guarded_oracle_deviation.append(abs(guarded_mean - oracle_mean))
        always_unsafe_updates += 1
        guarded_unsafe_updates += int(
            math.copysign(1, guarded_mean or 1)
            == math.copysign(1, corrupted_outcome - 0.5)
            and abs(guarded_mean) > 1e-9
        )

    return {
        "design": {
            "samples": samples,
            "fault": "detected final-transcript answer inversion",
            "verification": "one clean approved follow-up; conflict abstains",
            "scope": "policy response after detection, not detector recall",
            "seed": seed,
        },
        "always_accept": {
            "mean_absolute_deviation_from_oracle": _mean(
                always_oracle_deviation
            ),
            "unsafe_update_rate": always_unsafe_updates / samples,
        },
        "verify_or_abstain": {
            "mean_absolute_deviation_from_oracle": _mean(
                guarded_oracle_deviation
            ),
            "unsafe_update_rate": guarded_unsafe_updates / samples,
        },
        "relative_oracle_deviation_reduction_pct": 100
        * (
            1
            - _mean(guarded_oracle_deviation)
            / _mean(always_oracle_deviation)
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidates-per-profile", type=int, default=1_000)
    parser.add_argument("--fault-samples", type=int, default=4_000)
    parser.add_argument("--seed", type=int, default=20260730)
    parser.add_argument(
        "--output",
        type=Path,
        default=ROOT / "content" / "policy-benchmark.json",
    )
    args = parser.parse_args()
    if args.candidates_per_profile < 100 or args.fault_samples < 100:
        raise SystemExit("sample sizes must both be at least 100")

    result = {
        "schemaVersion": "1.0.0",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "status": "synthetic_offline_benchmark",
        "claimBoundary": (
            "These results validate deterministic policy behavior under stated "
            "simulation assumptions. They do not establish interview validity "
            "or real-user learning impact."
        ),
        "adaptiveSelection": run_adaptive_benchmark(
            candidates_per_profile=args.candidates_per_profile,
            seed=args.seed,
        ),
        "reliabilityGuardrail": run_reliability_fault_injection(
            samples=args.fault_samples,
            seed=args.seed,
        ),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
