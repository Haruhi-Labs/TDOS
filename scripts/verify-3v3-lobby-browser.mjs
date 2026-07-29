import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function eventually(check, label, timeoutMs = 8000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await check()) return;
    await wait(50);
  }
  throw new Error(`${label}: timed out`);
}

async function reservePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

function start(command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  return child;
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await wait(100);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function waitForHttp(url) {
  await eventually(async () => {
    const response = await fetch(url).catch(() => null);
    return Boolean(response?.ok);
  }, "vite startup", 12_000);
}

async function register(httpOrigin, username) {
  const response = await fetch(`${httpOrigin}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: `browser-test-password-${username}` }),
  });
  assert(response.status === 201, `${username} registration must succeed`);
  const rawCookie = response.headers.get("set-cookie")?.split(";", 1)[0] || "";
  const separator = rawCookie.indexOf("=");
  assert(separator > 0, `${username} registration must issue a session cookie`);
  return { name: rawCookie.slice(0, separator), value: rawCookie.slice(separator + 1) };
}

async function createAuthenticatedContext(browser, appBase, session, viewport, deviceScaleFactor) {
  const context = await browser.newContext({ viewport, deviceScaleFactor });
  await context.addCookies([{ ...session, url: appBase }]);
  return context;
}

async function openLobby(context, url, pageErrors, initScript = null) {
  const page = await context.newPage();
  if (initScript) {
    await page.addInitScript(initScript);
  }
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#connectionValue");
  await eventually(
    () => page.locator("#connectionValue").evaluate((node) => !node.textContent.includes("未连接")),
    "lobby websocket connection",
  );
  return page;
}

function expectedBackingWidth(canvas, { minBacking, maxBacking, maxDpr }) {
  return Math.max(minBacking, Math.min(Math.round(canvas.cssWidth * maxDpr), maxBacking));
}

async function main() {
  const unavailableWsPort = await reservePort();
  const wsPort = await reservePort();
  const vitePort = await reservePort();
  const appBase = `http://127.0.0.1:${vitePort}`;
  const serverBase = `http://127.0.0.1:${wsPort}`;
  const stellarUrl = `${appBase}/stellar3v3`;
  const disconnectedStellarUrl = `${appBase}/stellar3v3?ws=${encodeURIComponent(`ws://127.0.0.1:${unavailableWsPort}/`)}`;
  const standardUrl = `${appBase}/online`;
  const tempDir = await mkdtemp(path.join(tmpdir(), "tdos-3v3-browser-"));
  const server = start(process.execPath, ["server/server.js"], {
    HOST: "127.0.0.1",
    PORT: String(wsPort),
    USER_DB_PATH: path.join(tempDir, "accounts.sqlite"),
    USER_AVATAR_DIR: path.join(tempDir, "avatars"),
    SESSION_SECRET: "3v3-browser-test-session-secret-that-is-long-enough",
  });
  const vite = start(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(vitePort)], {
    VITE_BACKEND_ORIGIN: serverBase,
  });
  let browser;
  const pages = [];

  try {
    await waitForHttp(`${appBase}/stellar3v3`);
    await waitForHttp(`${serverBase}/api/leaderboard`);
    await mkdir("artifacts", { recursive: true });
    browser = await chromium.launch();
    const [desktopSession, standardSession, mobileSession] = await Promise.all([
      register(serverBase, "LobbyDesktop"),
      register(serverBase, "LobbyStandard"),
      register(serverBase, "LobbyMobile"),
    ]);
    const desktopContext = await createAuthenticatedContext(browser, appBase, desktopSession, { width: 1280, height: 720 }, 2);
    const standardContext = await createAuthenticatedContext(browser, appBase, standardSession, { width: 1280, height: 720 }, 1);
    const mobileContext = await createAuthenticatedContext(browser, appBase, mobileSession, { width: 390, height: 844 }, 3);

    const disconnected = await desktopContext.newPage();
    pages.push(disconnected);
    await disconnected.goto(disconnectedStellarUrl, { waitUntil: "domcontentloaded" });
    await disconnected.waitForSelector("#create3v3PublicBtn");
    await eventually(
      () => disconnected.locator("#create3v3PublicBtn").isDisabled(),
      "3v3 room creation must be unavailable while disconnected",
    );

    const desktopErrors = [];
    const desktop = await openLobby(
      desktopContext,
      stellarUrl,
      desktopErrors,
      () => {
        const originalDrawImage = CanvasRenderingContext2D.prototype.drawImage;
        window.__TDOS_TEST_GAME_CANVAS_DRAW_SOURCES__ = { portraits: [], cachedMapDraws: 0 };
        CanvasRenderingContext2D.prototype.drawImage = function patchedDrawImage(...args) {
          const image = args[0];
          if (this.canvas?.id === "gameCanvas") {
            if (image instanceof HTMLImageElement) {
              window.__TDOS_TEST_GAME_CANVAS_DRAW_SOURCES__.portraits.push(image.currentSrc || image.src || "");
            } else if (image instanceof HTMLCanvasElement || (typeof OffscreenCanvas !== "undefined" && image instanceof OffscreenCanvas)) {
              window.__TDOS_TEST_GAME_CANVAS_DRAW_SOURCES__.cachedMapDraws += 1;
            }
          }
          return originalDrawImage.apply(this, args);
        };
      },
    );
    pages.push(desktop);
    assert(await desktop.locator("#create3v3PublicBtn").count() === 1, "3v3 lobby must render its public-room button");
    assert(await desktop.locator("#createPublicBtn").count() === 0, "3v3 lobby must not render standard-room controls");
    await desktop.click("#create3v3PublicBtn");
    await desktop.waitForSelector("#stellarRoomSeats:not([hidden])");
    assert(await desktop.locator(".stellar-seat-row").count() === 6, "3v3 room must render all six seats");
    await desktop.waitForSelector('[data-add-bot="A2"]');
    const placement = await desktop.locator("#stellarRoomSeats").evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, width: rect.width, viewportWidth: innerWidth };
    });
    assert(placement.top < 720 && placement.width <= placement.viewportWidth, `desktop seats must be visible without horizontal overflow: ${JSON.stringify(placement)}`);
    await desktop.click('[data-add-bot="A2"]');
    await desktop.waitForSelector('[data-remove-bot="A2"]');
    await desktop.click('[data-remove-bot="A2"]');
    await desktop.waitForSelector('[data-add-bot="A2"]');
    await desktop.screenshot({ path: "artifacts/3v3-lobby-desktop.png", fullPage: true });
    await desktop.setViewportSize({ width: 390, height: 844 });
    const mobileSeats = await desktop.locator("#stellarRoomSeats").evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const commander = document.querySelector(".lobby-card");
      const commanderRect = commander?.getBoundingClientRect();
      return {
        top: rect.top,
        width: rect.width,
        viewportWidth: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        commanderTop: commanderRect?.top ?? null,
      };
    });
    assert(
      mobileSeats.top < 844 && mobileSeats.width <= mobileSeats.viewportWidth && mobileSeats.scrollWidth <= mobileSeats.viewportWidth + 1 && mobileSeats.commanderTop !== null && mobileSeats.top < mobileSeats.commanderTop,
      `mobile seats must stay visible without horizontal overflow: ${JSON.stringify(mobileSeats)}`,
    );
    await desktop.screenshot({ path: "artifacts/3v3-lobby-mobile.png", fullPage: true });
    await desktop.setViewportSize({ width: 1280, height: 720 });
    for (const seat of ["A2", "A3", "B1", "B2", "B3"]) {
      await desktop.click(`[data-add-bot="${seat}"]`);
      await desktop.waitForSelector(`[data-remove-bot="${seat}"]`);
    }
    await desktop.click("#readyRoomBtn");
    await eventually(
      () => desktop.locator("#startMatchBtn").isEnabled(),
      "3v3 start button must enable after the host and all bot seats are ready",
    );
    await desktop.click("#startMatchBtn");
    await desktop.waitForSelector("#battleView:not([hidden])");
    await eventually(
      () => desktop.locator("#battleControls").evaluate((node) => !node.classList.contains("disabled-panel")),
      "3v3 match must reach its playable state",
      12_000,
    );
    await eventually(
      () => desktop.locator("#gameCanvas").evaluate((node) => node.closest(".online-root")?.classList.contains("camera-pan-enabled") === true),
      "3v3 battle must configure Prototype-compatible camera controls",
    );
    assert(
      await desktop.locator("#battleView.route-fluid-backdrop").count() === 0,
      "3v3 battle must not mount the Fluid backdrop behind the game canvas",
    );
    const battlePortraits = await desktop.evaluate(() => (
      window.__TDOS_TEST_GAME_CANVAS_DRAW_SOURCES__.portraits
        .filter((src) => src.includes("/assets/portraits/"))
    ));
    assert(battlePortraits.length === 0, "3v3 battle must not draw standard-mode character portraits");
    await eventually(
      () => desktop.evaluate(() => window.__TDOS_TEST_GAME_CANVAS_DRAW_SOURCES__.cachedMapDraws > 0),
      "3v3 static territory map cache draw",
    );
    const desktopBacking = await desktop.locator("#gameCanvas").evaluate((canvas) => ({ cssWidth: canvas.getBoundingClientRect().width, width: canvas.width }));
    assert(
      desktopBacking.width === expectedBackingWidth(desktopBacking, { minBacking: 1280, maxBacking: 1920, maxDpr: 1.5 }),
      `3v3 desktop backing canvas must use its 1920px budget: ${JSON.stringify(desktopBacking)}`,
    );
    await desktop.screenshot({ path: "artifacts/3v3-battle-spawn-camera.png", fullPage: true });
    const canvasBox = await desktop.locator("#gameCanvas").boundingBox();
    assert(canvasBox, "3v3 battle canvas must have a visible layout box");
    await desktop.mouse.move(canvasBox.x + canvasBox.width * 0.28, canvasBox.y + canvasBox.height * 0.32);
    await desktop.mouse.down();
    await desktop.mouse.move(canvasBox.x + canvasBox.width * 0.38, canvasBox.y + canvasBox.height * 0.40);
    assert(
      await desktop.locator("#gameCanvas").evaluate((node) => node.classList.contains("is-panning")),
      "3v3 empty-space mouse drags must enter the camera panning state",
    );
    await desktop.mouse.up();
    await desktop.screenshot({ path: "artifacts/3v3-battle-panned-camera.png", fullPage: true });
    assert(desktopErrors.length === 0, `3v3 desktop lobby page errors: ${desktopErrors.join(" | ")}`);

    const standardErrors = [];
    const standard = await openLobby(standardContext, standardUrl, standardErrors);
    pages.push(standard);
    await eventually(
      async () => (await standard.locator("#roomList").innerText()).includes("当前没有公开房") || (await standard.locator("#roomList").innerText()).length > 0,
      "standard room list",
    );
    assert(!(await standard.locator("#roomList").innerText()).includes("3v3"), "standard lobby must filter out public 3v3 rooms");
    assert(standardErrors.length === 0, `standard lobby page errors: ${standardErrors.join(" | ")}`);

    const mobileErrors = [];
    const mobile = await openLobby(mobileContext, stellarUrl, mobileErrors);
    pages.push(mobile);
    assert(await mobile.locator("#create3v3PublicBtn").isVisible(), "mobile 3v3 lobby must expose room creation");
    await mobile.click("#create3v3PublicBtn");
    await mobile.waitForSelector("#stellarRoomSeats:not([hidden])");
    for (const seat of ["A2", "A3", "B1", "B2", "B3"]) {
      await mobile.click(`[data-add-bot="${seat}"]`);
      await mobile.waitForSelector(`[data-remove-bot="${seat}"]`);
    }
    await mobile.click("#readyRoomBtn");
    await eventually(() => mobile.locator("#startMatchBtn").isEnabled(), "mobile 3v3 start button");
    await mobile.click("#startMatchBtn");
    await mobile.waitForSelector("#battleView:not([hidden])");
    await eventually(
      () => mobile.locator("#battleControls").evaluate((node) => !node.classList.contains("disabled-panel")),
      "mobile 3v3 match playable state",
      12_000,
    );
    const mobileBacking = await mobile.locator("#gameCanvas").evaluate((canvas) => ({ cssWidth: canvas.getBoundingClientRect().width, width: canvas.width }));
    assert(
      mobileBacking.width === expectedBackingWidth(mobileBacking, { minBacking: 960, maxBacking: 1440, maxDpr: 1.25 }),
      `3v3 mobile backing canvas must use its 1440px budget: ${JSON.stringify(mobileBacking)}`,
    );
    assert(mobileErrors.length === 0, `3v3 mobile lobby page errors: ${mobileErrors.join(" | ")}`);
  } finally {
    for (const page of pages) await page.close().catch(() => {});
    await browser?.close();
    await stop(vite);
    await stop(server);
    await rm(tempDir, { recursive: true, force: true });
  }

  console.log("3v3 dedicated lobby browser verification passed");
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
