import assert from "node:assert/strict";
import {
  buildServerUrlCandidates,
  defaultServerUrl,
  isLocalHostname,
} from "../src/online/connection-target.js";
import {
  createOnlineSnapshotTransport,
  DEFAULT_INTERP_MS,
} from "../src/online/snapshot-transport.js";
import { createStatePatch } from "../shared/network-patch.js";

assert.equal(isLocalHostname("localhost"), true);
assert.equal(isLocalHostname("192.168.1.20"), true);
assert.equal(isLocalHostname("172.31.0.8"), true);
assert.equal(isLocalHostname("haruyuki.cn"), false);

const forced = buildServerUrlCandidates({
  locationObject: {
    search: "?ws=wss%3A%2F%2Fdebug.example%2Fsocket",
    protocol: "https:",
    host: "haruyuki.cn",
    hostname: "haruyuki.cn",
  },
  baseUrl: "/test-game/",
});
assert.deepEqual(forced, ["wss://debug.example/socket"]);

const production = buildServerUrlCandidates({
  locationObject: {
    search: "",
    protocol: "https:",
    host: "haruyuki.cn",
    hostname: "haruyuki.cn",
  },
  baseUrl: "/test-game/",
});
assert.deepEqual(production, [
  "wss://haruyuki.cn/test-game/ws/",
  "wss://haruyuki.cn:21246/",
]);
assert.equal(
  defaultServerUrl({
    locationObject: {
      search: "",
      protocol: "https:",
      host: "haruyuki.cn",
      hostname: "haruyuki.cn",
    },
    baseUrl: "/test-game/",
  }),
  production[0],
);

const local = buildServerUrlCandidates({
  locationObject: {
    search: "",
    protocol: "http:",
    host: "127.0.0.1:5174",
    hostname: "127.0.0.1",
  },
  baseUrl: "/",
});
assert.deepEqual(local, [
  "ws://127.0.0.1:5174/ws/",
  "ws://127.0.0.1:21246/",
  "ws://localhost:21246/",
]);

let currentTime = 10_000;
const sentMessages = [];
let connectionUiUpdates = 0;
const transportApp = {
  connected: true,
  pingMs: 0,
  jitterMs: 0,
  interpDelayMs: DEFAULT_INTERP_MS,
  pingTimer: null,
  pingSeq: 0,
  pendingPings: new Map(),
  rttVarianceMs: 0,
  bestClockRttMs: Infinity,
  clockOffsetMs: 0,
  clockReady: false,
  serverTickRate: 30,
  serverSnapshotRate: 20,
  networkProtocolVersion: 2,
  snapshotIntervalMs: 50,
  snapshots: [],
  latestSnapshot: null,
  lastSnapshotTick: 0,
  lastSnapshotSeq: 0,
  decodedSnapshotState: null,
  decodedSnapshotSeq: 0,
  lastSnapshotAckSentAt: 0,
  lastAckedSnapshotSeq: 0,
  lastSnapshotArriveAtMs: 0,
  snapshotArrivalMs: 0,
  snapshotArrivalJitterMs: 0,
  snapshotLossRatio: 0,
  snapshotReorderRatio: 0,
};
const transport = createOnlineSnapshotTransport({
  app: transportApp,
  nowMs: () => currentTime,
  socketSend: (payload) => {
    sentMessages.push(payload);
    return true;
  },
  updateConnectionUi: () => { connectionUiUpdates += 1; },
  log: () => {},
});

transport.handleConnected({
  playerId: "player-a",
  protocolVersion: 2,
  tickRate: 30,
  snapshotRate: 15,
  serverTime: 10_025,
});
assert.equal(transportApp.playerId, "player-a");
assert.equal(transportApp.serverSnapshotRate, 15);
assert.equal(transportApp.clockOffsetMs, 25);
assert.deepEqual(sentMessages.at(-1), { type: "protocol_hello", protocolVersion: 2 });

const fullState = { phase: "running", winnerSeat: null, teams: { A: { hullRatio: 1 }, B: { hullRatio: 1 } } };
const firstSnapshot = transport.receiveSnapshot({
  type: "snapshot",
  snapshotSeq: 1,
  tick: 30,
  simTime: 1,
  serverTime: 10_025,
  state: fullState,
});
assert.equal(firstSnapshot.state, fullState);
assert.equal(transportApp.latestSnapshot.tick, 30);
assert.deepEqual(sentMessages.at(-1), { type: "snapshot_ack", snapshotSeq: 1 });

currentTime += 70;
const nextState = { ...fullState, teams: { ...fullState.teams, A: { hullRatio: 0.75 } } };
const secondSnapshot = transport.receiveSnapshot({
  type: "snapshot_delta",
  snapshotSeq: 2,
  baseSnapshotSeq: 1,
  tick: 32,
  simTime: 32 / 30,
  serverTime: 10_095,
  patch: createStatePatch(fullState, nextState),
});
assert.deepEqual(secondSnapshot.state, nextState);
assert.equal(transportApp.snapshots.length, 2);
assert.equal(transportApp.snapshotArrivalMs, 70);

transportApp.pendingPings.set(7, currentTime - 80);
transport.handlePong({ pingId: 7, serverRecvTime: currentTime - 45, serverSendTime: currentTime - 40 });
assert.equal(transportApp.pingMs, 80);
assert.equal(transportApp.pendingPings.has(7), false);
assert.ok(connectionUiUpdates >= 2);

transport.resetMatchState();
assert.equal(transportApp.snapshots.length, 0);
assert.equal(transportApp.decodedSnapshotState, null);

console.log("联机组件校验通过：连接目标、时钟校准、快照差量、确认与队列维护保持一致。");
