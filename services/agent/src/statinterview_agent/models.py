"""Pydantic contracts shared by the deterministic policy modules."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import StrEnum
from math import isclose
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, model_validator


Probability = Annotated[float, Field(ge=0.0, le=1.0)]


class StrictModel(BaseModel):
    """Base contract: immutable values and no silently ignored fields."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class InterviewState(StrEnum):
    CREATED = "CREATED"
    PREPARING = "PREPARING"
    ANCHOR_INTERVIEW = "ANCHOR_INTERVIEW"
    ADAPTIVE_INTERVIEW = "ADAPTIVE_INTERVIEW"
    VERIFYING = "VERIFYING"
    FINALIZING = "FINALIZING"
    COMPLETED = "COMPLETED"
    PAUSED = "PAUSED"
    RECOVERING = "RECOVERING"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class SkillDimension(StrEnum):
    STATISTICS_ML = "statistics_ml"
    EXPERIMENT_CAUSAL = "experiment_causal"
    SQL_PYTHON_ENGINEERING = "sql_python"
    BUSINESS_ANALYSIS = "business_analytics"


class ReliabilityLevel(StrEnum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


class InterviewAction(StrEnum):
    ACCEPT = "ACCEPT"
    VERIFY = "VERIFY"
    ABSTAIN = "ABSTAIN"


class CriterionVerdict(StrEnum):
    MET = "MET"
    PARTIAL = "PARTIAL"
    MISSING = "MISSING"
    INCORRECT = "INCORRECT"


class RubricCriterion(StrictModel):
    id: str = Field(min_length=1, max_length=80)
    description: str = Field(min_length=1, max_length=500)
    weight: float = Field(gt=0.0, le=1.0)


class Question(StrictModel):
    id: str = Field(min_length=1, max_length=100)
    skill: SkillDimension
    difficulty: float = Field(ge=-3.0, le=3.0)
    jd_relevance: Probability = 0.5
    expected_seconds: int = Field(default=120, ge=15, le=900)
    prompt: str = Field(min_length=1, max_length=4_000)
    rubric: tuple[RubricCriterion, ...] = Field(min_length=1)
    is_anchor: bool = False
    verification_questions: tuple[str, ...] = ()
    tags: tuple[str, ...] = ()

    @model_validator(mode="after")
    def validate_rubric(self) -> "Question":
        ids = [criterion.id for criterion in self.rubric]
        if len(ids) != len(set(ids)):
            raise ValueError("rubric criterion ids must be unique")
        total = sum(criterion.weight for criterion in self.rubric)
        if not isclose(total, 1.0, abs_tol=1e-6):
            raise ValueError("rubric weights must sum to 1.0")
        return self


class CriterionAssessment(StrictModel):
    criterion_id: str = Field(min_length=1, max_length=80)
    verdict: CriterionVerdict
    evidence: tuple[str, ...] = ()
    note: str | None = Field(default=None, max_length=1_000)


class AnswerEvaluation(StrictModel):
    question_id: str = Field(min_length=1, max_length=100)
    assessments: tuple[CriterionAssessment, ...] = Field(min_length=1)


class ScoredAnswer(StrictModel):
    question_id: str
    normalized_score: Probability
    score_out_of_four: float = Field(ge=0.0, le=4.0)
    evidence_coverage: Probability
    missing_points: tuple[str, ...]
    supporting_evidence: tuple[str, ...]


class AbilityPosterior(StrictModel):
    skill: SkillDimension
    theta_grid: tuple[float, ...] = Field(min_length=2)
    probabilities: tuple[float, ...] = Field(min_length=2)

    @model_validator(mode="after")
    def validate_distribution(self) -> "AbilityPosterior":
        if len(self.theta_grid) != len(self.probabilities):
            raise ValueError("theta grid and probabilities must have equal lengths")
        if any(
            right <= left
            for left, right in zip(self.theta_grid, self.theta_grid[1:])
        ):
            raise ValueError("theta grid must be strictly increasing")
        if any(value < 0.0 for value in self.probabilities):
            raise ValueError("probabilities cannot be negative")
        if not isclose(sum(self.probabilities), 1.0, abs_tol=1e-8):
            raise ValueError("probabilities must sum to 1.0")
        return self


class AbilitySummary(StrictModel):
    skill: SkillDimension
    mean: float
    standard_deviation: float = Field(ge=0.0)
    lower_credible_bound: float
    upper_credible_bound: float
    entropy: float = Field(ge=0.0)


class SelectionContext(StrictModel):
    asked_question_ids: frozenset[str] = frozenset()
    questions_answered_by_skill: dict[SkillDimension, int] = Field(
        default_factory=dict
    )
    job_weights: dict[SkillDimension, Probability] = Field(default_factory=dict)
    remaining_seconds: int = Field(default=1_200, ge=1)
    last_skill: SkillDimension | None = None
    consecutive_same_skill: int = Field(default=0, ge=0)
    anchor_only: bool = False


class SelectionDecision(StrictModel):
    question_id: str
    skill: SkillDimension
    utility: float
    information_gain: float = Field(ge=0.0)
    normalized_information_gain: Probability
    jd_relevance: Probability
    coverage_need: Probability
    time_cost: Probability


class ReliabilitySignals(StrictModel):
    evidence_coverage: Probability
    transcript_completeness: Probability
    answer_units: int = Field(ge=0)
    primary_score: float = Field(ge=0.0, le=4.0)
    review_score: float | None = Field(default=None, ge=0.0, le=4.0)
    schema_valid: bool = True
    mastery_threshold: float = Field(default=2.4, ge=0.0, le=4.0)


class VerificationBudget(StrictModel):
    verifications_for_question: int = Field(default=0, ge=0)
    total_verifications: int = Field(default=0, ge=0)
    max_per_question: int = Field(default=1, ge=0)
    max_total: int = Field(default=3, ge=0)

    @property
    def available(self) -> bool:
        return (
            self.verifications_for_question < self.max_per_question
            and self.total_verifications < self.max_total
        )


class VerificationDecision(StrictModel):
    reliability: ReliabilityLevel
    action: InterviewAction
    reasons: tuple[str, ...]


class StateTransition(StrictModel):
    from_state: InterviewState
    to_state: InterviewState
    reason: str = Field(min_length=1, max_length=500)
    occurred_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )
    version: int = Field(ge=1)


class InterviewSnapshot(StrictModel):
    session_id: str = Field(min_length=1, max_length=200)
    state: InterviewState = InterviewState.CREATED
    resume_state: InterviewState | None = None
    version: int = Field(default=0, ge=0)
    history: tuple[StateTransition, ...] = ()


class TurnPolicyResult(StrictModel):
    reliability: ReliabilityLevel
    action: InterviewAction
    reasons: tuple[str, ...]
    updated_posterior: AbilityPosterior | None
    verification_question: str | None = None
