"""Mandarin-first speech text for the realtime interview transport."""

from __future__ import annotations

import re


_TERM_REPLACEMENTS = (
    (r"(?<![A-Za-z])A/B(?![A-Za-z])", "A B"),
    (r"(?<![A-Za-z])ROW_NUMBER(?![A-Za-z])", "row number"),
    (r"(?<![A-Za-z])DENSE_RANK(?![A-Za-z])", "dense rank"),
    (r"(?<![A-Za-z])RANK(?![A-Za-z])", "rank"),
    (r"Bonferroni", "邦费罗尼"),
    (r"Benjamini-Hochberg", "本杰明尼霍赫贝格"),
    (r"(?<![A-Za-z])App(?![A-Za-z])", "应用"),
    (r"(?<![A-Za-z])Top(?![A-Za-z])\s*", "前"),
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
_NUMERIC_RATIO = re.compile(
    r"(?P<left>[+-]?\d+(?:\.\d+)?)\s*[:：]\s*"
    r"(?P<right>[+-]?\d+(?:\.\d+)?)"
)
_TABLE_SCHEMA = re.compile(
    r"(?P<table>[A-Za-z][A-Za-z0-9_]*)\s*"
    r"\((?P<fields>[A-Za-z][A-Za-z0-9_,\s]*)\)"
)
_SPEECH_RISKS = (
    ("阿拉伯数字", re.compile(r"\d")),
    ("百分号", re.compile(r"[%％]")),
    ("方括号", re.compile(r"[\[\]【】]")),
    ("字段下划线", re.compile(r"(?<=[A-Za-z])_(?=[A-Za-z])")),
    ("连续大写缩写", re.compile(r"[A-Z]{2,}")),
    ("未口语化符号", re.compile(r"[/<>=≤≥±×÷~～]")),
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


def _speak_small_integer(
    value: int,
    *,
    omit_leading_one: bool = True,
) -> str:
    """Render an integer from 1 through 9999 as natural Mandarin."""

    parts: list[str] = []
    zero_pending = False
    for position in range(3, -1, -1):
        divisor = 10**position
        digit = value // divisor % 10
        if digit:
            if zero_pending and parts:
                parts.append("零")
            if not (
                omit_leading_one
                and digit == 1
                and position == 1
                and not parts
            ):
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
        parts.append(
            _speak_small_integer(group, omit_leading_one=not parts)
        )
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


def _speak_ratio(match: re.Match[str]) -> str:
    return (
        f"{_speak_number(match.group('left'))}"
        f"比{_speak_number(match.group('right'))}"
    )


def _speak_table_schema(match: re.Match[str]) -> str:
    fields = re.sub(r"\s*,\s*", "、", match.group("fields"))
    return f"{match.group('table')}，字段包括{fields}"


def _speak_standalone_number(match: re.Match[str]) -> str:
    return _speak_number(match.group(0))


def _space_acronym(match: re.Match[str]) -> str:
    return f" {' '.join(match.group(0))} "


def find_speech_risks(text: str) -> tuple[str, ...]:
    """Return machine-checkable reasons a normalized prompt needs review."""

    return tuple(
        label for label, pattern in _SPEECH_RISKS if pattern.search(text)
    )


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
    spoken = _NUMERIC_RATIO.sub(_speak_ratio, spoken)
    spoken = _TABLE_SCHEMA.sub(_speak_table_schema, spoken)
    spoken = re.sub(
        r"[+-]?\d+(?:\.\d+)?",
        _speak_standalone_number,
        spoken,
    )
    for pattern, replacement in _TERM_REPLACEMENTS:
        spoken = re.sub(pattern, replacement, spoken, flags=re.IGNORECASE)
    spoken = re.sub(
        r"(?i)(?<![A-Za-z])p\s*[- ]?value(?![A-Za-z])",
        "P 值",
        spoken,
    )
    spoken = re.sub(
        r"(?i)(?<![A-Za-z])p\s*值",
        "P 值",
        spoken,
    )
    spoken = re.sub(r"(?<=[A-Za-z])_(?=[A-Za-z])", " ", spoken)
    spoken = re.sub(
        r"(?<=[\u4e00-\u9fffA-Za-z])/(?=[\u4e00-\u9fffA-Za-z])",
        "或",
        spoken,
    )
    spoken = re.sub(r"(?<=[A-Z])-(?=[A-Z])", " ", spoken)
    spoken = re.sub(r"[A-Z]{2,}", _space_acronym, spoken)
    spoken = re.sub(r"\s+", " ", spoken).strip()
    return re.sub(r"\s+([，。！？；：、])", r"\1", spoken)


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
