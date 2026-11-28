import { Room } from "../server/room.js";
function beginFixture(room) {
  room.begin({ createMatch: () => ({ phase: "running", winnerSeat: null }), countdownMs: 3000, now: () => 0 });
}
function runFixture(room) { beginFixture(room); room.startRunning(3000); }
import assert from "node:assert/strict";
import { RULESET_VERSION } from "../shared/protocol/ruleset-version.js";
import {
  MULTI_FLEET_STATE_SCHEMA,
  ROOM_FORMATS,
  ROOM_FORMAT_IDS,
  evaluateRoomFormatCapability,
  resolveRequestedRoomFormat,
} from "../shared/protocol/room-formats.js";
import { DEFAULT_TEAM_LOADOUT, cloneLoadout } from "../shared/game-core.js";
import { createRoomLifecycle } from "../server/room-lifecycle.js";
import { MAX_ACTIVE_ROOMS, MAX_STREAM_CAPACITY_UNITS } from "../server/config.js";
import { createRoomRegistry } from "../server/room-registry.js";

function createPlayer(id, name = id, options = {}) {
  return {
    id,
    name,
    loadout: cloneLoadout(DEFAULT_TEAM_LOADOUT),
    roomId: null,
    seat: null,
    spectating: false,
    selectedShipKey: "main",
    rulesetVersion: options.rulesetVersion ?? "",
    supportsTournamentRooms: Boolean(options.supportsTournamentRooms),
    supportedStateSchemas: new Set(options.stateSchemas || []),
    supportedRoomFormats: new Set(options.roomFormats || []),
  };
}

