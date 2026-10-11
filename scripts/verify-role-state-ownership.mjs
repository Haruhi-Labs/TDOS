import assert from "node:assert/strict";
import { MatchSimulation } from "../shared/game-core.js";
import { activateKoizumiOrb, sampleKoizumiOrbMotion } from "../shared/game/koizumi-orb.js";
import { consumeKoizumiBarrierHit } from "../shared/game/koizumi-barrier.js";
import { applyHaruhiHeroPowerShock, resetHaruhiHeroPowerShock } from "../shared/game/haruhi-hero-power.js";

const match = new MatchSimulation({ seed: 881, teamLoadouts: {
  A: { main: "koizumi", sub1: "kyon", sub2: "yuki" },
  B: { main: "shamisen", sub1: "koizumi", sub2: "haruhi" },
} });
const team = match.teamA;
const ship = match.teamB.ships.sub1;
for (const [owner, key] of [[team, "koizumiBarrier"], [match.teamB, "shamisenHunt"], [ship, "heroPowerShock"]]) {
  assert.throws(() => { owner[key] = {}; }, TypeError);
  assert.ok(Object.isFrozen(owner[key]));
}
const barrier = team.koizumiBarrier;
consumeKoizumiBarrierHit(team, { x: 0, y: 0 }, "B");
assert.equal(barrier.remainingHits, 15);
assert.equal(team.koizumiBarrier.remainingHits, 14);
applyHaruhiHeroPowerShock(ship, 0);
const shock = ship.heroPowerShock;
resetHaruhiHeroPowerShock(ship);
assert.equal(shock.recoveryUntil, 5);
assert.equal(ship.heroPowerShock.recoveryUntil, 0);
activateKoizumiOrb(ship);
const orb = ship.koizumiOrb;
assert.equal(orb.hitAt, undefined, "命中历史不能通过查询获得");
assert.throws(() => { orb.previousX = -1; }, TypeError);
ship.x += 30;
sampleKoizumiOrbMotion(ship);
assert.equal(ship.koizumiOrb.previousX, ship.x);
assert.notEqual(orb.previousX, ship.x);
console.log("角色状态所有权校验通过：护盾、猎杀、震慑和光球私有提交，查询不暴露命中历史或可写别名。");
