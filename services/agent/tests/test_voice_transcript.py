from statinterview_agent.voice_transcript import (
    CommittedTranscriptBuffer,
    prepare_transcript_for_scoring,
)


def test_committed_fragments_are_combined_without_losing_the_first_part() -> None:
    buffer = CommittedTranscriptBuffer()

    buffer.add("item-1", "估算样本量需要当前点击率和最小提升幅度")
    buffer.add("item-2", "还需要显著性水平和统计功效")
    buffer.add("item-3", "样本量不足会增加假阴性风险")

    assert buffer.text == (
        "估算样本量需要当前点击率和最小提升幅度 "
        "还需要显著性水平和统计功效 "
        "样本量不足会增加假阴性风险"
    )


def test_same_conversation_item_is_updated_instead_of_duplicated() -> None:
    buffer = CommittedTranscriptBuffer()

    buffer.add("item-1", "窗口函数")
    buffer.add("item-1", "使用窗口函数按品类分组")

    assert buffer.text == "使用窗口函数按品类分组"


def test_clear_starts_a_new_question_transcript() -> None:
    buffer = CommittedTranscriptBuffer()
    buffer.add("item-1", "第一题回答")

    buffer.clear()
    buffer.add("item-2", "第二题回答")

    assert buffer.text == "第二题回答"


def test_scoring_hint_restores_spoken_percent_without_changing_raw() -> None:
    raw = "嗯，留存率为百分之三十，置信水平百分之九十五。"
    question = "留存率为30%，95%置信区间是什么？"

    hint = prepare_transcript_for_scoring(raw, question)

    assert raw == "嗯，留存率为百分之三十，置信水平百分之九十五。"
    assert hint == "留存率为30%，置信水平95%。"


def test_scoring_hint_restores_missing_percent_in_rate_context_only() -> None:
    question = "留存率为30%时如何解释？"

    assert prepare_transcript_for_scoring("留存率为30", question) == "留存率为30%"
    assert prepare_transcript_for_scoring("样本量为30", question) == "样本量为30"


def test_scoring_hint_normalizes_mixed_language_identifiers() -> None:
    hint = prepare_transcript_for_scoring(
        "用 user ID 分组，再用 row number 和 ROC AUC 评估。",
        "请说明 user_id、ROW_NUMBER 和 ROC-AUC。",
    )

    assert hint == "用 user_id 分组，再用 ROW_NUMBER 和 ROC-AUC 评估。"
