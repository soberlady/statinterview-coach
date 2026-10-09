import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

// Follow every dependency edge: a known package must not hide a new advisory.
export function checkAudit(report, lock, exceptions, now = new Date()) {
  if (report?.auditReportVersion !== 2 || report.error ||
      !report.vulnerabilities || !report.metadata?.vulnerabilities ||
      !lock?.packages || !Array.isArray(exceptions)) {
    throw new Error("Invalid or unavailable dependency audit report.");
  }
  const entries = Object.entries(report.vulnerabilities);
  if (entries.length !== report.metadata.vulnerabilities.total) {
    throw new Error("Incomplete dependency audit report.");
  }
  const failures = [];
  const warnings = [];
  function covered(name, exception, parents = new Set()) {
    const item = report.vulnerabilities[name];
    if (!item || parents.has(name) || !exception.affectedPackages.includes(name) ||
        item.severity !== exception.severity || !item.nodes?.length ||
        !item.nodes.every((node) => lock.packages[node]?.dev === true) ||
        !Array.isArray(item.via) || item.via.length === 0) return false;
    const visited = new Set([...parents, name]);
    return item.via.every((via) => typeof via === "string"
      ? covered(via, exception, visited)
      : name === exception.package && via.name === exception.package &&
        via.url === exception.advisory && via.severity === exception.severity &&
        via.range === exception.range &&
        item.nodes.every((node) => lock.packages[node].version === exception.version));
  }
  for (const [name, item] of entries) {
    const exception = exceptions.find((entry) => {
      const deadline = Date.parse(`${entry.reviewBy}T00:00:00Z`);
      return Number.isFinite(deadline) && now.getTime() < deadline &&
        Array.isArray(entry.affectedPackages) && covered(name, entry);
    });
    if (exception) {
      warnings.push(`${name}: ${item.severity}, reviewed exception until ${exception.reviewBy}`);
    } else {
      failures.push(`${name}: ${item.severity ?? "unknown"}, requires review or upgrade`);
    }
  }
  return { failures, warnings };
}

function main() {
  if (!process.env.npm_execpath) throw new Error("Run npm run audit:dependencies.");
  const root = new URL("../", import.meta.url);
  const result = spawnSync(process.execPath, [process.env.npm_execpath, "audit", "--json"], {
    cwd: fileURLToPath(root),
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || ![0, 1].includes(result.status)) {
    throw new Error("Dependency audit could not finish; retry with registry access.");
  }
  const report = JSON.parse(result.stdout);
  const lock = JSON.parse(readFileSync(new URL("package-lock.json", root), "utf8"));
  const exceptions = JSON.parse(readFileSync(new URL("security/npm-audit-exceptions.json", root), "utf8"));
  const { failures, warnings } = checkAudit(report, lock, exceptions);
  console.log(`npm audit: ${report.metadata.vulnerabilities.total} affected packages.`);
  for (const warning of warnings) console.warn(`REVIEWED, UNFIXED: ${warning}`);
  for (const failure of failures) console.error(`BLOCKED: ${failure}`);
  if (warnings.length) console.warn("Known vulnerabilities remain. See docs/DEPENDENCY_UPGRADE_ZH.md.");
  process.exitCode = failures.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
