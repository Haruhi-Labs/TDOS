import assert from "node:assert/strict";
import { MatchSimulation } from "../shared/game-core.js";
import { createSupportState, initializeSupport, readSupportState, unlockSupport, tickSupportSource,
  suspendSupportSchedule, resumeSupportSchedule, triggerSupportOtherworlder } from "../shared/game/characters/haruhi/support.js";

const initial = createSupportState();
const owner = {};
initializeSupport(owner, initial);
const read = () => readSupportState(owner);
const state = read();
const source = { sourceShip: { alive: true }, owner, get state() { return read(); }, enabled: true };
initial.supporters.add("alien");
initial.queuedBeamAt.push(100);
assert.equal(state.supporters.size, 0, "收归组件后不得保留输入集合的可写别名");
assert.deepEqual(read().queuedBeamAt, []);
initializeSupport(owner, createSupportState());
assert.equal(read(), state, "重复初始化不得重置日程");
assert.throws(() => state.supporters.add("esper"), TypeError);
assert.throws(() => { state.timeTravelerNextAt = 1; }, TypeError);
assert.throws(() => state.queuedBeamAt.push(1), TypeError);
let rolls = 0;
assert.equal(unlockSupport(owner, ["time_traveler"], 0, () => { rolls += 1; return 0; }), "time_traveler");
assert.equal(unlockSupport(owner, ["time_traveler"], 0, () => { rolls += 1; return 0; }), null);
assert.equal(rolls, 1);
const unlocked = read().supporters;
const launches = [];
tickSupportSource(source, 10, 0, { launchRandomBeam: () => launches.push("beam") });
const queued = read().queuedBeamAt;
assert.deepEqual(queued, [10.3, 10.6]);
assert.deepEqual(launches, ["beam"]);
suspendSupportSchedule(owner);
tickSupportSource({ ...source, enabled: false }, 11, 1);
assert.deepEqual(read().queuedBeamAt, []);
assert.deepEqual(queued, [10.3, 10.6], "读取的队列快照不受后续推进影响");
resumeSupportSchedule(owner, 40);
assert.equal(read().timeTravelerNextAt, 50);
unlockSupport(owner, ["otherworlder"], 40, () => 0);
assert.equal(unlocked.has("otherworlder"), false, "集合读视图也保持采样时的值");
const staleSource = { ...source };
assert.equal(triggerSupportOtherworlder(source, 40), true);
assert.equal(triggerSupportOtherworlder(source, 40), false);
assert.equal(read().otherworlderReadyAt, 48);
assert.equal(triggerSupportOtherworlder(staleSource, 40), false, "保留旧资格快照不能重复消费同一冷却");
assert.equal(staleSource.state.otherworlderReadyAt, 40, "消费不能反向修改历史资格样本");
assert.equal(triggerSupportOtherworlder({ ...source, state }, 48), true, "旧的未解锁快照不能否定所有者当前资格");
assert.equal(read().otherworlderReadyAt, 56);
assert.equal(triggerSupportOtherworlder(source, Number.NaN), false, "无效时钟不能消费支援");
assert.equal(read().otherworlderReadyAt, 56);
assert.throws(() => triggerSupportOtherworlder({ ...staleSource, owner: {} }, 60), /已初始化的来源/);


const match = new MatchSimulation({ seed: 876, aiSeats: [], teamLoadouts: {
  A: { main: "haruhi", sub1: "bunny_haruhi", sub2: "yuki" },
} });
const team = match.teamA;
team.split(1);
const ship = team.ships.sub1;
assert.throws(() => { team.haruhiFlagship = createSupportState(); }, TypeError);
assert.throws(() => { ship.bunnyHaruhi.support = createSupportState(); }, TypeError);
assert.throws(() => ship.bunnyHaruhi.visitedForms.add("encore"), TypeError);
const before = ship.bunnyHaruhi;
assert.equal(team.castSubSkill("sub1"), true);
assert.equal(before.visitedForms.size, 0);
assert.deepEqual([...ship.bunnyHaruhi.visitedForms], ["bless"]);
assert.equal(ship.bunnyHaruhi.support.supporters.size, 1);
assert.equal(before.support.supporters.size, 0, "纯计划提交不得提前改写上一形态的支援状态");
assert.equal(team.haruhiFlagship.supporters.size, 0, "副舰领取不能改变旗舰支援");
unlockSupport(team, ["esper"], 0, () => 0);
assert.equal(ship.bunnyHaruhi.support.supporters.size, 1);
const snapshot = JSON.stringify(match.serializeState());
match.serializeState(); match.serializeState();
assert.equal(JSON.stringify(match.serializeState()), snapshot, "重复投影不能推进调度");
// 历史快照与来源权限分别校验。
console.log("支援所有权校验通过：只读集合/队列、独立来源、确定性解锁、封印恢复、冲撞消费和形态历史。");

assert.equal(state.supporters.size, 0, "整个历史快照不能随支援解锁改变");
assert.equal(state.otherworlderReadyAt, 0);
assert.throws(() => unlockSupport(read(), ["alien"], 0, () => 0), /已初始化的来源/);
assert.throws(() => unlockSupport(createSupportState(), ["alien"], 0, () => 0), /已初始化的来源/);

const catchupOwner = {};
initializeSupport(catchupOwner);
unlockSupport(catchupOwner, ["alien"], 0, () => 0);
unlockSupport(catchupOwner, ["esper"], 0, () => 0);
const midway = [];
tickSupportSource({ owner: catchupOwner, sourceShip: { alive: true }, enabled: true }, 18, 1, {
  launchAlienWingmen: () => midway.push(readSupportState(catchupOwner)),
});
assert.deepEqual(midway.map((view) => view.alienNextAt), [6, 12, 18], "回调读取仍保持原追帧次序");
assert.equal(readSupportState(catchupOwner).alienNextAt, 24, "回调之后的推进必须更新缓存");
assert.equal(midway[2].esperAngle, 0, "旧快照不能追随同帧后续轨道推进");
assert.notEqual(readSupportState(catchupOwner).esperAngle, 0);
