import assert from "node:assert/strict";
import { BeamSystem } from "../shared/game/systems/beam-system.js";
import { MatchSimulation } from "../shared/game-core.js";

const caster = { key: "来源", alive: true, attached: false, controlLocked: false, x: 10, y: 20 };
const calls = [];
let ids = 0;
const candidates = [30, 60].map((x, i) => ({ x, y: 20, radius: 2, hit: (ratio) => {
  calls.push(["命中", i, ratio]);
  if (i === 0) candidates.length = 0;
} }));
const system = new BeamSystem({
  nextId: () => ++ids, clampX: (x) => x, clampY: (y) => y,
  caster: () => ({ ...caster }), targets: () => [...candidates],
  barrierImpact: (geometry) => {
    assert.throws(() => { geometry.x2 = 0; }, TypeError, "阻挡查询不能改写光线状态");
    return null;
  },
  recordAttack: (count) => calls.push(["计数", count]), miss: () => calls.push(["未命中"]),
}, { range: 100, chargeDuration: 1.05, visualDuration: 0.26, hitRadius: 1, damageRatio: (count) => count === 2 ? 0.21 : 0.28 });
assert.equal(system.enqueue(caster, 0, 0), false);
assert.equal(ids, 0, "无效瞄准不分配实体编号");
assert.equal(system.enqueue(caster, 1, 0), true);
const inspection = system.inspect();
assert.throws(() => { inspection[0].life = 0; }, TypeError);
assert.throws(() => inspection.push({}), TypeError);
caster.controlLocked = true;
system.advance(2);
assert.equal(system.inspect()[0].life, 1.05, "禁控时蓄力不推进");
caster.controlLocked = false;
caster.x = 15;
system.advance(1.05);
assert.equal(system.inspect()[0].x1, 15, "蓄力跟随来源但保持方向");
system.resolve("敌方");
assert.deepEqual(calls, [["计数", 2], ["命中", 0, 0.21], ["命中", 1, 0.21]], "命中集合在第一份伤害之前固定");
system.resolve("敌方");
assert.equal(calls.length, 3, "表现存续不得重复结算");
const snapshot = system.serialize();
snapshot[0].life = 999;
assert.equal(system.inspect()[0].life, 0.26);
system.advance(0.26);
assert.equal(system.inspect().length, 0);
system.enqueue(caster, 1, 0);
caster.alive = false;
system.advance(1.05);
assert.equal(system.inspect().length, 0, "来源死亡后取消并清理蓄力");
assert.equal(calls.length, 3);

const match = new MatchSimulation({ seed: 731 });
match.teamA.split(1);
const ship = match.teamA.ships.sub1;
match.teamA.queueBeamDirection(ship, 1, 0);
assert.throws(() => { match.teamA.beams = []; }, TypeError, "舰队不能替换光线所有者的私有集合");
const before = JSON.stringify(match.serializeState());
match.teamA.beams; match.teamA.serialize();
assert.equal(JSON.stringify(match.serializeState()), before);
console.log("光线生命周期校验通过：私有队列、只读查询、禁控暂停、死亡取消、固定命中集合与恰好一次结算。");
