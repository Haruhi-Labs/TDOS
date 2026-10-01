import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

// 仅启动回环前端；身份与统计接口全部夹具化，不读取现有服务或持久数据。
const vite = await createServer({ root: resolve(import.meta.dirname, ".."), logLevel: "silent", server: { host: "127.0.0.1", port: 0 } });
await vite.listen();
const base = vite.resolvedUrls.local[0];
const browser = await chromium.launch({ headless: true });
const screenshotDir = process.env.COMMAND_SCREENSHOT_DIR;
const errors = [];
try {
  if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  await context.route("**/api/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authenticated: false, items: [] }) }));
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}play`, { waitUntil: "networkidle" });
  await page.locator('.solo-flow-item[data-action="standard"]').click();
  await page.locator('.solo-flow-item[data-action="difficulty:normal"]').click();
  for (let slot = 0; slot < 3; slot++) {
    await page.locator('.cs-book > .cs-page-right .cs-enlist-cta[data-action="select"]').click();
    if (slot < 2) {
      await page.locator(".cs-nav-next").click();
      await page.locator(".cs-page-flipper").waitFor({ state: "detached" });
    }
  }
  await page.locator(".cs-launch").click();
  await page.locator("#battleView").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector('.fleet-row[data-ship="main"]').getAttribute("aria-pressed") === "true");
  assert.equal(await page.locator("#shipQuickSwitch").isVisible(), false, "重复选舰按钮应收起");
  assert.equal(await page.locator("#brakeBtn, #mobileBrakeBtn").count(), 0, "急刹入口必须从桌面和移动端移除");
  const beforeBrakeKey = await page.locator("#powerValue").textContent();
  await page.keyboard.press("b");
  assert.equal(await page.locator("#powerValue").textContent(), beforeBrakeKey, "移除后的 B 键不可改变推进档位");
  assert.equal(await page.locator(".command-portrait img").count(), 3, "三舰均需展示头像");
  assert.equal(await page.locator('.fleet-row[data-ship="sub1"]').isDisabled(), true, "编队中的副舰不可直接操控");
  await page.locator("#splitOneBtn").click();
  await page.locator('.fleet-row[data-ship="sub1"]').click();
  await page.waitForFunction(() => document.querySelector('.fleet-row[data-ship="sub1"]').getAttribute("aria-pressed") === "true");
  await page.locator('#powerGearControl [data-gear="4"]').click();
  await page.waitForFunction(() => document.querySelector("#powerValue").textContent === "前进4");
  assert.equal(await page.locator(".throttle-energy-hint").textContent(), "超速·持续耗能");
  await page.keyboard.press("p");
  await page.waitForFunction(() => document.querySelector("#powerValue").textContent === "P档");
  await page.locator(".command-help summary").focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator(".command-help").evaluate((element) => element.open), true, "帮助应支持键盘展开，Enter 不应被航线快捷键吞掉");
  const nextZoom = await page.locator("#zoomOutBtn").isDisabled() ? "#zoomInBtn" : "#zoomOutBtn";
  await page.keyboard.press("Tab");
  assert.equal(await page.locator(nextZoom).evaluate((element) => element === document.activeElement), true, "面板控件内 Tab 应正常移焦");
  await page.locator(".command-help summary").click();
  await page.keyboard.press("1");
  await page.locator("#flagshipBtn").click();
  await page.locator('.fleet-card [data-effect="haruhi_boost"]').first().waitFor();
  await page.locator('.fleet-card [data-effect="broadcast"]').first().waitFor();
  await page.locator('.fleet-card [data-effect="haruhi_boost"]').first().hover();
  await page.locator(".status-effect-tooltip:visible").waitFor();
  assert.match(await page.locator(".status-effect-tooltip p").textContent(), /伤害与射速提高15%/);
  await page.keyboard.press("Escape");
  if (screenshotDir) await page.screenshot({ path: join(screenshotDir, "battle-desktop.png") });

  // 构造权威快照的边界状态，验证信息呈现，不向真实模拟写回数据。
  const fixture = await context.newPage();
  await fixture.goto(base, { waitUntil: "networkidle" });
  await fixture.evaluate(async () => {
    const { battleViewTemplate } = await import("/src/battle/template.js");
    const hud = await import("/src/battle/hud.js");
    const { MatchSimulation } = await import("/shared/game-core.js");
    document.querySelector("#app").innerHTML = battleViewTemplate();
    const ids = ["flagshipBtn", "subSkillBtn", "scoutBtn", "autoScoutBtn", "powerValue", "mobileBattleHud", "mobileBattleSummary", "mobileBattleHint", "splitOneBtn", "splitTwoBtn", "mobileSplitOneBtn", "mobileSplitTwoBtn", "mobileFlagshipBtn", "mobileSubSkillBtn", "mobileScoutBtn", "mobileAutoScoutBtn"];
    const ui = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
    ui.mobileShipButtons = [...document.querySelectorAll(".mobile-ship-btn")];
    ui.fleetRows = [...document.querySelectorAll(".fleet-row")].map((row) => ({ row, key: row.dataset.ship, name: row.querySelector(".fleet-name"), state: row.querySelector(".fleet-state"), hullFill: row.querySelector(".fleet-fill-hull"), enFill: row.querySelector(".fleet-fill-energy"), hullPct: row.querySelector(".fleet-pct-hull"), enPct: row.querySelector(".fleet-pct-energy") }));
    const team = new MatchSimulation({ teamLoadouts: { A: { main: "koizumi", sub1: "asakura", sub2: "future1096" } } }).serializeState().teams.A;
    window.commandFixture = { team, ui, hud, refresh(key = "sub1", pendingSubSkillAim = null) {
      const options = { selected: team.ships[key], selectedShipKey: key, selectedZoneId: 5, pendingSubSkillAim };
      hud.updateSkillButtons(ui, team, options);
      hud.renderFleetRoster(ui, team, options);
      hud.syncMobileHud(ui, team, { ...options, visible: true });
    } };
    window.commandFixture.refresh();
  });
  const status = fixture.locator("#subSkillBtn .command-action-state");
  assert.equal(await status.textContent(), "分离后可用");
  await fixture.evaluate(() => { const f = window.commandFixture; Object.assign(f.team.ships.sub1, { attached: false, canControl: true, fleetEnergy: 0, energy: 100 }); f.refresh(); });
  assert.equal(await status.textContent(), "能量不足");
  assert.equal(await fixture.locator('.fleet-row[data-ship="sub1"] .fleet-pct-energy').textContent(), "0%", "编队能量为零时不可回退到舰船个人能量");
  await fixture.evaluate(() => { const f = window.commandFixture; f.team.ships.sub1.fleetEnergy = 100; f.team.cooldowns.sub1 = 3.2; f.refresh(); });
  assert.equal(await status.textContent(), "3.2s");
  assert.equal(await fixture.locator("#mobileSubSkillBtn .command-action-state").textContent(), "3.2s", "双端冷却读数应一致");
  await fixture.evaluate(() => { const f = window.commandFixture; f.team.cooldowns.sub1 = 0; f.team.ships.sub1.silenced = true; f.refresh(); });
  assert.equal(await status.textContent(), "沉默中");
  await fixture.evaluate(() => { const f = window.commandFixture; f.team.ships.sub1.silenced = false; f.refresh("sub1", { shipKey: "sub1" }); });
  assert.equal(await fixture.locator("#commandContextHint").isVisible(), true, "瞄准模式需显示就近操作指引");
  assert.equal(await fixture.locator("#flagshipBtn kbd").isVisible(), false, "被动技能不应显示无效释放键位");
  await fixture.evaluate(() => { const f = window.commandFixture; f.team.ships.sub1.alive = false; f.refresh(); });
  assert.equal(await fixture.locator('.fleet-row[data-ship="sub1"] .fleet-pct-hull').textContent(), "0%");

  for (const [width, height] of [[1440, 900], [1280, 720], [390, 844], [390, 540], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    const boxes = await page.evaluate(() => {
      const rect = (selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
      const panel = document.querySelector(".battle-panel");
      return { panel: rect(".battle-panel"), map: rect("#gameCanvas"), hud: rect("#mobileBattleHud"), hint: rect("#mobileBattleHint"), scrollWidth: document.documentElement.scrollWidth, panelOverflow: panel.scrollHeight - panel.clientHeight, buttons: [...document.querySelectorAll(".mobile-action-grid > button")].map((button) => ({ id: button.id, ...rect(`#${button.id}`) })) };
    });
    if (screenshotDir) await page.screenshot({ path: join(screenshotDir, `battle-${width}x${height}.png`) });
    assert.equal(await page.locator("#brakeBtn, #mobileBrakeBtn").count(), 0, "所有视口均不可出现急刹入口");
    assert.ok(boxes.scrollWidth <= width, `${width}×${height} 不可横向溢出`);
    assert.ok(Math.abs(boxes.map.width - boxes.map.height) < 2, "战场应保持正方形");
    if (width > 980) assert.ok(boxes.panelOverflow <= 2, `${width}×${height} 常用操作应无需滚动，当前溢出 ${boxes.panelOverflow}px`);
    else {
      assert.ok(boxes.hud.bottom <= height + 1, "移动操作台不可越出视口");
      assert.ok(boxes.hint.bottom <= height + 1, "移动指引应保持可读");
      for (const box of boxes.buttons) assert.ok(box.x >= 0 && box.right <= width + 1, "移动按钮不可越出视口");
      const rows = [
        ["mobileSplitOneBtn", "mobileSplitTwoBtn", "mobileAutoScoutBtn"],
        ["mobileFlagshipBtn", "mobileScoutBtn", "mobileSubSkillBtn"],
      ].map((ids) => ids.map((id) => boxes.buttons.find((button) => button.id === id)));
      for (const row of rows) {
        assert.ok(row.every((button) => Math.abs(button.y - row[0].y) < 1), "移动端每组操作必须保持同一行");
        assert.ok(row[0].right <= row[1].x && row[1].right <= row[2].x, "移动端按钮必须按约定从左到右排列");
      }
      assert.ok(rows[0][0].bottom <= rows[1][0].y, "分离与自动侦察应位于主舰技、侦察、分舰技上一行");
    }
  }
  assert.deepEqual(errors, [], "对战面板操作不应产生浏览器异常");
  console.log("对战操作台检查通过：真实单人切舰、分离、换挡、键盘帮助；技能限制、冷却、瞄准与零能量；五种视口。");
} finally { await browser.close(); await vite.close(); }
