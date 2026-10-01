import assert from "node:assert/strict";
import { createOnlineStateSync } from "../src/online/state-sync.js";

function ship(id, x, overrides = {}) {
  return {
    id,
    key: overrides.key || "main",
    alive: true,
    canControl: true,
    x,
    y: 20,
    angle: 0,
    speed: 10,
    hp: 100,
    throttle: 1,
    route: null,
    ...overrides,
  };
}

function team(offset = 0) {
  return {
    energy: 100,
    hullRatio: 1,
    autoScout: { enabled: false, zoneId: 5 },
    cooldowns: { scout: 0, flagship: 0, sub1: 0, sub2: 0 },
    haruhiFlagship: { boostActive: false, supporters: [], otherworlderReady: false, esperOrb: null },
    koizumiBarrier: null,
    ships: {
      main: ship(offset + 1, 10, { key: "main" }),
      sub1: ship(offset + 2, 12, { key: "sub1" }),
      sub2: ship(offset + 3, 14, { key: "sub2" }),
    },
    extraShips: [ship(offset + 4, 16, { key: "twin" })],
    scouts: [],
    wingmen: [],
    beams: [],
  };
}

function battleState(elapsed = 0) {
  return {
    elapsed,
    phase: "running",
    winnerSeat: null,
    projectiles: [],
    bursts: [],
    haruhiHeroPowerEffects: [],
    shamisenHuntKillEffects: [],
    koizumiBarrierImpacts: [],
    floatingTexts: [],
    teams: { A: team(0), B: team(10) },
  };
}

const app = {
  routeOverrides: new Map(),
  clockReady: false,
  clockOffsetMs: 0,
  snapshots: [],
  smoothEntities: new Map(),
  lastRenderMs: 0,
  seat: "A",
  serverTickRate: 30,
  interpDelayMs: 0,
};
let now = 1000;
const sync = createOnlineStateSync({
  app,
  nowMs: () => now,
  worldSize: 100,
  maxExtrapolateMs: 180,
});

const route = {
  anchorToMain: true,
  p0: { x: 1, y: 2 },
  p1: { x: 3, y: 4 },
  p2: { x: 5, y: 6 },
  t: 0.25,
};
const cloned = sync.cloneRoute(route);
assert.deepEqual(cloned, route, "航线克隆结果发生漂移");
assert.notEqual(cloned.p1, route.p1, "航线克隆仍共享控制点引用");

const routeTeam = team(0);
routeTeam.ships.sub1.route = route;
app.routeOverrides.set("sub1", {
  route: { ...route, p2: { x: 70, y: 80 } },
});
const displayRoute = sync.getDisplayRouteForShip(routeTeam, routeTeam.ships.sub1);
assert.deepEqual(displayRoute.p0, { x: 10, y: 20 }, "编队航线未锚定主舰当前位置");
assert.deepEqual(displayRoute.p2, { x: 70, y: 80 }, "本地航线覆盖未优先显示");

const previousState = battleState(0);
const nextState = battleState(1);
nextState.teams.A.ships.main.x = 30;
nextState.teams.A.extraShips[0].x = 36;
previousState.teams.A.haruhiFlagship.esperOrb = { x: 30, y: 40, angle: 6.1, radius: 10, absorbRadius: 20 };
nextState.teams.A.haruhiFlagship.esperOrb = { x: 50, y: 60, angle: 0.1, radius: 10, absorbRadius: 20 };
previousState.teams.A.koizumiBarrier = {
  remainingHits: 0,
  maxHits: 15,
  x: 10,
  y: 20,
  radius: 150,
  active: false,
  disabledRemaining: 5,
  recoveryProgress: 0,
  recoveryAge: 0,
};
nextState.teams.A.koizumiBarrier = {
  remainingHits: 15,
  maxHits: 15,
  x: 30,
  y: 20,
  radius: 170,
  active: true,
  disabledRemaining: 0,
  recoveryProgress: 1,
  recoveryAge: 0.4,
};
previousState.projectiles = [ship(100, 20, { targetX: 80, targetY: 20 })];
nextState.projectiles = [ship(100, 40, { targetX: 80, targetY: 20 })];
previousState.koizumiBarrierImpacts = [{ id: 200, x: 20, y: 30, radius: 150, life: 0.8 }];
nextState.koizumiBarrierImpacts = [{ id: 200, x: 20, y: 30, radius: 150, life: 0.4 }];
previousState.shamisenHuntKillEffects = [{ id: 201, x: 40, y: 50, radius: 16, life: 1.4, maxLife: 1.65 }];
nextState.shamisenHuntKillEffects = [{ id: 201, x: 40, y: 50, radius: 16, life: 1, maxLife: 1.65 }];
previousState.haruhiHeroPowerEffects = [{
  id: 202, phase: "charge", x: 20, y: 40, radius: 16, progress: 0.2, life: 0.64, maxLife: 0.8,
}];
nextState.haruhiHeroPowerEffects = [{
  id: 202, phase: "charge", x: 40, y: 60, radius: 16, progress: 0.6, life: 0.32, maxLife: 0.8,
}];
const interpolated = sync.interpolateSnapshotState(
  { tick: 0, state: previousState },
  { tick: 30, state: nextState },
  0.5,
);
assert.equal(interpolated.elapsed, 0.5, "对局时间插值异常");
assert.equal(interpolated.teams.A.ships.main.x, 20, "主舰位置插值异常");
assert.equal(interpolated.teams.A.extraShips[0].x, 26, "额外舰船插值异常");
assert.equal(interpolated.projectiles[0].x, 30, "弹体位置插值异常");
assert.equal(interpolated.teams.A.haruhiFlagship.esperOrb.x, 40, "春日超能力者光球横坐标未平滑插值");
assert.equal(interpolated.teams.A.haruhiFlagship.esperOrb.y, 50, "春日超能力者光球纵坐标未平滑插值");
assert.equal(interpolated.teams.A.koizumiBarrier.radius, 160, "古泉能量圈半径未平滑插值");
assert.equal(interpolated.teams.A.koizumiBarrier.active, true, "古泉能量圈生效状态没有采用最新权威帧");
assert.equal(interpolated.teams.A.koizumiBarrier.remainingHits, 15, "次数盾剩余次数应直接采用最新权威帧，不能插值为小数");
assert(
  Math.abs(interpolated.koizumiBarrierImpacts[0].life - 0.6) < 1e-9,
  "古泉能量圈受击动画寿命未平滑插值",
);
assert(
  Math.abs(interpolated.shamisenHuntKillEffects[0].life - 1.2) < 1e-9,
  "三味线猎杀击杀特效寿命未平滑插值",
);
assert.equal(interpolated.haruhiHeroPowerEffects[0].x, 30, "勇者之力蓄力中心未平滑跟随施法舰");
assert(
  Math.abs(interpolated.haruhiHeroPowerEffects[0].progress - 0.4) < 1e-9,
  "勇者之力同阶段动画进度未平滑插值",
);
assert(
  interpolated.teams.A.haruhiFlagship.esperOrb.angle > 6.1,
  "春日超能力者光球跨零点公转角度走了错误的长路径",
);

