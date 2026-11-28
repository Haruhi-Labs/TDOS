import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { applyStatePatch } from "../shared/network-patch.js";
import { RULESET_VERSION } from "../shared/protocol/ruleset-version.js";
import {
  MULTI_FLEET_STATE_SCHEMA,
  ROOM_FORMAT_IDS,
  SUPPORTED_STATE_SCHEMAS,
} from "../shared/protocol/room-formats.js";
import { DEFAULT_WORLD_SIZE, MatchSimulation, TICK_DT } from "../shared/game-core.js";
import { defaultTeamSpawns } from "../shared/game/runtime/match-topology.js";
import { createRoomRegistry } from "../server/room-registry.js";
import { createMatchRuntime } from "../server/match-runtime.js";
import { beginRoomMatch } from "../server/room-state.js";
import { createStatisticsStore } from "../server/statistics-store.js";
import { buildServerMatchStatisticsRecord } from "../server/statistics-records.js";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomPort() {
  return 25000 + Math.floor(Math.random() * 2000);
}

class WsClient {
  constructor(url, name = "玩家") {
    this.url = url;
    this.name = name;
    this.ws = new WebSocket(url);
    this.messages = [];
    this.waiters = new Set();
    this.reconstructedState = null;
    this.lastSnapshotSeq = 0;
    this.autoAck = true;
    this.snapshotLog = [];
    this.ws.on("message", (raw) => {
      let message = null;
      try {
        message = JSON.parse(String(raw));
      } catch (_error) {
        return;
      }
      if (message.type === "snapshot" || message.type === "snapshot_delta") {
        if (message.type === "snapshot") {
          this.reconstructedState = message.state;
          this.lastSnapshotSeq = message.snapshotSeq;
        } else if (this.reconstructedState && message.baseSnapshotSeq === this.lastSnapshotSeq) {
          this.reconstructedState = applyStatePatch(this.reconstructedState, message.patch ?? null);
          this.lastSnapshotSeq = message.snapshotSeq;
        }
        this.snapshotLog.push({
          type: message.type,
          serverFrame: message.serverFrame,
          snapshotSeq: message.snapshotSeq,
          ackSeq: message.ackSeq,
          streamTier: message.streamTier,
          snapshotRate: message.snapshotRate,
          hasRadar: Object.hasOwn(message, "radar"),
          radar: message.radar || null,
          rawBytes: Buffer.byteLength(String(raw)),
          state: this.reconstructedState,
        });
        if (this.autoAck && this.ws.readyState === WebSocket.OPEN && message.snapshotSeq > 0) {
          this.send({ type: "snapshot_ack", snapshotSeq: message.snapshotSeq });
        }
      }
      this.messages.push(message);
      for (const waiter of [...this.waiters]) {
        if (waiter.predicate(message)) {
          this.waiters.delete(waiter);
          clearTimeout(waiter.timer);
          waiter.resolve(message);
        }
      }
    });
  }

  async open() {
    await Promise.race([
      new Promise((resolve, reject) => {
        this.ws.once("open", resolve);
        this.ws.once("error", reject);
      }),
      delay(3000).then(() => {
        throw new Error(`${this.name} 连接超时`);
      }),
    ]);
    return this;
  }

  send(payload) {
    this.ws.send(JSON.stringify(payload));
  }

  clearMessages() {
    this.messages.length = 0;
  }

  waitFor(predicate, timeoutMs = 6000, label = "消息") {
    const existing = [...this.messages].reverse().find(predicate);
    if (existing) {
      return Promise.resolve(existing);
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error(`${this.name} 等待${label}超时`));
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
  }

  waitForNew(predicate, timeoutMs = 6000, label = "新消息") {
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error(`${this.name} 等待${label}超时`));
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
  }

  async handshake({
    protocolVersion = 2,
    rulesetVersion = RULESET_VERSION,
    roomKinds = ["standard", "tournament"],
    stateSchemas = [...SUPPORTED_STATE_SCHEMAS],
    roomFormats = [...ROOM_FORMAT_IDS],
  } = {}) {
    const connected = await this.waitFor((m) => m.type === "connected", 4000, "connected");
    this.send({
      type: "protocol_hello",
      protocolVersion,
      rulesetVersion,
      roomKinds,
      stateSchemas,
      roomFormats,
    });
    if (this.name) {
      this.send({ type: "set_name", name: this.name });
    }
    return connected;
  }

  terminate() {
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
    }
    this.waiters.clear();
    if (this.ws.readyState !== WebSocket.CLOSED) {
      this.ws.terminate();
    }
  }
}

