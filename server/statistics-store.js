import { LEGACY_STATISTICS_VERSION, statisticsVersionGroup } from "../shared/statistics-version.js";
import { GAME_VERSION, PUBLISHED_GAME_VERSIONS, UNVERSIONED_GAME_VERSION, normalizeGameVersion } from "../shared/game-version.js";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { CHARACTER_ORDER } from "../shared/game/characters/catalog.js";
import { isValidTopologyId } from "../shared/game/rules/team-relations.js";
import { normalizeSideOutcomeForParticipants, participantOutcomeForSeat } from "../shared/game/rules/side-outcome.js";

const LEGACY_SCHEMA_VERSION = 2;
const MULTI_FLEET_SCHEMA_VERSION = 3;
const PUBLIC_MODES = new Set(["solo", "multiplayer"]);
const VALID_SEATS = new Set(["A", "B"]);
const MAX_SOLO_REPORTS_PER_DAY = 240;
const characterIds = new Set(CHARACTER_ORDER);

export const MULTI_FLEET_STATISTICS_FORMATS = Object.freeze({
  "2v2": Object.freeze({ battleMode: "team_elimination", min: 4, max: 4, sides: 2, perSide: 2 }),
  "3v3": Object.freeze({ battleMode: "team_elimination", min: 6, max: 6, sides: 2, perSide: 3 }),
  ffa: Object.freeze({ battleMode: "ffa_elimination", min: 3, max: 6, uniqueSidePerSeat: true }),
});

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

function normalizeTelemetryRow(row) {
  if (!row || typeof row !== "object") return null;
  const numericMap = (map, maxKeys = 16) => Object.fromEntries(
    Object.entries(map || {}).slice(0, maxKeys).map(([key, number]) => [safeString(key, 40), round(Math.max(0, finiteNumber(number)), 2)]),
  );
  return {
    actions: numericMap(row.actions),
    attacks: numericMap(row.attacks),
    damageDealt: numericMap(row.damageDealt),
    damageTaken: numericMap(row.damageTaken),
    shipsLost: Math.max(0, Math.trunc(finiteNumber(row.shipsLost))),
  };
}

function normalizeTelemetry(value, seats = ["A", "B"]) {
  if (!value || typeof value !== "object") return null;
  const result = { teams: {} };
  for (const seat of seats) {
    const row = value.teams && Object.hasOwn(value.teams, seat) ? value.teams[seat] : null;
    const normalizedRow = normalizeTelemetryRow(row);
    if (!normalizedRow) continue;
    result.teams[seat] = normalizedRow;
  }
  return result;
}

