import { MatchSimulation } from "../../shared/game/runtime/match-simulation.js";
import { TICK_DT } from "../../shared/game/foundation/constants.js";
import { createFixedStepClock } from "../../shared/game/runtime/fixed-step-clock.js";
import { freezePlainData } from "../../shared/data/plain-data.js";
import { interpolateBattleState } from "../battle/state-interpolation.js";

// 单人权威会话持有模拟、固定步时钟和连续帧。页面只提交动作和读取投影。
export function createSoloSession({ createSimulation = (options) => new MatchSimulation(options) } = {}) {
  const clock = createFixedStepClock();
  let simulation = null;
  let state = null;
  let previous = null;
  let current = null;
  let snapshot = null;
  let dirty = true;

  function readState() {
    if (!simulation) return null;
    if (dirty) {
      snapshot = freezePlainData(simulation.serializeState());
      dirty = false;
    }
    return snapshot;
  }

  function reset(options, timestamp) {
    simulation = createSimulation(options);
    dirty = true;
    state = previous = current = readState();
    clock.reset(timestamp);
    return state;
  }

  function advance(timestamp, { paused = false } = {}) {
    const active = Boolean(!paused && simulation && (!state || state.phase !== "finished"));
    const steps = clock.advance(timestamp, (dt) => {
      previous = current || state || readState();
      dirty = true;
      simulation.update(dt);
      current = readState();
    }, { active });
    state = steps > 0 ? current : readState();
    // 动作在两个固定步之间立即提交；离散字段不能等待下一个逻辑帧。
    if (steps === 0) current = state;
    const renderState = active && state?.phase !== "finished" && previous && current
      ? interpolateBattleState(previous, current, clock.getAccumulatorSeconds() / TICK_DT, { spanSeconds: TICK_DT })
      : state;
    return { state, renderState };
  }

  function shipControl(shipKey, seat = "A") {
    const ship = simulation?.teamBySeat(seat)?.ships[shipKey];
    if (!ship) return null;
    return Object.freeze({
      x: ship.x,
      y: ship.y,
      throttle: ship.throttle,
      canControl: ship.canControl(),
      minTurnRadius: ship.routeConstraintProfile().minTurnRadius,
    });
  }

  function setTutorialStage(stage) {
    if (!simulation?.tutorialMode) return;
    dirty = true;
    if (stage === "attack") simulation.setCombatEnabled("A", true);
    if (stage === "free") {
      simulation.setCombatEnabled("A", true);
      simulation.setCombatEnabled("B", true);
      simulation.setAiEnabled("B", true);
    }
  }

  return Object.freeze({
    reset,
    advance,
    shipControl,
    setTutorialStage,
    resetClock: (timestamp) => clock.reset(timestamp),
    applyAction: (seat, action) => {
      // 被拒绝的施放也可能经历扣费和退款；不能只按 accepted 标记缓存失效。
      dirty = true;
      return simulation?.applyActionForSeat(seat, action) ?? false;
    },
    statisticsSummary: () => simulation?.statisticsSummary() ?? null,
    radarForSeat: (seat) => simulation?.serializeRadarForSeat(seat) ?? null,
  });
}
