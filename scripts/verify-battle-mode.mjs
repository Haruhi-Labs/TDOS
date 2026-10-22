import assert from "node:assert/strict";
import { resolveBattleMode } from "../shared/game/runtime/battle-mode.js";
import { MatchSimulation } from "../shared/game-core.js";

const standard = resolveBattleMode();
assert.deepEqual(standard.aiSeats, []);
assert.equal(standard.teamNames.A, "玩家A舰队");
assert.deepEqual(resolveBattleMode({ mode: "ai" }).aiSeats, ["B"]);
assert.deepEqual(resolveBattleMode({ mode: "ai", aiSeats: [] }).aiSeats, [], "显式席位覆盖模式默认值");
assert.equal(resolveBattleMode({ mode: "pvp", aiSeats: ["A"] }).teamNames.A, "观察方AI舰队A");
const options = { teamNames: { A: "自定义" }, teamLoadouts: { B: { main: "yuki", sub1: "kyon", sub2: "haruhi" } } };
const saved = JSON.stringify(options);
const configured = resolveBattleMode(options);
assert.equal(configured.teamNames.A, "自定义");
assert.deepEqual(configured.teamLoadouts.B, options.teamLoadouts.B);
assert.equal(JSON.stringify(options), saved);
assert.ok(Object.isFrozen(standard.rules));
for (const [aAlive, bAlive, expected] of [[true, true, null], [true, false, { winnerSeat: "A" }], [false, true, { winnerSeat: "B" }], [false, false, { winnerSeat: null }]]) {
  const facts = Object.freeze({ aAlive, bAlive });
  assert.deepEqual(standard.rules.evaluateOutcome(facts), expected);
}
const training = resolveBattleMode({ mode: "ai", tutorialMode: true });
assert.equal(training.rules.evaluateOutcome, standard.rules.evaluateOutcome, "教程沿用原胜负条件");
const trace = [];
training.rules.initialize({
  worldSize: 1440,
  setTrainingDamageFloor: (...args) => trace.push(["损伤下限", ...args]),
  setCombatEnabled: (...args) => trace.push(["开火", ...args]),
  setAiEnabled: (...args) => trace.push(["AI", ...args]),
  configureTrainingFleet: (...args) => trace.push(["训练编队", ...args]),
});
assert.deepEqual(trace.slice(0, 4), [["损伤下限", "A", 0.25], ["开火", "A", false], ["开火", "B", false], ["AI", "B", false]]);
assert.equal(trace[4][1], "B");
assert.equal(trace[4][2].hp, 400);
assert.equal(trace[4][3].main.x, 1440 * 0.67);
const simulation = new MatchSimulation({ mode: "ai", tutorialMode: true, seed: 3 });
assert.equal(simulation.teamB.ships.main.maxHp, 400);
assert.equal(simulation.combatEnabled.A, false);
assert.equal(simulation.aiEnabled.B, false);
assert.equal(simulation.phase, "running");
assert.equal(simulation.tick, 0, "模式初始化不提前推进时间或判定终局");
console.log("战斗模式校验通过：选项默认值、初始化能力及顺序、纯胜负求值与权威提交隔离。");