function normalizePlayer(value, salt) {
  const source = value && typeof value === "object" ? value : {};
  const idHash = safeString(source.idHash, 24)
    || anonymizeStatisticsPlayerId(source.clientId || source.connectionId, salt);
  return {
    idHash,
    nickname: Array.from(safeString(source.nickname, 64)).slice(0, 32).join(""),
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

function isMultiFleetCandidate(source) {
  return source.schemaVersion === MULTI_FLEET_SCHEMA_VERSION
    || source.mode === "multi_fleet"
    || Object.hasOwn(MULTI_FLEET_STATISTICS_FORMATS, source.formatId)
    || source.battleMode === "team_elimination"
    || source.battleMode === "ffa_elimination";
}

function formatBucketKey(formatId, battleMode) {
  return `${formatId}::${battleMode}`;
}

export function createStatisticsStore({
  dataDir,
  hashSalt = process.env.STATS_HASH_SALT || "",
  now = Date.now,
  currentVersion = GAME_VERSION,
} = {}) {
  if (!dataDir) throw new Error("统计数据目录不能为空");

  const seenMatchIds = new Set();
  const pendingMatchIds = new Set();
  const leaderboards = new Map();
  const formatBoards = new Map();
  const players = new Map();
  const dailySoloReports = new Map();
  let totalRecords = 0;
  const publicCache = new Map();
  let writeChain = Promise.resolve();
  let readyPromise = null;

  function ensureFormatBucket(group, formatId, battleMode) {
    const key = formatBucketKey(formatId, battleMode);
    let versionMap = formatBoards.get(key);
    if (!versionMap) {
      versionMap = new Map();
      formatBoards.set(key, versionMap);
    }
    let bucket = versionMap.get(group);
    if (!bucket) {
      bucket = { matches: 0, lineups: new Map() };
      versionMap.set(group, bucket);
    }
    return bucket;
  }

  function aggregatePlayer(record, participant, modeKey) {
    const playerId = participant.player.idHash;
    if (!playerId || participant.isBot) return;
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
    playerRow.modes[modeKey] = (playerRow.modes[modeKey] || 0) + 1;
    if (participant.player.nickname) playerRow.nicknames[participant.player.nickname] = (playerRow.nicknames[participant.player.nickname] || 0) + 1;
    if (participant.player.faction) playerRow.factions[participant.player.faction] = (playerRow.factions[participant.player.faction] || 0) + 1;
    if (participant.player.locale) playerRow.locales[participant.player.locale] = (playerRow.locales[participant.player.locale] || 0) + 1;
    players.set(playerId, playerRow);
  }

  function aggregate(record) {
    if (seenMatchIds.has(record.id)) return false;
    seenMatchIds.add(record.id);
    totalRecords += 1;

    const group = statisticsVersionGroup(record.gameVersion);

    if (record.schemaVersion === MULTI_FLEET_SCHEMA_VERSION) {
      const bucket = ensureFormatBucket(group, record.formatId, record.battleMode);
      bucket.matches += 1;
      for (const participant of record.participants) {
        if (!participant.isBot) {
          const key = lineupKey(participant.loadout);
          const row = bucket.lineups.get(key) || publicAggregateRow(participant.loadout);
          row.games += 1;
          row.wins += participant.outcome === "win" ? 1 : 0;
          row.losses += participant.outcome === "loss" ? 1 : 0;
          row.draws += participant.outcome === "draw" ? 1 : 0;
          row.lastPlayedAt = Math.max(row.lastPlayedAt, record.finishedAt);
          bucket.lineups.set(key, row);
        }
        aggregatePlayer(record, participant, `${record.formatId}:${record.battleMode}`);
      }
      publicCache.clear();
      return true;
    }

    const publicMode = PUBLIC_MODES.has(record.mode) ? record.mode : null;
    const versionBoards = leaderboards.get(group) || { solo: new Map(), multiplayer: new Map() };
    leaderboards.set(group, versionBoards);
    for (const participant of record.participants) {
      if (publicMode && !participant.isBot && (record.mode !== "solo" || participant.seat === "A")) {
        const key = lineupKey(participant.loadout);
        const row = versionBoards[publicMode].get(key) || publicAggregateRow(participant.loadout);
        row.games += 1;
        row.wins += participant.outcome === "win" ? 1 : 0;
        row.losses += participant.outcome === "loss" ? 1 : 0;
        row.draws += participant.outcome === "draw" ? 1 : 0;
        row.lastPlayedAt = Math.max(row.lastPlayedAt, record.finishedAt);
        versionBoards[publicMode].set(key, row);
      }
      aggregatePlayer(record, participant, record.mode);
    }
    publicCache.clear();
    return true;
  }

  function normalizeMultiFleetRecord(source, { trusted = false } = {}) {
    const id = safeString(source.id, 120);
    if (!id) return null;
    if (source.mode !== "multi_fleet") return null;
    const formatId = typeof source.formatId === "string" && Object.hasOwn(MULTI_FLEET_STATISTICS_FORMATS, source.formatId)
      ? source.formatId
      : "";
    if (!formatId) return null;
    const formatSpec = MULTI_FLEET_STATISTICS_FORMATS[formatId];
    if (source.battleMode !== formatSpec.battleMode) return null;
    if (source.schemaVersion !== undefined && source.schemaVersion !== MULTI_FLEET_SCHEMA_VERSION) return null;
    if (!Array.isArray(source.participants)) return null;
    if (source.participants.length < formatSpec.min || source.participants.length > formatSpec.max) return null;

    const seenSeats = new Set();
    const sideCounts = new Map();
    const rawParticipants = [];
    for (const entry of source.participants) {
      if (!entry || typeof entry !== "object") return null;
      const seat = isValidTopologyId(entry.seat) ? entry.seat : null;
      const sideId = isValidTopologyId(entry.sideId) ? entry.sideId : null;
      const loadout = normalizeStatisticsLoadout(entry.loadout);
      if (!seat || !sideId || !loadout || seenSeats.has(seat)) return null;
      seenSeats.add(seat);
      sideCounts.set(sideId, (sideCounts.get(sideId) || 0) + 1);
      rawParticipants.push({ entry, seat, sideId, loadout });
    }

    if (formatSpec.uniqueSidePerSeat) {
      if (sideCounts.size !== rawParticipants.length) return null;
    } else {
      if (sideCounts.size !== formatSpec.sides) return null;
      for (const count of sideCounts.values()) {
        if (count !== formatSpec.perSide) return null;
      }
    }

    const normalizedOutcomeRecord = normalizeSideOutcomeForParticipants(source.outcome, rawParticipants);
    if (!normalizedOutcomeRecord) return null;

    const seats = rawParticipants.map((item) => item.seat);
    const normalizedTelemetry = normalizeTelemetry(source.telemetry, seats);
    const participants = rawParticipants.map(({ entry, seat, sideId, loadout }) => {
      const contributionSource = entry.contribution && typeof entry.contribution === "object"
        ? entry.contribution
        : normalizedTelemetry?.teams?.[seat];
      return {
        seat,
        sideId,
        isBot: Boolean(entry.isBot),
        player: normalizePlayer(entry.player, hashSalt),
        loadout,
        outcome: participantOutcomeForSeat(normalizedOutcomeRecord, seat, sideId),
        contribution: normalizeTelemetryRow(contributionSource),
        finalState: normalizeFinalState(entry.finalState),
      };
    });

    const finishedAt = Math.trunc(finiteNumber(source.finishedAt, now()));
    const durationSeconds = round(Math.max(0, finiteNumber(source.durationSeconds)), 3);
    return {
      schemaVersion: MULTI_FLEET_SCHEMA_VERSION,
      id,
      mode: "multi_fleet",
      formatId,
      battleMode: formatSpec.battleMode,
      source: safeString(source.source, 32),
      verified: Boolean(source.verified && trusted),
      gameVersion: normalizeGameVersion(source.gameVersion),
      buildId: safeString(source.buildId, 80),
      rulesetVersion: safeString(source.rulesetVersion, 80),
      networkBuild: safeString(source.networkBuild, 80),
      campaign: safeString(source.campaign || formatId, 40),
      difficulty: safeString(source.difficulty, 24),
      startedAt: Math.trunc(finiteNumber(source.startedAt, finishedAt - durationSeconds * 1000)),
      finishedAt,
      durationSeconds,
      tick: Math.max(0, Math.trunc(finiteNumber(source.tick))),
      outcome: normalizedOutcomeRecord,
      participants,
      telemetry: normalizedTelemetry,
      environment: normalizeEnvironment(source.environment),
    };
  }

  function normalizeRecord(input, { trusted = false } = {}) {
    const source = input && typeof input === "object" ? input : {};
    if (isMultiFleetCandidate(source)) {
      return normalizeMultiFleetRecord(source, { trusted });
    }

    if (source.schemaVersion !== undefined && source.schemaVersion !== 1 && source.schemaVersion !== LEGACY_SCHEMA_VERSION) {
      return null;
    }
    if (source.battleMode !== undefined && source.battleMode !== "standard") {
      return null;
    }
    if (source.formatId !== undefined && source.formatId !== "duel") {
      return null;
    }

    const mode = ["solo", "multiplayer", "online_ai"].includes(source.mode) ? source.mode : "";
    const id = safeString(source.id, 120);
    const winnerSeat = VALID_SEATS.has(source.winnerSeat) ? source.winnerSeat : null;
    const finishedAt = Math.trunc(finiteNumber(source.finishedAt, now()));
    const durationSeconds = round(Math.max(0, finiteNumber(source.durationSeconds)), 3);
    if (!Array.isArray(source.participants) || source.participants.length === 0 || source.participants.length > 2) {
      return null;
    }
    const seenSeats = new Set();
    const participants = [];
    for (const item of source.participants) {
      const normalized = normalizeParticipant(item, winnerSeat, hashSalt);
      if (!normalized || seenSeats.has(normalized.seat)) return null;
      seenSeats.add(normalized.seat);
      participants.push(normalized);
    }
    if (!mode || !id || participants.length === 0) return null;
    if (mode === "solo" && (!trusted && (durationSeconds < 8 || durationSeconds > 7200))) return null;
    if (mode === "multiplayer" && participants.length !== 2) return null;
    return {
      schemaVersion: LEGACY_SCHEMA_VERSION,
      id,
      mode,
      source: safeString(source.source, 32),
      verified: Boolean(source.verified && trusted),
      gameVersion: normalizeGameVersion(source.gameVersion),
      buildId: safeString(source.buildId, 80),
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
      telemetry: normalizeTelemetry(source.telemetry, ["A", "B"]),
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
    // 旧客户端无版本的记录归入 v0.3 及之前的历史组；不允许客户端创造任意版本榜单。
    if (!options.trusted && !PUBLISHED_GAME_VERSIONS.includes(normalized.gameVersion) && normalized.gameVersion !== UNVERSIONED_GAME_VERSION) {
      return { accepted: false, reason: "version_mismatch" };
    }
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
      return { accepted: true, record: structuredClone(normalized) };
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

  function publicLeaderboard(requestedVersion = currentVersion) {
    // 响应保留旧客户端的请求值；分组键仅用于聚合和新版本选择器。
    // 现有公开榜单仅汇总旧支持格式（solo 与旧 1v1 multiplayer），绝不混入多舰队玩法。
    const gameVersion = requestedVersion === LEGACY_STATISTICS_VERSION ? requestedVersion : normalizeGameVersion(requestedVersion);
    const group = statisticsVersionGroup(gameVersion);
    const currentGroup = statisticsVersionGroup(currentVersion);
    if (publicCache.has(gameVersion)) return structuredClone(publicCache.get(gameVersion));
    const versionBoards = leaderboards.get(group) || { solo: new Map(), multiplayer: new Map() };
    const countMatches = (boards, mode) => {
      const games = [...(boards?.[mode]?.values() || [])].reduce((sum, row) => sum + row.games, 0);
      return mode === "solo" ? games : Math.round(games / 2);
    };
    const modes = {};
    for (const mode of PUBLIC_MODES) {
      const rows = [...versionBoards[mode].values()]
        .sort((a, b) => b.games - a.games || b.wins / b.games - a.wins / a.games || b.lastPlayedAt - a.lastPlayedAt)
        .map(publicRow);
      modes[mode] = {
        matches: countMatches(versionBoards, mode),
        totalMatches: [...leaderboards.values()].reduce((sum, boards) => sum + countMatches(boards, mode), 0),
        currentVersionMatches: countMatches(leaderboards.get(currentGroup), mode),
        lineups: rows,
      };
    }
    const response = {
      gameVersion,
      currentVersion,
      currentVersionGroup: currentGroup,
      versions: [...new Set([currentGroup, ...leaderboards.keys()])].sort((a, b) => a === currentGroup ? -1 : b === currentGroup ? 1 : b.localeCompare(a, undefined, { numeric: true })),
      schemaVersion: LEGACY_SCHEMA_VERSION,
      generatedAt: now(),
      modes,
    };
    if (group === currentGroup || leaderboards.has(group)) publicCache.set(gameVersion, response);
    return structuredClone(response);
  }

  function formatLeaderboard({ gameVersion: requestedVersion = currentVersion, formatId, battleMode } = {}) {
    if (typeof formatId !== "string" || !Object.hasOwn(MULTI_FLEET_STATISTICS_FORMATS, formatId)) {
      throw new Error(`不支持的多舰队统计格式：${String(formatId)}`);
    }
    const formatSpec = MULTI_FLEET_STATISTICS_FORMATS[formatId];
    const resolvedBattleMode = battleMode ?? formatSpec.battleMode;
    if (resolvedBattleMode !== formatSpec.battleMode) {
      throw new Error(`统计查询口径冲突：格式 ${formatId} 对应规则 ${formatSpec.battleMode}，而非 ${String(resolvedBattleMode)}`);
    }

    const gameVersion = requestedVersion === LEGACY_STATISTICS_VERSION ? requestedVersion : normalizeGameVersion(requestedVersion);
    const group = statisticsVersionGroup(gameVersion);
    const currentGroup = statisticsVersionGroup(currentVersion);
    const key = formatBucketKey(formatId, resolvedBattleMode);
    const versionMap = formatBoards.get(key) || new Map();
    const bucket = versionMap.get(group) || { matches: 0, lineups: new Map() };
    const rows = [...bucket.lineups.values()]
      .sort((a, b) => b.games - a.games || b.wins / b.games - a.wins / a.games || b.lastPlayedAt - a.lastPlayedAt)
      .map(publicRow);
    const totalMatches = [...versionMap.values()].reduce((sum, entry) => sum + entry.matches, 0);
    const currentVersionMatches = versionMap.get(currentGroup)?.matches || 0;

    return {
      schemaVersion: MULTI_FLEET_SCHEMA_VERSION,
      gameVersion,
      currentVersion,
      currentVersionGroup: currentGroup,
      formatId,
      battleMode: resolvedBattleMode,
      versions: [...new Set([currentGroup, ...versionMap.keys()])].sort((a, b) => a === currentGroup ? -1 : b === currentGroup ? 1 : b.localeCompare(a, undefined, { numeric: true })),
      matches: bucket.matches,
      totalMatches,
      currentVersionMatches,
      lineups: rows,
      generatedAt: now(),
    };
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
    formatLeaderboard,
    normalizeRecord,
    createMatchId(prefix = "match") {
      return `${safeString(prefix, 32)}:${randomUUID()}`;
    },
    diagnostics() {
      const formatMatches = {};
      for (const [key, versionMap] of formatBoards.entries()) {
        formatMatches[key] = [...versionMap.values()].reduce((sum, bucket) => sum + bucket.matches, 0);
      }
      return {
        totalRecords,
        uniqueMatches: seenMatchIds.size,
        trackedPlayers: players.size,
        soloLineups: [...leaderboards.values()].reduce((sum, boards) => sum + boards.solo.size, 0),
        multiplayerLineups: [...leaderboards.values()].reduce((sum, boards) => sum + boards.multiplayer.size, 0),
        formatMatches,
      };
    },
  };
  return api;
}
