import assert from "node:assert/strict";
import { MatchSimulation, CHARACTER_ORDER } from "../shared/game-core.js";

// 九个角色轮换旗舰与副舰；重复消费能力不能推进计时或改写组件。
const roster = [...new Set([...CHARACTER_ORDER, "bunny_haruhi"])];
for (let index = 0; index < roster.length; index += 1) {
  const simulation = new MatchSimulation({ seed: 918 + index, teamLoadouts: { A: {
    main: roster[index], sub1: roster[(index + 1) % roster.length], sub2: roster[(index + 2) % roster.length],
  } } });
  const team = simulation.teamA;
  team.split(1);
  team.split(2);
  team.castFlagshipSkill();
  team.castSubSkill("sub1", { targetX: 1000, targetY: 720 });
  team.castSubSkill("sub2", { targetX: 1000, targetY: 720 });
  const before = JSON.stringify(simulation.serializeState());
  for (let repeat = 0; repeat < 3; repeat += 1) {
    for (const ship of team.getAllShips()) {
      ship.effectiveVision();
      ship.effectiveFireRate();
      ship.effectiveTurnRate();
      ship.effectiveFormationTurnRate();
      ship.routeConstraintProfile();
      simulation.rules.energyRate(ship, ship.throttle);
      simulation.rules.depletedEnergySpeedFactor(ship);
      simulation.rules.controlStopsFlight(ship);
      const profile = simulation.rules.projectileProfile(ship);
      if (profile.claw) profile.claw.burstDamage = 999;
    }
  }
  assert.equal(JSON.stringify(simulation.serializeState()), before, `${roster[index]} 的能力读取不能提交角色状态`);
}

// 替换能力即可改变普通实体消费结果，不能在实体内再次套用角色分支。
const simulation = new MatchSimulation({ seed: 917, teamLoadouts: { A: { main: "kyon", sub1: "yuki", sub2: "shamisen" } } });
const team = simulation.teamA;
const ship = team.ships.sub2;
team.split(1);
team.split(2);
ship.activateTimedEffect("catPawUntil", 10);
ship.speed = 20;
ship.energy = 0;
simulation.rules = {
  ...simulation.rules,
  effectiveVision: () => 123,
  effectiveFireRate: () => 7,
  turnRateMultiplier: (_team, formation) => formation ? 3 : 2,
  accelerationMultiplier: () => 4,
  navigationAvailable: () => false,
  controlStopsFlight: () => true,
  energyRate: () => 5,
  projectileProfile: () => ({ visualKind: "能力夹具", color: "#123456", claw: null }),
};
assert.equal(ship.effectiveVision(), 123);
assert.equal(ship.effectiveFireRate(), 7);
assert.equal(ship.effectiveTurnRate(), ship.baseTurnRate() * team.turnModifierForShip(ship) * 2);
assert.equal(ship.effectiveFormationTurnRate(), ship.baseTurnRate() * 3 * 1.28);
assert.equal(team.accelerationModifierForShip(ship), 4);
assert.equal(ship.canControl(), false);
ship.applyControlSpeedLimit();
assert.equal(ship.speed, 0);
team.updateEnergy(2);
assert.equal(ship.energy, 10);
ship.cooldown = 0;
ship.angle = Math.PI / 2;
ship.x = 600; ship.y = 600;
const target = simulation.teamB.ships.main;
target.x = 650; target.y = 600;
team.pickTargetFor = () => target;
ship.tryAttack(simulation, simulation.teamB);
assert.equal(simulation.projectiles.length, 1);
assert.equal(simulation.projectiles[0].visualKind, "能力夹具");
assert.equal(simulation.projectiles[0].color, "#123456");
assert.equal(simulation.projectiles[0].claw, null, "实体不得把三味线内部状态重新拼入弹体");
console.log("角色能力边界校验通过：九角色重复读取无副作用，基础移动、属性、回能和射击消费可替换契约。");

// 角色命中扩展发生在基础承伤之后、通用火花之前。
const { Projectile } = await import("../shared/game/model/projectile.js");
const hits = new MatchSimulation({ seed: 120 });
const attacker = hits.teamA.ships.main;
const victim = hits.teamB.ships.main;
hits.teamB.split(1); hits.teamB.split(2);
const order = [];
const oldDamage = victim.takeDamage.bind(victim);
victim.takeDamage = (...args) => { order.push("基础伤害"); return oldDamage(...args); };
hits.spawnBurst = () => order.push("火花");
hits.shipEffects = { ...hits.shipEffects, onProjectileHit: (projectile, target) => {
  assert.equal(target, victim);
  assert.ok(target.hp < target.maxHp, "扩展效果应观察同帧基础承伤后的状态");
  order.push("命中扩展");
} };
const shot = new Projectile({ team: hits.teamA, source: attacker, x: victim.x, y: victim.y, targetX: victim.x, targetY: victim.y, damage: 1 });
shot.resolveImpact(hits);
assert.deepEqual(order, ["基础伤害", "命中扩展", "火花"]);

