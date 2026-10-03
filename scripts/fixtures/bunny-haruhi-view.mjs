import assert from "node:assert/strict";
import { MatchSimulation } from "../../shared/game-core.js";
import { resolveBunnyStages } from "../../shared/game/bunny-haruhi-runtime.js";
import { prepareBunnyCompanions } from "../../shared/game/bunny-companion-runtime.js";

// 只供本地验收使用；通过领域调用构造完整生命周期的权威快照。
export function createBunnyViewFixture(collect = () => {}) {
  const sim = new MatchSimulation({ mode: "pvp", aiSeats: [],
    teamLoadouts: { A: { main: "haruhi", sub1: "bunny_haruhi", sub2: "yuki" },
      B: { main: "bunny_haruhi", sub1: "tsuruya", sub2: "kyon" } } });
  for (const team of [sim.teamA, sim.teamB]) {
    team.splitLevel = 2;
    sim.combatEnabled[team.seat] = false;
    team.getPlayerShips().forEach((ship, index) => {
      ship.x = team.seat === "A" ? 350 : 950;
      ship.y = 400 + index * 140;
      ship.command = { x: ship.x, y: ship.y };
      ship.throttle = 0;
    });
  }
  const owner = sim.teamA.ships.sub1;
  owner.energy = 0;
  const states = { neutral: sim.serializeState() };
  sim.teamA.splitLevel = 0;
  states.attached = sim.serializeState();
  sim.teamA.splitLevel = 2;
  for (let i = 0; i < 4; i += 1) {
    sim.teamA.cooldowns.sub1 = 0;
    assert.equal(sim.teamA.castSubSkill("sub1"), true);
    collect(owner);
    if (i < 2) states[owner.bunnyHaruhi.form] = sim.serializeState();
    if (i === 1) {
      sim.elapsed = 4;
      sim.tick = 120;
      states.knowsExpired = sim.serializeState();
    }
  }
  const companion = sim.teamA.extraShips[0];
  sim.elapsed = 24;
  sim.tick = 720;
  prepareBunnyCompanions(sim);
  collect(owner);
  collect(companion);
  const target = sim.teamA.ships.sub2;
  target.x = sim.teamB.ships.main.x - 80;
  target.y = sim.teamB.ships.main.y;
  resolveBunnyStages(sim);
  collect(target);
  states.lock = sim.serializeState();
  sim.elapsed += 0.6;
  resolveBunnyStages(sim);
  collect(target);
  states.recovery = sim.serializeState();
  sim.elapsed = 34;
  resolveBunnyStages(sim);
  collect(target);
  states.encore = sim.serializeState();
  const zone = sim.zones.find((z) => companion.x >= z.x && companion.x <= z.x + z.width && companion.y >= z.y && companion.y <= z.y + z.height);
  assert.equal(sim.teamB.bribeZone(sim.teamB.ships.sub1, zone.id), true);
  collect(companion);
  states.converted = sim.serializeState();
  companion.takeDamage(companion.maxHp * 10, sim.teamA.ships.main, sim);
  prepareBunnyCompanions(sim);
  states.companionDead = sim.serializeState();
  states.finished = { ...states.companionDead, phase: "finished", winnerSeat: "A" };
  return { sim, owner, companion, states };
}
