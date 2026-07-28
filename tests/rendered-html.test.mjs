import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

test("keeps the production product copy and safety boundary", async () => {
  const [page, setup, report] = await Promise.all([
    readFile(new URL("app/page.tsx", projectRoot), "utf8"),
    readFile(
      new URL("app/components/InterviewSetupForm.tsx", projectRoot),
      "utf8",
    ),
    readFile(new URL("app/components/ReportView.tsx", projectRoot), "utf8"),
  ]);

  assert.match(page, /不凑题数/);
  assert.match(setup, /开始文本诊断/);
  assert.match(page, /不用于自动化招聘决策/);
  assert.match(report, /低可靠性回答不会直接改变能力状态/);
  assert.doesNotMatch(page, /Your site is taking shape|vinext-starter/i);
});

test("ships dynamic Open Graph metadata and its image asset", async () => {
  const layout = await readFile(
    new URL("app/layout.tsx", projectRoot),
    "utf8",
  );

  assert.match(layout, /x-forwarded-host/);
  assert.match(layout, /metadataBase/);
  assert.match(layout, /summary_large_image/);
  assert.match(layout, /\/og\.png/);
  await access(new URL("public/og.png", projectRoot));
});

test("packages Sites metadata and the generated D1 migration", async () => {
  await Promise.all([
    access(new URL("dist/server/index.js", projectRoot)),
    access(new URL("dist/.openai/hosting.json", projectRoot)),
    access(new URL("dist/.openai/drizzle/0000_flat_thor.sql", projectRoot)),
  ]);
});
