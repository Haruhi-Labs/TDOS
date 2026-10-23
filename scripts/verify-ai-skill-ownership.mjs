import assert from "node:assert/strict";
import { SkillDecisionCycle } from "../shared/game/ai/policy/state/skill-decision-cycle.js";
import { resolveAiParams } from "../shared/game/ai/params/index.js";
import { MatchSimulation } from "../shared/game-core.js";

const params = resolveAiParams();
const cycle = new SkillDecisionCycle({ flagship: 0, sub1: 0, sub2: 0, now: 0 });
const target = { id: 1, detail: { x: 10 } };
let casts = 0;
let cooldown = 0;
const actions = {
  shouldCast: () => true,
  cast: () => { casts += 1; cooldown = 7; return true; },
  cooldown: () => cooldown,
  randomRange: (min) => min,
  describeTarget: () => target,
};
cycle.tryFlagship({ T: params.skills.flagshipTimers, now: 1, characterId: "haruhi" }, actions);
assert.equal(casts, 1);
assert.equal(cycle.timers.flagship, 7, "成功后读取新冷却，不能使用施放前的零值");
const history = cycle.decisions;
target.detail.x = 90;
assert.equal(cycle.decisions.flagship.target.detail.x, 10, "端口返回数据不得成为私有状态的可写别名");
assert.throws(() => { cycle.timers.sub1 = 0; }, TypeError);
assert.throws(() => { history.flagship.target.detail.x = 3; }, TypeError);
cycle.advance(7);
assert.equal(cycle.timers.flagship, 0);
assert.throws(() => cycle.schedule("main", 0), /合法技能槽/);
const result = cycle.trySub({ T: params.skills.subTimers, now: 8, shipKey: "sub1",
  ship: { alive: true, attached: false, characterId: "kyon" },
  context: { barrierTactics: { enemy: { active: true }, breachShipKey: "sub1" } },
}, actions);
assert.equal(result, true, "破盾只返回重规划结果，由上层消费");
assert.equal(history.sub1.action, "idle", "组件推进不改变已发布历史");
const unavailable = cycle.trySub({ T: params.skills.subTimers, now: 9, shipKey: "sub2", ship: null }, actions);
assert.equal(unavailable, undefined);
assert.equal(casts, 2, "不可用槽位不能触发施放");
assert.equal(cycle.decisions.sub2.action, "unavailable");
const bot = new MatchSimulation({ mode: "ai", seed: 891 }).botBySeat("B");
assert.throws(() => { bot.flagshipTimer = 0; }, TypeError);
assert.throws(() => { bot.subTimers.sub1 = 0; }, TypeError);
bot.scheduleSkillDecision("sub1", 3);
assert.equal(bot.subTimers.sub1, 3);
console.log("AI 技能所有权校验通过：私有计时、决策输入隔离、历史不可变、施放后冷却和破盾结果消费。");
