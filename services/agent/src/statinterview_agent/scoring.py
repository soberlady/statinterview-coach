"""Deterministic aggregation of structured rubric assessments."""

from __future__ import annotations

from .models import (
    AnswerEvaluation,
    CriterionVerdict,
    Question,
    ScoredAnswer,
)


_VERDICT_VALUE = {
    CriterionVerdict.MET: 1.0,
    CriterionVerdict.PARTIAL: 0.5,
    CriterionVerdict.MISSING: 0.0,
    CriterionVerdict.INCORRECT: 0.0,
}


def score_rubric_answer(
    question: Question,
    evaluation: AnswerEvaluation,
) -> ScoredAnswer:
    """Validate criterion coverage and compute a weighted score in code."""

    if evaluation.question_id != question.id:
        raise ValueError("evaluation question_id does not match question")

    assessments = {
        assessment.criterion_id: assessment
        for assessment in evaluation.assessments
    }
    if len(assessments) != len(evaluation.assessments):
        raise ValueError("criterion assessments must be unique")

    expected_ids = {criterion.id for criterion in question.rubric}
    if set(assessments) != expected_ids:
        missing = expected_ids - set(assessments)
        unexpected = set(assessments) - expected_ids
        raise ValueError(
            f"criterion mismatch; missing={sorted(missing)}, "
            f"unexpected={sorted(unexpected)}"
        )

    normalized_score = 0.0
    evidence_weight = 0.0
    missing_points: list[str] = []
    supporting_evidence: list[str] = []
    for criterion in question.rubric:
        assessment = assessments[criterion.id]
        normalized_score += (
            criterion.weight * _VERDICT_VALUE[assessment.verdict]
        )
        if assessment.evidence:
            evidence_weight += criterion.weight
            supporting_evidence.extend(assessment.evidence)
        if assessment.verdict in {
            CriterionVerdict.MISSING,
            CriterionVerdict.INCORRECT,
        }:
            missing_points.append(criterion.description)

    normalized_score = min(max(normalized_score, 0.0), 1.0)
    return ScoredAnswer(
        question_id=question.id,
        normalized_score=normalized_score,
        score_out_of_four=normalized_score * 4.0,
        evidence_coverage=min(max(evidence_weight, 0.0), 1.0),
        missing_points=tuple(missing_points),
        supporting_evidence=tuple(supporting_evidence),
    )

