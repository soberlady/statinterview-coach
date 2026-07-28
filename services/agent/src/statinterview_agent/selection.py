"""Expected-information-gain question selection under product constraints."""

from __future__ import annotations

from math import log

from pydantic import Field, model_validator

from .ability import AbilityEstimator
from .models import (
    AbilityPosterior,
    Question,
    SelectionContext,
    SelectionDecision,
    SkillDimension,
    StrictModel,
)


class SelectionWeights(StrictModel):
    information_gain: float = Field(default=0.55, ge=0.0, le=1.0)
    jd_relevance: float = Field(default=0.25, ge=0.0, le=1.0)
    coverage_need: float = Field(default=0.20, ge=0.0, le=1.0)
    time_penalty: float = Field(default=0.10, ge=0.0, le=1.0)

    @model_validator(mode="after")
    def validate_positive_signal_weights(self) -> "SelectionWeights":
        positive_total = (
            self.information_gain + self.jd_relevance + self.coverage_need
        )
        if abs(positive_total - 1.0) > 1e-8:
            raise ValueError("positive selection weights must sum to 1.0")
        return self


class QuestionSelector:
    def __init__(self, weights: SelectionWeights | None = None) -> None:
        self.weights = weights or SelectionWeights()

    def select_next(
        self,
        *,
        questions: tuple[Question, ...],
        posteriors: dict[SkillDimension, AbilityPosterior],
        context: SelectionContext,
    ) -> SelectionDecision:
        candidates = [
            question
            for question in questions
            if question.id not in context.asked_question_ids
            and (not context.anchor_only or question.is_anchor)
            and not (
                context.consecutive_same_skill >= 2
                and question.skill == context.last_skill
            )
        ]
        if not candidates:
            raise ValueError("no eligible question remains")

        max_job_weight = max(context.job_weights.values(), default=1.0)
        if max_job_weight <= 0.0:
            max_job_weight = 1.0

        decisions: list[SelectionDecision] = []
        for question in candidates:
            posterior: AbilityPosterior | None = posteriors.get(question.skill)
            if posterior is None:
                raise ValueError(f"missing posterior for skill {question.skill}")

            information_gain = AbilityEstimator.expected_information_gain(
                posterior,
                difficulty=question.difficulty,
            )
            normalized_information_gain = min(
                max(information_gain / log(2.0), 0.0),
                1.0,
            )
            skill_job_weight = context.job_weights.get(question.skill, 0.0)
            jd_relevance = min(
                max(
                    0.5 * question.jd_relevance
                    + 0.5 * skill_job_weight / max_job_weight,
                    0.0,
                ),
                1.0,
            )
            answered_count = context.questions_answered_by_skill.get(
                question.skill, 0
            )
            coverage_need = 1.0 if answered_count == 0 else 1.0 / (answered_count + 1)
            time_cost = min(
                question.expected_seconds / context.remaining_seconds,
                1.0,
            )
            utility = (
                self.weights.information_gain * normalized_information_gain
                + self.weights.jd_relevance * jd_relevance
                + self.weights.coverage_need * coverage_need
                - self.weights.time_penalty * time_cost
            )
            decisions.append(
                SelectionDecision(
                    question_id=question.id,
                    skill=question.skill,
                    utility=utility,
                    information_gain=information_gain,
                    normalized_information_gain=normalized_information_gain,
                    jd_relevance=jd_relevance,
                    coverage_need=coverage_need,
                    time_cost=time_cost,
                )
            )

        return sorted(
            decisions,
            key=lambda item: (-item.utility, item.time_cost, item.question_id),
        )[0]
