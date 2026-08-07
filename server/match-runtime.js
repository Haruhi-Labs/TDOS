import { TICK_DT } from "../shared/game/constants.js";
import { createFixedStepClock } from "../shared/game/fixed-step-clock.js";
import {
  FINISHED_ROOM_CLOSE_DELAY_MS,
  LOOP_IDLE_MS,
  MAX_CATCHUP_STEPS,
  SNAPSHOT_INTERVAL,
} from "./config.js";

export function createMatchRuntime({
  rooms,
  applyQueuedInputs,
  sendSnapshot,
  sendRoomStateToMembers,
  broadcastLobby,
  buildMatchResult,
  closeRoom,
  finishedRoomCloseDelayMs = FINISHED_ROOM_CLOSE_DELAY_MS,
  now = Date.now,
  schedule = setTimeout,
  tickDt = TICK_DT,
  snapshotInterval = SNAPSHOT_INTERVAL,
  maxCatchupSteps = MAX_CATCHUP_STEPS,
  loopIdleMs = LOOP_IDLE_MS,
}) {
  const closeDelayMs = Number.isFinite(Number(finishedRoomCloseDelayMs))
    ? Math.max(0, Number(finishedRoomCloseDelayMs))
    : FINISHED_ROOM_CLOSE_DELAY_MS;
  const clock = createFixedStepClock({
    stepSeconds: tickDt,
    maxCatchupSteps,
    maxFrameSeconds: 0.25,
    initialTimeMs: now(),
  });

  function tickRooms() {
    for (const room of rooms.values()) {
      const currentTime = now();
      if (
        room.status === "finished"
        && Number(room.closesAt) > 0
        && currentTime >= Number(room.closesAt)
      ) {
        closeRoom(room.id, "对局结束，已返回大厅");
        continue;
      }

      if (room.status === "countdown" && room.match) {
        if (currentTime < Number(room.countdownEndsAt || 0)) {
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
          room.finishedAt = currentTime;
          room.closesAt = currentTime + closeDelayMs;
          room.result = buildMatchResult(room, currentTime);
          sendSnapshot(room);
          sendRoomStateToMembers(room);
          broadcastLobby();
        }
      }
    }
  }

  function advanceLoop(currentTimeMs = now()) {
    return clock.advance(currentTimeMs, tickRooms);
  }

  function runServerLoop() {
    advanceLoop();
    schedule(runServerLoop, loopIdleMs);
  }

  return { advanceLoop, runServerLoop, tickRooms };
}
