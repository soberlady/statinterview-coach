"""Question-aware terminology for mixed Chinese and English speech."""

from __future__ import annotations

import re


BASE_STT_KEYTERMS = [
    "SQL",
    "Python",
    "A/B 测试",
    "p 值",
    "置信区间",
    "显著性水平",
    "统计功效",
    "样本量",
    "点击率",
    "转化率",
    "留存率",
    "百分之",
]

_ENGLISH_TERM = re.compile(
    r"(?<![A-Za-z0-9])(?:[A-Za-z][A-Za-z0-9]*)(?:[_/-][A-Za-z0-9]+)*(?![A-Za-z0-9])"
)


def extract_question_keyterms(question_text: str) -> list[str]:
    """Return bounded English terms that are actually present in one question."""

    terms: list[str] = []
    for match in _ENGLISH_TERM.finditer(question_text):
        term = match.group(0)
        if len(term) < 2 and term.upper() not in {"R"}:
            continue
        if term.lower() in {"id", "test"}:
            continue
        terms.append(term)
    return list(dict.fromkeys(terms))[:20]


def build_question_keyterms(question_text: str) -> list[str]:
    """Build the STT bias list with current-question terms first."""

    dynamic = extract_question_keyterms(question_text)
    return list(dict.fromkeys([*dynamic, *BASE_STT_KEYTERMS]))


def answer_contains_english_fragment(answer: str) -> bool:
    return bool(re.search(r"[A-Za-z]{2,}", answer))
