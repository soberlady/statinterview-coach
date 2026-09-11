import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

mkdirSync(new URL("../.wrangler/types/", import.meta.url), { recursive: true });
const result = spawnSync(process.execPath, [
  fileURLToPath(new URL("./run-wrangler.mjs", import.meta.url)),
  "types", ".wrangler/types/worker.d.ts", "--config", "wrangler.local.jsonc",
], { stdio: "inherit", env: process.env });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
