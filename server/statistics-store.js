import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { CHARACTER_ORDER } from "../shared/game-core.js";

const SCHEMA_VERSION = 1;
const PUBLIC_MODES = new Set(["solo", "multiplayer"]);
const VALID_SEATS = new Set(["A", "B"]);
const MAX_SOLO_REPORTS_PER_DAY = 240;
const characterIds = new Set(CHARACTER_ORDER);

function safeString(value, maxLength = 80) {
  return String(value || "").trim().slice(0, maxLength);
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(finiteNumber(value) * scale) / scale;
}

export function validStatisticsLoadout(value) {
  if (!value || typeof value !== "object") return false;
  const ids = [value.main, value.sub1, value.sub2].map(String);
  return ids.every((id) => characterIds.has(id)) && new Set(ids).size === ids.length;
}

export function normalizeStatisticsLoadout(value) {
  if (!validStatisticsLoadout(value)) return null;
  return {
    main: String(value.main),
    sub1: String(value.sub1),
    sub2: String(value.sub2),
  };
}

export function lineupKey(loadout) {
  const normalized = normalizeStatisticsLoadout(loadout);
  return normalized ? `${normalized.main}|${normalized.sub1}|${normalized.sub2}` : "";
}

export function anonymizeStatisticsPlayerId(value, salt = "") {
  const raw = safeString(value, 160);
  if (!raw) return "";
  return createHash("sha256").update(`${safeString(salt, 160)}\u0000${raw}`).digest("hex").slice(0, 24);
}

function normalizedOutcome(winnerSeat, seat) {
  if (!VALID_SEATS.has(winnerSeat)) return "draw";
  return winnerSeat === seat ? "win" : "loss";
}

function normalizeFinalState(value) {
  if (!value || typeof value !== "object") return null;
  const ships = {};
  for (const key of ["main", "sub1", "sub2"]) {
    const source = value.ships?.[key];
    if (!source || typeof source !== "object") continue;
    ships[key] = {
      alive: Boolean(source.alive),
      hp: round(Math.max(0, finiteNumber(source.hp)), 2),
      maxHp: round(Math.max(0, finiteNumber(source.maxHp)), 2),
      energy: round(Math.max(0, finiteNumber(source.energy)), 2),
      maxEnergy: round(Math.max(0, finiteNumber(source.maxEnergy)), 2),
    };
  }
  return {
    splitLevel: Math.max(0, Math.min(2, Math.trunc(finiteNumber(value.splitLevel)))),
    hullRatio: round(Math.max(0, Math.min(1, finiteNumber(value.hullRatio))), 4),
    ships,
    survivingScouts: Math.max(0, Math.trunc(finiteNumber(value.survivingScouts))),
    survivingWingmen: Math.max(0, Math.trunc(finiteNumber(value.survivingWingmen))),
  };
}

function normalizeTelemetry(value) {
  if (!value || typeof value !== "object") return null;
  const result = { teams: {} };
  for (const seat of ["A", "B"]) {
    const row = value.teams?.[seat];
    if (!row || typeof row !== "object") continue;
    const numericMap = (map, maxKeys = 16) => Object.fromEntries(
      Object.entries(map || {}).slice(0, maxKeys).map(([key, number]) => [safeString(key, 40), round(Math.max(0, finiteNumber(number)), 2)]),
    );
    result.teams[seat] = {
      actions: numericMap(row.actions),
      attacks: numericMap(row.attacks),
      damageDealt: numericMap(row.damageDealt),
      damageTaken: numericMap(row.damageTaken),
      shipsLost: Math.max(0, Math.trunc(finiteNumber(row.shipsLost))),
    };
  }
  return result;
}

function normalizePlayer(value, salt) {
  const source = value && typeof value === "object" ? value : {};
  const idHash = safeString(source.idHash, 24)
    || anonymizeStatisticsPlayerId(source.clientId || source.connectionId, salt);
  return {
    idHash,
    nickname: safeString(source.nickname, 16),
    faction: source.faction === "red" ? "red" : source.faction === "blue" ? "blue" : "",
    locale: ["zh", "ja", "en"].includes(source.locale) ? source.locale : "",
  };
}

function normalizeParticipant(value, winnerSeat, salt) {
  if (!value || typeof value !== "object") return null;
  const seat = VALID_SEATS.has(value.seat) ? value.seat : null;
  const loadout = normalizeStatisticsLoadout(value.loadout);
  if (!seat || !loadout) return null;
  return {
    seat,
    isBot: Boolean(value.isBot),
    player: normalizePlayer(value.player, salt),
    loadout,
    outcome: normalizedOutcome(winnerSeat, seat),
    finalState: normalizeFinalState(value.finalState),
  };
}

