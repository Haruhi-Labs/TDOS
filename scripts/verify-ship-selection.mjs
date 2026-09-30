import assert from "node:assert/strict";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import { MatchSimulation } from "../shared/game-core.js";
import { matchActions } from "../shared/protocol/match-actions.js";
import { RULESET_VERSION } from "../shared/protocol/ruleset-version.js";
import { isShipSelectable, resolveSelectedShipKey } from "../src/battle/ship-selection.js";

const loadout = { main: "haruhi", sub1: "future1096", sub2: "yuki" };
const simulation = new MatchSimulation({ mode: "pvp", teamLoadouts: { A: loadout } });
simulation.teamA.splitLevel = 2;
for (const key of ["main", "sub1"]) {
  const ship = simulation.teamA.ships[key];
  ship.effects.stunnedUntil = simulation.elapsed + 1;
  const team = simulation.serializeState().teams.A;
  assert.equal(isShipSelectable(team.ships[key]), true, "眩晕只禁止操作，不能使当前舰不可选择");
  assert.equal(resolveSelectedShipKey(team, key), key, "眩晕时必须保留选舰");
  const before = JSON.stringify(ship.serialize());
  for (const action of [
    matchActions.setThrottle({ shipKey: key, throttle: 1.4 }),
    matchActions.setRoute({ shipKey: key, endX: 600, endY: 700 }),
    matchActions.clearRoute({ shipKey: key }),
    matchActions.launchScout({ shipKey: key, zoneId: 5 }),
    key === "main" ? matchActions.castFlagshipSkill() : matchActions.castSubSkill({ shipKey: key, targetX: 600, targetY: 700 }),
  ]) assert.equal(simulation.applyActionForSeat("A", action), false, "眩晕时战斗操作必须无效");
  assert.equal(JSON.stringify(ship.serialize()), before, "被拒绝的动作不能改变舰船状态");
  ship.effects.stunnedUntil = 0;
  assert.equal(simulation.applyActionForSeat("A", matchActions.setThrottle({ shipKey: key, throttle: 1.4 })), true, "眩晕解除后应可继续操作同一舰");
}
const team = simulation.serializeState().teams.A;
Object.assign(team.ships.sub1, { canControl: false, heroPowerShock: { controlLocked: true } });
assert.equal(resolveSelectedShipKey(team, "sub1"), "sub1", "冲击波短时禁控也需保留选舰");
team.ships.sub1.alive = false;
assert.equal(resolveSelectedShipKey(team, "sub1"), "main", "被击沉仍应切到其他可选舰");
Object.assign(team.ships.sub1, { alive: true, attached: true });
assert.equal(isShipSelectable(team.ships.sub1), false, "编队中未分离的副舰不能因禁控而变成可选舰");
Object.assign(team.ships.sub1, { attached: false, koizumiOrb: { phase: "returning" } });
assert.equal(resolveSelectedShipKey(team, "sub1"), "main", "光球自动归航仍沿用原切舰行为");

