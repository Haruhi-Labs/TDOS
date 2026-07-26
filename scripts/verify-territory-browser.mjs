import { spawn } from "node:child_process";
import { chromium } from "playwright";

const VITE_PORT = 30000 + Math.floor(Math.random() * 1000);
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
    await waitForHttp(APP_URL);
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(String(error?.message || error)));
    await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#protoModeSelect", { timeout: 10000 });
    await page.selectOption("#protoModeSelect", "stellar-territory");
    await page.click("#protoApplyModeBtn");
    await page.waitForSelector("#protoModeHud", { timeout: 10000 });

    await eventually(async () => {
      const rows = await page.locator("#protoModeHud .territory-hud > div").count();
      const tools = await page.locator("#protoModeTools .territory-tools").count();
      return rows >= 6 && tools === 1;
    }, 8000);

    const layout = await page.evaluate(() => {
      const runtime = window.__TDOS_PROTOTYPE_RUNTIME__;
      return runtime?.getFleetLayout?.();
    });
    assert(layout?.localSeat === "A1", `expected A1 local seat, got ${JSON.stringify(layout)}`);
    assert(layout.alliances.A.length === 3 && layout.alliances.B.length === 3, `expected 3v3 layout, got ${JSON.stringify(layout)}`);

    const snapshotInfo = await page.evaluate(() => {
      const snap = window.__TDOS_PROTOTYPE_RUNTIME__?.getSnapshot?.();
      return {
        aSeats: snap?.alliances?.A?.fleetSeats || [],
        bSeats: snap?.alliances?.B?.fleetSeats || [],
        shipCount: Object.values(snap?.fleets || {}).reduce((sum, fleet) => sum + Object.keys(fleet?.ships || {}).length, 0),
      };
    });
    assert(snapshotInfo.aSeats.length === 3, `snapshot should expose three A fleets: ${JSON.stringify(snapshotInfo)}`);
    assert(snapshotInfo.bSeats.length === 3, `snapshot should expose three B fleets: ${JSON.stringify(snapshotInfo)}`);
    assert(snapshotInfo.shipCount === 18, `snapshot should expose 18 basic ships: ${JSON.stringify(snapshotInfo)}`);

    await page.locator("#protoModeTools button").nth(1).click();
    await page.locator("#protoModeTools button").nth(2).click();
    await eventually(async () => {
      const state = await page.evaluate(() => window.__TDOS_PROTOTYPE_RUNTIME__?.getPresentationState?.());
      return state?.pickups?.length >= 1 && state?.skillPickups?.length >= 1;
    }, 5000);

    const pixels = await page.locator("#gameCanvas").evaluate((canvas) => {
      const ctx = canvas.getContext("2d");
      const sample = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let resourceLike = 0;
      let skillLike = 0;
      let controlLike = 0;
      for (let i = 0; i < sample.length; i += 4) {
        const r = sample[i];
        const g = sample[i + 1];
        const b = sample[i + 2];
        if (g > 150 && r < 150 && b < 190) resourceLike += 1;
        if (r > 150 && b > 180 && g < 180) skillLike += 1;
        if (r > 170 && g > 155 && b > 100) controlLike += 1;
      }
      return { resourceLike, skillLike, controlLike };
    });
    assert(pixels.resourceLike > 40, `resource pixels missing: ${JSON.stringify(pixels)}`);
    assert(pixels.skillLike > 40, `skill pixels missing: ${JSON.stringify(pixels)}`);
    assert(pixels.controlLike > 150, `control/map pixels missing: ${JSON.stringify(pixels)}`);

    await page.selectOption("#protoModeSelect", "standard-ai-1v1");
    await page.click("#protoApplyModeBtn");
    await wait(250);
    const cleanup = await page.evaluate(() => ({
      tools: document.querySelector("#protoModeTools")?.textContent || "",
      hud: document.querySelector("#protoModeHud")?.textContent || "",
      mode: window.__TDOS_PROTOTYPE_RUNTIME__?.getModeDefinition?.()?.id,
    }));
    assert(cleanup.mode === "standard-ai-1v1", `mode should switch away from territory: ${JSON.stringify(cleanup)}`);
    assert((await page.locator("#protoModeTools .territory-tools").count()) === 0, "territory tools should be cleared after mode switch");
    assert((await page.locator("#protoModeHud .territory-hud").count()) === 0, "territory HUD should be cleared after mode switch");
    assert(pageErrors.length === 0, `browser page errors: ${pageErrors.join(" | ")}`);
    await page.close();
  } finally {
    if (browser) await browser.close();
    if (vite && vite.exitCode === null) vite.kill();
    await wait(100);
    if (vite && vite.exitCode === null) vite.kill("SIGKILL");
  }
  console.log("territory browser verification passed");
}

main();
