import assert from "node:assert/strict";
import test from "node:test";
import { normalizeVoiceTranscriptForDisplay } from "../app/lib/voice-transcript-display";

test("spoken integer percentages use compact display notation", () => {
  assert.equal(
    normalizeVoiceTranscriptForDisplay(
      "留存率下降百分之十五，置信水平为百分之九十五。",
    ),
    "留存率下降15%，置信水平为95%。",
  );
});

test("spoken decimal and large percentages are normalized", () => {
  assert.equal(
    normalizeVoiceTranscriptForDisplay(
      "提升百分之零点五，也可能增长百分之一百二十。",
    ),
    "提升0.5%，也可能增长120%。",
  );
});

test("unrelated Chinese numbers and incomplete interim text stay unchanged", () => {
  assert.equal(
    normalizeVoiceTranscriptForDisplay(
      "样本量是一千，当前正在说百分之",
    ),
    "样本量是一千，当前正在说百分之",
  );
});

test("question percentages are restored when ASR drops the percent phrase", () => {
  const question =
    "留存率为30%，95%置信区间为[27%，33%]，请解释这个区间。";

  assert.equal(
    normalizeVoiceTranscriptForDisplay(
      "在九十五的置信水平下，真实值落在27到 33之间。",
      question,
    ),
    "在95%的置信水平下，真实值落在27%到33%之间。",
  );
});

test("decimal percentages use question context in both label orders", () => {
  const question =
    "正样本只占0.5%，一个模型准确率达到99.5%，如何判断？";

  assert.equal(
    normalizeVoiceTranscriptForDisplay(
      "正样本仅占零点五，99。5的准确率没有参考价值。",
      question,
    ),
    "正样本仅占0.5%，99.5%的准确率没有参考价值。",
  );
});

test("question context never turns unrelated numbers into percentages", () => {
  assert.equal(
    normalizeVoiceTranscriptForDisplay(
      "样本量增加到95，观察27到33天。",
      "留存率为30%，95%置信区间为[27%，33%]。",
    ),
    "样本量增加到95，观察27到33天。",
  );
});
