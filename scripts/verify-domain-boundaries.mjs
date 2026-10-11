import assert from "node:assert/strict";
import { MatchSimulation } from "../shared/game-core.js";

const match = new MatchSimulation({ mode: "pvp", seed: 741 });
const left = match.teamA.ships.main;
const right = match.teamB.ships.main;
const originalRules = match.rules;
left.x = right.x = 700;
left.y = 700;
right.y = 701;
match.teamA.visibleEnemyIds.add(right.id);

// 未新增角色分支，仅替换能力契约即可改变通用碰撞、伤害资格与广播视野。
match.rules = Object.freeze({
  ...originalRules,
  participatesInHullCollision: () => false,
  canDamage: () => false,
  broadcastShips: (team) => [team.ships.main],
});
match.resolveShipCollisions();
assert.equal(left.x, 700);
assert.equal(left.y, 700);
assert.equal(right.y, 701, "碰撞系统必须消费能力契约");
assert.equal(match.teamA.fireCandidates(left, match.teamB).length, 0, "目标资格必须消费能力契约");
const hp = left.hp;
left.takeDamage(50, right, match);
assert.equal(left.hp, hp, "承伤与选敌必须共用攻击资格");
match.teamA.getVisionSources = () => [];
match.teamA.computeVisibility(match.teamB);
assert.equal(match.teamA.visibleEnemyIds.has(right.id), true, "通用视野必须消费广播来源");

// 查询能力不得改变任何权威字段；统计、序列化和战斗可在同一帧重复查询。
match.rules = originalRules;
const before = JSON.stringify(match.serializeState());
for (let repeat = 0; repeat < 3; repeat += 1) {
  left.isControlLocked();
  left.isSilenced();
  left.isDamageImmune();
  left.baseSpeed();
  left.minimumFlightSpeed();
  left.damageTakenMultiplier();
  match.rules.broadcastShips(match.teamA);
}
assert.equal(JSON.stringify(match.serializeState()), before, "能力查询不得写入权威状态");
console.log("领域边界校验通过：通用系统消费能力契约，查询不写入权威状态。");

// 输出给 UI 或工具的快照不得把航线、地图或 AI 记忆的引用带出权威层。
const isolated = new MatchSimulation({ mode: "ai", seed: 93 });
isolated.teamA.ships.main.setBezierRoute(undefined, undefined, 500, 500, 1, false);
for (let tick = 0; tick < 20; tick += 1) isolated.update();
const detached = isolated.serializeState();
const expected = JSON.stringify(detached);
function vandalize(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "number") value[key] = -999;
    else if (typeof item === "string") value[key] = "外部修改";
    else vandalize(item);
  }
}
vandalize(detached);
assert.equal(JSON.stringify(isolated.serializeState()), expected, "修改输出快照不得回写权威或 AI 状态");
const observation = isolated.bot.port.observe();
const zoneX = isolated.zones[0].x;
observation.world.zones[0].x = -500;
assert.equal(isolated.zones[0].x, zoneX, "AI 观察不得引用权威地图对象");
console.log("输出隔离校验通过：外部修改快照及观察不能回写对局。");

// 过期状态的读取不负责结算；重复序列化也不能触发清理。
match.elapsed = 0;
for (let hit = 0; hit < 2; hit += 1) left.registerClawHit({ sourceSeat: "B", triggerHits: 4, markDuration: 1, color: "#fff" }, match);
match.elapsed = 2;
const expired = { ...left.clawMarks };
for (let repeat = 0; repeat < 3; repeat += 1) {
  assert.equal(left.activeClawMarks().stacks, 0);
  left.serialize();
}
assert.deepEqual(left.clawMarks, expired, "只读查询不得提交过期状态");
left.update(0);
assert.equal(left.clawMarks.stacks, 0, "实体更新应提交到期清理");
assert.throws(() => { left.activeClawMarks().required = 999; }, TypeError);
assert.equal(left.clawMarks.required, 4, "抓痕查询不得暴露可写组件引用");
console.log("查询纯度校验通过：过期清理属于实体生命周期，读取次数不影响权威状态。");

