import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import { MatchSimulation } from "../shared/game-core.js";
import { STATUS_EFFECT_DEFS } from "../shared/game/status-effect-definitions.js";
import { serializeShipStatusEffects } from "../shared/game/status-effects.js";
import { activateKoizumiOrb, beginKoizumiOrbReturn } from "../shared/game/koizumi-orb.js";
import { applyHaruhiHeroPowerShock } from "../shared/game/haruhi-hero-power.js";
import { advanceStatusEffects, interpolateStatusEffects } from "../src/battle/status-effect-timing.js";
import { EN_MESSAGES } from "../src/i18n/messages-en.js";
import { JA_MESSAGES } from "../src/i18n/messages-ja.js";

const examples = new Map();
const collect = (ship) => { const effects = serializeShipStatusEffects(ship); for (const effect of effects) examples.set(effect.id, effect); return effects; };
const simulation = new MatchSimulation({ mode: "pvp", teamLoadouts: { A: { main: "haruhi", sub1: "kyon", sub2: "asakura" }, B: { main: "shamisen", sub1: "koizumi", sub2: "yuki" } } });
const team = simulation.teamA;
team.splitLevel = 2;
simulation.elapsed = 10;
assert.equal(team.castFlagshipSkill(), true);
assert.equal(team.castSubSkill("sub1"), true);
assert.equal(team.castSubSkill("sub2"), true);
collect(team.ships.sub2);
assert.equal(collect(team.ships.sub1).find((effect) => effect.id === "reliable").remaining, 14);
simulation.elapsed = 11;
assert.equal(collect(team.ships.sub1).find((effect) => effect.id === "reliable").remaining, 13);
team.haruhiFlagship.supporters = new Set(["alien", "time_traveler", "otherworlder", "esper"]);
const main = team.ships.main;
main.effects.stunnedUntil = 12;
main.effects.silencedUntil = 16;
main.effects.nextShotDamageMultiplier = 2;
main.collisionSlowUntil = 14;
main.forcedKnockback = { startedAt: 11, endsAt: 11.58 };
main.clawMarks = { ...main.clawMarks, stacks: 2, required: 4, expiresAt: 19 };
applyHaruhiHeroPowerShock(main, 11);
simulation.teamB.shamisenHunt.targetId = main.id;
const beforeSerialize = JSON.stringify([main.effects, main.clawMarks, main.heroPowerShock, team.effects, team.koizumiBarrier]);
collect(main);
assert.equal(JSON.stringify([main.effects, main.clawMarks, main.heroPowerShock, team.effects, team.koizumiBarrier]), beforeSerialize, "状态序列化不能推进模拟或清理权威状态");
simulation.teamB.splitLevel = 2;
activateKoizumiOrb(simulation.teamB.ships.sub1);
const state = simulation.serializeState();
assert.ok(!collect(team.ships.sub1).some(({ id }) => id.startsWith("support_")), "旗舰武器支援不可错误显示在副舰上");
main.clearNegativeEffects();
const cleaned = collect(main).map(({ id }) => id);
for (const id of ["stun", "silence", "hero_lock", "hero_shock", "collision_slow", "knockback", "claw_marks"]) assert.ok(!cleaned.includes(id), `${id} 驱散后不能继续显示`);
assert.ok(cleaned.includes("haruhi_boost") && cleaned.includes("hunt"), "净化应保留正面效果与不可驱散的猎杀标记");
team.clearActiveSkillBuffs({ preserveCurrentTick: false });
assert.ok(!collect(main).some(({ id }) => id === "broadcast" || id === "haruhi_boost"));
assert.ok(collect(main).some(({ id }) => id === "support_alien"), "涤除主动增益不能删除常驻支援");
main.alive = false;
assert.deepEqual(collect(main), [], "击沉后必须清空状态卡");