// 自建回环前端。测试插件只在夹具服务中暴露单人模拟，生产源码不添加调试接口。
const vite = await createServer({ root: resolve(import.meta.dirname, ".."), logLevel: "silent", server: { host: "127.0.0.1", port: 0 }, plugins: [{
  name: "ship-selection-fixture",
  transform(code, id) {
    if (id.endsWith("/src/solo.js")) return `${code}\nglobalThis.selectionFixture = { get app() { return app; }, refresh() { app.state = app.sim.serializeState(); app.renderState = app.renderPreviousState = app.renderCurrentState = app.state; updateUi(); } };`;
    if (id.endsWith("/src/online.js")) return `${code}\nglobalThis.selectionFixture = { get app() { return app; } };`;
    return null;
  },
}] });
await vite.listen();
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  for (const mode of ["solo", "online"]) for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile, locale: "zh-CN" });
    await context.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: '{"authenticated":false,"items":[]}' }));
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    const outgoing = [];
    let socket, onlineSimulation, snapshotSeq = 0;
    if (mode === "solo") {
      await page.goto(`${vite.resolvedUrls.local[0]}play`, { waitUntil: "networkidle" });
      await page.locator('.solo-flow-item[data-action="standard"]').click();
      await page.locator('.solo-flow-item[data-action="difficulty:normal"]').click();
      for (const index of [0, 3, 2]) {
        await page.locator(mobile ? ".csm-dot" : ".cs-tab").nth(index).click();
        if (!mobile) await page.locator(".cs-page-flipper").waitFor({ state: "detached" });
        await page.locator(mobile ? ".csm-cta" : '.cs-book > .cs-page-right .cs-enlist-cta[data-action="select"]').click();
      }
      await page.locator(mobile ? ".csm-cta" : ".cs-launch").click();
      await page.locator("#battleView").waitFor({ state: "visible" });
      await page.waitForFunction(() => Boolean(window.selectionFixture.app.sim));
      await page.evaluate(() => { const f = window.selectionFixture; f.app.paused = true; f.app.sim.teamA.splitLevel = 2; f.refresh(); });
    } else {
      // 联机只接收本脚本生成的权威快照，不连接现有 WebSocket 服务。
      const wsUrl = "ws://127.0.0.1:65530/selection-fixture";
      await page.routeWebSocket(wsUrl, (ws) => { socket = ws; ws.onMessage((raw) => outgoing.push(JSON.parse(String(raw)))); });
      await page.goto(`${vite.resolvedUrls.local[0]}online?ws=${encodeURIComponent(wsUrl)}`, { waitUntil: "networkidle" });
      assert.ok(socket, "联机夹具应接管 WebSocket");
      socket.send(JSON.stringify({ type: "connected", playerId: "selection-test", rulesetVersion: RULESET_VERSION, tickRate: 30, snapshotRate: 15, protocolVersion: 2 }));
      socket.send(JSON.stringify({ type: "room_state", room: { roomId: "selection-room", status: "running", mode: "pvp", players: [{ seat: "A", name: "选舰验收", loadout }, { seat: "B", name: "对手", loadout }] }, self: { seat: "A", loadout } }));
      onlineSimulation = new MatchSimulation({ mode: "pvp", teamLoadouts: { A: loadout } });
      onlineSimulation.teamA.splitLevel = 2;
    }
    async function publish(key, status) {
      if (mode === "solo") {
        await page.evaluate(({ key, status }) => {
          const f = window.selectionFixture;
          const ship = f.app.sim.teamA.ships[key];
          ship.effects.stunnedUntil = status === "stun" ? f.app.sim.elapsed + 30 : 0;
          ship.heroPowerShock = { hitAt: f.app.sim.elapsed, lockUntil: status === "shock" ? f.app.sim.elapsed + 30 : 0, recoveryUntil: status === "shock" ? f.app.sim.elapsed + 35 : 0 };
          ship.alive = status !== "dead";
          f.refresh();
        }, { key, status });
      } else {
        const ship = onlineSimulation.teamA.ships[key];
        ship.effects.stunnedUntil = status === "stun" ? 30 : 0;
        ship.heroPowerShock = { hitAt: 0, lockUntil: status === "shock" ? 30 : 0, recoveryUntil: status === "shock" ? 35 : 0 };
        ship.alive = status !== "dead";
        snapshotSeq++;
        socket.send(JSON.stringify({ type: "snapshot", roomId: "selection-room", snapshotSeq, tick: snapshotSeq, state: onlineSimulation.serializeState() }));
        await page.waitForFunction((seq) => window.selectionFixture.app.latestSnapshot?.snapshotSeq === seq, snapshotSeq);
        // HUD 按 10Hz 节流，等待下一份同状态快照刷新；不直接调用页面选舰函数。
        await page.waitForTimeout(110);
        snapshotSeq++;
        socket.send(JSON.stringify({ type: "snapshot", roomId: "selection-room", snapshotSeq, tick: snapshotSeq, state: onlineSimulation.serializeState() }));
        await page.waitForFunction((seq) => window.selectionFixture.app.latestSnapshot?.snapshotSeq === seq, snapshotSeq);
      }
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    }
    if (mode === "online") await publish("main", "ready");
    for (const key of ["main", "sub1"]) {
      const select = page.locator(mobile ? `.mobile-ship-btn[data-ship="${key}"]` : `.fleet-row[data-ship="${key}"]`);
      await select.click();
      const beforeRemovedKey = mode === "solo"
        ? await page.evaluate(() => JSON.stringify(window.selectionFixture.app.sim.serializeState()))
        : outgoing.filter((message) => message.type === "input").length;
      await page.keyboard.press("b");
      if (mode === "solo") {
        assert.equal(await page.evaluate(() => JSON.stringify(window.selectionFixture.app.sim.serializeState())), beforeRemovedKey, "可控舰按 B 键不能扣能量、减速或写入急刹状态");
      } else {
        assert.equal(outgoing.filter((message) => message.type === "input").length, beforeRemovedKey, "可控舰按 B 键不能发送旧急刹动作");
      }
      for (const status of ["stun", "shock"]) {
        await publish(key, status);
        const otherKey = key === "main" ? "sub2" : "main";
        await page.locator(mobile ? `.mobile-ship-btn[data-ship="${otherKey}"]` : `.fleet-row[data-ship="${otherKey}"]`).click();
        await select.click();
        const power = await page.locator("#powerValue").textContent();
        const inputsBefore = outgoing.filter((message) => message.type === "input").length;
        assert.equal(await select.getAttribute("aria-pressed"), "true", `${mode} ${key} ${status} 不可自动转移选舰`);
        assert.equal(await select.isDisabled(), false, "短时禁控舰仍可被明确选择");
        assert.equal(await page.evaluate(() => window.selectionFixture.app.selectedShipKey), key);
        assert.equal(await page.locator(mobile ? "#mobileScoutBtn" : "#scoutBtn").isDisabled(), true);
        assert.equal(await page.locator(mobile ? key === "main" ? "#mobileFlagshipBtn" : "#mobileSubSkillBtn" : key === "main" ? "#flagshipBtn" : "#subSkillBtn").isDisabled(), true);
        const gears = page.locator(mobile ? ".mobile-throttle-btn" : "#powerGearControl button");
        for (const gear of await gears.all()) assert.equal(await gear.isDisabled(), true, "禁控时不可提供可生效的换挡入口");
        await page.locator("#gameCanvas").click({ position: { x: 60, y: 60 }, button: mobile ? "left" : "right" });
        await page.keyboard.press("e");
        await page.keyboard.press("Enter");
        await page.keyboard.press("x");
        await page.keyboard.press("b");
        assert.equal(await page.locator("#brakeBtn, #mobileBrakeBtn").count(), 0, "双端操作台不能保留急刹入口");
        await page.keyboard.press(key === "main" ? "c" : "v");
        assert.equal(await page.evaluate(() => window.selectionFixture.app.pendingSubSkillAim), null, "禁控时技能快捷键不能误进瞄准模式");
        assert.equal(await page.evaluate(() => window.selectionFixture.app.selectedShipKey), key, "无效输入不可改变选舰");
        assert.equal(await page.locator("#powerValue").textContent(), power, "无效换挡不可覆盖显示档位");
        if (mode === "online") assert.equal(outgoing.filter((message) => message.type === "input").length, inputsBefore, "已知禁控时不可发送移动、侦察或预测换挡");
        await publish(key, "ready");
        assert.equal(await select.getAttribute("aria-pressed"), "true", "解除禁控后无需重新选舰");
        assert.equal(await page.locator(mobile ? ".mobile-throttle-btn" : '#powerGearControl [data-gear="4"]').first().isDisabled(), false);
        await page.locator(mobile ? '.mobile-throttle-btn[data-gear="4"]' : '#powerGearControl [data-gear="4"]').click();
        await page.waitForFunction(() => document.querySelector("#powerValue").textContent === "前进4");
      }
    }
    await publish("sub1", "dead");
    await page.waitForFunction(() => window.selectionFixture.app.selectedShipKey === "main");
    await context.close();
  }
  assert.deepEqual(errors, [], "眩晕与恢复不能导致浏览器异常");
  console.log("选舰禁控检查通过：单人/联机、桌面/触屏、主副舰眩晕与冲击禁控、无效操作、原舰恢复、击沉切舰及权威动作拒绝。");
} finally { await browser.close(); await vite.close(); }