function createMultiFleetPlayer(id, name = id, overrides = {}) {
  return createPlayer(id, name, {
    rulesetVersion: RULESET_VERSION,
    supportsTournamentRooms: true,
    stateSchemas: [MULTI_FLEET_STATE_SCHEMA],
    roomFormats: [...ROOM_FORMAT_IDS],
    ...overrides,
  });
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
      beginFixture(room);
      if (room.kind !== "tournament") room.startRunning(3000);
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
  runFixture(room);

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
  assert.equal(memberPayload.room.closesAt, null, "运行中没有结算关闭截止时间");

  memberPayload.room.players[0].loadout.main = "其他角色";
  memberPayload.self.loadout.sub1 = "其他角色";
  assert.deepEqual(playerA.loadout, DEFAULT_TEAM_LOADOUT, "房间读模型不得反向修改玩家阵容");
  room.match.phase = "finished";
  room.match.endReason = "objective";
  room.finish(5000, 4999, harness.registry.buildMatchResult);
  assert.equal(room.result.endReason, "objective", "房间持久结算读模型保留终局原因");
  assert.equal(harness.registry.buildRoomStatePayload(room, playerA.id).room.endReason, "objective", "只收到房间状态的客户端仍能正确解释终局");
  assert.equal(harness.registry.buildRoomStatePayload(room, playerA.id).room.closesAt, 9999, "结束后下发权威关闭截止时间");
  harness.registry.buildRoomStatePayload(room, playerA.id).room.players[0].name = "其他名字";
  assert.equal(room.result.players[0].name, "玩家甲", "结算展示不得共享结果记录的可写引用");
  room.addSpectator("失效连接");
  harness.registry.buildRoomStatePayload(room, playerA.id);
  harness.registry.buildLobbyPayload();
  assert.equal(room.spectators.has("失效连接"), true, "序列化和统计查询不得暗中修改房间集合");
  assert.equal(harness.registry.spectatorCount(room), 1, "失效连接不得计入公开人数");
  harness.registry.pruneRoomSpectators(room);
  assert.equal(room.spectators.has("失效连接"), false, "显式生命周期操作负责整理失效连接");

  harness.rooms.set(room.id, new Room({ ...room, visibility: "public", seats: room.seats, ready: room.ready, spectators: room.spectators }));
  const lobby = harness.registry.buildLobbyPayload(5678);
  assert.equal(lobby.now, 5678, "大厅时间戳应由统一序列化器生成");
  assert.deepEqual(lobby.rooms[0], {
    roomId: room.id,
    mode: "pvp",
    kind: "standard",
    visibility: "public",
    status: "finished",
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
  runFixture(room);

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
  runFixture(room);
  room.match.phase = "finished";
  room.finish(200, 10000, harness.registry.buildMatchResult);

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

function tournamentFixture(overrides = {}, visibility = "public") {
  const harness = createHarness(overrides);
  const [host, a, b, viewer, outsider] = ["主持<人>", "选手甲", "选手乙", "观众", "旁观者"].map((name, i) => {
    const player = { ...createPlayer(String(i), name), supportsTournamentRooms: true };
    harness.players.set(player.id, player);
    return player;
  });
  const result = harness.lifecycle.createRoom(host, visibility, "pvp", "tournament");
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
  assert.equal(life.spectateRoom(outsider, room).ok, true, "倒计时也可入场观战");
  for (const status of ["countdown", "running"]) {
    if (status === "running") room.startRunning(3000);
    assert.equal(room.status, status);
    assert.equal(life.updateLoadout(a, DEFAULT_TEAM_LOADOUT).ok, false);
    assert.deepEqual(a.loadout, newLoadout, "开赛后阵容锁定");
    assert.equal(life.setPlayerReady(b, false).ok, false);
    assert.equal(life.startTournament(host).ok, false, "重复开始不能重置模拟");
  }
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
  const privateFixture = tournamentFixture({}, "private");
  assert.equal(privateFixture.registry.buildRoomStatePayload(privateFixture.room, privateFixture.host.id).room.code, privateFixture.room.code);
  assert.equal(privateFixture.registry.buildRoomStatePayload(privateFixture.room, privateFixture.viewer.id).room.code, null);
  assert.equal(privateFixture.lifecycle.spectateRoom(privateFixture.viewer, privateFixture.room).ok, false);

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
  assert.equal(h.lifecycle.joinRoom(old, h.room).ok, false);
  assert.equal(h.lifecycle.spectateRoom(old, h.room).ok, false);
  assert.equal(h.lifecycle.createRoom(old, "public", "pvp").ok, true, "旧客户端仍可加入普通房流程");
}

function bunnyRulesetCheck() {
  const h = createHarness();
  const current = createPlayer("current");
  current.rulesetVersion = RULESET_VERSION;
  const legacy = createPlayer("legacy");
  h.players.set(current.id, current);
  h.players.set(legacy.id, legacy);
  const bunny = { main: "bunny_haruhi", sub1: "kyon", sub2: "yuki" };
  assert.equal(h.lifecycle.updateLoadout(legacy, bunny).ok, false);
  assert.equal(h.lifecycle.updateLoadout(current, bunny).ok, true);
  const { room } = h.lifecycle.createRoom(current, "public", "pvp");
  assert.equal(h.lifecycle.joinRoom(legacy, room).ok, false);
  legacy.rulesetVersion = RULESET_VERSION;
  assert.equal(h.lifecycle.joinRoom(legacy, room).ok, true);
  const observer = createPlayer("observer");
  h.players.set(observer.id, observer);
  assert.equal(h.lifecycle.spectateRoom(observer, room).ok, false);
  observer.rulesetVersion = RULESET_VERSION;
  assert.equal(h.lifecycle.spectateRoom(observer, room).ok, true);
  h.lifecycle.closeRoom(room.id);
  current.supportsTournamentRooms = observer.supportsTournamentRooms = true;
  observer.rulesetVersion = "";
  const tournament = h.lifecycle.createRoom(observer, "public", "pvp", "tournament").room;
  assert.equal(h.lifecycle.joinRoom(current, tournament).ok, false, "不能把新阵容带进仍有旧端观众的准备房");
  current.loadout = cloneLoadout(DEFAULT_TEAM_LOADOUT);
  assert.equal(h.lifecycle.joinRoom(current, tournament).ok, true);
  assert.equal(h.lifecycle.updateLoadout(current, bunny).ok, false);
  assert.deepEqual(current.loadout, DEFAULT_TEAM_LOADOUT, "失败更换阵容必须原子拒绝");
  observer.rulesetVersion = RULESET_VERSION;
  assert.equal(h.lifecycle.updateLoadout(current, bunny).ok, true);
  legacy.supportsTournamentRooms = true;
  assert.equal(h.lifecycle.joinRoom(legacy, tournament).ok, true);
  h.lifecycle.setPlayerReady(current, true);
  h.lifecycle.setPlayerReady(legacy, true);
  legacy.rulesetVersion = "";
  assert.equal(h.lifecycle.startTournament(observer).ok, false, "就绪后规则声明失效也不能开赛");
  legacy.rulesetVersion = RULESET_VERSION;
  assert.equal(h.lifecycle.startTournament(observer).ok, true);
}
function multiFleetFormatCatalogCheck() {
  assert.deepEqual(ROOM_FORMAT_IDS, ["duel", "2v2", "3v3", "ffa"], "受支持房间格式列表应固定");
  assert.equal(ROOM_FORMATS["2v2"].capacity, 4);
  assert.equal(ROOM_FORMATS["2v2"].sideCapacity, 2);
  assert.equal(ROOM_FORMATS["3v3"].capacity, 6);
  assert.equal(ROOM_FORMATS["3v3"].sideCapacity, 3);
  assert.equal(ROOM_FORMATS.ffa.minPlayers, 3);
  assert.equal(ROOM_FORMATS.ffa.maxPlayers, 6);
  assert.equal(resolveRequestedRoomFormat(undefined).formatId, "duel", "缺省格式应兼容旧 duel");
  assert.equal(resolveRequestedRoomFormat("4v4"), null, "未知格式必须拒绝，不得回退 duel");
  assert.equal(evaluateRoomFormatCapability("2v2", {
    rulesetVersion: RULESET_VERSION,
    stateSchemas: [MULTI_FLEET_STATE_SCHEMA],
    roomFormats: ["2v2"],
  }).ok, true);
  assert.equal(evaluateRoomFormatCapability("2v2", {
    rulesetVersion: "",
    stateSchemas: [MULTI_FLEET_STATE_SCHEMA],
    roomFormats: ["2v2"],
  }).code, "multi_fleet_ruleset_required", "新格式拒绝缺失规则版本的旧端");
  assert.equal(evaluateRoomFormatCapability("3v3", {
    rulesetVersion: RULESET_VERSION,
    stateSchemas: ["legacy-v1"],
    roomFormats: ["3v3"],
  }).code, "multi_fleet_client_unsupported", "缺少 multi-fleet-v1 状态能力的端必须被拒绝");
}

function multiFleetJoinSideReadyStartCheck() {
  const h = createHarness();
  const players = Array.from({ length: 7 }, (_, i) => {
    const p = createMultiFleetPlayer(`p${i + 1}`, `玩家${i + 1}`);
    h.players.set(p.id, p);
    return p;
  });
  const viewer = createMultiFleetPlayer("viewer", "观众");
  h.players.set(viewer.id, viewer);

  // 拒绝未知格式与多席 AI
  assert.equal(h.lifecycle.createRoom(players[0], "public", "pvp", "standard", "4v4").ok, false);
  assert.equal(h.lifecycle.createRoom(players[0], "public", "ai", "standard", "2v2").ok, false);

  // 2v2 创建、选队、满队/无效组/重复加入拒绝与观众隔离
  const created = h.lifecycle.createRoom(players[0], "public", "pvp", "standard", "2v2");
  assert.equal(created.ok, true);
  const room = created.room;
  assert.equal(room.formatId, "2v2");
  assert.equal(room.ownerId, players[0].id);
  assert.equal(players[0].seat, "P1");
  assert.equal(h.lifecycle.joinRoom(players[0], room).ok, false, "同一玩家不能重复占位");
  assert.equal(h.lifecycle.joinRoom(players[1], room, { sideId: "invalid" }).message, "无效的阵营选择");
  assert.equal(h.lifecycle.joinRoom(players[1], room, { sideId: "side1" }).ok, true);
  assert.equal(players[1].seat, "P2");
  assert.equal(h.lifecycle.joinRoom(players[2], room, { sideId: "side1" }).message, "目标阵营已满");
  assert.equal(h.lifecycle.joinRoom(players[2], room, { sideId: "side2" }).ok, true);
  assert.equal(players[2].seat, "P3");
  assert.equal(h.lifecycle.spectateRoom(viewer, room).ok, true, "等待期多席公开房应允许观战且不占参战席位");
  assert.equal(viewer.seat, null);
  assert.equal(h.lifecycle.setPlayerReady(viewer, true).ok, false, "观众不能设置就绪");
  assert.equal(h.lifecycle.setPlayerSide(viewer, "side2").ok, false, "观众不能切换阵营");

  // 人数不足不能开始
  assert.equal(h.lifecycle.setPlayerReady(players[0], true).ok, true);
  assert.equal(h.lifecycle.setPlayerReady(players[1], true).ok, true);
  assert.equal(h.lifecycle.setPlayerReady(players[2], true).ok, true);
  assert.equal(h.lifecycle.startRoomMatch(players[0]).message, "参战人数不足，无法开始对局");

  // 换组使本人就绪失效，且非房主不能开始
  assert.equal(h.lifecycle.setPlayerSide(players[1], "side2").ok, true);
  assert.equal(players[1].seat, "P4");
  assert.equal(room.ready.P4, false, "换组后本人就绪应失效");
  assert.equal(h.lifecycle.setPlayerSide(players[0], "side2").message, "目标阵营已满");
  assert.equal(h.lifecycle.joinRoom(players[3], room).ok, true, "未指定阵营时应自动分配到缺人阵营");
  assert.equal(players[3].seat, "P2");
  assert.equal(h.lifecycle.joinRoom(players[4], room).ok, false, "满房后必须拒绝额外玩家加入");
  assert.equal(h.lifecycle.startRoomMatch(players[1]).message, "只有房主可以开始对局");
  assert.equal(h.lifecycle.startRoomMatch(players[0]).message, "所有参战玩家就绪后才能开始对局");

  // 换阵容取消本人就绪
  assert.equal(h.lifecycle.setPlayerReady(players[1], true).ok, true);
  assert.equal(h.lifecycle.setPlayerReady(players[3], true).ok, true);
  const altLoadout = { main: "asakura", sub1: "koizumi", sub2: "yuki" };
  assert.equal(h.lifecycle.updateLoadout(players[3], altLoadout).ok, true);
  assert.equal(room.ready.P2, false, "换阵容后本人就绪必须失效");
  assert.equal(h.lifecycle.startRoomMatch(players[0]).message, "所有参战玩家就绪后才能开始对局");
  assert.equal(h.lifecycle.setPlayerReady(players[3], true).ok, true);

  // 全员就绪且阵营对称后由房主启动一次
  const statePayload = h.registry.buildRoomStatePayload(room, players[0].id);
  assert.equal(statePayload.room.formatId, "2v2");
  assert.equal(statePayload.room.capacity, 4);
  assert.equal(statePayload.self.seat, "P1");
  assert.equal(statePayload.self.sideId, "side1");
  assert.equal(statePayload.self.isOwner, true);
  assert.equal(h.lifecycle.startRoomMatch(players[0]).ok, true);
  assert.equal(h.counters.matchStarts, 1);

  // 开局后阵营、阵容和就绪全部锁定
  assert.equal(h.lifecycle.setPlayerSide(players[0], "side2").message, "对局开始后不能切换阵营");
  assert.equal(h.lifecycle.updateLoadout(players[0], altLoadout).message, "对局开始后不能更换阵容");
  assert.equal(h.lifecycle.setPlayerReady(players[0], false).ok, false);
  assert.equal(h.lifecycle.joinRoom(players[4], room).ok, false, "开局后拒绝新加入");
}

function multiFleetLeaveAndDisconnectMatrixCheck() {
  // 1) waiting 阶段：房主离开不搬迁他人席位且移交房主，全空时通知并清理滞留观众
  {
    const h = createHarness();
    const [p1, p2, viewer] = [
      createMultiFleetPlayer("p1", "一"),
      createMultiFleetPlayer("p2", "二"),
      createMultiFleetPlayer("v1", "观众"),
    ];
    for (const p of [p1, p2, viewer]) h.players.set(p.id, p);
    const { room } = h.lifecycle.createRoom(p1, "public", "pvp", "standard", "2v2");
    assert.equal(h.lifecycle.joinRoom(p2, room, { sideId: "side2" }).ok, true);
    assert.equal(h.lifecycle.spectateRoom(viewer, room).ok, true);
    assert.equal(p2.seat, "P3");
    h.lifecycle.setPlayerReady(p1, true);
    h.lifecycle.setPlayerReady(p2, true);
    h.lifecycle.leaveRoom(p1);
    assert.equal(p2.seat, "P3", "多席房等待期房主离开绝不能将他人搬迁到其他席位或阵营");
    assert.equal(room.ownerId, p2.id, "房主离开后应移交房主权限给仍在座的玩家");
    assert.equal(room.ready.P3, false, "成员变动后就绪状态应重置");
    h.lifecycle.leaveRoom(p2);
    assert.equal(h.rooms.has(room.id), false, "最后一名参战玩家离开等待房后应关闭房间");
    assert.equal(viewer.roomId, null, "等待房关闭时应清理并通知滞留观众");
  }

  // 2) countdown 阶段：参战玩家离开取消倒计时并关闭房间
  {
    const h = createHarness();
    const ps = Array.from({ length: 4 }, (_, i) => {
      const p = createMultiFleetPlayer(`c${i}`, `倒计时${i}`);
      h.players.set(p.id, p);
      return p;
    });
    const { room } = h.lifecycle.createRoom(ps[0], "public", "pvp", "standard", "2v2");
    for (let i = 1; i < 4; i += 1) h.lifecycle.joinRoom(ps[i], room);
    for (const p of ps) h.lifecycle.setPlayerReady(p, true);
    // 强制进入倒计时状态测试倒计时中离开
    room.begin({ createMatch: () => ({ phase: "running", winnerSeat: null }), countdownMs: 3000, now: () => 0 });
    assert.equal(room.status, "countdown");
    h.lifecycle.leaveRoom(ps[2], "对手断开连接，房间已解散");
    assert.equal(h.rooms.has(room.id), false, "倒计时阶段参战玩家断线应关闭房间取消开赛");
    for (const p of ps) assert.equal(p.roomId, null);
    assert.ok(h.sent.every((entry) => entry.payload.reasonCode === "player_disconnected"));
  }

  // 3) running 阶段：单人离房不解散整房、不让新连接接管旧席、全员离线自动关闭
  {
    const h = createHarness();
    const ps = Array.from({ length: 4 }, (_, i) => {
      const p = createMultiFleetPlayer(`r${i}`, `实战${i}`);
      h.players.set(p.id, p);
      return p;
    });
    const viewer = createMultiFleetPlayer("rv", "观战者");
    const intruder = createMultiFleetPlayer("intruder", "冒名者");
    h.players.set(viewer.id, viewer);
    h.players.set(intruder.id, intruder);
    const { room } = h.lifecycle.createRoom(ps[0], "public", "pvp", "standard", "2v2");
    for (let i = 1; i < 4; i += 1) h.lifecycle.joinRoom(ps[i], room);
    for (const p of ps) h.lifecycle.setPlayerReady(p, true);
    assert.equal(h.lifecycle.spectateRoom(viewer, room).ok, true);
    assert.equal(h.lifecycle.startRoomMatch(ps[0]).ok, true);
    assert.equal(room.status, "running");

    // 观众离开不影响对局
    h.lifecycle.leaveRoom(viewer);
    assert.equal(h.rooms.has(room.id), true);
    assert.equal(h.lifecycle.spectateRoom(viewer, room).ok, true);

    // 房主（P1）运行中离开：不关闭房间、记录离线席位、按 seatOrder 移交房主（P2 即 ps[2]）、拒绝冒名者接管
    assert.equal(ps[2].seat, "P2", "自动均衡入座后 ps[2] 应占 P2");
    h.lifecycle.leaveRoom(ps[0], "对手断开连接，房间已解散");
    assert.equal(h.rooms.has(room.id), true, "多席运行中单人断线不得解散整房");
    assert.equal(room.status, "running");
    assert.equal(room.disconnectedSeats.has("P1"), true, "应记录离线席位");
    assert.equal(room.seats.P1, null);
    assert.equal(room.ownerId, ps[2].id, "运行中房主离开后应按 seatOrder 移交给下一个在线参战者");
    assert.equal(h.lifecycle.joinRoom(intruder, room).ok, false, "运行中拒绝新连接冒名接管离线席位");

    // 其余三名玩家依次离线：前两人离开房间仍运行，最后一人离线后房间立即关闭并清理观众
    h.lifecycle.leaveRoom(ps[1]);
    h.lifecycle.leaveRoom(ps[2]);
    assert.equal(h.rooms.has(room.id), true, "仍有最后一名参战玩家在线时房间应继续运行");
    h.lifecycle.leaveRoom(ps[3]);
    assert.equal(h.rooms.has(room.id), false, "所有参战玩家离线后应立即关闭房间");
    assert.equal(viewer.roomId, null, "全员离线关闭时应清理滞留观众");
    assert.equal(h.sent.at(-1).payload.reasonCode, "all_players_left");
  }

  // 4) 比赛房 3v3：主持不占参战位，主持离开统一关闭；ffa 3 人即可开局
  {
    const h = createHarness();
    const host = createMultiFleetPlayer("host", "主持");
    const ps = Array.from({ length: 6 }, (_, i) => createMultiFleetPlayer(`t${i}`, `选手${i}`));
    for (const p of [host, ...ps]) h.players.set(p.id, p);
    const { room } = h.lifecycle.createRoom(host, "public", "pvp", "tournament", "3v3");
    assert.equal(host.seat, null, "3v3 比赛房主持不得占用参战席位");
    assert.equal(host.spectating, true);
    for (const p of ps) {
      assert.equal(h.lifecycle.joinRoom(p, room).ok, true);
      assert.equal(h.lifecycle.setPlayerReady(p, true).ok, true);
    }
    assert.equal(h.lifecycle.startRoomMatch(ps[0]).ok, false, "比赛房只有主持可开赛");
    assert.equal(h.lifecycle.startRoomMatch(host).ok, true);
    h.lifecycle.leaveRoom(host);
    assert.equal(h.rooms.has(room.id), false);
    for (const p of ps) assert.equal(p.roomId, null, "3v3 比赛房关闭不得遗漏任何席位");

    const ffaPlayers = Array.from({ length: 3 }, (_, i) => createMultiFleetPlayer(`f${i}`, `混战${i}`));
    for (const p of ffaPlayers) h.players.set(p.id, p);
    const { room: ffaRoom } = h.lifecycle.createRoom(ffaPlayers[0], "public", "pvp", "standard", "ffa");
    assert.equal(h.lifecycle.joinRoom(ffaPlayers[1], ffaRoom).ok, true);
    assert.equal(h.lifecycle.setPlayerReady(ffaPlayers[0], true).ok, true);
    assert.equal(h.lifecycle.setPlayerReady(ffaPlayers[1], true).ok, true);
    assert.equal(h.lifecycle.startRoomMatch(ffaPlayers[0]).message, "参战人数不足，无法开始对局", "混战少于3人不能开局");
    assert.equal(h.lifecycle.setPlayerSide(ffaPlayers[0], "side2").message, "当前玩法格式不支持切换阵营");
    assert.equal(h.lifecycle.joinRoom(ffaPlayers[2], ffaRoom).ok, true);
    assert.equal(h.lifecycle.setPlayerReady(ffaPlayers[2], true).ok, true);
    assert.equal(h.lifecycle.startRoomMatch(ffaPlayers[0]).ok, true, "混战3人全员就绪应允许开局");
  }
}

function multiFleetCapacityAndCapabilityGuardCheck() {
  // 2v2 开局需 8 流单位 + 观众 1 = 9；超额拒绝且房间保持 waiting
  const h = createHarness({
    streamCapacityUnits: () => MAX_STREAM_CAPACITY_UNITS - 8,
  });
  const ps = Array.from({ length: 4 }, (_, i) => {
    const p = createMultiFleetPlayer(`cap${i}`, `容量${i}`);
    h.players.set(p.id, p);
    return p;
  });
  const viewer = createMultiFleetPlayer("capv", "容量观众");
  h.players.set(viewer.id, viewer);
  const { room } = h.lifecycle.createRoom(ps[0], "public", "pvp", "standard", "2v2");
  for (let i = 1; i < 4; i += 1) h.lifecycle.joinRoom(ps[i], room);
  for (const p of ps) h.lifecycle.setPlayerReady(p, true);
  assert.equal(h.lifecycle.spectateRoom(viewer, room).ok, true);
  assert.equal(h.lifecycle.startRoomMatch(ps[0]).message, "服务器实时流容量已满", "8玩家+1观众超配额应拒绝");
  assert.equal(room.status, "waiting", "容量拒绝不得产生半开局");
  // 观众离开后恰好 8 单位满足边界，允许开局
  h.lifecycle.leaveRoom(viewer);
  assert.equal(h.lifecycle.startRoomMatch(ps[0]).ok, true, "刚好在容量边界应允许开局");

  // 能力守卫覆盖创建、加入、观战、就绪失效与开局
  const capH = createHarness();
  const legacy = createPlayer("legacy", "旧端");
  const full = createMultiFleetPlayer("full", "新端");
  const full2 = createMultiFleetPlayer("full2", "新端2");
  const full3 = createMultiFleetPlayer("full3", "新端3");
  const full4 = createMultiFleetPlayer("full4", "新端4");
  for (const p of [legacy, full, full2, full3, full4]) capH.players.set(p.id, p);
  assert.equal(capH.lifecycle.createRoom(legacy, "public", "pvp", "standard", "2v2").ok, false);
  const { room: r2 } = capH.lifecycle.createRoom(full, "public", "pvp", "standard", "2v2");
  assert.equal(capH.lifecycle.joinRoom(legacy, r2).ok, false, "旧端不能加入2v2房");
  assert.equal(capH.lifecycle.spectateRoom(legacy, r2).ok, false, "旧端不能观战2v2房");
  for (const p of [full2, full3, full4]) {
    assert.equal(capH.lifecycle.joinRoom(p, r2).ok, true);
  }
  for (const p of [full, full2, full3, full4]) {
    assert.equal(capH.lifecycle.setPlayerReady(p, true).ok, true);
  }
  full4.supportedStateSchemas = new Set();
  assert.equal(capH.lifecycle.startRoomMatch(full).ok, false, "成员能力降级后开局必须拒绝");
  full4.supportedStateSchemas = new Set([MULTI_FLEET_STATE_SCHEMA]);
  assert.equal(capH.lifecycle.startRoomMatch(full).ok, true);
}

bunnyRulesetCheck();
tournamentLifecycleCheck();
tournamentWaitingAndCapacityCheck();
roomRegistryCheck();
roomLifecycleCheck();
spectatorLifecycleCheck();
finishedRoomForcedCloseCheck();
multiFleetFormatCatalogCheck();
multiFleetJoinSideReadyStartCheck();
multiFleetLeaveAndDisconnectMatrixCheck();
multiFleetCapacityAndCapabilityGuardCheck();
console.log("服务端房间契约校验通过：普通房回归、比赛房、2v2/3v3/ffa 多席组队、能力守卫、离房状态矩阵及容量门禁。");
