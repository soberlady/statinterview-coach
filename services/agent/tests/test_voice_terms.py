from statinterview_agent.voice_terms import (
    answer_contains_english_fragment,
    build_question_keyterms,
    extract_question_keyterms,
)


def test_current_question_terms_are_prioritized_and_bounded() -> None:
    question = "用 ROW_NUMBER 按 user_id 分组，再用 ROC-AUC 和 Pandas 评估。"

    terms = build_question_keyterms(question)

    assert terms[:4] == ["ROW_NUMBER", "user_id", "ROC-AUC", "Pandas"]
    assert "SQL" in terms
    assert extract_question_keyterms("只解释置信区间。") == []


def test_english_fragment_detection_ignores_chinese_only_answers() -> None:
    assert answer_contains_english_fragment("我会使用 row number 处理") is True
    assert answer_contains_english_fragment("我会使用窗口函数处理") is False
