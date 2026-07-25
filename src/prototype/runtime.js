import {
  DEFAULT_WORLD_SIZE,
  MatchSimulation,
  TICK_DT,
  normalizeLoadout,
  DEFAULT_TEAM_LOADOUT,
  DEFAULT_AI_LOADOUT,
} from "../../shared/game-core.js";
import { normalizeGameplayRules } from "../../shared/gameplay/rules.js";
import { normalizeModeParameters, createEmptyOutcome } from "../../shared/modes/mode-definition.js";

const MODE_EVENT_QUEUE_LIMIT = 128;

function countAliveShips(fleet) {
  if (!fleet?.ships) return 0;
  return Object.values(fleet.ships).filter((ship) => ship && ship.alive).length;
}

function hullRatio(fleet) {
  if (!fleet?.ships) return 0;
  const ships = Object.values(fleet.ships);
  const max = ships.reduce((sum, ship) => sum + (Number(ship.maxHp) || 0), 0);
  const hp = ships.reduce((sum, ship) => sum + (ship.alive ? Number(ship.hp) || 0 : 0), 0);
  return max > 0 ? hp / max : 0;
}

function pushModeEvents(queue, events, meta) {
  if (!events) return;
  const list = Array.isArray(events) ? events : [events];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    meta.eventSequence += 1;
    queue.push({
      id: raw.id != null ? String(raw.id) : `evt-${meta.eventSequence}`,
      type: String(raw.type || "mode_event"),
      tick: Number.isFinite(Number(raw.tick)) ? Number(raw.tick) : meta.elapsedTicks,
      position: raw.position && typeof raw.position === "object" ? { ...raw.position } : null,
      allianceId: raw.allianceId || null,
      seat: raw.seat || null,
      payload: raw.payload && typeof raw.payload === "object" ? { ...raw.payload } : raw.payload ?? null,
    });
  }
  while (queue.length > MODE_EVENT_QUEUE_LIMIT) {
    queue.shift();
  }
}

/**
 * 通用本地运行器：不包含任何具体 modeId 分支。
 * 所有模式差异通过 modeDefinition 回调完成。
 */
