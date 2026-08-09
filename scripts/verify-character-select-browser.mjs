import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function eventually(check, label, timeoutMs = 12_000) {
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

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await wait(150);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function register(baseUrl, username) {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "character-select-browser-password" }),
  });
  assert.equal(response.status, 201, "browser test account registration must succeed");
  const rawCookie = response.headers.get("set-cookie")?.split(";", 1)[0] || "";
  const separator = rawCookie.indexOf("=");
  assert.ok(separator > 0, "browser test account must receive a session cookie");
  return { name: rawCookie.slice(0, separator), value: rawCookie.slice(separator + 1) };
}

async function main() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "tdos-character-select-browser-"));
  const serverPort = await reservePort();
  const vitePort = await reservePort();
  const serverBase = `http://127.0.0.1:${serverPort}`;
  const server = spawn(process.execPath, ["server/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(serverPort),
      USER_DB_PATH: path.join(tempDir, "accounts.sqlite"),
      USER_AVATAR_DIR: path.join(tempDir, "avatars"),
      SESSION_SECRET: "character-select-browser-session-secret-that-is-long-enough",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(vitePort)], {
    cwd: process.cwd(),
    env: { ...process.env, VITE_BACKEND_ORIGIN: serverBase },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let browser = null;

  try {
    const baseUrl = `http://127.0.0.1:${vitePort}`;
    await eventually(async () => (await fetch(`${serverBase}/api/me`).catch(() => null))?.status === 401, "account server startup");
    await eventually(async () => (await fetch(`${baseUrl}/play`).catch(() => null))?.ok, "vite startup");

    browser = await chromium.launch();
    const session = await register(serverBase, "CharSelect");
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
    await context.addCookies([{ ...session, url: baseUrl }]);
    const page = await context.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    const portraitResponses = new Map();
    const invalidRequests = [];
    page.on("response", (response) => {
      const pathname = new URL(response.url()).pathname;
      if (pathname.includes("/assets/portraits/")) portraitResponses.set(pathname, response.status());
    });
    page.on("request", (request) => {
      if (/\/assets\/portraits\/(blue|red)\/shamisen\.webp$/.test(new URL(request.url()).pathname)) {
        invalidRequests.push(request.url());
      }
    });

    await page.goto(`${baseUrl}/play`, { waitUntil: "domcontentloaded" });
    try {
      await page.waitForSelector(".cs-screen");
    } catch (error) {
      const appState = await page.locator("#app").textContent().catch(() => "unavailable");
      error.message += `\nPage errors: ${pageErrors.join(" | ")}\nConsole errors: ${consoleErrors.join(" | ")}\nApp state: ${appState}`;
      throw error;
    }
    await page.locator('.cs-tab[data-char="shamisen"]').click();
    await eventually(
      () => page.locator(".cs-tab.current").getAttribute("data-char").then((value) => value === "shamisen"),
      "Shamisen selection",
    );
    await eventually(
      () => portraitResponses.get("/assets/portraits/blue/shamisen-paw.webp") === 200,
      "blue Shamisen portrait",
    );

    await page.locator('.cs-faction-btn[data-color="red"]').click();
    await eventually(
      () => portraitResponses.get("/assets/portraits/red/shamisen-paw.webp") === 200,
      "red Shamisen portrait",
    );
    assert.equal(await page.locator(".cs-tab.current").getAttribute("data-char"), "shamisen");
    assert.equal(await page.locator(".cs-screen").evaluate((node) => node.classList.contains("faction-red")), true);
    assert.deepEqual(invalidRequests, [], "Shamisen must not request the retired shamisen.webp portrait path");

    await mkdir(path.join(process.cwd(), "artifacts"), { recursive: true });
    await page.screenshot({ path: path.join(process.cwd(), "artifacts", "character-select-shamisen-browser.png"), fullPage: true });
    await page.close();
    await context.close();
  } finally {
    if (browser) await browser.close();
    await stop(vite);
    await stop(server);
    await rm(tempDir, { recursive: true, force: true });
  }

  console.log("character select browser verification passed");
}

main();
