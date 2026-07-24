import assert from "node:assert/strict";
import {
  MatchSimulation,
  TICK_DT,
} from "../shared/game-core.js";
import {
  applyStatePatch,
  createStatePatch,
} from "../shared/network-patch.js";

function jsonRoundTrip(value) {
  return JSON.parse(JSON.stringify(value));
}

function basicStructureCheck() {
  const previous = {
    stable: { value: 1 },
    removed: true,
    list: [
      { id: 1, x: 10, nested: { hp: 5 } },
      { id: 2, x: 20, nested: { hp: 6 } },
    ],
    plain: [1, 2, 3],
  };
  const next = {
    stable: { value: 1 },
    added: "新字段",
    list: [
      { id: 2, x: 21, nested: { hp: 6 } },
      { id: 3, x: 30, nested: { hp: 7 } },
    ],
    plain: [1, 4],
  };
  const patch = jsonRoundTrip(createStatePatch(previous, next));
  const restored = applyStatePatch(previous, patch);
  assert.deepEqual(restored, next, "对象增删、普通数组或实体数组的差量还原不正确");
  assert.equal(restored.stable, previous.stable, "未变化分支没有复用旧对象");
}

function noChangeCheck() {
  const state = { value: 1, rows: [{ id: "a", x: 2 }] };
  assert.equal(createStatePatch(state, state), null, "完全相同状态应返回空差量");
  assert.equal(applyStatePatch(state, null), state, "空差量应直接复用上一帧");
}

function malformedPatchCheck() {
  assert.throws(
    () => applyStatePatch({}, ["未知类型"]),
    /格式错误/,
    "错误差量未被拒绝",
  );
  assert.throws(
    () => applyStatePatch([], [1, 1, { 2: [2, "越界"] }]),
    /下标越界/,
    "越界数组差量未被拒绝",
  );
}

function createNetworkState(simulation) {
  const state = simulation.serializeState();
  delete state.bots;
  return {
    ...state,
    selectedShips: {
      A: "main",
      B: "main",
    },
  };
}

function battleSequenceCheck() {
  const simulation = new MatchSimulation({ mode: "pvp", worldSize: 1440 });
  simulation.applyActionForSeat("A", {
    type: "set_route",
    shipKey: "main",
    endX: 680,
    endY: 720,
    throttle: 1.4,
  });
  simulation.applyActionForSeat("B", {
    type: "set_route",
    shipKey: "main",
    endX: 760,
    endY: 720,
    throttle: 1.4,
  });
  simulation.applyActionForSeat("A", {
    type: "configure_auto_scout",
    enabled: true,
    zoneId: 5,
  });
  simulation.applyActionForSeat("B", {
    type: "configure_auto_scout",
    enabled: true,
    zoneId: 5,
  });

  let previous = createNetworkState(simulation);
  let fullBytes = 0;
  let patchBytes = 0;
  let patchCount = 0;

  for (let tick = 0; tick < 30 * 45; tick += 1) {
    simulation.update(TICK_DT);
    if (tick % 2 === 0) {
      continue;
    }
    const next = createNetworkState(simulation);
    const patch = jsonRoundTrip(createStatePatch(previous, next));
    const restored = applyStatePatch(previous, patch);
    assert.deepEqual(restored, next, `战斗第 ${tick + 1} tick 的差量还原不正确`);
    fullBytes += Buffer.byteLength(JSON.stringify(next));
    patchBytes += Buffer.byteLength(JSON.stringify(patch));
    patchCount += 1;
    previous = restored;
  }

  const ratio = patchBytes / Math.max(1, fullBytes);
  assert(ratio < 0.7, `战斗差量体积收益不足：${(ratio * 100).toFixed(1)}%`);
  console.log(
    `网络状态差量校验通过：${patchCount} 帧，差量原始体积为全量的 ${(ratio * 100).toFixed(1)}%。`,
  );
}

basicStructureCheck();
noChangeCheck();
malformedPatchCheck();
battleSequenceCheck();
