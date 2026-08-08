"""Deterministic LiveKit Inference list-price estimation.

The estimator deliberately keeps observed usage separate from price metadata.
Unknown models remain visible as unpriced line items instead of being counted
as zero-cost usage.
"""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Iterable, Mapping

PRICING_VERSION = "livekit-list-2026-08-08"
SUPPORTED_PLANS = {"build_ship", "scale"}

_LLM_PRICES = {
    "google/gemma-4-31b-it": {
        "input_per_million_tokens_usd": Decimal("0.400"),
        "cached_input_per_million_tokens_usd": Decimal("0.200"),
        "output_per_million_tokens_usd": Decimal("1.200"),
    },
}

_STT_PRICES = {
    "deepgram/nova-3": {
        "build_ship": Decimal("0.0048"),
        "scale": Decimal("0.0042"),
    },
}

_TTS_PRICES = {
    "cartesia/sonic-3.5": {
        "build_ship": Decimal("50.00"),
        "scale": Decimal("37.50"),
    },
}


def estimate_livekit_inference_cost(
    model_usage: Iterable[Any],
    *,
    plan: str = "build_ship",
) -> dict[str, Any]:
    """Return a JSON-safe usage and marginal list-price estimate.

    The estimate excludes free credits, hosting/session charges, WebRTC usage,
    taxes and negotiated discounts. ``model_usage`` may contain LiveKit
    Pydantic usage models or plain mappings, which keeps this module easy to
    test without a cloud session.
    """

    normalized_plan = plan.strip().lower()
    if normalized_plan not in SUPPORTED_PLANS:
        raise ValueError(
            "pricing plan must be one of: "
            + ", ".join(sorted(SUPPORTED_PLANS))
        )

    line_items: list[dict[str, Any]] = []
    input_tokens = 0
    output_tokens = 0
    stt_audio_seconds = Decimal("0")
    tts_audio_seconds = Decimal("0")
    tts_characters = 0

    for raw_usage in model_usage:
        usage = _as_mapping(raw_usage)
        usage_type = str(usage.get("type", ""))
        provider = str(usage.get("provider", ""))
        model = str(usage.get("model", ""))
        model_key = _model_key(provider, model)

        item_input_tokens = _non_negative_int(usage.get("input_tokens"))
        item_output_tokens = _non_negative_int(usage.get("output_tokens"))
        input_tokens += item_input_tokens
        output_tokens += item_output_tokens

        line_item: dict[str, Any] = {
            "type": usage_type,
            "provider": provider,
            "model": model,
            "inputTokens": item_input_tokens,
            "outputTokens": item_output_tokens,
        }

        estimated_cost_microusd: int | None = None
        rate: dict[str, Any] | None = None

        if usage_type == "llm_usage":
            cached_tokens = min(
                item_input_tokens,
                _non_negative_int(usage.get("input_cached_tokens")),
            )
            uncached_tokens = item_input_tokens - cached_tokens
            line_item.update(
                {
                    "cachedInputTokens": cached_tokens,
                    "uncachedInputTokens": uncached_tokens,
                }
            )
            prices = _find_price(_LLM_PRICES, model_key)
            if prices:
                estimated_cost_microusd = _round_microusd(
                    Decimal(uncached_tokens)
                    * prices["input_per_million_tokens_usd"]
                    + Decimal(cached_tokens)
                    * prices["cached_input_per_million_tokens_usd"]
                    + Decimal(item_output_tokens)
                    * prices["output_per_million_tokens_usd"]
                )
                rate = {
                    key: float(value) for key, value in prices.items()
                }

        elif usage_type == "stt_usage":
            audio_seconds = _non_negative_decimal(
                usage.get("audio_duration")
            )
            stt_audio_seconds += audio_seconds
            line_item["audioDurationSeconds"] = float(audio_seconds)
            prices = _find_price(_STT_PRICES, model_key)
            if prices:
                price_per_minute = prices[normalized_plan]
                estimated_cost_microusd = _usd_to_microusd(
                    audio_seconds / Decimal(60) * price_per_minute
                )
                rate = {
                    "pricePerMinuteUsd": float(price_per_minute),
                }

        elif usage_type == "tts_usage":
            characters = _non_negative_int(usage.get("characters_count"))
            audio_seconds = _non_negative_decimal(
                usage.get("audio_duration")
            )
            tts_characters += characters
            tts_audio_seconds += audio_seconds
            line_item.update(
                {
                    "charactersCount": characters,
                    "audioDurationSeconds": float(audio_seconds),
                }
            )
            prices = _find_price(_TTS_PRICES, model_key)
            if prices:
                price_per_million = prices[normalized_plan]
                estimated_cost_microusd = _round_microusd(
                    Decimal(characters) * price_per_million
                )
                rate = {
                    "pricePerMillionCharactersUsd": float(
                        price_per_million
                    ),
                }

        else:
            requests = _non_negative_int(usage.get("total_requests"))
            if requests:
                line_item["totalRequests"] = requests

        line_item["pricingStatus"] = (
            "PRICED" if estimated_cost_microusd is not None else "UNPRICED"
        )
        line_item["estimatedCostMicrousd"] = estimated_cost_microusd
        if rate is not None:
            line_item["rate"] = rate
        line_items.append(line_item)

    priced_items = [
        item
        for item in line_items
        if item["estimatedCostMicrousd"] is not None
    ]
    unpriced_items = [
        item
        for item in line_items
        if item["estimatedCostMicrousd"] is None
    ]
    estimated_cost_microusd = sum(
        int(item["estimatedCostMicrousd"]) for item in priced_items
    )
    if not line_items:
        pricing_status = "NOT_MEASURED"
    elif not unpriced_items:
        pricing_status = "COMPLETE"
    elif priced_items:
        pricing_status = "PARTIAL"
    else:
        pricing_status = "UNAVAILABLE"

    return {
        "schemaVersion": 1,
        "pricing": {
            "version": PRICING_VERSION,
            "plan": normalized_plan,
            "currency": "USD",
            "allowancesApplied": False,
            "status": pricing_status,
        },
        "lineItems": line_items,
        "totals": {
            "inputTokens": input_tokens,
            "outputTokens": output_tokens,
            "sttAudioDurationSeconds": float(stt_audio_seconds),
            "ttsCharactersCount": tts_characters,
            "ttsAudioDurationSeconds": float(tts_audio_seconds),
            "estimatedCostMicrousd": estimated_cost_microusd,
            "pricedUsageCount": len(priced_items),
            "unpricedUsageCount": len(unpriced_items),
        },
    }


