import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const command = process.argv[2];
const extraArgs = process.argv.slice(3);

if (!["dev", "build", "start"].includes(command)) {
  console.error("Usage: node scripts/run-vinext.mjs <dev|build|start>");
  process.exit(1);
}

process.env.WRANGLER_LOG_PATH ??= ".wrangler/wrangler.log";

const cliPath = fileURLToPath(
  new URL("../node_modules/vinext/dist/cli.js", import.meta.url),
);
// Vinext 1.x delegates dev to Vite, whose default port differs from Vinext 0.x.
const devDefaults = command === "dev" &&
  !extraArgs.some((arg) => arg === "--port" || arg.startsWith("--port="))
  ? ["--port", process.env.PORT || "3000"]
  : [];
const result = spawnSync(process.execPath, [cliPath, command, ...devDefaults, ...extraArgs], {
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);