async function startIsolatedServer(envOverrides = {}) {
  const port = randomPort();
  const url = `ws://127.0.0.1:${port}`;
  const statsDir = await mkdtemp(join(tmpdir(), "haruhi-multiplayer-server-"));
  let output = "";
  const child = spawn(process.execPath, ["server/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      STATS_DATA_DIR: statsDir,
      PVP_COUNTDOWN_MS: "250",
      FINISHED_ROOM_CLOSE_DELAY_MS: "1000",
      MAX_CONNECTIONS: "64",
      MAX_ROOMS: "16",
      MAX_ACTIVE_ROOMS: "8",
      MAX_STREAM_CAPACITY_UNITS: "64",
      ...envOverrides,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { output += String(chunk); });

  for (let i = 0; i < 300; i += 1) {
    if (output.includes("网络对战服务器已启动")) {
      const clients = new Set();
      return {
        url,
        port,
        statsDir,
        getOutput: () => output,
        async connect(name, handshakeOptions) {
          const client = await new WsClient(url, name).open();
          clients.add(client);
          if (handshakeOptions !== false) {
            await client.handshake(handshakeOptions || {});
          } else {
            await client.waitFor((m) => m.type === "connected", 4000, "connected");
          }
          return client;
        },
        async closeClients() {
          for (const client of [...clients]) {
            client.terminate();
          }
          clients.clear();
          await delay(100);
        },
        async stop() {
          await this.closeClients();
          if (child.exitCode === null) {
            child.kill("SIGTERM");
            await Promise.race([
              new Promise((resolve) => child.once("exit", resolve)),
              delay(1200),
            ]);
            if (child.exitCode === null) {
              child.kill("SIGKILL");
            }
          }
          await rm(statsDir, { recursive: true, force: true });
        },
      };
    }
    if (child.exitCode !== null) {
      await rm(statsDir, { recursive: true, force: true });
      throw new Error(`回环服务提前退出：${output}`);
    }
    await delay(10);
  }
  child.kill("SIGKILL");
  await rm(statsDir, { recursive: true, force: true });
  throw new Error(`回环服务启动超时：${output}`);
}

const protocolSamples = {};

async function scenarioJoinReadyStartAndLock(server) {
  const players = [];
  for (let i = 0; i < 5; i += 1) {
    players.push(await server.connect(`队员${i + 1}`));
  }
  const spectator = await server.connect("场边观众");

  const connected = players[0].messages.find((m) => m.type === "connected");
  assert.deepEqual(connected.stateSchemas, ["legacy-v1", "multi-fleet-v1"]);
  assert.deepEqual(connected.roomFormats, ["duel", "2v2", "3v3", "ffa"]);
  protocolSamples.connected = {
    roomKinds: connected.roomKinds,
    stateSchemas: connected.stateSchemas,
    roomFormats: connected.roomFormats,
    protocolVersion: connected.protocolVersion,
    rulesetVersion: connected.rulesetVersion,
  };

  // 非法格式拒绝
  players[0].send({ type: "create_room", visibility: "public", mode: "pvp", formatId: "5v5" });
  const badFormat = await players[0].waitForNew((m) => m.type === "error", 3000, "格式错误");
  assert.equal(badFormat.code, "unsupported_room_format");

  // 创建 2v2 房间
  players[0].send({ type: "create_room", visibility: "public", mode: "pvp", formatId: "2v2" });
  const createdState = await players[0].waitForNew((m) => m.type === "room_state" && m.room.formatId === "2v2");
  const roomId = createdState.room.roomId;
  assert.equal(createdState.self.seat, "P1");
  assert.equal(createdState.self.sideId, "side1");
  assert.equal(createdState.self.isOwner, true);
  assert.equal(createdState.room.capacity, 4);

  // 重复占位、无效组、满组拒绝
  players[0].send({ type: "join_room", roomId });
  assert.equal((await players[0].waitForNew((m) => m.type === "error")).code, "already_in_room");

  players[1].send({ type: "join_room", roomId, sideId: "side99" });
  assert.equal((await players[1].waitForNew((m) => m.type === "error")).code, "invalid_side");

  players[1].send({ type: "join_room", roomId, sideId: "side1" });
  const p2Joined = await players[1].waitForNew((m) => m.type === "room_state" && m.self?.seat === "P2");
  assert.equal(p2Joined.self.sideId, "side1");

  players[2].send({ type: "join_room", roomId, sideId: "side1" });
  assert.equal((await players[2].waitForNew((m) => m.type === "error")).code, "side_full");

  players[2].send({ type: "join_room", roomId, sideId: "side2" });
  const p3Joined = await players[2].waitForNew((m) => m.type === "room_state" && m.self?.seat === "P3");
  assert.equal(p3Joined.self.sideId, "side2");

  // 观众不占参战席位
  spectator.send({ type: "spectate_room", roomId });
  const specState = await spectator.waitForNew((m) => m.type === "room_state" && m.self?.spectating === true);
  assert.equal(specState.self.seat, null);
  assert.equal(specState.room.spectatorCount, 1);

  // 未满员不能开始
  for (const p of players.slice(0, 3)) {
    p.send({ type: "set_ready", ready: true });
    await p.waitForNew((m) => m.type === "room_state");
  }
  players[0].send({ type: "start_match" });
  assert.equal((await players[0].waitForNew((m) => m.type === "error")).code, "insufficient_players");

  // 换组使本人就绪失效；第 4 人补位；第 5 人满房拒绝
  players[1].send({ type: "set_side", sideId: "side2" });
  const p2Switched = await players[1].waitForNew((m) => m.type === "room_state" && m.self?.seat === "P4");
  assert.equal(p2Switched.self.sideId, "side2");
  assert.equal(p2Switched.room.players.find((row) => row.seat === "P4").ready, false, "换组后就绪必须失效");

  players[3].send({ type: "join_room", roomId });
  const p4Joined = await players[3].waitForNew((m) => m.type === "room_state" && m.self?.seat === "P2");
  assert.equal(p4Joined.self.sideId, "side1");

  players[4].send({ type: "join_room", roomId });
  assert.equal((await players[4].waitForNew((m) => m.type === "error")).code, "room_full");

  // 非房主不能开局；未全员就绪不能开局；换阵容使本人就绪失效
  players[1].send({ type: "start_match" });
  assert.equal((await players[1].waitForNew((m) => m.type === "error")).code, "room_owner_only");

  players[0].send({ type: "start_match" });
  assert.equal((await players[0].waitForNew((m) => m.type === "error")).code, "players_not_ready");

  players[1].send({ type: "set_ready", ready: true });
  players[3].send({ type: "set_ready", ready: true });
  await players[3].waitForNew((m) => m.type === "room_state" && m.room.players.every((r) => r.ready));

  // 换阵容后本人就绪失效
  players[3].send({ type: "set_loadout", loadout: { main: "asakura", sub1: "koizumi", sub2: "kyon" } });
  const afterLoadout = await players[3].waitForNew((m) => m.type === "room_state" && m.room.players.find((r) => r.seat === "P2")?.ready === false);
  assert.equal(afterLoadout.room.players.find((r) => r.seat === "P1").ready, true, "换阵容不影响其他玩家就绪");

  players[0].send({ type: "start_match" });
  assert.equal((await players[0].waitForNew((m) => m.type === "error")).code, "players_not_ready");

  // 重新就绪后开局，开局后阵营与阵容锁定
  players[3].send({ type: "set_ready", ready: true });
  await players[0].waitForNew((m) => m.type === "room_state" && m.room.players.every((r) => r.ready));
  players[0].send({ type: "start_match" });

  await Promise.all(players.slice(0, 4).map((p) => p.waitForNew((m) => m.type === "room_state" && m.room.status === "running")));
  players[0].send({ type: "set_side", sideId: "side2" });
  assert.equal((await players[0].waitForNew((m) => m.type === "error")).code, "side_switch_locked");
  players[0].send({ type: "set_loadout", loadout: { main: "yuki", sub1: "haruhi", sub2: "kyon" } });
  assert.equal((await players[0].waitForNew((m) => m.type === "error")).code, "loadout_locked");

  protocolSamples.roomStateRunning2v2 = players[0].messages.findLast((m) => m.type === "room_state");
  await server.closeClients();
}

async function scenarioSixSocketsInputsRadarAndResync(server) {
  const players = [];
  for (let i = 0; i < 6; i += 1) {
    players.push(await server.connect(`六人${i + 1}`));
  }
  const spectator = await server.connect("六人观众");

  // P1 选用长门（私有雷达），其余 5 人不含长门
  players[0].send({ type: "set_loadout", loadout: { main: "yuki", sub1: "haruhi", sub2: "koizumi" } });
  for (let i = 1; i < 6; i += 1) {
    players[i].send({ type: "set_loadout", loadout: { main: "kyon", sub1: "asakura", sub2: "tsuruya" } });
  }
  await delay(60);

  players[0].send({ type: "create_room", visibility: "public", mode: "pvp", formatId: "3v3" });
  const created = await players[0].waitForNew((m) => m.type === "room_state" && m.room.formatId === "3v3");
  const roomId = created.room.roomId;

  const seatByClient = new Map([[players[0], "P1"]]);
  for (let i = 1; i < 6; i += 1) {
    players[i].send({ type: "join_room", roomId });
    const joined = await players[i].waitForNew((m) => m.type === "room_state" && Boolean(m.self?.seat));
    seatByClient.set(players[i], joined.self.seat);
  }
  assert.deepEqual([...seatByClient.values()].sort(), ["P1", "P2", "P3", "P4", "P5", "P6"], "六名玩家应分别占满六席");

  spectator.send({ type: "spectate_room", roomId });
  await spectator.waitForNew((m) => m.type === "room_state" && m.self?.spectating === true);

  for (const p of players) {
    p.send({ type: "set_ready", ready: true });
  }
  await players[0].waitForNew((m) => m.type === "room_state" && m.room.players.every((r) => r.ready));

  players[0].send({ type: "start_match" });
  await Promise.all(players.map((p) => p.waitForNew((m) => m.type === "room_state" && m.room.status === "running")));

  // 六连接同时发送相同 seq=1（合法各自设档与选舰）、seq=2（伪造身份字段动作）、重复 seq=1
  const throttlesBySeat = { P1: 0.4, P2: 0.7, P3: 1.0, P4: 1.4, P5: 0.4, P6: 0.7 };
  const selectedBySeat = { P1: "main", P2: "sub1", P3: "sub2", P4: "main", P5: "sub1", P6: "sub2" };
  for (const p of players) {
    const seat = seatByClient.get(p);
    p.send({ type: "select_ship", shipKey: selectedBySeat[seat] });
    p.send({ type: "input", seq: 1, action: { type: "set_throttle", shipKey: "main", throttle: throttlesBySeat[seat] } });
    // 伪造身份字段的恶意输入：试图把 P1 档位改到 0，不得生效但仍推进本连接 ACK
    p.send({ type: "input", seq: 2, action: { type: "set_throttle", shipKey: "main", throttle: 0, seat: "P1", sideId: "side1" } });
    // 乱序/重复 seq=1 应被忽略
    p.send({ type: "input", seq: 1, action: { type: "set_throttle", shipKey: "main", throttle: 0 } });
  }

  // 等待全部六名玩家收到 ackSeq === 2 的快照以及差量帧
  await Promise.all(players.map((p) => p.waitForNew(
    (m) => (m.type === "snapshot" || m.type === "snapshot_delta") && m.ackSeq === 2,
    5000,
    "ackSeq=2",
  )));
  await players[0].waitForNew((m) => m.type === "snapshot_delta", 5000, "delta");
  await spectator.waitForNew((m) => m.type === "snapshot" || m.type === "snapshot_delta", 5000, "观众快照");

  // 验证每个连接还原的状态包含完整 6 支舰队且各自档位与选舰严格对应、无越权
  for (const p of players) {
    const seat = seatByClient.get(p);
    const latest = p.snapshotLog.at(-1);
    assert.equal(latest.state.schema, MULTI_FLEET_STATE_SCHEMA);
    assert.deepEqual(latest.state.seatOrder, ["P1", "P2", "P3", "P4", "P5", "P6"]);
    assert.equal(Object.keys(latest.state.teams).length, 6);
    assert.equal(latest.ackSeq, 2, `${seat} 的 ACK 应独立推进到 2`);
    for (const s of ["P1", "P2", "P3", "P4", "P5", "P6"]) {
      assert.equal(latest.state.teams[s].ships.main.throttle, throttlesBySeat[s], `${s} 舰队档位不得被他人伪造载荷覆盖`);
      assert.equal(latest.state.selectedShips[s], selectedBySeat[s], `${s} 选舰状态应独立同步`);
    }
    if (seat === "P1") {
      assert.equal(latest.hasRadar, true, "P1 长门应收到自己的私有雷达");
      assert.equal(latest.radar?.active, true);
    } else {
      assert.equal(latest.hasRadar, false, `${seat} 不得收到 P1 的私有雷达`);
    }
    assert.equal(Object.hasOwn(latest.state.teams.P1.radarSweep, "contacts"), false, "私有雷达回波绝不能进入共享状态");
  }

  // 观众不收到私有雷达，且收到完整 6 舰队状态
  const specLatest = spectator.snapshotLog.at(-1);
  assert.equal(specLatest.hasRadar, false, "观众绝不能收到任何私有雷达");
  assert.equal(specLatest.state.schema, MULTI_FLEET_STATE_SCHEMA);
  assert.deepEqual(specLatest.state.seatOrder, ["P1", "P2", "P3", "P4", "P5", "P6"]);

  // 同 serverFrame 跨连接重建状态逐字节一致
  const p1FrameMap = new Map(players[0].snapshotLog.map((e) => [e.serverFrame, e.state]));
  const commonEntry = players[3].snapshotLog.find((e) => p1FrameMap.has(e.serverFrame));
  assert.ok(commonEntry, "应存在多连接共享的同一 serverFrame 快照");
  assert.deepEqual(commonEntry.state, p1FrameMap.get(commonEntry.serverFrame), "多连接通过 full+delta 还原的同帧权威状态必须完全一致");

  // 模拟 P2 丢差量后主动请求 snapshot_resync，服务端补发完整 snapshot 并恢复一致
  players[1].reconstructedState = null;
  players[1].lastSnapshotSeq = 0;
  players[1].send({ type: "snapshot_resync", snapshotSeq: 0 });
  const resynced = await players[1].waitForNew((m) => m.type === "snapshot", 4000, "补全量关键帧");
  assert.equal(resynced.state.schema, MULTI_FLEET_STATE_SCHEMA);
  assert.deepEqual(resynced.state.seatOrder, ["P1", "P2", "P3", "P4", "P5", "P6"]);

  // 记录 3v3 全量与差量快照字节样本供容量参考
  const fullSample = players[0].snapshotLog.find((e) => e.type === "snapshot");
  const deltaSample = players[0].snapshotLog.find((e) => e.type === "snapshot_delta");
  protocolSamples.snapshot3v3Metrics = {
    fullSnapshotBytes: fullSample?.rawBytes || 0,
    deltaSnapshotBytes: deltaSample?.rawBytes || 0,
    seatCount: 6,
  };

  await server.closeClients();
}

async function scenarioCapabilityNegotiationAndLegacyDuel(server) {
  const modernA = await server.connect("新端甲");
  const legacyNoCap = await server.connect("旧端无新能力", {
    protocolVersion: 2,
    rulesetVersion: RULESET_VERSION,
    roomKinds: ["standard", "tournament"],
    stateSchemas: [],
    roomFormats: [],
  });
  const legacyNoRuleset = await server.connect("旧端无规则版本", false);
  const wrongRuleset = await server.connect("错版本端", {
    protocolVersion: 2,
    rulesetVersion: "ruleset-20260701-01",
    stateSchemas: [...SUPPORTED_STATE_SCHEMAS],
    roomFormats: [...ROOM_FORMAT_IDS],
  });
  await wrongRuleset.waitFor((m) => m.type === "ruleset_mismatch");

  // 旧端尝试开 2v2 房被拒
  legacyNoCap.send({ type: "create_room", visibility: "public", mode: "pvp", formatId: "2v2" });
  assert.equal((await legacyNoCap.waitForNew((m) => m.type === "error")).code, "multi_fleet_client_unsupported");

  legacyNoRuleset.send({ type: "create_room", visibility: "public", mode: "pvp", formatId: "2v2" });
  assert.equal((await legacyNoRuleset.waitForNew((m) => m.type === "error")).code, "multi_fleet_ruleset_required");

  // 错版本端全部入口被拒
  for (const type of ["create_room", "join_room", "spectate_room", "set_side", "set_ready", "start_match", "input"]) {
    wrongRuleset.send({ type, roomId: "000000", sideId: "side1", ready: true, seq: 1, action: { type: "split", level: 1 } });
    const blocked = await wrongRuleset.waitForNew((m) => m.type === "ruleset_mismatch" && m.blockedType === type);
    assert.equal(blocked.blockedType, type);
  }

  // 新端建 2v2 房，旧端加入和观战均被拒
  modernA.send({ type: "create_room", visibility: "public", mode: "pvp", formatId: "2v2" });
  const room2v2 = (await modernA.waitForNew((m) => m.type === "room_state" && m.room.formatId === "2v2")).room.roomId;

  legacyNoCap.send({ type: "join_room", roomId: room2v2 });
  assert.equal((await legacyNoCap.waitForNew((m) => m.type === "error")).code, "multi_fleet_client_unsupported");
  legacyNoCap.send({ type: "spectate_room", roomId: room2v2 });
  assert.equal((await legacyNoCap.waitForNew((m) => m.type === "error")).code, "multi_fleet_client_unsupported");

  legacyNoRuleset.send({ type: "join_room", roomId: room2v2 });
  assert.equal((await legacyNoRuleset.waitForNew((m) => m.type === "error")).code, "multi_fleet_ruleset_required");

  // 旧端仍可正常走旧 duel 流程，且收到旧 schema（无 multi-fleet-v1）
  const legacyB = await server.connect("旧端乙", false);
  legacyNoRuleset.send({ type: "create_room", visibility: "public", mode: "pvp" });
  const duelCreated = await legacyNoRuleset.waitForNew((m) => m.type === "room_state" && m.room.status === "waiting");
  assert.equal(duelCreated.room.formatId, undefined, "旧 duel 房状态应保持原兼容结构");
  legacyB.send({ type: "join_room", roomId: duelCreated.room.roomId });
  await legacyNoRuleset.waitForNew((m) => m.type === "room_state" && m.room.status === "running");
  const duelSnap = await legacyNoRuleset.waitForNew((m) => m.type === "snapshot");
  assert.equal(duelSnap.state.schema, undefined, "旧 duel 快照不应带 multi-fleet-v1 schema");
  assert.deepEqual(Object.keys(duelSnap.state.teams).sort(), ["A", "B"]);

  // 协议版本=1 但声明了 multi-fleet-v1、formatId 和 RULESET_VERSION 的端可正常建房（传输协议与状态 schema 独立）
  const v1Modern = await server.connect("全量新端", {
    protocolVersion: 1,
    rulesetVersion: RULESET_VERSION,
    stateSchemas: [MULTI_FLEET_STATE_SCHEMA],
    roomFormats: ["ffa"],
  });
  v1Modern.send({ type: "create_room", visibility: "public", mode: "pvp", formatId: "ffa" });
  const ffaCreated = await v1Modern.waitForNew((m) => m.type === "room_state" && m.room.formatId === "ffa");
  assert.equal(ffaCreated.room.formatId, "ffa");

  await server.closeClients();
}

async function scenarioSlowSpectatorIsolation(server) {
  const players = [];
  for (let i = 0; i < 4; i += 1) {
    players.push(await server.connect(`稳态${i + 1}`));
  }
  const slowSpectator = await server.connect("慢观众");
  slowSpectator.autoAck = false;

  players[0].send({ type: "create_room", visibility: "public", mode: "pvp", formatId: "2v2" });
  const roomId = (await players[0].waitForNew((m) => m.type === "room_state")).room.roomId;
  for (let i = 1; i < 4; i += 1) {
    players[i].send({ type: "join_room", roomId });
    await players[i].waitForNew((m) => m.type === "room_state");
  }
  slowSpectator.send({ type: "spectate_room", roomId });
  await slowSpectator.waitForNew((m) => m.type === "room_state" && m.self?.spectating === true);
  for (const p of players) {
    p.send({ type: "set_ready", ready: true });
  }
  await players[0].waitForNew((m) => m.type === "room_state" && m.room.players.every((r) => r.ready));
  players[0].send({ type: "start_match" });
  await players[0].waitForNew((m) => m.type === "room_state" && m.room.status === "running");

  // 等待足够时间让不 ACK 的慢观众触发拥塞降频（> 1.4s 且在途快照增加）
  await delay(1800);

  assert.ok(slowSpectator.snapshotLog.some((e) => e.streamTier > 0), "不 ACK 的慢观众必须独立降频");
  for (const p of players) {
    const recent = p.snapshotLog.slice(-5);
    assert.ok(recent.length >= 3, "健康玩家应持续收到快照推进");
    assert.ok(recent.every((e) => e.streamTier === 0), "慢观众不得拖慢健康玩家发送档位");
  }
  await server.closeClients();
}

async function scenarioDisconnectLifecycleMatrix(server) {
  // 1) waiting 阶段房主离开不搬迁他人席位且移交房主
  {
    const p1 = await server.connect("等待房主");
    const p2 = await server.connect("等待队员");
    p1.send({ type: "create_room", visibility: "public", mode: "pvp", formatId: "2v2" });
    const roomId = (await p1.waitForNew((m) => m.type === "room_state")).room.roomId;
    p2.send({ type: "join_room", roomId, sideId: "side2" });
    const p2Joined = await p2.waitForNew((m) => m.type === "room_state" && m.self?.seat === "P3");
    assert.equal(p2Joined.self.sideId, "side2");
    p1.send({ type: "leave_room" });
    const afterLeave = await p2.waitForNew((m) => m.type === "room_state" && m.self?.isOwner === true);
    assert.equal(afterLeave.self.seat, "P3", "等待期房主离开不得挪动他人席位");
    assert.equal(afterLeave.self.sideId, "side2", "等待期房主离开不得改变他人阵营");
    await server.closeClients();
  }

  // 2) countdown 阶段玩家断线取消倒计时关闭房间
  {
    const ps = [];
    for (let i = 0; i < 4; i += 1) ps.push(await server.connect(`倒计时端${i + 1}`));
    ps[0].send({ type: "create_room", visibility: "public", mode: "pvp", formatId: "2v2" });
    const roomId = (await ps[0].waitForNew((m) => m.type === "room_state")).room.roomId;
    for (let i = 1; i < 4; i += 1) {
      ps[i].send({ type: "join_room", roomId });
      await ps[i].waitForNew((m) => m.type === "room_state");
    }
    for (const p of ps) p.send({ type: "set_ready", ready: true });
    await ps[0].waitForNew((m) => m.type === "room_state" && m.room.players.every((r) => r.ready));
    ps[0].send({ type: "start_match" });
    await ps[0].waitForNew((m) => m.type === "room_state" && m.room.status === "countdown");
    ps[2].terminate();
    const closed = await ps[0].waitForNew((m) => m.type === "room_closed", 4000, "倒计时关闭");
    assert.equal(closed.reasonCode, "player_disconnected");
    await server.closeClients();
  }

  // 3) running 阶段单人/房主断线继续运行、拒绝冒名接管、全员离线自动回收
  {
    const ps = [];
    for (let i = 0; i < 4; i += 1) ps.push(await server.connect(`实战端${i + 1}`));
    const spectator = await server.connect("实战观众");
    const intruder = await server.connect("冒名连接");

    ps[0].send({ type: "create_room", visibility: "public", mode: "pvp", formatId: "2v2" });
    const roomId = (await ps[0].waitForNew((m) => m.type === "room_state")).room.roomId;
    for (let i = 1; i < 4; i += 1) {
      ps[i].send({ type: "join_room", roomId });
      await ps[i].waitForNew((m) => m.type === "room_state");
    }
    spectator.send({ type: "spectate_room", roomId });
    await spectator.waitForNew((m) => m.type === "room_state" && m.self?.spectating === true);
    for (const p of ps) p.send({ type: "set_ready", ready: true });
    await ps[0].waitForNew((m) => m.type === "room_state" && m.room.players.every((r) => r.ready));
    ps[0].send({ type: "start_match" });
    await ps[1].waitForNew((m) => m.type === "room_state" && m.room.status === "running");

    // 房主断线：其余 3 人仍运行且看到 P1 connected=false
    ps[0].terminate();
    const updated = await ps[1].waitForNew((m) => m.type === "room_state" && m.room.players.find((r) => r.seat === "P1")?.connected === false);
    assert.equal(updated.room.status, "running", "多席运行中单人断线不得解散房间");

    // 新连接试图加入接管旧席被拒绝
    intruder.send({ type: "join_room", roomId });
    assert.equal((await intruder.waitForNew((m) => m.type === "error")).code, "room_not_waiting");

    // 其余三名玩家相继断线后，滞留观众收到 all_players_left 房间关闭
    ps[1].terminate();
    ps[2].terminate();
    await delay(120);
    assert.equal(spectator.messages.some((m) => m.type === "room_closed"), false, "仍有玩家在线时不得关闭房间");
    ps[3].terminate();
    const allLeft = await spectator.waitForNew((m) => m.type === "room_closed", 4000, "全员离线关闭");
    assert.equal(allLeft.reasonCode, "all_players_left");
    await server.closeClients();
  }

  // 4) 3v3 比赛房主持离开关闭全房，所有 6 席与观众收到 tournament_host_left
  {
    const host = await server.connect("比赛主持");
    const ps = [];
    for (let i = 0; i < 6; i += 1) ps.push(await server.connect(`选手${i + 1}`));
    host.send({ type: "create_room", visibility: "public", mode: "pvp", kind: "tournament", formatId: "3v3" });
    const created = await host.waitForNew((m) => m.type === "room_state" && m.self?.isHost === true);
    const roomId = created.room.roomId;
    assert.equal(created.self.seat, null, "比赛房主持不占参战位");
    for (const p of ps) {
      p.send({ type: "join_room", roomId });
      await p.waitForNew((m) => m.type === "room_state" && Boolean(m.self?.seat));
    }
    host.terminate();
    const closedEvents = await Promise.all(ps.map((p) => p.waitForNew((m) => m.type === "room_closed", 4000, "主持离房关闭")));
    assert.ok(closedEvents.every((e) => e.reasonCode === "tournament_host_left"), "全部六名选手都应收到主持离房关闭通知");
    await server.closeClients();
  }

  // 5) ffa 3人开局运行中：单人离房不解散，全员离线自动关闭
  {
    const ps = [];
    for (let i = 0; i < 3; i += 1) ps.push(await server.connect(`混战${i + 1}`));
    const viewer = await server.connect("混战观众");
    ps[0].send({ type: "create_room", visibility: "public", mode: "pvp", formatId: "ffa" });
    const created = await ps[0].waitForNew((m) => m.type === "room_state" && m.room.formatId === "ffa");
    const roomId = created.room.roomId;
    for (let i = 1; i < 3; i += 1) {
      ps[i].send({ type: "join_room", roomId });
      await ps[i].waitForNew((m) => m.type === "room_state" && Boolean(m.self?.seat));
    }
    viewer.send({ type: "spectate_room", roomId });
    await viewer.waitForNew((m) => m.type === "room_state" && m.self?.spectating === true);
    for (const p of ps) p.send({ type: "set_ready", ready: true });
    await ps[0].waitForNew((m) => m.type === "room_state" && m.room.players.filter((r) => r.playerId).every((r) => r.ready));
    ps[0].send({ type: "start_match" });
    await ps[0].waitForNew((m) => m.type === "room_state" && m.room.status === "running");
    const ffaSnap = await ps[0].waitForNew((m) => m.type === "snapshot" && m.state?.schema === MULTI_FLEET_STATE_SCHEMA);
    assert.deepEqual(ffaSnap.state.seatOrder, ["P1", "P2", "P3"], "3人混战只应实例化实际入座的3支舰队");
    ps[0].terminate();
    await ps[1].waitForNew((m) => m.type === "room_state" && m.room.players.find((r) => r.seat === "P1")?.connected === false);
    ps[1].terminate();
    ps[2].terminate();
    const closed = await viewer.waitForNew((m) => m.type === "room_closed", 4000, "混战全员离线关闭");
    assert.equal(closed.reasonCode, "all_players_left");
    await server.closeClients();
  }
}

async function scenarioCapacityBoundaryAndStatistics() {
  // 1) 容量边界回环：MAX_STREAM_CAPACITY_UNITS=12，MAX_ACTIVE_ROOMS=1
  const capServer = await startIsolatedServer({
    MAX_STREAM_CAPACITY_UNITS: "12",
    MAX_ACTIVE_ROOMS: "1",
    PVP_COUNTDOWN_MS: "200",
  });
  try {
    const ps = [];
    for (let i = 0; i < 6; i += 1) ps.push(await capServer.connect(`容量${i + 1}`));
    const viewer = await capServer.connect("容量观众");
    ps[0].send({ type: "create_room", visibility: "public", mode: "pvp", formatId: "3v3" });
    const roomId = (await ps[0].waitForNew((m) => m.type === "room_state")).room.roomId;
    for (let i = 1; i < 6; i += 1) {
      ps[i].send({ type: "join_room", roomId });
      await ps[i].waitForNew((m) => m.type === "room_state");
    }
    viewer.send({ type: "spectate_room", roomId });
    await viewer.waitForNew((m) => m.type === "room_state" && m.self?.spectating === true);
    for (const p of ps) p.send({ type: "set_ready", ready: true });
    await ps[0].waitForNew((m) => m.type === "room_state" && m.room.players.every((r) => r.ready));

    // 6*2 + 1 = 13 > 12 → 拒绝且保持 waiting
    ps[0].send({ type: "start_match" });
    const capErr = await ps[0].waitForNew((m) => m.type === "error");
    assert.equal(capErr.code, "server_stream_capacity_limit");

    // 观众退出后 6*2 = 12 <= 12 → 合法开局
    viewer.send({ type: "leave_room" });
    await ps[0].waitForNew((m) => m.type === "room_state" && m.room.spectatorCount === 0);
    ps[0].send({ type: "start_match" });
    await ps[0].waitForNew((m) => m.type === "room_state" && m.room.status === "running");

    // 全部离房释放资源后，再开一局 2v2 正常通过
    for (const p of ps) p.terminate();
    await delay(150);

    const p2v2 = [];
    for (let i = 0; i < 4; i += 1) p2v2.push(await capServer.connect(`复用${i + 1}`));
    p2v2[0].send({ type: "create_room", visibility: "public", mode: "pvp", formatId: "2v2" });
    const room2 = (await p2v2[0].waitForNew((m) => m.type === "room_state")).room.roomId;
    for (let i = 1; i < 4; i += 1) {
      p2v2[i].send({ type: "join_room", roomId: room2 });
      await p2v2[i].waitForNew((m) => m.type === "room_state");
    }
    for (const p of p2v2) p.send({ type: "set_ready", ready: true });
    await p2v2[0].waitForNew((m) => m.type === "room_state" && m.room.players.every((r) => r.ready));
    p2v2[0].send({ type: "start_match" });
    await p2v2[0].waitForNew((m) => m.type === "room_state" && m.room.status === "running");
  } finally {
    await capServer.stop();
  }

  // 2) 多席真实结算与统计存储隔离：验证完成回调恰一次、含全部参与者（含运行中离房玩家）、旧 1v1 榜单零混入
  const statsDir = await mkdtemp(join(tmpdir(), "haruhi-multiplayer-stats-"));
  try {
    const store = createStatisticsStore({ dataDir: statsDir, hashSalt: "test-salt" });
    await store.ready();
    const players = new Map();
    const rooms = new Map();
    const registry = createRoomRegistry({ players, rooms });
    const room = registry.createRoomRecord("public", "pvp", 1000, "standard", "2v2");
    rooms.set(room.id, room);

    const spawns = defaultTeamSpawns("2v2", DEFAULT_WORLD_SIZE);
    const loadout = { main: "haruhi", sub1: "kyon", sub2: "koizumi" };
    const fleets = [
      { seat: "P1", sideId: "side1", name: "甲1舰队", loadout, spawn: spawns.side1[0] },
      { seat: "P2", sideId: "side1", name: "甲2舰队", loadout, spawn: spawns.side1[1] },
      { seat: "P3", sideId: "side2", name: "乙1舰队", loadout, spawn: spawns.side2[0] },
      { seat: "P4", sideId: "side2", name: "乙2舰队", loadout, spawn: spawns.side2[1] },
    ];
    const fallbackParticipantsBySeat = {};
    for (const f of fleets) {
      const p = {
        id: `stat-${f.seat}`,
        name: f.name,
        loadout,
        roomId: null,
        seat: null,
        spectating: false,
        selectedShipKey: "main",
        statisticsProfile: { clientId: `client-${f.seat}`, nickname: f.name, faction: "blue", locale: "zh" },
      };
      players.set(p.id, p);
      registry.assignPlayerToRoom(p, room, f.seat);
      fallbackParticipantsBySeat[f.seat] = { id: p.id, name: p.name, statisticsProfile: { ...p.statisticsProfile } };
    }

    let nowMs = 2000;
    beginRoomMatch(room, {
      countdownMs: 0,
      now: () => nowMs,
      matchRoster: fleets.map((f) => ({ seat: f.seat, sideId: f.sideId, name: f.name, loadout: f.loadout, isBot: false })),
      createMatch: () => new MatchSimulation({
        mode: "pvp",
        battleMode: "team_elimination",
        formatId: "2v2",
        worldSize: DEFAULT_WORLD_SIZE,
        fleets,
        seed: 20261128,
      }),
    });
    room.startRunning(nowMs);

    // 模拟 P1 运行中离线，同时 side2 通过合法伤害全灭触发 side1 获胜
    room.releaseSeat("stat-P1");
    const attacker = room.match.teamBySeat("P2").ships.main;
    for (const seat of ["P3", "P4"]) {
      const team = room.match.teamBySeat(seat);
      for (const ship of team.getAllShips()) {
        if (ship.alive) {
          ship.takeDamage(ship.maxHp * 10, attacker, room.match);
        }
      }
    }

    let finishCallbacks = 0;
    const records = [];
    const runtime = createMatchRuntime({
      rooms,
      applyQueuedInputs() {},
      sendSnapshot() {},
      sendRoomStateToMembers() {},
      broadcastLobby() {},
      buildMatchResult: registry.buildMatchResult,
      closeRoom() {},
      onMatchFinished(targetRoom, currentTime) {
        finishCallbacks += 1;
        const record = buildServerMatchStatisticsRecord({
          room: targetRoom,
          getPlayerById: registry.getPlayerById,
          fallbackParticipantsBySeat,
          hashSalt: "test-salt",
          now: currentTime,
        });
        records.push(record);
      },
      now: () => nowMs,
      schedule() {},
      tickDt: TICK_DT,
      snapshotInterval: 1 / 15,
    });

    runtime.tickRooms();
    nowMs += 50;
    runtime.tickRooms();

    assert.equal(finishCallbacks, 1, "多席对局终局统计回调必须恰好触发一次");
    assert.equal(records.length, 1);
    assert.equal(records[0].schemaVersion, 3);
    assert.equal(records[0].formatId, "2v2");
    assert.equal(records[0].participants.length, 4, "统计记录必须保留全部 4 名参与者含已离房玩家");
    assert.deepEqual(records[0].outcome, { type: "win", winnerSideId: "side1", winnerSeats: ["P1", "P2"] });

    const saved = await store.record(records[0], { trusted: true });
    assert.equal(saved.accepted, true);
    const dup = await store.record(records[0], { trusted: true });
    assert.equal(dup.accepted, false, "重复终局统计记录应被去重拒绝");
    await store.flush();

    const reloaded = createStatisticsStore({ dataDir: statsDir, hashSalt: "test-salt" });
    await reloaded.ready();
    assert.equal(reloaded.publicLeaderboard().modes.multiplayer.matches, 0, "新 2v2 记录不得混入旧 1v1 榜单");
    assert.equal(reloaded.formatLeaderboard({ formatId: "2v2" }).matches, 1, "重启恢复后应能按格式读取 2v2 统计");
    assert.equal(reloaded.formatLeaderboard({ formatId: "3v3" }).matches, 0, "2v2 记录不得混入 3v3 统计桶");
    protocolSamples.finalResult2v2 = room.result;
  } finally {
    await rm(statsDir, { recursive: true, force: true });
  }
}

const server = await startIsolatedServer();
try {
  await scenarioJoinReadyStartAndLock(server);
  await scenarioSixSocketsInputsRadarAndResync(server);
  await scenarioCapabilityNegotiationAndLegacyDuel(server);
  await scenarioSlowSpectatorIsolation(server);
  await scenarioDisconnectLifecycleMatrix(server);
  await scenarioCapacityBoundaryAndStatistics();
  console.log(
    `多人服务端回环校验通过：4/6 席入座与换组锁定、6 连接并发独立输入与防越权、能力协商与旧 duel 兼容、full+delta/补全量与雷达隔离、慢观众降频隔离、离房状态矩阵、容量边界与完整统计归档。3v3 全量快照 ${protocolSamples.snapshot3v3Metrics.fullSnapshotBytes}B / 差量 ${protocolSamples.snapshot3v3Metrics.deltaSnapshotBytes}B。`,
  );
} catch (error) {
  console.error(`多人服务端回环校验失败：${error instanceof Error ? error.stack || error.message : String(error)}`);
  if (server.getOutput().trim()) {
    console.error(`回环服务输出：\n${server.getOutput().trim()}`);
  }
  process.exitCode = 1;
} finally {
  await server.stop();
}
