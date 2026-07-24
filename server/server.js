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

const PORT = Number(process.env.PORT || 21246);
const HOST = process.env.HOST || "0.0.0.0";
const NETWORK_BUILD = "spectator-throttle-20260719-01";
const SNAPSHOT_INTERVAL = 1 / SNAPSHOT_RATE;
const ROOM_CAPACITY = 2;
const PVP2V2_MODE = "pvp2v2";
const PVP2V2_SEATS = Object.freeze(["A1", "A2", "B1", "B2"]);
const LEGACY_SEATS = Object.freeze(["A", "B"]);
const MAX_CATCHUP_STEPS = 6;
const LOOP_IDLE_MS = 2;
const PVP_COUNTDOWN_MS = 3000;
const MAX_SNAPSHOT_BUFFERED_BYTES = 128 * 1024;
const SPECTATOR_SNAPSHOT_DIVISOR = 2;
const TEAM_COMM_MIN_INTERVAL_MS = 800;
const TEAM_COMM_TTL_MS = 8000;
const TEAM_COMM_MAX_PER_ALLIANCE = 12;
const TEAM_COMM_TYPES = Object.freeze(["attack", "support", "danger", "retreat", "ack", "emoji"]);
const TEAM_COMM_POINT_TYPES = Object.freeze(["attack", "support", "danger", "retreat"]);
const PVP2V2_RECONNECT_WINDOW_MS = 45_000;

const players = new Map();
const rooms = new Map();

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

function sendSnapshotToPlayer(player, payload) {
  if (!player || !player.ws || player.ws.readyState !== 1) {
    return;
  }
  // 战场快照是可替换状态，不应在慢连接上无限排队。积压超过阈值时直接跳过旧帧，
  // 等发送缓冲恢复后再下发最新快照，避免延迟从数百毫秒滚成数秒并拖高进程内存。
  if (player.ws.bufferedAmount > MAX_SNAPSHOT_BUFFERED_BYTES) {
    player.skippedSnapshots = (player.skippedSnapshots || 0) + 1;
    return;
  }
  sendToPlayer(player, payload);
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

function isTwoVsTwoRoom(roomOrMode) {
  const mode = typeof roomOrMode === "string" ? roomOrMode : roomOrMode?.mode;
  return mode === PVP2V2_MODE;
}

function seatListForMode(mode) {
  return mode === PVP2V2_MODE ? [...PVP2V2_SEATS] : [...LEGACY_SEATS];
}

function seatListForRoom(room) {
  return seatListForMode(room?.mode);
}

function capacityForMode(mode) {
  return isTwoVsTwoRoom(mode) ? PVP2V2_SEATS.length : ROOM_CAPACITY;
}

function allianceIdForSeat(seat) {
  return String(seat || "").toUpperCase().startsWith("B") ? "B" : "A";
}

function safeTeamCommType(value) {
  const type = String(value || "").trim().toLowerCase();
  return TEAM_COMM_TYPES.includes(type) ? type : null;
}

function teamCommNeedsPoint(commType) {
  return TEAM_COMM_POINT_TYPES.includes(commType);
}

function normalizeTeamCommAnchor(anchor) {
  if (!anchor) {
    return null;
  }
  if (String(anchor.type || "point") !== "point") {
    return null;
  }
  const x = Number(anchor.x);
  const y = Number(anchor.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  if (x < 0 || x > DEFAULT_WORLD_SIZE || y < 0 || y > DEFAULT_WORLD_SIZE) {
    return null;
  }
  return {
    type: "point",
    x: Math.round(x),
    y: Math.round(y),
  };
}

function normalizeTeamCommReplyTo(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }
  return raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48) || null;
}

function teamCommStoreForRoom(room) {
  if (!room.teamComms) {
    room.teamComms = { A: [], B: [] };
  }
  if (!Array.isArray(room.teamComms.A)) {
    room.teamComms.A = [];
  }
  if (!Array.isArray(room.teamComms.B)) {
    room.teamComms.B = [];
  }
  return room.teamComms;
}

