import {
  MAX_ACTIVE_ROOMS,
  MAX_ROOMS,
  MAX_SPECTATORS_PER_ROOM,
  MAX_STREAM_CAPACITY_UNITS,
} from "./config.js";
import { normalizeLoadout, DEFAULT_TEAM_LOADOUT } from "../shared/game-core.js";
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

    if (room.kind === "tournament" && room.ownerId === player.id) {
      closeRoom(oldRoomId, "主持人离开，比赛房间已关闭");
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

    if (room.kind === "tournament") {
      room.ready = { A: false, B: false };
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

  function createRoom(player, visibility, mode, kind = "standard") {
    if (player.roomId) {
      return { ok: false, message: "你已经在房间中" };
    }
    const safeMode = mode === "ai" ? "ai" : "pvp";
    if (safeMode === "pvp" && kind === "tournament" && !player.supportsTournamentRooms) {
      return { ok: false, message: "客户端不支持比赛房间，请刷新页面" };
    }
    if (rooms.size >= MAX_ROOMS) {
      return { ok: false, message: "服务器房间数已满" };
    }
    if (safeMode === "ai" && activeRoomCount() >= MAX_ACTIVE_ROOMS) {
      return { ok: false, message: "服务器活跃对局已满" };
    }
    if (safeMode === "ai" && streamCapacityUnits() + 2 > MAX_STREAM_CAPACITY_UNITS) {
      return { ok: false, message: "服务器实时流容量已满" };
    }

    const room = createRoomRecord(visibility, safeMode, Date.now(), kind);
    rooms.set(room.id, room);
    if (room.kind === "tournament") {
      room.ownerId = player.id;
      assignSpectatorToRoom(player, room);
    } else {
      assignPlayerToRoom(player, room, "A");
    }
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
    if (room.kind === "tournament" && !player.supportsTournamentRooms) {
      return { ok: false, message: "客户端不支持比赛房间，请刷新页面" };
    }
    if (room.mode !== "pvp") {
      return { ok: false, message: "该房间不接受玩家加入" };
    }
    if (room.status !== "waiting") {
      return { ok: false, message: "房间不在等待状态" };
    }
    if (room.kind === "tournament") {
      const seat = ["A", "B"].find((key) => !room.seats[key]);
      if (!seat) return { ok: false, message: "房间已满或不可加入" };
      assignPlayerToRoom(player, room, seat);
      room.ready[seat] = false;
      sendRoomStateToMembers(room);
      broadcastLobby();
      return { ok: true };
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
    if (room.kind === "tournament" && !player.supportsTournamentRooms) {
      return { ok: false, message: "客户端不支持比赛房间，请刷新页面" };
    }
    if (room.visibility !== "public") {
      return { ok: false, message: "该房间不接受观战" };
    }
    const preparing = room.kind === "tournament" && ["waiting", "countdown"].includes(room.status);
    if (!preparing && (room.status !== "running" || !room.match)) {
      return { ok: false, message: "房间不在对战状态" };
    }
    if (spectatorCount(room) >= MAX_SPECTATORS_PER_ROOM) {
      return { ok: false, message: "该房间观战人数已满" };
    }
    if (room.status !== "waiting" && streamCapacityUnits() + 1 > MAX_STREAM_CAPACITY_UNITS) {
      return { ok: false, message: "服务器实时流容量已满" };
    }

    assignSpectatorToRoom(player, room);
    sendRoomStateToMembers(room);
    broadcastLobby();
    return { ok: true };
  }

  function updateLoadout(player, loadout) {
    const room = rooms.get(player.roomId);
    if (room?.kind === "tournament" && !player.spectating && room.status !== "waiting") {
      return { ok: false, message: "比赛开始后不能更换阵容" };
    }
    const next = normalizeLoadout(loadout || {}, DEFAULT_TEAM_LOADOUT);
    const changed = JSON.stringify(player.loadout) !== JSON.stringify(next);
    player.loadout = next;
    if (room?.status === "waiting") {
      if (changed && room.kind === "tournament" && player.seat) room.ready[player.seat] = false;
      sendRoomStateToMembers(room);
    }
    broadcastLobby();
    return { ok: true };
  }

  function setPlayerReady(player, ready) {
    const room = rooms.get(player.roomId);
    if (!room || room.kind !== "tournament" || player.spectating || !player.seat || room.seats[player.seat] !== player.id) {
      return { ok: false, message: "只有比赛选手可以设置就绪" };
    }
    if (room.status !== "waiting") return { ok: false, message: "房间不在等待状态" };
    if (typeof ready !== "boolean") return { ok: false, message: "就绪状态无效" };
    room.ready[player.seat] = ready;
    sendRoomStateToMembers(room);
    broadcastLobby();
    return { ok: true };
  }

  function startTournament(player) {
    const room = rooms.get(player.roomId);
    if (!room || room.kind !== "tournament" || room.ownerId !== player.id) {
      return { ok: false, message: "只有主持人可以开始比赛" };
    }
    if (room.status !== "waiting") return { ok: false, message: "房间不在等待状态" };
    if (!["A", "B"].every((seat) => room.seats[seat] && room.ready[seat])) {
      return { ok: false, message: "双方选手就绪后才能开始比赛" };
    }
    if (activeRoomCount() >= MAX_ACTIVE_ROOMS) return { ok: false, message: "服务器活跃对局已满" };
    // 准备阶段没有快照流，开赛时为两名选手及所有观众统一核算容量。
    if (streamCapacityUnits() + 4 + spectatorCount(room) > MAX_STREAM_CAPACITY_UNITS) {
      return { ok: false, message: "服务器实时流容量已满" };
    }
    startMatch(room);
    broadcastLobby();
    return { ok: true };
  }

  return { closeRoom, createRoom, joinRoom, leaveRoom, spectateRoom, updateLoadout, setPlayerReady, startTournament };
}