function normalizeEnvironment(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    formFactor: ["compact", "standard", "wide"].includes(source.formFactor) ? source.formFactor : "unknown",
    renderer: ["webgl2", "webgl1", "canvas2d"].includes(source.renderer) ? source.renderer : "unknown",
    pixelRatioBucket: safeString(source.pixelRatioBucket, 12),
    timezoneOffsetMinutes: Math.max(-840, Math.min(840, Math.trunc(finiteNumber(source.timezoneOffsetMinutes)))),
  };
}

function publicAggregateRow(loadout) {
  return {
    lineup: loadout,
    games: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    lastPlayedAt: 0,
  };
}

function publicRow(row) {
  return {
    lineup: { ...row.lineup },
    games: row.games,
    winRate: row.games > 0 ? Math.round((row.wins / row.games) * 10000) / 100 : 0,
  };
}

function monthFileName(timestamp) {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `matches-${year}-${month}.jsonl`;
}

function utcDay(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function createStatisticsStore({
  dataDir,
  hashSalt = process.env.STATS_HASH_SALT || "",
  now = Date.now,
} = {}) {
  if (!dataDir) throw new Error("统计数据目录不能为空");

  const seenMatchIds = new Set();
  const pendingMatchIds = new Set();
  const leaderboards = {
    solo: new Map(),
    multiplayer: new Map(),
  };
  const players = new Map();
  const dailySoloReports = new Map();
  let totalRecords = 0;
  let publicCache = null;
  let writeChain = Promise.resolve();
  let readyPromise = null;

  function aggregate(record) {
    if (seenMatchIds.has(record.id)) return false;
    seenMatchIds.add(record.id);
    totalRecords += 1;

    const publicMode = PUBLIC_MODES.has(record.mode) ? record.mode : null;
    for (const participant of record.participants) {
      if (publicMode && !participant.isBot && (record.mode !== "solo" || participant.seat === "A")) {
        const key = lineupKey(participant.loadout);
        const row = leaderboards[publicMode].get(key) || publicAggregateRow(participant.loadout);
        row.games += 1;
        row.wins += participant.outcome === "win" ? 1 : 0;
        row.losses += participant.outcome === "loss" ? 1 : 0;
        row.draws += participant.outcome === "draw" ? 1 : 0;
        row.lastPlayedAt = Math.max(row.lastPlayedAt, record.finishedAt);
        leaderboards[publicMode].set(key, row);
      }

      const playerId = participant.player.idHash;
      if (!playerId || participant.isBot) continue;
      const playerRow = players.get(playerId) || {
        idHash: playerId,
        firstSeenAt: record.finishedAt,
        lastSeenAt: record.finishedAt,
        matches: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        modes: {},
        nicknames: {},
        factions: {},
        locales: {},
      };
      playerRow.firstSeenAt = Math.min(playerRow.firstSeenAt, record.finishedAt);
      playerRow.lastSeenAt = Math.max(playerRow.lastSeenAt, record.finishedAt);
      playerRow.matches += 1;
      playerRow.wins += participant.outcome === "win" ? 1 : 0;
      playerRow.losses += participant.outcome === "loss" ? 1 : 0;
      playerRow.draws += participant.outcome === "draw" ? 1 : 0;
      playerRow.modes[record.mode] = (playerRow.modes[record.mode] || 0) + 1;
      if (participant.player.nickname) playerRow.nicknames[participant.player.nickname] = (playerRow.nicknames[participant.player.nickname] || 0) + 1;
      if (participant.player.faction) playerRow.factions[participant.player.faction] = (playerRow.factions[participant.player.faction] || 0) + 1;
      if (participant.player.locale) playerRow.locales[participant.player.locale] = (playerRow.locales[participant.player.locale] || 0) + 1;
      players.set(playerId, playerRow);
    }
    publicCache = null;
    return true;
  }

  function normalizeRecord(input, { trusted = false } = {}) {
    const source = input && typeof input === "object" ? input : {};
    const mode = ["solo", "multiplayer", "online_ai"].includes(source.mode) ? source.mode : "";
    const id = safeString(source.id, 120);
    const winnerSeat = VALID_SEATS.has(source.winnerSeat) ? source.winnerSeat : null;
    const finishedAt = Math.trunc(finiteNumber(source.finishedAt, now()));
    const durationSeconds = round(Math.max(0, finiteNumber(source.durationSeconds)), 3);
    const participants = Array.isArray(source.participants)
      ? source.participants.map((item) => normalizeParticipant(item, winnerSeat, hashSalt)).filter(Boolean).slice(0, 2)
      : [];
    if (!mode || !id || participants.length === 0) return null;
    if (mode === "solo" && (!trusted && (durationSeconds < 8 || durationSeconds > 7200))) return null;
    if (mode === "multiplayer" && participants.length !== 2) return null;
    return {
      schemaVersion: SCHEMA_VERSION,
      id,
      mode,
      source: safeString(source.source, 32),
      verified: Boolean(source.verified && trusted),
      rulesetVersion: safeString(source.rulesetVersion, 80),
      networkBuild: safeString(source.networkBuild, 80),
      campaign: safeString(source.campaign, 40),
      difficulty: safeString(source.difficulty, 24),
      startedAt: Math.trunc(finiteNumber(source.startedAt, finishedAt - durationSeconds * 1000)),
      finishedAt,
      durationSeconds,
      tick: Math.max(0, Math.trunc(finiteNumber(source.tick))),
      winnerSeat,
      participants,
      telemetry: normalizeTelemetry(source.telemetry),
      environment: normalizeEnvironment(source.environment),
    };
  }

  async function initialize() {
    await mkdir(dataDir, { recursive: true });
    const fileNames = (await readdir(dataDir))
      .filter((name) => /^matches-\d{4}-\d{2}\.jsonl$/.test(name))
      .sort();
    for (const fileName of fileNames) {
      const lines = createInterface({
        input: createReadStream(join(dataDir, fileName), { encoding: "utf8" }),
        crlfDelay: Infinity,
      });
      for await (const line of lines) {
        if (!line.trim()) continue;
        try {
          const record = normalizeRecord(JSON.parse(line), { trusted: true });
          if (record) aggregate(record);
        } catch (_error) {
          // 单条损坏不应阻塞服务启动；追加日志的其它记录仍可恢复。
        }
      }
    }
    return api;
  }

  async function record(input, options = {}) {
    await ready();
    const normalized = normalizeRecord(input, options);
    if (!normalized) return { accepted: false, reason: "invalid" };
    if (seenMatchIds.has(normalized.id) || pendingMatchIds.has(normalized.id)) {
      return { accepted: false, reason: "duplicate" };
    }

    if (!options.trusted && normalized.mode === "solo") {
      const reporter = normalized.participants[0]?.player?.idHash;
      if (!reporter) return { accepted: false, reason: "missing_player" };
      const dailyKey = `${reporter}:${utcDay(normalized.finishedAt)}`;
      const reports = dailySoloReports.get(dailyKey) || 0;
      if (reports >= MAX_SOLO_REPORTS_PER_DAY) return { accepted: false, reason: "daily_limit" };
      dailySoloReports.set(dailyKey, reports + 1);
    }

    pendingMatchIds.add(normalized.id);
    const line = `${JSON.stringify(normalized)}\n`;
    const filePath = join(dataDir, monthFileName(normalized.finishedAt));
    const writeOperation = writeChain
      .catch(() => {})
      .then(() => appendFile(filePath, line, "utf8"));
    // 后续写入不能被一次短暂磁盘错误永久卡死；具体错误仍由本次调用返回。
    writeChain = writeOperation.catch(() => {});
    try {
      await writeOperation;
      pendingMatchIds.delete(normalized.id);
      aggregate(normalized);
      return { accepted: true, record: normalized };
    } catch (error) {
      pendingMatchIds.delete(normalized.id);
      if (!options.trusted && normalized.mode === "solo") {
        const reporter = normalized.participants[0]?.player?.idHash;
        const dailyKey = reporter ? `${reporter}:${utcDay(normalized.finishedAt)}` : "";
        if (dailyKey) dailySoloReports.set(dailyKey, Math.max(0, (dailySoloReports.get(dailyKey) || 1) - 1));
      }
      console.error(`统计记录写入失败：${error instanceof Error ? error.message : String(error)}`);
      return { accepted: false, reason: "write_failed" };
    }
  }

  function publicLeaderboard() {
    if (publicCache) return publicCache;
    const modes = {};
    for (const mode of PUBLIC_MODES) {
      const rows = [...leaderboards[mode].values()]
        .sort((a, b) => b.games - a.games || b.wins / b.games - a.wins / a.games || b.lastPlayedAt - a.lastPlayedAt)
        .map(publicRow);
      modes[mode] = {
        matches: mode === "solo"
          ? rows.reduce((sum, row) => sum + row.games, 0)
          : Math.round(rows.reduce((sum, row) => sum + row.games, 0) / 2),
        lineups: rows,
      };
    }
    publicCache = {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: now(),
      modes,
    };
    return publicCache;
  }

  function ready() {
    if (!readyPromise) readyPromise = initialize();
    return readyPromise;
  }

  async function flush() {
    await ready();
    await writeChain;
  }

  const api = {
    ready,
    record,
    flush,
    publicLeaderboard,
    normalizeRecord,
    createMatchId(prefix = "match") {
      return `${safeString(prefix, 32)}:${randomUUID()}`;
    },
    diagnostics() {
      return {
        totalRecords,
        uniqueMatches: seenMatchIds.size,
        trackedPlayers: players.size,
        soloLineups: leaderboards.solo.size,
        multiplayerLineups: leaderboards.multiplayer.size,
      };
    },
  };
  return api;
}
