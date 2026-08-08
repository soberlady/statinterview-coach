from statinterview_agent.voice_speech import (
    build_opening_prompt,
    prepare_question_for_speech,
)


def test_opening_prompt_restores_real_sequence_number() -> None:
    prompt = build_opening_prompt(5, "请解释 SQL 窗口函数。")

    assert "第5题" in prompt
    assert "第一题" not in prompt
    assert "S Q L" in prompt


def test_first_opening_does_not_use_a_stale_ordinal() -> None:
    prompt = build_opening_prompt(1, "请介绍你的分析项目。")

    assert "现在开始" in prompt
    assert "第1题" not in prompt


def test_mixed_terms_are_normalized_only_for_speech() -> None:
    spoken = prepare_question_for_speech(
        "A/B 测试里用 Bonferroni 控制 FDR，并说明 p-value。"
    )

    assert spoken == (
        "A B 测试里用 邦费罗尼 控制 F D R，并说明 P 值。"
    )
