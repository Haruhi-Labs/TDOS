import { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";
import {
  cloneLoadout,
  DEFAULT_AI_LOADOUT,
  randomAiLoadout,
  DEFAULT_TEAM_LOADOUT,
  MatchSimulation,
  DEFAULT_WORLD_SIZE,
  TICK_RATE,
  SNAPSHOT_RATE,
  TICK_DT,
  normalizeLoadout,
} from "../shared/game-core.js";
import {
  createStatePatch,
  quantizeNetworkState,
} from "../shared/network-patch.js";

function envInteger(name, fallback, min, max) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

const PORT = Number(process.env.PORT || 21246);
const NETWORK_BUILD = "network-guard-20260724-01";
const NETWORK_PROTOCOL_VERSION = 2;
const SNAPSHOT_INTERVAL = 1 / SNAPSHOT_RATE;
const ROOM_CAPACITY = 2;
const MAX_CATCHUP_STEPS = 6;
const LOOP_IDLE_MS = 2;
const PVP_COUNTDOWN_MS = 3000;
const MAX_SNAPSHOT_BUFFERED_BYTES = 128 * 1024;
const SNAPSHOT_KEYFRAME_INTERVAL = SNAPSHOT_RATE * 5;
const MAX_DELTA_TO_FULL_RATIO = 0.8;
const PLAYER_STREAM_DIVISORS = [1, 2, 3];
const SPECTATOR_STREAM_DIVISORS = [2, 3, 5];
const CONGESTION_BUFFERED_BYTES = 24 * 1024;
const SEVERE_CONGESTION_BUFFERED_BYTES = 96 * 1024;
const CONGESTION_INFLIGHT_SNAPSHOTS = 12;
const SEVERE_CONGESTION_INFLIGHT_SNAPSHOTS = 30;
const CONGESTION_ACK_AGE_MS = 1200;
const SEVERE_CONGESTION_ACK_AGE_MS = 3000;
const STREAM_RECOVERY_STABLE_MS = 4000;
const LOBBY_BROADCAST_DEBOUNCE_MS = 30;
const MAX_PAYLOAD_BYTES = envInteger("MAX_PAYLOAD_BYTES", 16 * 1024, 1024, 64 * 1024);
const MAX_CONNECTIONS = envInteger("MAX_CONNECTIONS", 256, 8, 4096);
const MAX_ROOMS = envInteger("MAX_ROOMS", 64, 4, 1024);
const MAX_ACTIVE_ROOMS = envInteger("MAX_ACTIVE_ROOMS", 16, 2, 512);
const MAX_SPECTATORS_PER_ROOM = envInteger("MAX_SPECTATORS_PER_ROOM", 24, 1, 256);
const MAX_STREAM_CAPACITY_UNITS = envInteger("MAX_STREAM_CAPACITY_UNITS", 72, 4, 2048);
const HEARTBEAT_INTERVAL_MS = envInteger("HEARTBEAT_INTERVAL_MS", 30_000, 100, 120_000);
const NETWORK_METRICS_INTERVAL_MS = envInteger("NETWORK_METRICS_INTERVAL_MS", 60_000, 1000, 600_000);

const players = new Map();
const rooms = new Map();
let nextSnapshotStreamPhase = 0;
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
const CONTROL_MESSAGE_TYPES = new Set([
  "set_name",
  "set_loadout",
  "list_rooms",
  "create_room",
  "join_room",
  "spectate_room",
  "join_private",
  "leave_room",
]);

const MESSAGE_CODES = {
  "房间已关闭": "room_closed",
  "对手离开房间": "opponent_left",
  "对手断开连接，房间已解散": "opponent_disconnected",
  "对局结束，已返回大厅": "match_ended_draw",
  "你已经在房间中": "already_in_room",
  "房间不存在": "room_not_found",
  "该房间不接受玩家加入": "room_not_joinable",
  "该房间不接受观战": "room_not_spectatable",
  "房间不在等待状态": "room_not_waiting",
  "房间不在对战状态": "room_not_running",
  "房间已满或不可加入": "room_full",
  "消息格式错误": "invalid_message_format",
  "未知消息类型": "unknown_message_type",
  "服务器连接数已满": "server_connection_limit",
  "服务器房间数已满": "server_room_limit",
  "服务器活跃对局已满": "server_active_room_limit",
  "服务器实时流容量已满": "server_stream_capacity_limit",
  "该房间观战人数已满": "room_spectator_limit",
};

function messageCode(message, fallback = "unknown") {
  const raw = String(message || "");
  if (MESSAGE_CODES[raw]) {
    return MESSAGE_CODES[raw];
  }
  if (raw.includes("左翼舰队获胜")) {
    return "match_ended_left_win";
  }
  if (raw.includes("右翼舰队获胜")) {
    return "match_ended_right_win";
  }
  return fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function activeRoomCount() {
  let count = 0;
  for (const room of rooms.values()) {
    if (room.status === "countdown" || room.status === "running") {
      count += 1;
    }
  }
  return count;
}

function streamCapacityUnits() {
  let units = 0;
  for (const player of players.values()) {
    if (!player.roomId) {
      continue;
    }
    const room = rooms.get(player.roomId);
    if (!room || (room.status !== "countdown" && room.status !== "running")) {
      continue;
    }
    units += player.spectating ? 1 : player.seat ? 2 : 0;
  }
  return units;
}

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

function createRoomId() {
  let id = "";
  do {
    id = String(Math.floor(Math.random() * 900000 + 100000));
  } while (rooms.has(id));
  return id;
}

function createPrivateCode() {
  const existing = new Set();
  for (const room of rooms.values()) {
    if (room.code) {
      existing.add(room.code);
    }
  }
  let code = "";
  do {
    code = String(Math.floor(Math.random() * 900000 + 100000));
  } while (existing.has(code));
  return code;
}

function send(ws, payload) {
  if (!ws || ws.readyState !== 1) {
    return;
  }
  ws.send(JSON.stringify(payload));
}

function sendToPlayer(player, payload) {
  if (!player) {
    return;
  }
  send(player.ws, payload);
}

function resetSnapshotStream(player) {
  if (!player) {
    return;
  }
  nextSnapshotStreamPhase += 1;
  player.snapshotStream = {
    sequence: 0,
    lastState: null,
    lastRoomSnapshotSeq: 0,
    lastKeyframeRoomSeq: 0,
    forceKeyframe: true,
    rateTier: 0,
    phase: nextSnapshotStreamPhase,
    lastDeliveryAckSeq: 0,
    lastDeliveryAckAt: Date.now(),
    healthySince: 0,
  };
}

function streamDivisors(options) {
  return options.spectating ? SPECTATOR_STREAM_DIVISORS : PLAYER_STREAM_DIVISORS;
}

function updateStreamCongestion(player, now, options) {
  const stream = player.snapshotStream;
  const bufferedBytes = Number(player.ws.bufferedAmount) || 0;
  const inFlight = Math.max(0, stream.sequence - stream.lastDeliveryAckSeq);
  // 已全部确认时没有在途数据，等待阶段即使很久没有新 ACK 也不属于拥塞。
  const ackAge = inFlight > 0 ? Math.max(0, now - stream.lastDeliveryAckAt) : 0;
  const severe =
    bufferedBytes >= SEVERE_CONGESTION_BUFFERED_BYTES ||
    inFlight >= SEVERE_CONGESTION_INFLIGHT_SNAPSHOTS ||
    ackAge >= SEVERE_CONGESTION_ACK_AGE_MS;
  const congested =
    severe ||
    bufferedBytes >= CONGESTION_BUFFERED_BYTES ||
    inFlight >= CONGESTION_INFLIGHT_SNAPSHOTS ||
    ackAge >= CONGESTION_ACK_AGE_MS;
  const maxTier = streamDivisors(options).length - 1;
  const previousTier = stream.rateTier;

  if (severe && stream.rateTier < maxTier) {
    stream.rateTier = maxTier;
    stream.healthySince = 0;
  } else if (congested && stream.rateTier < 1) {
    stream.rateTier = 1;
    stream.healthySince = 0;
  } else if (congested) {
    stream.healthySince = 0;
  } else {
    const healthy =
      bufferedBytes < 8 * 1024 &&
      inFlight <= 5 &&
      ackAge < 800;
    if (!healthy || stream.rateTier <= 0) {
      stream.healthySince = 0;
    } else if (!stream.healthySince) {
      stream.healthySince = now;
    } else if (now - stream.healthySince >= STREAM_RECOVERY_STABLE_MS) {
      stream.rateTier -= 1;
      stream.healthySince = 0;
    }
  }
  if (stream.rateTier !== previousTier) {
    networkStats.streamTierChanges += 1;
  }
}

function sendSnapshotToPlayer(player, frame, options = {}) {
  if (!player || !player.ws || player.ws.readyState !== 1) {
    return false;
  }
  // 战场快照是可替换状态，不应在慢连接上无限排队。积压超过阈值时直接跳过旧帧，
  // 等发送缓冲恢复后再下发最新快照，避免延迟从数百毫秒滚成数秒并拖高进程内存。
  if (player.ws.bufferedAmount > MAX_SNAPSHOT_BUFFERED_BYTES) {
    player.skippedSnapshots = (player.skippedSnapshots || 0) + 1;
    networkStats.skippedSnapshots += 1;
    if (player.snapshotStream) {
      player.snapshotStream.forceKeyframe = true;
    }
    return false;
  }

  if (!player.snapshotStream) {
    resetSnapshotStream(player);
  }
  const stream = player.snapshotStream;
  const now = Date.now();
  const supportsDeltaProtocol = Number(player.networkProtocolVersion) >= 2;
  if (supportsDeltaProtocol) {
    updateStreamCongestion(player, now, options);
  } else {
    stream.rateTier = 0;
    stream.healthySince = 0;
  }
  const divisors = streamDivisors(options);
  const divisor = divisors[Math.min(stream.rateTier, divisors.length - 1)];
  if (!stream.forceKeyframe && frame.roomSnapshotSeq % divisor !== stream.phase % divisor) {
    return false;
  }
  const snapshotSeq = stream.sequence + 1;
  const header = {
    roomId: frame.roomId,
    snapshotSeq,
    serverFrame: frame.roomSnapshotSeq,
    tick: frame.tick,
    simTime: frame.simTime,
    serverTime: frame.serverTime,
    snapshotRate: SNAPSHOT_RATE / divisor,
    streamTier: stream.rateTier,
    ackSeq: Number(options.ackSeq) || 0,
  };
  if (options.spectating) {
    header.spectating = true;
  }
  // 长门雷达属于席位私有的间接情报，不进入共享 state / 差量缓存；
  // 只有该长门玩家自己的快照消息头会携带，对手与观战者均收不到。
  if (options.radar) {
    header.radar = options.radar;
  }

  const keyframeDue =
    !supportsDeltaProtocol ||
    stream.forceKeyframe ||
    !stream.lastState ||
    frame.roomSnapshotSeq - stream.lastKeyframeRoomSeq >= SNAPSHOT_KEYFRAME_INTERVAL;
  let serialized = null;
  let keyframe = keyframeDue;

  if (!keyframeDue) {
    const baseRoomSeq = stream.lastRoomSnapshotSeq;
    let patch = frame.patchCache.get(baseRoomSeq);
    if (!frame.patchCache.has(baseRoomSeq)) {
      // 同一房间、同一发送档位的连接拥有相同基线。差量树只计算一次，
      // 玩家与观战扇出时复用结果，避免连接数增加后重复遍历整份战场状态。
      patch = createStatePatch(stream.lastState, frame.state);
      frame.patchCache.set(baseRoomSeq, patch);
    }
    const deltaPayload = {
      type: "snapshot_delta",
      ...header,
      baseSnapshotSeq: stream.sequence,
      patch,
    };
    const deltaText = JSON.stringify(deltaPayload);
    const privateBytes = options.radar ? Buffer.byteLength(JSON.stringify(options.radar)) : 0;
    if (Buffer.byteLength(deltaText) <= (frame.stateBytes + privateBytes) * MAX_DELTA_TO_FULL_RATIO) {
      serialized = deltaText;
    } else {
      keyframe = true;
    }
  }

  if (!serialized) {
    serialized = JSON.stringify({
      type: "snapshot",
      ...header,
      state: frame.state,
    });
  }

  player.ws.send(serialized);
  networkStats.snapshotMessages += 1;
  networkStats.snapshotRawBytes += Buffer.byteLength(serialized);
  if (keyframe) {
    networkStats.keyframes += 1;
  } else {
    networkStats.deltas += 1;
  }
  stream.sequence = snapshotSeq;
  stream.lastState = frame.state;
  stream.lastRoomSnapshotSeq = frame.roomSnapshotSeq;
  stream.forceKeyframe = false;
  if (keyframe) {
    stream.lastKeyframeRoomSeq = frame.roomSnapshotSeq;
  }
  return true;
}

function sendError(player, message) {
  sendToPlayer(player, {
    type: "error",
    code: messageCode(message, "unknown_error"),
    message,
  });
}

function getPlayerById(playerId) {
  if (!playerId) {
    return null;
  }
  return players.get(playerId) || null;
}

function connectedCount(room) {
  return [room.seats.A, room.seats.B].filter(Boolean).length;
}

function roomSpectators(room) {
  const list = [];
  if (!room || !room.spectators) {
    return list;
  }
  for (const playerId of [...room.spectators]) {
    const player = getPlayerById(playerId);
    if (player && player.roomId === room.id && player.spectating) {
      list.push(player);
    } else {
      room.spectators.delete(playerId);
    }
  }
  return list;
}

function spectatorCount(room) {
  return roomSpectators(room).length;
}

function seatPlayerRows(room) {
  const rows = [];
  const pA = getPlayerById(room.seats.A);
  const pB = getPlayerById(room.seats.B);

  rows.push({
    seat: "A",
    name: pA ? pA.name : "空位",
    playerId: pA ? pA.id : null,
    loadout: pA ? pA.loadout : null,
    isBot: false,
  });

  if (room.mode === "ai") {
    rows.push({
      seat: "B",
      name: "统合思念体AI",
      playerId: null,
      loadout: cloneLoadout(room.aiLoadout || DEFAULT_AI_LOADOUT),
      isBot: true,
    });
  } else {
    rows.push({
      seat: "B",
      name: pB ? pB.name : "空位",
      playerId: pB ? pB.id : null,
      loadout: pB ? pB.loadout : null,
      isBot: false,
    });
  }

  return rows;
}

function buildMatchResult(room) {
  return {
    roomId: room.id,
    winnerSeat: room.match ? room.match.winnerSeat : null,
    finishedAt: Date.now(),
    players: seatPlayerRows(room).map((row) => ({
      ...row,
      loadout: row.loadout ? cloneLoadout(row.loadout) : null,
    })),
  };
}

function displayPlayerRows(room) {
  if (room && room.result && Array.isArray(room.result.players)) {
    return room.result.players;
  }
  return seatPlayerRows(room);
}

function buildRoomStatePayload(room, viewerId = null) {
  const viewer = viewerId ? getPlayerById(viewerId) : null;
  const isMember = viewer && viewer.roomId === room.id && !viewer.spectating;
  const result = room.result || null;
  return {
    type: "room_state",
    room: {
      roomId: room.id,
      mode: room.mode,
      visibility: room.visibility,
      code: room.visibility === "private" && isMember ? room.code : null,
      status: room.status,
      countdownEndsAt: room.countdownEndsAt || null,
      players: displayPlayerRows(room),
      spectatorCount: spectatorCount(room),
      winnerSeat: result ? result.winnerSeat : room.match ? room.match.winnerSeat : null,
      finishedAt: result ? result.finishedAt : room.finishedAt,
      createdAt: room.createdAt,
    },
    self: viewer
      ? {
          playerId: viewer.id,
          seat: viewer.seat,
          spectating: Boolean(viewer.spectating),
          loadout: viewer.loadout,
        }
      : null,
  };
}

function buildLobbyPayload() {
  const list = [];
  for (const room of rooms.values()) {
    if (room.visibility !== "public") {
      continue;
    }
    const host = getPlayerById(room.seats.A);
    const resultHost = room.result && Array.isArray(room.result.players)
      ? room.result.players.find((row) => row.seat === "A")
      : null;
    list.push({
      roomId: room.id,
      mode: room.mode,
      visibility: room.visibility,
      status: room.status,
      count: connectedCount(room),
      capacity: ROOM_CAPACITY,
      spectatorCount: spectatorCount(room),
      hostName: host ? host.name : resultHost ? resultHost.name : "未知",
      createdAt: room.createdAt,
    });
  }

  list.sort((a, b) => b.createdAt - a.createdAt);

  return {
    type: "lobby",
    rooms: list,
    now: Date.now(),
  };
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

function assignPlayerToRoom(player, room, seat) {
  player.roomId = room.id;
  player.seat = seat;
  player.spectating = false;
  player.inputQueue = [];
  player.lastProcessedSeq = 0;
  player.lastQueuedSeq = 0;
  player.selectedShipKey = "main";
  resetSnapshotStream(player);
  room.seats[seat] = player.id;
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

function closeRoom(roomId, reason = "房间已关闭") {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  const pA = getPlayerById(room.seats.A);
  const pB = getPlayerById(room.seats.B);
  const recipients = new Map();

  for (const p of [pA, pB]) {
    if (!p) {
      continue;
    }
    recipients.set(p.id, p);
  }
  for (const p of roomSpectators(room)) {
    recipients.set(p.id, p);
  }

  for (const p of recipients.values()) {
    p.roomId = null;
    p.seat = null;
    p.spectating = false;
    p.inputQueue = [];
    p.lastProcessedSeq = 0;
    p.lastQueuedSeq = 0;
    resetSnapshotStream(p);
    sendToPlayer(p, {
      type: "room_closed",
      reasonCode: messageCode(reason, "room_closed"),
      reason,
    });
  }

  rooms.delete(roomId);
  broadcastLobby();
}

function leaveRoom(player, reasonForOthers = "对手离开房间") {
  if (!player.roomId) {
    return;
  }

  const room = rooms.get(player.roomId);
  const oldRoomId = player.roomId;
  if (!room) {
    player.roomId = null;
    player.seat = null;
    player.spectating = false;
    player.inputQueue = [];
    player.lastProcessedSeq = 0;
    player.lastQueuedSeq = 0;
    resetSnapshotStream(player);
    return;
  }

  if (player.spectating) {
    if (room.spectators) {
      room.spectators.delete(player.id);
    }
    player.roomId = null;
    player.seat = null;
    player.spectating = false;
    player.inputQueue = [];
    player.lastProcessedSeq = 0;
    player.lastQueuedSeq = 0;
    resetSnapshotStream(player);
    if (room.status === "finished" && connectedCount(room) === 0 && spectatorCount(room) === 0) {
      rooms.delete(oldRoomId);
      broadcastLobby();
      return;
    }
    sendRoomStateToMembers(room);
    broadcastLobby();
    return;
  }

  player.roomId = null;
  player.seat = null;
  player.spectating = false;
  player.inputQueue = [];
  player.lastProcessedSeq = 0;
  player.lastQueuedSeq = 0;
  resetSnapshotStream(player);

  if (room.seats.A === player.id) {
    room.seats.A = null;
  }
  if (room.seats.B === player.id) {
    room.seats.B = null;
  }

  if (room.status === "countdown" || room.status === "running") {
    closeRoom(oldRoomId, reasonForOthers);
    return;
  }

  if (room.status === "finished") {
    if (connectedCount(room) === 0 && spectatorCount(room) === 0) {
      rooms.delete(oldRoomId);
      broadcastLobby();
      return;
    }
    sendRoomStateToMembers(room);
    broadcastLobby();
    return;
  }

  if (room.seats.A === null && room.seats.B) {
    const moved = getPlayerById(room.seats.B);
    room.seats.A = room.seats.B;
    room.seats.B = null;
    if (moved) {
      moved.seat = "A";
    }
  }

  if (!room.seats.A && !room.seats.B) {
    rooms.delete(oldRoomId);
    broadcastLobby();
    return;
  }

  sendRoomStateToMembers(room);
  broadcastLobby();
}

function createRoom(player, visibility, mode) {
  if (player.roomId) {
    return { ok: false, message: "你已经在房间中" };
  }

  const safeVisibility = visibility === "private" ? "private" : "public";
  const safeMode = mode === "ai" ? "ai" : "pvp";
  if (rooms.size >= MAX_ROOMS) {
    return { ok: false, message: "服务器房间数已满" };
  }
  if (safeMode === "ai" && activeRoomCount() >= MAX_ACTIVE_ROOMS) {
    return { ok: false, message: "服务器活跃对局已满" };
  }
  if (safeMode === "ai" && streamCapacityUnits() + 2 > MAX_STREAM_CAPACITY_UNITS) {
    return { ok: false, message: "服务器实时流容量已满" };
  }

  const room = {
    id: createRoomId(),
    mode: safeMode,
    visibility: safeVisibility,
    code: safeVisibility === "private" ? createPrivateCode() : null,
    status: "waiting",
    countdownEndsAt: null,
    seats: {
      A: null,
      B: null,
    },
    createdAt: Date.now(),
    match: null,
    snapshotAccumulator: 0,
    snapshotSeq: 0,
    finishedAt: null,
    result: null,
    spectators: new Set(),
    // AI 房:每房生成一次随机阵容(主舰不含长门/鹤屋),房间展示与开局共用同一份
    aiLoadout: safeMode === "ai" ? randomAiLoadout() : null,
  };

  rooms.set(room.id, room);
  assignPlayerToRoom(player, room, "A");

  if (room.mode === "ai") {
    startMatch(room);
  } else {
    sendRoomStateToMembers(room);
  }

  broadcastLobby();
  return { ok: true, room };
}

function joinRoom(player, room) {
  if (!room) {
    return { ok: false, message: "房间不存在" };
  }
  if (player.roomId) {
    return { ok: false, message: "你已经在房间中" };
  }
  if (room.mode !== "pvp") {
    return { ok: false, message: "该房间不接受玩家加入" };
  }
  if (room.status !== "waiting") {
    return { ok: false, message: "房间不在等待状态" };
  }
  if (!room.seats.A || room.seats.B) {
    return { ok: false, message: "房间已满或不可加入" };
  }
  if (activeRoomCount() >= MAX_ACTIVE_ROOMS) {
    return { ok: false, message: "服务器活跃对局已满" };
  }
  // 当前1v1开局后会新增两条15Hz玩家流；未来3v3接入时按实际参战人数扩展此权重。
  if (streamCapacityUnits() + 4 > MAX_STREAM_CAPACITY_UNITS) {
    return { ok: false, message: "服务器实时流容量已满" };
  }

  assignPlayerToRoom(player, room, "B");
  startMatch(room);
  broadcastLobby();
  return { ok: true };
}

function spectateRoom(player, room) {
  if (!room) {
    return { ok: false, message: "房间不存在" };
  }
  if (player.roomId) {
    return { ok: false, message: "你已经在房间中" };
  }
  if (room.visibility !== "public") {
    return { ok: false, message: "该房间不接受观战" };
  }
  if (room.status !== "running" || !room.match) {
    return { ok: false, message: "房间不在对战状态" };
  }
  if (spectatorCount(room) >= MAX_SPECTATORS_PER_ROOM) {
    return { ok: false, message: "该房间观战人数已满" };
  }
  if (streamCapacityUnits() + 1 > MAX_STREAM_CAPACITY_UNITS) {
    return { ok: false, message: "服务器实时流容量已满" };
  }

  player.roomId = room.id;
  player.seat = null;
  player.spectating = true;
  player.inputQueue = [];
  player.lastProcessedSeq = 0;
  player.lastQueuedSeq = 0;
  player.selectedShipKey = "main";
  resetSnapshotStream(player);
  if (!room.spectators) {
    room.spectators = new Set();
  }
  room.spectators.add(player.id);

  sendRoomStateToMembers(room);
  broadcastLobby();
  return { ok: true };
}

function handleInput(player, data) {
  if (!player.roomId || !player.seat) {
    return;
  }
  const room = rooms.get(player.roomId);
  if (!room || room.status !== "running" || !room.match) {
    return;
  }
  const seq = Number(data.seq);
  if (!Number.isInteger(seq) || seq <= 0) {
    return;
  }
  const action = data.action;
  if (!action || typeof action !== "object") {
    return;
  }
  if (seq <= player.lastProcessedSeq || seq <= (player.lastQueuedSeq || 0)) {
    return;
  }
  player.lastQueuedSeq = seq;
  const queued = {
    seq,
    action,
  };
  const replaceable = action.type === "route_control" || action.type === "route_end" || action.type === "set_throttle";
  const lastQueued = player.inputQueue[player.inputQueue.length - 1];
  if (
    replaceable &&
    lastQueued &&
    lastQueued.action?.type === action.type &&
    String(lastQueued.action?.shipKey || "main") === String(action.shipKey || "main")
  ) {
    player.inputQueue[player.inputQueue.length - 1] = queued;
    networkStats.coalescedInputs += 1;
  } else {
    player.inputQueue.push(queued);
  }
  if (player.inputQueue.length > 90) {
    player.inputQueue.splice(0, player.inputQueue.length - 90);
  }
}

function applyQueuedInputs(room) {
  for (const seat of ["A", "B"]) {
    const playerId = room.seats[seat];
    const player = getPlayerById(playerId);
    if (!player) {
      continue;
    }

    let handled = 0;
    while (player.inputQueue.length > 0 && handled < 30) {
      const item = player.inputQueue.shift();
      if (!item || !Number.isInteger(item.seq)) {
        continue;
      }
      if (item.seq <= player.lastProcessedSeq) {
        continue;
      }
      room.match.applyActionForSeat(seat, item.action);
      player.lastProcessedSeq = item.seq;
      handled += 1;
    }

    if (player.inputQueue.length > 90) {
      player.inputQueue.splice(0, player.inputQueue.length - 90);
    }
  }
}

function validShipKey(shipKey) {
  return shipKey === "main" || shipKey === "sub1" || shipKey === "sub2" ? shipKey : "main";
}

function selectedShipsForRoom(room) {
  const pA = getPlayerById(room.seats.A);
  const pB = getPlayerById(room.seats.B);
  return {
    A: validShipKey(pA ? pA.selectedShipKey : "main"),
    B: validShipKey(pB ? pB.selectedShipKey : "main"),
  };
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
      const room = [...rooms.values()].find((item) => item.visibility === "private" && item.code === code) || null;
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

function tickRooms() {
  for (const room of rooms.values()) {
    if (room.status === "countdown" && room.match) {
      if (Date.now() < Number(room.countdownEndsAt || 0)) {
        continue;
      }
      room.status = "running";
      room.countdownEndsAt = null;
      sendRoomStateToMembers(room);
      sendSnapshot(room);
      broadcastLobby();
    }

    if (room.status === "running" && room.match) {
      applyQueuedInputs(room);
      room.match.update(TICK_DT);

      room.snapshotAccumulator += TICK_DT;
      while (room.snapshotAccumulator >= SNAPSHOT_INTERVAL) {
        room.snapshotAccumulator -= SNAPSHOT_INTERVAL;
        sendSnapshot(room);
      }

      if (room.match.phase === "finished" && room.status !== "finished") {
        room.status = "finished";
        room.finishedAt = Date.now();
        room.result = buildMatchResult(room);
        sendSnapshot(room);
        sendRoomStateToMembers(room);
        broadcastLobby();
      }
    }
  }
}

let lastLoopTimeMs = Date.now();
let loopAccumulator = 0;

function runServerLoop() {
  const now = Date.now();
  const frameSec = clamp((now - lastLoopTimeMs) / 1000, 0, 0.25);
  lastLoopTimeMs = now;
  loopAccumulator += frameSec;

  let steps = 0;
  while (loopAccumulator >= TICK_DT && steps < MAX_CATCHUP_STEPS) {
    tickRooms();
    loopAccumulator -= TICK_DT;
    steps += 1;
  }

  if (steps >= MAX_CATCHUP_STEPS) {
    loopAccumulator = 0;
  }
  setTimeout(runServerLoop, LOOP_IDLE_MS);
}

runServerLoop();

console.log(`网络对战服务器已启动 ws://localhost:${PORT}`);