function pruneTeamComms(room, now = Date.now()) {
  const store = teamCommStoreForRoom(room);
  for (const allianceId of ["A", "B"]) {
    store[allianceId] = store[allianceId].filter((event) => Number(event.expiresAt) > now);
    while (store[allianceId].length > TEAM_COMM_MAX_PER_ALLIANCE) {
      store[allianceId].shift();
    }
  }
}

function playersForAlliance(room, allianceId) {
  const list = [];
  for (const seat of seatListForRoom(room)) {
    if (allianceIdForSeat(seat) !== allianceId) {
      continue;
    }
    const player = getPlayerById(room.seats[seat]);
    if (player && player.roomId === room.id && !player.spectating) {
      list.push(player);
    }
  }
  return list;
}

function reconnectSlotStoreForRoom(room) {
  if (!room.reconnectSlots || typeof room.reconnectSlots !== "object") {
    room.reconnectSlots = {};
  }
  return room.reconnectSlots;
}

function pruneReconnectSlots(room, now = Date.now()) {
  if (!room || !room.reconnectSlots) {
    return;
  }
  for (const seat of seatListForRoom(room)) {
    const slot = room.reconnectSlots[seat];
    if (!slot) {
      continue;
    }
    if (Number(slot.expiresAt || 0) <= now) {
      delete room.reconnectSlots[seat];
      if (!room.seats[seat] && room.ready) {
        room.ready[seat] = false;
      }
    }
  }
}

function activeReconnectCount(room) {
  pruneReconnectSlots(room);
  if (!room || !room.reconnectSlots) {
    return 0;
  }
  return seatListForRoom(room).filter((seat) => Boolean(room.reconnectSlots[seat])).length;
}

function reserveReconnectSlot(room, player, seat, now = Date.now()) {
  if (!room || !player || !seat || !isTwoVsTwoRoom(room)) {
    return null;
  }
  const store = reconnectSlotStoreForRoom(room);
  const token = player.reconnectToken || randomUUID();
  const slot = {
    seat,
    name: player.name,
    loadout: cloneLoadout(player.loadout || DEFAULT_TEAM_LOADOUT),
    selectedShipKey: validShipKey(player.selectedShipKey),
    lastProcessedSeq: Number(player.lastProcessedSeq) || 0,
    lastTeamCommAt: Number(player.lastTeamCommAt) || 0,
    ready: Boolean(room.ready?.[seat]),
    reconnectToken: token,
    disconnectedAt: now,
    expiresAt: now + PVP2V2_RECONNECT_WINDOW_MS,
  };
  store[seat] = slot;
  return slot;
}

function applyDisconnectGuard(room, seat) {
  if (!room || !room.match || !seat) {
    return;
  }
  for (const shipKey of ["main", "sub1", "sub2"]) {
    room.match.applyActionForSeat(seat, {
      type: "clear_route",
      shipKey,
    });
    room.match.applyActionForSeat(seat, {
      type: "set_throttle",
      shipKey,
      throttle: 0.25,
    });
  }
}

function connectedCount(room) {
  return seatListForRoom(room).filter((seat) => Boolean(room.seats[seat])).length;
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
  pruneReconnectSlots(room);
  for (const seat of seatListForRoom(room)) {
    const player = getPlayerById(room.seats[seat]);
    const reconnectSlot = room.reconnectSlots?.[seat] || null;
    if (room.mode === "ai" && seat === "B") {
      rows.push({
        seat,
        allianceId: allianceIdForSeat(seat),
        name: "统合思念体AI",
        playerId: null,
        loadout: cloneLoadout(room.aiLoadout || DEFAULT_AI_LOADOUT),
        isBot: true,
        ready: true,
      });
      continue;
    }
    rows.push({
      seat,
      allianceId: allianceIdForSeat(seat),
      name: player ? player.name : reconnectSlot ? reconnectSlot.name : "空位",
      playerId: player ? player.id : null,
      loadout: player ? player.loadout : reconnectSlot ? cloneLoadout(reconnectSlot.loadout || DEFAULT_TEAM_LOADOUT) : null,
      isBot: false,
      ready: player ? Boolean(room.ready?.[seat]) : Boolean(reconnectSlot?.ready),
      disconnected: Boolean(!player && reconnectSlot),
      reconnectExpiresAt: reconnectSlot ? reconnectSlot.expiresAt : null,
    });
  }

  return rows;
}

