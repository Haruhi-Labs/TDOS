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
previousState.projectiles = [ship(100, 20, { targetX: 80, targetY: 20 })];
nextState.projectiles = [ship(100, 40, { targetX: 80, targetY: 20 })];
const interpolated = sync.interpolateSnapshotState(
  { tick: 0, state: previousState },
  { tick: 30, state: nextState },
  0.5,
);
assert.equal(interpolated.elapsed, 0.5, "对局时间插值异常");
assert.equal(interpolated.teams.A.ships.main.x, 20, "主舰位置插值异常");
assert.equal(interpolated.teams.A.extraShips[0].x, 26, "1096额外舰船插值异常");
assert.equal(interpolated.projectiles[0].x, 30, "弹体位置插值异常");

const extrapolationSource = battleState(2);
extrapolationSource.teams.A.ships.main.x = 95;
extrapolationSource.teams.A.ships.main.speed = 100;
const extrapolated = sync.extrapolateState(extrapolationSource, 1);
assert.equal(extrapolated.elapsed, 2.18, "外推时长未按上限截断");
assert.equal(extrapolated.teams.A.ships.main.x, 98, "舰船外推未遵守地图边界");

app.snapshots = [{ tick: 0, state: battleState(0), serverTimeMs: 1000, receivedAtMs: 1000 }];
now = 1000;
assert(sync.getRenderState()?.teams?.A?.ships?.main, "单快照无法生成显示状态");

console.log("在线显示状态校验通过：航线覆盖、插值、额外舰船、弹体与边界外推均保持一致。");
