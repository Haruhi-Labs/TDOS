import assert from "node:assert/strict";
import { FutureFlagshipForm } from "../shared/game/future-flagship-form.js";
import { MatchSimulation } from "../shared/game-core.js";

let enabled = true;
const transitions = [];
const form = new FutureFlagshipForm({ enabled: () => enabled, transition: (result) => {
  assert.equal(form.current, result.form, "运动消费前形态必须已经生效");
  assert.throws(() => { result.speedRatio = 0; }, TypeError);
  transitions.push(result);
} });
assert.equal(form.current, null);
assert.equal(form.statMultiplier("speed"), 1);
assert.equal(form.switch(), true);
assert.deepEqual(transitions[0], { form: "A", speedRatio: 1.5, cooldownRatio: 0.5 });
assert.equal(form.damageTakenMultiplier(), 2);
assert.equal(form.switch(), true);
assert.deepEqual(transitions[1], { form: "B", speedRatio: 1 / 3, cooldownRatio: 4 });
assert.equal(form.damageTakenMultiplier(), 0.5);
assert.throws(() => { form.current = "A"; }, TypeError);
enabled = false;
assert.equal(form.switch(), false);
assert.equal(form.current, "B");
assert.equal(form.statMultiplier("speed"), 1);
assert.equal(form.damageTakenMultiplier(), 1);
assert.equal(transitions.length, 2);

const sim = new MatchSimulation({ seed: 211, teamLoadouts: { A: { main: "future1096", sub1: "asakura", sub2: "yuki" } } });
assert.throws(() => { sim.teamA.future1096Form = "B"; }, TypeError);
const ship = sim.teamA.ships.sub1;
ship.setFlightSpeed(10); ship.resetAttackCycle(8);
sim.teamA.switchFuture1096Form();
assert.equal(ship.speed, 15);
assert.equal(ship.cooldown, 4);
sim.teamA.switchFuture1096Form();
assert.equal(ship.speed, 5);
assert.equal(ship.cooldown, 16);
assert.equal(sim.teamA.serialize().future1096Form, "B");
console.log("形态生命周期校验通过：私有状态、先提交再换算、拒绝无效来源和只读兼容查询。");
