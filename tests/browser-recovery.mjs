import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";

// Runs against the E2E server's isolated mock scorer. No live AI/voice service.
export async function runBrowserRecovery({ baseUrl, trainingSourceId, answerText }) {
  const localChrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
  const executablePath = process.env.STATINTERVIEW_BROWSER_EXECUTABLE ||
    (process.platform === "win32" && existsSync(localChrome) ? localChrome : undefined);
  const browser = await chromium.launch({ executablePath, headless: true });
  const checks = [];
  const errors = [];
  mkdirSync(".tmp/browser-regression", { recursive: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(15_000);
  page.on("pageerror", error => errors.push(error.message));
  const api = async (path, body) => {
    const response = await fetch(baseUrl + path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
    assert.ok(response.ok, `browser fixture API failed: ${response.status} ${path}`);
    return response.json();
  };
  const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
  try {
    await page.goto(baseUrl);
    await page.getByRole("heading", { level: 1 }).waitFor();
    await page.keyboard.press("Tab");
    assert.equal(await page.locator(":focus").textContent(), "跳至主要内容");
    await page.keyboard.press("Enter");
    assert.equal(await page.locator(":focus").getAttribute("id"), "main-content");
    await noOverflow();
    checks.push("mobile home and keyboard skip navigation");

    const { interview } = await api("/api/interviews", { mode: "guided_demo", jobTitle: "Browser recovery fixture", jobDescription: "SQL Python 数据分析", candidateBackground: "有课程经验", durationMinutes: 20 });
    const id = interview.id;
    await page.goto(`${baseUrl}/interview/${id}`);
    const answer = page.getByRole("textbox", { name: "你的回答", exact: true });
    const draft = "浏览器回归：未提交草稿应能在刷新、暂停返回后恢复，并且不能串到下一题。";
    await answer.fill(draft);
    await page.reload();
    await answer.waitFor();
    assert.equal(await answer.inputValue(), draft);
    await page.getByRole("button", { name: "暂停并查看阶段报告", exact: true }).click();
    await page.waitForURL(`**/report/${id}`);
    await page.getByRole("link", { name: "继续面试", exact: true }).click();
    await answer.waitFor();
    assert.equal(await answer.inputValue(), draft);
    await noOverflow();
    await page.screenshot({ path: ".tmp/browser-regression/draft-restored.png", fullPage: true });
    await page.getByRole("button", { name: "清除草稿", exact: true }).click();
    await page.reload();
    await answer.waitFor();
    assert.equal(await answer.inputValue(), "");
    checks.push("draft survives refresh and pause, with explicit clearing");

    // Commit on the server but drop the response, exactly the ambiguous-save case.
    const loseOneTurnResponse = async () => {
      let dropped = false;
      await page.route(`**/api/interviews/${id}/turns`, async route => {
        if (dropped) return route.continue();
        dropped = true;
        const committed = await route.fetch();
        assert.equal(committed.status(), 201);
        await route.abort("failed");
      });
    };
    await page.getByRole("button", { name: /载入完整证据回答/ }).click();
    const firstAnswer = await answer.inputValue();
    await loseOneTurnResponse();
    await page.getByRole("button", { name: "提交回答", exact: true }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(await answer.inputValue(), firstAnswer);
    assert.equal((await api(`/api/interviews/${id}`)).turns.length, 1);
    await page.getByRole("button", { name: "提交回答", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".room-progress-count")?.textContent?.includes("1 / 7"));
    await page.unroute(`**/api/interviews/${id}/turns`);
    await page.reload();
    await answer.waitFor();
    assert.equal(await answer.inputValue(), "");
    assert.equal((await api(`/api/interviews/${id}`)).turns.length, 1);
    checks.push("lost response retries once without duplicate turn or stale draft");

    let state = await api(`/api/interviews/${id}/next-question`);
    while (state.progress.substantiveTurns < 6) {
      state = await api(`/api/interviews/${id}/turns`, { sequenceNumber: state.progress.completedTurns + 1,
        questionId: state.nextQuestion.id, answerText: state.demo.answerOptions.find(option => option.id === "strong").answer });
    }
    await page.reload();
    await answer.waitFor();
    await loseOneTurnResponse();
    let failedCompletion = false;
    await page.route(`**/api/interviews/${id}`, route => {
      if (route.request().method() !== "PATCH" || failedCompletion) return route.continue();
      failedCompletion = true;
      return route.fulfill({ status: 503, json: { error: { message: "Simulated completion failure" } } });
    });
    await page.getByRole("button", { name: /载入完整证据回答/ }).click();
    await page.getByRole("button", { name: "提交回答", exact: true }).click();
    await page.getByRole("alert").waitFor();
    await page.getByRole("button", { name: "提交回答", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "回答已保存" }).waitFor();
    assert.equal(await answer.count(), 0);
    assert.equal((await api(`/api/interviews/${id}`)).turns.length, 7);
    await page.setViewportSize({ width: 320, height: 720 });
    await noOverflow();
    await page.screenshot({ path: ".tmp/browser-regression/completion-recovery.png", fullPage: true });
    await page.getByRole("button", { name: "重试结束确认", exact: true }).click();
    await page.getByRole("heading", { name: "回答、决策与能力状态都已保存。", exact: true }).waitFor();
    assert.equal((await api(`/api/interviews/${id}`)).interview.status, "COMPLETED");
    checks.push("final-turn lost response and completion failure recover without re-answering");

    await page.goto(`${baseUrl}/report/${trainingSourceId}`);
    await page.getByRole("button", { name: "开始两题练习与新题复测", exact: true }).click();
    await page.waitForURL("**/interview/**");
    await answer.waitFor();
    const trainingId = new URL(page.url()).pathname.split("/").at(-1);
    assert.ok(await page.getByRole("region", { name: "专项训练说明" }).locator("li").count());
    for (let index = 0; index < 2; index++) {
      await answer.fill(answerText);
      const response = page.waitForResponse(r => r.url().endsWith("/turns") && r.request().method() === "POST");
      await page.getByRole("button", { name: "提交回答", exact: true }).click();
      assert.equal((await response).status(), 201);
      if (index === 0) {
        await page.waitForFunction(() => document.querySelector(".room-progress-count")?.textContent?.includes("1 / 3"));
      }
    }
    await page.getByRole("button", { name: "开始无提示复测", exact: true }).click();
    await answer.waitFor();
    assert.equal(await page.getByRole("region", { name: "专项训练说明" }).locator("li").count(), 0);
    await noOverflow();
    await page.screenshot({ path: ".tmp/browser-regression/unhinted-transfer.png", fullPage: true });
    await answer.fill("本机复测草稿：我会先核对条件，再独立说明判断依据。");
    await page.reload();
    await page.getByRole("button", { name: "开始无提示复测", exact: true }).click();
    await answer.waitFor();
    assert.match(await answer.inputValue(), /本机复测草稿/);
    assert.equal(await page.getByRole("region", { name: "专项训练说明" }).locator("li").count(), 0);
    await answer.fill(answerText);
    await page.getByRole("button", { name: "提交回答", exact: true }).click();
    await page.getByRole("heading", { name: "回答、决策与能力状态都已保存。", exact: true }).waitFor();
    const trainingReport = (await api(`/api/interviews/${trainingId}/report`)).report;
    assert.equal(trainingReport.metrics.completedTurns, 3);
    assert.equal(trainingReport.policyAudit.summary.matchingSelections, 3);
    checks.push("report starts three-question training; transfer remains unhinted after refresh");
    assert.deepEqual(errors, []);
    return checks;
  } catch (error) {
    mkdirSync(".tmp/browser-regression", { recursive: true });
    await page.screenshot({ path: ".tmp/browser-regression/failure.png", fullPage: true }).catch(() => {});
    throw error;
  } finally { await browser.close(); }
}
