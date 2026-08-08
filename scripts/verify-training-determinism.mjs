import assert from "node:assert/strict";

import {
  DEFAULT_AI_LOADOUT,
  DEFAULT_TEAM_LOADOUT,
  MatchSimulation,
  TICK_DT,
} from "../shared/game-core.js";

function createSimulation(randomSeed) {
  return new MatchSimulation({
    mode: "pvp",
    aiSeats: "all",
    aiDifficulty: "master",
    randomSeed,
    teamLoadouts: {
      A: DEFAULT_TEAM_LOADOUT,
      B: DEFAULT_AI_LOADOUT,
    },
  });
}

const originalRandom = Math.random;
const first = createSimulation(0x5a17);
const unrelated = createSimulation(0x1096);
const replay = createSimulation(0x5a17);

assert.deepEqual(
  first.serializeState(),
  replay.serializeState(),
  "相同种子的初始状态必须完全一致",
);

let unrelatedDiverged = false;
for (let tick = 0; tick < 900; tick += 1) {
  first.update(TICK_DT);
  unrelated.update(TICK_DT);
  replay.update(TICK_DT);

  const firstState = first.serializeState();
  const replayState = replay.serializeState();
  assert.deepEqual(firstState, replayState, `相同种子在第 ${tick + 1} tick 发生漂移`);
  if (!unrelatedDiverged && JSON.stringify(firstState) !== JSON.stringify(unrelated.serializeState())) {
    unrelatedDiverged = true;
  }
}

assert.equal(unrelatedDiverged, true, "不同种子应产生不同的战斗轨迹");
assert.equal(Math.random, originalRandom, "模拟不得替换进程级 Math.random");

console.log("训练确定性校验通过：独立环境可交错推进，同种子逐 tick 一致且不同种子能够分化。");
