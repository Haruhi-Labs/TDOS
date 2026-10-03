import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import { createBunnyViewFixture } from "./fixtures/bunny-haruhi-view.mjs";
import { interpolateBattleState } from "../src/battle/state-interpolation.js";
import { bunnyStagesForFrame } from "../src/battle/render/bunny-haruhi.js";
import { isShipSelectable } from "../src/battle/ship-selection.js";
import { RULESET_VERSION } from "../shared/protocol/ruleset-version.js";
import { createStatePatch, applyStatePatch, quantizeNetworkState } from "../shared/network-patch.js";
import { BUNNY_MESSAGES } from "../src/i18n/bunny-haruhi-text.js";
import { STATUS_EFFECT_DEFS } from "../shared/game/status-effect-definitions.js";

const { states } = createBunnyViewFixture();
const saved = JSON.stringify(states);
let previous = states.neutral;
for (const current of Object.values(states)) {
  const left = quantizeNetworkState(previous), right = quantizeNetworkState(current);
  assert.deepEqual(applyStatePatch(left, createStatePatch(left, right)), right);
  const display = interpolateBattleState(previous, current, 0.1);
  const ship = display.teams.A.ships.sub1;
  assert.equal(ship.bunnyHaruhi.form, current.teams.A.ships.sub1.bunnyHaruhi.form, "形态不可延迟到插值中点才切换");
  assert.equal(ship.throttle, current.teams.A.ships.sub1.throttle, "激奏不能显示虚构的中间档位");
  assert.deepEqual(display.teams.A.extraShips.map((s) => s.id), current.teams.A.extraShips.map((s) => s.id), "策反不能在旧队保留幽灵舰");
  previous = current;
}
assert.equal(isShipSelectable(states.lock.teams.A.ships.sub2), true, "舞台禁控仍保留选舰");
assert.equal(isShipSelectable(states.encore.teams.A.extraShips[0]), false, "阿虚不可被选择操作");
assert.equal(states.knows.teams.A.ships.sub1.statusEffects.find((s) => s.id === "bunny_immunity").duration, 4);
const dead = structuredClone(states.encore);
dead.teams.A.ships.sub1.alive = false;
dead.teams.A.ships.sub1.statusEffects = [];
assert.equal(interpolateBattleState(states.encore, dead, 0.01).teams.A.ships.sub1.alive, false);
const moved = structuredClone(states.encore);
moved.teams.B.bunnyStage.x += 80;
moved.teams.A.ships.sub1.bunnyHaruhi.esperOrb.x += 80;
const middle = interpolateBattleState(states.encore, moved, 0.5);
assert.equal(middle.teams.B.bunnyStage.x, states.encore.teams.B.bunnyStage.x + 40);
assert.equal(middle.teams.A.ships.sub1.bunnyHaruhi.esperOrb.x, states.encore.teams.A.ships.sub1.bunnyHaruhi.esperOrb.x + 40);
const hiddenFrame = { state: states.encore, ownTeam: states.encore.teams.A, visibleEnemyIds: new Set() };
assert.equal(bunnyStagesForFrame(hiddenFrame).length, 0, "不可用舞台范围泄露雾中敌舰");
assert.equal(bunnyStagesForFrame({ ...hiddenFrame, spectating: true }).length, 1);
assert.equal(JSON.stringify(states), saved, "展示插值和差量处理不能写回原快照");
for (const locale of ["en", "ja"]) for (const [id, def] of Object.entries(STATUS_EFFECT_DEFS).filter(([id]) => id.startsWith("bunny_"))) {
  for (const key of [def.name, def.description]) {
    const translated = BUNNY_MESSAGES[locale][key];
    // 共用的状态名由主词典覆盖，新增描述全部由本模块提供。
    if (key !== def.description && !translated) continue;
    assert.ok(translated, `${locale}/${id} 缺失翻译`);
    assert.deepEqual([...translated.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), [...key.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort());
  }
}

// Vite 仅回环监听；API/WS 全部由夹具接管，不操作身份、统计或现有游戏服务。
const vite = await createServer({ root: resolve(import.meta.dirname, ".."), logLevel: "silent", server: { host: "127.0.0.1", port: 0 }, plugins: [{
  name: "bunny-view-fixture",
  transform(code, id) {
    if (id.endsWith("/src/solo.js")) return `${code}\nglobalThis.bunnyFixture = { get app() { return app; }, publish(state) { app.paused = true; app.state = state; app.renderState = app.renderPreviousState = app.renderCurrentState = state; app.playerLoadout = state.teams.A.loadout; updateShipSwitchLabels(app.playerLoadout); app.sim.serializeState = () => state; updateUi(); } };`;
    if (id.endsWith("/src/online.js")) return `${code}\nglobalThis.bunnyFixture = { get app() { return app; } };`;
    return null;
  },
}] });
await vite.listen();
const browser = await chromium.launch({ headless: true });
const screenshots = process.env.BUNNY_VIEW_SCREENSHOT_DIR;
const errors = [];
try {
  if (screenshots) await mkdir(screenshots, { recursive: true });
  for (const locale of ["zh-CN", "en-US", "ja-JP"]) for (const mode of ["solo", "online", "spectator"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale, reducedMotion: "reduce" });
    await context.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: '{"authenticated":false,"items":[]}' }));
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(`${mode}/${locale}: ${error.message}`));
    const missingAssets = [];
    page.on("response", (r) => { if (r.status() >= 400 && /characters|portraits/.test(r.url())) missingAssets.push(r.url()); });
    let socket, sequence = 0;
    const outgoing = [];
    let resolveInput;
    const nextInput = () => new Promise((done, reject) => {
      const timer = setTimeout(() => reject(new Error("未收到变身输入")), 3000);
      resolveInput = (message) => { clearTimeout(timer); resolveInput = null; done(message); };
    });
    if (mode === "solo") {
      await page.goto(`${vite.resolvedUrls.local[0]}play`, { waitUntil: "networkidle" });
      await page.locator('.solo-flow-item[data-action="standard"]').click();
      await page.locator('.solo-flow-item[data-action="difficulty:normal"]').click();
      for (const index of [0, 3, 2]) {
        await page.locator(".cs-tab").nth(index).click();
        await page.locator(".cs-page-flipper").waitFor({ state: "detached" });
        await page.locator('.cs-book > .cs-page-right .cs-enlist-cta[data-action="select"]').click();
      }
      await page.locator(".cs-launch").click();
      await page.locator("#battleView").waitFor({ state: "visible" });
      await page.waitForFunction(() => Boolean(window.bunnyFixture.app.sim));
    } else {
      const wsUrl = "ws://127.0.0.1:65530/bunny-view-fixture";
      await page.routeWebSocket(wsUrl, (ws) => { socket = ws; ws.onMessage((raw) => {
        const message = JSON.parse(String(raw)); outgoing.push(message);
        if (message.type === "input") resolveInput?.(message);
      }); });
      await page.goto(`${vite.resolvedUrls.local[0]}online?ws=${encodeURIComponent(wsUrl)}`, { waitUntil: "networkidle" });
      socket.send(JSON.stringify({ type: "connected", playerId: "view-test", rulesetVersion: RULESET_VERSION, tickRate: 30, snapshotRate: mode === "spectator" ? 7.5 : 15, protocolVersion: 2 }));
      socket.send(JSON.stringify({ type: "room_state", room: { roomId: "bunny-view", status: "running", mode: "pvp", players: ["A", "B"].map((seat) => ({ seat, name: seat, loadout: states.encore.teams[seat].loadout })) }, self: { seat: mode === "spectator" ? null : "A", spectating: mode === "spectator", loadout: states.encore.teams.A.loadout } }));
    }
    async function publish(state) {
      if (mode === "solo") await page.evaluate((s) => window.bunnyFixture.publish(s), state);
      else {
        for (let i = 0; i < 2; i += 1) {
          sequence++;
          socket.send(JSON.stringify({ type: "snapshot", roomId: "bunny-view", snapshotSeq: sequence, tick: sequence, state }));
          await page.waitForFunction((seq) => window.bunnyFixture.app.latestSnapshot?.snapshotSeq === seq, sequence);
          if (!i) await page.waitForTimeout(120);
        }
      }
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    }
    for (const mobile of [false, true]) {
      await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
      await publish(states.encore);
      if (mode !== "spectator") {
        await page.locator(mobile ? '.mobile-ship-btn[data-ship="sub1"]' : '.fleet-row[data-ship="sub1"]').click();
        if (mode === "online") await publish(states.encore);
        const gears = page.locator(mobile ? '.mobile-throttle-btn' : '#powerGearControl button');
        for (const button of await gears.all()) assert.equal(await button.isDisabled(), await button.getAttribute("data-gear") !== "4", "激奏只能保留当前4档");
        const before = outgoing.filter((m) => m.type === "input").length;
        await page.keyboard.press("Shift+Digit1");
        assert.equal(outgoing.filter((m) => m.type === "input").length, before, "锁档快捷键不可向服务端发送换档");
        await page.keyboard.press("v");
        await page.keyboard.press("x");
        assert.equal(outgoing.filter((m) => m.type === "input").length, before, "快捷键不得绕过权威变身资格和永久侦察禁用");
        assert.equal(await page.locator(mobile ? "#mobileScoutBtn" : "#scoutBtn").isDisabled(), true);
      }
      const details = page.locator(mode === "spectator" ? '.spectator-team[data-seat="A"] [data-slot="sub1"] .bunny-details' : mobile ? '.mobile-battle-hud .bunny-details' : '.battle-panel .bunny-details');
      await details.locator("summary").click();
      const readout = await details.locator(".bunny-readout").innerText();
      if (mode === "spectator") assert.equal(await details.locator(".bunny-readout-close").innerText(), locale === "zh-CN" ? "关闭舰况" : locale === "en-US" ? "Close status" : "艦況を閉じる");
      assert.ok(readout.includes("4"));
      assert.ok(!/\{\w+\}/.test(readout), "三语参数必须完整替换");
      assert.ok(readout.includes(locale === "zh-CN" ? "原皮" : locale === "en-US" ? "placeholder" : "仮立ち絵"));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "舰况不得造成横向溢出");
      const portrait = page.locator(mode === "spectator" ? '.spectator-team[data-seat="A"] [data-slot="sub1"] img' : '.fleet-row[data-ship="sub1"] img');
      assert.match(await portrait.getAttribute("src"), /haruhi/);
      assert.ok(!(await portrait.getAttribute("src")).includes("bunny_haruhi"), "占位必须复用原皮路径");
      await page.waitForFunction((selector) => { const image = document.querySelector(selector); return image?.complete && image.naturalWidth > 0; }, mode === "spectator" ? '.spectator-team[data-seat="A"] [data-slot="sub1"] img' : '.fleet-row[data-ship="sub1"] img');
      if (screenshots) await page.screenshot({ path: join(screenshots, `${mode}-${locale}-${mobile ? "mobile" : "desktop"}.png`) });
      await details.locator(mode === "spectator" ? ".bunny-readout-close" : "summary").click();
      for (const name of ["encoreExpired", "neutral", "attached", "bless", "knows", "knowsExpired", "converted", "companionDead", "lock", "recovery"]) {
        await publish(states[name]);
        if (mode !== "spectator") {
          if (name === "attached") {
            assert.equal(await page.locator(mobile ? '.mobile-ship-btn[data-ship="sub1"]' : '.fleet-row[data-ship="sub1"]').isDisabled(), true);
            continue;
          }
          const selected = name === "lock" || name === "recovery" ? "sub2" : "sub1";
          await page.locator(mobile ? `.mobile-ship-btn[data-ship="${selected}"]` : `.fleet-row[data-ship="${selected}"]`).click();
          if (mode === "online") await publish(states[name]);
          if (name === "encoreExpired") {
            assert.equal(await page.locator(mobile ? '.mobile-throttle-btn[data-gear="1"]' : '#powerGearControl [data-gear="1"]').isDisabled(), false, "激奏10秒到期后恢复换档");
          }
          if (name === "neutral") {
            assert.equal(await page.locator(mobile ? "#mobileSubSkillBtn" : "#subSkillBtn").isDisabled(), false, "变身无能耗，零能量时仍应显示可施放");
            assert.match(await page.locator(mobile ? '.mobile-throttle-btn[data-gear="1"]' : '#powerGearControl [data-gear="1"]').getAttribute("title"), /Shift\+1/, "退出锁档应恢复原档位提示");
            if (mode === "online") {
              const count = outgoing.filter((m) => m.type === "input").length;
              const received = nextInput();
              await page.locator(mobile ? "#mobileSubSkillBtn" : "#subSkillBtn").click();
              const input = await received;
              assert.equal(outgoing.filter((m) => m.type === "input").length, count + 1, "点按一次只发送一次变身动作");
              assert.equal(input.action.type, "cast_sub_skill");
            }
          }
          if (name === "lock") {
            assert.equal(await page.evaluate(() => window.bunnyFixture.app.selectedShipKey), "sub2");
            for (const button of await page.locator(mobile ? '.mobile-throttle-btn' : '#powerGearControl button').all()) assert.equal(await button.isDisabled(), true);
          }
        }
      }
      await publish(states.finished);
      await page.locator("#resultCard").waitFor({ state: "visible" });
      await page.waitForFunction(() => [...document.querySelectorAll("#resultVersus img")].every((img) => img.complete && img.naturalWidth > 0));
      await page.waitForFunction(() => [...document.querySelectorAll("#resultVersus .rl-card")].every((card) => Number(getComputedStyle(card).opacity) > 0.99));
      for (const source of await page.locator("#resultVersus img").evaluateAll((images) => images.map((image) => image.src))) {
        assert.ok(!source.includes("bunny_haruhi"), "单人、联机与观战终局都必须复用原皮素材");
      }
      assert.ok((await page.locator("#resultVersus").innerText()).includes(locale === "zh-CN" ? "兔女郎春日" : locale === "en-US" ? "Bunny Haruhi" : "バニーハルヒ"));
      if (screenshots && locale === "zh-CN") await page.screenshot({ path: join(screenshots, `result-${mode}-${mobile ? "mobile" : "desktop"}.png`) });
    }
    assert.deepEqual(missingAssets, [], "占位美术不得产生404");
    await context.close();
    console.log(`兔女郎视图通过：${mode} ${locale} 桌面/移动端`);
  }
  const renderPage = await browser.newPage({ viewport: { width: 1140, height: 480 } });
  await renderPage.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: '{"authenticated":false,"items":[]}' }));
  await renderPage.goto(vite.resolvedUrls.local[0], { waitUntil: "networkidle" });
  const renderResults = await renderPage.evaluate(async (state) => {
    const { createNativeBattleRenderer } = await import("/src/battle/native-webgl-renderer.js");
    const { drawBunnyStages, drawBunnyMarkers } = await import("/src/battle/render/bunny-haruhi.js");
    const frame = { state, ownTeam: state.teams.A, enemyTeam: state.teams.B, spectating: true };
    const world = [], mini = [];
    const probe = (record) => new Proxy({}, { set: () => true, get: (_, key) => key === "ellipse" ? (...args) => record.push(args) : () => {} });
    drawBunnyStages(probe(world), frame);
    drawBunnyStages(probe(mini), frame, { x: 10, y: 20, width: 144, height: 144 });
    if (world.some((circle, i) => Math.abs(mini[i][0] - (circle[0] / 10 + 10)) > 1e-6 || Math.abs(mini[i][1] - (circle[1] / 10 + 20)) > 1e-6 || Math.abs(mini[i][2] - circle[2] / 10) > 1e-6)) throw new Error("舞台主图/小地图几何不一致");
    document.body.replaceChildren();
    document.body.style.cssText = "display:flex;gap:12px;background:#06121f;color:white;padding:10px";
    const results = [];
    for (const mode of ["webgl2", "webgl1", "canvas2d"]) {
      const box = document.createElement("div"), canvas = document.createElement("canvas");
      box.textContent = mode;
      canvas.width = canvas.height = 360;
      box.append(canvas); document.body.append(box);
      const renderer = createNativeBattleRenderer(canvas, { forceMode: mode });
      const ctx = renderer.ctx;
      renderer.beginFrame();
      ctx.fillStyle = "#06121f"; ctx.fillRect(0, 0, 360, 360);
      ctx.save(); ctx.scale(0.25, 0.25);
      drawBunnyStages(ctx, frame); drawBunnyMarkers(ctx, frame); ctx.restore();
      drawBunnyStages(ctx, frame, { x: 220, y: 220, width: 120, height: 120 });
      drawBunnyMarkers(ctx, frame, { x: 220, y: 220, width: 120, height: 120 });
      renderer.present();
      let pixels;
      if (mode === "canvas2d") pixels = canvas.getContext("2d").getImageData(0, 0, 360, 360).data;
      else {
        const gl = canvas.getContext(mode === "webgl2" ? "webgl2" : "webgl");
        pixels = new Uint8Array(360 * 360 * 4);
        gl.readPixels(0, 0, 360, 360, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      }
      let visible = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 70 && pixels[i + 1] > 70) visible++;
      const initial = renderer.getStats();
      const cacheSize = ctx.textCache?.entries.size || 0;
      for (let tick = 0; tick < 120; tick++) {
        frame.state.elapsed += 1 / 30;
        renderer.beginFrame();
        ctx.fillStyle = "#06121f"; ctx.fillRect(0, 0, 360, 360);
        ctx.save(); ctx.scale(0.25, 0.25);
        drawBunnyStages(ctx, frame); drawBunnyMarkers(ctx, frame); ctx.restore();
        drawBunnyStages(ctx, frame, { x: 220, y: 220, width: 120, height: 120 });
        drawBunnyMarkers(ctx, frame, { x: 220, y: 220, width: 120, height: 120 });
        renderer.present();
      }
      const stats = renderer.getStats();
      results.push({ mode: renderer.mode, expected: mode, visible, initial, stats, cacheSize, finalCacheSize: ctx.textCache?.entries.size || 0 });
    }
    return results;
  }, states.encore);
  for (const result of renderResults) {
    assert.equal(result.mode, result.expected);
    assert.ok(result.visible > 100, `${result.mode} 舞台/形态/伴随舰图元必须真实绘制`);
    assert.equal(result.finalCacheSize, result.cacheSize, "倒计时变化不得持续增加字形缓存");
    assert.equal(result.stats.textureUploads, 0, "预热后不应重复上传舞台纹理");
  }
  if (screenshots) await writeFile(join(screenshots, "render-stats.json"), JSON.stringify(renderResults, null, 2));
  if (screenshots) await renderPage.screenshot({ path: join(screenshots, "renderers.png") });
  await renderPage.close();
  // 独立验证部署前缀与红蓝占位资源，共用原皮缓存，不能生成 bunny_haruhi.webp 请求。
  const prefixed = await createServer({ root: resolve(import.meta.dirname, ".."), base: "/game/", logLevel: "silent", server: { host: "127.0.0.1", port: 0 } });
  await prefixed.listen();
  try {
    const page = await browser.newPage();
    await page.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: '{"authenticated":false,"items":[]}' }));
    await page.goto(prefixed.resolvedUrls.local[0], { waitUntil: "networkidle" });
    const assets = await page.evaluate(async () => {
      const p = await import("/game/src/character-select/portraits.js");
      return Promise.all(["red", "blue"].map(async (color) => {
        const original = await p.loadPortraitImage("haruhi", color);
        const bunny = await p.loadPortraitImage("bunny_haruhi", color);
        return { url: p.getPortraitAssetUrl("bunny_haruhi", color), loaded: Boolean(bunny?.naturalWidth), shared: bunny === original };
      }));
    });
    for (const asset of assets) { assert.match(asset.url, /^\/game\/assets\/portraits\/(red|blue)\/haruhi\.webp$/); assert.ok(asset.loaded && asset.shared); }
    await page.close();
  } finally { await prefixed.close(); }
  const failed = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await failed.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: '{"authenticated":false,"items":[]}' }));
  let failedRequests = 0;
  await failed.route("**/assets/portraits/**", (route) => { failedRequests++; return route.fulfill({ status: 404, body: "" }); });
  await failed.goto(vite.resolvedUrls.local[0], { waitUntil: "networkidle" });
  await failed.evaluate(async () => {
    const portraits = await import("/src/character-select/portraits.js");
    if (await portraits.loadPortraitImage("bunny_haruhi", "blue") !== null) throw new Error("404应使用占位图");
    document.body.replaceChildren(portraits.getPortrait("bunny_haruhi", 300, 600, "blue"));
  });
  const attempts = failedRequests;
  await failed.evaluate(async () => {
    const portraits = await import("/src/character-select/portraits.js");
    for (let frame = 0; frame < 120; frame++) {
      await portraits.loadPortraitImage("bunny_haruhi", "blue");
      portraits.getPortrait("bunny_haruhi", 300, 600, "blue");
    }
  });
  assert.equal(failedRequests, attempts, "加载失败缓存不能每帧重试");
  if (screenshots) await failed.screenshot({ path: join(screenshots, "failed-portrait.png") });
  await failed.close();
  assert.deepEqual(errors, [], "浏览器不应出现运行错误");
} finally {
  await browser.close();
  await vite.close();
}
console.log("兔女郎视图检查通过：权威快照、差量、插值、雾中隐藏、三种页面与三语状态及原皮素材。");
