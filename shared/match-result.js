// 2v2 / 1v1 结算判定纯函数：胜负只由权威阵营/座位字段决定，不看个人舰队是否全灭。

export function resolveViewerMatchResult({
  mode = null,
  winnerSeat = null,
  winnerAllianceId = null,
  viewerSeat = null,
  viewerAllianceId = null,
} = {}) {
  if (!winnerSeat && !winnerAllianceId) {
    return "draw";
  }

  const seatText = String(viewerSeat || "");
  const twoVsTwo =
    mode === "pvp2v2" ||
    Boolean(winnerAllianceId) ||
    /^[AB][12]$/.test(seatText);

  if (twoVsTwo) {
    const winnerAlliance =
      winnerAllianceId ||
      (winnerSeat === "A" || winnerSeat === "B" ? winnerSeat : null);
    const viewerAlliance =
      viewerAllianceId ||
      (seatText.startsWith("B") ? "B" : seatText ? "A" : null);
    if (!winnerAlliance || !viewerAlliance) {
      return "draw";
    }
    return winnerAlliance === viewerAlliance ? "win" : "lose";
  }

  return winnerSeat && viewerSeat && winnerSeat === viewerSeat ? "win" : "lose";
}

export function buildResultRenderKey({
  roomId = "-",
  winnerAllianceId = null,
  winnerSeat = null,
  viewerAllianceId = null,
  viewerSeat = null,
  spectating = false,
  playerCount = 0,
  result = "draw",
} = {}) {
  return [
    roomId || "-",
    winnerAllianceId || winnerSeat || "draw",
    viewerAllianceId || viewerSeat || "-",
    spectating ? "spec" : "play",
    playerCount,
    result,
  ].join(":");
}
