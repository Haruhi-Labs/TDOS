import assert from "node:assert/strict";
import { MatchSimulation } from "../shared/game-core.js";
import { IntelTracker } from "../shared/game/ai/policy/intel-tracker.js";
import { resolveAiParams } from "../shared/game/ai/params/index.js";
import { SearchBelief } from "../shared/game/ai/policy/belief.js";

const match = new MatchSimulation({ mode: "ai", seed: 9142 });
const bot = match.botBySeat("B");
assert.equal(bot.enemyIntel, undefined, "策略不得公开可变情报仓库");
assert.equal(bot.pendingSightings, undefined, "待确认队列必须归情报组件所有");
assert.equal(bot.belief, undefined, "概率网格不得暴露给策略或消费者");
assert.throws(() => { bot.rememberedMain.x = -1; }, TypeError);
assert.throws(() => { bot.rememberedContacts.push({}); }, TypeError);

let time = 0;
const params = resolveAiParams({ difficulty: "master" });
const zones = bot.obs.world.zones;
const spawn = { id: 8, key: "main", slotKey: "main", x: 200, y: 200, angle: 0 };
const published = [];
const intel = new IntelTracker({
  observe: () => ({ time, world: { size: 1440, zones }, self: { ships: { main: { x: 700, y: 700 } } }, enemy: { visible: [] } }),
  parameters: () => ({ params, profile: params.profile, reactionMult: 1 }),
  contactZone: (zone) => published.push(zone),
}, spawn);
const input = { ...spawn, kind: "ship", tactics: { detail: { value: 4 } } };
time = 1;
intel.queueSighting(input);
input.x = 900;
input.tactics.detail.value = 10;
intel.flushPendingSightings();
assert.equal(intel.contactCount, 0, "反应窗口结束前不能提交接触");
time = 2;
intel.flushPendingSightings();
assert.equal(intel.main.x, 200);
assert.equal(intel.main.detail.value, 4, "入队时必须隔离嵌套输入");
assert.throws(() => { intel.contacts[0].detail.value = 20; }, TypeError);
assert.equal(intel.pendingCount, 0);
assert.equal(published.length, 1);
const remembered = intel.main;
time = 30;
intel.refreshIntel();
assert.equal(intel.contactCount, 0, "过期接触由组件淘汰");
assert.equal(intel.main, remembered, "旗舰历史锚点保留原有语义");

const belief = new SearchBelief(1440, spawn);
const peak = belief.peak();
peak.x = -1;
assert.notEqual(belief.peak().x, -1);
const weights = belief.zoneWeights(zones);
weights.clear();
assert.equal(belief.zoneWeights(zones).size, 9, "搜索输出不得泄露概率存储");
console.log("AI 情报所有权校验通过：延迟确认、输入隔离、不可变记录、过期淘汰和搜索结果隔离。");

const { ScoutDoctrine } = await import("../shared/game/ai/policy/tactics/yuki-scout.js");
const doctrine = new ScoutDoctrine();
const plan = { mode: "screen", mission: "screen", zoneId: 1, primaryZoneId: 1, predictedZoneId: 2,
  coverageZoneIds: [1, 2], commitment: 5 };
let plansBuilt = 0;
const select = (now) => doctrine.selectPlan({ enabled: true, now, scoutDue: false, refreshInterval: 10 }, () => {
  plansBuilt += 1;
  return plan;
});
const cached = select(0);
doctrine.retask(cached, { now: 0, scouts: [], zones }, () => { throw new Error("空编组不能提交任务"); });
assert.equal(select(1), cached);
assert.equal(plansBuilt, 1, "重编组窗口内复用计划");
doctrine.deployed(cached, 1);
const doctrineSnapshot = doctrine.snapshot;
plan.coverageZoneIds.push(3);
assert.deepEqual(cached.coverageZoneIds, [1, 2]);
assert.deepEqual(doctrineSnapshot.lastPlan.coverageZoneIds, [1, 2]);
assert.throws(() => { doctrineSnapshot.nextRetaskAt = 0; }, TypeError);
assert.equal(doctrineSnapshot.deployments, 1);
select(1.2);
assert.equal(plansBuilt, 2, "重编组到期必须重算计划");
console.log("侦察条令所有权校验通过：计划缓存、重编组窗口、部署消费和只读历史互相隔离。");

// 纯外推缓存仅在观测、参数与不可变接触都未改变时复用。
const contact = bot.rememberedMain;
const projection = bot.projectContact(contact, 1.8);
// 外部门面会先刷新观测；直接组件测试固定其采样身份。
let observation = Object.freeze({ time: 1, world: { size: 1440, zones }, self: { ships: { main: { x: 700, y: 700 } } } });
let configured = params;
const memo = new IntelTracker({ observe: () => observation,
  parameters: () => ({ params: configured, profile: configured.profile, reactionMult: 1 }), contactZone() {},
}, spawn);
const projected = memo.projectContact(memo.main, 1.8);
assert.equal(memo.projectContact(memo.main, 1.8), projected);
assert.throws(() => { projected.x = -1; }, TypeError);
observation = { ...observation, time: 5 };
assert.notEqual(memo.projectContact(memo.main, 1.8), projected);
const later = memo.projectContact(memo.main, 1.8);
configured = resolveAiParams({ difficulty: "easy" });
assert.notEqual(memo.projectContact(memo.main, 1.8), later);
assert.equal(projected.age, 0);
assert.ok(projection);
