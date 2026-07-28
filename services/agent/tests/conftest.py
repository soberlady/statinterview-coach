from __future__ import annotations

import pytest

from statinterview_agent import (
    Question,
    RubricCriterion,
    SkillDimension,
)


@pytest.fixture
def basic_question() -> Question:
    return Question(
        id="exp-001",
        skill=SkillDimension.EXPERIMENT_CAUSAL,
        difficulty=0.0,
        jd_relevance=0.9,
        expected_seconds=90,
        prompt="如何判断一次 A/B 测试是否可信？",
        rubric=(
            RubricCriterion(
                id="hypothesis",
                description="说明原假设与备择假设",
                weight=0.5,
            ),
            RubricCriterion(
                id="power",
                description="讨论样本量和统计功效",
                weight=0.5,
            ),
        ),
        verification_questions=("请说明如何估计实验所需样本量。",),
    )

