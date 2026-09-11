import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildAgentDemo } from "../scripts/agent-demo";

test("offline demo executes the full bounded production policy with no fetch", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Offline demo attempted network access"); };
  try {
    const demo = await buildAgentDemo();
    assert.equal(demo.synthetic, true);
    assert.equal(demo.trace.length, 8);
    assert.deepEqual(demo.trace.map((turn) => turn.action),
      ["VERIFY", "ABSTAIN", "ACCEPT", "ACCEPT", "ACCEPT", "ACCEPT", "ACCEPT", "ACCEPT"]);
    assert.deepEqual(demo.trace.filter((turn) => turn.questionType !== "verification").map((turn) => turn.phase),
      ["public_anchor", "public_anchor", "jd_directed_baseline", "jd_directed_baseline",
        "posterior_adaptive", "posterior_adaptive", "posterior_adaptive"]);
    assert.equal(demo.audit.summary.matchingSelections, 8);
    assert.equal(demo.audit.finalDecision.action, "COMPLETE");
    assert.ok(Object.values(demo.audit.invariants).every(Boolean));
    for (const turn of demo.trace) {
      assert.equal(turn.evaluator, "DEMO_FIXTURE");
      assert.ok(turn.evidence.length > 0);
      assert.ok(turn.evidence.every((quote) => turn.answer.includes(quote)));
      if (turn.action !== "ACCEPT") assert.deepEqual(turn.before, turn.after);
    }
    assert.equal(demo.tamperCheck.detected, true);
    assert.equal(demo.tamperCheck.allQuestionsApproved, true);
    assert.equal(demo.tamperCheck.sequenceNumber, 6);
    assert.notEqual(demo.fingerprint, demo.tamperCheck.fingerprint);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("published demo evidence is byte-for-byte reproducible", async () => {
  const first = await buildAgentDemo();
  assert.deepEqual(await buildAgentDemo(), first);
  const saved = await readFile(new URL("../content/agent-demo.json", import.meta.url), "utf8");
  assert.equal(saved, JSON.stringify(first, null, 2) + "\n");
});
