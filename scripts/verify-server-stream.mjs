import assert from "node:assert/strict";
import { createSnapshotStream } from "../server/snapshot-stream.js";
import { applyStatePatch } from "../shared/network-patch.js";
let time = 1000;
const networkStats = { snapshotMessages: 0, snapshotRawBytes: 0, keyframes: 0, deltas: 0, skippedSnapshots: 0, streamTierChanges: 0 };
const messages = [];
const player = { networkProtocolVersion: 2, ws: { readyState: 1, bufferedAmount: 0, send: (text) => messages.push(JSON.parse(text)) } };
const stream = createSnapshotStream({ networkStats, now: () => time });
function frame(sequence) {
  const state = { tick: sequence, text: "稳定数据".repeat(400) };
  return { roomId: "room", roomSnapshotSeq: sequence, tick: sequence, simTime: sequence / 30, serverTime: time, state, stateBytes: Buffer.byteLength(JSON.stringify(state)) };
}
stream.resetSnapshotStream(player);
assert.equal(player.snapshotStream, undefined, "连接记录不得暴露差量基线与可写发送状态");
const firstFrame = frame(1);
assert.equal(stream.sendSnapshotToPlayer(player, firstFrame), true);
assert.throws(() => { firstFrame.state.tick = 999; }, TypeError, "已投递快照不得被外部写回差量基线");
assert.equal(messages.at(-1).type, "snapshot");
assert.equal(stream.acknowledge(player, 2), false, "未来确认不得被接受");
assert.equal(stream.acknowledge(player, 1), true);
assert.equal(stream.acknowledge(player, 1), false, "重复确认不得推进时钟");
stream.sendSnapshotToPlayer(player, frame(2));
assert.equal(messages.at(-1).type, "snapshot_delta");
assert.deepEqual(applyStatePatch(messages[0].state, messages[1].patch), frame(2).state);
stream.requestKeyframe(player);
stream.sendSnapshotToPlayer(player, frame(3));
assert.equal(messages.at(-1).type, "snapshot");
stream.upgradeProtocol(player);
stream.sendSnapshotToPlayer(player, frame(4));
assert.equal(messages.at(-1).type, "snapshot");
time += 10000;
stream.sendSnapshotToPlayer(player, frame(5));
assert.ok(stream.rateTierFor(player) > 0, "未确认的积压仍必须触发降频");
stream.resetSnapshotStream(player);
assert.equal(stream.rateTierFor(player), 0);
stream.sendSnapshotToPlayer(player, frame(6));
assert.equal(messages.at(-1).snapshotSeq, 1, "新对局使用新的发送序列");

