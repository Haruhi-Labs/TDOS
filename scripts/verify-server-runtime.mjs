import { beginRoomMatch, startRoomRunning, finishRoomMatch } from "../server/room-state.js";
import assert from "node:assert/strict";
import { createInputQueue } from "../server/input-queue.js";
import { FINISHED_ROOM_CLOSE_DELAY_MS } from "../server/config.js";
import { createMatchRuntime } from "../server/match-runtime.js";

function createPlayer(id) {
  return { id };
}

function roomStateOwnershipCheck() {
  let clock = 100;
  let creations = 0;
  const room = { mode: "pvp", status: "waiting", result: { old: true }, snapshotSeq: 50 };
  const createMatch = () => {
    creations += 1;
    assert.equal(room.status, "countdown");
    return { phase: "running" };
  };
  assert.equal(beginRoomMatch(room, { createMatch, countdownMs: 3000, now: () => clock++ }), true);
  assert.equal(room.startedAt, 100);
  assert.equal(room.countdownEndsAt, 3101, "保持两次取时与创建模拟的原顺序");
  assert.equal(room.result, null);
  assert.equal(room.snapshotSeq, 0);
  assert.equal(beginRoomMatch(room, { createMatch }), false);
  assert.equal(creations, 1, "重复开局不得替换模拟");
  assert.equal(startRoomRunning(room, 3100), false);
  assert.equal(startRoomRunning(room, 3101), true);
  assert.equal(room.countdownEndsAt, null);
  assert.equal(finishRoomMatch(room, 3200, 1000, () => assert.fail("未结束不得构建结果")), false);
  room.match.phase = "finished";
  assert.equal(finishRoomMatch(room, 3200, 1000, (target) => {
    assert.equal(target.status, "finished");
    assert.equal(target.closesAt, 4200);
    return { winnerSeat: "A" };
  }), true);
  assert.equal(finishRoomMatch(room, 3300, 1000, () => assert.fail("不得重复结算")), false);
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
  assert.equal(queue.inspect(player).pendingSequences.length, 1, "同舰连续推进输入应合并为最新值");
  assert.equal(queue.inspect(player).pendingSequences[0], 2, "合并后应保留最新输入序号");
  assert.equal(networkStats.coalescedInputs, 1, "输入合并应计入网络指标");

  queue.queueInput(player, {
    seq: 3,
    action: { type: "set_throttle", shipKey: "sub1", throttle: 1 },
  });
  assert.equal(queue.inspect(player).pendingSequences.length, 2, "不同舰船的推进输入不得相互覆盖");
  assert.equal(queue.queueInput(player, {
    seq: 2,
    action: { type: "split", level: 1 },
  }), false, "重复或倒序输入应被拒绝");

  for (let seq = 4; seq <= 103; seq += 1) {
    queue.queueInput(player, { seq, action: { type: "fire", direction: "front" } });
  }
  assert.equal(queue.inspect(player).pendingSequences.length, 90, "积压输入应保持现有 90 条上限");

  const applied = [];
  const applyPlayer = createPlayer("apply");
  for (let seq = 1; seq <= 35; seq += 1) {
    queue.queueInput(applyPlayer, { seq, action: { type: "test", seq } });
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
  assert.equal(queue.inspect(applyPlayer).lastProcessedSeq, 30, "确认序号应跟随最后处理的输入");
  assert.equal(queue.inspect(applyPlayer).pendingSequences.length, 5, "未处理输入应留到后续逻辑帧");
  assert.equal(applyPlayer.inputQueue, undefined, "连接记录不得持有可写输入队列");
  assert.throws(() => queue.inspect(applyPlayer).pendingSequences.pop(), TypeError);
  queue.reset(applyPlayer);
  assert.deepEqual(queue.inspect(applyPlayer).pendingSequences, []);
  assert.equal(queue.inspect(applyPlayer).lastProcessedSeq, 0);
  const action = { type: "test", seq: 1, nested: { value: 1 } };
  queue.queueInput(applyPlayer, { seq: 1, action });
  action.nested.value = 9;
  queue.applyQueuedInputs(room, (id) => id === applyPlayer.id ? applyPlayer : null);
  assert.equal(applied.at(-1).action.nested.value, 1, "提交后修改原动作不得影响待执行队列");
}

function matchLifecycleCheck() {
  let time = 1100;
  let inputApplications = 0;
  let snapshots = 0;
  let roomStates = 0;
  let lobbyBroadcasts = 0;
  let roomCloses = 0;
  let closeReason = null;
  let updates = 0;
  let finishedCallbacks = 0;
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
  const rooms = new Map([[room.id, room]]);
  const runtime = createMatchRuntime({
    rooms,
    applyQueuedInputs() { inputApplications += 1; },
    sendSnapshot() { snapshots += 1; },
    sendRoomStateToMembers() { roomStates += 1; },
    broadcastLobby() { lobbyBroadcasts += 1; },
    buildMatchResult(target) { return { roomId: target.id, finishedAt: time }; },
    closeRoom(roomId, reason) {
      roomCloses += 1;
      closeReason = reason;
      rooms.delete(roomId);
    },
    onMatchFinished(target) {
      finishedCallbacks += 1;
      assert.equal(target.id, room.id, "统计回调应收到已完成房间");
    },
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
  assert.equal(finishedCallbacks, 1, "同一场对局只能触发一次统计回调");
  assert.equal(
    room.closesAt,
    room.finishedAt + FINISHED_ROOM_CLOSE_DELAY_MS,
    "结算房间应设置服务端权威的十秒关闭截止时间",
  );

  time = room.closesAt - 1;
  runtime.tickRooms();
  assert.equal(roomCloses, 0, "十秒倒计时结束前不得提前关闭结算房间");
  assert.equal(finishedCallbacks, 1, "结算等待期间不得重复统计同一场对局");
  time = room.closesAt;
  runtime.tickRooms();
  assert.equal(roomCloses, 1, "十秒倒计时到点后必须强制关闭结算房间");
  assert.equal(closeReason, "对局结束，已返回大厅", "自动回收应使用统一结算关闭原因");
  assert.equal(rooms.has(room.id), false, "自动回收后房间不得继续留在注册表中");
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
    closeRoom() {},
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

roomStateOwnershipCheck();
inputQueueCheck();
matchLifecycleCheck();
catchupLimitCheck();
console.log("服务端运行时校验通过：输入合并、顺序确认、开局倒计时、结算强制回收、快照与追帧上限保持稳定。");
