import assert from "node:assert/strict";
import test from "node:test";
import { publicShowcaseAction } from "../app/lib/public-showcase";

test("normal deployments preserve every route", () => {
  assert.deepEqual(publicShowcaseAction("/api/interviews", false), {
    kind: "allow",
  });
  assert.deepEqual(publicShowcaseAction("/interview/int_1", false), {
    kind: "allow",
  });
});

test("public showcase redirects data-bearing pages", () => {
  assert.deepEqual(publicShowcaseAction("/", true), {
    kind: "redirect",
    location: "/showcase",
  });
  assert.deepEqual(publicShowcaseAction("/interview/int_1", true), {
    kind: "redirect",
    location: "/showcase",
  });
  assert.deepEqual(publicShowcaseAction("/report/int_1", true), {
    kind: "redirect",
    location: "/showcase",
  });
});

test("public showcase blocks operational APIs but keeps health and lab", () => {
  assert.deepEqual(publicShowcaseAction("/api/interviews", true), {
    kind: "block-api",
  });
  assert.deepEqual(
    publicShowcaseAction("/api/interviews/int_1/voice-token", true),
    { kind: "block-api" },
  );
  assert.deepEqual(publicShowcaseAction("/api/health", true), {
    kind: "allow",
  });
  assert.deepEqual(publicShowcaseAction("/lab", true), { kind: "allow" });
  assert.deepEqual(publicShowcaseAction("/showcase", true), {
    kind: "allow",
  });
});
