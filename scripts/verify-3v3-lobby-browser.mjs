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
  const announcementConfirm = page.locator("[data-announcement-confirm]");
  if (await announcementConfirm.waitFor({ state: "visible", timeout: 1_500 }).then(() => true).catch(() => false)) {
    await announcementConfirm.click();
    await announcementConfirm.waitFor({ state: "detached" });
  }
  return page;
}

function expectedBackingWidth(canvas, { minBacking, maxBacking, maxDpr }) {
  return Math.max(minBacking, Math.min(Math.round(canvas.cssWidth * maxDpr), maxBacking));
}

async function assertBattleHasNoPlayerStrip(page, label) {
  assert(
    await page.locator("#onlinePlayerStrip").count() === 0,
    `${label} 3v3 battle must not render the obstructive player profile strip`,
  );
}

async function assertMobileBattleControls(page, label, { verifyShipSwitch = false } = {}) {
  const core = page.locator("#mobileBattleCore");
  const secondary = page.locator("#mobileBattleSecondary");
  await core.waitFor({ state: "visible" });
  await secondary.waitFor({ state: "visible" });

  const layout = await page.evaluate(() => {
    const coreNode = document.querySelector("#mobileBattleCore");
    const secondaryNode = document.querySelector("#mobileBattleSecondary");
    const controls = [
      ...document.querySelectorAll("#mobileShipSwitch .mobile-ship-btn"),
      ...document.querySelectorAll("#mobileBattleCore .mobile-throttle-btn"),
      ...document.querySelectorAll("#mobileBattleCore .mobile-action-grid > button"),
    ];
    const visibleControls = controls
      .filter((control) => !control.hidden && getComputedStyle(control).display !== "none")
      .map((control) => {
        const rect = control.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return {
          label: control.id || control.dataset.throttle || control.textContent?.trim(),
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          hit: hit === control || control.contains(hit),
        };
      });
    const coreStyle = getComputedStyle(coreNode);
    const secondaryStyle = getComputedStyle(secondaryNode);
    return {
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      coreOverflowY: coreStyle.overflowY,
      secondaryOverflowY: secondaryStyle.overflowY,
      secondaryClientHeight: secondaryNode.clientHeight,
      secondaryScrollHeight: secondaryNode.scrollHeight,
      tacticalTargetsParent: document.querySelector(".mobile-territory-tactical-targets")?.parentElement?.id || null,
      visibleControls,
    };
  });
  assert(layout.scrollWidth <= layout.viewportWidth + 1, `${label} HUD must not cause horizontal overflow: ${JSON.stringify(layout)}`);
  assert(layout.coreOverflowY === "visible", `${label} core controls must not depend on an internal scroll position: ${JSON.stringify(layout)}`);
  assert(["auto", "scroll"].includes(layout.secondaryOverflowY), `${label} secondary content must own vertical scrolling: ${JSON.stringify(layout)}`);
  assert(layout.secondaryClientHeight > 0, `${label} secondary content must retain a usable viewport: ${JSON.stringify(layout)}`);
  assert(
    layout.tacticalTargetsParent === null || layout.tacticalTargetsParent === "mobileBattleSecondary",
    `${label} tactical target choices must stay in secondary content when present: ${JSON.stringify(layout)}`,
  );
  assert(layout.visibleControls.length >= 17, `${label} must expose every non-hidden core control: ${JSON.stringify(layout)}`);
  assert(
    layout.visibleControls.every((control) => (
      control.top >= 0
      && control.bottom <= layout.viewportHeight
      && control.width > 0
      && control.hit
    )),
    `${label} ship, throttle, and action controls must be visible and clickable: ${JSON.stringify(layout)}`,
  );

  if (verifyShipSwitch) {
    await page.locator("#mobileSplitOneBtn").click();
    await eventually(
      () => page.locator('#mobileShipSwitch [data-ship="sub1"]').isEnabled(),
      `${label} split fleet controls`,
    );
  }
  if (verifyShipSwitch) {
    await page.evaluate(() => {
      const original = window.setTimeout;
      window.__TDOS_THROTTLE_TIMER__ = original;
      window.setTimeout = (callback, delay, ...args) => original(callback, delay === 80 ? 320 : delay, ...args);
    });
    await page.locator('#mobileBattleCore [data-throttle="120"]').click();
    await page.evaluate(() => {
      if (window.__TDOS_THROTTLE_TIMER__) window.setTimeout = window.__TDOS_THROTTLE_TIMER__;
    });
    await page.locator('#mobileShipSwitch [data-ship="sub1"]').click();
    await wait(120);
    const switchState = await page.evaluate(() => {
      const button = document.querySelector('#mobileShipSwitch [data-ship="sub1"]');
      return {
        active: button?.classList.contains("active") || false,
        disabled: button?.disabled || false,
        messages: window.__TDOS_SENT_WS_MESSAGES__ || [],
      };
    });
    assert(
      switchState.messages.some((message) => message.type === "select_ship" && message.shipKey === "sub1"),
      `${label} mobile ship switch must emit its selected ship: ${JSON.stringify(switchState)}`,
    );
    await wait(420);
    const delayedThrottleShip = await page.evaluate(() => (
      [...(window.__TDOS_SENT_WS_MESSAGES__ || [])]
        .reverse()
        .find((message) => message.type === "input" && message.action?.type === "set_throttle")
        ?.action?.shipKey || null
    ));
    assert(delayedThrottleShip === "main", `${label} delayed throttle must retain the ship selected at input time: ${delayedThrottleShip}`);
    await page.locator('#mobileShipSwitch [data-ship="main"]').click();
  } else {
    await page.locator('#mobileBattleCore [data-throttle="120"]').click();
  }
  await eventually(
    () => page.locator('#mobileBattleCore [data-throttle="120"]').evaluate((button) => (
      button.classList.contains("active")
      && document.querySelector("#powerSlider")?.value === "120"
    )),
    `${label} authoritative mobile throttle update`,
  );
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
    await desktop.reload({ waitUntil: "domcontentloaded" });
    await desktop.waitForSelector("#connectionValue");
    await eventually(
      () => desktop.locator("#stellarRoomSeats").evaluate((node) => !node.hidden),
      "waiting 3v3 room must resume after a page refresh",
    );
    await eventually(
      async () => (await desktop.locator("#roomSummary").innerText()).includes("A1"),
      "refreshed 3v3 host must recover the original A1 seat",
    );
    assert(await desktop.locator(".stellar-seat-row").count() === 6, "refreshed waiting room must retain all 3v3 seats");
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
    await assertBattleHasNoPlayerStrip(desktop, "desktop");
    await desktop.setViewportSize({ width: 1280, height: 1080 });
    await assertBattleHasNoPlayerStrip(desktop, "resized desktop");
    await desktop.setViewportSize({ width: 1280, height: 720 });
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
    const mobile = await openLobby(mobileContext, stellarUrl, mobileErrors, () => {
      const originalSend = WebSocket.prototype.send;
      window.__TDOS_SENT_WS_MESSAGES__ = [];
      WebSocket.prototype.send = function captureWebSocketSend(raw) {
        try {
          window.__TDOS_SENT_WS_MESSAGES__.push(JSON.parse(String(raw)));
        } catch {
          // Non-application WebSocket frames are irrelevant to this assertion.
        }
        return originalSend.call(this, raw);
      };
    });
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
    await assertBattleHasNoPlayerStrip(mobile, "mobile");
    await assertMobileBattleControls(mobile, "390x844 portrait", { verifyShipSwitch: true });
    await mobile.setViewportSize({ width: 844, height: 390 });
    await assertMobileBattleControls(mobile, "844x390 landscape");
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
