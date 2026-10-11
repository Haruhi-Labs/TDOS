import assert from "node:assert/strict";
import { MatchSimulation } from "../shared/game-core.js";

const ship = new MatchSimulation({ seed: 84 }).teamA.ships.main;
assert.equal(ship.applyResourcePlan, undefined, "不能用最终数值覆盖资源");
ship.drainHull(ship.hp / 2);
ship.spendEnergy(ship.energy);
const before = [ship.hp, ship.energy];
for (const intent of [{ hp: 1 }, { energy: 1 }, { hullRestoreRatio: NaN }, { hullCostRatio: -1 }, { energyFloorRatio: 2 }]) {
  assert.throws(() => ship.grantResources(intent), RangeError);
  assert.deepEqual([ship.hp, ship.energy], before, "无效意图不能部分提交");
}
assert.equal(ship.grantResources({ hullCostRatio: 0.5, energyFloorRatio: 1 }), false);
assert.deepEqual([ship.hp, ship.energy], before, "不能用同一次治疗支付致死消耗");
assert.equal(ship.grantResources({ hullRestoreRatio: 0.25, energyFloorRatio: 0.8 }), true);
assert.equal(ship.hp, ship.maxHp * 0.75);
assert.equal(ship.energy, ship.maxEnergy * 0.8);
ship.grantResources({ hullRestoreRatio: 1, energyRestoreRatio: 1 });
assert.equal(ship.hp, ship.maxHp);
assert.equal(ship.energy, ship.maxEnergy);
for (const method of ["restoreHull", "drainHull", "spendEnergy"]) {
  for (const amount of [-1, Infinity, NaN]) assert.throws(() => ship[method](amount), RangeError);
}
ship.retireWithoutLoss();
assert.equal(ship.grantResources({ hullRestoreRatio: 1 }), false);
assert.equal(ship.hp, 0);
console.log("资源所有权通过：比例消费、容量、失败原子性、非法覆盖与死亡拒绝");
