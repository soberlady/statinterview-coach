import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { checkAudit } from "../scripts/check-dependency-audit.mjs";

const exceptions = JSON.parse(readFileSync(new URL("../security/npm-audit-exceptions.json", import.meta.url), "utf8"));
const now = new Date("2026-10-04T00:00:00Z");
function fixture() {
  const { advisory: url, package: name, severity, range, version } = exceptions[0];
  return {
    report: {
      auditReportVersion: 2,
      vulnerabilities: {
        braces: { severity, nodes: ["node_modules/braces"], via: [{ name, url, severity, range }] },
        micromatch: { severity, nodes: ["node_modules/micromatch"], via: ["braces"] },
      },
      metadata: { vulnerabilities: { total: 2 } },
    },
    lock: { packages: {
      "node_modules/braces": { version, dev: true },
      "node_modules/micromatch": { version: "4.0.8", dev: true },
    } },
  };
}

test("known unfixed advisory stays visible, with transitive effects accounted for", () => {
  const { report, lock } = fixture();
  const result = checkAudit(report, lock, exceptions, now);
  assert.deepEqual(result.failures, []);
  assert.equal(result.warnings.length, 2);
});

test("a new advisory on an excepted package blocks the whole affected chain", () => {
  const { report, lock } = fixture();
  report.vulnerabilities.braces.via.push({ name: "braces", url: "https://github.com/advisories/NEW", severity: "high" });
  assert.equal(checkAudit(report, lock, exceptions, now).failures.length, 2);
});

for (const [label, mutate] of [
  ["a severity increase", ({ report }) => { report.vulnerabilities.braces.severity = "critical"; }],
  ["a new installed version", ({ lock }) => { lock.packages["node_modules/braces"].version = "3.0.4"; }],
  ["use as a production dependency", ({ lock }) => { delete lock.packages["node_modules/braces"].dev; }],
  ["a dependency cycle", ({ report }) => { report.vulnerabilities.braces.via = ["micromatch"]; }],
  ["a missing advisory detail", ({ report }) => { report.vulnerabilities.braces.via = []; }],
]) {
  test(`blocks ${label}`, () => {
    const input = fixture();
    mutate(input);
    assert.equal(checkAudit(input.report, input.lock, exceptions, now).failures.length, 2);
  });
}

test("exceptions expire and malformed or incomplete reports fail closed", () => {
  const { report, lock } = fixture();
  assert.equal(checkAudit(report, lock, exceptions, new Date("2026-11-04T00:00:00Z")).failures.length, 2);
  assert.throws(() => checkAudit({ error: { code: "ENETUNREACH" } }, lock, exceptions, now));
  report.metadata.vulnerabilities.total = 3;
  assert.throws(() => checkAudit(report, lock, exceptions, now));
});

test("clean reports pass without warnings", () => {
  const { report, lock } = fixture();
  report.vulnerabilities = {};
  report.metadata.vulnerabilities.total = 0;
  assert.deepEqual(checkAudit(report, lock, exceptions, now), { failures: [], warnings: [] });
});