// 策略不需要模拟实例；冻结读模型仍能完成预算分配和优先级选择。
const { assignFocusTargets, pickTargetId } = await import("../shared/game/targeting-system.js");
const { freezePlainData } = await import("../shared/data/plain-data.js");
const candidates = freezePlainData([
  { target: { id: "近", hp: 80, maxHp: 100 }, dist: 1, arc: 0 },
  { target: { id: "弱", hp: 10, maxHp: 100 }, dist: 4, arc: 1 },
  { target: { id: "次弱", hp: 20, maxHp: 100 }, dist: 2, arc: 1 },
]);
const assignments = assignFocusTargets(freezePlainData([
  { id: "低输出", budget: 5, candidates },
  { id: "高输出", budget: 12, candidates },
]), 0.5);
assert.deepEqual([...assignments], [["高输出", "弱"], ["低输出", "次弱"]]);
assert.equal(pickTargetId(candidates, { focusLowHp: false }), "近", "普通选敌保留最近目标与后续射界判定的顺序");
assert.equal(pickTargetId(candidates, { focusLowHp: true, focusHpFrac: 0.5 }), "弱");
assert.equal(pickTargetId(candidates, { huntTargetId: "次弱", assignedTargetId: "弱", focusLowHp: true, focusHpFrac: 0.5 }), "次弱");
assert.equal(pickTargetId(candidates.filter((entry) => entry.target.id !== "弱"), { assignedTargetId: "弱", focusLowHp: true, focusHpFrac: 0.5 }), "次弱", "已失效分配不得压过本次有效候选");
console.log("选敌读模型校验通过：纯数据分配、优先级与失效目标回退保持契约。");

const { Scout } = await import("../shared/game/model/scout.js");
const { Wingman } = await import("../shared/game/model/wingman.js");
const ownershipMatch = new MatchSimulation({ mode: "pvp", seed: 91 });
const sourceTeam = ownershipMatch.teamB;
const destinationTeam = ownershipMatch.teamA;
const sourceZone = ownershipMatch.zoneById(1);
const targetZone = ownershipMatch.zoneById(5);
const scout = new Scout(sourceTeam, 700, 700, { zone: sourceZone });
sourceTeam.addScout(scout);
const patrol = { x: 701, y: 702 };
assert.equal(sourceTeam.assignScoutMission(scout, { zoneId: 1, seekPoint: patrol, patrolCenter: patrol }), true);
patrol.x = -999;
assert.equal(scout.command.x, 701, "任务输入不能保留调用方的可写点引用");
assert.equal(scout.patrolCenter.x, 701);
const wingman = new Wingman(sourceTeam, 700, 700, sourceZone);
sourceTeam.addWingman(wingman);
assert.equal(destinationTeam.bribeZone(destinationTeam.ships.main, 5), true);
assert.equal(sourceTeam.scouts.includes(scout), false);
assert.equal(sourceTeam.wingmen.includes(wingman), false);
assert.equal(destinationTeam.scouts.filter((entity) => entity === scout).length, 1);
assert.equal(destinationTeam.wingmen.filter((entity) => entity === wingman).length, 1);
assert.equal(scout.team, destinationTeam);
assert.equal(wingman.team, destinationTeam);
assert.equal(scout.zone, sourceZone, "侦察机策反只改变下一目标，保留原巡逻区域语义");
assert.equal(wingman.zone, targetZone);
assert.equal(sourceTeam.assignScoutMission(scout, { zoneId: 2 }), false, "原所有者不得继续指挥已转移实体");
console.log("实体所有权校验通过：任务输入隔离，策反同时移交实体与集合归属。");

