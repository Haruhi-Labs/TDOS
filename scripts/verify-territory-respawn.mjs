import { DEFAULT_AI_LOADOUT, DEFAULT_TEAM_LOADOUT, MatchSimulation, TICK_DT, cloneLoadout } from "../shared/game-core.js";
import {
  applyRespawnProtectionRules,
  queueTerritoryRespawns,
  updateTerritoryRespawns,
} from "../shared/gameplay/territory-respawn.js";
import { territorySpawnDeployment } from "../shared/gameplay/territory-spawns.js";
import { positionClearOfObstacles } from "../shared/gameplay/territory-obstacles.js";
import { stellarTerritoryMode } from "../shared/modes/stellar-territory.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function makeSimulation(options = {}) {
  return new MatchSimulation({
    mode: "ai",
    worldSize: stellarTerritoryMode.worldSize,
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

let disabledSim = makeSimulation({ victoryPolicy: "external" });
let disabledState = makeState(1010);
const disabledTickets = disabledState.alliances.A.tickets;
const disabledMain = disabledSim.fleetBySeat("A").shipByKey("main");
disabledMain.takeDamage(disabledMain.maxHp * 10, null, disabledSim, false);
disabledState = stellarTerritoryMode.updateModeState({
  modeState: disabledState,
  parameters: { ...stellarTerritoryMode.defaultParameters, respawnEnabled: false },
  dt: TICK_DT,
  simulation: disabledSim,
});
assert(disabledState.respawnQueue.length === 0, "disabled respawn parameter should keep destroyed ships out of the queue");
assert(disabledState.alliances.A.tickets === disabledTickets, "disabled respawn parameter should skip respawn ticket costs");

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
const protectedSnapshot = deadMain.serialize();
assert(protectedSnapshot.spawnProtectionRemaining > 2.9 && protectedSnapshot.spawnProtectionRemaining <= 3, "ship snapshot should expose bounded respawn-protection time");
const protectedHp = deadMain.hp;
deadMain.takeDamage(50, null, sim, false);
assert(deadMain.hp === protectedHp, "respawn protection should block incoming hull damage before its deadline");
sim.elapsed = deadMain.spawnProtectionUntil + 0.01;
deadMain.takeDamage(50, null, sim, false);
assert(deadMain.hp < protectedHp, "incoming damage should apply after respawn protection expires");
assert(!sim.respawnShipForSeat("A", "main", { x: 200, y: 300 }), "living ship cannot respawn");

const attackSim = makeSimulation({ victoryPolicy: "external" });
const protectedAttacker = attackSim.fleetBySeat("A").shipByKey("main");
const attackTarget = attackSim.fleetBySeat("B").shipByKey("main");
protectedAttacker.x = attackTarget.x - 100;
protectedAttacker.y = attackTarget.y;
protectedAttacker.angle = Math.PI / 2;
protectedAttacker.cooldown = 0;
protectedAttacker.spawnProtectionUntil = 99;
protectedAttacker.team.visibleEnemyIds.add(attackTarget.id);
const projectileCountBeforeAttack = attackSim.projectiles.length;
protectedAttacker.tryAttack(attackSim, attackSim.fleetBySeat("B"));
assert(attackSim.projectiles.length === projectileCountBeforeAttack + 1, "protected attacker fixture should fire one normal shot");
assert(protectedAttacker.spawnProtectionUntil === 0, "actively firing should clear respawn protection");

const skillProtectionSim = makeSimulation({ victoryPolicy: "external" });
const skillProtectionState = makeState(1414);
const skillProtectionShip = skillProtectionSim.fleetBySeat("A").shipByKey("main");
skillProtectionShip.spawnProtectionUntil = 99;
const acceptedProtectedSkill = stellarTerritoryMode.handleAction({
  action: { type: "cast_flagship_skill", zoneId: 5 },
  seat: "A",
  simulation: skillProtectionSim,
  modeState: skillProtectionState,
});
assert(acceptedProtectedSkill.handled && acceptedProtectedSkill.accepted, "territory mode should authoritatively handle an accepted protected skill");
assert(skillProtectionShip.spawnProtectionUntil === 0, "accepted active skill should clear respawn protection");
skillProtectionShip.spawnProtectionUntil = 99;
const rejectedProtectedSkill = stellarTerritoryMode.handleAction({
  action: { type: "cast_flagship_skill", zoneId: 5 },
  seat: "A",
  simulation: skillProtectionSim,
  modeState: skillProtectionState,
});
assert(rejectedProtectedSkill.handled && !rejectedProtectedSkill.accepted, "cooldown should reject the repeated protected skill");
assert(skillProtectionShip.spawnProtectionUntil === 99, "rejected active skill should preserve respawn protection");

const tacticalProtectionSim = makeSimulation({ victoryPolicy: "external" });
const tacticalProtectionState = makeState(1515);
const tacticalProtectionFleet = tacticalProtectionSim.fleetBySeat("A");
tacticalProtectionFleet.shipByKey("main").takeDamage(tacticalProtectionFleet.shipByKey("main").maxHp * 10, null, tacticalProtectionSim, false);
const protectedSub = tacticalProtectionFleet.shipByKey("sub1");
protectedSub.spawnProtectionUntil = 99;
tacticalProtectionState.alliances.A.skillSlot = { skillId: "all_fleet_shield", acquiredAt: 0 };
const acceptedProtectedTactical = stellarTerritoryMode.handleAction({
  action: { type: "use_tactical_skill", targetType: "none" },
  seat: "A",
  simulation: tacticalProtectionSim,
  modeState: tacticalProtectionState,
});
assert(acceptedProtectedTactical.handled && acceptedProtectedTactical.accepted, "protected fleet should accept its alliance tactical skill");
assert(protectedSub.spawnProtectionUntil === 0, "accepted tactical skill should clear protection from a living sub when the flagship is dead");

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
const queuedMainRespawn = state.respawnQueue.find((item) => item.seat === "A" && item.shipKey === "main");
const expectedMainSpawn = territorySpawnDeployment({ modeState: state, seat: "A", shipKey: "main" });
assert(
  queuedMainRespawn.spawnPosition?.x === expectedMainSpawn.x && queuedMainRespawn.spawnPosition?.y === expectedMainSpawn.y,
  "respawn queue should expose its exact spawn position for preheating",
);
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

let repeatSim = makeSimulation({ victoryPolicy: "external" });
let repeatState = makeState(1212);
const repeatMain = repeatSim.fleetBySeat("A").shipByKey("main");
repeatMain.takeDamage(repeatMain.maxHp * 10, null, repeatSim, false);
let firstDeath = queueTerritoryRespawns({ modeState: repeatState, simulation: repeatSim });
repeatState = firstDeath.modeState;
assert(firstDeath.events.some((event) => event.type === "respawn_queued" && event.payload?.shipKey === "main"), "first main death emits respawn event");
repeatState.respawnQueue[0].remaining = 0;
const firstRevival = updateTerritoryRespawns({ modeState: repeatState, simulation: repeatSim, dt: TICK_DT });
repeatState = firstRevival.modeState;
assert(repeatMain.alive, "main should revive before repeated-death check");
assert(Object.keys(repeatState.deathLedger || {}).length === 0, "successful respawn should clear its death-ledger instance");
const ticketsAfterFirstDeath = repeatState.alliances.A.tickets;
repeatSim.elapsed = repeatMain.spawnProtectionUntil + 0.01;
repeatMain.takeDamage(repeatMain.maxHp * 10, null, repeatSim, false);
const secondDeath = queueTerritoryRespawns({ modeState: repeatState, simulation: repeatSim });
assert(secondDeath.events.some((event) => event.type === "respawn_queued" && event.payload?.shipKey === "main"), "second main death should emit another respawn event");
assert(secondDeath.modeState.respawnQueue.some((item) => item.shipKey === "main" && item.deathCount === 2), "second main death should queue with incremented history");
assert(secondDeath.modeState.alliances.A.tickets === ticketsAfterFirstDeath - 5, "second main death should deduct tickets again");

let wipeSim = makeSimulation({ victoryPolicy: "external" });
let wipeState = makeState(1313);
for (const shipKey of ["main", "sub1", "sub2"]) {
  const ship = wipeSim.fleetBySeat("A").shipByKey(shipKey);
  ship.takeDamage(ship.maxHp * 10, null, wipeSim, false);
  const wipeStep = queueTerritoryRespawns({ modeState: wipeState, simulation: wipeSim });
  wipeState = wipeStep.modeState;
  if (shipKey === "sub2") {
    assert(wipeStep.events.filter((event) => event.type === "fleet_wiped_ticket_penalty").length === 1, "staggered third death should trigger one fleet-wipe penalty");
  }
}
assert(wipeState.alliances.A.tickets === 108, `three deaths plus one wipe should deduct 12 tickets, got ${wipeState.alliances.A.tickets}`);
const repeatedWipeScan = queueTerritoryRespawns({ modeState: wipeState, simulation: wipeSim });
assert(!repeatedWipeScan.events.some((event) => event.type === "fleet_wiped_ticket_penalty"), "an already wiped fleet should not be penalized again");
wipeState.respawnQueue.find((item) => item.seat === "A" && item.shipKey === "main").remaining = 0;
const wipeReset = updateTerritoryRespawns({ modeState: wipeState, simulation: wipeSim, dt: 0 });
wipeState = wipeReset.modeState;
const revivedWipeMain = wipeSim.fleetBySeat("A").shipByKey("main");
assert(revivedWipeMain.alive && wipeState.fleetWipeState.A === false, "successful respawn should reset persistent fleet-wipe state");
wipeSim.elapsed = revivedWipeMain.spawnProtectionUntil + 0.01;
revivedWipeMain.takeDamage(revivedWipeMain.maxHp * 10, null, wipeSim, false);
const secondFleetWipe = queueTerritoryRespawns({ modeState: wipeState, simulation: wipeSim });
assert(secondFleetWipe.events.filter((event) => event.type === "fleet_wiped_ticket_penalty").length === 1, "a second full wipe after respawn should trigger a fresh penalty");
assert(secondFleetWipe.modeState.alliances.A.tickets === 100, `second main death plus second wipe should leave 100 tickets, got ${secondFleetWipe.modeState.alliances.A.tickets}`);

const protectedShip = sim.fleetBySeat("A").shipByKey("main");
assert(protectedShip.spawnProtectionUntil > sim.elapsed, "respawn protection exists");
const protectionDeadline = protectedShip.spawnProtectionUntil;
applyRespawnProtectionRules({
  simulation: sim,
  action: { type: "set_route", shipKey: "main", endX: protectedShip.x + 80, endY: protectedShip.y },
  seat: "A",
});
assert(protectedShip.spawnProtectionUntil === protectionDeadline, "setting a route should not clear respawn protection");
const alliedSpawn = state.map.spawnAreas.find((area) => area.allianceId === "A");
protectedShip.x = alliedSpawn.center.x + alliedSpawn.radius - 1;
protectedShip.y = alliedSpawn.center.y;
let protectionUpdate = updateTerritoryRespawns({ modeState: state, simulation: sim, dt: 0 });
state = protectionUpdate.modeState;
assert(protectedShip.spawnProtectionUntil === protectionDeadline, "remaining inside the spawn area should preserve protection");
protectedShip.x = alliedSpawn.center.x + alliedSpawn.radius + 1;
protectionUpdate = updateTerritoryRespawns({ modeState: state, simulation: sim, dt: 0 });
state = protectionUpdate.modeState;
assert(protectedShip.spawnProtectionUntil === 0, "actually leaving the spawn area should clear protection");
assert(protectionUpdate.events.some((event) => event.type === "respawn_protection_ended" && event.payload?.reason === "left_spawn"), "leaving spawn should emit a protection-ended event");

const timeoutSim = makeSimulation({ victoryPolicy: "external" });
let timeoutState = makeState(2323);
const timeoutShip = timeoutSim.fleetBySeat("A").shipByKey("main");
const timeoutSpawn = timeoutState.map.spawnAreas.find((area) => area.allianceId === "A");
timeoutShip.x = timeoutSpawn.center.x;
timeoutShip.y = timeoutSpawn.center.y;
timeoutShip.spawnProtectionUntil = timeoutSim.elapsed + 3;
timeoutSim.elapsed = timeoutShip.spawnProtectionUntil;
const timeoutUpdate = updateTerritoryRespawns({ modeState: timeoutState, simulation: timeoutSim, dt: 0 });
timeoutState = timeoutUpdate.modeState;
assert(timeoutShip.spawnProtectionUntil === 0, "protection timeout should clear the deadline inside the allied spawn area");
assert(timeoutUpdate.events.some((event) => event.type === "respawn_protection_ended" && event.payload?.reason === "timeout"), "protection timeout should emit a reasoned protection-ended event");

state = makeState(2222);
sim = makeSimulation({ victoryPolicy: "external" });
state.alliances.B.tickets = 1;
const bMain = sim.fleetBySeat("B").shipByKey("main");
bMain.takeDamage(bMain.maxHp * 10, null, sim, false);
const cappedDeathQueue = queueTerritoryRespawns({ modeState: state, simulation: sim });
state = cappedDeathQueue.modeState;
assert(state.alliances.B.tickets === 0, "death ticket deduction floors at zero");
assert(state.result?.finished && state.result.winnerAllianceId === "A", "death ticket zero resolves external victory");
const cappedDeathEvent = cappedDeathQueue.events.find((event) => event.type === "respawn_queued" && event.payload?.shipKey === "main");
assert(cappedDeathEvent?.payload?.ticketCost === 1, `death event should report the actual one-ticket deduction: ${JSON.stringify(cappedDeathEvent)}`);

const blockedDeploymentState = makeState(4242);
const blockedDeploymentSim = makeSimulation({ victoryPolicy: "external" });
const requestedDeployment = territorySpawnDeployment({
  modeState: blockedDeploymentState,
  simulation: blockedDeploymentSim,
  seat: "A",
  shipKey: "main",
});
blockedDeploymentState.map.obstacleRegions.push({
  id: "deployment-blocker",
  shape: "circle",
  center: { x: requestedDeployment.x, y: requestedDeployment.y },
  radius: 54,
});
stellarTerritoryMode.prepareSimulation({ simulation: blockedDeploymentSim, modeState: blockedDeploymentState });
const safelyDeployedMain = blockedDeploymentSim.fleetBySeat("A").shipByKey("main");
assert(
  positionClearOfObstacles(safelyDeployedMain, safelyDeployedMain.radius, blockedDeploymentState.map.obstacleRegions),
  "initial deployment should move away from a blocked fixed slot",
);
const safelyDeployedFleet = Object.values(blockedDeploymentSim.fleetBySeat("A").ships);
for (let firstIndex = 0; firstIndex < safelyDeployedFleet.length; firstIndex += 1) {
  for (let secondIndex = firstIndex + 1; secondIndex < safelyDeployedFleet.length; secondIndex += 1) {
    const first = safelyDeployedFleet[firstIndex];
    const second = safelyDeployedFleet[secondIndex];
    assert(
      Math.hypot(first.x - second.x, first.y - second.y) >= first.radius + second.radius,
      `initial fallback deployments must not overlap: ${JSON.stringify({ first: first.key, second: second.key })}`,
    );
  }
}

let staleRespawnState = makeState(4343);
const staleRespawnSim = makeSimulation({ victoryPolicy: "external" });
stellarTerritoryMode.prepareSimulation({ simulation: staleRespawnSim, modeState: staleRespawnState });
const staleRespawnMain = staleRespawnSim.fleetBySeat("A").shipByKey("main");
staleRespawnMain.takeDamage(staleRespawnMain.maxHp * 10, null, staleRespawnSim, false);
staleRespawnState = queueTerritoryRespawns({ modeState: staleRespawnState, simulation: staleRespawnSim }).modeState;
const staleRespawnItem = staleRespawnState.respawnQueue.find((item) => item.seat === "A" && item.shipKey === "main");
const blockedRespawnPoint = staleRespawnState.map.obstacleRegions[0].center;
const occupiedFallback = territorySpawnDeployment({
  modeState: staleRespawnState,
  simulation: staleRespawnSim,
  seat: "A",
  shipKey: "main",
});
const occupyingShip = staleRespawnSim.fleetBySeat("A").shipByKey("sub1");
occupyingShip.x = occupiedFallback.x;
occupyingShip.y = occupiedFallback.y;
staleRespawnItem.spawnPosition = { ...blockedRespawnPoint };
staleRespawnItem.remaining = 0;
staleRespawnState = updateTerritoryRespawns({
  modeState: staleRespawnState,
  simulation: staleRespawnSim,
  dt: 0,
}).modeState;
assert(staleRespawnMain.alive, "stale blocked respawn reservation should recover to a legal deployment");
assert(
  positionClearOfObstacles(staleRespawnMain, staleRespawnMain.radius, staleRespawnState.map.obstacleRegions),
  "respawn fallback should remain obstacle-clear",
);
assert(
  Math.hypot(staleRespawnMain.x - occupyingShip.x, staleRespawnMain.y - occupyingShip.y)
    >= staleRespawnMain.radius + occupyingShip.radius,
  "respawn fallback should not overlap a living ship",
);

let occupiedReservationState = makeState(4444);
const occupiedReservationSim = makeSimulation({ victoryPolicy: "external" });
stellarTerritoryMode.prepareSimulation({ simulation: occupiedReservationSim, modeState: occupiedReservationState });
const occupiedReservationMain = occupiedReservationSim.fleetBySeat("A").shipByKey("main");
occupiedReservationMain.takeDamage(occupiedReservationMain.maxHp * 10, null, occupiedReservationSim, false);
occupiedReservationState = queueTerritoryRespawns({
  modeState: occupiedReservationState,
  simulation: occupiedReservationSim,
}).modeState;
const occupiedReservationItem = occupiedReservationState.respawnQueue.find((item) => item.seat === "A" && item.shipKey === "main");
const reservationOccupier = occupiedReservationSim.fleetBySeat("A").shipByKey("sub1");
reservationOccupier.x = occupiedReservationItem.spawnPosition.x;
reservationOccupier.y = occupiedReservationItem.spawnPosition.y;
occupiedReservationItem.remaining = 0;
occupiedReservationState = updateTerritoryRespawns({
  modeState: occupiedReservationState,
  simulation: occupiedReservationSim,
  dt: 0,
}).modeState;
assert(occupiedReservationMain.alive, "occupied respawn reservation should recover through deterministic fallback");
assert(
  Math.hypot(occupiedReservationMain.x - reservationOccupier.x, occupiedReservationMain.y - reservationOccupier.y)
    >= occupiedReservationMain.radius + reservationOccupier.radius,
  "respawn must revalidate living-ship occupancy when a reservation becomes due",
);

console.log("territory respawn verification passed");
