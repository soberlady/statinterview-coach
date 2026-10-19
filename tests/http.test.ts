import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, readJsonObject } from "../app/api/_lib/http";

const LIMIT = 128 * 1024;
const encoder = new TextEncoder();

function sizedJson(bytes: number) {
  const overhead = encoder.encode(JSON.stringify({ data: "" })).byteLength;
  return JSON.stringify({ data: "x".repeat(bytes - overhead) });
}

function streamedRequest(stream: ReadableStream<Uint8Array>, headers?: HeadersInit) {
  const init: RequestInit & { duplex: "half" } = {
    method: "POST", body: stream, duplex: "half", headers,
  };
  return new Request("http://localhost/fixture", init);
}

const tooLarge = (error: unknown) => error instanceof ApiError
  && error.status === 413 && error.code === "PAYLOAD_TOO_LARGE";

test("JSON body accepts exactly 128 KiB and rejects one extra byte without Content-Length", async () => {
  const exact = new Request("http://localhost/fixture", { method: "POST", body: sizedJson(LIMIT) });
  assert.equal(exact.headers.get("content-length"), null);
  assert.equal(typeof (await readJsonObject(exact)).data, "string");
  const over = new Request("http://localhost/fixture", { method: "POST", body: sizedJson(LIMIT + 1) });
  await assert.rejects(readJsonObject(over), tooLarge);
});

test("body limit counts UTF-8 bytes rather than JavaScript characters", async () => {
  const body = JSON.stringify({ data: "汉".repeat(50_000) });
  assert.ok(body.length < LIMIT);
  assert.ok(encoder.encode(body).byteLength > LIMIT);
  await assert.rejects(readJsonObject(new Request("http://localhost/fixture", {
    method: "POST", body,
  })), tooLarge);
});

test("a misleading small Content-Length cannot bypass the actual byte limit", async () => {
  await assert.rejects(readJsonObject(new Request("http://localhost/fixture", {
    method: "POST", body: sizedJson(LIMIT + 1), headers: { "Content-Length": "1" },
  })), tooLarge);
});

test("chunked oversized body is cancelled before consuming its remaining chunks", async () => {
  const bytes = encoder.encode(sizedJson(2 * LIMIT));
  let offset = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) { controller.close(); return; }
      const next = Math.min(offset + 32_768, bytes.length);
      controller.enqueue(bytes.slice(offset, next));
      offset = next;
    },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  const request = streamedRequest(stream);
  assert.equal(request.headers.get("content-length"), null);
  await assert.rejects(readJsonObject(request), tooLarge);
  assert.equal(cancelled, true);
  assert.ok(offset < bytes.length);
});

test("a huge first chunk returns 413 even if upstream cancellation never settles", async () => {
  let cancelled = false;
  const request = streamedRequest(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(sizedJson(1024 * 1024)));
    },
    cancel() { cancelled = true; return new Promise<void>(() => {}); },
  }));
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await assert.rejects(Promise.race([
      readJsonObject(request),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("reader hung")), 2_000); }),
    ]), tooLarge);
    assert.equal(cancelled, true);
    assert.equal(request.body?.locked, false);
  } finally { clearTimeout(timeout); }
});

test("chunk boundaries inside a multibyte character preserve JSON text", async () => {
  const bytes = encoder.encode(JSON.stringify({ data: "汉字与 emoji 🧪" }));
  const request = streamedRequest(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    },
  }));
  assert.deepEqual(await readJsonObject(request), { data: "汉字与 emoji 🧪" });
});

test("oversized declared length still rejects immediately", async () => {
  await assert.rejects(readJsonObject(new Request("http://localhost/fixture", {
    method: "POST", body: "{}", headers: { "Content-Length": String(LIMIT + 1) },
  })), tooLarge);
});

test("malformed, empty and non-object JSON retain their existing 400 contracts", async () => {
  for (const body of ["{", ""]) {
    await assert.rejects(readJsonObject(new Request("http://localhost/fixture", { method: "POST", body })),
      (error: unknown) => error instanceof ApiError && error.status === 400 && error.code === "INVALID_JSON");
  }
  for (const body of ["null", "[]", "1", '"text"']) {
    await assert.rejects(readJsonObject(new Request("http://localhost/fixture", { method: "POST", body })),
      (error: unknown) => error instanceof ApiError && error.status === 400 && error.code === "VALIDATION_ERROR");
  }
});

test("a failed body stream remains INVALID_JSON rather than leaking its transport error", async () => {
  const request = streamedRequest(new ReadableStream<Uint8Array>({
    start(controller) { controller.error(new Error("fixture transport error")); },
  }));
  await assert.rejects(readJsonObject(request), (error: unknown) => error instanceof ApiError
    && error.status === 400 && error.code === "INVALID_JSON");
});

test("a body locked by another reader retains the INVALID_JSON contract", async () => {
  const request = new Request("http://localhost/fixture", { method: "POST", body: "{}" });
  const otherReader = request.body!.getReader();
  try {
    await assert.rejects(readJsonObject(request), (error: unknown) => error instanceof ApiError
      && error.status === 400 && error.code === "INVALID_JSON");
    assert.equal(request.body?.locked, true);
  } finally { otherReader.releaseLock(); }
});
