import assert from "node:assert/strict";
import { MatchSimulation } from "../shared/game-core.js";
import { SimulationTime } from "../shared/game/runtime/simulation-time.js";
import { ScenarioSimulation, sampleScenarioTime } from "./core-tests/scenario-simulation.mjs";

const time = new SimulationTime();
const initial = time.frame;
assert.throws(() => { initial.elapsed = 99; }, TypeError);
assert.throws(() => { time.frame = {}; }, TypeError);
assert.equal(time.advance(1), 0.05);
assert.deepEqual(time.frame, { elapsed: 0.05, tick: 1 });
assert.deepEqual(initial, { elapsed: 0, tick: 0 });
time.advance(-1);
assert.deepEqual(time.frame, { elapsed: 0.05, tick: 2 }, "零时长和被夹到零的步仍消费一个 tick");

const match = new MatchSimulation({ seed: 67 });
assert.throws(() => { match.elapsed = 100; }, TypeError);
assert.throws(() => { match.tick = 3000; }, TypeError);
assert.throws(() => sampleScenarioTime(match, { elapsed: 100 }), /不能修改权威/);
const seen = [];
match.teamA.update = (dt) => seen.push(["A", match.tick, match.elapsed, dt]);
match.teamB.update = (dt) => seen.push(["B", match.tick, match.elapsed, dt]);
match.update(1);
assert.deepEqual(seen, [["A", 1, 0.05, 0.05], ["B", 1, 0.05, 0.05]], "先提交同一份时间样本，再依次推进双方");

// 同一套战斗阶段在真实时钟与场景时间源下逐帧等价；此项不替代原始权威回放。
const options = { seed: 801, mode: "ai", aiSeats: ["A", "B"] };
const authoritative = new MatchSimulation(options);
const scenario = new ScenarioSimulation(options);
for (let tick = 0; tick < 120; tick += 1) {
  const dt = [0, -1, 1 / 30, 0.04, 1][tick % 5];
  authoritative.update(dt);
  scenario.update(dt);
  assert.equal(authoritative.tick, scenario.tick);
  assert.equal(authoritative.elapsed, scenario.elapsed);
  assert.deepEqual(authoritative.serializeState(), scenario.serializeState());
  assert.deepEqual(authoritative.statisticsSummary(), scenario.statisticsSummary());
}
const untouched = new MatchSimulation({ seed: 67 });
sampleScenarioTime(scenario, { elapsed: 90, tick: 2700 });
assert.equal(untouched.elapsed, 0, "场景采样不得修改其他模拟");
for (const ship of authoritative.teamB.getAllShips()) ship.retireWithoutLoss();
const oldTick = authoritative.tick;
authoritative.update(0);
assert.equal(authoritative.tick, oldTick + 1);
assert.equal(authoritative.phase, "finished");
const finalTime = authoritative.elapsed;
authoritative.update(0.05);
assert.equal(authoritative.tick, oldTick + 1);
assert.equal(authoritative.elapsed, finalTime);
console.log("模拟时间校验通过：私有单步推进、只读样本、先取时后执行、场景隔离和终局停步。");
