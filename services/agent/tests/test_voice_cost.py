from statinterview_agent.voice_cost import estimate_livekit_inference_cost


def test_estimates_current_pipeline_with_cached_tokens() -> None:
    estimate = estimate_livekit_inference_cost(
        [
            {
                "type": "llm_usage",
                "provider": "google",
                "model": "gemma-4-31b-it",
                "input_tokens": 10_000,
                "input_cached_tokens": 2_000,
                "output_tokens": 1_000,
            },
            {
                "type": "stt_usage",
                "provider": "deepgram",
                "model": "nova-3",
                "audio_duration": 120,
            },
            {
                "type": "tts_usage",
                "provider": "cartesia",
                "model": "sonic-3.5",
                "characters_count": 4_000,
                "audio_duration": 90,
            },
        ]
    )

    # LLM: 8k*0.4 + 2k*0.2 + 1k*1.2 = 4,800 micro-USD.
    # STT: 2 minutes * $0.0048 = 9,600 micro-USD.
    # TTS: 4k characters * $50/million = 200,000 micro-USD.
    assert estimate["totals"] == {
        "inputTokens": 10_000,
        "outputTokens": 1_000,
        "sttAudioDurationSeconds": 120.0,
        "ttsCharactersCount": 4_000,
        "ttsAudioDurationSeconds": 90.0,
        "estimatedCostMicrousd": 214_400,
        "pricedUsageCount": 3,
        "unpricedUsageCount": 0,
    }
    assert estimate["pricing"]["status"] == "COMPLETE"
    assert estimate["pricing"]["allowancesApplied"] is False


def test_keeps_unknown_usage_unpriced_instead_of_calling_it_free() -> None:
    estimate = estimate_livekit_inference_cost(
        [
            {
                "type": "stt_usage",
                "provider": "unknown",
                "model": "new-model",
                "audio_duration": 60,
            },
            {
                "type": "tts_usage",
                "provider": "cartesia",
                "model": "sonic-3.5",
                "characters_count": 100,
            },
        ]
    )

    assert estimate["pricing"]["status"] == "PARTIAL"
    assert estimate["totals"]["estimatedCostMicrousd"] == 5_000
    assert estimate["totals"]["pricedUsageCount"] == 1
    assert estimate["totals"]["unpricedUsageCount"] == 1
    assert estimate["lineItems"][0]["estimatedCostMicrousd"] is None


def test_scale_plan_uses_discounted_speech_rates() -> None:
    estimate = estimate_livekit_inference_cost(
        [
            {
                "type": "stt_usage",
                "provider": "deepgram",
                "model": "nova-3",
                "audio_duration": 60,
            },
            {
                "type": "tts_usage",
                "provider": "cartesia",
                "model": "sonic-3.5",
                "characters_count": 1_000,
            },
        ],
        plan="scale",
    )

    assert estimate["totals"]["estimatedCostMicrousd"] == 41_700
    assert estimate["pricing"]["plan"] == "scale"


def test_empty_usage_is_explicitly_not_measured() -> None:
    estimate = estimate_livekit_inference_cost([])

    assert estimate["pricing"]["status"] == "NOT_MEASURED"
    assert estimate["totals"]["estimatedCostMicrousd"] == 0


def test_rejects_unknown_pricing_plan() -> None:
    try:
        estimate_livekit_inference_cost([], plan="enterprise")
    except ValueError as error:
        assert "build_ship" in str(error)
    else:
        raise AssertionError("unknown plan should fail closed")
