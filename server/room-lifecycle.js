import {
  MAX_ACTIVE_ROOMS,
  MAX_ROOMS,
  MAX_SPECTATORS_PER_ROOM,
  MAX_STREAM_CAPACITY_UNITS,
} from "./config.js";
import { messageCode } from "./protocol.js";

export function createRoomLifecycle({
  rooms,
  registry,
  sendToPlayer,
  sendRoomStateToMembers,
  broadcastLobby,
  startMatch,
}) {
  const {
    activeRoomCount,
    assignPlayerToRoom,
    assignSpectatorToRoom,
    connectedCount,
    createRoomRecord,
    getPlayerById,
    resetPlayerRoomState,
    roomSpectators,
    spectatorCount,
    streamCapacityUnits,
  } = registry;

  function closeRoom(roomId, reason = "房间已关闭") {
    const room = rooms.get(roomId);
    if (!room) {
      return;
    }

    const recipients = new Map();
    for (const player of [getPlayerById(room.seats.A), getPlayerById(room.seats.B)]) {
      if (player) {
        recipients.set(player.id, player);
      }
    }
    for (const player of roomSpectators(room)) {
      recipients.set(player.id, player);
    }

    for (const player of recipients.values()) {
      resetPlayerRoomState(player);
      sendToPlayer(player, {
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
      resetPlayerRoomState(player);
      return;
    }

    if (player.spectating) {
      if (room.spectators) {
        room.spectators.delete(player.id);
      }
      resetPlayerRoomState(player);
      if (room.status === "finished" && connectedCount(room) === 0 && spectatorCount(room) === 0) {
        rooms.delete(oldRoomId);
        broadcastLobby();
        return;
      }
      sendRoomStateToMembers(room);
      broadcastLobby();
      return;
    }

    resetPlayerRoomState(player);
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

    const room = createRoomRecord(visibility, safeMode);
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
    // 当前 1v1 开局后会新增两条 15Hz 玩家流；3v3 接入时按实际席位扩展权重。
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

    assignSpectatorToRoom(player, room);
    sendRoomStateToMembers(room);
    broadcastLobby();
    return { ok: true };
  }

  return { closeRoom, createRoom, joinRoom, leaveRoom, spectateRoom };
}
