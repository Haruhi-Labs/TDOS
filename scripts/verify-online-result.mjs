import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright";
import { MatchSimulation, DEFAULT_TEAM_LOADOUT } from "../shared/game-core.js";
import { RULESET_VERSION } from "../shared/protocol/ruleset-version.js";

// 只启动回环前端，身份/统计/API 和 WebSocket 都由夹具接管。
const vite = await createServer({ root: resolve(import.meta.dirname, ".."), logLevel: "silent", server: { host: "127.0.0.1", port: 0 }, plugins: [{
  name: "result-view-fixture",
  transform(code, id) {
    if (id.endsWith("/src/online.js")) return `${code}\nglobalThis.resultFixture = { get timeline() { return snapshotTransport.state; } };`;
    return null;
  },
}] });
await vite.listen();
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  for (const reasonSource of ["elimination", "snapshot", "room"]) for (const spectating of [false, true]) for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile, locale: "zh-CN" });
    await context.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: '{"authenticated":false,"items":[]}' }));
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    const outgoing = [];
    let socket;
    const wsUrl = "ws://127.0.0.1:65530/result-fixture";
    await page.routeWebSocket(wsUrl, (ws) => { socket = ws; ws.onMessage((raw) => outgoing.push(JSON.parse(String(raw)))); });
    await page.goto(`${vite.resolvedUrls.local[0]}online?ws=${encodeURIComponent(wsUrl)}`, { waitUntil: "networkidle" });
    socket.send(JSON.stringify({ type: "connected", playerId: "result-test", rulesetVersion: RULESET_VERSION, tickRate: 30, snapshotRate: 15, protocolVersion: 2 }));
    const room = { roomId: "result-room", status: "running", mode: "pvp", players: ["A", "B"].map((seat) => ({ seat, name: `结算${seat}`, playerId: `player-${seat}`, loadout: DEFAULT_TEAM_LOADOUT })) };
    if (reasonSource === "room") room.endReason = "objective";
    const publishRoom = () => socket.send(JSON.stringify({ type: "room_state", room, self: { seat: spectating ? null : "A", spectating, loadout: DEFAULT_TEAM_LOADOUT } }));
    publishRoom();
    const state = new MatchSimulation({ mode: "pvp", seed: 17 }).serializeState();
    state.phase = "finished";
    state.winnerSeat = "A";
    if (reasonSource === "snapshot") state.endReason = "objective";
    const publish = (snapshotSeq) => socket.send(JSON.stringify({ type: "snapshot", roomId: room.roomId, snapshotSeq, tick: snapshotSeq, state }));
    publish(1);
    await page.locator("#overlay:not(.hidden)").waitFor({ state: "visible" });
    assert.equal(await page.locator("#resultEyebrow").textContent(), spectating ? "SPECTATE" : "VICTORY");
    assert.equal(await page.locator("#resultSub").textContent(), spectating ? "观战结束"
      : reasonSource === "elimination" ? "敌方舰队已被击溃" : "已按本局规则完成结算", "终局说明消费权威原因，不能把非歼灭结果解释为全灭");
    assert.equal(await page.locator("#resultVersus .result-side").count(), 2);
    assert.match(await page.locator("#resultVersus").textContent(), /结算A/);
    await page.evaluate(() => { window.firstResultSide = document.querySelector("#resultVersus").firstElementChild; });
    room.status = "finished";
    room.winnerSeat = "A";
    room.closesAt = Date.now() + 60000;
    publishRoom();
    await page.waitForFunction(() => document.querySelector("#resultSub").textContent.includes("房间将在"));
    publish(2);
    await page.waitForFunction(() => window.resultFixture.timeline.latestSnapshot?.snapshotSeq === 2);
    assert.equal(await page.evaluate(() => window.firstResultSide === document.querySelector("#resultVersus").firstElementChild), true, "重复终局消息不得重建结算阵容或重播入场动画");
    await page.locator("#overlayActionBtn").click();
    await page.locator("#overlay").waitFor({ state: "hidden" });
    assert.ok(outgoing.some((message) => message.type === "leave_room"), "返回大厅应提交离房操作");
    const closedSubtitle = await page.locator("#resultSub").textContent();
    await page.waitForTimeout(1100);
    assert.equal(await page.locator("#resultSub").textContent(), closedSubtitle, "离房后倒计时不得继续改写已关闭视图");
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log("结算浏览器校验通过：玩家/观战、桌面/触屏、胜者与阵容、重复终局、关闭倒计时及离房清理。");
} finally {
  await browser.close();
  await vite.close();
}
