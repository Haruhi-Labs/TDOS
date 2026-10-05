import assert from "node:assert/strict";
import { MatchSimulation, TICK_DT } from "../../shared/game-core.js";
import { randomInRange } from "../../shared/game/math.js";
import { createAmbientRng, createSeededRng, rngFor } from "../../shared/game/rng.js";
import { withSeededRandom } from "./helpers.mjs";

function take(rng, count) {
  return Array.from({ length: count }, () => rng.next());
}

function rngUnitCheck() {
  assert.deepEqual(take(createSeededRng(7), 32), take(createSeededRng(7), 32), "相同种子必须产生相同序列");
  assert.notDeepEqual(take(createSeededRng(7), 32), take(createSeededRng(8), 32), "不同种子不应产生相同序列");
  for (const value of take(createSeededRng(0), 256)) {
    assert.ok(value >= 0 && value < 1, "随机值必须落在 [0, 1)");
  }

  const parent = createSeededRng(42);
  const untouched = take(createSeededRng(42), 8);
  const child = parent.fork("ai:A");
  take(child, 100);
  assert.deepEqual(take(parent, 8), untouched, "子流取值不得消耗主流");
  take(parent, 50);
  assert.deepEqual(take(parent.fork("ai:A"), 8), take(createSeededRng(42).fork("ai:A"), 8), "子流不得受主流已取次数影响");
  assert.notDeepEqual(take(parent.fork("ai:A"), 8), take(parent.fork("ai:B"), 8), "不同标签的子流必须相互独立");

  const ambient = createAmbientRng();
  assert.equal(ambient.fork("ai:A"), ambient, "环境模式只有一条全局序列，派生必须返回自身");
  assert.equal(rngFor(null).seed, null, "缺少对局时退回环境随机源");
  // 环境随机源在取值时才读取 Math.random，因此测试里对全局随机源的替换即时生效；
  // range 与 randomInRange 在同一底层序列上逐位相同。
  const viaHelper = withSeededRandom(99, () => [randomInRange(-3, 11), randomInRange(0.8, 1.4), Math.random()]);
  const viaRng = withSeededRandom(99, () => [ambient.range(-3, 11), ambient.range(0.8, 1.4), ambient.next()]);
  assert.deepEqual(viaRng, viaHelper, "环境随机源必须与全局 Math.random 的取值顺序和算式一致");
}

const LOADOUTS = {
  A: { main: "yuki", sub1: "koizumi", sub2: "shamisen" },
  B: { main: "haruhi", sub1: "future1096", sub2: "asakura" },
};

function runSeeded(seed, ticks) {
  const simulation = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    aiSeats: ["A", "B"],
    teamLoadouts: LOADOUTS,
    seed,
  });
  const states = [];
  for (let tick = 0; tick < ticks; tick += 1) {
    simulation.update(TICK_DT);
    states.push(JSON.stringify(simulation.serializeState()));
  }
  return states;
}

function seededMatchCheck() {
  // 不替换 Math.random，也不重置全局实体 ID；带种子的对局必须自行复现。
  const first = runSeeded(20261004, 600);
  runSeeded(1, 45); // 中间穿插无关对局，证明没有跨对局状态
  new MatchSimulation({ mode: "ai", worldSize: 1440 }).update(TICK_DT);
  const second = runSeeded(20261004, 600);
  for (let tick = 0; tick < first.length; tick += 1) {
    assert.equal(second[tick], first[tick], `相同种子的对局在第 ${tick + 1} tick 出现差异`);
  }
  assert.notEqual(runSeeded(20261005, 600).at(-1), first.at(-1), "不同种子的对局不应得到相同终态");
  assert.equal(Object.hasOwn(JSON.parse(first[0]), "seed"), false, "种子不得进入对局快照");

  // 带种子的对局不消费全局随机序列。
  const globalDraws = withSeededRandom(5, () => {
    runSeeded(3, 120);
    return Math.random();
  });
  assert.equal(globalDraws, withSeededRandom(5, () => Math.random()), "带种子的对局不得消耗全局 Math.random");
}

export function runRngSuite() {
  rngUnitCheck();
  seededMatchCheck();
}
