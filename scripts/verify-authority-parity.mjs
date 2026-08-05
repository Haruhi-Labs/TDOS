import assert from "node:assert/strict";
import {
  DEFAULT_WORLD_SIZE,
  MatchSimulation,
  TICK_DT,
  __resetEntityIds,
} from "../shared/game-core.js";
import { createFixedStepClock } from "../shared/game/fixed-step-clock.js";
import { matchActions } from "../shared/protocol/match-actions.js";
import { createInputQueue } from "../server/input-queue.js";

const LOADOUTS = {
  A: { main: "kyon", sub1: "asakura", sub2: "future1096" },
  B: { main: "koizumi", sub1: "tsuruya", sub2: "haruhi" },
};

const ORIGINAL_RANDOM = Math.random;
let randomSeed = 0;

function resetRandomSeed() {
  randomSeed = 0x1096cafe;
}

function deterministicRandom() {
  randomSeed = (Math.imul(randomSeed, 1664525) + 1013904223) >>> 0;
  return randomSeed / 0x100000000;
}

const ACTIONS_BY_TICK = new Map([
  [0, [
    ["A", matchActions.setThrottle({ shipKey: "main", throttle: 1.4 })],
    ["A", matchActions.setThrottle({ shipKey: "main", throttle: 0.7 })],
    ["B", matchActions.setThrottle({ shipKey: "main", throttle: 1 })],
  ]],
  [1, [
    ["A", matchActions.setRoute({ shipKey: "main", endX: 430, endY: 520, throttle: 0.7, anchorToMain: true })],
    ["B", matchActions.setRoute({ shipKey: "main", endX: 1010, endY: 920, throttle: 1, anchorToMain: true })],
  ]],
  [3, [["A", matchActions.split(1)], ["B", matchActions.split(1)]]],
  [4, [
    ["A", matchActions.setRoute({ shipKey: "sub1", endX: 380, endY: 820, throttle: 1 })],
    ["B", matchActions.setRoute({ shipKey: "sub1", endX: 1060, endY: 620, throttle: 1 })],
  ]],
  [5, [
    ["A", matchActions.launchScout({ shipKey: "main", zoneId: 4 })],
    ["B", matchActions.launchScout({ shipKey: "main", zoneId: 6 })],
  ]],
  [8, [
    ["A", matchActions.configureAutoScout({ enabled: true, zoneId: 1 })],
    ["B", matchActions.configureAutoScout({ enabled: true, zoneId: 9 })],
  ]],
  [10, [["A", matchActions.emergencyBrake("main")]]],
  [15, [["A", matchActions.routeControl({ shipKey: "sub1", controlX: 310, controlY: 760 })]]],
  [16, [["A", matchActions.routeEnd({ shipKey: "sub1", endX: 400, endY: 860 })]]],
  [20, [["A", matchActions.split(2)], ["B", matchActions.split(2)]]],
  [21, [
    ["A", matchActions.setRoute({ shipKey: "sub2", endX: 520, endY: 1020, throttle: 1.4 })],
    ["B", matchActions.setRoute({ shipKey: "sub2", endX: 920, endY: 420, throttle: 1.4 })],
  ]],
  [35, [["A", matchActions.clearRoute({ shipKey: "sub1" })]]],
]);

function createSimulation() {
  resetRandomSeed();
  __resetEntityIds();
  return new MatchSimulation({
    mode: "pvp",
    worldSize: DEFAULT_WORLD_SIZE,
    teamLoadouts: LOADOUTS,
  });
}

function replayDirect(tickCount) {
  const simulation = createSimulation();
  const states = [];
  for (let tick = 0; tick < tickCount; tick += 1) {
    for (const [seat, action] of ACTIONS_BY_TICK.get(tick) || []) {
      simulation.applyActionForSeat(seat, action);
    }
    simulation.update(TICK_DT);
    states.push(JSON.stringify(simulation.serializeState()));
  }
  return states;
}

function replayThroughServerQueue(tickCount) {
  const simulation = createSimulation();
  const inputQueue = createInputQueue({ networkStats: { coalescedInputs: 0 } });
  const players = new Map([
    ["player-a", { id: "player-a", inputQueue: [], lastProcessedSeq: 0, lastQueuedSeq: 0 }],
    ["player-b", { id: "player-b", inputQueue: [], lastProcessedSeq: 0, lastQueuedSeq: 0 }],
  ]);
  const sequences = { A: 0, B: 0 };
  const room = {
    seats: { A: "player-a", B: "player-b" },
    match: simulation,
  };
  const states = [];
  for (let tick = 0; tick < tickCount; tick += 1) {
    for (const [seat, action] of ACTIONS_BY_TICK.get(tick) || []) {
      sequences[seat] += 1;
      inputQueue.queueInput(players.get(room.seats[seat]), { seq: sequences[seat], action });
    }
    inputQueue.applyQueuedInputs(room, (playerId) => players.get(playerId) || null);
    simulation.update(TICK_DT);
    states.push(JSON.stringify(simulation.serializeState()));
  }
  return states;
}

Math.random = deterministicRandom;
try {
  const directStates = replayDirect(90);
  const queuedStates = replayThroughServerQueue(90);
  assert.equal(directStates.length, queuedStates.length);
  for (let tick = 0; tick < directStates.length; tick += 1) {
    assert.equal(
      queuedStates[tick],
      directStates[tick],
      `单人直连与服务端输入队列在第 ${tick + 1} 个权威 tick 出现状态差异`,
    );
  }
} finally {
  Math.random = ORIGINAL_RANDOM;
}

const clockSteps = [];
const clock = createFixedStepClock({
  stepSeconds: 0.1,
  maxCatchupSteps: 2,
  initialTimeMs: 0,
});
assert.equal(clock.advance(50, (step) => clockSteps.push(step)), 0, "不足一个逻辑帧时不得提前更新");
assert.equal(clock.advance(100, (step) => clockSteps.push(step)), 1, "累计到逻辑帧边界时应更新一次");
assert.equal(clock.advance(1000, (step) => clockSteps.push(step)), 2, "长帧追赶必须受统一上限保护");
assert.equal(clock.getAccumulatorSeconds(), 0, "触发追帧上限后应丢弃过期积压");
assert.equal(clock.advance(1100, (step) => clockSteps.push(step), { active: false }), 0, "暂停状态不得推进逻辑");
assert.equal(clock.advance(1200, (step) => clockSteps.push(step)), 1, "恢复后不得补算暂停期间时间");
assert.deepEqual(clockSteps, [0.1, 0.1, 0.1, 0.1], "固定逻辑时钟传入的步长必须恒定");

console.log("权威一致性校验通过：90 个 tick 的本地直连与服务端队列状态逐帧一致，固定时钟行为稳定。");
