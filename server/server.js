import { beginRoomMatch } from "./room-state.js";
import { GAME_VERSION } from "../shared/game-version.js";
import { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";
import { cloneLoadout, DEFAULT_AI_LOADOUT, DEFAULT_TEAM_LOADOUT } from "../shared/game/characters/catalog.js";
import { MatchSimulation } from "../shared/game-core.js";
import { DEFAULT_WORLD_SIZE, TICK_RATE, SNAPSHOT_RATE } from "../shared/game/foundation/constants.js";
import { defaultFfaSpawns, defaultTeamSpawns } from "../shared/game/runtime/match-topology.js";
import { quantizeNetworkState } from "../shared/network-patch.js";
import {
  evaluateRulesetCompatibility,
  RULESET_VERSION,
} from "../shared/protocol/ruleset-version.js";
import {
  evaluateRoomFormatCapability,
  ROOM_FORMAT_IDS,
  SUPPORTED_STATE_SCHEMAS,
} from "../shared/protocol/room-formats.js";
import {
  HEARTBEAT_INTERVAL_MS,
  FINISHED_ROOM_CLOSE_DELAY_MS,
  LOBBY_BROADCAST_DEBOUNCE_MS,
  MAX_CONNECTIONS,
  MAX_PAYLOAD_BYTES,
  MAX_SNAPSHOT_BUFFERED_BYTES,
  MAX_STREAM_CAPACITY_UNITS,
  NETWORK_BUILD,
  NETWORK_METRICS_INTERVAL_MS,
  NETWORK_PROTOCOL_VERSION,
  PORT,
  PVP_COUNTDOWN_MS,
  STATS_DATA_DIR,
  STATS_HASH_SALT,
  GAME_AUTH_ISSUERS,
  GAME_AUTH_PUBLIC_KEY,
} from "./config.js";
import { createGameIdentityVerifier } from "./game-identity.js";
import { createInputQueue } from "./input-queue.js";
import { createMatchRuntime } from "./match-runtime.js";
import {
  CONTROL_MESSAGE_TYPES,
  messageCode,
  RULESET_GUARDED_MESSAGE_TYPES,
} from "./protocol.js";
import { createRoomLifecycle } from "./room-lifecycle.js";
import { createRoomRegistry } from "./room-registry.js";
import { createSnapshotStream } from "./snapshot-stream.js";
import { createStatisticsStore } from "./statistics-store.js";
import {
  buildServerMatchStatisticsRecord,
  buildSoloStatisticsRecord,
} from "./statistics-records.js";

const statisticsStore = createStatisticsStore({
  dataDir: STATS_DATA_DIR,
  hashSalt: STATS_HASH_SALT,
});
await statisticsStore.ready();

const gameIdentityVerifier = createGameIdentityVerifier({
  publicKey: GAME_AUTH_PUBLIC_KEY,
  issuers: GAME_AUTH_ISSUERS,
});
if (!gameIdentityVerifier.enabled) {
  console.warn("统一身份验签未启用：未配置合法的 GAME_AUTH_PUBLIC_KEY，游客模式不受影响");
}

const players = new Map();
const rooms = new Map();
// 仅服务端私有持有开局参与者统计档案快照，供运行中离房玩家结算归档，绝不进入公开状态或快照。
const roomStatisticsParticipants = new Map();
let lobbyBroadcastTimer = null;
const networkStats = {
  snapshotMessages: 0,
  keyframes: 0,
  deltas: 0,
  snapshotRawBytes: 0,
  skippedSnapshots: 0,
  streamTierChanges: 0,
  resyncRequests: 0,
  rateLimitedMessages: 0,
  coalescedInputs: 0,
};
const {
  resetSnapshotStream,
  requestKeyframe,
  upgradeProtocol,
  acknowledge: acknowledgeSnapshot,
  rateTierFor,
  send,
  sendSnapshotToPlayer,
  sendToPlayer,
} = createSnapshotStream({ networkStats });

const inputQueue = createInputQueue({ networkStats });
const roomRegistry = createRoomRegistry({ players, rooms, resetSnapshotStream, resetPlayerInputs: inputQueue.reset });
const {
  activeRoomCount,
  buildLobbyPayload,
  buildMatchResult,
  buildRoomStatePayload,
  findPrivateRoom,
  getPlayerById,
  roomSpectators,
  seatedPlayers,
  selectedShipsForRoom,
  spectatorCount,
  streamCapacityUnits,
  validShipKey,
} = roomRegistry;

function consumeRateLimit(player, key, refillPerSecond, capacity, now = Date.now()) {
  if (!player.rateLimits) {
    player.rateLimits = new Map();
  }
  const previous = player.rateLimits.get(key);
  if (!previous) {
    player.rateLimits.set(key, {
      tokens: Math.max(0, capacity - 1),
      updatedAt: now,
    });
    return true;
  }
  const elapsedSeconds = Math.max(0, now - previous.updatedAt) / 1000;
  const tokens = Math.min(capacity, previous.tokens + elapsedSeconds * refillPerSecond);
  if (tokens < 1) {
    previous.tokens = tokens;
    previous.updatedAt = now;
    networkStats.rateLimitedMessages += 1;
    return false;
  }
  previous.tokens = tokens - 1;
  previous.updatedAt = now;
  return true;
}

function sendError(player, message) {
  sendToPlayer(player, {
    type: "error",
    code: messageCode(message, "unknown_error"),
    message,
  });
}

function sendRulesetMismatch(player, blockedType = "") {
  sendToPlayer(player, {
    type: "ruleset_mismatch",
    code: "ruleset_mismatch",
    message: "客户端与服务器规则版本不一致",
    clientRulesetVersion: player.rulesetVersion || "",
    serverRulesetVersion: RULESET_VERSION,
    blockedType,
  });
}

function flushLobbyBroadcast() {
  lobbyBroadcastTimer = null;
  const payload = buildLobbyPayload();
  const serialized = JSON.stringify(payload);
  for (const player of players.values()) {
    // 已进入房间的客户端由 room_state 驱动，不需要继续接收不可操作的大厅列表。
    // 只向仍在大厅的人扇出，并复用同一份序列化结果。
    if (player.roomId || !player.ws || player.ws.readyState !== 1) {
      continue;
    }
    if (player.ws.bufferedAmount > MAX_SNAPSHOT_BUFFERED_BYTES) {
      continue;
    }
    player.ws.send(serialized);
  }
}

function broadcastLobby() {
  if (lobbyBroadcastTimer) {
    return;
  }
  lobbyBroadcastTimer = setTimeout(flushLobbyBroadcast, LOBBY_BROADCAST_DEBOUNCE_MS);
}

function sendRoomStateToMembers(room) {
  const sent = new Set();
  for (const { seat, player } of seatedPlayers(room)) {
    if (room.mode === "ai" && seat !== "A") {
      continue;
    }
    sent.add(player.id);
    sendToPlayer(player, buildRoomStatePayload(room, player.id));
  }
  for (const spectator of roomSpectators(room)) {
    if (sent.has(spectator.id)) {
      continue;
    }
    sent.add(spectator.id);
    sendToPlayer(spectator, buildRoomStatePayload(room, spectator.id));
  }
}

function captureStatsParticipant(player) {
  if (!player) return null;
  return {
    id: player.id,
    name: player.name,
    statisticsProfile: player.statisticsProfile ? { ...player.statisticsProfile } : null,
  };
}

function buildMultiFleetSetup(room) {
  const entries = seatedPlayers(room);
  const formatId = room.formatId;
  const fleets = [];
  const matchRoster = [];
  const statsParticipants = {};

  if (formatId === "2v2" || formatId === "3v3") {
    const spawnsBySide = defaultTeamSpawns(formatId, DEFAULT_WORLD_SIZE);
    const sideIndices = new Map();
    for (const { seat, sideId, player } of entries) {
      const index = sideIndices.get(sideId) || 0;
      sideIndices.set(sideId, index + 1);
      const spawn = spawnsBySide[sideId][index];
      const loadout = cloneLoadout(player.loadout || DEFAULT_TEAM_LOADOUT);
      fleets.push({
        seat,
        sideId,
        name: `${player.name}舰队`,
        loadout,
        spawn,
      });
      matchRoster.push({
        seat,
        sideId,
        name: player.name,
        loadout,
        isBot: false,
      });
      statsParticipants[seat] = captureStatsParticipant(player);
    }
  } else {
    const ffaSpawns = defaultFfaSpawns(entries.length, DEFAULT_WORLD_SIZE);
    for (let index = 0; index < entries.length; index += 1) {
      const { seat, sideId, player } = entries[index];
      const spawn = ffaSpawns[index];
      const loadout = cloneLoadout(player.loadout || DEFAULT_TEAM_LOADOUT);
      fleets.push({
        seat,
        sideId,
        name: `${player.name}舰队`,
        loadout,
        spawn,
      });
      matchRoster.push({
        seat,
        sideId,
        name: player.name,
        loadout,
        isBot: false,
      });
      statsParticipants[seat] = captureStatsParticipant(player);
    }
  }

  return { fleets, matchRoster, statsParticipants };
}

function startMatch(room) {
  if (room.status === "countdown" || room.status === "running") {
    return;
  }

  const needsCountdown = room.mode === "pvp";
  if ((room.formatId || "duel") === "duel") {
    const playerA = getPlayerById(room.seats.A);
    const playerB = getPlayerById(room.seats.B);
    const teamNames = {
      A: playerA ? `${playerA.name}舰队` : "玩家A舰队",
      B: room.mode === "ai" ? "统合思念体AI舰队" : playerB ? `${playerB.name}舰队` : "玩家B舰队",
    };

    beginRoomMatch(room, {
      countdownMs: PVP_COUNTDOWN_MS,
      createMatch: () => new MatchSimulation({
        mode: room.mode,
        worldSize: DEFAULT_WORLD_SIZE,
        teamNames,
        teamLoadouts: {
          A: playerA ? playerA.loadout : DEFAULT_TEAM_LOADOUT,
          B: room.mode === "ai" ? (room.aiLoadout || DEFAULT_AI_LOADOUT) : playerB ? playerB.loadout : DEFAULT_TEAM_LOADOUT,
        },
      }),
    });
  } else {
    const { fleets, matchRoster, statsParticipants } = buildMultiFleetSetup(room);
    roomStatisticsParticipants.set(room.id, statsParticipants);
    beginRoomMatch(room, {
      countdownMs: PVP_COUNTDOWN_MS,
      matchRoster,
      createMatch: () => new MatchSimulation({
        mode: "pvp",
        battleMode: room.battleMode,
        formatId: room.formatId,
        worldSize: DEFAULT_WORLD_SIZE,
        fleets,
      }),
    });
  }

  for (const { player } of seatedPlayers(room)) {
    inputQueue.reset(player);
  }

  sendRoomStateToMembers(room);
  if (needsCountdown) {
    // 倒计时期间先下发静止的初始战场，客户端可展示全部参战阵容但不能操作。
    sendSnapshot(room);
  }
}

function checkRuntimeCapability(player, room) {
  if (!room || (room.formatId || "duel") === "duel") {
    return { ok: true };
  }
  return evaluateRoomFormatCapability(room.formatId, {
    rulesetVersion: player.rulesetVersion,
    stateSchemas: player.supportedStateSchemas,
    roomFormats: player.supportedRoomFormats,
  });
}

function handleInput(player, data) {
  if (!player.roomId || !player.seat || player.spectating) {
    return;
  }
  const room = rooms.get(player.roomId);
  if (!room || room.status !== "running" || !room.match) {
    return;
  }
  if (room.seats[player.seat] !== player.id) {
    return;
  }
  const capability = checkRuntimeCapability(player, room);
  if (!capability.ok) {
    sendError(player, capability.message);
    return;
  }
  inputQueue.queueInput(player, data);
}

function buildSnapshotFrame(room, advanceSeq = true) {
  if (!room.match) {
    return null;
  }

  if (advanceSeq) {
    room.nextSnapshotSequence();
  }
  const serverTime = Date.now();
  const serializedState = room.match.serializeState();
  const {
    bots: _bots,
    zones,
    ...dynamicState
  } = serializedState;
  const state = {
    ...quantizeNetworkState(dynamicState),
    // 战区是整局不变的只读数据，保留同一引用可让差量比较直接跳过。
    zones,
    selectedShips: selectedShipsForRoom(room),
  };
  const activeSeats = Array.isArray(room.match.seatOrder) && room.match.seatOrder.length > 0
    ? room.match.seatOrder
    : room.seatOrder;
  const radarBySeat = {};
  for (const seat of activeSeats) {
    radarBySeat[seat] = quantizeNetworkState(room.match.serializeRadarForSeat(seat));
  }
  // AI 调试状态只供本地 /debug 推演页使用,却占快照 JSON 约 40% 体积——不进网络快照。
  return {
    roomId: room.id,
    roomSnapshotSeq: room.snapshotSeq || 0,
    tick: room.match.tick,
    simTime: room.match.elapsed,
    serverTime,
    state,
    stateBytes: Buffer.byteLength(JSON.stringify(state)),
    radarBySeat,
  };
}

function sendSnapshot(room) {
  const frame = buildSnapshotFrame(room, true);
  if (!frame) {
    return;
  }

  for (const { seat, player } of seatedPlayers(room)) {
    if (room.mode === "ai" && seat !== "A") {
      continue;
    }
    sendSnapshotToPlayer(player, frame, {
      ackSeq: inputQueue.acknowledgedSequence(player),
      radar: frame.radarBySeat[seat] || null,
    });
  }
  // 观战者默认使用7.5Hz权威快照；每条连接会根据端到端确认独立降档，
  // 慢观战端不会拖累同房玩家或其他观战者，且不获得任何玩家私有雷达。
  for (const spectator of roomSpectators(room)) {
    sendSnapshotToPlayer(spectator, frame, {
      ackSeq: 0,
      spectating: true,
    });
  }
}

function roomHasBunnyHaruhi(room) {
  if (!room?.match) return false;
  if (typeof room.match.allTeams === "function") {
    return room.match.allTeams().some((team) => Object.values(team.loadout || {}).includes("bunny_haruhi"));
  }
  return Boolean(room.match.bunnyHaruhiActive);
}

const {
  closeRoom,
  createRoom,
  joinRoom,
  leaveRoom,
  spectateRoom,
  updateLoadout,
  setPlayerSide,
  setPlayerReady,
  startRoomMatch,
} = createRoomLifecycle({
  rooms,
  registry: roomRegistry,
  sendToPlayer,
  sendRoomStateToMembers,
  broadcastLobby,
  startMatch,
  onRoomClosed(roomId) {
    roomStatisticsParticipants.delete(roomId);
  },
});

const wss = new WebSocketServer({
  port: PORT,
  maxPayload: MAX_PAYLOAD_BYTES,
  perMessageDeflate: {
    // 保留服务端跨帧压缩上下文：相邻快照结构高度重复，可进一步压缩多人和观战的持续流量。
    // 客户端上行消息很小，无需保留其压缩上下文；服务器当前CPU与内存余量足够。
    clientNoContextTakeover: true,
    concurrencyLimit: 4,
    threshold: 1024,
    zlibDeflateOptions: {
      level: 3,
      memLevel: 7,
    },
  },
});

wss.on("connection", (ws) => {
  if (players.size >= MAX_CONNECTIONS) {
    ws.close(1013, "服务器连接数已满");
    return;
  }
  ws.isAlive = true;
  ws.on("pong", () => {
    ws.isAlive = true;
  });

  const playerId = randomUUID();
  const player = {
    id: playerId,
    name: `玩家${playerId.slice(0, 4)}`,
    loadout: cloneLoadout(DEFAULT_TEAM_LOADOUT),
    ws,
    roomId: null,
    seat: null,
    spectating: false,
    selectedShipKey: "main",
    rateLimits: new Map(),
    networkProtocolVersion: 1,
    rulesetVersion: "",
    rulesetCompatible: true,
    supportsTournamentRooms: false,
    supportedStateSchemas: new Set(),
    supportedRoomFormats: new Set(),
    statisticsProfile: null,
    identity: null,
  };
  resetSnapshotStream(player);

  players.set(playerId, player);

  sendToPlayer(player, {
    type: "connected",
    playerId,
    build: NETWORK_BUILD,
    gameVersion: GAME_VERSION,
    buildId: process.env.GAME_BUILD_ID || "local",
    roomKinds: ["standard", "tournament"],
    stateSchemas: [...SUPPORTED_STATE_SCHEMAS],
    roomFormats: [...ROOM_FORMAT_IDS],
    protocolVersion: NETWORK_PROTOCOL_VERSION,
    rulesetVersion: RULESET_VERSION,
    serverTime: Date.now(),
    tickRate: TICK_RATE,
    snapshotRate: SNAPSHOT_RATE,
    snapshotIntervalMs: Math.round(1000 / SNAPSHOT_RATE),
  });

  sendToPlayer(player, buildLobbyPayload());

  ws.on("message", (raw) => {
    let data = null;
    try {
      data = JSON.parse(String(raw));
    } catch (_error) {
      sendError(player, "消息格式错误");
      return;
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      sendError(player, "消息格式错误");
      return;
    }

    const type = String(data.type || "");
    const messageNow = Date.now();
    if (!consumeRateLimit(player, "all", 120, 180, messageNow)) {
      return;
    }
    if (type === "input" && !consumeRateLimit(player, "input", 60, 90, messageNow)) {
      return;
    }
    if (type === "ping" && !consumeRateLimit(player, "ping", 4, 8, messageNow)) {
      return;
    }
    if (type === "snapshot_resync" && !consumeRateLimit(player, "resync", 1, 2, messageNow)) {
      return;
    }
    if (CONTROL_MESSAGE_TYPES.has(type) && !consumeRateLimit(player, "control", 10, 20, messageNow)) {
      return;
    }
    if (type === "get_winrate_stats" && !consumeRateLimit(player, "statistics_query", 0.2, 2, messageNow)) {
      return;
    }
    if (type === "report_solo_match" && !consumeRateLimit(player, "statistics_report", 0.1, 2, messageNow)) {
      return;
    }
    if (RULESET_GUARDED_MESSAGE_TYPES.has(type) && player.rulesetCompatible === false) {
      sendRulesetMismatch(player, type);
      return;
    }

    if (type === "authenticate") {
      if (player.roomId || player.identity) {
        sendToPlayer(player, {
          type: "identity_error",
          code: "identity_already_set",
        });
        return;
      }
      const result = gameIdentityVerifier.verifyAndConsume(data.ticket);
      if (!result.ok) {
        sendToPlayer(player, {
          type: "identity_error",
          code: result.reason,
        });
        return;
      }
      player.identity = result.identity;
      player.name = result.identity.nickname;
      sendToPlayer(player, {
        type: "identity_authenticated",
        user: result.identity,
      });
      broadcastLobby();
      return;
    }

    if (type === "set_name") {
      if (player.identity) return;
      const name = Array.from(String(data.name || "").trim()).slice(0, 32).join("");
      if (!name) {
        return;
      }
      player.name = name;
      if (player.roomId) {
        const room = rooms.get(player.roomId);
        if (room) {
          sendRoomStateToMembers(room);
        }
      }
      broadcastLobby();
      return;
    }

    if (type === "set_loadout") {
      const result = updateLoadout(player, data.loadout);
      if (!result.ok) {
        sendError(player, result.message);
        // 开赛与保存阵容交错时，恢复客户端显示的权威阵容。
        const room = rooms.get(player.roomId);
        if (room) sendToPlayer(player, buildRoomStatePayload(room, player.id));
      }
      return;
    }

    if (type === "set_side") {
      const result = setPlayerSide(player, data.sideId);
      if (!result.ok) sendError(player, result.message);
      return;
    }

    if (type === "set_ready" || type === "start_match") {
      const result = type === "set_ready" ? setPlayerReady(player, data.ready) : startRoomMatch(player);
      if (!result.ok) sendError(player, result.message);
      return;
    }

    if (type === "set_statistics_profile") {
      const profile = data.profile && typeof data.profile === "object" ? data.profile : {};
      player.statisticsProfile = {
        clientId: String(profile.clientId || "").trim().slice(0, 160),
        nickname: Array.from(String(profile.nickname || "").trim()).slice(0, 32).join(""),
        faction: profile.faction === "red" ? "red" : profile.faction === "blue" ? "blue" : "",
        locale: ["zh", "ja", "en"].includes(profile.locale) ? profile.locale : "",
      };
      return;
    }

    if (type === "get_winrate_stats") {
      sendToPlayer(player, {
        type: "winrate_stats",
        stats: statisticsStore.publicLeaderboard(data.gameVersion),
      });
      return;
    }

    if (type === "report_solo_match") {
      const record = buildSoloStatisticsRecord(data, player, {
        hashSalt: STATS_HASH_SALT,
        now: messageNow,
      });
      void statisticsStore.record(record).then((result) => {
        sendToPlayer(player, {
          type: "statistics_report_result",
          eventId: String(data.eventId || "").slice(0, 80),
          accepted: result.accepted,
          reason: result.reason || "",
        });
      });
      return;
    }

    if (type === "list_rooms") {
      sendToPlayer(player, buildLobbyPayload());
      return;
    }

    if (type === "create_room") {
      const visibility = data.visibility === "private" ? "private" : "public";
      const mode = data.mode === "ai" ? "ai" : "pvp";
      const result = createRoom(player, visibility, mode, data.kind, data.formatId);
      if (!result.ok) {
        sendError(player, result.message);
      }
      return;
    }

    if (type === "join_room") {
      const roomId = String(data.roomId || "");
      const room = rooms.get(roomId);
      const result = joinRoom(player, room, { sideId: data.sideId });
      if (!result.ok) {
        sendError(player, result.message);
      }
      return;
    }

    if (type === "spectate_room") {
      const roomId = String(data.roomId || "");
      const room = rooms.get(roomId);
      const result = spectateRoom(player, room);
      if (!result.ok) {
        sendError(player, result.message);
      }
      return;
    }

    if (type === "join_private") {
      const code = String(data.code || "").replace(/\D/g, "").slice(0, 6);
      const room = findPrivateRoom(code);
      const result = joinRoom(player, room, { sideId: data.sideId });
      if (!result.ok) {
        sendError(player, result.message);
      }
      return;
    }

    if (type === "leave_room") {
      leaveRoom(player);
      sendToPlayer(player, buildLobbyPayload());
      return;
    }

    if (type === "select_ship") {
      if (player.roomId && player.seat && !player.spectating) {
        const room = rooms.get(player.roomId);
        if (!room || room.seats[player.seat] !== player.id) {
          return;
        }
        const capability = checkRuntimeCapability(player, room);
        if (!capability.ok) {
          sendError(player, capability.message);
          return;
        }
        player.selectedShipKey = validShipKey(data.shipKey);
      }
      return;
    }

    if (type === "protocol_hello") {
      player.supportsTournamentRooms = Array.isArray(data.roomKinds) && data.roomKinds.includes("tournament");
      player.supportedStateSchemas = new Set(
        Array.isArray(data.stateSchemas)
          ? data.stateSchemas.filter((item) => typeof item === "string" && SUPPORTED_STATE_SCHEMAS.includes(item))
          : [],
      );
      player.supportedRoomFormats = new Set(
        Array.isArray(data.roomFormats)
          ? data.roomFormats.filter((item) => typeof item === "string" && ROOM_FORMAT_IDS.includes(item))
          : [],
      );
      const protocolVersion = Number(data.protocolVersion);
      if (Number.isInteger(protocolVersion) && protocolVersion >= 2 && player.networkProtocolVersion < 2) {
        player.networkProtocolVersion = Math.min(protocolVersion, NETWORK_PROTOCOL_VERSION);
        upgradeProtocol(player);
      }
      player.rulesetVersion = String(data.rulesetVersion || "").trim();
      const rulesetCompatibility = evaluateRulesetCompatibility(player.rulesetVersion);
      player.rulesetCompatible = rulesetCompatibility.compatible;
      const currentRoom = rooms.get(player.roomId);
      if (!player.rulesetVersion && (roomHasBunnyHaruhi(currentRoom) || (currentRoom && currentRoom.formatId !== "duel"))) {
        player.rulesetCompatible = false;
      }
      if (!player.rulesetCompatible) {
        sendRulesetMismatch(player);
      }
      return;
    }

    if (type === "snapshot_resync") {
      if (player.networkProtocolVersion >= 2) requestKeyframe(player);
      networkStats.resyncRequests += 1;
      return;
    }

    if (type === "snapshot_ack") {
      acknowledgeSnapshot(player, Number(data.snapshotSeq));
      return;
    }

    if (type === "input") {
      handleInput(player, data);
      return;
    }

    if (type === "ping") {
      const recvTime = Date.now();
      const sendTime = Date.now();
      sendToPlayer(player, {
        type: "pong",
        pingId: Number(data.pingId) || 0,
        clientTime: Number(data.clientTime) || 0,
        serverRecvTime: recvTime,
        serverSendTime: sendTime,
        serverTime: sendTime,
      });
      return;
    }

    sendError(player, "未知消息类型");
  });

  ws.on("close", () => {
    leaveRoom(player, "对手断开连接，房间已解散");
    players.delete(player.id);
    broadcastLobby();
  });

  ws.on("error", () => {
    // 连接层错误交由 close 统一回收
  });
});

const heartbeatTimer = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch (_error) {
      ws.terminate();
    }
  }
}, HEARTBEAT_INTERVAL_MS);
heartbeatTimer.unref();

