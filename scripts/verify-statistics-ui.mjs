import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import { WebSocketServer } from "ws";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = {
  schemaVersion: 1,
  generatedAt: Date.now(),
  modes: {
    solo: {
      matches: 40,
      lineups: [
        { lineup: { main: "haruhi", sub1: "yuki", sub2: "koizumi" }, games: 30, winRate: 40 },
        { lineup: { main: "shamisen", sub1: "asakura", sub2: "future1096" }, games: 10, winRate: 80 },
      ],
    },
    multiplayer: {
      matches: 12,
      lineups: [
        { lineup: { main: "yuki", sub1: "haruhi", sub2: "kyon" }, games: 7, winRate: 57.14 },
      ],
    },
  },
};

const messages = [];
const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
await new Promise((resolveListen) => wss.once("listening", resolveListen));
const wsPort = wss.address().port;
wss.on("connection", (socket) => {
  socket.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    messages.push(message.type);
    if (message.type === "get_winrate_stats") {
      socket.send(JSON.stringify({ type: "winrate_stats", stats: fixture }));
    }
  });
});

const vite = await createServer({
  root,
  logLevel: "silent",
  server: { host: "127.0.0.1", port: 0 },
});
await vite.listen();
const baseUrl = vite.resolvedUrls.local[0].replace(/\/$/, "");
const statsUrl = `${baseUrl}/statistics?ws=ws://127.0.0.1:${wsPort}`;
const browser = await chromium.launch({ headless: true });

try {
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await desktop.addInitScript(() => localStorage.setItem("haruhi-locale-v1", "zh"));
  const page = await desktop.newPage();
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  assert.equal(await page.locator(".ts-statistics").count(), 1, "首页底部缺少胜率统计小入口");
  const footerButton = await page.locator(".ts-statistics").boundingBox();
  assert.ok(footerButton && footerButton.height <= 28, "首页统计入口不应膨胀成大按钮");

  await page.goto(statsUrl, { waitUntil: "domcontentloaded" });
  await page.locator(".stats-row").first().waitFor();
  assert.equal(await page.locator(".stats-row").count(), 2, "单人榜单行数错误");
  assert.match(await page.locator(".stats-row").first().innerText(), /春日/, "默认应按出场场次降序");
  assert.match(await page.locator("#statsMeta").innerText(), /40/, "未显示单人已完成对局数");

  await page.locator(".stats-sort").selectOption("winRate");
  assert.match(await page.locator(".stats-row").first().innerText(), /三味线/, "胜率排序没有即时生效");
  await page.locator('[data-stats-mode="multiplayer"]').click();
  assert.equal(await page.locator(".stats-row").count(), 1, "多人榜单切换错误");
  assert.match(await page.locator("#statsMeta").innerText(), /12/, "未显示多人已完成对局数");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "桌面统计页出现横向溢出");
  await desktop.close();

  const mobile = await browser.newContext({
    viewport: { width: 320, height: 568 },
    isMobile: true,
    hasTouch: true,
  });
  await mobile.addInitScript(() => localStorage.setItem("haruhi-locale-v1", "zh"));
  const mobilePage = await mobile.newPage();
  await mobilePage.goto(statsUrl, { waitUntil: "domcontentloaded" });
  await mobilePage.locator(".stats-row").first().waitFor();
  assert.equal(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "极小屏统计页出现横向溢出");
  const controls = await mobilePage.locator(".stats-controls").boundingBox();
  assert.ok(controls && controls.width <= 320, "极小屏筛选控件超出视口");
  await mobile.close();

  await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  assert.equal(messages.filter((type) => type === "get_winrate_stats").length, 2, "每次打开榜单只能请求一次统计数据");
  assert.equal(messages.filter((type) => type === "set_statistics_profile").length, 2, "榜单请求应携带匿名档案但不得周期上报");

  console.log("胜率统计界面校验通过：首页小入口、双榜切换、两种排序、桌面与极小屏布局及单次请求均正常。");
} finally {
  await browser.close();
  await vite.close();
  await new Promise((resolveClose) => wss.close(resolveClose));
}
