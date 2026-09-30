import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer as createNetServer } from "node:net";
import { chromium } from "playwright";
import { createServer } from "vite";
import WebSocket from "ws";
import { matchActions } from "../shared/protocol/match-actions.js";
import { RULESET_VERSION } from "../shared/protocol/ruleset-version.js";

// 自建回环服务和临时统计目录，身份接口使用游客夹具，不访问现有联机服务。
const dataDir = await mkdtemp(join(tmpdir(), "haruhi-spectator-"));
const clients = [];
let service, vite, browser;
let output = "";
const screenshotDir = process.env.SPECTATOR_SCREENSHOT_DIR;
const videoDir = process.env.SPECTATOR_VIDEO_DIR;

async function createClient(url, name, loadout) {
  const ws = new WebSocket(url);
  clients.push(ws);
  const messages = [];
  const waiters = new Set();
  ws.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    messages.push(message);
    for (const waiter of waiters) {
      if (waiter.predicate(message)) {
        waiters.delete(waiter);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      }
    }
  });
  await once(ws, "open");
  const client = {
    send: (message) => ws.send(JSON.stringify(message)),
    waitFor(predicate) {
      const existing = messages.findLast(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolveWait, reject) => {
        const waiter = { predicate, resolve: resolveWait, timer: setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error("等待观战测试服务消息超时"));
        }, 8000) };
        waiters.add(waiter);
      });
    },
  };
  client.send({ type: "protocol_hello", protocolVersion: 2, rulesetVersion: RULESET_VERSION });
  client.send({ type: "set_name", name });
  client.send({ type: "set_loadout", loadout });
  return client;
}

async function assertLayout(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const boxes = await page.evaluate(() => {
    const bounds = (selector) => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
    };
    return { a: bounds('.spectator-team[data-seat="A"]'), b: bounds('.spectator-team[data-seat="B"]'), map: bounds("#gameCanvas"), scrollWidth: document.documentElement.scrollWidth };
  });
  assert.ok(boxes.scrollWidth <= width, `${width}×${height} 不应横向溢出`);
  assert.ok(Math.abs(boxes.map.width - boxes.map.height) < 2, "观战地图必须保持正方形");
  if (width <= 640 || (width <= 760 && height > width)) {
    assert.ok(boxes.map.bottom <= boxes.a.y + 1 && boxes.map.bottom <= boxes.b.y + 1, "竖屏双方舰队应并排位于地图下方");
    assert.ok(boxes.map.width >= Math.min(width - 24, height * .55), "竖屏地图应保留足够的可读尺寸");
  } else {
    assert.ok(boxes.a.right <= boxes.map.x && boxes.map.right <= boxes.b.x, "双方展板应夹住中央地图");
    assert.ok(boxes.map.width >= 240, "横屏地图不应被展板挤成细缝");
  }
  for (const side of ["A", "B"]) {
    assert.equal(await page.locator(`.spectator-team[data-seat="${side}"] .spectator-ship`).count(), 3, "双方均须保留完整三舰阵容");
  }
  if (screenshotDir) await page.screenshot({ path: join(screenshotDir, `spectator-${width}x${height}.png`), fullPage: true });
}