previousState.teams.A.ships.main.route = {
  anchorToMain: true,
  p0: { x: 10, y: 20 },
  p1: { x: 30, y: 20 },
  p2: { x: 50, y: 20 },
  t: 0.6,
};
nextState.teams.A.ships.main.route = {
  anchorToMain: true,
  p0: { x: 30, y: 20 },
  p1: { x: 60, y: 30 },
  p2: { x: 90, y: 40 },
  t: 0,
};
const rerouted = sync.interpolateSnapshotState(
  { tick: 30, state: previousState },
  { tick: 31, state: nextState },
  0.2,
);
assert.deepEqual(
  rerouted.teams.A.ships.main.route.p2,
  { x: 90, y: 40 },
  "新航线被错误插值为不存在的中间态",
);

previousState.teams.A.ships.main.route = {
  anchorToMain: true,
  p0: { x: 10, y: 20 },
  p1: { x: 30, y: 20 },
  p2: { x: 90, y: 40 },
  t: 0.2,
};
nextState.teams.A.ships.main.route = {
  anchorToMain: true,
  p0: { x: 20, y: 20 },
  p1: { x: 40, y: 24 },
  p2: { x: 90, y: 40 },
  t: 0.4,
};
const progressingRoute = sync.interpolateSnapshotState(
  { tick: 31, state: previousState },
  { tick: 32, state: nextState },
  0.5,
);
assert.deepEqual(
  progressingRoute.teams.A.ships.main.route.p0,
  { x: 15, y: 20 },
  "同一航线的自然推进没有保持平滑插值",
);

const extrapolationSource = battleState(2);
extrapolationSource.teams.A.ships.main.x = 95;
extrapolationSource.teams.A.ships.main.speed = 100;
extrapolationSource.shamisenHuntKillEffects = [{ id: 202, x: 50, y: 50, radius: 16, life: 1, maxLife: 1.65 }];
extrapolationSource.haruhiHeroPowerEffects = [{
  id: 203, phase: "shock", x: 50, y: 50, radius: 24, progress: 0.2, life: 0.92, maxLife: 1.15,
}];
const extrapolated = sync.extrapolateState(extrapolationSource, 1);
assert.equal(extrapolated.elapsed, 2.18, "外推时长未按上限截断");
assert.equal(extrapolated.teams.A.ships.main.x, 98, "舰船外推未遵守地图边界");
assert(Math.abs(extrapolated.shamisenHuntKillEffects[0].life - 0.82) < 1e-9, "猎杀击杀特效外推期间发生冻结");
assert(Math.abs(extrapolated.haruhiHeroPowerEffects[0].life - 0.74) < 1e-9, "勇者之力冲击波外推期间发生冻结");
assert(extrapolated.haruhiHeroPowerEffects[0].progress > 0.35, "勇者之力冲击波外推期间进度没有继续推进");

app.snapshots = [{ tick: 0, state: battleState(0), serverTimeMs: 1000, receivedAtMs: 1000 }];
now = 1000;
assert(sync.getRenderState()?.teams?.A?.ships?.main, "单快照无法生成显示状态");