// 多舰队场景：六席私有雷达隔离、观众无雷达、慢连接降频不影响其他玩家推进
{
  let t = 2000;
  const stats = { snapshotMessages: 0, snapshotRawBytes: 0, keyframes: 0, deltas: 0, skippedSnapshots: 0, streamTierChanges: 0 };
  const multiStream = createSnapshotStream({ networkStats: stats, now: () => t });
  const makePeer = (id) => {
    const inbox = [];
    const peer = {
      id,
      networkProtocolVersion: 2,
      ws: { readyState: 1, bufferedAmount: 0, send: (text) => inbox.push(JSON.parse(text)) },
      inbox,
    };
    multiStream.resetSnapshotStream(peer);
    return peer;
  };
  const p1 = makePeer("P1");
  const p2 = makePeer("P2");
  const slowSpectator = makePeer("S1");
  const makeMultiFrame = (seq) => {
    const state = {
      schema: "multi-fleet-v1",
      seatOrder: ["P1", "P2", "P3", "P4"],
      tick: seq,
      teams: {
        P1: { seat: "P1", sideId: "side1", x: 100 + seq, pad: "A".repeat(400) },
        P2: { seat: "P2", sideId: "side1", x: 200 + seq, pad: "B".repeat(400) },
        P3: { seat: "P3", sideId: "side2", x: 300 + seq, pad: "C".repeat(400) },
        P4: { seat: "P4", sideId: "side2", x: 400 + seq, pad: "D".repeat(400) },
      },
      outcome: null,
    };
    return {
      roomId: "mf-room",
      roomSnapshotSeq: seq,
      tick: seq,
      simTime: seq / 30,
      serverTime: t,
      state,
      stateBytes: Buffer.byteLength(JSON.stringify(state)),
    };
  };

  const f1 = makeMultiFrame(1);
  multiStream.sendSnapshotToPlayer(p1, f1, { ackSeq: 1, radar: { active: true, contacts: [{ id: 9, x: 500, y: 500 }] } });
  multiStream.sendSnapshotToPlayer(p2, f1, { ackSeq: 2, radar: null });
  multiStream.sendSnapshotToPlayer(slowSpectator, f1, { ackSeq: 0, spectating: true });
  assert.equal(p1.inbox[0].radar.active, true, "长门玩家应收到自己的私有雷达");
  assert.equal(Object.hasOwn(p2.inbox[0], "radar"), false, "其他玩家不得收到他人私有雷达");
  assert.equal(Object.hasOwn(slowSpectator.inbox[0], "radar"), false, "观众不得收到任何私有雷达");
  assert.equal(p1.inbox[0].ackSeq, 1);
  assert.equal(p2.inbox[0].ackSeq, 2);

  // 正常玩家持续确认，慢观众既不确认又积压；正常玩家持续收到完整差量且还原一致，慢观众触发降频/跳过
  multiStream.acknowledge(p1, 1);
  multiStream.acknowledge(p2, 1);
  let p1State = p1.inbox[0].state;
  let p2State = p2.inbox[0].state;
  for (let seq = 2; seq <= 25; seq += 1) {
    t += 200;
    const f = makeMultiFrame(seq);
    if (seq >= 6 && seq <= 10) slowSpectator.ws.bufferedAmount = 256 * 1024;
    else slowSpectator.ws.bufferedAmount = 0;

    assert.equal(multiStream.sendSnapshotToPlayer(p1, f, { ackSeq: seq, radar: { active: true, contacts: [{ id: 9, x: 500 + seq, y: 500 }] } }), true);
    assert.equal(multiStream.sendSnapshotToPlayer(p2, f, { ackSeq: seq * 2, radar: null }), true);
    multiStream.sendSnapshotToPlayer(slowSpectator, f, { ackSeq: 0, spectating: true });

    const m1 = p1.inbox.at(-1);
    const m2 = p2.inbox.at(-1);
    p1State = m1.type === "snapshot" ? m1.state : applyStatePatch(p1State, m1.patch);
    p2State = m2.type === "snapshot" ? m2.state : applyStatePatch(p2State, m2.patch);
    assert.deepEqual(p1State, f.state, "P1 还原的多舰队状态应与权威状态一致");
    assert.deepEqual(p2State, f.state, "P2 还原的多舰队状态应与权威状态一致");
    assert.equal(Object.hasOwn(m2, "radar"), false, "差量帧也不得泄露私有雷达");
    multiStream.acknowledge(p1, m1.snapshotSeq);
    multiStream.acknowledge(p2, m2.snapshotSeq);
  }
  assert.equal(multiStream.rateTierFor(p1), 0, "健康玩家不得被慢观众拖慢档位");
  assert.equal(multiStream.rateTierFor(p2), 0, "健康玩家不得被慢观众拖慢档位");
  assert.ok(multiStream.rateTierFor(slowSpectator) > 0, "不确认的慢观众必须独立降频");
  assert.ok(stats.skippedSnapshots > 0, "发送缓冲超限的慢连接应跳过旧帧");
}

console.log("快照流所有权校验通过：内部基线不可访问，确认、重同步、升级、降频、多席雷达隔离与重置保持契约。");
