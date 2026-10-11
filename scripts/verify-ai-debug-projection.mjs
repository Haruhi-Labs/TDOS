import assert from "node:assert/strict";
import { MatchSimulation } from "../shared/game-core.js";

const match = new MatchSimulation({ mode: "ai", seed: 714931, aiDifficulty: "master" });
for (let tick = 0; tick < 120; tick += 1) match.update();
const bot = match.botBySeat("B");
const nested = () => ({ point: { x: 500, y: 600 }, path: [{ id: 7 }] });
const planFields = ["searchCenter", "combatCenter", "searchAssignments", "sectorPlan", "shamisenHuntPlan", "detachedPlan", "orders"];
for (const key of planFields) bot.lastTacticalPlan[key] = nested();
bot.lastScoutDecision = { detail: nested() };
const originalSkills = { flagship: structuredClone(bot.lastFlagshipDecision), sub: structuredClone(bot.lastSubSkillDecision) };
assert.throws(() => { bot.lastFlagshipDecision = { detail: nested() }; }, TypeError);
assert.throws(() => { bot.lastSubSkillDecision.sub1.action = "cast"; }, TypeError);
bot.lastSplitDecision = { detail: nested() };
const originalDoctrine = structuredClone(bot.scoutDoctrine);
const expected = bot.serializeDebugState();
const exposed = bot.serializeDebugState();

// 消费方任意修改输出，不得污染仍由策略持有的计划或下一次输出。
function overwrite(value) {
  for (const key of Object.keys(value || {})) {
    if (value[key] && typeof value[key] === "object") overwrite(value[key]);
    else if (typeof value[key] === "number") value[key] = -999;
    else if (typeof value[key] === "string") value[key] = "外部修改";
  }
}
overwrite(exposed);
assert.deepEqual(bot.serializeDebugState(), expected);
for (const key of planFields) bot.lastTacticalPlan[key].path[0].id = 8;
bot.lastScoutDecision.detail.path[0].id = 8;
bot.scheduleSkillDecision("flagship", 0);
bot.tryFlagshipSkill();
bot.scheduleSkillDecision("sub1", 0);
bot.trySubSkill("sub1");
bot.lastSplitDecision.detail.path[0].id = 8;
assert.throws(() => { bot.scoutDoctrine.lastPlan = nested(); }, TypeError);
for (const key of planFields) assert.equal(expected[key].path[0].id, 7, "策略后续修改不得污染历史快照");
for (const decision of [expected.scoutDecision, expected.splitDecision]) assert.equal(decision.detail.path[0].id, 7);
assert.deepEqual(expected.scoutDoctrine.lastPlan, originalDoctrine.lastPlan);
for (const [view, original] of [[expected.flagshipDecision, originalSkills.flagship],
  [expected.subSkillDecision.sub1, originalSkills.sub.sub1], [expected.subSkillDecision.sub2, originalSkills.sub.sub2]]) {
  for (const key of Object.keys(original)) assert.deepEqual(view[key], original[key], "技能推进不能改写历史决策");
}
console.log("AI 调试投影校验通过：计划、决策与策略嵌套数据独立，消费修改与后续推进均不污染历史。");
