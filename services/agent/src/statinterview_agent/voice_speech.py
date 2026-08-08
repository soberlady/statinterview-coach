"""Mandarin-first speech text for the realtime interview transport."""

from __future__ import annotations

import re


_TERM_REPLACEMENTS = (
    (r"\bSQL\b", "S Q L"),
    (r"\bFDR\b", "F D R"),
    (r"\bCTR\b", "C T R"),
    (r"\bA/B\b", "A B"),
    (r"\bROW_NUMBER\b", "row number"),
    (r"\bDENSE_RANK\b", "dense rank"),
    (r"\bRANK\b", "rank"),
    (r"Bonferroni", "邦费罗尼"),
    (r"Benjamini-Hochberg", "本杰明尼霍赫贝格"),
)


def prepare_question_for_speech(text: str) -> str:
    """Make mixed Chinese/English interview terms easier to hear.

    The visible question remains unchanged. Only the TTS input is normalized.
    """

    spoken = text.strip()
    for pattern, replacement in _TERM_REPLACEMENTS:
        spoken = re.sub(pattern, replacement, spoken, flags=re.IGNORECASE)
    spoken = re.sub(r"(?i)\bp\s*[- ]?value\b", "P 值", spoken)
    spoken = re.sub(r"(?i)\bp\s*值\b", "P 值", spoken)
    return re.sub(r"\s+", " ", spoken)


def build_opening_prompt(
    sequence_number: int,
    question_text: str,
) -> str:
    """Build a reconnect-safe greeting without ever claiming it is question one."""

    spoken_question = prepare_question_for_speech(question_text)
    if sequence_number <= 1:
        return (
            "你好，我会根据你的回答动态选择问题。"
            "评分只基于回答内容。现在开始。"
            f"{spoken_question}"
        )
    return f"欢迎回来，已恢复到第{sequence_number}题。{spoken_question}"
