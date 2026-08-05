import { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";
import {
  cloneLoadout,
  DEFAULT_AI_LOADOUT,
  DEFAULT_TEAM_LOADOUT,
  MatchSimulation,
  DEFAULT_WORLD_SIZE,
  TICK_RATE,
  SNAPSHOT_RATE,
  normalizeLoadout,
} from "../shared/game-core.js";
import { quantizeNetworkState } from "../shared/network-patch.js";
import {
  HEARTBEAT_INTERVAL_MS,
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
} from "./config.js";
import { createInputQueue } from "./input-queue.js";
import { createMatchRuntime } from "./match-runtime.js";
import { CONTROL_MESSAGE_TYPES, messageCode } from "./protocol.js";
import { createRoomLifecycle } from "./room-lifecycle.js";
import { createRoomRegistry } from "./room-registry.js";
import { createSnapshotStream } from "./snapshot-stream.js";

const players = new Map();
const rooms = new Map();
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
  send,
  sendSnapshotToPlayer,
  sendToPlayer,
} = createSnapshotStream({ networkStats });

const roomRegistry = createRoomRegistry({ players, rooms, resetSnapshotStream });
const inputQueue = createInputQueue({ networkStats });
const {
  activeRoomCount,
  buildLobbyPayload,
  buildMatchResult,
  buildRoomStatePayload,
  findPrivateRoom,
  getPlayerById,
  roomSpectators,
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
  const pA = getPlayerById(room.seats.A);
  const pB = getPlayerById(room.seats.B);
  if (pA) {
    sent.add(pA.id);
    sendToPlayer(pA, buildRoomStatePayload(room, pA.id));
  }
  if (room.mode === "pvp" && pB) {
    sent.add(pB.id);
    sendToPlayer(pB, buildRoomStatePayload(room, pB.id));
  }
  for (const spectator of roomSpectators(room)) {
    if (sent.has(spectator.id)) {
      continue;
    }
    sendToPlayer(spectator, buildRoomStatePayload(room, spectator.id));
  }
}

function startMatch(room) {
  if (room.status === "countdown" || room.status === "running") {
    return;
  }

  const playerA = getPlayerById(room.seats.A);
  const playerB = getPlayerById(room.seats.B);
  const teamNames = {
    A: playerA ? `${playerA.name}舰队` : "玩家A舰队",
    B: room.mode === "ai" ? "统合思念体AI舰队" : playerB ? `${playerB.name}舰队` : "玩家B舰队",
  };

  const needsCountdown = room.mode === "pvp";
  room.status = needsCountdown ? "countdown" : "running";
  room.countdownEndsAt = needsCountdown ? Date.now() + PVP_COUNTDOWN_MS : null;
  room.match = new MatchSimulation({
    mode: room.mode,
    worldSize: DEFAULT_WORLD_SIZE,
    teamNames,
    teamLoadouts: {
      A: playerA ? playerA.loadout : DEFAULT_TEAM_LOADOUT,
      B: room.mode === "ai" ? (room.aiLoadout || DEFAULT_AI_LOADOUT) : playerB ? playerB.loadout : DEFAULT_TEAM_LOADOUT,
    },
  });
  room.snapshotAccumulator = 0;
  room.snapshotSeq = 0;
  room.finishedAt = null;
  room.result = null;

  for (const seat of ["A", "B"]) {
    const p = getPlayerById(room.seats[seat]);
    if (!p) {
      continue;
    }
    p.inputQueue = [];
    p.lastProcessedSeq = 0;
    p.lastQueuedSeq = 0;
  }

  sendRoomStateToMembers(room);
  if (needsCountdown) {
    // 倒计时期间先下发静止的初始战场，客户端可展示双方阵容但不能操作。
    sendSnapshot(room);
  }
}

function handleInput(player, data) {
  if (!player.roomId || !player.seat) {
    return;
  }
  const room = rooms.get(player.roomId);
  if (!room || room.status !== "running" || !room.match) {
    return;
  }
  inputQueue.queueInput(player, data);
}

