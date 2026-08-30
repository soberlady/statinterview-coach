import json
from pathlib import Path

from statinterview_agent.voice_speech import (
    build_opening_prompt,
    find_speech_risks,
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


def test_confidence_interval_is_spoken_instead_of_treated_as_metadata() -> None:
    question = (
        "一次抽样得到新用户次日留存率为30%，"
        "95%置信区间为[27%，33%]。"
        "请解释这个区间，并说明样本量增加后通常会发生什么。"
    )

    spoken = prepare_question_for_speech(question)

    assert spoken == (
        "一次抽样得到新用户次日留存率为百分之三十，"
        "百分之九十五置信区间为百分之二十七至百分之三十三。"
        "请解释这个区间，并说明样本量增加后通常会发生什么。"
    )
    assert "[" not in spoken
    assert "]" not in spoken


def test_compact_percent_interval_applies_unit_to_both_endpoints() -> None:
    assert prepare_question_for_speech("区间为[27, 33%]。") == (
        "区间为百分之二十七至百分之三十三。"
    )


def test_percentages_use_natural_mandarin_number_words() -> None:
    assert prepare_question_for_speech("变化为0.5%、10%、30%和100%。") == (
        "变化为百分之零点五、百分之十、百分之三十和百分之一百。"
    )


def test_ratios_numbers_acronyms_and_table_schemas_are_speakable() -> None:
    assert prepare_question_for_speech(
        "计划50:50分流，系数为0.8，使用ROC-AUC。"
    ) == "计划五十比五十分流，系数为零点八，使用 R O C A U C。"
    assert prepare_question_for_speech(
        "表sales(category, product_id, revenue)有20GB CSV。"
    ) == (
        "表sales，字段包括category、product id、revenue有二十 G B C S V。"
    )


def test_lowercase_p_value_next_to_chinese_is_normalized() -> None:
    assert prepare_question_for_speech("只有一个指标p值小于0.05。") == (
        "只有一个指标P 值小于零点零五。"
    )


def test_every_question_bank_prompt_passes_speech_lint() -> None:
    repository_root = Path(__file__).parents[3]
    bank = json.loads(
        (repository_root / "content" / "question-bank.json").read_text(
            encoding="utf-8"
        )
    )
    failures: list[str] = []
    for question in bank["questions"]:
        prompts = [
            question["question"],
            *question.get("verificationQuestions", []),
        ]
        for prompt in prompts:
            spoken = prepare_question_for_speech(prompt)
            risks = find_speech_risks(spoken)
            if risks:
                failures.append(
                    f"{question['id']}: {', '.join(risks)} => {spoken}"
                )

    assert not failures, "\n".join(failures)
