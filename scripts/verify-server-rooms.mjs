import assert from "node:assert/strict";
import { DEFAULT_TEAM_LOADOUT, cloneLoadout } from "../shared/game-core.js";
import { createRoomLifecycle } from "../server/room-lifecycle.js";
import { createRoomRegistry } from "../server/room-registry.js";

function createPlayer(id, name = id) {
  return {
    id,
    name,
    loadout: cloneLoadout(DEFAULT_TEAM_LOADOUT),
    roomId: null,
    seat: null,
    spectating: false,
    inputQueue: [],
    lastProcessedSeq: 0,
    lastQueuedSeq: 0,
    selectedShipKey: "main",
  };
}

function createHarness() {
  const players = new Map();
  const rooms = new Map();
  const sent = [];
  const roomStates = [];
  let lobbyBroadcasts = 0;
  let matchStarts = 0;
  let snapshotResets = 0;
  const registry = createRoomRegistry({
    players,
    rooms,
    resetSnapshotStream() {
      snapshotResets += 1;
    },
  });
  const lifecycle = createRoomLifecycle({
    rooms,
    registry,
    sendToPlayer(player, payload) {
      sent.push({ playerId: player.id, payload });
    },
    sendRoomStateToMembers(room) {
      roomStates.push(room.id);
    },
    broadcastLobby() {
      lobbyBroadcasts += 1;
    },
    startMatch(room) {
      matchStarts += 1;
      room.status = "running";
      room.match = { winnerSeat: null };
    },
  });
  return {
    lifecycle,
    players,
    registry,
    rooms,
    roomStates,
    sent,
    counters: {
      get lobbyBroadcasts() { return lobbyBroadcasts; },
      get matchStarts() { return matchStarts; },
      get snapshotResets() { return snapshotResets; },
    },
  };
}

function roomRegistryCheck() {
  const harness = createHarness();
  const playerA = createPlayer("a", "玩家甲");
  const playerB = createPlayer("b", "玩家乙");
  const spectator = createPlayer("s", "观战者");
  harness.players.set(playerA.id, playerA);
  harness.players.set(playerB.id, playerB);
  harness.players.set(spectator.id, spectator);

  const room = harness.registry.createRoomRecord("private", "pvp", 1234);
  harness.rooms.set(room.id, room);
  harness.registry.assignPlayerToRoom(playerA, room, "A");
  harness.registry.assignPlayerToRoom(playerB, room, "B");
  harness.registry.assignSpectatorToRoom(spectator, room);
  room.status = "running";
  room.match = { winnerSeat: null };
  room.closesAt = 9999;

  assert.equal(room.createdAt, 1234, "房间创建时间应由房间模型统一保存");
  assert.match(room.id, /^\d{6}$/, "房间编号应保持六位数字协议");
  assert.match(room.code, /^\d{6}$/, "私有房间口令应保持六位数字协议");
  assert.deepEqual(room.seats, { A: "a", B: "b" }, "玩家席位映射不应改变");
  assert.equal(harness.registry.connectedCount(room), 2, "1v1 房间应报告两名参战者");
  assert.equal(harness.registry.spectatorCount(room), 1, "观战者应独立于参战席位计数");
  assert.equal(harness.registry.streamCapacityUnits(), 5, "玩家与观战流容量权重应保持 2/1");
  assert.equal(harness.registry.activeRoomCount(), 1, "运行中房间应计入活跃房间");
  assert.equal(harness.registry.findPrivateRoom(room.code), room, "私有口令应定位到原房间");

  const memberPayload = harness.registry.buildRoomStatePayload(room, playerA.id);
  const outsiderPayload = harness.registry.buildRoomStatePayload(room, null);
  assert.equal(memberPayload.room.code, room.code, "房间成员应继续收到私有口令");
  assert.equal(outsiderPayload.room.code, null, "非成员不得从房间状态获取私有口令");
  assert.deepEqual(memberPayload.room.players.map((row) => row.seat), ["A", "B"], "房间状态席位顺序应稳定");
  assert.equal(memberPayload.room.closesAt, 9999, "房间状态应下发服务端权威关闭截止时间");

  room.visibility = "public";
  const lobby = harness.registry.buildLobbyPayload(5678);
  assert.equal(lobby.now, 5678, "大厅时间戳应由统一序列化器生成");
  assert.deepEqual(lobby.rooms[0], {
    roomId: room.id,
    mode: "pvp",
    visibility: "public",
    status: "running",
    count: 2,
    capacity: 2,
    spectatorCount: 1,
    hostName: "玩家甲",
    createdAt: 1234,
  }, "大厅公开字段应保持现有协议");
}

