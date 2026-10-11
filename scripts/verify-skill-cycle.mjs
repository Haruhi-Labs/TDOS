import assert from "node:assert/strict";
import { SkillCycle } from "../shared/game/systems/skill-cycle.js";
import { MatchSimulation } from "../shared/game-core.js";

const calls = [];
let succeed = false;
const cycle = new SkillCycle({
  exclusive: () => null,
  caster: () => ({ alive: true, isAttached: () => false, canControl: () => true,
    isSilenced: () => false, exclusiveMovement: () => false }),
  disabled: () => false, metadata: () => ({ type: "active", cost: 20, cooldown: 10 }),
  spendEnergy: () => { calls.push("扣费"); return true; },
  executeSub: () => { calls.push("执行"); return succeed; },
  record: () => calls.push("统计"), reveal: () => calls.push("显形"),
});
assert.equal(cycle.castSub("sub1", {}), false);
assert.deepEqual(calls, ["扣费", "执行"]);
assert.equal(cycle.cooldowns.sub1, 0, "失败不得提交成功冷却或统计");
calls.length = 0;
succeed = true;
assert.equal(cycle.castSub("sub1", {}), true);
assert.deepEqual(calls, ["扣费", "执行", "统计", "显形"]);
const snapshot = cycle.cooldowns;
assert.throws(() => { snapshot.sub1 = 0; }, TypeError);
cycle.advance(3);
assert.equal(snapshot.sub1, 10);
assert.equal(cycle.cooldowns.sub1, 7);
calls.length = 0;
assert.equal(cycle.castSub("sub1", {}), false);
assert.deepEqual(calls, [], "冷却拒绝不得触发扣费或效果");
const team = new MatchSimulation({ seed: 22 }).teamA;
assert.throws(() => { team.cooldowns = {}; }, TypeError);
assert.throws(() => { team.cooldowns.scout = 90; }, TypeError);
console.log("施放周期校验通过：冷却只读、失败不提交、扣费与效果及成功消费顺序一致。");

const exclusiveCalls = [];
const exclusiveCycle = new SkillCycle({
  exclusive: () => { exclusiveCalls.push("专属效果"); return { cooldown: 12, refreshVisibility: true }; },
  record: () => { assert.equal(exclusiveCycle.cooldowns.sub1, 12); exclusiveCalls.push("统计"); },
  reveal: () => exclusiveCalls.push("显形"),
  refreshVisibility: () => exclusiveCalls.push("刷新视野"),
});
assert.equal(exclusiveCycle.castSub("sub1", {}), true);
assert.deepEqual(exclusiveCalls, ["专属效果", "统计", "显形", "刷新视野"]);
assert.equal(team.completeSubSkillCast, undefined, "外部不能伪造施放完成");
