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
const NETWORK_BUILD = "formation-fix-20260719-01";
const SNAPSHOT_INTERVAL = 1 / SNAPSHOT_RATE;
const ROOM_CAPACITY = 2;
const MAX_CATCHUP_STEPS = 6;
const LOOP_IDLE_MS = 2;
const PVP_COUNTDOWN_MS = 3000;

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

function broadcastLobby() {
  const payload = buildLobbyPayload();
  for (const player of players.values()) {
    sendToPlayer(player, payload);
  }
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
  player.selectedShipKey = "main";
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

  player.roomId = null;
  player.seat = null;
  player.spectating = false;
  player.inputQueue = [];
  player.lastProcessedSeq = 0;

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
  for (const seat of ["A", "B"]) {
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
  const pA = getPlayerById(room.seats.A);
  const pB = getPlayerById(room.seats.B);
  return {
    A: validShipKey(pA ? pA.selectedShipKey : "main"),
    B: validShipKey(pB ? pB.selectedShipKey : "main"),
  };
}

function buildSnapshotPayloadBase(room, advanceSeq = true) {
  if (!room.match) {
    return null;
  }

  if (advanceSeq) {
    room.snapshotSeq = (room.snapshotSeq || 0) + 1;
  }
  const serverTime = Date.now();
  const state = {
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
  const payloadBase = buildSnapshotPayloadBase(room, true);
  if (!payloadBase) {
    return;
  }

  const pA = getPlayerById(room.seats.A);
  const pB = getPlayerById(room.seats.B);

  if (pA) {
    sendToPlayer(pA, {
      ...payloadBase,
      ackSeq: pA.lastProcessedSeq,
    });
  }
  if (room.mode === "pvp" && pB) {
    sendToPlayer(pB, {
      ...payloadBase,
      ackSeq: pB.lastProcessedSeq,
    });
  }
  for (const spectator of roomSpectators(room)) {
    sendToPlayer(spectator, {
      ...payloadBase,
      ackSeq: 0,
      spectating: true,
    });
  }
}

const wss = new WebSocketServer({ port: PORT });

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