function buildMatchResult(room) {
  return {
    roomId: room.id,
    winnerSeat: room.match ? room.match.winnerSeat : null,
    winnerAllianceId: room.match ? room.match.winnerAllianceId : null,
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
      capacity: capacityForMode(room.mode),
      spectatorCount: spectatorCount(room),
      winnerSeat: result ? result.winnerSeat : room.match ? room.match.winnerSeat : null,
      winnerAllianceId: result ? result.winnerAllianceId : room.match ? room.match.winnerAllianceId : null,
      finishedAt: result ? result.finishedAt : room.finishedAt,
      createdAt: room.createdAt,
    },
    self: viewer
        ? {
          playerId: viewer.id,
          seat: viewer.seat,
          allianceId: viewer.seat ? allianceIdForSeat(viewer.seat) : null,
          fleetId: viewer.seat,
          ready: viewer.seat ? Boolean(room.ready?.[viewer.seat]) : false,
          spectating: Boolean(viewer.spectating),
          loadout: viewer.loadout,
          reconnectToken: isMember ? viewer.reconnectToken || null : null,
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
    const hostSeat = seatListForRoom(room)[0];
    const host = getPlayerById(room.seats[hostSeat]);
    const hostReconnectSlot = room.reconnectSlots?.[hostSeat] || null;
    const resultHost = room.result && Array.isArray(room.result.players)
      ? room.result.players.find((row) => row.seat === hostSeat)
      : null;
    list.push({
      roomId: room.id,
      mode: room.mode,
      visibility: room.visibility,
      status: room.status,
      count: connectedCount(room),
      capacity: capacityForMode(room.mode),
      spectatorCount: spectatorCount(room),
      hostName: host ? host.name : resultHost ? resultHost.name : hostReconnectSlot ? hostReconnectSlot.name : "未知",
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

function broadcastLobby() {
  const payload = buildLobbyPayload();
  for (const player of players.values()) {
    sendToPlayer(player, payload);
  }
}

function sendRoomStateToMembers(room) {
  const sent = new Set();
  for (const seat of seatListForRoom(room)) {
    const player = getPlayerById(room.seats[seat]);
    if (!player) {
      continue;
    }
    sent.add(player.id);
    sendToPlayer(player, buildRoomStatePayload(room, player.id));
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
  player.selectedShipKey = "main";
  player.ready = false;
  player.lastTeamCommAt = 0;
  player.reconnectToken = player.reconnectToken || randomUUID();
  room.seats[seat] = player.id;
  if (!room.ready) {
    room.ready = {};
  }
  room.ready[seat] = false;
}

function startMatch(room) {
  if (room.status === "countdown" || room.status === "running") {
    return;
  }

  const seats = seatListForRoom(room);
  const teamNames = {};
  const teamLoadouts = {};
  for (const seat of seats) {
    const player = getPlayerById(room.seats[seat]);
    if (room.mode === "ai" && seat === "B") {
      teamNames[seat] = "统合思念体AI舰队";
      teamLoadouts[seat] = room.aiLoadout || DEFAULT_AI_LOADOUT;
      continue;
    }
    teamNames[seat] = player ? `${player.name}舰队` : `玩家${seat}舰队`;
    teamLoadouts[seat] = player ? player.loadout : DEFAULT_TEAM_LOADOUT;
  }
  if (!isTwoVsTwoRoom(room)) {
    teamNames.A ||= "玩家A舰队";
    teamNames.B ||= room.mode === "ai" ? "统合思念体AI舰队" : "玩家B舰队";
    teamLoadouts.A ||= DEFAULT_TEAM_LOADOUT;
    teamLoadouts.B ||= room.mode === "ai" ? (room.aiLoadout || DEFAULT_AI_LOADOUT) : DEFAULT_TEAM_LOADOUT;
  }

  const needsCountdown = room.mode === "pvp" || isTwoVsTwoRoom(room);
  room.status = needsCountdown ? "countdown" : "running";
  room.countdownEndsAt = needsCountdown ? Date.now() + PVP_COUNTDOWN_MS : null;
  room.match = new MatchSimulation({
    mode: room.mode,
    worldSize: DEFAULT_WORLD_SIZE,
    teamNames,
    teamLoadouts,
  });
  room.snapshotAccumulator = 0;
  room.snapshotSeq = 0;
  room.finishedAt = null;
  room.result = null;

  for (const seat of seats) {
    const p = getPlayerById(room.seats[seat]);
    if (!p) {
      continue;
    }
    p.inputQueue = [];
    p.lastProcessedSeq = 0;
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

  const recipients = new Map();

  for (const seat of seatListForRoom(room)) {
    const p = getPlayerById(room.seats[seat]);
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
    sendToPlayer(p, {
      type: "room_closed",
      reasonCode: messageCode(reason, "room_closed"),
      reason,
    });
  }

  rooms.delete(roomId);
  broadcastLobby();
}

function leaveRoom(player, reasonForOthers = "对手离开房间", options = {}) {
  if (!player.roomId) {
    return;
  }

  const room = rooms.get(player.roomId);
  const oldRoomId = player.roomId;
  const playerSeat = room ? Object.entries(room.seats).find(([, playerId]) => playerId === player.id)?.[0] || null : null;
  const shouldReserveReconnect = Boolean(
    options.preserveReconnect &&
      playerSeat &&
      room &&
      isTwoVsTwoRoom(room) &&
      (room.status === "countdown" || room.status === "running"),
  );
  if (!room) {
    player.roomId = null;
    player.seat = null;
    player.spectating = false;
    player.inputQueue = [];
    player.lastProcessedSeq = 0;
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
    if (room.status === "finished" && connectedCount(room) === 0 && spectatorCount(room) === 0) {
      rooms.delete(oldRoomId);
      broadcastLobby();
      return;
    }
    sendRoomStateToMembers(room);
    broadcastLobby();
    return;
  }

  if (shouldReserveReconnect) {
    reserveReconnectSlot(room, player, playerSeat);
    applyDisconnectGuard(room, playerSeat);
  }

  player.roomId = null;
  player.seat = null;
  player.spectating = false;
  player.inputQueue = [];
  player.lastProcessedSeq = 0;

  if (playerSeat) {
    room.seats[playerSeat] = null;
    if (room.ready && !shouldReserveReconnect) {
      room.ready[playerSeat] = false;
    }
    if (!shouldReserveReconnect && room.reconnectSlots) {
      delete room.reconnectSlots[playerSeat];
    }
  }

  if (room.status === "countdown" || room.status === "running") {
    if (isTwoVsTwoRoom(room)) {
      sendRoomStateToMembers(room);
      if (shouldReserveReconnect) {
        sendSnapshot(room);
      }
      broadcastLobby();
      return;
    }
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

  if (!isTwoVsTwoRoom(room) && room.seats.A === null && room.seats.B) {
    const moved = getPlayerById(room.seats.B);
    room.seats.A = room.seats.B;
    room.seats.B = null;
    if (moved) {
      moved.seat = "A";
    }
  }

  if (connectedCount(room) === 0) {
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
  const safeMode = mode === "ai" ? "ai" : mode === PVP2V2_MODE ? PVP2V2_MODE : "pvp";
  const seats = seatListForMode(safeMode);
  const roomSeats = Object.fromEntries(seats.map((seat) => [seat, null]));
  const ready = Object.fromEntries(seats.map((seat) => [seat, false]));

  const room = {
    id: createRoomId(),
    mode: safeMode,
    visibility: safeVisibility,
    code: safeVisibility === "private" ? createPrivateCode() : null,
    status: "waiting",
    countdownEndsAt: null,
    seats: roomSeats,
    ready,
    createdAt: Date.now(),
    match: null,
    snapshotAccumulator: 0,
    snapshotSeq: 0,
    finishedAt: null,
    result: null,
    spectators: new Set(),
    teamComms: { A: [], B: [] },
    reconnectSlots: {},
    // AI 房:每房生成一次随机阵容(主舰不含长门/鹤屋),房间展示与开局共用同一份
    aiLoadout: safeMode === "ai" ? randomAiLoadout() : null,
  };

  rooms.set(room.id, room);
  assignPlayerToRoom(player, room, seats[0]);

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
  if (room.mode !== "pvp" && !isTwoVsTwoRoom(room)) {
    return { ok: false, message: "该房间不接受玩家加入" };
  }
  if (room.status !== "waiting") {
    return { ok: false, message: "房间不在等待状态" };
  }
  if (room.mode === "pvp" && (!room.seats.A || room.seats.B)) {
    return { ok: false, message: "房间已满或不可加入" };
  }

  if (isTwoVsTwoRoom(room)) {
    const seat = seatListForRoom(room).find((item) => !room.seats[item]);
    if (!seat) {
      return { ok: false, message: "房间已满或不可加入" };
    }
    assignPlayerToRoom(player, room, seat);
    sendRoomStateToMembers(room);
    broadcastLobby();
    return { ok: true };
  }

  assignPlayerToRoom(player, room, "B");
  startMatch(room);
  broadcastLobby();
  return { ok: true };
}

function resumePlayer(player, data) {
  if (player.roomId) {
    return { ok: false, message: "你已经在房间中" };
  }
  const roomId = String(data.roomId || "");
  const room = rooms.get(roomId);
  if (!room || !isTwoVsTwoRoom(room)) {
    return { ok: false, message: "房间不存在" };
  }
  if (room.status !== "countdown" && room.status !== "running") {
    return { ok: false, message: "房间不在对战状态" };
  }

  pruneReconnectSlots(room);
  const seat = String(data.seat || "").trim().toUpperCase();
  const token = String(data.reconnectToken || "").trim();
  const slot = room.reconnectSlots?.[seat] || null;
  if (!PVP2V2_SEATS.includes(seat) || !slot || room.seats[seat]) {
    return { ok: false, message: "重连槽位不可用" };
  }
  if (!token || token !== String(slot.reconnectToken || "")) {
    return { ok: false, message: "重连令牌无效" };
  }

  player.roomId = room.id;
  player.seat = seat;
  player.spectating = false;
  player.name = String(slot.name || player.name).slice(0, 16);
  player.loadout = normalizeLoadout(slot.loadout || {}, DEFAULT_TEAM_LOADOUT);
  player.inputQueue = [];
  player.lastProcessedSeq = Number(slot.lastProcessedSeq) || 0;
  player.selectedShipKey = validShipKey(slot.selectedShipKey);
  player.ready = Boolean(slot.ready);
  player.lastTeamCommAt = Number(slot.lastTeamCommAt) || 0;
  player.reconnectToken = String(slot.reconnectToken || token);
  room.seats[seat] = player.id;
  if (!room.ready) {
    room.ready = {};
  }
  room.ready[seat] = player.ready;
  delete room.reconnectSlots[seat];

  sendRoomStateToMembers(room);
  sendSnapshot(room);
  broadcastLobby();
  return { ok: true };
}

function allSeatsFilledAndReady(room) {
  return seatListForRoom(room).every((seat) => Boolean(room.seats[seat]) && Boolean(room.ready?.[seat]));
}

function setPlayerReady(player, ready) {
  if (!player.roomId || !player.seat) {
    return { ok: false };
  }
  const room = rooms.get(player.roomId);
  if (!room || room.status !== "waiting" || !isTwoVsTwoRoom(room)) {
    return { ok: false };
  }
  player.ready = Boolean(ready);
  if (!room.ready) {
    room.ready = {};
  }
  room.ready[player.seat] = player.ready;
  if (allSeatsFilledAndReady(room)) {
    startMatch(room);
  } else {
    sendRoomStateToMembers(room);
  }
  broadcastLobby();
  return { ok: true };
}

function handleTeamComm(player, data) {
  if (!player.roomId || !player.seat || player.spectating) {
    return { ok: false, message: "该房间不接受玩家加入" };
  }
  const room = rooms.get(player.roomId);
  if (!room || !isTwoVsTwoRoom(room) || room.status === "finished") {
    return { ok: false, message: "该房间不接受玩家加入" };
  }

  const now = Date.now();
  if (now - Number(player.lastTeamCommAt || 0) < TEAM_COMM_MIN_INTERVAL_MS) {
    return { ok: false, message: "通信过于频繁" };
  }

  const commType = safeTeamCommType(data.commType || data.kind || data.action);
  if (!commType) {
    return { ok: false, message: "通信类型无效" };
  }

  const anchor = normalizeTeamCommAnchor(data.anchor);
  if (teamCommNeedsPoint(commType) && !anchor) {
    return { ok: false, message: "通信目标非法" };
  }
  if (data.anchor && !anchor) {
    return { ok: false, message: "通信目标非法" };
  }

  const allianceId = allianceIdForSeat(player.seat);
  const store = teamCommStoreForRoom(room);
  pruneTeamComms(room, now);
  while (store[allianceId].length >= TEAM_COMM_MAX_PER_ALLIANCE) {
    store[allianceId].shift();
  }

  const event = {
    id: randomUUID(),
    commType,
    senderSeat: player.seat,
    senderName: player.name,
    allianceId,
    anchor,
    replyTo: normalizeTeamCommReplyTo(data.replyTo),
    createdAt: now,
    expiresAt: now + TEAM_COMM_TTL_MS,
  };

  store[allianceId].push(event);
  player.lastTeamCommAt = now;

  for (const recipient of playersForAlliance(room, allianceId)) {
    sendToPlayer(recipient, {
      type: "team_comm_event",
      roomId: room.id,
      event,
    });
  }

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
  if (isTwoVsTwoRoom(room)) {
    return { ok: false, message: "该房间不接受观战" };
  }
  if (room.status !== "running" || !room.match) {
    return { ok: false, message: "房间不在对战状态" };
  }

  player.roomId = room.id;
  player.seat = null;
  player.spectating = true;
  player.inputQueue = [];
  player.lastProcessedSeq = 0;
  player.selectedShipKey = "main";
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
  if (seq <= player.lastProcessedSeq - 30) {
    return;
  }
  player.inputQueue.push({
    seq,
    action,
  });
  if (player.inputQueue.length > 120) {
    player.inputQueue.splice(0, player.inputQueue.length - 120);
  }
}

function applyQueuedInputs(room) {
  for (const seat of seatListForRoom(room)) {
    const playerId = room.seats[seat];
    const player = getPlayerById(playerId);
    if (!player) {
      continue;
    }

    player.inputQueue.sort((a, b) => a.seq - b.seq);
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
  const selected = {};
  for (const seat of seatListForRoom(room)) {
    const player = getPlayerById(room.seats[seat]);
    const reconnectSlot = room.reconnectSlots?.[seat] || null;
    selected[seat] = validShipKey(player ? player.selectedShipKey : reconnectSlot ? reconnectSlot.selectedShipKey : "main");
  }
  return selected;
}

function buildSnapshotPayloadBase(room, advanceSeq = true, viewer = null) {
  if (!room.match) {
    return null;
  }

  if (advanceSeq) {
    room.snapshotSeq = (room.snapshotSeq || 0) + 1;
  }
  const serverTime = Date.now();
  const state = isTwoVsTwoRoom(room) && viewer && viewer.seat
    ? {
        ...room.match.buildSnapshotForViewer(viewer.seat),
        selectedShips: selectedShipsForRoom(room),
      }
    : {
        ...room.match.serializeState(),
        selectedShips: selectedShipsForRoom(room),
      };
  // AI 调试状态只供本地 /debug 推演页使用,却占快照 JSON 约 40% 体积——不进网络快照
  delete state.bots;
  return {
    type: "snapshot",
    roomId: room.id,
    snapshotSeq: room.snapshotSeq || 0,
    tick: room.match.tick,
    simTime: room.match.elapsed,
    serverTime,
    state,
  };
}

function sendSnapshot(room) {
  if (room.match) {
    room.snapshotSeq = (room.snapshotSeq || 0) + 1;
  }

  for (const seat of seatListForRoom(room)) {
    const player = getPlayerById(room.seats[seat]);
    if (!player) {
      continue;
    }
    const payload = buildSnapshotPayloadBase(room, false, player);
    if (!payload) {
      continue;
    }
    sendSnapshotToPlayer(player, {
      ...payload,
      ackSeq: player.lastProcessedSeq,
    });
  }
  // 观战者不参与操作，使用交错的7.5Hz权威快照即可由客户端插值到60fps。
  // 玩家仍保持15Hz；观战人数增加时不再按完整玩家带宽线性放大出口压力。
  if (!isTwoVsTwoRoom(room) && (room.snapshotSeq || 0) % SPECTATOR_SNAPSHOT_DIVISOR === 0) {
    const payloadBase = buildSnapshotPayloadBase(room, false);
    if (!payloadBase) {
      return;
    }
    for (const spectator of roomSpectators(room)) {
      sendSnapshotToPlayer(spectator, {
        ...payloadBase,
        // 对观战端使用连续序号，避免把服务器主动限频误判为丢包。
        snapshotSeq: payloadBase.snapshotSeq / SPECTATOR_SNAPSHOT_DIVISOR,
        ackSeq: 0,
        spectating: true,
      });
    }
  }
}

const wss = new WebSocketServer({
  host: HOST,
  port: PORT,
  maxPayload: 64 * 1024,
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
    lastTeamCommAt: 0,
    reconnectToken: randomUUID(),
    selectedShipKey: "main",
  };

  players.set(playerId, player);

  sendToPlayer(player, {
    type: "connected",
    playerId,
    build: NETWORK_BUILD,
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
      const mode = data.mode === "ai" ? "ai" : data.mode === PVP2V2_MODE ? PVP2V2_MODE : "pvp";
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

    if (type === "resume_player") {
      const result = resumePlayer(player, data);
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

    if (type === "set_ready") {
      setPlayerReady(player, data.ready);
      return;
    }

    if (type === "team_comm") {
      const result = handleTeamComm(player, data);
      if (!result.ok && result.message) {
        sendError(player, result.message);
      }
      return;
    }

    if (type === "select_ship") {
      if (player.roomId && player.seat && !player.spectating) {
        player.selectedShipKey = validShipKey(data.shipKey);
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
    leaveRoom(player, "对手断开连接，房间已解散", { preserveReconnect: true });
    players.delete(player.id);
    broadcastLobby();
  });

  ws.on("error", () => {
    // 连接层错误交由 close 统一回收
  });
});

function tickRooms() {
  for (const room of rooms.values()) {
    pruneReconnectSlots(room);
    if (
      isTwoVsTwoRoom(room) &&
      (room.status === "countdown" || room.status === "running") &&
      connectedCount(room) === 0 &&
      activeReconnectCount(room) === 0 &&
      spectatorCount(room) === 0
    ) {
      rooms.delete(room.id);
      broadcastLobby();
      continue;
    }

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

console.log(`网络对战服务器已启动 ws://${HOST}:${PORT}`);
