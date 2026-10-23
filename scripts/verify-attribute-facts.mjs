import assert from "node:assert/strict";
import { MatchSimulation } from "../shared/game-core.js";
import { sampleAttributeFacts, sampleControlFacts, sampleImmunityFacts, sampleDamageFacts } from "../shared/game/characters/abilities/attribute-facts.js";
import { evaluateAttribute, evaluateControl, evaluateDamageTaken } from "../shared/game/characters/abilities/attribute-evaluation.js";
import { compileTimedAttributes } from "../shared/game/characters/assembly/extension-contract.js";
import { CHARACTER_EXTENSIONS } from "../shared/game/characters/assembly/registry.js";

const timedAttributes = compileTimedAttributes(CHARACTER_EXTENSIONS);

const match = new MatchSimulation({ seed: 944, teamLoadouts: { A: { main: "future1096", sub1: "bunny_haruhi", sub2: "asakura" } } });
const ship = match.teamA.ships.sub2;
function assertFacts(value) {
  if (!value || typeof value !== "object") { assert.notEqual(typeof value, "function"); return; }
  assert.equal(Object.isFrozen(value), true);
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  assert.equal(value.team, undefined);
  assert.equal(value.match, undefined);
  for (const item of Object.values(value)) assertFacts(item);
}
const before = sampleAttributeFacts(ship);
assertFacts(before);
const original = evaluateAttribute(before, "speed", ship.base.speed, timedAttributes);
match.teamA.switchFuture1096Form();
const after = sampleAttributeFacts(ship);
assert.equal(evaluateAttribute(after, "speed", ship.base.speed, timedAttributes), original * 1.5, "同帧变身立即改变新事实");
assert.equal(evaluateAttribute(before, "speed", ship.base.speed, timedAttributes), original, "历史事实不追随角色变化");
ship.activateTimedEffect("bladeQueenUntil", 10);
ship.stunUntil(5);
const controlled = sampleAttributeFacts(ship);
assertFacts(controlled);
assert.equal(evaluateControl(controlled).locked, true);
ship.clearControlEffects();
assert.equal(evaluateControl(sampleAttributeFacts(ship)).locked, false, "同帧净化不能读到旧缓存");
assert.equal(evaluateControl(controlled).locked, true);
assert.equal(evaluateDamageTaken(after), 2);
console.log("属性事实校验通过：无实体和回调、深只读、历史稳定、同帧变身与净化即时可见。");

for (const sample of [sampleControlFacts, sampleImmunityFacts, sampleDamageFacts]) assertFacts(sample(ship));
assert.equal(sampleControlFacts(ship).futureForm, undefined, "控制判断不需要队级形态上下文");
assert.equal(sampleImmunityFacts(ship).effects, undefined, "免伤不读取不相关定时效果");
assert.equal(sampleDamageFacts(ship).reliable, undefined, "承伤不采样进攻属性加成");
assert.equal(evaluateControl(sampleControlFacts(ship)).locked, false);
assert.equal(evaluateDamageTaken(sampleDamageFacts(ship)), evaluateDamageTaken(sampleAttributeFacts(ship)));

// 真实状态所有者发布截止时刻；求值保持旧倍率顺序，净化在同帧后续查询可见。
ship.activateTimedEffect("reliableUntil", 10);
const stacked = sampleAttributeFacts(ship);
const expected = ((ship.base.speed * 1.08) * 1.45) * 1.5;
assert.equal(ship.statWithBuffs("speed", ship.base.speed), expected);
assert.equal(evaluateAttribute(stacked, "speed", ship.base.speed, timedAttributes), expected);
ship.clearActiveSkillBuffs();
assert.equal(ship.statWithBuffs("speed", ship.base.speed), expected, "当帧激活仍保留净化保护");
ship.clearActiveSkillBuffs({ preserveCurrentTick: false });
assert.equal(ship.statWithBuffs("speed", ship.base.speed), ship.base.speed * 1.5);
assert.equal(evaluateAttribute(stacked, "speed", ship.base.speed, timedAttributes), expected, "净化不能修改历史事实与声明");

const multiplier = { damage: 1.25 };
const custom = compileTimedAttributes([{ timedAttributes: [[30, { until: "bonusUntil", multipliers: multiplier }]] }]);
multiplier.damage = 99;
const customFacts = Object.freeze({ ...before, effects: Object.freeze({ bonusUntil: before.now + 1 }) });
assert.equal(evaluateAttribute(customFacts, "damage", 40, custom), 50, "新增普通定时属性不需要中央角色分支");
assert.equal(evaluateAttribute({ ...customFacts, now: before.now + 1 }, "damage", 40, custom), 40, "截止帧立即恢复原属性");
assert.ok(Object.isFrozen(custom[0].multipliers));
assert.throws(() => compileTimedAttributes([{ timedAttributes: [[1, { until: "x", multipliers: {} }], [1, { until: "y", multipliers: {} }]] }]), /顺序冲突/);
assert.throws(() => compileTimedAttributes([{ timedAttributes: [[1, { until: "x", multipliers: { damage: () => 1 } }]] }]), /无效/);
assert.throws(() => compileTimedAttributes([{ timedAttributes: [[1, { until: "x", multipliers: { typo: 2 } }]] }]), /无效/);
