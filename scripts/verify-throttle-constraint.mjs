import { ScenarioSimulation, sampleScenarioTime } from "./core-tests/scenario-simulation.mjs";
import { setScenarioField } from './core-tests/ship-fixture.mjs';
import assert from "node:assert/strict";


const sim = new ScenarioSimulation({ seed: 197, teamLoadouts: { A: { main: "kyon", sub1: "bunny_haruhi", sub2: "yuki" } } });
const ordinary = sim.teamA.ships.main;
assert.throws(() => { ordinary.throttle = 0.7; }, TypeError,
  "基础档位只能通过领域操作修改");
setScenarioField(ordinary, 'throttle', 0.7);
let enabled = false;
ordinary.configureThrottleConstraint((value) => enabled ? 1.4 : value);
assert.equal(ordinary.throttle, 0.7);
enabled = true;
assert.equal(ordinary.throttle, 1.4, "条件变化后的读取即时应用约束");
enabled = false;
assert.equal(ordinary.throttle, 0.7, "仅读取不能改写存储值");
enabled = true;
ordinary.navigateTo({ x: 500, y: 500 }, 0);
enabled = false;
assert.equal(ordinary.throttle, 1.4, "导航写入必须将约束后的值落入存储");
ordinary.setThrottle(0.68);
assert.equal(ordinary.throttle, 0.7, "普通操作仍保留离散档位归一化");
ordinary.setThrottle(NaN);
assert.equal(ordinary.throttle, 0.7, "非法档位仍回退当前值");

sim.teamA.split(1);
const bunny = sim.teamA.ships.sub1;
for (let cast = 0; cast < 4; cast += 1) {
  sim.teamA.startCooldown("sub1", 0);
  bunny.restoreHull(bunny.maxHp);
  assert.equal(sim.teamA.castSubSkill("sub1"), true);
}
assert.equal(bunny.bunnyHaruhi.form, "encore");
setScenarioField(bunny, 'throttle', 0);
assert.equal(bunny.throttle, 1.4);
sim.teamA.setRestrictions({ skills: true });
bunny.setThrottle(0.4);
assert.equal(bunny.throttle, 0.4);
sim.teamA.setRestrictions({ skills: false });
assert.equal(bunny.throttle, 1.4, "封印解除后锁档无需额外推进便重新生效");
sampleScenarioTime(sim, { elapsed: bunny.bunnyHaruhi.formStartedAt + 10 });
assert.equal(bunny.throttle, 0.4, "到期恢复未被读取改写的封印期间档位");
bunny.navigateTo({ x: 600, y: 600 }, 0.7);
assert.equal(bunny.throttle, 0.7);
console.log("油门约束校验通过：所有者存储、即时读取、写入落值、导航与归一化、封印和精确到期。");
