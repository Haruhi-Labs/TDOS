import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer as createNetServer } from "node:net";
import { chromium } from "playwright";
import { createServer } from "vite";

// 四个独立浏览器连接回环服务，使用临时统计目录与游客身份夹具，不接触现有对局。
const dataDir = await mkdtemp(join(tmpdir(), "haruhi-tournament-"));
const screenshotDir = process.env.TOURNAMENT_SCREENSHOT_DIR;
const errors = [];
let service, vite, browser;
async function until(predicate, label) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((done) => setTimeout(done, 40));
  }
  throw new Error(`比赛房验收超时：${label}`);
}
async function assertLayout(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const geometry = await page.evaluate(() => {
    const bounds = (selector) => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
    };
    return {
      preparation: bounds(".tournament-preparation"), map: bounds(".game-wrap"),
      width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight,
      controls: [...document.querySelectorAll('.tournament-preparation button:not([hidden])')]
        .filter((node) => node.getBoundingClientRect().height > 0).map((node) => {
          const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
        }),
      overflow: [...document.querySelectorAll('.spectator-team')].some((node) => node.scrollHeight > node.clientHeight + 1),
    };
  });
  assert.ok(geometry.width <= width && geometry.height <= height + 1, `${width}×${height} 准备页必须完整显示在一屏`);
  assert.equal(geometry.overflow, false, "准备阶段双方阵容不可依赖面板滚动");
  for (const rect of [geometry.preparation, ...geometry.controls]) {
    assert.ok(rect.x >= geometry.map.x && rect.y >= geometry.map.y && rect.right <= geometry.map.right + 1 && rect.bottom <= geometry.map.bottom + 1, `${width}×${height} 准备台及操作不得遮挡两侧阵容或越出地图`);
  }
  if (screenshotDir) await page.screenshot({ path: join(screenshotDir, `tournament-${await page.locator("[data-tournament=\"start\"]").isVisible() ? "host" : "player"}-${width}x${height}.png`), fullPage: true });
}
try {
  if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
  const probe = createNetServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((done) => probe.close(done));
  service = spawn(process.execPath, ["server/server.js"], {
    cwd: resolve(import.meta.dirname, ".."),
    env: { PATH: process.env.PATH, PORT: String(port), STATS_DATA_DIR: dataDir, NETWORK_METRICS_INTERVAL_MS: "60000" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const url = await new Promise((resolveUrl, reject) => {
    const timer = setTimeout(() => reject(new Error(`比赛验收服务启动超时：${output}`)), 8000);
    service.stderr.on("data", (chunk) => { output += chunk; });
    service.stdout.on("data", (chunk) => {
      output += chunk;
      if (/ws:\/\/localhost:\d+/.test(output)) { clearTimeout(timer); resolveUrl(`ws://127.0.0.1:${port}`); }
    });
    service.once("exit", () => { clearTimeout(timer); reject(new Error(`比赛验收服务提前退出：${output}`)); });
  });
  vite = await createServer({ root: resolve(import.meta.dirname, ".."), logLevel: "silent", server: { host: "127.0.0.1", port: 0 } });
  await vite.listen();
  browser = await chromium.launch({ headless: true });
  async function enter(name, mobile = false) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN", isMobile: mobile, hasTouch: mobile });
    await context.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: '{"user":null,"authenticated":false}' }));
    // 仅在测试页持有原生连接，用于核验伪造角色权限仍被服务端拒绝。
    await context.addInitScript(() => {
      const NativeSocket = window.WebSocket;
      window.WebSocket = class extends NativeSocket {
        constructor(...args) { super(...args); window.tournamentTestSocket = this; }
      };
    });
    const page = await context.newPage();
    const incoming = [], outgoing = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("websocket", (socket) => {
      socket.on("framereceived", (frame) => incoming.push({ ...JSON.parse(String(frame.payload)), receivedAt: Date.now() }));
      socket.on("framesent", (frame) => outgoing.push(JSON.parse(String(frame.payload))));
    });
    await page.goto(`${vite.resolvedUrls.local[0]}online?ws=${encodeURIComponent(url)}`, { waitUntil: "networkidle" });
    await page.locator("#playerNameInput").fill(name);
    await page.locator("#applyNameBtn").click();
    await until(() => outgoing.some((m) => m.type === "protocol_hello" && m.roomKinds?.includes("tournament")), "客户端能力协商");
    return {
      context, page, incoming, outgoing,
      state: () => incoming.findLast((m) => m.type === "room_state"),
      send: (message) => page.evaluate((data) => window.tournamentTestSocket.send(JSON.stringify(data)), message),
    };
  }
  const host = await enter("主持<评委>");
  await host.page.getByRole("button", { name: "创建比赛房间", exact: true }).click();
  await host.page.locator(".tournament-preparation").waitFor({ state: "visible" });
  assert.equal(host.state().self.seat, null);
  assert.equal(host.state().self.isHost, true);
  assert.equal(host.state().room.players.filter((p) => p.playerId).length, 0, "主持不能占选手席位");
  assert.equal(await host.page.locator('[data-tournament="start"]').isDisabled(), true);
  assert.equal(await host.page.locator(".battle-panel").isVisible(), false);
  const roomId = host.state().room.roomId;
  const observer = await enter("解说观众");
  const roomCard = (page) => page.locator(".room-item").filter({ hasText: `比赛房间 · ${roomId}` });
  await roomCard(observer.page).getByRole("button", { name: "观战", exact: true }).click();
  await observer.page.locator(".tournament-preparation").waitFor({ state: "visible" });
  assert.equal(observer.state().self.isHost, false);
  assert.equal(observer.state().self.spectating, true);
  assert.equal(await observer.page.locator('[data-tournament="start"]').isVisible(), false);
  assert.equal(await observer.page.locator('[data-tournament="ready"]').isVisible(), false);
  assert.equal(observer.incoming.some((m) => m.type.startsWith("snapshot")), false, "赛前观战不产生模拟快照");
  const a = await enter("选手甲");
  await roomCard(a.page).getByRole("button", { name: "加入", exact: true }).click();
  await a.page.locator('[data-tournament="ready"]').waitFor({ state: "visible" });
  const b = await enter("选手乙", true);
  await roomCard(b.page).getByRole("button", { name: "加入", exact: true }).click();
  await b.page.locator('[data-tournament="ready"]').waitFor({ state: "visible" });
  await until(() => host.state().room.players.every((p) => p.playerId), "双方选手进入准备台");
  assert.equal(host.state().room.status, "waiting");
  await a.send({ type: "start_match" });
  await until(() => a.incoming.some((m) => m.code === "tournament_host_only"), "选手伪造开赛被拒绝");
  await observer.send({ type: "set_ready", ready: true });
  await until(() => observer.incoming.some((m) => m.code === "tournament_player_only"), "观众伪造就绪被拒绝");
  // 等待时支持离席补位，原 B 席位不挪动，已有就绪失效。
  await b.page.getByRole("button", { name: "就绪", exact: true }).click();
  await until(() => host.state().room.players[1].ready, "B 方先就绪");
  await a.page.getByRole("button", { name: "离开房间", exact: true }).click();
  await until(() => !host.state().room.players[0].playerId && !host.state().room.players[1].ready, "离席取消双方就绪");
  assert.equal(host.state().room.players[1].name, "选手乙");
  await roomCard(a.page).getByRole("button", { name: "加入", exact: true }).click();
  await a.page.locator('[data-tournament="ready"]').waitFor({ state: "visible" });
  assert.equal(a.state().self.seat, "A");
  await observer.page.getByRole("button", { name: "离开房间", exact: true }).click();
  await roomCard(observer.page).getByRole("button", { name: "观战", exact: true }).click();
  await observer.page.locator(".tournament-preparation").waitFor({ state: "visible" });
  await a.page.getByRole("button", { name: "就绪", exact: true }).click();
  await b.page.getByRole("button", { name: "就绪", exact: true }).click();
  await until(() => host.state().room.players.every((p) => p.ready), "双方就绪");
  assert.equal(host.state().room.status, "waiting", "双方就绪不应自动开始");
  // 真实选角交互修改阵容，保存动作不会开启比赛。
  await a.page.getByRole("button", { name: "更换阵容", exact: true }).click();
  await a.page.locator(".cs-screen.visible").waitFor();
  const oldLoadout = a.state().self.loadout;
  for (const index of [6, 2, 1]) {
    await a.page.locator(".cs-tab").nth(index).click();
    await a.page.locator(".cs-book > .cs-page-right .cs-enlist-cta").click();
  }
  await a.page.getByRole("button", { name: "保存阵容", exact: true }).click();
  await until(() => JSON.stringify(a.state().self.loadout) !== JSON.stringify(oldLoadout), "选手保存新阵容");
  await until(() => host.state().room.players[0].ready === false, "换阵容取消本人就绪");
  assert.equal(host.state().room.players[1].ready, true);
  assert.equal(await host.page.locator('[data-tournament="start"]').isDisabled(), true);
  await a.page.locator(".cs-screen").waitFor({ state: "detached" });
  assert.equal(await observer.page.locator('.spectator-team[data-seat="A"] h3').first().textContent(), "朝仓凉子");
  await a.page.getByRole("button", { name: "就绪", exact: true }).click();
  await until(() => host.state().room.players.every((p) => p.ready), "新阵容重新就绪");
  await b.page.setViewportSize({ width: 390, height: 844 });
  await b.page.getByRole("button", { name: "更换阵容", exact: true }).click();
  await b.page.locator(".csm.visible").waitFor();
  for (const index of [4, 5, 6]) {
    await b.page.locator(".csm-dot").nth(index).click();
    await b.page.locator(".csm-cta").click();
  }
  await b.page.getByRole("button", { name: "保存阵容", exact: true }).click();
  await until(() => host.state().room.players[1].ready === false, "触屏换阵容取消就绪");
  await b.page.locator(".csm").waitFor({ state: "detached" });
  await b.page.getByRole("button", { name: "就绪", exact: true }).click();
  await until(() => host.state().room.players.every((p) => p.ready), "触屏重新就绪");
  for (const [width, height] of [[1440, 900], [1280, 720], [1024, 600], [800, 600], [390, 844], [320, 568], [844, 390], [667, 375]]) {
    await assertLayout(host.page, width, height);
    await assertLayout(a.page, width, height);
  }
  for (const [width, height] of [[390, 844], [844, 390], [1024, 768]]) await assertLayout(b.page, width, height);
  await b.page.setViewportSize({ width: 390, height: 844 });
  await a.page.setViewportSize({ width: 1440, height: 900 });
  await host.page.setViewportSize({ width: 1440, height: 900 });
  // 就绪后仍可打开选角；主持开赛时自动关闭，避免遮挡正式战场。
  await a.page.getByRole("button", { name: "更换阵容", exact: true }).click();
  await a.page.locator(".cs-screen.visible").waitFor();
  const beforeStart = Date.now();
  await host.page.getByRole("button", { name: "开始比赛", exact: true }).click();
  await until(() => host.state().room.status === "countdown", "主持发起倒计时");
  const countdown = host.state();
  assert.ok(countdown.room.countdownEndsAt - beforeStart >= 2950 && countdown.room.countdownEndsAt - countdown.receivedAt <= 3050, "开赛必须包含完整3秒倒计时");
  await a.page.locator(".cs-screen").waitFor({ state: "detached" });
  const lockedLoadout = a.state().self.loadout;
  const rejectedLoadoutAt = Date.now();
  await a.send({ type: "set_loadout", loadout: oldLoadout });
  await until(() => a.incoming.some((m) => m.code === "tournament_loadout_locked"), "倒计时阵容锁定");
  await until(() => a.incoming.some((m) => m.type === "room_state" && m.receivedAt >= rejectedLoadoutAt && JSON.stringify(m.self.loadout) === JSON.stringify(lockedLoadout)), "阵容请求迟到时恢复权威展示");
  await until(() => host.state().room.status === "running", "倒计时完成后开赛");
  assert.ok(host.state().receivedAt >= countdown.room.countdownEndsAt, "倒计时结束前不能交战");
  assert.ok(host.incoming.filter((m) => m.type.startsWith("snapshot") && m.receivedAt < countdown.room.countdownEndsAt - 100).every((m) => m.simTime === 0), "倒计时中模拟必须静止");
  await until(() => observer.incoming.some((m) => m.type.startsWith("snapshot") && m.simTime > 0), "观众独立接收实时战斗");
  assert.equal(await host.page.locator(".battle-panel").isVisible(), false);
  assert.equal(await a.page.locator(".battle-panel").isVisible(), true, "选手开赛后恢复对战操作台");
  assert.equal(host.outgoing.some((m) => m.type === "input"), false, "主持不能发送战斗指令");
  assert.equal(observer.outgoing.some((m) => m.type === "input"), false, "观众不能发送战斗指令");
  // 主持断开应关闭比赛，所有成员返回大厅，不能留下无法开赛的房间。
  await host.context.close();
  await until(() => observer.incoming.some((m) => m.type === "room_closed" && m.reasonCode === "tournament_host_left"), "主持断开统一关闭");
  await observer.page.locator("#createTournamentBtn").waitFor({ state: "visible" });
  assert.equal(await observer.page.locator(".tournament-preparation").isVisible(), false);
  assert.deepEqual(errors, [], "比赛房交互不得有页面错误");
  console.log("比赛房验收通过：四客户端独立入房、赛前观战、真实换阵容/就绪、越权拒绝、3秒静止倒计时、开赛切换、断线回收与八种视口。");
} finally {
  await browser?.close();
  await vite?.close();
  if (service && service.exitCode === null) { service.kill("SIGTERM"); await once(service, "exit"); }
  await rm(dataDir, { recursive: true, force: true });
}
