import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

test("keeps the production product copy and safety boundary", async () => {
  const [page, setup, interview, voiceReadiness, report, lab] = await Promise.all([
    readFile(new URL("app/page.tsx", projectRoot), "utf8"),
    readFile(
      new URL("app/components/InterviewSetupForm.tsx", projectRoot),
      "utf8",
    ),
    readFile(new URL("app/components/InterviewRoom.tsx", projectRoot), "utf8"),
    readFile(new URL("app/lib/voice-readiness.ts", projectRoot), "utf8"),
    readFile(new URL("app/components/ReportView.tsx", projectRoot), "utf8"),
    readFile(new URL("app/lab/page.tsx", projectRoot), "utf8"),
  ]);

  assert.match(page, /不凑题数/);
  assert.match(page, /Private research build/);
  assert.doesNotMatch(page, /Public beta/);
  assert.match(setup, /开始诊断/);
  assert.doesNotMatch(setup, /开始文本诊断/);
  assert.match(voiceReadiness, /实时面试官已就绪/);
  assert.match(voiceReadiness, /正在等待实时面试官/);
  assert.match(setup, /进入引导演示/);
  assert.match(setup, /合成回答/);
  assert.match(interview, /暂停并退出/);
  assert.match(interview, /RECOVERING/);
  assert.match(interview, /DETERMINISTIC DEMO/);
  assert.match(report, /确定性合成夹具/);
  assert.match(page, /不用于自动化招聘决策/);
  assert.match(report, /低可靠性回答不会直接改变能力状态/);
  assert.match(report, /每一次选题都可以确定性重放/);
  assert.match(report, /当时的前三名候选题/);
  assert.match(report, /当前使用实验性语义量表评分/);
  assert.match(lab, /离线合成实验，不是招聘效度证明/);
  assert.match(lab, /均衡型岗位上三种策略差异很小/);
  assert.match(lab, /刻意构造的合成/);
  assert.match(lab, /scoringReleaseStatus/);
  assert.match(lab, /中文字符错误率/);
  assert.match(lab, /NOT_MEASURED|voiceReleaseStatus/);
  assert.match(lab, /formatMetric/);
  assert.match(lab, /只在锁定测试集上报告/);
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

test("ships a read-only synthetic portfolio demo", async () => {
  const [showcase, guard, worker] = await Promise.all([
    readFile(
      new URL("app/components/PublicShowcase.tsx", projectRoot),
      "utf8",
    ),
    readFile(new URL("app/lib/public-showcase.ts", projectRoot), "utf8"),
    readFile(new URL("worker/index.ts", projectRoot), "utf8"),
  ]);

  assert.match(showcase, /只读 · 合成数据 · 不保存/);
  assert.match(showcase, /VERIFY/);
  assert.match(showcase, /ABSTAIN/);
  assert.match(showcase, /7 \/ 7 决策一致/);
  assert.match(guard, /block-api/);
  assert.match(worker, /PUBLIC_SHOWCASE_READ_ONLY/);
  assert.match(worker, /STATINTERVIEW_PUBLIC_SHOWCASE/);
});

test("packages Sites metadata and the generated D1 migration", async () => {
  await Promise.all([
    access(new URL("dist/server/index.js", projectRoot)),
    access(new URL("dist/.openai/hosting.json", projectRoot)),
    access(new URL("dist/.openai/drizzle/0000_flat_thor.sql", projectRoot)),
  ]);
});
