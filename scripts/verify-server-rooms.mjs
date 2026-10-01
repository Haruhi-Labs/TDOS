import assert from "node:assert/strict";
import { DEFAULT_TEAM_LOADOUT, cloneLoadout } from "../shared/game-core.js";
import { createRoomLifecycle } from "../server/room-lifecycle.js";
import { MAX_ACTIVE_ROOMS, MAX_STREAM_CAPACITY_UNITS } from "../server/config.js";
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

function createHarness(overrides = {}) {
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
    registry: { ...registry, ...overrides },
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
    kind: "standard",
    visibility: "public",
    status: "running",
    count: 2,
    capacity: 2,
    spectatorCount: 1,
    hostName: "玩家甲",
    combatants: [
      { seat: "A", name: "玩家甲", isBot: false },
      { seat: "B", name: "玩家乙", isBot: false },
    ],
    createdAt: 1234,
  }, "大厅应公开双方席位昵称，同时隔离身份和统计字段");
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

function tournamentFixture(overrides = {}) {
  const harness = createHarness(overrides);
  const [host, a, b, viewer, outsider] = ["主持<人>", "选手甲", "选手乙", "观众", "旁观者"].map((name, i) => {
    const player = { ...createPlayer(String(i), name), supportsTournamentRooms: true };
    harness.players.set(player.id, player);
    return player;
  });
  const result = harness.lifecycle.createRoom(host, "public", "pvp", "tournament");
  assert.equal(result.ok, true);
  return { ...harness, host, a, b, viewer, outsider, room: result.room };
}

function tournamentLifecycleCheck() {
  const h = tournamentFixture();
  const { lifecycle: life, room, host, a, b, viewer, outsider } = h;
  assert.equal(room.kind, "tournament");
  assert.equal(room.mode, "pvp", "比赛房仍共用玩家对战规则");
  assert.equal(host.spectating, true, "主持独立观战，不占选手席位");
  assert.deepEqual(room.seats, { A: null, B: null });
  assert.equal(room.match, null, "赛前不建立模拟或发送快照");
  assert.equal(life.spectateRoom(viewer, room).ok, true, "空房也可独立观战");
  assert.equal(life.joinRoom(a, room).ok, true);
  assert.equal(a.seat, "A");
  assert.equal(life.joinRoom(b, room).ok, true);
  assert.equal(b.seat, "B");
  assert.equal(room.status, "waiting");
  assert.equal(h.counters.matchStarts, 0, "双方入房不能自动开赛");
  assert.equal(life.joinRoom(outsider, room).ok, false, "主持和观众不能占用第三个选手席位");
  for (const nonPlayer of [host, viewer, outsider]) assert.equal(life.setPlayerReady(nonPlayer, true).ok, false);
  for (const nonHost of [a, b, viewer, outsider]) assert.equal(life.startTournament(nonHost).ok, false);
  assert.equal(life.startTournament(host).ok, false);
  assert.equal(life.setPlayerReady(a, "true").ok, false, "只接受布尔就绪状态");
  assert.equal(life.setPlayerReady(a, true).ok, true);
  assert.equal(life.setPlayerReady(b, true).ok, true);
  assert.equal(h.counters.matchStarts, 0, "双方就绪依然等待主持");
  assert.equal(life.updateLoadout(a, a.loadout).ok, true);
  assert.equal(room.ready.A, true, "相同阵容同步不取消就绪");
  const newLoadout = { main: "asakura", sub1: "koizumi", sub2: "yuki" };
  assert.equal(life.updateLoadout(a, newLoadout).ok, true);
  assert.deepEqual(room.ready, { A: false, B: true }, "换阵容只取消本人就绪");
  assert.equal(life.startTournament(host).ok, false);
  assert.equal(life.setPlayerReady(a, true).ok, true);
  const payload = h.registry.buildRoomStatePayload(room, host.id);
  assert.equal(payload.self.isHost, true);
  assert.equal(payload.self.seat, null);
  assert.equal(payload.room.hostName, host.name);
  assert.deepEqual(payload.room.players[0].loadout, newLoadout);
  assert.equal(h.registry.buildRoomStatePayload(room, viewer.id).self.isHost, false);
  assert.equal(life.setPlayerReady(b, false).ok, true);
  assert.equal(life.startTournament(host).ok, false, "撤回就绪阻止开赛");
  assert.equal(life.setPlayerReady(b, true).ok, true);
  assert.equal(life.startTournament(host).ok, true);
  assert.equal(h.counters.matchStarts, 1, "主持启动既有对战入口一次");
  for (const status of ["countdown", "running"]) {
    room.status = status;
    assert.equal(life.updateLoadout(a, DEFAULT_TEAM_LOADOUT).ok, false);
    assert.deepEqual(a.loadout, newLoadout, "开赛后阵容锁定");
    assert.equal(life.setPlayerReady(b, false).ok, false);
    assert.equal(life.startTournament(host).ok, false, "重复开始不能重置模拟");
  }
  room.status = "countdown";
  assert.equal(life.spectateRoom(outsider, room).ok, true, "倒计时也可入场观战");
  life.leaveRoom(viewer);
  assert.equal(h.rooms.has(room.id), true, "观众离开不影响主持或选手");
  life.leaveRoom(host);
  assert.equal(h.rooms.has(room.id), false);
  for (const member of [host, a, b, outsider]) assert.equal(member.roomId, null, "主持离开应统一清理房间");
  assert.ok(h.sent.every(({ payload: event }) => event.reasonCode === "tournament_host_left"));
}

