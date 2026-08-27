from statinterview_agent.voice_transcript import CommittedTranscriptBuffer


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
