import assert from "node:assert/strict";
import { MatchSimulation } from "../shared/game-core.js";

const match = new MatchSimulation({ mode: "ai", seed: 714931, aiDifficulty: "master" });
for (let tick = 0; tick < 120; tick += 1) match.update();
const bot = match.botBySeat("B");
for (const key of ["lastTacticalPlan", "lastScoutDecision", "lastSplitDecision", "currentContext", "mode", "modeTimer", "moveTimer", "stuckTimer"]) {
  assert.throws(() => { bot[key] = null; }, TypeError, `${key} 只能由策略协调器提交`);
}
assert.throws(() => { bot.lastTacticalPlan.orders.main = {}; }, TypeError);
assert.throws(() => { bot.lastScoutDecision.action = "外部修改"; }, TypeError);
assert.throws(() => { bot.lastSplitDecision.acted.push(2); }, TypeError);
assert.throws(() => { bot.currentContext.shipThreats.main = {}; }, TypeError);
assert.throws(() => { bot.lastFlagshipDecision = {}; }, TypeError);
assert.throws(() => { bot.lastSubSkillDecision.sub1.action = "cast"; }, TypeError);
assert.throws(() => { bot.scoutDoctrine.lastPlan = {}; }, TypeError);
const expected = bot.serializeDebugState();
const history = structuredClone(expected);
const exposed = bot.serializeDebugState();
function overwrite(value) {
  for (const key of Object.keys(value || {})) {
    if (value[key] && typeof value[key] === "object") overwrite(value[key]);
    else if (typeof value[key] === "number") value[key] = -999;
    else if (typeof value[key] === "string") value[key] = "外部修改";
  }
}
overwrite(exposed);
assert.deepEqual(bot.serializeDebugState(), expected, "修改投影不能污染后续读取");
for (let tick = 0; tick < 120; tick += 1) match.update();
assert.deepEqual(expected, history, "后续真实决策不得修改历史投影");
assert.notDeepEqual(bot.serializeDebugState(), history, "对局确实推进到新的决策状态");
console.log("AI 计划所有权校验通过：外部与策略模块无字段写权，历史决策及调试投影相互隔离。");

const metricsHistory = bot.decisionMetrics;
assert.throws(() => { metricsHistory.scoutRetasks = -1; }, TypeError);
assert.throws(() => { bot.decisionMetrics = {}; }, TypeError);
assert.throws(() => { bot.unownedState = {}; }, TypeError);
const rejectionHistory = match.aiRunners.B.port.permissionRejections;
assert.throws(() => { rejectionHistory.count = -1; }, TypeError);
assert.throws(() => { match.aiRunners.B.port.permissionRejections = {}; }, TypeError);

for (const field of ['port', 'rng']) {
  assert.equal(field in bot, false, `策略不得向消费者泄露 ${field} 能力`);
  assert.throws(() => { bot[field] = {}; }, TypeError);
}
const observationPort = match.aiRunners.B.port;
bot.strictObservation = true;
assert.equal(observationPort.strict, true);
const strictObservation = bot.obs;
assert.ok(Object.isFrozen(strictObservation));
bot.strictObservation = false;
assert.equal(observationPort.strict, false);
assert.notEqual(bot.obs, strictObservation, '模式切换仍要使观察缓存失效');

const configured = bot.setDifficulty(bot.difficulty);
assert.equal(configured, bot, '链式配置必须返回同一个受校验门面');
assert.throws(() => configured.energyProfile(match.teamB.ships.main), /只接受观测数据/);
