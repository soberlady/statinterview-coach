import assert from "node:assert/strict";
import test from "node:test";
import { checkPythonAudit } from "../scripts/check-python-dependency-audit.mjs";

function cleanReport() {
  return { dependencies: [
    { name: "pytest", version: "9.1.1", vulns: [] },
    { name: "pydantic", version: "2.13.4", vulns: [] },
    { name: "pip-audit", version: "2.10.1", vulns: [] },
    { name: "statinterview-agent", skip_reason: "distribution marked as editable" },
  ], fixes: [] };
}

test("Python audit covers test, runtime and audit tools while identifying local source", () => {
  assert.deepEqual(checkPythonAudit(cleanReport()), {
    audited: 3, localSource: 1, failures: [],
  });
});

test("vulnerable test, build or transitive runtime packages block the audit", () => {
  for (const [name, version, id, fix] of [
    ["pytest", "8.4.2", "PYSEC-2026-1845", "9.0.3"],
    ["setuptools", "79.0.1", "PYSEC-2026-3447", "83.0.0"],
    ["runtime-transitive-fixture", "0.1", "GHSA-fixture", "0.2"],
  ]) {
    const report = cleanReport();
    report.dependencies.push({ name, version, vulns: [
      { id, fix_versions: [fix] },
    ] });
    if (name === "pytest") report.dependencies.shift();
    const result = checkPythonAudit(report);
    assert.equal(result.failures.length, 1);
    assert.ok(result.failures[0].includes(id));
    assert.ok(result.failures[0].includes(fix));
  }
});

test("unknown or editable third-party packages cannot silently skip auditing", () => {
  for (const skip_reason of ["distribution marked as editable", "not found on PyPI"]) {
    const report = cleanReport();
    report.dependencies.push({ name: "external-fixture", skip_reason });
    assert.equal(checkPythonAudit(report).failures.length, 1);
  }
  const report = cleanReport();
  report.dependencies.at(-1).skip_reason = "not found on PyPI";
  assert.equal(checkPythonAudit(report).failures.length, 1);
});

test("missing, empty, malformed or incomplete audit reports fail closed", () => {
  for (const report of [null, {}, { dependencies: [] },
    { dependencies: [{ name: "pytest", version: "9.1.1" }] },
    { dependencies: [{ name: "pytest", version: "9.1.1", vulns: [] }] },
    { ...cleanReport(), error: "service unavailable" },
  ]) assert.throws(() => checkPythonAudit(report));
  for (const malformed of [{}, { id: "fixture" }, { id: "fixture", fix_versions: "9.0.3" }]) {
    const report = cleanReport();
    report.dependencies[0].vulns.push(malformed);
    assert.throws(() => checkPythonAudit(report));
  }
});

test("duplicate package entries cannot hide a partial audit", () => {
  const report = cleanReport();
  report.dependencies.push({ name: "PIP_audit", version: "2.10.1", vulns: [] });
  assert.throws(() => checkPythonAudit(report));
});
