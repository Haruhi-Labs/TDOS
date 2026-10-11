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
