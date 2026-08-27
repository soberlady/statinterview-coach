"""Lossless accumulation for committed voice transcript fragments."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class CommittedTranscriptBuffer:
    """Keep committed user messages in arrival order without duplicating IDs."""

    _items: dict[str, str] = field(default_factory=dict)

    def add(self, item_id: str, text: str) -> None:
        normalized = text.strip()
        if normalized:
            self._items[item_id] = normalized

    @property
    def text(self) -> str:
        return " ".join(self._items.values()).strip()

    def clear(self) -> None:
        self._items.clear()