export function createPrototypeRuntime({
  modeDefinition,
  runtimePreset = {},
  teamLoadouts = {},
  gameplayRules = null,
  modeParameters = null,
  randomSeed = null,
  worldSize = DEFAULT_WORLD_SIZE,
  aiDifficulty = "normal",
} = {}) {
  if (!modeDefinition) {
    throw new Error("createPrototypeRuntime requires modeDefinition");
  }

  const state = {
    modeDefinition,
    runtimePreset,
    simulation: null,
    modeState: null,
    snapshot: null,
    result: createEmptyOutcome(),
    paused: false,
    speedScale: 1,
    // 固定步长剩余时间：60fps 单帧 dt 常 < TICK_DT，若不累计则多数帧 0 step，舰船几乎不动。
    timeBudget: 0,
    elapsedTicks: 0,
    destroyed: false,
    gameplayRules: normalizeGameplayRules(gameplayRules),
    modeParameters: normalizeModeParameters(modeDefinition.parameterSchema || [], {
      ...(modeDefinition.defaultParameters || {}),
      ...(modeParameters || {}),
    }),
    randomSeed: randomSeed == null || randomSeed === "" ? null : Number(randomSeed),
    teamLoadouts: {
      A: normalizeLoadout(teamLoadouts.A || DEFAULT_TEAM_LOADOUT, DEFAULT_TEAM_LOADOUT),
      B: normalizeLoadout(teamLoadouts.B || DEFAULT_AI_LOADOUT, DEFAULT_AI_LOADOUT),
    },
    worldSize,
    aiDifficulty,
    controlA: runtimePreset.controlA || "human",
    controlB: runtimePreset.controlB || "ai",
    modeEvents: [],
    eventSequence: 0,
  };

  function buildAiSeats() {
    const seats = [];
    if (state.controlA === "ai") seats.push("A");
    if (state.controlB === "ai") seats.push("B");
    // MatchSimulation mode "ai" 默认 B 为 AI；显式 seats 更清晰
    return seats.length ? seats : ["B"];
  }

  function createSimulation() {
    const aiSeats = buildAiSeats();
    return new MatchSimulation({
      mode: aiSeats.includes("A") || aiSeats.includes("B") ? "ai" : "pvp",
      worldSize: state.worldSize,
      teamLoadouts: state.teamLoadouts,
      teamNames: {
        A: state.runtimePreset.teamNameA || "实验舰队 A",
        B: state.runtimePreset.teamNameB || "实验舰队 B",
      },
      aiSeats,
      aiDifficulty: state.aiDifficulty,
      gameplayRules: state.gameplayRules,
    });
  }

  function refreshSnapshot() {
    state.snapshot = state.simulation ? state.simulation.serializeState() : null;
    return state.snapshot;
  }

  function clearModeEvents() {
    state.modeEvents.length = 0;
    state.eventSequence = 0;
  }

  function evaluateMode(dt = 0) {
    if (!state.simulation || !state.modeDefinition) return;
    const snapshot = refreshSnapshot();
    const nextState = state.modeDefinition.updateModeState({
      simulation: state.simulation,
      snapshot,
      modeState: state.modeState,
      parameters: state.modeParameters,
      dt,
      runtime: publicApi,
    });
    if (nextState && typeof nextState === "object" && Array.isArray(nextState.events)) {
      pushModeEvents(state.modeEvents, nextState.events, state);
      const { events: _drop, ...rest } = nextState;
      state.modeState = rest;
    } else {
      state.modeState = nextState;
    }
    const outcome = state.modeDefinition.resolveOutcome({
      simulation: state.simulation,
      snapshot,
      modeState: state.modeState,
      parameters: state.modeParameters,
      runtime: publicApi,
    }) || createEmptyOutcome();
    state.result = outcome;
  }

  function runBeforeSimulationStep(dt) {
    const hook = state.modeDefinition?.beforeSimulationStep;
    if (typeof hook !== "function" || !state.simulation) return;
    const result = hook({
      simulation: state.simulation,
      snapshot: state.snapshot || refreshSnapshot(),
      modeState: state.modeState,
      parameters: state.modeParameters,
      dt,
      runtime: publicApi,
    });
    if (!result || typeof result !== "object") return;
    if (Object.prototype.hasOwnProperty.call(result, "modeState")) {
      state.modeState = result.modeState;
    }
    if (result.events) {
      pushModeEvents(state.modeEvents, result.events, state);
    }
  }

  function start() {
    if (state.destroyed) return publicApi;
    state.simulation = createSimulation();
    state.modeState = state.modeDefinition.createInitialModeState({
      parameters: state.modeParameters,
      runtimePreset: state.runtimePreset,
      teamLoadouts: state.teamLoadouts,
      randomSeed: state.randomSeed,
    });
    state.result = createEmptyOutcome();
    state.elapsedTicks = 0;
    state.timeBudget = 0;
    state.paused = false;
    clearModeEvents();
    refreshSnapshot();
    evaluateMode(0);
    return publicApi;
  }

  function restart(next = {}) {
    if (next.teamLoadouts) {
      state.teamLoadouts = {
        A: normalizeLoadout(next.teamLoadouts.A || state.teamLoadouts.A, DEFAULT_TEAM_LOADOUT),
        B: normalizeLoadout(next.teamLoadouts.B || state.teamLoadouts.B, DEFAULT_AI_LOADOUT),
      };
    }
    if (next.gameplayRules) {
      state.gameplayRules = normalizeGameplayRules(next.gameplayRules);
    }
    if (next.modeParameters) {
      state.modeParameters = normalizeModeParameters(state.modeDefinition.parameterSchema || [], {
        ...(state.modeDefinition.defaultParameters || {}),
        ...next.modeParameters,
      });
    }
    if (next.aiDifficulty) state.aiDifficulty = next.aiDifficulty;
    if (next.randomSeed !== undefined) {
      state.randomSeed = next.randomSeed == null || next.randomSeed === "" ? null : Number(next.randomSeed);
    }
    return start();
  }

  function step(dt = TICK_DT) {
    if (state.destroyed || !state.simulation) return publicApi;
    if (state.result?.finished) return publicApi;
    const safeDt = Math.max(0, Math.min(0.05, Number(dt) || TICK_DT));
    // 固定 Tick 顺序：before → sim → snapshot → updateMode → outcome
    runBeforeSimulationStep(safeDt);
    state.simulation.update(safeDt);
    state.elapsedTicks += 1;
    evaluateMode(safeDt);
    return publicApi;
  }

  function update(frameDeltaSeconds, { maxSteps = 8 } = {}) {
    if (state.destroyed || !state.simulation || state.paused || state.result?.finished) {
      refreshSnapshot();
      return publicApi;
    }
    state.timeBudget += Math.max(0, Number(frameDeltaSeconds) || 0) * state.speedScale;
    let steps = 0;
    while (state.timeBudget + 1e-9 >= TICK_DT && steps < maxSteps) {
      step(TICK_DT);
      state.timeBudget -= TICK_DT;
      steps += 1;
      if (state.result?.finished) break;
    }
    // 追帧上限：避免长时间切后台后一次吐出过大预算拖垮主线程。
    if (state.timeBudget > TICK_DT * maxSteps) {
      state.timeBudget = TICK_DT * maxSteps;
    }
    refreshSnapshot();
    return publicApi;
  }

  function applyAction(action, seat = "A") {
    if (state.destroyed || !state.simulation || state.result?.finished) return false;
    const hook = state.modeDefinition?.handleAction;
    if (typeof hook === "function") {
      const handled = hook({
        action,
        seat,
        simulation: state.simulation,
        snapshot: state.snapshot || refreshSnapshot(),
        modeState: state.modeState,
        parameters: state.modeParameters,
        runtime: publicApi,
      });
      if (handled && handled.handled === true) {
        if (Object.prototype.hasOwnProperty.call(handled, "modeState")) {
          state.modeState = handled.modeState;
        }
        if (handled.events) {
          pushModeEvents(state.modeEvents, handled.events, state);
        }
        refreshSnapshot();
        return handled.accepted !== false;
      }
    }
    return state.simulation.applyActionForSeat(seat, action);
  }

  function getDiagnostics() {
    const snapshot = state.snapshot || refreshSnapshot();
    const teamA = snapshot?.fleets?.A || snapshot?.teams?.A;
    const teamB = snapshot?.fleets?.B || snapshot?.teams?.B;
    const modeDiagnostics =
      state.modeDefinition.buildDiagnostics({
        simulation: state.simulation,
        snapshot,
        modeState: state.modeState,
        parameters: state.modeParameters,
        runtime: publicApi,
      }) || {};

    return {
      模式: state.modeDefinition.name,
      模式ID: state.modeDefinition.id,
      模式状态: state.modeDefinition.status,
      模拟Tick: state.elapsedTicks,
      模拟时间: Number((snapshot?.elapsed || 0).toFixed(2)),
      倍速: state.speedScale,
      随机种子: state.randomSeed == null ? "-" : state.randomSeed,
      对局阶段: snapshot?.phase || "-",
      暂停: state.paused,
      结果: state.result?.finished ? state.result.label || "已结束" : "进行中",
      A存活: countAliveShips(teamA),
      B存活: countAliveShips(teamB),
      A舰体: `${Math.round(hullRatio(teamA) * 100)}%`,
      B舰体: `${Math.round(hullRatio(teamB) * 100)}%`,
      模式事件积压: state.modeEvents.length,
      ...modeDiagnostics,
    };
  }

  function serialize() {
    return {
      modeId: state.modeDefinition.id,
      elapsedTicks: state.elapsedTicks,
      paused: state.paused,
      speedScale: state.speedScale,
      randomSeed: state.randomSeed,
      gameplayRules: { ...state.gameplayRules },
      modeParameters: { ...state.modeParameters },
      modeState: state.modeDefinition.serializeModeState
        ? state.modeDefinition.serializeModeState(state.modeState)
        : state.modeState,
      result: { ...state.result },
      snapshot: state.snapshot,
    };
  }

  function destroy() {
    state.destroyed = true;
    state.paused = true;
    state.simulation = null;
    state.snapshot = null;
    state.modeState = null;
    clearModeEvents();
  }

  const publicApi = {
    start,
    restart,
    pause() {
      state.paused = true;
      return publicApi;
    },
    resume() {
      if (!state.result?.finished) state.paused = false;
      return publicApi;
    },
    togglePause() {
      if (state.paused) return publicApi.resume();
      return publicApi.pause();
    },
    step,
    update,
    applyAction,
    setSpeedScale(value) {
      const n = Number(value);
      state.speedScale = Number.isFinite(n) && n > 0 ? n : 1;
      return publicApi;
    },
    getSpeedScale() {
      return state.speedScale;
    },
    isPaused() {
      return state.paused;
    },
    isFinished() {
      return Boolean(state.result?.finished);
    },
    getResult() {
      return state.result;
    },
    getSnapshot() {
      return state.snapshot || refreshSnapshot();
    },
    getSimulation() {
      return state.simulation;
    },
    getModeDefinition() {
      return state.modeDefinition;
    },
    getModeParameters() {
      return { ...state.modeParameters };
    },
    getGameplayRules() {
      return { ...state.gameplayRules };
    },
    getModeState() {
      return state.modeState;
    },
    getPresentationState() {
      const hook = state.modeDefinition?.getPresentationState;
      if (typeof hook !== "function") return null;
      return hook({
        snapshot: state.snapshot || refreshSnapshot(),
        modeState: state.modeState,
        parameters: state.modeParameters,
        runtime: publicApi,
      });
    },
    consumeModeEvents() {
      if (!state.modeEvents.length) return [];
      const batch = state.modeEvents.slice();
      state.modeEvents.length = 0;
      return batch;
    },
    getRandomSeed() {
      return state.randomSeed;
    },
    getFleetLayout() {
      // 现阶段固定 A/B；后续 3v3 再泛化。保持旧模式兼容。
      return {
        alliances: {
          A: [{ seat: "A", control: state.controlA, loadout: { ...state.teamLoadouts.A } }],
          B: [{ seat: "B", control: state.controlB, loadout: { ...state.teamLoadouts.B } }],
        },
        localSeat: state.controlA === "human" ? "A" : state.controlB === "human" ? "B" : "A",
      };
    },
    getDiagnostics,
    serialize,
    destroy,
  };

  return publicApi;
}
