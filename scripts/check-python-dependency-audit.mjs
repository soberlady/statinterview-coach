import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const canonicalName = (name) => name.toLowerCase().replace(/[-_.]+/g, "-");

export function checkPythonAudit(report) {
  if (report?.error || !Array.isArray(report?.dependencies) || !report.dependencies.length) {
    throw new Error("Invalid or unavailable Python dependency audit report.");
  }
  const names = new Set();
  const failures = [];
  let audited = 0;
  let localSource = 0;
  for (const dependency of report.dependencies) {
    if (typeof dependency?.name !== "string" || !dependency.name.trim()) {
      throw new Error("Python audit contains an unnamed dependency.");
    }
    const name = canonicalName(dependency.name);
    if (names.has(name)) throw new Error(`Duplicate Python audit dependency: ${name}`);
    names.add(name);
    if ("skip_reason" in dependency) {
      // This unpublished editable is reviewed as repository source, not via PyPI.
      // Every skipped third-party dependency must still fail the gate.
      if (name === "statinterview-agent" && dependency.skip_reason === "distribution marked as editable") {
        localSource += 1;
      } else {
        failures.push(`${name}: could not audit (${dependency.skip_reason})`);
      }
      continue;
    }
    if (typeof dependency.version !== "string" || !dependency.version || !Array.isArray(dependency.vulns)) {
      throw new Error(`Incomplete Python audit dependency: ${name}`);
    }
    audited += 1;
    for (const vulnerability of dependency.vulns) {
      if (typeof vulnerability?.id !== "string" || !vulnerability.id ||
          !Array.isArray(vulnerability.fix_versions) ||
          !vulnerability.fix_versions.every((version) => typeof version === "string")) {
        throw new Error(`Incomplete Python vulnerability report: ${name}`);
      }
      failures.push(`${name} ${dependency.version}: ${vulnerability.id}; fixed in ${vulnerability.fix_versions.join(", ") || "no published fix"}`);
    }
  }
  if (!["pytest", "pydantic", "pip-audit"].every((name) => names.has(name))) {
    throw new Error("Python audit is missing runtime, test or audit dependencies; install services/agent[dev].");
  }
  return { audited, localSource, failures };
}

function main() {
  const root = new URL("../", import.meta.url);
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL("scripts/run-python.mjs", root)),
    "-m", "pip_audit", "--format", "json", "--progress-spinner", "off", "--skip-editable",
  ], { cwd: fileURLToPath(root), encoding: "utf8", timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || ![0, 1].includes(result.status)) {
    throw new Error("Python dependency audit could not finish; check the environment and PyPI access.");
  }
  const { audited, localSource, failures } = checkPythonAudit(JSON.parse(result.stdout));
  console.log(`Python audit: ${audited} installed packages checked; ${localSource} local source package excluded.`);
  for (const failure of failures) console.error(`BLOCKED: ${failure}`);
  // A tool failure is never turned into success by an otherwise empty report.
  process.exitCode = result.status !== 0 || failures.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
