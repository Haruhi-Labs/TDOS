import assert from "node:assert/strict";
import { MatchSimulation } from "../shared/game-core.js";
import { ShipNavigation } from "../shared/game/systems/ship-navigation.js";
import { createShipNavigationPort } from "../shared/game/rules/navigation-port.js";

const match = new MatchSimulation({ seed: 61 });
const ship = match.teamA.ships.main;
const port = createShipNavigationPort(ship);
for (const key of ["ship", "team", "match", "hp", "effects"]) assert.equal(key in port, false);
for (const field of ["x", "y", "angle", "speed", "throttle"]) {
  assert.throws(() => { port[field] = -999; }, TypeError, `导航端口不能直接改写 ${field}`);
}
const destination = { x: 600, y: 700 };
ship.command = destination;
destination.x = -1;
assert.equal(ship.command.x, 600, "目标点输入不得保留调用者引用");
assert.throws(() => { ship.command.x = -1; }, TypeError);
ship.setBezierRoute(undefined, undefined, 650, 800, 1, false);
const route = ship.route;
assert.equal(ship.route, route, "未变更的只读航线应复用视图");
assert.throws(() => { route.p2.x = -1; }, TypeError);
ship.setRouteEndpoint(700, 900);
assert.equal(route.p2.x, 650, "后续航线操作不能改写历史读数");
assert.equal(ship.route.p2.x, 700);
assert.notEqual(ship.route, route);
const forced = { fromX: ship.x, fromY: ship.y, toX: ship.x + 30, toY: ship.y, startedAt: 0, endsAt: 1 };
ship.beginForcedKnockback(forced);
forced.toX = -1;
assert.notEqual(ship.forcedKnockback.toX, -1);
assert.throws(() => { ship.forcedKnockback.endsAt = 99; }, TypeError);

// 不创建舰船也能约束航线：导航只需要几何和运动参数。
const pose = { x: 100, y: 100, angle: 0, speed: 0, throttle: 1 };
const navigation = new ShipNavigation({
  ...pose,
  setThrottle: (value) => { pose.throttle = value; },
  world: { mapPadding: 10, clampX: (x) => Math.max(10, Math.min(990, x)), clampY: (y) => Math.max(10, Math.min(990, y)) },
  anchor: () => ({ ...pose, turnRate: 1, flightSpeed: 40 }),
  leader: () => null,
  routeTurnRadiusMultiplier: () => 1,
  routeDeviationMultiplier: () => 1,
}, pose);
navigation.setBezierRoute(undefined, undefined, 2000, 2000, 1, false);
assert.equal(navigation.route.p2.x, 990);
assert.ok(navigation.route.length > 0);
assert.deepEqual(navigation.command, { x: 990, y: 990 });
navigation.clearRoute();
assert.equal(navigation.route, null);
console.log("导航所有权校验通过：纯运动端口、输入与历史隔离、只读航线和击退、独立几何约束。");
