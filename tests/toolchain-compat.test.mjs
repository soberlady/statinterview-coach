import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const drizzleRequire = createRequire(require.resolve("drizzle-kit"));
const loaderRequire = createRequire(drizzleRequire.resolve("@esbuild-kit/esm-loader"));
const core = loaderRequire("@esbuild-kit/core-utils");

test("the patched legacy loader retains TypeScript transforms and source maps", async () => {
  const source = "export const answer: number = 6 * 7;";
  const path = fileURLToPath(new URL("../.tmp/compat-fixture.ts", import.meta.url));
  const transformed = core.transformSync(source, path);
  const context = { module: { exports: {} } };
  runInNewContext(transformed.code, context);
  assert.equal(context.module.exports.answer, 42);
  assert.ok(transformed.map.sources.some((item) => item.endsWith("compat-fixture.ts")));
  const esm = await core.transform(source, path);
  const exported = await import(`data:text/javascript;base64,${Buffer.from(esm.code).toString("base64")}`);
  assert.equal(exported.answer, 42);
});

test("the database CLI exports the actual TypeScript schema after the upgrade", () => {
  const sql = execFileSync(process.execPath, [
    fileURLToPath(new URL("../node_modules/drizzle-kit/bin.cjs", import.meta.url)),
    "export", "--dialect=sqlite", "--schema=./db/schema.ts",
  ], { cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8", timeout: 30_000 });
  for (const table of ["interviews", "interview_turns", "agent_events", "skill_states"]) {
    assert.ok(sql.includes(`CREATE TABLE \`${table}\``), `missing ${table}`);
  }
  assert.match(sql, /FOREIGN KEY/);
});
