import {
  cloneLoadout,
  DEFAULT_AI_LOADOUT,
  randomAiLoadout,
} from "../shared/game-core.js";
import { ROOM_CAPACITY } from "./config.js";

const PLAYER_SEATS = ["A", "B"];

function randomSixDigitId() {
  return String(Math.floor(Math.random() * 900000 + 100000));
}

export function createRoomRegistry({
  players = new Map(),
  rooms = new Map(),
  resetSnapshotStream = () => {},
} = {}) {
  function getPlayerById(playerId) {
    if (!playerId) {
      return null;
    }
    return players.get(playerId) || null;
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

  function createRoomId() {
    let id = "";
    do {
      id = randomSixDigitId();
    } while (rooms.has(id));
    return id;
  }

  function createPrivateCode() {
    const existing = new Set([...rooms.values()].map((room) => room.code).filter(Boolean));
    let code = "";
    do {
      code = randomSixDigitId();
    } while (existing.has(code));
    return code;
  }

  function connectedCount(room) {
    return PLAYER_SEATS.map((seat) => room.seats[seat]).filter(Boolean).length;
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
    const playerA = getPlayerById(room.seats.A);
    const playerB = getPlayerById(room.seats.B);
    const rows = [{
      seat: "A",
      name: playerA ? playerA.name : "空位",
      playerId: playerA ? playerA.id : null,
      loadout: playerA ? playerA.loadout : null,
      isBot: false,
    }];

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
        name: playerB ? playerB.name : "空位",
        playerId: playerB ? playerB.id : null,
        loadout: playerB ? playerB.loadout : null,
        isBot: false,
      });
    }
    return rows;
  }

  function buildMatchResult(room, now = Date.now()) {
    return {
      roomId: room.id,
      winnerSeat: room.match ? room.match.winnerSeat : null,
      finishedAt: now,
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

  function buildLobbyPayload(now = Date.now()) {
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
    return { type: "lobby", rooms: list, now };
  }

  function resetPlayerRoomState(player) {
    player.roomId = null;
    player.seat = null;
    player.spectating = false;
    player.inputQueue = [];
    player.lastProcessedSeq = 0;
    player.lastQueuedSeq = 0;
    resetSnapshotStream(player);
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

  function assignSpectatorToRoom(player, room) {
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
  }

  function createRoomRecord(visibility, mode, now = Date.now()) {
    const safeVisibility = visibility === "private" ? "private" : "public";
    const safeMode = mode === "ai" ? "ai" : "pvp";
    return {
      id: createRoomId(),
      mode: safeMode,
      visibility: safeVisibility,
      code: safeVisibility === "private" ? createPrivateCode() : null,
      status: "waiting",
      countdownEndsAt: null,
      seats: { A: null, B: null },
      createdAt: now,
      match: null,
      snapshotAccumulator: 0,
      snapshotSeq: 0,
      finishedAt: null,
      result: null,
      spectators: new Set(),
      // AI 房每房生成一次随机阵容，房间展示与开局共用同一份。
      aiLoadout: safeMode === "ai" ? randomAiLoadout() : null,
    };
  }

  function validShipKey(shipKey) {
    return shipKey === "main" || shipKey === "sub1" || shipKey === "sub2" ? shipKey : "main";
  }

  function selectedShipsForRoom(room) {
    const playerA = getPlayerById(room.seats.A);
    const playerB = getPlayerById(room.seats.B);
    return {
      A: validShipKey(playerA ? playerA.selectedShipKey : "main"),
      B: validShipKey(playerB ? playerB.selectedShipKey : "main"),
    };
  }

  function findPrivateRoom(code) {
    return [...rooms.values()].find((room) => room.visibility === "private" && room.code === code) || null;
  }

  return {
    activeRoomCount,
    assignPlayerToRoom,
    assignSpectatorToRoom,
    buildLobbyPayload,
    buildMatchResult,
    buildRoomStatePayload,
    connectedCount,
    createRoomRecord,
    findPrivateRoom,
    getPlayerById,
    resetPlayerRoomState,
    roomSpectators,
    seatPlayerRows,
    selectedShipsForRoom,
    spectatorCount,
    streamCapacityUnits,
    validShipKey,
  };
}