def _as_mapping(value: Any) -> Mapping[str, Any]:
    if isinstance(value, Mapping):
        return value
    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        dumped = model_dump(mode="json")
        if isinstance(dumped, Mapping):
            return dumped
    raise TypeError("model usage entries must be mappings or Pydantic models")


def _model_key(provider: str, model: str) -> str:
    normalized_model = model.strip().lower()
    normalized_provider = provider.strip().lower()
    if "/" in normalized_model or not normalized_provider:
        return normalized_model
    return f"{normalized_provider}/{normalized_model}"


def _find_price(
    catalog: Mapping[str, Any], model_key: str
) -> Any | None:
    direct = catalog.get(model_key)
    if direct is not None:
        return direct
    for known_key, price in catalog.items():
        known_model = known_key.partition("/")[2]
        if model_key == known_model or model_key.endswith(
            f"/{known_model}"
        ):
            return price
    return None


def _non_negative_int(value: Any) -> int:
    try:
        parsed = int(value or 0)
    except (TypeError, ValueError):
        return 0
    return max(0, parsed)


def _non_negative_decimal(value: Any) -> Decimal:
    try:
        parsed = Decimal(str(value or 0))
    except Exception:
        return Decimal("0")
    if not parsed.is_finite() or parsed < 0:
        return Decimal("0")
    return parsed


def _round_microusd(value: Decimal) -> int:
    return int(value.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _usd_to_microusd(value: Decimal) -> int:
    return _round_microusd(value * Decimal(1_000_000))
