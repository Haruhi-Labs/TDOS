import assert from "node:assert/strict";
import { FleetPerception } from "../shared/game/systems/visibility.js";
import { FleetFireControl } from "../shared/game/systems/targeting-system.js";
import { MatchSimulation } from "../shared/game-core.js";

const perception = new FleetPerception();
const input = {
  sensors: [{ x: 0, y: 0, range: 10 }],
  entities: [{ id: 1, x: 5, y: 0 }, { id: 2, x: 15, y: 0 }, { id: 3, x: 25, y: 0 }],
  coveredByWave: (entity) => entity.id === 2,
  broadcast: [{ id: 4 }],
};
perception.sample(input);
const sampled = perception.visibleIds;
assert.deepEqual([...sampled], [1, 2, 4]);
assert.equal(sampled.add, undefined);
assert.equal(sampled.clear, undefined);
assert.throws(() => { sampled.has = () => true; }, TypeError);
input.entities[0].id = 99;
assert.equal(sampled.has(99), false);
perception.sample({ ...input, sensors: [], coveredByWave: () => false, broadcast: [] });
assert.equal(perception.visibleIds.size, 0);
assert.deepEqual([...sampled], [1, 2, 4], "旧感知视图必须保留旧采样");

const control = new FleetFireControl();
const candidates = [
  { target: { id: 1, hp: 10, maxHp: 100 }, arc: 1, dist: 20 },
  { target: { id: 2, hp: 20, maxHp: 100 }, arc: 1, dist: 10 },
];
control.prepare([{ id: 9, budget: 15, candidates }, { id: 8, budget: 15, candidates }], 0.5);
const options = { focusLowHp: true, focusHpFrac: 0.5 };
assert.equal(control.pick(9, candidates, options), 1);
assert.equal(control.pick(8, candidates, options), 2, "齐射不能把所有预算压在同一残血目标上");
assert.equal(control.pick(9, candidates.slice(1), options), 2, "前一发击沉后必须按实时候选重新选择");
assert.equal(control.pick(8, candidates, { ...options, huntTargetId: 1 }), 1);
control.prepare([], 0.5);
assert.equal(control.pick(8, candidates, options), 1, "新齐射必须丢弃旧分配");

const match = new MatchSimulation({ seed: 913 });
assert.throws(() => { match.teamA.visibleEnemyIds = new Set(); }, TypeError);
assert.equal(match.teamA._focusTargets, undefined);
const ids = match.teamA.visibleEnemyIds;
match.teamA.computeVisibility(match.teamB);
assert.notEqual(match.teamA.visibleEnemyIds, ids);
console.log("感知与火控所有权校验通过：只读采样、历史隔离、预算分配、失效目标和猎杀优先级。");
