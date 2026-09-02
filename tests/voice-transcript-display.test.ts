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
