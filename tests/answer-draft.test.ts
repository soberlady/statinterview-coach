import assert from "node:assert/strict";
import test from "node:test";
import { ANSWER_DRAFT_TTL_MS, clearAnswerDraft, loadAnswerDraft, saveAnswerDraft } from "../app/lib/answer-draft";

function memoryStorage() {
  const records = new Map<string, string>();
  return { getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => { records.set(key, value); },
    removeItem: (key: string) => { records.delete(key); }, records };
}

test("drafts restore only for the matching interview and current question", () => {
  const storage = memoryStorage();
  assert.equal(saveAnswerDraft(storage, "a", "q1", "未提交回答", 1000), true);
  assert.equal(loadAnswerDraft(storage, "b", "q1", 1001), null);
  assert.equal(loadAnswerDraft(storage, "a", "q1", 1001), "未提交回答");
  assert.equal(loadAnswerDraft(storage, "a", "q2", 1001), null);
  assert.equal(storage.records.size, 0);
});

test("expired and future-dated drafts are discarded", () => {
  for (const now of [999, 1000 + ANSWER_DRAFT_TTL_MS]) {
    const storage = memoryStorage();
    saveAnswerDraft(storage, "a", "q1", "未提交回答", 1000);
    assert.equal(loadAnswerDraft(storage, "a", "q1", now), null);
    assert.equal(storage.records.size, 0);
  }
});

test("clearing a draft removes its persisted text", () => {
  const storage = memoryStorage();
  saveAnswerDraft(storage, "a", "q1", "未提交回答");
  clearAnswerDraft(storage, "a");
  assert.equal(loadAnswerDraft(storage, "a", "q1"), null);
  saveAnswerDraft(storage, "a", "q1", "新草稿");
  saveAnswerDraft(storage, "a", "q1", "");
  assert.equal(storage.records.size, 0);
});

test("disabled, corrupt and full storage cannot interrupt answering", () => {
  assert.equal(saveAnswerDraft(null, "a", "q1", "草稿"), false);
  assert.equal(loadAnswerDraft(null, "a", "q1"), null);
  const corrupt = { getItem: () => "{", setItem: () => { throw new Error("quota"); }, removeItem: () => { throw new Error("blocked"); } };
  assert.equal(loadAnswerDraft(corrupt, "a", "q1"), null);
  assert.equal(saveAnswerDraft(corrupt, "a", "q1", "草稿"), false);
});
