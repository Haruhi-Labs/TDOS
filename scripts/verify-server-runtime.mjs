import assert from "node:assert/strict";
import { createInputQueue } from "../server/input-queue.js";
import { createMatchRuntime } from "../server/match-runtime.js";

function createPlayer(id) {
  return {
    id,
    inputQueue: [],
    lastProcessedSeq: 0,
    lastQueuedSeq: 0,
  };
}

function inputQueueCheck() {
  const networkStats = { coalescedInputs: 0 };
  const queue = createInputQueue({ networkStats });
  const player = createPlayer("a");

  assert.equal(queue.queueInput(player, {
    seq: 1,
    action: { type: "set_throttle", shipKey: "main", throttle: 0.4 },
  }), true, "合法输入应进入队列");
  queue.queueInput(player, {
    seq: 2,
    action: { type: "set_throttle", shipKey: "main", throttle: 0.8 },
  });
  assert.equal(player.inputQueue.length, 1, "同舰连续推进输入应合并为最新值");
  assert.equal(player.inputQueue[0].seq, 2, "合并后应保留最新输入序号");
  assert.equal(networkStats.coalescedInputs, 1, "输入合并应计入网络指标");

  queue.queueInput(player, {
    seq: 3,
    action: { type: "set_throttle", shipKey: "sub1", throttle: 1 },
  });
  assert.equal(player.inputQueue.length, 2, "不同舰船的推进输入不得相互覆盖");
  assert.equal(queue.queueInput(player, {
    seq: 2,
    action: { type: "split", level: 1 },
  }), false, "重复或倒序输入应被拒绝");

  for (let seq = 4; seq <= 103; seq += 1) {
    queue.queueInput(player, { seq, action: { type: "fire", direction: "front" } });
  }
  assert.equal(player.inputQueue.length, 90, "积压输入应保持现有 90 条上限");

  const applied = [];
  const applyPlayer = createPlayer("apply");
  for (let seq = 1; seq <= 35; seq += 1) {
    applyPlayer.inputQueue.push({ seq, action: { type: "test", seq } });
  }
  const room = {
    seats: { A: applyPlayer.id, B: null },
    match: {
      applyActionForSeat(seat, action) {
        applied.push({ seat, action });
      },
    },
  };
  queue.applyQueuedInputs(room, (id) => id === applyPlayer.id ? applyPlayer : null);
  assert.equal(applied.length, 30, "每个逻辑帧每位玩家最多处理 30 条输入");
  assert.equal(applyPlayer.lastProcessedSeq, 30, "确认序号应跟随最后处理的输入");
  assert.equal(applyPlayer.inputQueue.length, 5, "未处理输入应留到后续逻辑帧");
}

function matchLifecycleCheck() {
  let time = 1100;
  let inputApplications = 0;
  let snapshots = 0;
  let roomStates = 0;
  let lobbyBroadcasts = 0;
  let updates = 0;
  const room = {
    id: "room",
    status: "countdown",
    countdownEndsAt: 1200,
    snapshotAccumulator: 0,
    match: {
      phase: "running",
      update() {
        updates += 1;
        if (updates === 2) {
          this.phase = "finished";
        }
      },
    },
  };
  const runtime = createMatchRuntime({
    rooms: new Map([[room.id, room]]),
    applyQueuedInputs() { inputApplications += 1; },
    sendSnapshot() { snapshots += 1; },
    sendRoomStateToMembers() { roomStates += 1; },
    broadcastLobby() { lobbyBroadcasts += 1; },
    buildMatchResult(target) { return { roomId: target.id, finishedAt: time }; },
    now: () => time,
    schedule() {},
    tickDt: 0.1,
    snapshotInterval: 0.2,
    maxCatchupSteps: 2,
  });

  runtime.tickRooms();
  assert.equal(updates, 0, "倒计时结束前权威模拟不得推进");
  time = 1200;
  runtime.tickRooms();
  assert.equal(room.status, "running", "倒计时到点后应进入运行状态");
  assert.equal(inputApplications, 1, "进入运行状态的同一逻辑帧应开始消费输入");
  assert.equal(snapshots, 1, "倒计时结束时应立即发送权威快照");

  time = 1300;
  runtime.tickRooms();
  assert.equal(room.status, "finished", "模拟结束后房间应进入结算状态");
  assert.equal(snapshots, 3, "常规快照与最终快照均不得遗漏");
  assert.equal(roomStates, 2, "倒计时结束与结算时均应广播房间状态");
  assert.equal(lobbyBroadcasts, 2, "房间关键状态变化均应刷新大厅");
  assert.equal(room.result.roomId, room.id, "结算数据应来自统一结果构建器");
}

function catchupLimitCheck() {
  let updates = 0;
  const room = {
    id: "catchup",
    status: "running",
    snapshotAccumulator: 0,
    match: {
      phase: "running",
      update() { updates += 1; },
    },
  };
  const runtime = createMatchRuntime({
    rooms: new Map([[room.id, room]]),
    applyQueuedInputs() {},
    sendSnapshot() {},
    sendRoomStateToMembers() {},
    broadcastLobby() {},
    buildMatchResult() { return null; },
    now: () => 0,
    schedule() {},
    tickDt: 0.1,
    snapshotInterval: 10,
    maxCatchupSteps: 2,
  });
  assert.equal(runtime.advanceLoop(1000), 2, "单轮追帧不得超过配置上限");
  assert.equal(updates, 2, "追帧上限应同时约束模拟更新次数");
  assert.equal(runtime.advanceLoop(1100), 1, "触发上限后应丢弃过期积压而非持续追赶");
}

inputQueueCheck();
matchLifecycleCheck();
catchupLimitCheck();
console.log("服务端运行时校验通过：输入合并、顺序确认、倒计时、快照与追帧上限保持稳定。");
