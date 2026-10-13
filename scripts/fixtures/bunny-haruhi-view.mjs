import { ScenarioSimulation, sampleScenarioTime } from "../core-tests/scenario-simulation.mjs";
import { convertZoneSupport } from "../../shared/game/characters/interactions/support-conversion.js";
import assert from "node:assert/strict";
import { resolveBunnyStages } from "../../shared/game/characters/bunny-haruhi/stage-port.js";
import { prepareBunnyCompanions } from "../../shared/game/characters/bunny-haruhi/companion-runtime.js";

// 只供本地验收使用；通过真实战斗世界和场景时间样本构造角色生命周期快照。
export function createBunnyViewFixture(collect = () => {}) {
  const sim = new ScenarioSimulation({ mode: "pvp", aiSeats: [],
    teamLoadouts: { A: { main: "haruhi", sub1: "bunny_haruhi", sub2: "yuki" },
      B: { main: "bunny_haruhi", sub1: "tsuruya", sub2: "kyon" } } });
  for (const team of [sim.teamA, sim.teamB]) {
    team.configureFormation(2);
    sim.setCombatEnabled(team.seat, false);
    team.getPlayerShips().forEach((ship, index) => {
      ship.displaceTo(team.seat === "A" ? 350 : 950, 400 + index * 140);
      ship.followTarget({ x: ship.x, y: ship.y }, 0);
    });
  }
  const owner = sim.teamA.ships.sub1;
  owner.spendEnergy(owner.energy);
  const states = { neutral: sim.serializeState() };
  sim.teamA.configureFormation(0);
  states.attached = sim.serializeState();
  sim.teamA.configureFormation(2);
  for (let i = 0; i < 4; i += 1) {
    sim.teamA.startCooldown("sub1", 0);
    assert.equal(sim.teamA.castSubSkill("sub1"), true);
    collect(owner);
    if (i < 2) states[owner.bunnyHaruhi.form] = sim.serializeState();
    if (i === 1) {
      sampleScenarioTime(sim, { elapsed: 4 });
      sampleScenarioTime(sim, { tick: 120 });
      states.knowsExpired = sim.serializeState();
    }
  }
  const companion = sim.teamA.extraShips[0];
  resolveBunnyStages(sim);
  states.encore = sim.serializeState();
  sampleScenarioTime(sim, { elapsed: 24 });
  sampleScenarioTime(sim, { tick: 720 });
  prepareBunnyCompanions(sim);
  collect(owner);
  collect(companion);
  const target = sim.teamA.ships.sub2;
  target.displaceTo(sim.teamB.ships.main.x - 80, sim.teamB.ships.main.y);
  resolveBunnyStages(sim);
  collect(target);
  states.lock = sim.serializeState();
  sampleScenarioTime(sim, { elapsed: sim.elapsed + (0.6) });
  resolveBunnyStages(sim);
  collect(target);
  states.recovery = sim.serializeState();
  sampleScenarioTime(sim, { elapsed: 34 });
  resolveBunnyStages(sim);
  collect(target);
  states.encoreExpired = sim.serializeState();
  const zone = sim.zones.find((z) => companion.x >= z.x && companion.x <= z.x + z.width && companion.y >= z.y && companion.y <= z.y + z.height);
  assert.equal(convertZoneSupport(sim.teamB.ships.sub1, zone.id), true);
  collect(companion);
  states.converted = sim.serializeState();
  companion.takeDamage(companion.maxHp * 10, sim.teamA.ships.main, sim);
  prepareBunnyCompanions(sim);
  states.companionDead = sim.serializeState();
  states.finished = { ...states.companionDead, phase: "finished", winnerSeat: "A" };
  return { sim, owner, companion, states };
}
