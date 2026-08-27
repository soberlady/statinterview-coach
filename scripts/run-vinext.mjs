import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const command = process.argv[2];

if (!["dev", "build", "start"].includes(command)) {
  console.error("Usage: node scripts/run-vinext.mjs <dev|build|start>");
  process.exit(1);
}

process.env.WRANGLER_LOG_PATH ??= ".wrangler/wrangler.log";

const cliPath = fileURLToPath(
  new URL("../node_modules/vinext/dist/cli.js", import.meta.url),
);
const result = spawnSync(process.execPath, [cliPath, command], {
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);