// 复现观战7.5Hz下，后一快照清理短特效导致整段插值提前丢失的缺陷。
const beforeRemoval = battleState(10);
const afterRemoval = battleState(10 + 4 / 30);
const shortVisual = { id: 400, x: 40, y: 40, radius: 10, life: 0.09, maxLife: 0.35 };
for (const field of ["bursts", "floatingTexts", "koizumiBarrierImpacts", "shamisenHuntKillEffects", "haruhiHeroPowerEffects"]) {
  beforeRemoval[field] = [{ ...shortVisual, phase: "shock", progress: 0.7, kind: field === "bursts" ? "burst" : field }];
}
for (const seat of ["A", "B"]) {
  beforeRemoval.teams[seat].beams = [{ ...shortVisual, phase: "fire", x1: 10, y1: 10, x2: 90, y2: 90 }];
  beforeRemoval.teams[seat].visionWaves = [{ id: 401, emittedAt: 9, expiresAt: 10.09, speed: 200 }];
  beforeRemoval.teams[seat].koizumiImpactWaves = [{ id: 402, emittedAt: 9, expiresAt: 10.09, speed: 200 }];
}
beforeRemoval.projectiles = [{ id: 403, alive: true, x: 40, y: 40, targetX: 90, targetY: 40, speed: 200 }];
const sourceCopy = structuredClone(beforeRemoval);
function removalFrame(ratio) {
  return sync.interpolateSnapshotState({ tick: 300, state: beforeRemoval }, { tick: 304, state: afterRemoval }, ratio);
}
const fadingFrame = removalFrame(0.25);
const expiredFrame = removalFrame(0.8);
for (const field of ["bursts", "floatingTexts", "koizumiBarrierImpacts", "shamisenHuntKillEffects", "haruhiHeroPowerEffects"]) {
  assert.equal(fadingFrame[field].length, 1, `${field}在显示寿命结束前丢失`);
  assert(Math.abs(fadingFrame[field][0].life - (0.09 - 1 / 30)) < 1e-9, `${field}残余动画没有按时间淡出`);
  assert.equal(expiredFrame[field].length, 0, `${field}到期后仍在显示`);
}
assert.equal(fadingFrame.bursts[0].radius, 12, "消退中的命中爆发没有继续扩散");
assert.equal(fadingFrame.projectiles.length, 0, "命中后的弹体被错误保留为幽灵弹");
for (const seat of ["A", "B"]) {
  assert.equal(fadingFrame.teams[seat].beams.length, 1, `${seat}方激光被提前清除`);
  assert.equal(expiredFrame.teams[seat].beams.length, 0, `${seat}方激光到期后残留`);
  assert.equal(fadingFrame.teams[seat].visionWaves.length, 1, `${seat}方视野波被提前清除`);
  assert.equal(fadingFrame.teams[seat].koizumiImpactWaves.length, 1, `${seat}方撞击波被提前清除`);
  assert.equal(expiredFrame.teams[seat].visionWaves.length, 0, `${seat}方视野波到期后残留`);
  assert.equal(expiredFrame.teams[seat].koizumiImpactWaves.length, 0, `${seat}方撞击波到期后残留`);
}
const agingFrame = sync.extrapolateState(beforeRemoval, 0.05);
assert(Math.abs(agingFrame.koizumiBarrierImpacts[0].life - 0.04) < 1e-9, "护盾受击在外推期间冻结");
for (const seat of ["A", "B"]) {
  assert(Math.abs(agingFrame.teams[seat].beams[0].life - 0.04) < 1e-9, `${seat}方激光在外推期间冻结`);
}
assert.deepEqual(beforeRemoval, sourceCopy, "特效补帧写回了权威状态");
const beamCharge = battleState(20);
const beamFire = battleState(20 + 4 / 30);
beamCharge.teams.A.beams = [{ ...shortVisual, phase: "charge", progress: 0.99, maxLife: 1.05 }];
beamFire.teams.A.beams = [{ ...shortVisual, phase: "fire", progress: 1, life: 0.2, maxLife: 0.26 }];
const releasedBeam = sync.interpolateSnapshotState({ tick: 600, state: beamCharge }, { tick: 604, state: beamFire }, 0.5).teams.A.beams[0];
assert.equal(releasedBeam.maxLife, 0.26, "激光释放阶段混入了蓄力寿命，导致射线亮度变弱");
assert.equal(releasedBeam.life, 0.2, "激光跨阶段寿命被错误插值");
beamFire.teams.A.beams = [];
beamFire.teams.A.ships.main.alive = false;
const cancelledBeam = sync.interpolateSnapshotState({ tick: 600, state: beamCharge }, { tick: 604, state: beamFire }, 0.25);
assert.equal(cancelledBeam.teams.A.beams.length, 0, "已取消的蓄力被错误补成仍在施法");

console.log("在线显示状态校验通过：航线覆盖、舰船/光球/能量圈/猎杀与勇者之力特效插值、额外舰船、弹体与边界外推、双方短特效自然淡出均保持一致。");
