import { DEFAULT_AI_LOADOUT, DEFAULT_TEAM_LOADOUT, MatchSimulation, TICK_DT, cloneLoadout } from "../shared/game-core.js";
import {
  applyRespawnProtectionRules,
  queueTerritoryRespawns,
  updateTerritoryRespawns,
} from "../shared/gameplay/territory-respawn.js";
import { stellarTerritoryMode } from "../shared/modes/stellar-territory.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function makeSimulation(options = {}) {
  return new MatchSimulation({
    mode: "ai",
    teamLoadouts: { A: cloneLoadout(DEFAULT_TEAM_LOADOUT), B: cloneLoadout(DEFAULT_AI_LOADOUT) },
    aiSeats: [],
    ...options,
  });
}

function makeState(seed = 1111) {
  return stellarTerritoryMode.createInitialModeState({
    randomSeed: seed,
    parameters: stellarTerritoryMode.defaultParameters,
  });
}

let sim = makeSimulation({ victoryPolicy: "external" });
for (const ship of Object.values(sim.fleetBySeat("A").ships)) {
  ship.takeDamage(ship.maxHp * 10, null, sim, false);
}
sim.checkVictory();
assert(sim.phase === "running", "external victory policy should not finish on fleet wipe");

sim = makeSimulation();
const deadMain = sim.fleetBySeat("A").shipByKey("main");
deadMain.takeDamage(deadMain.maxHp * 10, null, sim, false);
let respawnOk = sim.respawnShipForSeat("A", "main", {
  x: 200,
  y: 300,
  hpRatio: 1,
  energyRatio: 0.5,
  protectionSeconds: 3,
});
assert(respawnOk, "generic respawn API should accept dead ship");
assert(deadMain.alive && deadMain.hp === deadMain.maxHp, "respawn restores hull");
assert(Math.abs(deadMain.energy - deadMain.maxEnergy * 0.5) < 1e-6, "respawn restores requested energy");
assert(deadMain.x === 200 && deadMain.y === 300, "respawn places ship");
assert(deadMain.route === null && deadMain.speed === 0, "respawn clears route and speed");
assert(deadMain.spawnProtectionUntil > sim.elapsed, "respawn applies protection timer");
assert(!sim.respawnShipForSeat("A", "main", { x: 200, y: 300 }), "living ship cannot respawn");

sim = makeSimulation({ victoryPolicy: "external" });
let state = makeState();
const main = sim.fleetBySeat("A").shipByKey("main");
const sub = sim.fleetBySeat("A").shipByKey("sub1");
main.takeDamage(main.maxHp * 10, null, sim, false);
sub.takeDamage(sub.maxHp * 10, null, sim, false);
let queued = queueTerritoryRespawns({ modeState: state, simulation: sim });
state = queued.modeState;
assert(state.respawnQueue.some((item) => item.seat === "A" && item.shipKey === "main" && item.remaining === 24), "main respawn queued for 24s");
assert(state.respawnQueue.some((item) => item.seat === "A" && item.shipKey === "sub1" && item.remaining === 16), "sub respawn queued for 16s");
assert(state.alliances.A.tickets === 113, `main+sub deaths deduct 7 tickets, got ${state.alliances.A.tickets}`);

queued = queueTerritoryRespawns({ modeState: state, simulation: sim });
assert(queued.modeState.respawnQueue.length === state.respawnQueue.length, "same death should not queue twice");

for (let i = 0; i < Math.ceil(16 / TICK_DT); i += 1) {
  const result = updateTerritoryRespawns({ modeState: state, simulation: sim, dt: TICK_DT });
  state = result.modeState;
}
assert(sim.fleetBySeat("A").shipByKey("sub1").alive, "sub ship respawns after 16s");
assert(!sim.fleetBySeat("A").shipByKey("main").alive, "main still waiting after 16s");

for (let i = 0; i < Math.ceil(8 / TICK_DT); i += 1) {
  const result = updateTerritoryRespawns({ modeState: state, simulation: sim, dt: TICK_DT });
  state = result.modeState;
}
assert(sim.fleetBySeat("A").shipByKey("main").alive, "main respawns after 24s");
assert(state.respawnQueue.length === 0, "respawn queue clears completed entries");

const protectedShip = sim.fleetBySeat("A").shipByKey("main");
assert(protectedShip.spawnProtectionUntil > sim.elapsed, "respawn protection exists");
applyRespawnProtectionRules({
  simulation: sim,
  action: { type: "set_route", shipKey: "main", endX: protectedShip.x + 80, endY: protectedShip.y },
  seat: "A",
});
assert(protectedShip.spawnProtectionUntil === 0, "leaving spawn / active command clears protection");

state = makeState(2222);
sim = makeSimulation({ victoryPolicy: "external" });
state.alliances.B.tickets = 1;
const bMain = sim.fleetBySeat("B").shipByKey("main");
bMain.takeDamage(bMain.maxHp * 10, null, sim, false);
state = queueTerritoryRespawns({ modeState: state, simulation: sim }).modeState;
assert(state.alliances.B.tickets === 0, "death ticket deduction floors at zero");
assert(state.result?.finished && state.result.winnerAllianceId === "A", "death ticket zero resolves external victory");

console.log("territory respawn verification passed");
