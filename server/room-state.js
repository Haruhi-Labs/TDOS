// 房间比赛阶段由这些操作统一提交；广播、输入与统计仍由驱动按原顺序消费。
export function beginRoomMatch(room, { createMatch, countdownMs = 0, now = Date.now }) {
  if (room.status === "countdown" || room.status === "running") return false;
  const needsCountdown = room.mode === "pvp";
  room.status = needsCountdown ? "countdown" : "running";
  room.startedAt = now();
  room.countdownEndsAt = needsCountdown ? now() + countdownMs : null;
  room.match = createMatch();
  room.snapshotAccumulator = 0;
  room.snapshotSeq = 0;
  room.finishedAt = null;
  room.closesAt = null;
  room.result = null;
  return true;
}

export function startRoomRunning(room, currentTime) {
  if (room.status !== "countdown" || !room.match || currentTime < Number(room.countdownEndsAt || 0)) return false;
  room.status = "running";
  room.countdownEndsAt = null;
  return true;
}

export function finishRoomMatch(room, currentTime, closeDelayMs, buildMatchResult) {
  if (room.status !== "running" || room.match?.phase !== "finished") return false;
  room.status = "finished";
  room.finishedAt = currentTime;
  room.closesAt = currentTime + closeDelayMs;
  // 结果构建器与后续统计回调都必须看到已经完成的房间。
  room.result = buildMatchResult(room, currentTime);
  return true;
}
