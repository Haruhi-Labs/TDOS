import assert from "node:assert/strict";
import { MatchSimulation, TICK_DT } from "../shared/game-core.js";

const match = new MatchSimulation({ seed: 19 });
const combatBefore = match.combatEnabled;
const aiBefore = match.aiEnabled;
assert.throws(() => { match.combatEnabled.A = false; }, TypeError, "战斗开关不得绕过所有者直接写入");
assert.throws(() => { match.aiEnabled.B = false; }, TypeError, "AI 开关不得绕过所有者直接写入");
assert.throws(() => { match.combatEnabled = { A: false, B: false }; }, TypeError);
assert.throws(() => { match.aiEnabled = {}; }, TypeError);
match.setCombatEnabled("A", 0);
match.setAiEnabled("B", null);
assert.deepEqual(match.combatEnabled, { A: false, B: true });
assert.deepEqual(match.aiEnabled, { A: true, B: false });
assert.deepEqual(combatBefore, { A: true, B: true }, "历史读取不跟随下一次设置变化");
assert.deepEqual(aiBefore, { A: true, B: true });
const combatAfter = match.combatEnabled;
const aiAfter = match.aiEnabled;
for (const seat of ["C", "__proto__", null]) {
  match.setCombatEnabled(seat, false);
  match.setAiEnabled(seat, false);
}
assert.equal(match.combatEnabled, combatAfter, "非法席位不修改开关");
assert.equal(match.aiEnabled, aiAfter);
match.setCombatEnabled("A", false);
assert.equal(match.combatEnabled, combatAfter, "重复设置不改变已发布视图");

// 通过真实 update 阶段编排检查：前一席操作必须立即影响后一席，不允许提前缓存整帧开关。
const calls = [];
let enableB = false;
match.aiRunners = {
  A: { update() { calls.push("ai:A"); match.setAiEnabled("B", enableB); } },
  B: { update() { calls.push("ai:B"); } },
};
match.teamA.stepCombat = () => { calls.push("combat:A"); match.setCombatEnabled("B", enableB); };
match.teamB.stepCombat = () => { calls.push("combat:B"); };
match.setCombatEnabled("A", true);
match.update(TICK_DT);
assert.deepEqual(calls, ["ai:A", "combat:A"]);
calls.length = 0;
enableB = true;
match.update(TICK_DT);
assert.deepEqual(calls, ["ai:A", "ai:B", "combat:A", "combat:B"]);
calls.length = 0;
match.setAiEnabled("A", false);
match.setAiEnabled("B", false);
match.setCombatEnabled("A", false);
match.setCombatEnabled("B", false);
const tickBefore = match.tick;
match.update(TICK_DT);
assert.deepEqual(calls, []);
assert.equal(match.tick, tickBefore + 1, "禁用 AI 和常规开火不暂停对局时钟");

const tutorial = new MatchSimulation({ seed: 19, mode: "ai", tutorialMode: true });
assert.deepEqual(tutorial.combatEnabled, { A: false, B: false });
assert.deepEqual(tutorial.aiEnabled, { A: true, B: false });
assert.deepEqual(new MatchSimulation({ seed: 19 }).combatEnabled, { A: true, B: true }, "对局之间开关隔离");
console.log("对局控制校验通过：开关单写入口、只读历史、非法席位隔离与同帧席位顺序。");
