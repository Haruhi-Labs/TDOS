import {
  MAX_ACTIVE_ROOMS,
  MAX_ROOMS,
  MAX_SPECTATORS_PER_ROOM,
  MAX_STREAM_CAPACITY_UNITS,
} from "./config.js";
import { normalizeLoadout, DEFAULT_TEAM_LOADOUT } from "../shared/game/characters/catalog.js";
import { messageCode } from "./protocol.js";
import { RULESET_VERSION } from "../shared/protocol/ruleset-version.js";
import {
  evaluateRoomFormatCapability,
  getRoomFormat,
  resolveRequestedRoomFormat,
  seatsForSide,
} from "../shared/protocol/room-formats.js";

export function createRoomLifecycle({
  rooms,
  registry,
  sendToPlayer,
  sendRoomStateToMembers,
  broadcastLobby,
  startMatch,
  onRoomClosed = () => {},
}) {
  const {
    activeRoomCount,
    assignPlayerToRoom,
    assignSpectatorToRoom,
    connectedCount,
    createRoomRecord,
    findAvailableSeat,
    getPlayerById,
    resetPlayerRoomState,
    roomSpectators,
    pruneRoomSpectators,
    spectatorCount,
    streamCapacityUnits,
    switchPlayerSeat,
  } = registry;

  function seatOrderOf(room) {
    if (Array.isArray(room?.seatOrder) && room.seatOrder.length > 0) {
      return room.seatOrder;
    }
    return Object.keys(room?.seats || { A: null, B: null });
  }

  function seatedPlayerList(room) {
    if (!room) return [];
    return seatOrderOf(room)
      .map((seat) => getPlayerById(room.seats?.[seat]))
      .filter(Boolean);
  }

  function roomMemberList(room) {
    if (!room) return [];
    const seen = new Map();
    for (const member of seatedPlayerList(room)) {
      seen.set(member.id, member);
    }
    for (const spectator of roomSpectators(room)) {
      seen.set(spectator.id, spectator);
    }
    return [...seen.values()];
  }

  function formatCapabilityError(formatId, player) {
    const check = evaluateRoomFormatCapability(formatId, {
      rulesetVersion: player?.rulesetVersion,
      stateSchemas: player?.supportedStateSchemas,
      roomFormats: player?.supportedRoomFormats,
    });
    return check.ok ? null : { ok: false, message: check.message };
  }

  function roomMembersCapabilityError(room) {
    if (!room || (room.formatId || "duel") === "duel") {
      return null;
    }
    for (const member of roomMemberList(room)) {
      const error = formatCapabilityError(room.formatId, member);
      if (error) return error;
    }
    return null;
  }

  // 旧端仍能使用旧阵容房间；含新角色时，玩家与观众都必须声明当前规则。
  function bunnyClientError(room, player, loadout = player.loadout, includeLoadout = true) {
    const members = room ? roomMemberList(room) : [];
    const loadouts = typeof room?.match?.allTeams === "function"
      ? room.match.allTeams().map((team) => team.loadout)
      : room?.match?.teamA
        ? [room.match.teamA.loadout, room.match.teamB?.loadout].filter(Boolean)
        : members
          .filter((member) => !member.spectating)
          .map((member) => (member === player ? loadout : member.loadout));
    if (includeLoadout) loadouts.push(loadout);
    const requiresCurrent = loadouts.some((value) => Object.values(value || {}).includes("bunny_haruhi"));
    return requiresCurrent && [...members, player].some((member) => member.rulesetVersion !== RULESET_VERSION)
      ? { ok: false, message: "兔女郎春日阵容需要所有玩家及观众刷新到当前规则版本" }
      : null;
  }

  function transferOwnerIfNeeded(room, previousOwnerId) {
    if (!room || room.kind === "tournament" || (room.formatId || "duel") === "duel") {
      return;
    }
    if (room.ownerId !== previousOwnerId) {
      return;
    }
    const nextOwner = seatedPlayerList(room)[0] || null;
    room.assignOwner(nextOwner ? nextOwner.id : null);
  }

  function closeRoom(roomId, reason = "房间已关闭") {
    const room = rooms.get(roomId);
    if (!room) {
      return;
    }

    const recipients = new Map();
    for (const player of seatedPlayerList(room)) {
      recipients.set(player.id, player);
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
    onRoomClosed(roomId);
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

    const isMultiFleet = (room.formatId || "duel") !== "duel";
    pruneRoomSpectators(room);
    if (room.kind === "tournament" && room.ownerId === player.id) {
      closeRoom(oldRoomId, "主持人离开，比赛房间已关闭");
      return;
    }

    if (player.spectating) {
      if (room.spectators) {
        room.removeSpectator(player.id);
      }
      resetPlayerRoomState(player);
      if (room.status === "finished" && connectedCount(room) === 0 && spectatorCount(room) === 0) {
        rooms.delete(oldRoomId);
        onRoomClosed(oldRoomId);
        broadcastLobby();
        return;
      }
      sendRoomStateToMembers(room);
      broadcastLobby();
      return;
    }

    const leavingPlayerId = player.id;
    resetPlayerRoomState(player);
    const promotedPlayerId = room.releaseSeat(leavingPlayerId);
    if (promotedPlayerId) {
      const moved = getPlayerById(promotedPlayerId);
      if (moved) moved.seat = "A";
    }

    if (room.status === "countdown") {
      if (isMultiFleet) {
        const countdownReason = reasonForOthers === "对手断开连接，房间已解散"
          ? "有玩家断开连接，倒计时已取消"
          : "有玩家离开房间，倒计时已取消";
        closeRoom(oldRoomId, countdownReason);
        return;
      }
      closeRoom(oldRoomId, reasonForOthers);
      return;
    }

    if (room.status === "running") {
      if (!isMultiFleet) {
        closeRoom(oldRoomId, reasonForOthers);
        return;
      }
      transferOwnerIfNeeded(room, leavingPlayerId);
      if (connectedCount(room) === 0) {
        closeRoom(oldRoomId, "所有参战玩家已离线，房间已关闭");
        return;
      }
      sendRoomStateToMembers(room);
      broadcastLobby();
      return;
    }

    if (room.status === "finished") {
      transferOwnerIfNeeded(room, leavingPlayerId);
      if (connectedCount(room) === 0 && spectatorCount(room) === 0) {
        rooms.delete(oldRoomId);
        onRoomClosed(oldRoomId);
        broadcastLobby();
        return;
      }
      sendRoomStateToMembers(room);
      broadcastLobby();
      return;
    }

    if (room.kind === "tournament") {
      sendRoomStateToMembers(room);
      broadcastLobby();
      return;
    }

    if (connectedCount(room) === 0) {
      if (spectatorCount(room) > 0) {
        closeRoom(oldRoomId, "房间已关闭");
        return;
      }
      rooms.delete(oldRoomId);
      onRoomClosed(oldRoomId);
      broadcastLobby();
      return;
    }

    transferOwnerIfNeeded(room, leavingPlayerId);
    sendRoomStateToMembers(room);
    broadcastLobby();
  }

  function createRoom(player, visibility, mode, kind = "standard", requestedFormatId = undefined) {
    if (player.roomId) {
      return { ok: false, message: "你已经在房间中" };
    }
    const format = resolveRequestedRoomFormat(requestedFormatId);
    if (!format) {
      return { ok: false, message: "不支持的房间玩法格式" };
    }
    const safeMode = mode === "ai" ? "ai" : "pvp";
    if (safeMode === "ai" && !format.supportsAi) {
      return { ok: false, message: "该玩法格式暂不支持AI对战" };
    }
    if (safeMode === "pvp" && kind === "tournament" && !player.supportsTournamentRooms) {
      return { ok: false, message: "客户端不支持比赛房间，请刷新页面" };
    }
    const capabilityError = formatCapabilityError(format.formatId, player);
    if (capabilityError) return capabilityError;
    const compatibilityError = bunnyClientError(null, player, player.loadout, kind !== "tournament");
    if (compatibilityError) return compatibilityError;
    if (rooms.size >= MAX_ROOMS) {
      return { ok: false, message: "服务器房间数已满" };
    }
    if (safeMode === "ai" && activeRoomCount() >= MAX_ACTIVE_ROOMS) {
      return { ok: false, message: "服务器活跃对局已满" };
    }
    if (safeMode === "ai" && streamCapacityUnits() + 2 > MAX_STREAM_CAPACITY_UNITS) {
      return { ok: false, message: "服务器实时流容量已满" };
    }

    const room = createRoomRecord(visibility, safeMode, Date.now(), kind, format.formatId);
    rooms.set(room.id, room);
    if (room.kind === "tournament") {
      room.assignHost(player.id);
      assignSpectatorToRoom(player, room);
    } else {
      assignPlayerToRoom(player, room, format.seats[0]);
      if (format.formatId !== "duel") {
        room.assignOwner(player.id);
      }
    }
    if (room.mode === "ai") {
      startMatch(room);
    } else {
      sendRoomStateToMembers(room);
    }
    broadcastLobby();
    return { ok: true, room };
  }

  function joinRoom(player, room, options = {}) {
    if (!room) {
      return { ok: false, message: "房间不存在" };
    }
    if (player.roomId) {
      return { ok: false, message: "你已经在房间中" };
    }
    if (room.kind === "tournament" && !player.supportsTournamentRooms) {
      return { ok: false, message: "客户端不支持比赛房间，请刷新页面" };
    }
    const format = room.format || getRoomFormat(room.formatId || "duel");
    const capabilityError = formatCapabilityError(format.formatId, player);
    if (capabilityError) return capabilityError;
    if (room.mode !== "pvp") {
      return { ok: false, message: "该房间不接受玩家加入" };
    }
    if (room.status !== "waiting") {
      return { ok: false, message: "房间不在等待状态" };
    }
    const compatibilityError = bunnyClientError(room, player);
    if (compatibilityError) return compatibilityError;

    const requestedSideId = options && typeof options === "object" ? options.sideId : undefined;

    if (format.formatId === "duel" && room.kind === "standard") {
      if (requestedSideId !== undefined && requestedSideId !== null && requestedSideId !== "") {
        const sideCheck = findAvailableSeat(room, requestedSideId);
        if (!sideCheck.ok) return sideCheck;
      }
      if (!room.seats.A || room.seats.B) {
        return { ok: false, message: "房间已满或不可加入" };
      }
      if (activeRoomCount() >= MAX_ACTIVE_ROOMS) {
        return { ok: false, message: "服务器活跃对局已满" };
      }
      if (streamCapacityUnits() + 4 > MAX_STREAM_CAPACITY_UNITS) {
        return { ok: false, message: "服务器实时流容量已满" };
      }

      assignPlayerToRoom(player, room, "B");
      startMatch(room);
      broadcastLobby();
      return { ok: true, seat: "B", sideId: format.seatSideMap.B };
    }

    const allocated = findAvailableSeat(room, requestedSideId);
    if (!allocated.ok) {
      return allocated;
    }
    assignPlayerToRoom(player, room, allocated.seat);
    sendRoomStateToMembers(room);
    broadcastLobby();
    return { ok: true, seat: allocated.seat, sideId: allocated.sideId };
  }

  function setPlayerSide(player, sideId) {
    const room = rooms.get(player.roomId);
    if (!room || player.spectating || !player.seat || room.seats[player.seat] !== player.id) {
      return { ok: false, message: "只有已入座玩家可以切换阵营" };
    }
    if (room.status !== "waiting") {
      return { ok: false, message: "对局开始后不能切换阵营" };
    }
    const format = room.format || getRoomFormat(room.formatId || "duel");
    const capabilityError = formatCapabilityError(format.formatId, player);
    if (capabilityError) return capabilityError;
    if (!format.allowSideSwitch) {
      return { ok: false, message: "当前玩法格式不支持切换阵营" };
    }
    if (typeof sideId !== "string" || !format.sides.includes(sideId)) {
      return { ok: false, message: "无效的阵营选择" };
    }
    if (room.sideOfSeat(player.seat) === sideId) {
      return { ok: true, seat: player.seat, sideId };
    }
    const targetSeat = seatsForSide(format.formatId, sideId).find((seat) => !room.seats[seat]);
    if (!targetSeat) {
      return { ok: false, message: "目标阵营已满" };
    }
    if (!switchPlayerSeat(player, room, targetSeat)) {
      return { ok: false, message: "目标阵营已满" };
    }
    sendRoomStateToMembers(room);
    broadcastLobby();
    return { ok: true, seat: targetSeat, sideId };
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
    const capabilityError = formatCapabilityError(room.formatId || "duel", player);
    if (capabilityError) return capabilityError;
    if (room.visibility !== "public") {
      return { ok: false, message: "该房间不接受观战" };
    }
    const compatibilityError = bunnyClientError(room, player, player.loadout, false);
    if (compatibilityError) return compatibilityError;
    const isMultiFleet = (room.formatId || "duel") !== "duel";
    const preparing = (room.kind === "tournament" || isMultiFleet) && ["waiting", "countdown"].includes(room.status);
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
    const isMultiFleet = Boolean(room && (room.formatId || "duel") !== "duel");
    if (room && (room.kind === "tournament" || isMultiFleet) && !player.spectating && room.status !== "waiting") {
      return {
        ok: false,
        message: room.kind === "tournament" ? "比赛开始后不能更换阵容" : "对局开始后不能更换阵容",
      };
    }
    const next = normalizeLoadout(loadout || {}, DEFAULT_TEAM_LOADOUT);
    const compatibilityError = bunnyClientError(player.spectating ? null : room, player, next);
    if (compatibilityError) return compatibilityError;
    const changed = JSON.stringify(player.loadout) !== JSON.stringify(next);
    player.loadout = next;
    if (room?.status === "waiting") {
      if (changed && (room.kind === "tournament" || room.format?.requiresReady) && player.seat) {
        room.setReady(player.seat, player.id, false);
      }
      sendRoomStateToMembers(room);
    }
    broadcastLobby();
    return { ok: true };
  }

  function setPlayerReady(player, ready) {
    const room = rooms.get(player.roomId);
    const format = room?.format || getRoomFormat(room?.formatId || "duel");
    const supportsReady = Boolean(room && (room.kind === "tournament" || format?.requiresReady));
    if (!room || !supportsReady || player.spectating || !player.seat || room.seats[player.seat] !== player.id) {
      return {
        ok: false,
        message: room && room.formatId !== "duel" && room.kind !== "tournament"
          ? "只有已入座玩家可以设置就绪"
          : "只有比赛选手可以设置就绪",
      };
    }
    if (room.status !== "waiting") return { ok: false, message: "房间不在等待状态" };
    const capabilityError = formatCapabilityError(format.formatId, player);
    if (capabilityError) return capabilityError;
    const compatibilityError = bunnyClientError(room, player, player.loadout, false);
    if (compatibilityError) return compatibilityError;
    if (typeof ready !== "boolean") return { ok: false, message: "就绪状态无效" };
    room.setReady(player.seat, player.id, ready);
    sendRoomStateToMembers(room);
    broadcastLobby();
    return { ok: true };
  }

  function startRoomMatch(player) {
    const room = rooms.get(player.roomId);
    const isTournament = room?.kind === "tournament";
    const isMultiFleet = Boolean(room && (room.formatId || "duel") !== "duel");

    if (!room || (!isTournament && !isMultiFleet)) {
      return { ok: false, message: "只有主持人可以开始比赛" };
    }
    if (room.ownerId !== player.id) {
      return {
        ok: false,
        message: isTournament ? "只有主持人可以开始比赛" : "只有房主可以开始对局",
      };
    }
    if (room.status !== "waiting") return { ok: false, message: "房间不在等待状态" };

    const ownerCapError = formatCapabilityError(room.formatId || "duel", player);
    if (ownerCapError) return ownerCapError;
    const memberCapError = roomMembersCapabilityError(room);
    if (memberCapError) return memberCapError;
    const compatibilityError = bunnyClientError(room, player, player.loadout, false);
    if (compatibilityError) return compatibilityError;

    const format = room.format || getRoomFormat(room.formatId || "duel");
    const occupiedSeats = format.seats.filter((seat) => Boolean(room.seats[seat]));
    const occupiedCount = occupiedSeats.length;

    if (!isMultiFleet) {
      if (!["A", "B"].every((seat) => room.seats[seat] && room.ready[seat])) {
        return { ok: false, message: "双方选手就绪后才能开始比赛" };
      }
    } else if (format.formatId === "2v2" || format.formatId === "3v3") {
      if (occupiedCount < format.minPlayers) {
        return { ok: false, message: "参战人数不足，无法开始对局" };
      }
      const sidesBalanced = format.sides.every(
        (sideId) => seatsForSide(format.formatId, sideId).filter((seat) => Boolean(room.seats[seat])).length === format.sideCapacity,
      );
      if (!sidesBalanced || occupiedCount !== format.capacity) {
        return { ok: false, message: "双方阵营人数不满足开局要求" };
      }
      if (!occupiedSeats.every((seat) => Boolean(room.ready[seat]))) {
        return { ok: false, message: "所有参战玩家就绪后才能开始对局" };
      }
    } else if (format.formatId === "ffa") {
      if (occupiedCount < format.minPlayers || occupiedCount > format.maxPlayers) {
        return { ok: false, message: "参战人数不足，无法开始对局" };
      }
      if (!occupiedSeats.every((seat) => Boolean(room.ready[seat]))) {
        return { ok: false, message: "所有参战玩家就绪后才能开始对局" };
      }
    }

    if (activeRoomCount() >= MAX_ACTIVE_ROOMS) {
      return { ok: false, message: "服务器活跃对局已满" };
    }
    // 准备阶段没有快照流，开赛时按实际参战席位（每席 2 单位）及在房观众（每人 1 单位）统一核算容量。
    const neededStreamUnits = occupiedCount * 2 + spectatorCount(room);
    if (streamCapacityUnits() + neededStreamUnits > MAX_STREAM_CAPACITY_UNITS) {
      return { ok: false, message: "服务器实时流容量已满" };
    }

    startMatch(room);
    broadcastLobby();
    return { ok: true };
  }

  return {
    closeRoom,
    createRoom,
    joinRoom,
    leaveRoom,
    spectateRoom,
    updateLoadout,
    setPlayerSide,
    setPlayerReady,
    startRoomMatch,
    startTournament: startRoomMatch,
  };
}
