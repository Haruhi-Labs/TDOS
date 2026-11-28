import { GAME_VERSION } from "../shared/game-version.js";
import { RULESET_VERSION } from "../shared/protocol/ruleset-version.js";
import { MULTI_FLEET_STATE_SCHEMA } from "../shared/game/rules/side-outcome.js";
import { NETWORK_BUILD } from "./config.js";
import { anonymizeStatisticsPlayerId } from "./statistics-store.js";

const SUPPORTED_MULTI_FLEET_MODES = new Set(["team_elimination", "ffa_elimination"]);

function playerProfile(player, hashSalt = "") {
  const profile = player?.statisticsProfile || {};
  return {
    idHash: anonymizeStatisticsPlayerId(profile.clientId || player?.id, hashSalt),
    nickname: profile.nickname || player?.name || "",
    faction: profile.faction || "",
    locale: profile.locale || "",
  };
}

function simulationParticipant(simulationSummary, seat, player, loadout, isBot, hashSalt) {
  return {
    seat,
    isBot,
    player: isBot ? {} : playerProfile(player, hashSalt),
    loadout,
    finalState: simulationSummary.teams?.[seat],
  };
}

/**
 * 从多舰队结算读模型构造 schemaVersion=3 的统计记录，不持有权威对局对象。
 */
export function buildMultiFleetStatisticsRecord({
  id,
  summary,
  playersBySeat = {},
  hashSalt = "",
  now = Date.now(),
  gameVersion = GAME_VERSION,
  buildId = process.env.GAME_BUILD_ID || "local",
  rulesetVersion = RULESET_VERSION,
  networkBuild = NETWORK_BUILD,
  startedAt,
  source = "server",
  verified = true,
  environment = {},
} = {}) {
  if (!summary || typeof summary !== "object") return null;
  if (summary.schema !== MULTI_FLEET_STATE_SCHEMA) return null;
  if (!SUPPORTED_MULTI_FLEET_MODES.has(summary.battleMode)) return null;
  if (!Array.isArray(summary.seatOrder) || summary.seatOrder.length === 0) return null;
  if (!summary.outcome || typeof summary.outcome !== "object") return null;

  const durationSeconds = Math.max(0, Number(summary.durationSeconds) || 0);
  const participants = summary.seatOrder.map((seat) => {
    const teamSummary = summary.teams?.[seat];
    const playerEntry = Object.hasOwn(playersBySeat, seat) ? playersBySeat[seat] : null;
    const isBot = Boolean(playerEntry?.isBot);
    const player = playerEntry && Object.hasOwn(playerEntry, "player") ? playerEntry.player : playerEntry;
    return {
      seat,
      sideId: teamSummary?.sideId,
      isBot,
      player: isBot ? {} : playerProfile(player, hashSalt),
      loadout: teamSummary?.loadout,
      contribution: summary.telemetry?.teams?.[seat],
      finalState: teamSummary,
    };
  });

  return {
    schemaVersion: 3,
    id: String(id || "").trim(),
    mode: "multi_fleet",
    formatId: summary.formatId,
    battleMode: summary.battleMode,
    source,
    verified: Boolean(verified),
    gameVersion,
    buildId,
    rulesetVersion,
    networkBuild,
    campaign: summary.formatId,
    difficulty: "",
    startedAt: Number.isFinite(Number(startedAt)) ? Number(startedAt) : now - durationSeconds * 1000,
    finishedAt: now,
    durationSeconds,
    tick: summary.tick,
    outcome: {
      type: summary.outcome.type,
      winnerSideId: summary.outcome.winnerSideId,
      winnerSeats: Array.isArray(summary.outcome.winnerSeats) ? [...summary.outcome.winnerSeats] : [],
      ...(summary.outcome.reason ? { reason: summary.outcome.reason } : {}),
    },
    telemetry: summary.telemetry,
    environment,
    participants,
  };
}