function flushNetworkMetrics() {
  if (players.size === 0 && rooms.size === 0) {
    return;
  }
  const tiers = [0, 0, 0];
  let bufferedBytes = 0;
  let maxBufferedBytes = 0;
  let spectators = 0;
  for (const player of players.values()) {
    const buffered = Number(player.ws?.bufferedAmount) || 0;
    bufferedBytes += buffered;
    maxBufferedBytes = Math.max(maxBufferedBytes, buffered);
    const tier = Math.max(0, Math.min(2, rateTierFor(player)));
    tiers[tier] += 1;
    if (player.spectating) {
      spectators += 1;
    }
  }
  console.log(`网络指标 ${JSON.stringify({
    connections: players.size,
    rooms: rooms.size,
    activeRooms: activeRoomCount(),
    streamCapacityUnits: streamCapacityUnits(),
    streamCapacityLimit: MAX_STREAM_CAPACITY_UNITS,
    spectators,
    streamTiers: tiers,
    bufferedBytes,
    maxBufferedBytes,
    ...networkStats,
  })}`);
  for (const key of Object.keys(networkStats)) {
    networkStats[key] = 0;
  }
}

const networkMetricsTimer = setInterval(flushNetworkMetrics, NETWORK_METRICS_INTERVAL_MS);
networkMetricsTimer.unref();

wss.on("close", () => {
  clearInterval(heartbeatTimer);
  clearInterval(networkMetricsTimer);
  if (lobbyBroadcastTimer) {
    clearTimeout(lobbyBroadcastTimer);
    lobbyBroadcastTimer = null;
  }
  void statisticsStore.flush();
});

const matchRuntime = createMatchRuntime({
  rooms,
  applyQueuedInputs(room) {
    inputQueue.applyQueuedInputs(room, getPlayerById);
  },
  sendSnapshot,
  sendRoomStateToMembers,
  broadcastLobby,
  buildMatchResult,
  closeRoom,
  onMatchFinished(room, currentTime) {
    const record = buildServerMatchStatisticsRecord({
      room,
      getPlayerById,
      fallbackParticipantsBySeat: roomStatisticsParticipants.get(room.id) || null,
      hashSalt: STATS_HASH_SALT,
      now: currentTime,
    });
    if (!record) return;
    void statisticsStore.record(record, { trusted: true });
  },
  finishedRoomCloseDelayMs: FINISHED_ROOM_CLOSE_DELAY_MS,
});
matchRuntime.runServerLoop();

console.log(`网络对战服务器已启动 ws://localhost:${PORT}，统计目录 ${STATS_DATA_DIR}`);