for (const characterId of ["tsuruya", "asakura", "future1096", "koizumi", "kyon"]) {
  const sim = new MatchSimulation({ mode: "pvp", teamLoadouts: { A: { main: characterId, sub1: "shamisen", sub2: "koizumi" } } });
  const own = sim.teamA;
  own.splitLevel = 2;
  if (["tsuruya", "asakura", "future1096"].includes(characterId)) assert.equal(own.castFlagshipSkill(), true);
  collect(own.ships.main);
  if (characterId === "future1096") { own.cooldowns.flagship = 0; own.castFlagshipSkill(); collect(own.ships.main); }
  own.castSubSkill("sub1");
  collect(own.ships.sub1);
  const orb = Object.values(own.ships).find((ship) => ship.key !== "main" && ship.characterId === "koizumi");
  if (orb) { activateKoizumiOrb(orb); collect(orb); beginKoizumiOrbReturn(orb); collect(orb); }
}
assert.deepEqual([...examples.keys()].sort(), Object.keys(STATUS_EFFECT_DEFS).sort(), "所有状态定义必须有可序列化的来源与验收样例");
for (const [id, definition] of Object.entries(STATUS_EFFECT_DEFS)) {
  for (const messages of [EN_MESSAGES, JA_MESSAGES]) for (const key of [definition.name, definition.description, definition.persistent]) assert.ok(messages[key], `${id} 的状态文字缺少翻译：${key}`);
}
const effect = { id: "stun", duration: 1, expiresAt: 12, remaining: 1 };
const current = { ...effect, remaining: 0.8 };
const frozen = JSON.stringify([effect, current]);
assert.equal(interpolateStatusEffects([effect], [current], 0.5)[0].remaining, 0.9);
assert.deepEqual(interpolateStatusEffects([effect], [], 0.1), [], "不能把已驱散的状态插值复活");
assert.equal(interpolateStatusEffects([effect], [{ ...effect, expiresAt: 13 }], 0.5)[0].remaining, 1, "状态续期必须采用新权威寿命");
assert.deepEqual(advanceStatusEffects([effect], 1), [], "显示外推到期后必须隐藏图标");
assert.equal(JSON.stringify([effect, current]), frozen, "显示时间不能写回快照");

