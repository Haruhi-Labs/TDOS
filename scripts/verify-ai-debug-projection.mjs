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
