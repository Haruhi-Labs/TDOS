const MAX_INPUT_QUEUE_LENGTH = 90;
const MAX_INPUTS_PER_TICK = 30;
const REPLACEABLE_ACTION_TYPES = new Set(["route_control", "route_end", "set_throttle"]);

export function createInputQueue({ networkStats = null } = {}) {
  function queueInput(player, data) {
    const seq = Number(data.seq);
    if (!Number.isInteger(seq) || seq <= 0) {
      return false;
    }
    const action = data.action;
    if (!action || typeof action !== "object") {
      return false;
    }
    if (seq <= player.lastProcessedSeq || seq <= (player.lastQueuedSeq || 0)) {
      return false;
    }

    player.lastQueuedSeq = seq;
    const queued = { seq, action };
    const lastQueued = player.inputQueue[player.inputQueue.length - 1];
    const replaceable = REPLACEABLE_ACTION_TYPES.has(action.type);
    if (
      replaceable &&
      lastQueued &&
      lastQueued.action?.type === action.type &&
      String(lastQueued.action?.shipKey || "main") === String(action.shipKey || "main")
    ) {
      player.inputQueue[player.inputQueue.length - 1] = queued;
      if (networkStats) {
        networkStats.coalescedInputs += 1;
      }
    } else {
      player.inputQueue.push(queued);
    }
    trimInputQueue(player);
    return true;
  }

  function trimInputQueue(player) {
    if (player.inputQueue.length > MAX_INPUT_QUEUE_LENGTH) {
      player.inputQueue.splice(0, player.inputQueue.length - MAX_INPUT_QUEUE_LENGTH);
    }
  }

  function applyQueuedInputs(room, getPlayerById) {
    for (const seat of ["A", "B"]) {
      const player = getPlayerById(room.seats[seat]);
      if (!player) {
        continue;
      }

      let handled = 0;
      while (player.inputQueue.length > 0 && handled < MAX_INPUTS_PER_TICK) {
        const item = player.inputQueue.shift();
        if (!item || !Number.isInteger(item.seq)) {
          continue;
        }
        if (item.seq <= player.lastProcessedSeq) {
          continue;
        }
        room.match.applyActionForSeat(seat, item.action);
        player.lastProcessedSeq = item.seq;
        handled += 1;
      }
      trimInputQueue(player);
    }
  }

  return { applyQueuedInputs, queueInput };
}
