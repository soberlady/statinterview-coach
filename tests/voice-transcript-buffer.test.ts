import assert from "node:assert/strict";
import test from "node:test";
import { VoiceTranscriptBuffer } from "../app/lib/voice-transcript-buffer";

async function* chunks(...values: string[]) { yield* values; }
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

test("renders deltas before stream closes without duplicating cumulative text", async () => {
  const buffer = new VoiceTranscriptBuffer();
  const updates: string[] = [];
  async function* live() {
    yield "首先";
    assert.deepEqual(updates, ["首先"]);
    yield "检查样本。";
    assert.equal(updates.at(-1), "首先检查样本。");
  }
  assert.equal(await buffer.consume(live(), "a", true, (text) => updates.push(text)), "首先检查样本。");
  assert.equal(buffer.text, "首先检查样本。");
});

test("concurrent segments retain arrival order when later stream closes first", async () => {
  const buffer = new VoiceTranscriptBuffer();
  const pause = gate();
  async function* first() { await pause.promise; yield "第一句"; }
  const pending = buffer.consume(first(), "a", true, () => {});
  await buffer.consume(chunks("第二句"), "b", true, () => {});
  pause.release();
  await pending;
  assert.equal(buffer.text, "第一句 第二句");
});

test("final revision supersedes an in-flight interim and rejects late interim revisions", async () => {
  const buffer = new VoiceTranscriptBuffer();
  const pause = gate();
  async function* interim() { yield "临时"; await pause.promise; yield "错误"; }
  const pending = buffer.consume(interim(), "a", false, () => {});
  await buffer.consume(chunks("完整", "答案"), "a", true, () => {});
  pause.release();
  assert.equal(await pending, null);
  assert.equal(await buffer.consume(chunks("旧文本"), "a", false, () => {}), null);
  assert.equal(buffer.text, "完整答案");
});

test("saved checkpoint clears stale UI and prevents previous turn streams from returning", async () => {
  const buffer = new VoiceTranscriptBuffer();
  const pause = gate();
  const updates: string[] = [];
  async function* oldTurn() { yield "旧题开头"; await pause.promise; yield "旧题结尾"; }
  const pending = buffer.consume(oldTurn(), "old", true, (text) => updates.push(text));
  await Promise.resolve();
  buffer.checkpoint();
  assert.equal(buffer.text, "");
  await buffer.consume(chunks("新题答案"), "new", true, (text) => updates.push(text));
  const count = updates.length;
  pause.release();
  assert.equal(await pending, null);
  assert.equal(await buffer.consume(chunks("旧题补发"), "old", true, () => assert.fail()), null);
  assert.equal(updates.length, count);
  assert.equal(buffer.text, "新题答案");
});

test("disconnected room cannot update the new session", async () => {
  const buffer = new VoiceTranscriptBuffer();
  let active = true;
  async function* stream() { yield "已显示"; active = false; yield "断线迟到"; }
  const updates: string[] = [];
  assert.equal(await buffer.consume(stream(), "a", true, (text) => updates.push(text), () => active), null);
  assert.deepEqual(updates, ["已显示"]);
});

test("newer interim replaces older revision without losing other segments", async () => {
  const buffer = new VoiceTranscriptBuffer();
  await buffer.consume(chunks("第一个片段"), "a", true, () => {});
  await buffer.consume(chunks("未完成"), "b", false, () => {});
  await buffer.consume(chunks("完整第二片段"), "b", true, () => {});
  assert.equal(buffer.text, "第一个片段 完整第二片段");
});
