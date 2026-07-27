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

    await page.selectOption("#protoModeSelect", "stellar-territory");
    await page.click("#protoApplyModeBtn");
    await page.waitForSelector("#protoModeTools", { timeout: 8000 });
    await page.waitForSelector("#protoModeHud", { timeout: 8000 });
    await eventually(async () => {
      const tools = await page.locator("#protoModeTools").innerText();
      const hud = await page.locator("#protoModeHud").innerText();
      return tools.includes("当前种子") && tools.includes("显示调试边界") && hud.includes("A战争点数") && hud.includes("控制区");
    }, 8000);
    const stellarDiag = await page.locator("#protoDiagnostics").textContent();
    assert(stellarDiag.includes("地图模板") && stellarDiag.includes("three-lane-v2"), `stellar diagnostics missing map: ${stellarDiag}`);
    const mapPixels = await page.locator("#gameCanvas").evaluate((canvas) => {
      const ctx = canvas.getContext("2d");
      const sample = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let bright = 0;
      for (let i = 0; i < sample.length; i += 4) {
        const r = sample[i];
        const g = sample[i + 1];
        const b = sample[i + 2];
        if (r > 120 && g > 110 && b > 70) bright += 1;
      }
      return bright;
    });
    assert(mapPixels > 200, `stellar map presentation should draw visible non-background pixels, got ${mapPixels}`);
    await page.locator('#protoModeTools input[data-territory-seed-input]').fill("0");
    await page.getByRole("button", { name: "载入种子", exact: true }).click();
    await page.getByRole("button", { name: "生成维修包" }).click();
    await page.getByRole("button", { name: "生成技能包" }).click();
    await eventually(async () => {
      const state = await page.evaluate(() => window.__TDOS_PROTOTYPE_RUNTIME__?.getPresentationState?.());
      return state?.pickups?.length === 1 && state?.skillPickups?.length === 1;
    }, 5000);
    const zoomOutSelector = await page.evaluate(() => document.querySelector("#mobileZoomOutBtn")?.offsetParent
      ? "#mobileZoomOutBtn"
      : "#zoomOutBtn");
    for (let index = 0; index < 4; index += 1) await page.click(zoomOutSelector);
    const minimapTarget = await page.evaluate(() => {
      const pickup = window.__TDOS_PROTOTYPE_RUNTIME__?.getPresentationState?.()?.skillPickups?.[0];
      const inspection = window.__TDOS_PROTOTYPE_INSPECT__?.();
      const rect = inspection?.minimapRect;
      const worldSize = inspection?.worldSize;
      if (!pickup?.position || !rect || !worldSize) return null;
      return {
        x: rect.x + (pickup.position.x / worldSize) * rect.width,
        y: rect.y + (pickup.position.y / worldSize) * rect.height,
      };
    });
    assert(minimapTarget, "expanded territory world should expose a minimap target for the announced skill pickup");
    const canvas = page.locator("#gameCanvas");
    const canvasBox = await canvas.boundingBox();
    assert(canvasBox?.width > 0 && canvasBox?.height > 0, `prototype canvas box missing: ${JSON.stringify(canvasBox)}`);
    await canvas.evaluate((surface, target) => {
      const bounds = surface.getBoundingClientRect();
      surface.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        button: 0,
        clientX: bounds.left + bounds.width * (target.x / 1440),
        clientY: bounds.top + bounds.height * (target.y / 1440),
      }));
    }, minimapTarget);
    await eventually(async () => page.evaluate(() => {
      const pickup = window.__TDOS_PROTOTYPE_RUNTIME__?.getPresentationState?.()?.skillPickups?.[0];
      const view = window.__TDOS_PROTOTYPE_INSPECT__?.()?.camera;
      if (!pickup?.position || !view) return false;
      const left = view.centerX - view.width / 2;
      const right = view.centerX + view.width / 2;
      const top = view.centerY - view.height / 2;
      const bottom = view.centerY + view.height / 2;
      return pickup.position.x >= left && pickup.position.x <= right && pickup.position.y >= top && pickup.position.y <= bottom;
    }), 3000);
    const entityPixels = await eventually(async () => {
      const pixels = await page.locator("#gameCanvas").evaluate((canvas) => {
        const ctx = canvas.getContext("2d");
        const sample = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let resourceLike = 0;
        let skillLike = 0;
        for (let i = 0; i < sample.length; i += 4) {
          const r = sample[i];
          const g = sample[i + 1];
          const b = sample[i + 2];
          if (g > 150 && r < 150 && b < 180) resourceLike += 1;
          if (r > 150 && b > 180 && g < 170) skillLike += 1;
        }
        return {
          resourceLike,
          skillLike,
          skillPickups: window.__TDOS_PROTOTYPE_RUNTIME__?.getPresentationState?.()?.skillPickups || [],
          view: window.__TDOS_PROTOTYPE_INSPECT__?.()?.camera || null,
        };
      });
      return pixels.skillLike > 40 ? pixels : null;
    }, 3000);
    assert(entityPixels.resourceLike > 40, `resource entity should draw green pixels: ${JSON.stringify(entityPixels)}`);
    assert(entityPixels.skillLike > 40, `skill entity should draw violet pixels: ${JSON.stringify(entityPixels)}`);

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
