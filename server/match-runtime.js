import { TICK_DT } from "../shared/game/constants.js";
import {
  LOOP_IDLE_MS,
  MAX_CATCHUP_STEPS,
  SNAPSHOT_INTERVAL,
} from "./config.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function createMatchRuntime({
  rooms,
  applyQueuedInputs,
  sendSnapshot,
  sendRoomStateToMembers,
  broadcastLobby,
  buildMatchResult,
  now = Date.now,
  schedule = setTimeout,
  tickDt = TICK_DT,
  snapshotInterval = SNAPSHOT_INTERVAL,
  maxCatchupSteps = MAX_CATCHUP_STEPS,
  loopIdleMs = LOOP_IDLE_MS,
}) {
  let lastLoopTimeMs = now();
  let loopAccumulator = 0;

  function tickRooms() {
    for (const room of rooms.values()) {
      if (room.status === "countdown" && room.match) {
        if (now() < Number(room.countdownEndsAt || 0)) {
          continue;
        }
        room.status = "running";
        room.countdownEndsAt = null;
        sendRoomStateToMembers(room);
        sendSnapshot(room);
        broadcastLobby();
      }

      if (room.status === "running" && room.match) {
        applyQueuedInputs(room);
        room.match.update(tickDt);

        room.snapshotAccumulator += tickDt;
        while (room.snapshotAccumulator >= snapshotInterval) {
          room.snapshotAccumulator -= snapshotInterval;
          sendSnapshot(room);
        }

        if (room.match.phase === "finished" && room.status !== "finished") {
          room.status = "finished";
          room.finishedAt = now();
          room.result = buildMatchResult(room);
          sendSnapshot(room);
          sendRoomStateToMembers(room);
          broadcastLobby();
        }
      }
    }
  }

  function advanceLoop(currentTimeMs = now()) {
    const frameSeconds = clamp((currentTimeMs - lastLoopTimeMs) / 1000, 0, 0.25);
    lastLoopTimeMs = currentTimeMs;
    loopAccumulator += frameSeconds;

    let steps = 0;
    while (loopAccumulator >= tickDt && steps < maxCatchupSteps) {
      tickRooms();
      loopAccumulator -= tickDt;
      steps += 1;
    }
    if (steps >= maxCatchupSteps) {
      loopAccumulator = 0;
    }
    return steps;
  }

  function runServerLoop() {
    advanceLoop();
    schedule(runServerLoop, loopIdleMs);
  }

  return { advanceLoop, runServerLoop, tickRooms };
}
