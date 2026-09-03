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
    first_revision = buffer.revision
    buffer.add("item-1", "使用窗口函数按品类分组")

    assert buffer.text == "使用窗口函数按品类分组"
    assert buffer.revision == first_revision + 1

    buffer.add("item-1", "使用窗口函数按品类分组")
    assert buffer.revision == first_revision + 1


def test_transcript_confidence_tracks_committed_fragments() -> None:
    buffer = CommittedTranscriptBuffer()
    buffer.add("item-1", "第一段", 0.6)
    buffer.add("item-2", "第二段", 0.8)

    assert buffer.confidence == 0.7

    buffer.add("item-1", "第一段更新", 0.9)
    assert buffer.confidence == 0.85


def test_clear_starts_a_new_question_transcript() -> None:
    buffer = CommittedTranscriptBuffer()
    buffer.add("item-1", "第一题回答")

    before_clear = buffer.revision
    buffer.clear()
    buffer.add("item-2", "第二题回答")

    assert buffer.text == "第二题回答"
    assert buffer.revision == before_clear + 2


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


def test_scoring_hint_restores_question_percentage_interval_only() -> None:
    question = "留存率为30%，95%置信区间为[27%，33%]，请解释。"

    assert prepare_transcript_for_scoring(
        "真实值落在27到33之间，样本量为30",
        question,
    ) == "真实值落在27%到33%之间，样本量为30"


def test_scoring_hint_does_not_invent_unmentioned_percentage() -> None:
    question = "留存率为30%，95%置信区间为[27%，33%]，请解释。"

    assert prepare_transcript_for_scoring(
        "样本量增加到100",
        question,
    ) == "样本量增加到100"


def test_scoring_hint_normalizes_mixed_language_identifiers() -> None:
    hint = prepare_transcript_for_scoring(
        "用 user ID 分组，再用 row number 和 ROC AUC 评估。",
        "请说明 user_id、ROW_NUMBER 和 ROC-AUC。",
    )

    assert hint == "用 user_id 分组，再用 ROW_NUMBER 和 ROC-AUC 评估。"


def test_accent_aliases_are_normalized_only_when_question_provides_context() -> None:
    raw = "先用 R O W number，再看 R O C A U C 和 panda。"
    contextual = prepare_transcript_for_scoring(
        raw,
        "请解释 ROW_NUMBER、ROC-AUC 和 Pandas。",
    )

    assert contextual == "先用 ROW_NUMBER，再看 ROC-AUC 和 Pandas。"
    assert prepare_transcript_for_scoring(raw, "请解释置信区间。") == raw


def test_python_pronunciation_aliases_use_question_context() -> None:
    raw = "使用Pendas的chuncsize分块，再用HypeQ或SQLate处理。"

    assert prepare_transcript_for_scoring(
        raw,
        "一个20GB CSV无法装入内存，如何用Python完成？",
    ) == "使用Pandas的chunksize分块，再用heapq或SQLite处理。"
    assert prepare_transcript_for_scoring(raw, "请解释置信区间。") == raw


def test_bonferroni_alias_uses_multiple_testing_context() -> None:
    assert prepare_transcript_for_scoring(
        "可以使用Boforronai校正控制风险。",
        "同时观察20个指标时如何控制多重比较误判？",
    ) == "可以使用Bonferroni校正控制风险。"


def test_funnel_near_homophones_require_explicit_step_context() -> None:
    raw = "同意连续时间窗口内按浏览架构支付排序并统计去除用户数。"

    assert prepare_transcript_for_scoring(
        raw,
        "事件表记录浏览、加购、支付，如何计算用户漏斗？",
    ) == "同一连续时间窗口内按浏览、加购、支付排序并统计去重用户数。"
    assert prepare_transcript_for_scoring(raw, "如何解释置信区间？") == raw