// 实体生命周期允许替换角色处理器；只读投影不得隐式推进任何处理阶段。
const phases = [];
hits.shipEffects = { ...hits.shipEffects,
  expireMarks: () => phases.push("到期"),
  advanceMovement: () => { phases.push("专属移动"); return true; },
  clearControl: () => phases.push("控制清理"),
  clearPositive: () => { phases.push("增益清理"); return true; },
};
victim.update(0);
assert.deepEqual(phases, ["到期", "专属移动"]);
victim.clearControlEffects();
assert.equal(victim.clearActiveSkillBuffs(), true);
assert.deepEqual(phases, ["到期", "专属移动", "控制清理", "增益清理"]);
victim.serialize(); victim.serialize();
assert.equal(phases.length, 4);
console.log("角色生命周期边界校验通过：专属移动、清理与命中同步扩展，投影只读且不推进阶段。");

// 侦察机只在生成时采样能力；转队不改机体，也不重复消费生成随机数。
const { Scout } = await import("../shared/game/model/scout.js");
const aircraft = new MatchSimulation({ seed: 872 });
aircraft.rules = { ...aircraft.rules, scoutProfile: () => ({
  combatCapable: true, vision: 111, attackRange: 222, damage: 33, fireRate: 4,
}) };
const scout = new Scout(aircraft.teamA, 100, 100);
aircraft.teamA.addScout(scout);
const capabilities = [scout.combatCapable, scout.vision, scout.attackRange, scout.damage, scout.fireRate];
assert.deepEqual(capabilities, [true, 111, 222, 33, 4]);
aircraft.rules = { ...aircraft.rules, scoutProfile: () => { throw new Error("转队不能重新装配机体"); } };
scout.transferToTeam(aircraft.teamB, aircraft.zoneById(5));
assert.deepEqual([scout.combatCapable, scout.vision, scout.attackRange, scout.damage, scout.fireRate], capabilities);

// 专属变身与公共技能均提交到同一个舰队完成入口，拒绝时不应重复扣费或记录。
const transformation = new MatchSimulation({ seed: 121, teamLoadouts: { A: { main: "yuki", sub1: "bunny_haruhi", sub2: "kyon" } } });
const casters = transformation.teamA;
casters.split(1); casters.split(2);
const completions = [];
const complete = casters.completeSubSkillCast.bind(casters);
casters.completeSubSkillCast = (caster, cooldown) => {
  completions.push([caster.key, cooldown]);
  complete(caster, cooldown);
};
assert.equal(casters.castSubSkill("sub1"), true);
assert.equal(casters.castSubSkill("sub1"), false);
assert.equal(casters.castSubSkill("sub2", { zoneId: 5 }), true);
assert.deepEqual(completions.map(([key]) => key), ["sub1", "sub2"]);
assert.equal(casters.cooldowns.sub1, completions[0][1]);
assert.equal(casters.cooldowns.sub2, completions[1][1]);
console.log("角色创建与施放边界校验通过：机体能力在出生采样，技能成功统一由舰队提交且拒绝不重复消费。");

// 屏障只处理碰撞和自身状态；新的冲撞能力不要求在屏障模块加入角色分支。
const { koizumiBarrierGeometry } = await import("../shared/game/koizumi-barrier.js");
const barrier = new MatchSimulation({ seed: 331, teamLoadouts: { B: { main: "koizumi", sub1: "yuki", sub2: "kyon" } } });
const defender = barrier.teamB.ships.main;
const rammer = barrier.teamA.ships.main;
const radius = koizumiBarrierGeometry(barrier.teamB).radius;
defender.previousX = defender.x; defender.previousY = defender.y;
rammer.x = defender.x + radius - 1; rammer.y = defender.y;
rammer.previousX = defender.x + radius + 10; rammer.previousY = defender.y;
barrier.rules = { ...barrier.rules, barrierRamProfile: (source) => source === rammer ? { ramKind: "测试冲撞", extraRadius: 0 } : null };
const attempts = [];
let accepted = false;
barrier.shipEffects = { ...barrier.shipEffects, consumeBarrierRam: (source, team, kind) => {
  attempts.push(kind); assert.equal(source, rammer); assert.equal(team, barrier.teamA); return accepted;
} };
barrier.resolveKoizumiBarrierRamContacts();
assert.equal(barrier.teamB.koizumiBarrier.remainingHits, 15, "未成功消费冲撞能力不能破盾");
accepted = true;
barrier.resolveKoizumiBarrierRamContacts();
assert.equal(barrier.teamB.koizumiBarrier.remainingHits, 0);
assert.deepEqual(attempts, ["测试冲撞", "测试冲撞"]);
console.log("跨角色交互边界校验通过：护盾仅消费冲撞描述及成功提交结果，无需识别攻击方角色。");