try {
  if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
  const portProbe = createNetServer();
  portProbe.listen(0, "127.0.0.1");
  await once(portProbe, "listening");
  const port = portProbe.address().port;
  await new Promise((done) => portProbe.close(done));
  service = spawn(process.execPath, ["server/server.js"], {
    cwd: resolve(import.meta.dirname, ".."),
    env: { PATH: process.env.PATH, PORT: String(port), STATS_DATA_DIR: dataDir, NETWORK_METRICS_INTERVAL_MS: "60000" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const wsUrl = await new Promise((resolveUrl, reject) => {
    const timer = setTimeout(() => reject(new Error(`观战测试服务启动超时：${output}`)), 8000);
    service.stderr.on("data", (chunk) => { output += chunk; });
    service.stdout.on("data", (chunk) => {
      output += chunk;
      const address = output.match(/ws:\/\/localhost:(\d+)/);
      if (address) { clearTimeout(timer); resolveUrl(`ws://127.0.0.1:${address[1]}`); }
    });
    service.once("exit", () => { clearTimeout(timer); reject(new Error(`观战测试服务提前退出：${output}`)); });
  });
  const host = await createClient(wsUrl, "甲方<舰队>", { main: "future1096", sub1: "haruhi", sub2: "koizumi" });
  const guest = await createClient(wsUrl, "乙方指挥官", { main: "yuki", sub1: "kyon", sub2: "shamisen" });
  host.send({ type: "create_room", visibility: "public", mode: "pvp" });
  const waiting = await host.waitFor((message) => message.type === "room_state" && message.room?.status === "waiting");
  guest.send({ type: "join_room", roomId: waiting.room.roomId });
  await host.waitFor((message) => message.type === "room_state" && message.room?.status === "running");

  vite = await createServer({ root: resolve(import.meta.dirname, ".."), logLevel: "silent", server: { host: "127.0.0.1", port: 0 } });
  await vite.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "zh-CN", ...(videoDir ? { recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } } } : {}) });
  const errors = [];
  const outgoing = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ user: null }) }));
  let holdSnapshots = true;
  let flushSnapshots;
  await page.routeWebSocket(wsUrl, (socket) => {
    const remote = socket.connectToServer();
    const held = [];
    socket.onMessage((message) => { outgoing.push(JSON.parse(String(message))); remote.send(message); });
    remote.onMessage((message) => {
      const type = JSON.parse(String(message)).type;
      if (holdSnapshots && (type === "snapshot" || type === "snapshot_delta")) held.push(message);
      else socket.send(message);
    });
    flushSnapshots = () => { holdSnapshots = false; for (const message of held) socket.send(message); held.length = 0; };
  });
  await page.goto(`${vite.resolvedUrls.local[0]}online?ws=${encodeURIComponent(wsUrl)}`, { waitUntil: "networkidle" });
  await page.locator(".room-combatant-b").waitFor();
  assert.equal(await page.locator(".room-combatant-a").textContent(), "A  甲方<舰队>", "大厅应展示 A 方公开昵称并保留文本转义");
  assert.equal(await page.locator(".room-combatant-b").textContent(), "B  乙方指挥官", "大厅应展示 B 方公开昵称");
  await page.getByRole("button", { name: "观战", exact: true }).click();
  await page.locator(".spectator-toolbar").waitFor({ state: "visible" });
  assert.equal(await page.locator('.spectator-team[data-seat="A"] h2').textContent(), "甲方<舰队>");
  assert.equal(await page.locator('.spectator-team[data-seat="B"] h2').textContent(), "乙方指挥官");
  assert.equal(await page.locator('.spectator-team[data-seat="B"] h3').allTextContents().then((names) => names.join("/")), "长门有希/阿虚/三味线", "首个战斗快照到达前应可识别敌方全部阵容");
  assert.equal(await page.locator(".battle-panel").isVisible(), false, "观战不展示玩家操作台");
  assert.equal(await page.locator("#mobileBattleHud").isVisible(), false);
  flushSnapshots();
  await page.waitForFunction(() => document.querySelector('.spectator-team[data-seat="B"] .spectator-skill-state')?.textContent === "被动");
  host.send({ type: "input", seq: 1, action: matchActions.castFlagshipSkill(), clientTime: Date.now() });
  await page.waitForFunction(() => document.querySelector('.spectator-team[data-seat="A"] .spectator-skill')?.dataset.tone === "cooldown");

  // 可用态矩阵使用同一展示模块，覆盖真实对局难以稳定触发的异常与零能量边界。
  const states = await page.evaluate(async () => {
    const { spectatorSkillState, createSpectatorView } = await import("/src/online/spectator-view.js");
    const { updateSkillButtons } = await import("/src/battle/hud.js");
    const ship = { alive: true, canControl: true, attached: false, fleetEnergy: 100, energy: 100 };
    const status = (team, changes, slot = "sub1", id = "haruhi") => spectatorSkillState(team, { ...ship, ...changes }, slot, id).status;
    const container = document.createElement("div");
    container.innerHTML = '<aside class="battle-panel"></aside>';
    const view = createSpectatorView(container);
    view.update({ active: true, room: { players: [] }, state: { teams: { A: { ships: { main: { ...ship, hp: 100, maxHp: 100, fleetEnergy: 0, fleetMaxEnergy: 100, characterId: "haruhi" } } } } } });
    const zeroGauge = container.querySelector('.spectator-team[data-seat="A"] [data-gauge="energy"] strong').textContent;
    const hud = Object.fromEntries(["flagshipBtn", "subSkillBtn", "scoutBtn", "autoScoutBtn", "brakeBtn"].map((key) => [key, document.createElement("button")]));
    const koizumiTeam = { loadout: { main: "koizumi" }, ships: { main: ship }, koizumiBarrier: { active: true, remainingHits: 7, maxHits: 15 } };
    updateSkillButtons(hud, koizumiTeam);
    const playerCharges = hud.flagshipBtn.textContent;
    koizumiTeam.koizumiBarrier = { active: false, disabledRemaining: 3 };
    updateSkillButtons(hud, koizumiTeam);
    const playerRepair = hud.flagshipBtn.textContent;
    return {
      ready: status({}, {}), attached: status({}, { attached: true }), energy: status({}, { fleetEnergy: 0 }),
      silenced: status({}, { silenced: true }), sealed: status({ skillsDisabled: true }, {}), dead: status({}, { alive: false }),
      stunned: status({}, { stunRemaining: 1, canControl: false }),
      cooldown: status({ cooldowns: { sub1: 4.2 } }, {}), passive: status({}, {}, "main", "yuki"),
      barrier: status({ koizumiBarrier: { active: false, disabledRemaining: 3 } }, {}, "main", "koizumi"), zeroGauge,
      charges: status({ koizumiBarrier: { active: true, remainingHits: 7, maxHits: 15 } }, {}, "main", "koizumi"),
      playerCharges, playerRepair,
    };
  });
  assert.deepEqual(states, { ready: "就绪", attached: "待分离", energy: "能量不足", silenced: "沉默", sealed: "已封印", dead: "已击沉", stunned: "眩晕", cooldown: "4.2s", passive: "被动", barrier: "修复3.0秒", zeroGauge: "0%", charges: "护盾 7/15", playerCharges: "旗舰技能：超能力屏障（护盾 7/15）", playerRepair: "旗舰技能：超能力屏障（修复3.0秒）" });
  for (const [width, height] of [[1440, 900], [1024, 768], [390, 844], [320, 568], [844, 390]]) await assertLayout(page, width, height);
  const sampleZoom = () => page.evaluate(async () => {
    const values = [];
    for (let frame = 0; frame < 35; frame += 1) {
      await new Promise(requestAnimationFrame);
      const label = document.querySelector('[data-camera="reset"]').textContent;
      values.push(label === "全图" ? 100 : Number.parseInt(label));
    }
    return values;
  });
  const wheelBox = await page.locator("#gameCanvas").boundingBox();
  await page.mouse.move(wheelBox.x + wheelBox.width * 0.65, wheelBox.y + wheelBox.height * 0.4);
  const zoomRecording = sampleZoom();
  await page.mouse.wheel(0, -180);
  const samples = await zoomRecording;
  assert.ok(new Set(samples).size >= 3, "观战滚轮没有跨渲染帧平滑缩放");
  assert.ok(samples.every((value, index) => index === 0 || value >= samples[index - 1]), "观战滚轮缩放出现回弹或抖动");
  assert.ok(samples.at(-1) > 120, "窄横屏观战滚轮被移动模式阻止");
  await page.locator('[data-camera="reset"]').click();
  await page.waitForFunction(() => document.querySelector('[data-camera="reset"]').textContent === "全图");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('[data-camera="in"]').click();
  await page.waitForFunction(() => document.querySelector('[data-camera="reset"]').textContent === "120%");
  assert.equal(await page.locator('[data-camera="reset"]').textContent(), "120%");
  const mapBox = await page.locator("#gameCanvas").boundingBox();
  await page.mouse.move(mapBox.x + mapBox.width * 0.3, mapBox.y + mapBox.height / 2);
  await page.mouse.down();
  assert.equal(await page.locator("#gameCanvas").evaluate((element) => element.hasPointerCapture(1)), true, "观战放大后应捕获拖动镜头的指针");
  await page.mouse.move(mapBox.x + mapBox.width / 2 + 50, mapBox.y + mapBox.height / 2 + 30, { steps: 4 });
  await page.mouse.up();
  assert.equal(await page.locator("#gameCanvas").evaluate((element) => element.hasPointerCapture(1)), false, "松手后没有释放观战镜头指针");
  await page.mouse.down();
  await page.locator("#gameCanvas").dispatchEvent("pointercancel", { pointerId: 1, isPrimary: true });
  assert.equal(await page.locator("#gameCanvas").evaluate((element) => element.hasPointerCapture(1)), false, "取消拖拽后指针仍被镜头占用");
  await page.mouse.up();
  await page.mouse.move(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
  for (let pulse = 0; pulse < 3; pulse += 1) await page.mouse.wheel(0, -240);
  await page.waitForFunction(() => document.querySelector('[data-camera="reset"]').textContent === "400%");
  assert.equal(await page.locator('[data-camera="in"]').isDisabled(), true, "达到导演镜头4倍上限后仍允许继续放大");
  await page.mouse.down();
  await page.mouse.move(mapBox.x + mapBox.width * 0.3 + 110, mapBox.y + mapBox.height / 2 + 50, { steps: 12 });
  await page.mouse.up();
  await page.evaluate(async () => { for (let frame = 0; frame < 18; frame += 1) await new Promise(requestAnimationFrame); });
  await page.locator('[data-camera="reset"]').click();
  await page.waitForFunction(() => document.querySelector('[data-camera="reset"]').textContent === "全图");
  assert.equal(await page.locator('[data-camera="reset"]').textContent(), "全图");
  await page.locator('[data-camera="in"]').focus();
  await page.keyboard.press("Tab");
  assert.equal(await page.locator(".spectator-exit").evaluate((element) => element === document.activeElement), true, "观战 Tab 应导航到退出按钮，不能切换房主舰船");
  for (const shortcut of ["1", "Tab", "c", "v", "x", "Enter"]) await page.keyboard.press(shortcut);
  await page.locator(".spectator-exit").click();
  await page.locator("#lobbyView").waitFor({ state: "visible" });
  assert.equal(outgoing.some((message) => message.type === "input" || message.type === "select_ship"), false, "观战缩放和退出不得发送战斗指令");
  assert.ok(outgoing.some((message) => message.type === "leave_room"), "退出观战应离开房间");

  // 同一挂载实例从观战切回玩家对战，应还原原操作台与移动 HUD。
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "创建 AI 训练房", exact: true }).click();
  await page.locator("#battleView").waitFor({ state: "visible" });
  assert.equal(await page.locator(".battle-panel").isVisible(), true);
  assert.equal(await page.locator(".spectator-toolbar").isVisible(), false);
  assert.equal(await page.locator('.spectator-team[data-seat="A"]').isVisible(), false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#mobileBattleHud").waitFor({ state: "visible" });
  assert.deepEqual(errors, [], "观战和模式切换不应发生浏览器异常");
  if (videoDir) {
    const video = page.video();
    await page.close();
    await video.saveAs(join(videoDir, "spectator-camera.webm"));
  }
  console.log("观战界面检查通过：本地真实三客户端、首帧双方阵容、技能状态、五种视口、平滑滚轮、拖拽取消、缩放退出和玩家模式恢复。");
} finally {
  await browser?.close();
  for (const client of clients) client.terminate();
  await vite?.close();
  if (service && service.exitCode === null) { service.kill(); await once(service, "exit"); }
  await rm(dataDir, { recursive: true, force: true });
}
