import { RULESET_VERSION } from "../shared/protocol/ruleset-version.js";
import { NETWORK_BUILD } from "./config.js";
import { anonymizeStatisticsPlayerId } from "./statistics-store.js";

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

export function buildServerMatchStatisticsRecord({ room, getPlayerById, hashSalt = "", now = Date.now() }) {
  if (!room?.match) return null;
  const summary = room.match.statisticsSummary();
  const playerA = getPlayerById(room.seats.A);
  const playerB = getPlayerById(room.seats.B);
  const mode = room.mode === "pvp" ? "multiplayer" : "online_ai";
  return {
    id: `server:${room.id}:${room.startedAt || room.createdAt}`,
    mode,
    source: "server",
    verified: true,
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
  const profile = payload?.profile && typeof payload.profile === "object" ? payload.profile : {};
  const eventId = String(payload?.eventId || "").trim().slice(0, 80);
  return {
    id: eventId ? `solo:${eventId}` : "",
    mode: "solo",
    source: "client_solo",
    verified: false,
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