// 自建回环前端，身份与统计接口使用夹具；状态来自上方权威模拟，不访问现有联机服务。
const vite = await createServer({ root: resolve(import.meta.dirname, ".."), logLevel: "silent", server: { host: "127.0.0.1", port: 0 } });
await vite.listen();
const browser = await chromium.launch({ headless: true });
const screenshots = process.env.STATUS_EFFECT_SCREENSHOT_DIR;
const errors = [];
try {
  if (screenshots) await mkdir(screenshots, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  await context.route("**/api/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"authenticated":false,"items":[]}' }));
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(vite.resolvedUrls.local[0], { waitUntil: "networkidle" });
  await page.evaluate(async (state) => {
    const { battleViewTemplate } = await import("/src/battle/template.js");
    const { createSpectatorView } = await import("/src/online/spectator-view.js");
    const { createStatusEffectTooltip } = await import("/src/battle/status-effects.js");
    const hud = await import("/src/battle/hud.js");
    document.querySelector("#app").innerHTML = battleViewTemplate({ shellClass: "online-shell" });
    const root = document.querySelector("#battleView");
    const view = createSpectatorView(root);
    const tooltip = createStatusEffectTooltip(root);
    const ui = Object.fromEntries([...root.querySelectorAll("[id]")].map((element) => [element.id, element]));
    ui.mobileShipButtons = [...root.querySelectorAll(".mobile-ship-btn")];
    ui.fleetRows = [...root.querySelectorAll(".fleet-row")].map((row) => ({ row, key: row.dataset.ship, name: row.querySelector(".fleet-name"), state: row.querySelector(".fleet-state"), hullFill: row.querySelector(".fleet-fill-hull"), enFill: row.querySelector(".fleet-fill-energy"), hullPct: row.querySelector(".fleet-pct-hull"), enPct: row.querySelector(".fleet-pct-energy") }));
    window.statusFixture = { state, ui, view, tooltip, refresh(spectator = false) {
      const own = state.teams.A;
      const options = { selected: own.ships.main, selectedShipKey: "main", selectedZoneId: 5 };
      hud.updateSkillButtons(ui, own, options);
      hud.renderFleetRoster(ui, own, options);
      hud.syncMobileHud(ui, own, { ...options, visible: true });
      view.update({ active: spectator, room: { roomId: "status-fixture", players: [] }, state });
    } };
    window.statusFixture.refresh();
  }, state);
  const source = '.fleet-row[data-ship="main"]';
  const card = page.locator(".fleet-card").filter({ has: page.locator(source) });
  const buff = card.locator('[data-effect="haruhi_boost"]');
  const debuff = card.locator('[data-effect="stun"]');
  assert.equal(await buff.getAttribute("data-tone"), "positive");
  assert.equal(await debuff.getAttribute("data-tone"), "negative");
  assert.notEqual(await buff.evaluate((element) => getComputedStyle(element).borderColor), await debuff.evaluate((element) => getComputedStyle(element).borderColor));
  assert.equal(await card.locator('[data-effect="claw_marks"] .status-effect-stack').textContent(), "2");
  const expectedIds = state.teams.A.ships.main.statusEffects.map(({ id }) => id).sort();
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(await buff.locator(".status-effect-progress").evaluate((circle) => getComputedStyle(circle).transitionDuration), "0s", "减少动态效果偏好应关闭进度环过渡");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  for (const spectator of [false, true]) {
    await page.evaluate((spectator) => window.statusFixture.refresh(spectator), spectator);
    const panel = spectator ? page.locator('.spectator-team[data-seat="A"] .spectator-ship[data-slot="main"]') : card;
    assert.deepEqual((await panel.locator(".status-effect").evaluateAll((elements) => elements.map((element) => element.dataset.effect))).sort(), expectedIds, "对战和观战应显示相同权威状态");
    const icon = panel.locator('[data-effect="haruhi_boost"]');
    await icon.hover();
    await page.locator(".status-effect-tooltip:visible").waitFor();
    assert.match(await page.locator(".status-effect-tooltip p").textContent(), /15%/);
    await page.evaluate(() => { const f = window.statusFixture; f.state.teams.A.ships.main.statusEffects.find(({ id }) => id === "haruhi_boost").remaining = 8; f.refresh(document.querySelector("#battleView").classList.contains("spectator-shell")); });
    await page.waitForFunction(() => document.querySelector(".status-effect-tooltip small").textContent === "剩余8.0秒");
    assert.equal(await icon.locator(".status-effect-progress").evaluate((circle) => circle.style.strokeDashoffset), "50");
    await page.keyboard.press("Escape");
    await panel.locator('[data-effect="claw_marks"]').focus();
    await page.locator(".status-effect-tooltip:visible").waitFor();
    assert.match(await page.locator(".status-effect-tooltip p").textContent(), /2\/4/);
    await page.keyboard.press("Escape");
  }
  for (const [width, height] of [[1440, 900], [1280, 720], [1280, 600], [390, 844], [390, 540], [844, 390]]) for (const spectator of [false, true]) {
    await page.setViewportSize({ width, height });
    await page.evaluate((spectator) => window.statusFixture.refresh(spectator), spectator);
    const layouts = await page.evaluate((spectator) => {
      const f = window.statusFixture;
      const ship = f.state.teams.A.ships.main;
      const effects = ship.statusEffects;
      const panel = document.querySelector(spectator ? '.spectator-team[data-seat="A"] .spectator-ship[data-slot="main"]' : '.fleet-card:has(.fleet-row[data-ship="main"])');
      const following = document.querySelector(spectator ? '.spectator-team[data-seat="A"] .spectator-ship[data-slot="sub1"]' : '.fleet-card:has(.fleet-row[data-ship="sub1"])');
      const slot = panel.querySelector(".status-effects");
      const snapshots = [];
      for (const statuses of [[], effects.slice(0, 1), effects, []]) {
        ship.statusEffects = statuses;
        f.refresh(spectator);
        snapshots.push({ cardHeight: panel.getBoundingClientRect().height, slotHeight: slot.getBoundingClientRect().height, followingY: following.getBoundingClientRect().y, controlsY: document.querySelector("#battleControls").getBoundingClientRect().y });
      }
      ship.statusEffects = effects;
      f.refresh(spectator);
      return snapshots;
    }, spectator);
    for (const layout of layouts.slice(1)) assert.deepEqual(layout, layouts[0], `${spectator ? "观战" : "对战"} ${width}×${height}：无状态、单个、多状态和清空后，角色卡与后续内容不能跳动`);
    if (width <= 980) {
      assert.equal(layouts[0].slotHeight, 0, "移动端不能为隐藏的 buff 栏留空");
      for (const icon of await page.locator(".status-effect").all()) assert.equal(await icon.isVisible(), false, "移动端的对战和观战都不显示 buff 图标");
      if (screenshots) await page.screenshot({ path: join(screenshots, `${spectator ? "spectator" : "battle"}-${width}x${height}.png`) });
      continue;
    }
    assert.ok(layouts[0].slotHeight > 0, "桌面角色卡无状态时也必须预留 buff 栏");
    const icons = page.locator(spectator ? '.spectator-team[data-seat="B"] .status-effect' : ".fleet-card .status-effect");
    const icon = icons.last();
    await icon.click();
    await page.locator(".status-effect-tooltip:visible").waitFor();
    const box = await page.locator(".status-effect-tooltip").boundingBox();
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1, "状态说明必须留在视口内");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "状态图标不能导致横向溢出");
    if (screenshots) await page.screenshot({ path: join(screenshots, `${spectator ? "spectator" : "battle"}-${width}x${height}.png`) });
    await page.keyboard.press("Escape");
  }
  await page.evaluate(() => { const f = window.statusFixture; f.refresh(false); f.state.teams.A.ships.sub1.attached = true; f.state.teams.A.ships.sub1.canControl = false; f.refresh(false); });
  await page.setViewportSize({ width: 1440, height: 900 });
  const attached = page.locator(".fleet-card").filter({ has: page.locator('.fleet-row[data-ship="sub1"]') });
  assert.equal(await attached.locator(".fleet-row").isDisabled(), true);
  await attached.locator(".status-effect").first().hover();
  await page.locator(".status-effect-tooltip:visible").waitFor();
  await page.evaluate(() => { const f = window.statusFixture; f.state.teams.A.ships.sub1.statusEffects = []; f.refresh(); });
  await page.waitForFunction(() => document.querySelector(".status-effect-tooltip").hidden);
  await page.evaluate(() => { const f = window.statusFixture; f.state.teams.A.ships.main.alive = false; f.refresh(); });
  assert.equal(await card.locator(".status-effect").count(), 0);
  await page.evaluate(() => { window.statusFixture.tooltip.destroy(); window.statusFixture.view.destroy(); });
  assert.equal(await page.locator(".status-effect-tooltip").count(), 0, "卸载不能留下浮层或监听");
  const touchContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, isMobile: true, hasTouch: true });
  await touchContext.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: '{"authenticated":false,"items":[]}' }));
  const touchPage = await touchContext.newPage();
  await touchPage.goto(vite.resolvedUrls.local[0], { waitUntil: "networkidle" });
  await touchPage.evaluate(async (ship) => {
    const { battleViewTemplate } = await import("/src/battle/template.js");
    const { renderStatusEffects } = await import("/src/battle/status-effects.js");
    document.querySelector("#app").innerHTML = battleViewTemplate();
    renderStatusEffects(document.querySelector(".status-effects"), ship);
  }, state.teams.A.ships.main);
  assert.equal(await touchPage.evaluate(() => matchMedia("(pointer: coarse)").matches), true);
  for (const icon of await touchPage.locator(".status-effect").all()) assert.equal(await icon.isVisible(), false, "宽屏触摸设备也不能显示 buff 图标");
  await touchContext.close();
  assert.deepEqual(errors, [], "状态展示不能引发浏览器异常");
  console.log(`状态图标检查通过：${examples.size}种状态、权威寿命与净化、续期与插值、桌面对战/观战一致、悬停/键盘/点按、移动端隐藏、六种视口的空栏与状态变化布局稳定及卸载清理。`);
} finally { await browser.close(); await vite.close(); }
