"""Lossless accumulation for committed voice transcript fragments."""

from __future__ import annotations

import re
from dataclasses import dataclass, field


_FILLER_PATTERN = re.compile(
    r"(?:(?<=^)|(?<=[，。！？；、\s]))(?:嗯+|呃+|额+|那个|就是说)(?=$|[，。！？；、\s])"
)
_PERCENT_LABELS = (
    "留存率|点击率|转化率|准确率|召回率|概率|比例|占比|"
    "置信水平|显著性水平"
)
_TERM_REPLACEMENTS = (
    ("user_id", re.compile(r"\buser\s*(?:underscore|下划线|[_ -])?\s*id\b", re.I)),
    ("product_id", re.compile(r"\bproduct\s*(?:underscore|下划线|[_ -])?\s*id\b", re.I)),
    (
        "ROW_NUMBER",
        re.compile(r"\b(?:row|roll|raw|r\s*o\s*w)[\s_-]*(?:number|no)\b", re.I),
    ),
    ("DENSE_RANK", re.compile(r"\bdense[\s_-]*rank\b", re.I)),
    (
        "ROC-AUC",
        re.compile(r"\b(?:roc|rock|r\s*o\s*c)[\s_-]*a\s*u\s*c\b", re.I),
    ),
    ("PR-AUC", re.compile(r"\bpr[\s_-]*auc\b", re.I)),
    ("Pandas", re.compile(r"\bpandas?\b", re.I)),
    ("A/B 测试", re.compile(r"\ba\s*(?:/|斜杠|和)?\s*b\s*(?:test|测试)?\b", re.I)),
)


def prepare_transcript_for_scoring(raw: str, question_text: str) -> str:
    """Create a conservative ASR interpretation hint without changing evidence.

    The caller must continue storing and quoting ``raw``. This helper only
    repairs deterministic speech-recognition artifacts that are common in the
    question bank: spoken percentages and mixed Chinese/English identifiers.
    """

    hint = re.sub(r"\s+", " ", raw).strip()
    hint = _FILLER_PATTERN.sub("", hint)
    hint = re.sub(r"\s+([，。！？；、])", r"\1", hint)
    hint = re.sub(r"^[，。！？；、\s]+", "", hint)

    # Deepgram may emit either Chinese numerals or Arabic digits after 百分之.
    hint = re.sub(
        r"百分之\s*([零〇一二两三四五六七八九十百点\d.]+)",
        lambda match: f"{_spoken_number_to_arabic(match.group(1))}%",
        hint,
    )

    # Restore a missing percent sign only in an explicit rate context and only
    # when this question itself discusses percentages.
    if "%" in question_text or "百分之" in question_text:
        hint = re.sub(
            rf"(({_PERCENT_LABELS})(?:为|是|约为|大约为)?\s*)(\d+(?:\.\d+)?)(?!\s*[%\d])",
            r"\1\3%",
            hint,
        )

    compact_question = re.sub(r"[\s_-]", "", question_text).lower()
    for canonical, pattern in _TERM_REPLACEMENTS:
        compact_canonical = re.sub(r"[\s_-]", "", canonical).lower()
        if compact_canonical in compact_question:
            hint = pattern.sub(canonical, hint)
    return re.sub(r" {2,}", " ", hint).strip()


def _spoken_number_to_arabic(value: str) -> str:
    if re.fullmatch(r"\d+(?:\.\d+)?", value):
        return value
    if "点" in value:
        whole, fraction = value.split("点", 1)
        digits = "".join(str(_DIGITS.get(char, char)) for char in fraction)
        return f"{_chinese_integer(whole)}.{digits}"
    return str(_chinese_integer(value))


_DIGITS = {
    "零": 0,
    "〇": 0,
    "一": 1,
    "二": 2,
    "两": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
}


def _chinese_integer(value: str) -> int:
    if value.isdigit():
        return int(value)
    if "百" in value:
        left, right = value.split("百", 1)
        return (_DIGITS.get(left, 1) * 100) + _chinese_integer(right or "零")
    if "十" in value:
        left, right = value.split("十", 1)
        return (_DIGITS.get(left, 1) * 10) + _DIGITS.get(right, 0)
    if all(char in _DIGITS for char in value):
        return int("".join(str(_DIGITS[char]) for char in value))
    return 0


@dataclass
class CommittedTranscriptBuffer:
    """Keep committed user messages in arrival order without duplicating IDs."""

    _items: dict[str, tuple[str, float | None]] = field(default_factory=dict)

    def add(
        self,
        item_id: str,
        text: str,
        confidence: float | None = None,
    ) -> None:
        normalized = text.strip()
        if normalized:
            bounded_confidence = (
                min(1.0, max(0.0, confidence))
                if isinstance(confidence, (int, float))
                else None
            )
            self._items[item_id] = (normalized, bounded_confidence)

    @property
    def text(self) -> str:
        return " ".join(text for text, _ in self._items.values()).strip()

    @property
    def confidence(self) -> float | None:
        values = [value for _, value in self._items.values() if value is not None]
        return round(sum(values) / len(values), 6) if values else None

    def clear(self) -> None:
        self._items.clear()
