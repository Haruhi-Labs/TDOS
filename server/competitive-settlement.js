const COMPETITIVE_MODES = new Set(["pvp", "pvp2v2", "stellar3v3"]);
const COMPETITIVE_PLAYER_COUNTS = Object.freeze({ pvp: 2, pvp2v2: 4, stellar3v3: 6 });

export function buildCompetitiveSettlement(room) {
  const result = room?.result;
  if (!room || !result || room.visibility !== "public" || !COMPETITIVE_MODES.has(room.mode)) {
    return null;
  }
  if (result.winnerAllianceId !== "A" && result.winnerAllianceId !== "B") {
    return null;
  }
  const resultPlayers = Array.isArray(result.players) ? result.players : [];
  if (
    resultPlayers.length !== COMPETITIVE_PLAYER_COUNTS[room.mode] ||
    resultPlayers.some((player) => player?.isBot || !player?.userId)
  ) {
    return null;
  }
  const players = resultPlayers
    .filter((player) => !player?.isBot && player?.userId && (player.allianceId === "A" || player.allianceId === "B"))
    .map((player) => ({ userId: player.userId, allianceId: player.allianceId }));
  if (players.length !== resultPlayers.length || new Set(players.map((player) => player.userId)).size !== players.length) {
    return null;
  }
  const alliances = new Set(players.map((player) => player.allianceId));
  const teamSize = COMPETITIVE_PLAYER_COUNTS[room.mode] / 2;
  if (
    !alliances.has("A") ||
    !alliances.has("B") ||
    players.filter((player) => player.allianceId === "A").length !== teamSize ||
    players.filter((player) => player.allianceId === "B").length !== teamSize
  ) {
    return null;
  }
  return {
    matchId: `online:${room.mode}:${room.id}:${result.finishedAt}`,
    mode: room.mode,
    winnerAllianceId: result.winnerAllianceId,
    finishedAt: result.finishedAt,
    players,
  };
}

export function settleCompletedRoom(store, room) {
  const settlement = buildCompetitiveSettlement(room);
  if (!settlement) {
    return { settled: false, reason: "not_competitive_human_pvp" };
  }
  try {
    return store.settleCompetitiveMatch(settlement);
  } catch (_error) {
    return { settled: false, reason: "invalid_competitive_result" };
  }
}
