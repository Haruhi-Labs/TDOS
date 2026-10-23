import { copyPlainData } from "../shared/data/plain-data.js";
const MAX_INPUT_QUEUE_LENGTH = 90;
const MAX_INPUTS_PER_TICK = 30;
const REPLACEABLE_ACTION_TYPES = new Set(["route_control", "route_end", "set_throttle"]);

export function createInputQueue({ networkStats = null } = {}) {
  const sessions = new WeakMap();
  function reset(player) {
    sessions.set(player, { inputQueue: [], lastProcessedSeq: 0, lastQueuedSeq: 0 });
  }
  function stateFor(player) {
    if (!sessions.has(player)) reset(player);
    return sessions.get(player);
  }
  function inspect(player) {
    const state = sessions.get(player) || { inputQueue: [], lastProcessedSeq: 0, lastQueuedSeq: 0 };
    return Object.freeze({
      lastProcessedSeq: state.lastProcessedSeq,
      lastQueuedSeq: state.lastQueuedSeq,
      pendingSequences: Object.freeze(state.inputQueue.map((item) => item.seq)),
    });
  }
  function acknowledgedSequence(player) {
    return sessions.get(player)?.lastProcessedSeq || 0;
  }
  function queueInput(player, data) {
    const state = stateFor(player);
    const seq = Number(data.seq);
    if (!Number.isInteger(seq) || seq <= 0) {
      return false;
    }
    const action = data.action;
    if (!action || typeof action !== "object") {
      return false;
    }
    if (seq <= state.lastProcessedSeq || seq <= (state.lastQueuedSeq || 0)) {
      return false;
    }

    state.lastQueuedSeq = seq;
    const queued = { seq, action: copyPlainData(action) };
    const lastQueued = state.inputQueue[state.inputQueue.length - 1];
    const replaceable = REPLACEABLE_ACTION_TYPES.has(action.type);
    if (
      replaceable &&
      lastQueued &&
      lastQueued.action?.type === action.type &&
      String(lastQueued.action?.shipKey || "main") === String(action.shipKey || "main")
    ) {
      state.inputQueue[state.inputQueue.length - 1] = queued;
      if (networkStats) {
        networkStats.coalescedInputs += 1;
      }
    } else {
      state.inputQueue.push(queued);
    }
    trimInputQueue(state);
    return true;
  }

  function trimInputQueue(state) {
    if (state.inputQueue.length > MAX_INPUT_QUEUE_LENGTH) {
      state.inputQueue.splice(0, state.inputQueue.length - MAX_INPUT_QUEUE_LENGTH);
    }
  }

  function applyQueuedInputs(room, getPlayerById) {
    for (const seat of ["A", "B"]) {
      const player = getPlayerById(room.seats[seat]);
      if (!player) {
        continue;
      }

      const state = stateFor(player);
      let handled = 0;
      while (state.inputQueue.length > 0 && handled < MAX_INPUTS_PER_TICK) {
        const item = state.inputQueue.shift();
        if (!item || !Number.isInteger(item.seq)) {
          continue;
        }
        if (item.seq <= state.lastProcessedSeq) {
          continue;
        }
        room.match.applyActionForSeat(seat, item.action);
        state.lastProcessedSeq = item.seq;
        handled += 1;
      }
      trimInputQueue(state);
    }
  }

  return { applyQueuedInputs, queueInput, reset, inspect, acknowledgedSequence };
}