export function buildServerMatchStatisticsRecord({
  room,
  getPlayerById,
  fallbackParticipantsBySeat = null,
  hashSalt = "",
  now = Date.now(),
}) {
  if (!room?.match) return null;
  const summary = room.match.statisticsSummary();
  if (summary?.schema === MULTI_FLEET_STATE_SCHEMA) {
    if (!SUPPORTED_MULTI_FLEET_MODES.has(summary.battleMode)) return null;
    const playersBySeat = {};
    for (const seat of summary.seatOrder || []) {
      const playerId = room.seats && Object.hasOwn(room.seats, seat) ? room.seats[seat] : null;
      const online = playerId && typeof getPlayerById === "function" ? getPlayerById(playerId) : null;
      const fallback = fallbackParticipantsBySeat && Object.hasOwn(fallbackParticipantsBySeat, seat)
        ? fallbackParticipantsBySeat[seat]
        : null;
      playersBySeat[seat] = online || fallback || null;
    }
    return buildMultiFleetStatisticsRecord({
      id: `server:${room.id}:${room.startedAt || room.createdAt}`,
      summary,
      playersBySeat,
      hashSalt,
      now,
      startedAt: room.startedAt || room.createdAt,
      source: "server",
      verified: true,
    });
  }
  // 当前旧榜单只比较标准战斗规则；控制席位相同不代表规则口径相同。
  if (summary.battleMode && summary.battleMode !== "standard") return null;
  const playerA = getPlayerById(room.seats.A);
  const playerB = getPlayerById(room.seats.B);
  const mode = room.mode === "pvp" ? "multiplayer" : "online_ai";
  return {
    id: `server:${room.id}:${room.startedAt || room.createdAt}`,
    mode,
    source: "server",
    verified: true,
    gameVersion: GAME_VERSION,
    buildId: process.env.GAME_BUILD_ID || "local",
    rulesetVersion: RULESET_VERSION,
    networkBuild: NETWORK_BUILD,
    campaign: room.mode === "pvp" ? "pvp" : "online_ai",
    difficulty: room.mode === "ai" ? "master" : "",
    startedAt: room.startedAt || room.createdAt,
    finishedAt: now,
    durationSeconds: summary.durationSeconds,
    tick: summary.tick,
    winnerSeat: summary.winnerSeat,
    telemetry: summary.telemetry,
    environment: {},
    participants: [
      simulationParticipant(summary, "A", playerA, summary.teams.A.loadout, false, hashSalt),
      simulationParticipant(summary, "B", playerB, summary.teams.B.loadout, room.mode === "ai", hashSalt),
    ],
  };
}

export function buildSoloStatisticsRecord(payload, player, { hashSalt = "", now = Date.now() } = {}) {
  const summary = payload?.summary && typeof payload.summary === "object" ? payload.summary : {};
  if (summary.schema === MULTI_FLEET_STATE_SCHEMA) return null;
  if (summary.battleMode && summary.battleMode !== "standard") return null;
  const profile = payload?.profile && typeof payload.profile === "object" ? payload.profile : {};
  const eventId = String(payload?.eventId || "").trim().slice(0, 80);
  return {
    id: eventId ? `solo:${eventId}` : "",
    mode: "solo",
    source: "client_solo",
    verified: false,
    gameVersion: payload?.gameVersion,
    buildId: payload?.buildId,
    rulesetVersion: String(payload?.rulesetVersion || player?.rulesetVersion || "").slice(0, 80),
    networkBuild: NETWORK_BUILD,
    campaign: "standard",
    difficulty: String(payload?.difficulty || "normal").slice(0, 24),
    startedAt: Number(payload?.startedAt) || now - Math.max(0, Number(summary.durationSeconds) || 0) * 1000,
    finishedAt: now,
    durationSeconds: summary.durationSeconds,
    tick: summary.tick,
    winnerSeat: summary.winnerSeat,
    telemetry: summary.telemetry,
    environment: payload?.environment || {},
    participants: [
      {
        seat: "A",
        isBot: false,
        player: {
          clientId: profile.clientId || player?.statisticsProfile?.clientId || "",
          nickname: profile.nickname || player?.name || "",
          faction: profile.faction || "",
          locale: profile.locale || "",
        },
        loadout: summary.teams?.A?.loadout,
        finalState: summary.teams?.A,
      },
      {
        seat: "B",
        isBot: true,
        player: {},
        loadout: summary.teams?.B?.loadout,
        finalState: summary.teams?.B,
      },
    ],
  };
}