const { resolveShipCollisions } = await import("../shared/game/collision-system.js");
const hulls = [100, 101, 102].map((x, index) => ({
  id: index + 1, x, y: 100, radius: 2, seat: index, participates: true, attached: false, collidesWithAttachedAllies: false,
  displaceTo(nextX, nextY) { this.x = nextX; this.y = nextY; },
  applyCollisionSlow(until) { this.slowUntil = until; },
}));
const oldContacts = new Set();
const nextContacts = resolveShipCollisions({
  ships: hulls, previousContacts: oldContacts, elapsed: 10,
});
assert.deepEqual(hulls.map((ship) => ship.x), [98.25, 104.375, 100.375], "后续碰撞应消费前一次位移后的几何");
assert.equal(oldContacts.size, 0, "碰撞查询不得修改所有者上一帧的接触集合");
assert.equal(nextContacts.size, 3);
assert.ok(hulls.every((ship) => ship.slowUntil === 13));
console.log("碰撞端口校验通过：无需对局对象，位移顺序与接触历史所有权保持不变。");

const { createHullCollisionPort } = await import("../shared/game/rules/collision-port.js");
const hullPort = createHullCollisionPort(left, match.rules);
assert.equal(hullPort.team, undefined);
assert.equal(hullPort.effects, undefined);
assert.equal(hullPort.hp, undefined);
assert.throws(() => { hullPort.x = 0; }, TypeError, "碰撞几何只能通过位移操作提交");

const { executeFlagshipEffect, executeSubEffect } = await import("../shared/game/rules/active-skills.js");
const effectCalls = [];
assert.equal(executeFlagshipEffect("haruhi", { spendEnergy: () => false, activateSupport: () => { throw new Error("能量不足不得执行技能"); } }, { cost: 30 }), false);
assert.equal(executeFlagshipEffect("future1096", { switchForm: () => true }, {}), true, "形态切换保留无额外扣费语义");
assert.equal(executeSubEffect("future1096", { castBeam: () => false, refundEnergy: (cost) => effectCalls.push(["refund", cost]) }, { cost: 20 }), false);
assert.deepEqual(effectCalls, [["refund", 20]], "瞄准失败仍按既有路径返还能量");
effectCalls.length = 0;
assert.equal(executeSubEffect("asakura", {
  activateEffect: (key, duration) => effectCalls.push([key, duration]),
  ensureMinimumSpeed: () => effectCalls.push(["speed"]),
}, { duration: 10 }), true);
assert.deepEqual(effectCalls, [["bladeQueenUntil", 10], ["speed"]], "先激活效果，再按生效属性提升航速");
assert.equal(executeSubEffect("未注册角色", {}, {}), false);
assert.equal(executeSubEffect("constructor", {}, {}), false);
console.log("技能端口校验通过：无需模拟对象，保留扣费拒绝、失败退款与即时效果顺序。");

assert.equal(createHullCollisionPort(left, match.rules), hullPort, "同一实体和能力契约复用碰撞句柄");
assert.notEqual(createHullCollisionPort(left, { ...match.rules }), hullPort, "替换能力契约必须更新句柄");
assert.throws(() => { hullPort.displaceTo = () => {}; }, TypeError, "消费者不得替换缓存句柄的操作");
const originalTeam = left.team;
left.team = match.teamB;
assert.equal(hullPort.seat, "B", "转队后复用句柄仍应读取当前阵营");
left.team = originalTeam;

await import("./verify-character-boundaries.mjs");

await import("./verify-beam-lifecycle.mjs");

await import("./verify-future-form.mjs");

await import("./verify-sponsor-effect.mjs");

await import("./verify-bunny-ownership.mjs");

await import("./verify-support-ownership.mjs");

await import("./verify-plain-data.mjs");

await import("./verify-projectile-phase.mjs");

await import("./verify-hero-power-ownership.mjs");

await import("./verify-feedback-ownership.mjs");

await import("./verify-expanding-wave.mjs");

await import("./verify-throttle-constraint.mjs");

await import("./verify-ai-debug-projection.mjs");

await import("./verify-haruhi-flagship-runtime.mjs");

await import("./verify-vision-wave-phase.mjs");

await import("./verify-character-configuration.mjs");

await import("./verify-character-localization.mjs");

await import("./verify-claw-ownership.mjs");

await import("./verify-fleet-participation.mjs");

await import("./verify-navigation-ownership.mjs");

await import("./verify-ship-combat.mjs");

await import("./verify-formation-ownership.mjs");

await import("./verify-skill-cycle.mjs");

await import("./verify-ship-status.mjs");
