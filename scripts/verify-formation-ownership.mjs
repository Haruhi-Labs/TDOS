import assert from "node:assert/strict";
import { MatchSimulation } from "../shared/game-core.js";
import { FleetFormation } from "../shared/game/systems/fleet-formation.js";
import { createFormationPort } from "../shared/game/rules/formation-port.js";

const match = new MatchSimulation({ seed: 67 });
const team = match.teamA;
assert.throws(() => { team.splitLevel = 2; }, TypeError);
const port = createFormationPort(team);
for (const key of ["team", "match", "ships"]) assert.equal(key in port, false);
for (const key of ["team", "match", "effects", "takeDamage"]) assert.equal(key in port.primary.main, false);
team.configureFormation(2);
assert.equal(team.splitLevel, 2);
assert.throws(() => team.configureFormation(3), RangeError);

const energies = [10, 30, 60];
const primary = Object.fromEntries(["main", "sub1", "sub2"].map((key, i) => [key, {
  key, alive: true, get energy() { return energies[i]; }, maxEnergy: 100,
  spendEnergy(amount) { energies[i] -= amount; },
}]));
const formation = new FleetFormation({
  primary, extras: [], lookup: (key) => primary[key], participates: () => true,
}, {});
assert.equal(formation.spendEnergyForShip("main", 101), false);
assert.deepEqual(energies, [10, 30, 60], "不足时不得先扣一部分成员资源");
assert.equal(formation.spendEnergyForShip("main", 50), true);
assert.deepEqual(energies, [5, 15, 30]);
formation.configure(1);
assert.deepEqual(formation.fleetMembersByKey("main").map((unit) => unit.key), ["main", "sub2"]);
assert.deepEqual(formation.fleetEnergyForShip("sub1"), { current: 15, max: 100 });
console.log("编队所有权校验通过：私有分离层级、受限成员能力、资源不足原子拒绝及按原顺序分摊。");
