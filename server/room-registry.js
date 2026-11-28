import { Room } from "./room.js";
import { copyPlainData } from "../shared/data/plain-data.js";
import { cloneLoadout, DEFAULT_AI_LOADOUT, randomAiLoadout } from "../shared/game/characters/catalog.js";
import { getRoomFormat, seatsForSide } from "../shared/protocol/room-formats.js";
import { ROOM_CAPACITY } from "./config.js";

function randomSixDigitId() {
  return String(Math.floor(Math.random() * 900000 + 100000));
}

export function createRoomRegistry({
  players = new Map(),
  rooms = new Map(),
  resetSnapshotStream = () => {},
  resetPlayerInputs = () => {},
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

  function seatOrderOf(room) {
    if (Array.isArray(room?.seatOrder) && room.seatOrder.length > 0) {
      return room.seatOrder;
    }
    return Object.keys(room?.seats || { A: null, B: null });
  }

  function connectedCount(room) {
    if (!room) return 0;
    return seatOrderOf(room).map((seat) => room.seats?.[seat]).filter(Boolean).length;
  }

  function seatedPlayers(room) {
    const list = [];
    if (!room) return list;
    for (const seat of seatOrderOf(room)) {
      const player = getPlayerById(room.seats?.[seat]);
      if (player) {
        list.push({
          seat,
          sideId: room.sideOfSeat ? room.sideOfSeat(seat) : null,
          player,
        });
      }
    }
    return list;
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
      }
    }
    return list;
  }

  function pruneRoomSpectators(room) {
    const activeIds = new Set(roomSpectators(room).map((player) => player.id));
    room.retainSpectators(activeIds);
  }

  function spectatorCount(room) {
    return roomSpectators(room).length;
  }

  function findAvailableSeat(room, requestedSideId = null) {
    const format = room.format || getRoomFormat(room.formatId || "duel");
    const hasSideRequest = requestedSideId !== undefined && requestedSideId !== null && requestedSideId !== "";
    if (hasSideRequest) {
      if (typeof requestedSideId !== "string" || !format.sides.includes(requestedSideId)) {
        return { ok: false, message: "无效的阵营选择" };
      }
      const candidates = seatsForSide(format.formatId, requestedSideId);
      const seat = candidates.find((key) => !room.seats[key]);
      if (!seat) {
        return { ok: false, message: "目标阵营已满" };
      }
      return { ok: true, seat, sideId: requestedSideId };
    }

    if (format.sideCapacity > 1) {
      // 组队模式未指定阵营时优先平衡分配到人数较少的阵营。
      let chosenSide = null;
      let chosenSeat = null;
      let minOccupied = Infinity;
      for (const sideId of format.sides) {
        const candidates = seatsForSide(format.formatId, sideId);
        const occupied = candidates.filter((key) => Boolean(room.seats[key])).length;
        const freeSeat = candidates.find((key) => !room.seats[key]);
        if (freeSeat && occupied < minOccupied) {
          minOccupied = occupied;
          chosenSide = sideId;
          chosenSeat = freeSeat;
        }
      }
      if (!chosenSeat) {
        return { ok: false, message: "房间已满或不可加入" };
      }
      return { ok: true, seat: chosenSeat, sideId: chosenSide };
    }

    const freeSeat = format.seats.find((key) => !room.seats[key]);
    if (!freeSeat) {
      return { ok: false, message: "房间已满或不可加入" };
    }
    return { ok: true, seat: freeSeat, sideId: format.seatSideMap[freeSeat] };
  }

  function seatPlayerRows(room) {
    const formatId = room.formatId || "duel";
    if (formatId === "duel") {
      const playerA = getPlayerById(room.seats.A);
      const playerB = getPlayerById(room.seats.B);
      const rows = [{
        seat: "A",
        name: playerA ? playerA.name : "空位",
        playerId: playerA ? playerA.id : null,
        loadout: playerA ? cloneLoadout(playerA.loadout) : null,
        isBot: false,
        ready: Boolean(room.ready?.A),
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
          loadout: playerB ? cloneLoadout(playerB.loadout) : null,
          isBot: false,
          ready: Boolean(room.ready?.B),
        });
      }
      return rows;
    }

    if (Array.isArray(room.matchRoster) && room.matchRoster.length > 0) {
      return room.matchRoster.map((entry) => {
        const onlinePlayer = getPlayerById(room.seats[entry.seat]);
        const disconnected = Boolean(room.disconnectedSeats?.has(entry.seat));
        return {
          seat: entry.seat,
          sideId: entry.sideId,
          name: onlinePlayer ? onlinePlayer.name : entry.name,
          playerId: onlinePlayer ? onlinePlayer.id : null,
          loadout: cloneLoadout(entry.loadout),
          isBot: Boolean(entry.isBot),
          ready: Boolean(room.ready?.[entry.seat]),
          connected: Boolean(onlinePlayer) && !disconnected,
        };
      });
    }

    return seatOrderOf(room).map((seat) => {
      const player = getPlayerById(room.seats[seat]);
      return {
        seat,
        sideId: room.seatSides?.[seat] || null,
        name: player ? player.name : "空位",
        playerId: player ? player.id : null,
        loadout: player ? cloneLoadout(player.loadout) : null,
        isBot: false,
        ready: Boolean(room.ready?.[seat]),
        connected: Boolean(player),
      };
    });
  }

  function buildMatchResult(room, now = Date.now()) {
    const formatId = room.formatId || "duel";
    if (formatId === "duel") {
      return {
        roomId: room.id,
        winnerSeat: room.match ? room.match.winnerSeat : null,
        ...(room.match?.endReason ? { endReason: room.match.endReason } : {}),
        finishedAt: now,
        players: seatPlayerRows(room).map((row) => ({
          ...row,
          loadout: row.loadout ? cloneLoadout(row.loadout) : null,
        })),
      };
    }

    return {
      roomId: room.id,
      formatId,
      battleMode: room.battleMode,
      winnerSeat: null,
      outcome: room.match?.outcome ? copyPlainData(room.match.outcome) : null,
      ...(room.match?.endReason ? { endReason: room.match.endReason } : {}),
      finishedAt: now,
      players: seatPlayerRows(room).map((row) => ({
        ...row,
        loadout: row.loadout ? cloneLoadout(row.loadout) : null,
      })),
    };
  }

  function displayPlayerRows(room) {
    if (room && room.result && Array.isArray(room.result.players)) {
      return copyPlainData(room.result.players);
    }
    return seatPlayerRows(room);
  }

  function buildRoomStatePayload(room, viewerId = null) {
    const formatId = room.formatId || "duel";
    const isMultiFleet = formatId !== "duel";
    const viewer = viewerId ? getPlayerById(viewerId) : null;
    const isHost = Boolean(viewer && viewer.roomId === room.id && room.kind === "tournament" && room.ownerId === viewer.id);
    const isOwner = Boolean(viewer && viewer.roomId === room.id && room.ownerId === viewer.id);
    const isMember = viewer && viewer.roomId === room.id && (!viewer.spectating || isHost || isOwner);
    const result = room.result || null;
    const roomPayload = {
      roomId: room.id,
      mode: room.mode,
      kind: room.kind || "standard",
      ...(isMultiFleet
        ? {
            formatId,
            battleMode: room.battleMode,
            stateSchema: room.stateSchema,
            capacity: room.capacity,
            minPlayers: room.format.minPlayers,
            sideCapacity: room.format.sideCapacity,
            sides: [...room.format.sides],
            ownerId: room.ownerId || null,
          }
        : {}),
      visibility: room.visibility,
      hostName: getPlayerById(room.ownerId)?.name || "",
      code: room.visibility === "private" && isMember ? room.code : null,
      status: room.status,
      countdownEndsAt: room.countdownEndsAt || null,
      players: displayPlayerRows(room),
      spectatorCount: spectatorCount(room),
      winnerSeat: result ? result.winnerSeat : room.match ? room.match.winnerSeat : null,
      ...(isMultiFleet
        ? {
            outcome: result
              ? copyPlainData(result.outcome ?? null)
              : room.match?.outcome
                ? copyPlainData(room.match.outcome)
                : null,
          }
        : {}),
      ...((result?.endReason || room.match?.endReason) ? { endReason: result?.endReason || room.match.endReason } : {}),
      finishedAt: result ? result.finishedAt : room.finishedAt,
      closesAt: room.closesAt || null,
      createdAt: room.createdAt,
    };

    const viewerSideId = viewer?.seat && room.sideOfSeat ? room.sideOfSeat(viewer.seat) : null;
    const selfPayload = viewer
      ? {
          playerId: viewer.id,
          seat: viewer.seat,
          ...(isMultiFleet ? { sideId: viewerSideId, isOwner } : {}),
          spectating: Boolean(viewer.spectating),
          isHost,
          loadout: cloneLoadout(viewer.loadout),
        }
      : null;

    return {
      type: "room_state",
      room: roomPayload,
      self: selfPayload,
    };
  }

  function buildLobbyPayload(now = Date.now()) {
    const list = [];
    for (const room of rooms.values()) {
      if (room.visibility !== "public") {
        continue;
      }
      const formatId = room.formatId || "duel";
      const isMultiFleet = formatId !== "duel";
      const firstSeatId = seatOrderOf(room)[0];
      const host = getPlayerById(room.ownerId || (firstSeatId ? room.seats[firstSeatId] : null));
      const resultHost = room.result && Array.isArray(room.result.players)
        ? room.result.players.find((row) => row.seat === firstSeatId) || room.result.players[0]
        : null;
      const rows = displayPlayerRows(room);
      if (!isMultiFleet) {
        list.push({
          roomId: room.id,
          mode: room.mode,
          kind: room.kind || "standard",
          visibility: room.visibility,
          status: room.status,
          count: connectedCount(room),
          capacity: ROOM_CAPACITY,
          spectatorCount: spectatorCount(room),
          hostName: host ? host.name : resultHost ? resultHost.name : "未知",
          // 大厅只公开双方昵称与席位，不传播身份或统计字段。
          combatants: rows.map(({ seat, name, isBot }) => ({ seat, name, isBot })),
          createdAt: room.createdAt,
        });
      } else {
        list.push({
          roomId: room.id,
          mode: room.mode,
          kind: room.kind || "standard",
          formatId,
          battleMode: room.battleMode,
          visibility: room.visibility,
          status: room.status,
          count: connectedCount(room),
          capacity: room.capacity,
          minPlayers: room.format.minPlayers,
          sides: [...room.format.sides],
          spectatorCount: spectatorCount(room),
          hostName: host ? host.name : resultHost ? resultHost.name : "未知",
          combatants: rows.map(({ seat, sideId, name, isBot }) => ({ seat, sideId, name, isBot })),
          createdAt: room.createdAt,
        });
      }
    }
    list.sort((a, b) => b.createdAt - a.createdAt);
    return { type: "lobby", rooms: list, now };
  }

  function resetPlayerRoomState(player) {
    player.roomId = null;
    player.seat = null;
    player.spectating = false;
    resetPlayerInputs(player);
    resetSnapshotStream(player);
  }

  function assignPlayerToRoom(player, room, seat) {
    if (!room.occupySeat(seat, player.id)) return false;
    player.roomId = room.id;
    player.seat = seat;
    player.spectating = false;
    resetPlayerInputs(player);
    player.selectedShipKey = "main";
    resetSnapshotStream(player);
    return true;
  }

  function switchPlayerSeat(player, room, targetSeat) {
    if (!player || !room || !player.seat) return false;
    if (!room.switchSeat(player.seat, targetSeat, player.id)) return false;
    player.seat = targetSeat;
    return true;
  }

  function assignSpectatorToRoom(player, room) {
    pruneRoomSpectators(room);
    if (!room.addSpectator(player.id)) return false;
    player.roomId = room.id;
    player.seat = null;
    player.spectating = true;
    resetPlayerInputs(player);
    player.selectedShipKey = "main";
    resetSnapshotStream(player);
    return true;
  }

  function createRoomRecord(visibility, mode, now = Date.now(), kind = "standard", formatId = "duel") {
    const safeVisibility = visibility === "private" ? "private" : "public";
    const safeMode = mode === "ai" ? "ai" : "pvp";
    const format = getRoomFormat(formatId);
    if (!format) {
      throw new Error(`不支持的房间玩法格式：${String(formatId)}`);
    }
    return new Room({
      id: createRoomId(),
      formatId: format.formatId,
      mode: safeMode,
      kind: safeMode === "pvp" && kind === "tournament" ? "tournament" : "standard",
      ownerId: null,
      visibility: safeVisibility,
      code: safeVisibility === "private" ? createPrivateCode() : null,
      status: "waiting",
      countdownEndsAt: null,
      createdAt: now,
      startedAt: null,
      match: null,
      finishedAt: null,
      closesAt: null,
      result: null,
      spectators: new Set(),
      // AI 房每房生成一次随机阵容，房间展示与开局共用同一份。
      aiLoadout: safeMode === "ai" ? randomAiLoadout() : null,
    });
  }

  function validShipKey(shipKey) {
    return shipKey === "main" || shipKey === "sub1" || shipKey === "sub2" ? shipKey : "main";
  }

  function selectedShipsForRoom(room) {
    const seats = Array.isArray(room?.match?.seatOrder) && room.match.seatOrder.length > 0
      ? room.match.seatOrder
      : seatOrderOf(room);
    const result = {};
    for (const seat of seats) {
      const player = getPlayerById(room.seats?.[seat]);
      result[seat] = validShipKey(player ? player.selectedShipKey : "main");
    }
    return result;
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
    findAvailableSeat,
    findPrivateRoom,
    getPlayerById,
    resetPlayerRoomState,
    pruneRoomSpectators,
    roomSpectators,
    seatPlayerRows,
    seatedPlayers,
    selectedShipsForRoom,
    spectatorCount,
    streamCapacityUnits,
    switchPlayerSeat,
    validShipKey,
  };
}
