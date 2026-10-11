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
