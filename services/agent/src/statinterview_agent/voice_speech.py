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

_CHINESE_DIGITS = "零一二三四五六七八九"
_SMALL_NUMBER_UNITS = ("", "十", "百", "千")
_NUMBER_GROUP_UNITS = ("", "万", "亿", "万亿")

_NUMERIC_INTERVAL = re.compile(
    r"[\[【]\s*"
    r"(?P<lower>[+-]?\d+(?:\.\d+)?)\s*(?P<lower_percent>[%％]?)\s*"
    r"[,，]\s*"
    r"(?P<upper>[+-]?\d+(?:\.\d+)?)\s*(?P<upper_percent>[%％]?)\s*"
    r"[\]】]"
)


def _speak_numeric_interval(match: re.Match[str]) -> str:
    """Turn display-oriented interval notation into text TTS will speak."""

    lower = match.group("lower")
    upper = match.group("upper")
    lower_is_percent = bool(match.group("lower_percent"))
    upper_is_percent = bool(match.group("upper_percent"))

    # If either endpoint carries a percent sign, treat both endpoints as
    # percentages. This also handles compact notation such as [27, 33%].
    if lower_is_percent or upper_is_percent:
        return f"百分之{_speak_number(lower)}至百分之{_speak_number(upper)}"
    return f"{lower}至{upper}"


def _speak_small_integer(value: int) -> str:
    """Render an integer from 1 through 9999 as natural Mandarin."""

    parts: list[str] = []
    zero_pending = False
    for position in range(3, -1, -1):
        divisor = 10**position
        digit = value // divisor % 10
        if digit:
            if zero_pending and parts:
                parts.append("零")
            if not (digit == 1 and position == 1 and not parts):
                parts.append(_CHINESE_DIGITS[digit])
            parts.append(_SMALL_NUMBER_UNITS[position])
            zero_pending = False
        elif parts and value % divisor:
            zero_pending = True
    return "".join(parts)


def _speak_integer(value: int) -> str:
    if value == 0:
        return _CHINESE_DIGITS[0]

    groups: list[int] = []
    while value:
        groups.append(value % 10_000)
        value //= 10_000

    parts: list[str] = []
    zero_pending = False
    for index in range(len(groups) - 1, -1, -1):
        group = groups[index]
        if not group:
            if parts:
                zero_pending = True
            continue
        if parts and (zero_pending or group < 1_000):
            parts.append("零")
        parts.append(_speak_small_integer(group))
        if index < len(_NUMBER_GROUP_UNITS):
            parts.append(_NUMBER_GROUP_UNITS[index])
        zero_pending = False
    return "".join(parts)


def _speak_number(value: str) -> str:
    """Render a signed integer or decimal without leaving digits for TTS."""

    sign = "负" if value.startswith("-") else ""
    unsigned = value.lstrip("+-")
    integer, separator, fraction = unsigned.partition(".")
    spoken = _speak_integer(int(integer))
    if separator:
        spoken += "点" + "".join(_CHINESE_DIGITS[int(digit)] for digit in fraction)
    return sign + spoken


def _speak_percentage(match: re.Match[str]) -> str:
    return f"百分之{_speak_number(match.group(1))}"


def prepare_question_for_speech(text: str) -> str:
    """Make mixed Chinese/English interview terms easier to hear.

    The visible question remains unchanged. Only the TTS input is normalized.
    """

    spoken = text.strip()
    # Some TTS providers treat square-bracketed text as metadata and skip it.
    # Normalize numeric ranges before individual percentage symbols so both
    # endpoints are always spoken.
    spoken = _NUMERIC_INTERVAL.sub(_speak_numeric_interval, spoken)
    spoken = re.sub(
        r"([+-]?\d+(?:\.\d+)?)\s*[%％]",
        _speak_percentage,
        spoken,
    )
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

