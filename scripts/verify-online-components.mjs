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
import { createThrottleCommandState } from "../src/online/throttle-command-state.js";
import { createStatePatch } from "../shared/network-patch.js";
import { RULESET_VERSION } from "../shared/protocol/ruleset-version.js";

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
  baseUrl: "/game/",
});
assert.deepEqual(forced, ["wss://debug.example/socket"]);

const production = buildServerUrlCandidates({
  locationObject: {
    search: "",
    protocol: "https:",
    host: "test.haruyuki.cn",
    hostname: "test.haruyuki.cn",
  },
  baseUrl: "/game/",
});
assert.deepEqual(production, [
  "wss://test.haruyuki.cn/game/ws/",
  "wss://test.haruyuki.cn:21246/",
]);
assert.equal(
  defaultServerUrl({
    locationObject: {
      search: "",
      protocol: "https:",
      host: "test.haruyuki.cn",
      hostname: "test.haruyuki.cn",
    },
    baseUrl: "/game/",
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
let playerId = null;
const transport = createOnlineSnapshotTransport({
  isConnected: () => true,
  onPlayerId: (id) => { playerId = id; },
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
  rulesetVersion: RULESET_VERSION,
  tickRate: 30,
  snapshotRate: 15,
  serverTime: 10_025,
});
assert.equal(playerId, "player-a");
assert.equal(transport.state.serverSnapshotRate, 15);
assert.equal(transport.state.clockOffsetMs, 25);
assert.equal(transport.state.rulesetCompatible, true);
assert.equal(transport.state.rulesetStatus, "compatible");
assert.deepEqual(sentMessages.at(-1), {
  type: "protocol_hello",
  protocolVersion: 2,
  rulesetVersion: RULESET_VERSION,
  roomKinds: ["standard", "tournament"],
});

transport.handleConnected({
  playerId: "legacy-player",
  protocolVersion: 1,
  tickRate: 30,
  snapshotRate: 15,
});
assert.equal(transport.state.rulesetCompatible, true, "未声明规则版本的旧服务端应保持兼容");
assert.equal(transport.state.rulesetStatus, "legacy");

transport.handleConnected({
  playerId: "mismatch-player",
  protocolVersion: 2,
  rulesetVersion: "ruleset-20260701-01",
  tickRate: 30,
  snapshotRate: 15,
});
assert.equal(transport.state.rulesetCompatible, false, "显式规则版本冲突必须阻止进入对局");
assert.equal(transport.state.rulesetStatus, "mismatch");

transport.handleConnected({
  playerId: "player-a",
  protocolVersion: 2,
  rulesetVersion: RULESET_VERSION,
  tickRate: 30,
  snapshotRate: 15,
  serverTime: 10_025,
});

const fullState = { phase: "running", winnerSeat: null, teams: { A: { hullRatio: 1 }, B: { hullRatio: 1 } } };
const firstSnapshot = transport.receiveSnapshot({
  type: "snapshot",
  snapshotSeq: 1,
  snapshotRate: 20,
  simTime: 1,
  serverTime: 10_025,
  state: fullState,
});
assert.equal(firstSnapshot.state, fullState);
assert.equal(transport.state.serverSnapshotRate, 20);
assert.throws(() => { transport.state.rulesetCompatible = false; }, TypeError);
assert.throws(() => { firstSnapshot.state.teams.A.hullRatio = 0; }, TypeError);
assert.throws(() => { transport.state.snapshots.shift(); }, TypeError);
assert.equal(transport.state.latestSnapshot.tick, 30);
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
assert.equal(transport.state.snapshots.length, 2);
assert.equal(transport.state.snapshotArrivalMs, 70);

transport.sendPingProbe();
const ping = sentMessages.at(-1);
currentTime += 80;
transport.handlePong({ pingId: ping.pingId, serverRecvTime: currentTime - 45, serverSendTime: currentTime - 40 });
assert.equal(transport.state.pingMs, 80);
assert.equal(transport.state.pendingPings, undefined, "调用方不得访问可写探针集合");
assert.ok(connectionUiUpdates >= 2);

transport.handleRulesetMismatch({ serverRulesetVersion: "其他版本" });
assert.equal(transport.state.rulesetCompatible, false);
assert.equal(transport.state.serverRulesetVersion, "其他版本");
transport.resetMatchState();
assert.equal(transport.state.snapshots.length, 0);
assert.equal(transport.state.latestSnapshot, null);
assert.equal(transport.state.decodedSnapshotState, undefined, "差量基线属于传输内部状态");

const throttleCommands = createThrottleCommandState({ maxAckHoldMs: 1200 });
assert.equal(throttleCommands.valueFor("main", 1), 1);
assert.equal(throttleCommands.record("main", 12, 1.4, 20_000), true);
assert.equal(
  throttleCommands.valueFor("main", 1),
  1.4,
  "换挡往返期间不应被旧权威快照覆盖",
);
throttleCommands.reconcile({ ackSeq: 11, ships: { main: { throttle: 1 } }, nowMs: 20_050 });
assert.equal(throttleCommands.valueFor("main", 1), 1.4, "未确认换挡被过早清除");
throttleCommands.reconcile({ ackSeq: 12, ships: { main: { throttle: 1 } }, nowMs: 20_100 });
assert.equal(throttleCommands.valueFor("main", 1), 1.4, "刚确认但尚未反映的换挡没有保留等待窗口");
throttleCommands.reconcile({ ackSeq: 12, ships: { main: { throttle: 1.4 } }, nowMs: 20_150 });
assert.equal(throttleCommands.valueFor("main", 1.4), 1.4, "权威快照确认换挡后档位异常");

throttleCommands.record("sub1", 13, 0.7, 21_000);
throttleCommands.reconcile({ ackSeq: 13, ships: { sub1: { throttle: 1 } }, nowMs: 21_100 });
throttleCommands.reconcile({ ackSeq: 13, ships: { sub1: { throttle: 1 } }, nowMs: 22_301 });
assert.equal(throttleCommands.valueFor("sub1", 1), 1, "未生效的换挡意图超时后仍覆盖权威状态");

console.log("联机组件校验通过：连接目标、时钟校准、快照差量、换挡确认与队列维护保持一致。");

assert.deepEqual(buildServerUrlCandidates({
  locationObject: { host: "haruyuki.cn", hostname: "haruyuki.cn", protocol: "https:", search: "?ws=wss://star.haruyuki.cn/ws/" },
  baseUrl: "/test-game/",
}), ["wss://haruyuki.cn/test-game/ws/"], "测试服不得回落或被查询参数改向正式联机服务");

// 结算视图持有自身显示生命周期，外部只提供冻结读模型和显式事件回调。
const { createOnlineResultView } = await import("../src/online/result-view.js");
const oldDocument = globalThis.document;
const subtitle = { textContent: "" };
globalThis.document = { getElementById: (id) => id === "resultSub" ? subtitle : null };
try {
  const classes = new Set();
  const ui = {
    overlay: { classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) } },
    overlayTitle: { textContent: "" },
  };
  const context = Object.freeze({ seat: "A", spectating: false, room: Object.freeze({ roomId: "test-result", closesAt: 0 }) });
  const winners = [];
  const logs = [];
  const result = createOnlineResultView({ getContext: () => context, ui, log: (value) => logs.push(value), onWinner: (winner) => winners.push(winner) });
  result.show("A");
  result.show("A");
  assert.equal(logs.length, 1, "重复快照不得重复记录结算");
  assert.deepEqual(winners, ["A", "A"]);
  assert.equal(classes.has("hidden"), false);
  result.close();
  assert.equal(classes.has("hidden"), true);
  result.show("B");
  assert.equal(logs.length, 2, "关闭后下一次展示应重新生成结算");
  result.reset();
  result.show(null);
  assert.equal(logs.length, 3, "重开应清除显示去重状态");
  assert.equal(winners.at(-1), null);
  assert.equal(context.seat, "A", "视图不能反写会话上下文");
  result.close();
} finally {
  if (oldDocument === undefined) delete globalThis.document;
  else globalThis.document = oldDocument;
}
console.log("结算视图边界通过：冻结上下文、显式事件、显示去重与重置。");
