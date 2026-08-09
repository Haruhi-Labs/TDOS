const COMPETITIVE_MODES = new Set(["pvp", "pvp2v2", "stellar3v3"]);
const COMPETITIVE_PLAYER_COUNTS = Object.freeze({ pvp: 2, pvp2v2: 4, stellar3v3: 6 });
const STELLAR3V3_SEATS = new Set(["A1", "A2", "A3", "B1", "B2", "B3"]);

function hasCompleteStellar3v3Roster(players) {
  const seats = new Set();
  return players.every((player) => {
    const seat = String(player?.seat || "");
    if (!STELLAR3V3_SEATS.has(seat) || player?.allianceId !== seat.charAt(0) || seats.has(seat)) {
      return false;
    }
    seats.add(seat);
    return true;
  });
}

export function buildCompetitiveSettlement(room) {
  const result = room?.result;
  if (!room || !result || room.visibility !== "public" || !COMPETITIVE_MODES.has(room.mode)) {
    return null;
  }
  if (result.winnerAllianceId !== "A" && result.winnerAllianceId !== "B") {
    return null;
  }
  const resultPlayers = Array.isArray(result.players) ? result.players : [];
  if (resultPlayers.length !== COMPETITIVE_PLAYER_COUNTS[room.mode]) {
    return null;
  }
  if (room.mode === "stellar3v3" && !hasCompleteStellar3v3Roster(resultPlayers)) {
    return null;
  }
  const players = resultPlayers
    .filter((player) => player?.userId && (player.allianceId === "A" || player.allianceId === "B"))
    .map((player) => ({ userId: player.userId, allianceId: player.allianceId }));
  if (
    resultPlayers.some((player) => player?.userId && player.allianceId !== "A" && player.allianceId !== "B") ||
    new Set(players.map((player) => player.userId)).size !== players.length
  ) {
    return null;
  }
  const alliances = new Set(players.map((player) => player.allianceId));
  const teamSize = COMPETITIVE_PLAYER_COUNTS[room.mode] / 2;
  const playersOnA = players.filter((player) => player.allianceId === "A").length;
  const playersOnB = players.filter((player) => player.allianceId === "B").length;

  if (room.mode === "stellar3v3") {
    // Account seats, rather than live controller type, define 3v3 eligibility.
    if (!players.length || !alliances.has("A") || !alliances.has("B") || playersOnA !== playersOnB) {
      return null;
    }
  } else if (
    resultPlayers.some((player) => player?.isBot || !player?.userId) ||
    players.length !== resultPlayers.length ||
    !alliances.has("A") ||
    !alliances.has("B") ||
    playersOnA !== teamSize ||
    playersOnB !== teamSize
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

export function ratingChangeForUser(settlement, userId) {
  if (!settlement?.settled || !userId) {
    return null;
  }
  const change = settlement.changes?.find((entry) => entry.userId === userId);
  if (!change) {
    return null;
  }
  return { before: change.before, after: change.after, delta: change.delta };
}
