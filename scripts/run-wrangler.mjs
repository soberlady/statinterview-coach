import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

process.env.WRANGLER_LOG_PATH ??= ".wrangler/wrangler.log";

const cliPath = fileURLToPath(
  new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url),
);
const result = spawnSync(
  process.execPath,
  [cliPath, ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: process.env,
  },
);

process.exit(result.status ?? 1);