function buildSnapshotFrame(room, advanceSeq = true) {
  if (!room.match) {
    return null;
  }

  if (advanceSeq) {
    room.snapshotSeq = (room.snapshotSeq || 0) + 1;
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
  // AI 调试状态只供本地 /debug 推演页使用,却占快照 JSON 约 40% 体积——不进网络快照。
  return {
    roomId: room.id,
    roomSnapshotSeq: room.snapshotSeq || 0,
    tick: room.match.tick,
    simTime: room.match.elapsed,
    serverTime,
    state,
    stateBytes: Buffer.byteLength(JSON.stringify(state)),
    radarBySeat: {
      A: quantizeNetworkState(room.match.serializeRadarForSeat("A")),
      B: quantizeNetworkState(room.match.serializeRadarForSeat("B")),
    },
    patchCache: new Map(),
  };
}

function sendSnapshot(room) {
  const frame = buildSnapshotFrame(room, true);
  if (!frame) {
    return;
  }

  const pA = getPlayerById(room.seats.A);
  const pB = getPlayerById(room.seats.B);

  if (pA) {
    sendSnapshotToPlayer(pA, frame, {
      ackSeq: pA.lastProcessedSeq,
      radar: frame.radarBySeat.A,
    });
  }
  if (room.mode === "pvp" && pB) {
    sendSnapshotToPlayer(pB, frame, {
      ackSeq: pB.lastProcessedSeq,
      radar: frame.radarBySeat.B,
    });
  }
  // 观战者默认使用7.5Hz权威快照；每条连接会根据端到端确认独立降档，
  // 慢观战端不会拖累同房玩家或其他观战者。
  for (const spectator of roomSpectators(room)) {
    sendSnapshotToPlayer(spectator, frame, {
      ackSeq: 0,
      spectating: true,
    });
  }
}

const {
  createRoom,
  joinRoom,
  leaveRoom,
  spectateRoom,
} = createRoomLifecycle({
  rooms,
  registry: roomRegistry,
  sendToPlayer,
  sendRoomStateToMembers,
  broadcastLobby,
  startMatch,
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
    inputQueue: [],
    lastProcessedSeq: 0,
    lastQueuedSeq: 0,
    selectedShipKey: "main",
    snapshotStream: null,
    rateLimits: new Map(),
    networkProtocolVersion: 1,
  };
  resetSnapshotStream(player);

  players.set(playerId, player);

  sendToPlayer(player, {
    type: "connected",
    playerId,
    build: NETWORK_BUILD,
    protocolVersion: NETWORK_PROTOCOL_VERSION,
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

    if (type === "set_name") {
      const name = String(data.name || "").trim().slice(0, 16);
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
      player.loadout = normalizeLoadout(data.loadout || {}, DEFAULT_TEAM_LOADOUT);
      if (player.roomId) {
        const room = rooms.get(player.roomId);
        if (room && room.status === "waiting") {
          sendRoomStateToMembers(room);
        }
      }
      broadcastLobby();
      return;
    }

    if (type === "list_rooms") {
      sendToPlayer(player, buildLobbyPayload());
      return;
    }

    if (type === "create_room") {
      const visibility = data.visibility === "private" ? "private" : "public";
      const mode = data.mode === "ai" ? "ai" : "pvp";
      const result = createRoom(player, visibility, mode);
      if (!result.ok) {
        sendError(player, result.message);
      }
      return;
    }

    if (type === "join_room") {
      const roomId = String(data.roomId || "");
      const room = rooms.get(roomId);
      const result = joinRoom(player, room);
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
      const result = joinRoom(player, room);
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
        player.selectedShipKey = validShipKey(data.shipKey);
      }
      return;
    }

    if (type === "protocol_hello") {
      const protocolVersion = Number(data.protocolVersion);
      if (Number.isInteger(protocolVersion) && protocolVersion >= 2 && player.networkProtocolVersion < 2) {
        player.networkProtocolVersion = Math.min(protocolVersion, NETWORK_PROTOCOL_VERSION);
        if (player.snapshotStream) {
          player.snapshotStream.forceKeyframe = true;
          player.snapshotStream.lastState = null;
          // 握手前的兼容全量帧不要求客户端补交到达确认。
          player.snapshotStream.lastDeliveryAckSeq = player.snapshotStream.sequence;
          player.snapshotStream.lastDeliveryAckAt = Date.now();
        }
      }
      return;
    }

    if (type === "snapshot_resync") {
      if (player.networkProtocolVersion >= 2 && player.snapshotStream) {
        player.snapshotStream.forceKeyframe = true;
      }
      networkStats.resyncRequests += 1;
      return;
    }

    if (type === "snapshot_ack") {
      const snapshotSeq = Number(data.snapshotSeq);
      const stream = player.snapshotStream;
      if (
        stream &&
        Number.isInteger(snapshotSeq) &&
        snapshotSeq > stream.lastDeliveryAckSeq &&
        snapshotSeq <= stream.sequence
      ) {
        stream.lastDeliveryAckSeq = snapshotSeq;
        stream.lastDeliveryAckAt = Date.now();
      }
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
    const tier = Math.max(0, Math.min(2, Number(player.snapshotStream?.rateTier) || 0));
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
});
matchRuntime.runServerLoop();

console.log(`网络对战服务器已启动 ws://localhost:${PORT}`);