function roomLifecycleCheck() {
  const harness = createHarness();
  const playerA = createPlayer("a", "玩家甲");
  const playerB = createPlayer("b", "玩家乙");
  harness.players.set(playerA.id, playerA);
  harness.players.set(playerB.id, playerB);

  const created = harness.lifecycle.createRoom(playerA, "public", "pvp");
  assert.equal(created.ok, true, "应能创建公开 PVP 房间");
  assert.equal(created.room.status, "waiting", "单人进入时应维持等待状态");
  assert.equal(playerA.seat, "A", "房主应进入 A 席位");
  assert.equal(harness.counters.matchStarts, 0, "PVP 房间不得在第二名玩家进入前开局");

  const joined = harness.lifecycle.joinRoom(playerB, created.room);
  assert.equal(joined.ok, true, "第二名玩家应能加入等待房间");
  assert.equal(playerB.seat, "B", "加入者应进入 B 席位");
  assert.equal(harness.counters.matchStarts, 1, "双方到齐后只启动一次比赛");

  harness.lifecycle.leaveRoom(playerA, "对手断开连接，房间已解散");
  assert.equal(harness.rooms.size, 0, "运行中玩家离开后应关闭房间");
  assert.equal(playerA.roomId, null, "离开的玩家应清除房间状态");
  assert.equal(playerB.roomId, null, "对手应随房间关闭清除状态");
  assert.equal(harness.sent.length, 1, "房间关闭通知只发送给仍在房间的对手");
  assert.equal(harness.sent[0].payload.reasonCode, "opponent_disconnected", "关闭原因码应保持协议兼容");
}

function spectatorLifecycleCheck() {
  const harness = createHarness();
  const host = createPlayer("host", "房主");
  const spectator = createPlayer("spectator", "观战者");
  harness.players.set(host.id, host);
  harness.players.set(spectator.id, spectator);
  const room = harness.registry.createRoomRecord("public", "pvp", 100);
  harness.rooms.set(room.id, room);
  harness.registry.assignPlayerToRoom(host, room, "A");
  room.status = "running";
  room.match = { winnerSeat: null };

  const result = harness.lifecycle.spectateRoom(spectator, room);
  assert.equal(result.ok, true, "公开运行中房间应允许观战");
  assert.equal(spectator.spectating, true, "观战者不得占用参战席位");
  assert.equal(room.spectators.has(spectator.id), true, "观战者应登记到独立集合");
  harness.lifecycle.leaveRoom(spectator);
  assert.equal(spectator.roomId, null, "离开观战后应清理连接房间状态");
  assert.equal(room.spectators.size, 0, "离开观战后应从房间集合移除");
  assert.equal(harness.rooms.has(room.id), true, "观战者离开不得关闭仍在运行的房间");
}

function finishedRoomForcedCloseCheck() {
  const harness = createHarness();
  const playerA = createPlayer("a", "玩家甲");
  const playerB = createPlayer("b", "玩家乙");
  const spectator = createPlayer("s", "观战者");
  for (const player of [playerA, playerB, spectator]) {
    harness.players.set(player.id, player);
  }

  const room = harness.registry.createRoomRecord("public", "pvp", 100);
  harness.rooms.set(room.id, room);
  harness.registry.assignPlayerToRoom(playerA, room, "A");
  harness.registry.assignPlayerToRoom(playerB, room, "B");
  harness.registry.assignSpectatorToRoom(spectator, room);
  room.status = "finished";
  room.finishedAt = 200;
  room.closesAt = 10_200;
  room.result = harness.registry.buildMatchResult(room, room.finishedAt);

  harness.lifecycle.leaveRoom(playerB, "对手断开连接，房间已解散");
  assert.equal(harness.rooms.has(room.id), true, "结算后一名玩家关闭浏览器时房间应保留到倒计时结束");
  assert.equal(playerB.roomId, null, "断线玩家应立即清除房间状态");

  harness.lifecycle.closeRoom(room.id, "对局结束，已返回大厅");
  assert.equal(harness.rooms.has(room.id), false, "强制关闭后房间必须从房间列表移除");
  assert.equal(playerA.roomId, null, "强制关闭应清理仍在线的参战玩家");
  assert.equal(spectator.roomId, null, "强制关闭应清理仍在线的观战者");
  assert.deepEqual(
    harness.sent.map((entry) => entry.payload.reasonCode),
    ["match_ended_draw", "match_ended_draw"],
    "仍在线的房间成员应收到统一结算关闭通知",
  );
}

roomRegistryCheck();
roomLifecycleCheck();
spectatorLifecycleCheck();
finishedRoomForcedCloseCheck();
console.log("服务端房间契约校验通过：房间模型、席位、生命周期、结算回收和观战行为保持稳定。");