function tournamentWaitingAndCapacityCheck() {
  const h = tournamentFixture();
  for (const player of [h.a, h.b]) {
    h.lifecycle.joinRoom(player, h.room);
    h.lifecycle.setPlayerReady(player, true);
  }
  h.lifecycle.leaveRoom(h.a);
  assert.deepEqual(h.room.seats, { A: null, B: h.b.id }, "离开不挪动另一选手席位");
  assert.deepEqual(h.room.ready, { A: false, B: false });
  assert.equal(h.rooms.has(h.room.id), true);
  assert.equal(h.lifecycle.joinRoom(h.outsider, h.room).ok, true);
  assert.equal(h.outsider.seat, "A");
  h.room.visibility = "private";
  assert.equal(h.registry.buildRoomStatePayload(h.room, h.host.id).room.code, h.room.code);
  assert.equal(h.registry.buildRoomStatePayload(h.room, h.viewer.id).room.code, null);
  assert.equal(h.lifecycle.spectateRoom(h.viewer, h.room).ok, false);

  for (const [overrides, expected] of [
    [{ activeRoomCount: () => MAX_ACTIVE_ROOMS }, "服务器活跃对局已满"],
    [{ streamCapacityUnits: () => MAX_STREAM_CAPACITY_UNITS - 5 }, "服务器实时流容量已满"],
  ]) {
    const full = tournamentFixture(overrides);
    assert.equal(full.lifecycle.spectateRoom(full.viewer, full.room).ok, true, "等待观战不占实时流容量");
    for (const player of [full.a, full.b]) {
      full.lifecycle.joinRoom(player, full.room);
      full.lifecycle.setPlayerReady(player, true);
    }
    assert.equal(full.lifecycle.startTournament(full.host).message, expected);
    assert.equal(full.room.status, "waiting", "容量不足不得锁定阵容或开始模拟");
    assert.equal(full.counters.matchStarts, 0);
  }
  const old = createPlayer("legacy");
  h.players.set(old.id, old);
  assert.equal(h.lifecycle.createRoom(old, "public", "pvp", "tournament").ok, false);
  h.room.visibility = "public";
  assert.equal(h.lifecycle.joinRoom(old, h.room).ok, false);
  assert.equal(h.lifecycle.spectateRoom(old, h.room).ok, false);
  assert.equal(h.lifecycle.createRoom(old, "public", "pvp").ok, true, "旧客户端仍可加入普通房流程");
}

tournamentLifecycleCheck();
tournamentWaitingAndCapacityCheck();
roomRegistryCheck();
roomLifecycleCheck();
spectatorLifecycleCheck();
finishedRoomForcedCloseCheck();
console.log("服务端房间契约校验通过：普通房回归与比赛房主持权限、赛前观战、就绪/阵容锁定、离房及容量门禁。");
