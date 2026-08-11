import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const MINIMUM_NODE = [22, 13, 0];
const REQUIRED_FILES = [
  "content/question-bank.json",
  "drizzle/0000_flat_thor.sql",
  ".openai/hosting.json",
];

export function parseEnvText(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

export function inspectConfiguration(
  env,
  { nodeVersion = process.versions.node, fileExists = existsSync } = {},
) {
  const checks = [];
  const add = (level, code, message) => checks.push({ level, code, message });
  const configured = (name) => typeof env[name] === "string" && env[name].trim() !== "";
  const group = (names, label) => {
    const count = names.filter(configured).length;
    if (count === 0) {
      add("warn", `${label}_NOT_CONFIGURED`, `${label} is optional and not configured.`);
      return false;
    }
    if (count !== names.length) {
      add("error", `${label}_PARTIAL`, `${label} must set all of: ${names.join(", ")}.`);
      return false;
    }
    add("ok", `${label}_CONFIGURED`, `${label} is fully configured.`);
    return true;
  };

  const actualNode = nodeVersion.split(".").map(Number);
  const nodeOk = MINIMUM_NODE.every(
    (part, index) => actualNode[index] === part || actualNode[index] > part || actualNode.slice(0, index).some((value, previous) => value > MINIMUM_NODE[previous]),
  );
  add(
    nodeOk ? "ok" : "error",
    nodeOk ? "NODE_VERSION_OK" : "NODE_VERSION_UNSUPPORTED",
    `Node.js ${nodeVersion}; required >=${MINIMUM_NODE.join(".")}.`,
  );

  const livekitReady = group(
    ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"],
    "LIVEKIT",
  );
  if (livekitReady && !isUrl(env.LIVEKIT_URL, ["ws:", "wss:"])) {
    add("error", "LIVEKIT_URL_INVALID", "LIVEKIT_URL must use ws:// or wss://.");
  }

  if (configured("STATINTERVIEW_API_BASE_URL") && !isUrl(env.STATINTERVIEW_API_BASE_URL, ["http:", "https:"])) {
    add("error", "API_BASE_URL_INVALID", "STATINTERVIEW_API_BASE_URL must use http:// or https://.");
  }

  if (
    configured("STATINTERVIEW_LIVEKIT_PRICING_PLAN") &&
    !["build_ship", "scale"].includes(env.STATINTERVIEW_LIVEKIT_PRICING_PLAN)
  ) {
    add("error", "LIVEKIT_PRICING_PLAN_INVALID", "STATINTERVIEW_LIVEKIT_PRICING_PLAN must be build_ship or scale.");
  }

  if (configured("STATINTERVIEW_TTS_SPEED")) {
    const speed = Number(env.STATINTERVIEW_TTS_SPEED);
    if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) {
      add("error", "TTS_SPEED_INVALID", "STATINTERVIEW_TTS_SPEED must be between 0.5 and 2.");
    }
  }

  const scorerReady = group(
    [
      "STATINTERVIEW_SCORER_ENDPOINT",
      "STATINTERVIEW_SCORER_API_KEY",
      "STATINTERVIEW_SCORER_MODEL",
    ],
    "SCORER",
  );
  if (scorerReady && !isUrl(env.STATINTERVIEW_SCORER_ENDPOINT, ["http:", "https:"])) {
    add("error", "SCORER_ENDPOINT_INVALID", "STATINTERVIEW_SCORER_ENDPOINT must use http:// or https://.");
  }
  if (
    configured("STATINTERVIEW_SCORER_STRICT") &&
    !["0", "1"].includes(env.STATINTERVIEW_SCORER_STRICT)
  ) {
    add("error", "SCORER_STRICT_INVALID", "STATINTERVIEW_SCORER_STRICT must be 0 or 1.");
  }

  const priceNames = [
    "STATINTERVIEW_SCORER_INPUT_USD_PER_MILLION_TOKENS",
    "STATINTERVIEW_SCORER_OUTPUT_USD_PER_MILLION_TOKENS",
    "STATINTERVIEW_SCORER_PRICING_VERSION",
  ];
  const priceCount = priceNames.filter(configured).length;
  if (priceCount > 0 && priceCount < priceNames.length) {
    add("error", "SCORER_PRICING_PARTIAL", `Scorer pricing must set all of: ${priceNames.join(", ")}.`);
  } else if (priceCount === priceNames.length) {
    for (const name of priceNames.slice(0, 2)) {
      const value = Number(env[name]);
      if (!Number.isFinite(value) || value < 0) {
        add("error", "SCORER_PRICE_INVALID", `${name} must be a non-negative number.`);
      }
    }
    add("ok", "SCORER_PRICING_CONFIGURED", "Scorer pricing is fully configured.");
  } else if (scorerReady) {
    add("warn", "SCORER_PRICING_NOT_CONFIGURED", "Scorer calls work, but their token usage remains explicitly unpriced.");
  }

  for (const [name, value] of Object.entries(env)) {
    if (
      name.startsWith("NEXT_PUBLIC_") &&
      /(SECRET|API_KEY|TOKEN|PASSWORD)/.test(name) &&
      typeof value === "string" &&
      value.trim()
    ) {
      add("error", "PUBLIC_SECRET_EXPOSURE", `${name} looks sensitive and must not be exposed to browser code.`);
    }
  }

  for (const path of REQUIRED_FILES) {
    const present = fileExists(path);
    add(
      present ? "ok" : "error",
      present ? "REQUIRED_FILE_OK" : "REQUIRED_FILE_MISSING",
      `${path} ${present ? "is present" : "is missing"}.`,
    );
  }

  return {
    ok: !checks.some((check) => check.level === "error"),
    summary: {
      ok: checks.filter((check) => check.level === "ok").length,
      warnings: checks.filter((check) => check.level === "warn").length,
      errors: checks.filter((check) => check.level === "error").length,
    },
    checks,
  };
}

function isUrl(value, protocols) {
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function loadEnvironment() {
  const fromFiles = {};
  for (const path of [".env", ".env.local"]) {
    if (existsSync(path)) Object.assign(fromFiles, parseEnvText(readFileSync(path, "utf8")));
  }
  return { ...fromFiles, ...process.env };
}

function printReport(report) {
  console.log("StatInterview configuration doctor (secret values are never printed)");
  for (const check of report.checks) {
    console.log(`[${check.level.toUpperCase()}] ${check.message}`);
  }
  console.log(`Result: ${report.summary.errors} error(s), ${report.summary.warnings} warning(s), ${report.summary.ok} check(s) passed.`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const report = inspectConfiguration(loadEnvironment());
  printReport(report);
  if (!report.ok) process.exitCode = 1;
}
