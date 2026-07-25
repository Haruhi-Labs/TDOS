import { spawn } from "node:child_process";
import { chromium } from "playwright";

const VITE_PORT = 29000 + Math.floor(Math.random() * 1000);
const APP_URL = `http://127.0.0.1:${VITE_PORT}/prototype`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function eventually(fn, timeoutMs = 12000, intervalMs = 50) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await wait(intervalMs);
  }
  if (lastError) throw lastError;
  throw new Error("Timed out waiting for condition");
}

function startVite() {
  const child = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(VITE_PORT)], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += String(chunk);
  });
  child.output = () => output;
  return child;
}

async function waitForHttp(url) {
  await eventually(async () => {
    const response = await fetch(url, { method: "GET" }).catch(() => null);
    return Boolean(response && response.ok);
  }, 15000);
}

async function main() {
  const vite = startVite();
  let browser = null;
  try {
    await waitForHttp(`http://127.0.0.1:${VITE_PORT}/prototype`);
    browser = await chromium.launch();
    // 窄屏会触发 prefersMobileBattleMode；曾因 hudUi 缺 split 按钮字段而抛错冻结整局。
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const pageErrors = [];
    page.on("pageerror", (error) => {
      pageErrors.push(String(error?.message || error));
    });
    await page.goto(APP_URL, { waitUntil: "domcontentloaded" });

    await page.waitForSelector("#gameCanvas", { timeout: 10000 });
    await page.waitForSelector("#protoModeSelect", { timeout: 10000 });
    await page.waitForSelector("#protoDiagnostics", { timeout: 10000 });
    await page.waitForSelector("#protoModeParams", { timeout: 10000 });
    await page.waitForSelector("#protoPauseBtn", { timeout: 10000 });

    const modeCount = await page.locator("#protoModeSelect option").count();
    assert(modeCount >= 2, `expected >=2 modes, got ${modeCount}`);

    // ensure runtime advances (mobile HUD path must not crash the rAF loop)
    await eventually(async () => {
      const text = await page.locator("#protoDiagnostics").innerText();
      return text.includes("模拟时间");
    }, 5000);
    const elapsed1 = await page.locator(".proto-diag-row", { hasText: "模拟时间" }).locator(".proto-diag-val").textContent();
    await wait(800);
    const elapsed2 = await page.locator(".proto-diag-row", { hasText: "模拟时间" }).locator(".proto-diag-val").textContent();
    assert(Number(elapsed2) > Number(elapsed1), `elapsed should advance while running, got ${elapsed1} -> ${elapsed2}`);
    assert(pageErrors.length === 0, `page errors on mobile prototype: ${pageErrors.join(" | ")}`);

    await page.click("#protoPauseBtn");
    const pausedLabel = await page.locator("#protoPauseBtn").textContent();
    assert(pausedLabel.includes("继续"), `pause button should show 继续, got ${pausedLabel}`);
    const pausedAt = await page.locator(".proto-diag-row", { hasText: "模拟时间" }).locator(".proto-diag-val").textContent();
    await wait(500);
    const stillPaused = await page.locator(".proto-diag-row", { hasText: "模拟时间" }).locator(".proto-diag-val").textContent();
    assert(Number(stillPaused) === Number(pausedAt), "time should freeze while paused");

    await page.click("#protoStepBtn");
    const afterStep = await page.locator(".proto-diag-row", { hasText: "模拟时间" }).locator(".proto-diag-val").textContent();
    assert(Number(afterStep) > Number(pausedAt), "step should advance time while paused");

    await page.click('#protoSpeedRow button[data-speed="2"]');
    await page.click("#protoPauseBtn"); // resume
    await wait(300);

    // switch mode -> params should change and old runtime replaced
    await page.selectOption("#protoModeSelect", "validation-survival");
    await page.click("#protoApplyModeBtn");
    await page.waitForFunction(() => {
      const meta = document.querySelector("#protoModeMeta")?.textContent || "";
      return meta.includes("限时") || meta.includes("生存") || document.querySelector('#protoModeParams [data-param-key="survivalSeconds"]');
    }, null, { timeout: 8000 });
    const survivalField = await page.locator('#protoModeParams [data-param-key="survivalSeconds"]').count();
    assert(survivalField === 1, "validation mode should auto-render survivalSeconds field");

    await page.fill('#protoModeParams [data-param-key="survivalSeconds"]', "20");
    await page.click("#protoApplyModeParamsBtn");
    await wait(400);
    const diag = await page.locator("#protoDiagnostics").textContent();
    assert(diag.includes("生存") || diag.includes("20") || diag.includes("剩余"), `diagnostics should reflect survival mode: ${diag}`);

    await page.click("#protoRestartBtn");
    await wait(200);
    const restarted = await page.locator(".proto-diag-row", { hasText: "模拟时间" }).locator(".proto-diag-val").textContent();
    assert(Number(restarted) < 2, `restart should near-zero elapsed, got ${restarted}`);

    await page.close();
  } finally {
    if (browser) await browser.close();
    if (vite && vite.exitCode === null) vite.kill();
    await wait(100);
    if (vite && vite.exitCode === null) vite.kill("SIGKILL");
  }
  console.log("prototype platform browser verification passed");
}

main();
