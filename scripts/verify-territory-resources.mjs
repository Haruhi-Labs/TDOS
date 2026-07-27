import { DEFAULT_AI_LOADOUT, DEFAULT_TEAM_LOADOUT, MatchSimulation, TICK_DT, cloneLoadout } from "../shared/game-core.js";
import { generateTerritoryMap } from "../shared/gameplay/territory-map.js";
import {
  RESOURCE_PICKUP_TYPES,
  applyTerritoryResourcePickup,
  collectTerritoryPickups,
  createTerritoryResourceRuntime,
  spawnTerritoryResource,
  updateTerritoryResourceLifecycle,
} from "../shared/gameplay/territory-pickups.js";
import { stellarTerritoryMode } from "../shared/modes/stellar-territory.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function makeSimulation() {
  return new MatchSimulation({
    mode: "ai",
    teamLoadouts: { A: cloneLoadout(DEFAULT_TEAM_LOADOUT), B: cloneLoadout(DEFAULT_AI_LOADOUT) },
    aiSeats: [],
  });
}

function makeModeState(seed = 2026) {
  return stellarTerritoryMode.createInitialModeState({
    randomSeed: seed,
    parameters: stellarTerritoryMode.defaultParameters,
  });
}

function stepResourceLifecycle(modeState, now, parameters = stellarTerritoryMode.defaultParameters, simulation = null) {
  const timedState = { ...modeState, elapsed: now };
  return updateTerritoryResourceLifecycle({
    modeState: timedState,
    dt: TICK_DT,
    now,
    simulation,
    parameters,
  });
}

for (const type of ["repair", "energy", "fleet_supply", "respawn_accelerator"]) {
  assert(RESOURCE_PICKUP_TYPES.includes(type), `missing resource type ${type}`);
}
assert(!RESOURCE_PICKUP_TYPES.includes("tickets"), "resources must not restore war tickets");

const blockedResourceState = makeModeState(4040);
const blockedResourceNode = blockedResourceState.map.resourceSpawnNodes.find((node) => node.rarity === "common");
blockedResourceState.map.obstacleRegions.push({
  id: "resource-node-blocker",
  shape: "circle",
  center: { ...blockedResourceNode.center },
  radius: 60,
});
const blockedResourceSpawn = spawnTerritoryResource({
  modeState: blockedResourceState,
  rarity: "common",
  reservation: {
    rarity: "common",
    resourceType: "repair",
    nodeId: blockedResourceNode.id,
    position: { ...blockedResourceNode.center },
    spawnAt: 10,
  },
});
assert(blockedResourceSpawn.pickups.length === 0, "blocked resource reservation must not spawn inside an obstacle");

const outOfBoundsResourceState = makeModeState(4042);
const outOfBoundsResourceNode = outOfBoundsResourceState.map.resourceSpawnNodes.find((node) => node.rarity === "common");
const outOfBoundsResourceSpawn = spawnTerritoryResource({
  modeState: outOfBoundsResourceState,
  rarity: "common",
  reservation: {
    rarity: "common",
    resourceType: "repair",
    nodeId: outOfBoundsResourceNode.id,
    position: { x: -100, y: -100 },
    spawnAt: 10,
  },
});
assert(outOfBoundsResourceSpawn.pickups.length === 0, "resource reservation must remain inside radius-aware safe bounds");

let staleBlockedResourceState = stepResourceLifecycle(blockedResourceState, 0).modeState;
staleBlockedResourceState.resourceRuntime.nextCommonAt = 10;
staleBlockedResourceState.resourceRuntime.nextRareAt = 10_000;
staleBlockedResourceState.resourceRuntime.warned.common = true;
staleBlockedResourceState.resourceRuntime.reservations.common = {
  rarity: "common",
  resourceType: "repair",
  nodeId: blockedResourceNode.id,
  position: { ...blockedResourceNode.center },
  spawnAt: 10,
};
const staleBlockedResourceLifecycle = stepResourceLifecycle(staleBlockedResourceState, 10);
assert(!staleBlockedResourceLifecycle.events.some((event) => event.type === "resource_spawned"), "blocked due resource should not spawn");
assert(
  staleBlockedResourceLifecycle.modeState.resourceRuntime.reservations.common === null,
  "blocked due resource reservation should be cleared",
);
assert(
  staleBlockedResourceLifecycle.modeState.resourceRuntime.nextCommonAt > 10,
  "blocked due resource should reschedule a future lifecycle",
);

const lifecycleA = createTerritoryResourceRuntime({ seed: 444, parameters: stellarTerritoryMode.defaultParameters });
const lifecycleB = createTerritoryResourceRuntime({ seed: 444, parameters: stellarTerritoryMode.defaultParameters });
const lifecycleC = createTerritoryResourceRuntime({ seed: 445, parameters: stellarTerritoryMode.defaultParameters });
const customLifecycle = createTerritoryResourceRuntime({
  seed: 444,
  parameters: {
    ...stellarTerritoryMode.defaultParameters,
    commonResourceSpawnSeconds: 40,
    rareResourceSpawnSeconds: 180,
  },
});
assert(JSON.stringify(lifecycleA) === JSON.stringify(lifecycleB), "same seed resource runtime deterministic");
assert(JSON.stringify(lifecycleA) !== JSON.stringify(lifecycleC), "different seed resource runtime differs");
assert(customLifecycle.nextCommonAt >= 40 * 0.85 && customLifecycle.nextCommonAt <= 40 * 1.15, `custom common interval should control jitter: ${customLifecycle.nextCommonAt}`);
assert(customLifecycle.nextRareAt >= 180 * 0.85 && customLifecycle.nextRareAt <= 180 * 1.15, `custom rare interval should control jitter: ${customLifecycle.nextRareAt}`);
assert(lifecycleA.nextCommonAt >= 52 * 0.85 && lifecycleA.nextCommonAt <= 52 * 1.15, `common interval should use parameter jitter: ${lifecycleA.nextCommonAt}`);
assert(lifecycleA.nextRareAt >= 120 * 0.85 && lifecycleA.nextRareAt <= 120 * 1.15, `rare interval should use parameter jitter: ${lifecycleA.nextRareAt}`);

let state = makeModeState(444);
const firstCommonAt = createTerritoryResourceRuntime({ seed: state.seed, parameters: stellarTerritoryMode.defaultParameters }).nextCommonAt;
let events = [];
let now = 0;
while (now + TICK_DT < firstCommonAt - 5.9) {
  now += TICK_DT;
  const result = stepResourceLifecycle(state, now);
  state = result.modeState;
  events.push(...result.events);
}
while (!events.some((event) => event.type === "resource_warning") && now < firstCommonAt + 1) {
  now += TICK_DT;
  const result = stepResourceLifecycle(state, now);
  state = result.modeState;
  events.push(...result.events);
}
assert(events.some((event) => event.type === "resource_warning"), "resource warning should appear before spawn");
const warning = events.find((event) => event.type === "resource_warning" && event.payload.rarity === "common");
assert(warning?.position && Number.isFinite(warning.position.x) && Number.isFinite(warning.position.y), `resource warning should include position: ${JSON.stringify(warning)}`);
assert(RESOURCE_PICKUP_TYPES.includes(warning?.payload?.resourceType), `resource warning should include type: ${JSON.stringify(warning)}`);
assert(warning?.payload?.nodeId, `resource warning should include node: ${JSON.stringify(warning)}`);
assert(Number(warning?.payload?.spawnAt) > now, `resource warning should include future spawn time: ${JSON.stringify(warning)}`);

while (!events.some((event) => event.type === "resource_spawned") && now < warning.payload.spawnAt + 1) {
  now += TICK_DT;
  const result = stepResourceLifecycle(state, now);
  state = result.modeState;
  events.push(...result.events);
}
assert(events.some((event) => event.type === "resource_spawned"), "resource should spawn");
assert(state.pickups.length > 0, "spawned resource should be in pickups");
const firstPickup = state.pickups[0];
assert(!("expiresAt" in firstPickup), `persistent resource must not have expiresAt: ${JSON.stringify(firstPickup)}`);
assert(firstPickup.nodeId === warning.payload.nodeId, "spawn should use the warned node");
assert(firstPickup.resourceType === warning.payload.resourceType, "spawn should use the warned type");
assert(firstPickup.position.x === warning.position.x && firstPickup.position.y === warning.position.y, "spawn should use the warned position");
assert(firstPickup.spawnedAt === warning.payload.spawnAt, "spawn should use the warned spawn time");
assert(!state.map.spawnAreas.some((area) => firstPickup.nodeId === area.id), "resource must not spawn in spawn area");

const persistentPickupId = firstPickup.id;
const expiryEventCount = events.filter((event) => event.type === "resource_expired").length;
for (let i = 0; i < Math.ceil(180 / TICK_DT); i += 1) {
  now += TICK_DT;
  const result = stepResourceLifecycle(state, now);
  state = result.modeState;
  events.push(...result.events);
}
assert(state.pickups.some((pickup) => pickup.id === persistentPickupId), "uncollected resource should persist after 180 seconds");
assert(events.filter((event) => event.type === "resource_expired").length === expiryEventCount, "persistent resources must not emit expiry events");

let capacityState = makeModeState(555);
const commonNodeCount = capacityState.map.resourceSpawnNodes.filter((item) => item.rarity === "common").length;
for (let index = 0; index < commonNodeCount; index += 1) {
  const result = spawnTerritoryResource({ modeState: capacityState, rarity: "common" });
  assert(result.pickups.length === 1, `common node ${index + 1} should accept one resource`);
  capacityState = result.modeState;
}
assert(new Set(capacityState.pickups.map((pickup) => pickup.nodeId)).size === commonNodeCount, "each common node should contain at most one resource");
const capacityBlocked = spawnTerritoryResource({ modeState: capacityState, rarity: "common" });
assert(capacityBlocked.pickups.length === 0, "resource generation should pause when all legal nodes are occupied");

capacityState.resourceRuntime.nextCommonAt = 10;
capacityState.resourceRuntime.nextRareAt = 10_000;
capacityState.resourceRuntime.warned.common = false;
capacityState.resourceRuntime.reservations.common = null;
let capacityLifecycle = stepResourceLifecycle(capacityState, 5);
capacityState = capacityLifecycle.modeState;
assert(!capacityLifecycle.events.some((event) => event.type === "resource_warning"), "full capacity should not warn for an unavailable node");
capacityLifecycle = stepResourceLifecycle(capacityState, 12);
capacityState = capacityLifecycle.modeState;
assert(!capacityLifecycle.events.some((event) => event.type === "resource_spawned"), "full capacity should keep generation paused after the due time");

const freedPickup = capacityState.pickups[0];
capacityState.pickups = capacityState.pickups.filter((pickup) => pickup.id !== freedPickup.id);
capacityLifecycle = stepResourceLifecycle(capacityState, 13);
capacityState = capacityLifecycle.modeState;
const resumedWarning = capacityLifecycle.events.find((event) => event.type === "resource_warning" && event.payload.rarity === "common");
assert(resumedWarning?.payload?.nodeId === freedPickup.nodeId, "capacity recovery should reserve the node that became free");
assert(resumedWarning.payload.spawnAt > 13, "capacity recovery should issue a future warning before spawning");
assert(!capacityLifecycle.events.some((event) => event.type === "resource_spawned"), "capacity recovery should not warn and spawn in the same tick");
capacityLifecycle = stepResourceLifecycle(capacityState, resumedWarning.payload.spawnAt + TICK_DT);
capacityState = capacityLifecycle.modeState;
const resumedPickup = capacityState.pickups.find((pickup) => pickup.spawnedAt === resumedWarning.payload.spawnAt);
assert(resumedPickup?.nodeId === resumedWarning.payload.nodeId, "capacity recovery spawn should use the reserved node");
assert(resumedPickup?.resourceType === resumedWarning.payload.resourceType, "capacity recovery spawn should use the reserved type");

state = makeModeState(777);
const spawnTypes = [];
for (let i = 0; i < 12; i += 1) {
  const result = spawnTerritoryResource({ modeState: state, rarity: "common" });
  state = result.modeState;
  spawnTypes.push(result.pickups[0].resourceType);
  state.pickups = [];
}
for (let i = 2; i < spawnTypes.length; i += 1) {
  assert(
    !(spawnTypes[i] === spawnTypes[i - 1] && spawnTypes[i] === spawnTypes[i - 2]),
    `resource bag repeated three times: ${spawnTypes.join(",")}`,
  );
}

const sim = makeSimulation();
const fleet = sim.fleetBySeat("A");
const main = fleet.shipByKey("main");
main.hp = main.maxHp * 0.5;
let pickupResult = applyTerritoryResourcePickup({
  pickup: { id: "p-repair", resourceType: "repair" },
  simulation: sim,
  seat: "A",
  shipKey: "main",
  modeState: makeModeState(1),
});
assert(pickupResult.accepted, "repair pickup accepted");
assert(Math.abs(main.hp - main.maxHp * 0.68) < 1e-6, `repair should restore 18% max hull, got ${main.hp / main.maxHp}`);
assert(pickupResult.events[0]?.payload?.hullRatio === 0.18, "repair event should expose 18% hull feedback");

main.hp = main.maxHp * 0.95;
pickupResult = applyTerritoryResourcePickup({
  pickup: { id: "p-repair-capped", resourceType: "repair" },
  simulation: sim,
  seat: "A",
  shipKey: "main",
  modeState: makeModeState(1),
});
assert(Math.abs(pickupResult.events[0]?.payload?.hullRatio - 0.05) < 1e-6, "capped repair feedback should report the 5% actually restored");

main.energy = main.maxEnergy * 0.25;
pickupResult = applyTerritoryResourcePickup({
  pickup: { id: "p-energy", resourceType: "energy" },
  simulation: sim,
  seat: "A",
  shipKey: "main",
  modeState: makeModeState(1),
});
assert(pickupResult.accepted, "energy pickup accepted");
assert(Math.abs(main.energy - main.maxEnergy * 0.6) < 1e-6, `energy should restore 35% max energy, got ${main.energy / main.maxEnergy}`);
assert(pickupResult.events[0]?.payload?.energyRatio === 0.35, "energy event should expose 35% energy feedback");

main.energy = main.maxEnergy * 0.9;
pickupResult = applyTerritoryResourcePickup({
  pickup: { id: "p-energy-capped", resourceType: "energy" },
  simulation: sim,
  seat: "A",
  shipKey: "main",
  modeState: makeModeState(1),
});
assert(Math.abs(pickupResult.events[0]?.payload?.energyRatio - 0.1) < 1e-6, "capped energy feedback should report the 10% actually restored");

for (const ship of Object.values(fleet.ships)) {
  ship.hp = ship.maxHp * 0.5;
  ship.energy = ship.maxEnergy * 0.5;
}
pickupResult = applyTerritoryResourcePickup({
  pickup: { id: "p-fleet", resourceType: "fleet_supply" },
  simulation: sim,
  seat: "A",
  shipKey: "main",
  modeState: makeModeState(1),
});
assert(pickupResult.accepted, "fleet supply pickup accepted");
assert(pickupResult.events[0]?.payload?.hullRatio === 0.08, "fleet supply event should expose 8% hull feedback");
assert(pickupResult.events[0]?.payload?.energyRatio === 0.15, "fleet supply event should expose 15% energy feedback");
assert(pickupResult.events[0]?.payload?.fleetWide === true, "fleet supply event should identify fleet-wide feedback");
for (const ship of Object.values(fleet.ships)) {
  assert(Math.abs(ship.hp - ship.maxHp * 0.58) < 1e-6, "fleet supply restores all living hull");
  assert(Math.abs(ship.energy - ship.maxEnergy * 0.65) < 1e-6, "fleet supply restores all living energy");
}

for (const ship of Object.values(fleet.ships)) {
  ship.hp = ship.maxHp * 0.95;
  ship.energy = ship.maxEnergy * 0.9;
}
pickupResult = applyTerritoryResourcePickup({
  pickup: { id: "p-fleet-capped", resourceType: "fleet_supply" },
  simulation: sim,
  seat: "A",
  shipKey: "main",
  modeState: makeModeState(1),
});
assert(Math.abs(pickupResult.events[0]?.payload?.hullRatio - 0.05) < 1e-6, "fleet supply feedback should aggregate actual capped hull recovery");
assert(Math.abs(pickupResult.events[0]?.payload?.energyRatio - 0.1) < 1e-6, "fleet supply feedback should aggregate actual capped energy recovery");

const respawnState = makeModeState(1);
respawnState.respawnQueue = [
  { seat: "A", shipKey: "main", remaining: 12 },
  { seat: "A", shipKey: "sub1", remaining: 4 },
  { seat: "B", shipKey: "main", remaining: 12 },
];
pickupResult = applyTerritoryResourcePickup({
  pickup: { id: "p-respawn", resourceType: "respawn_accelerator" },
  simulation: sim,
  seat: "A",
  shipKey: "main",
  modeState: respawnState,
});
assert(pickupResult.accepted, "respawn accelerator pickup accepted");
assert(pickupResult.events[0]?.payload?.respawnSeconds === 6, "respawn accelerator feedback should total the six seconds actually removed");
assert(pickupResult.modeState.respawnQueue[0].remaining === 8, "respawn accelerator reduces remaining by 4");
assert(pickupResult.modeState.respawnQueue[1].remaining === 2, "respawn accelerator keeps minimum 2 seconds");
assert(pickupResult.modeState.respawnQueue[2].remaining === 12, "respawn accelerator only affects own alliance");

const cappedRespawnState = makeModeState(1);
cappedRespawnState.respawnQueue = [{ seat: "A", shipKey: "main", remaining: 3 }];
pickupResult = applyTerritoryResourcePickup({
  pickup: { id: "p-respawn-capped", resourceType: "respawn_accelerator" },
  simulation: sim,
  seat: "A",
  shipKey: "main",
  modeState: cappedRespawnState,
});
assert(pickupResult.events[0]?.payload?.respawnSeconds === 1, "capped respawn feedback should report the one second actually removed");

const belowFloorRespawnState = makeModeState(1);
belowFloorRespawnState.respawnQueue = [{ seat: "A", shipKey: "main", remaining: 1.25 }];
pickupResult = applyTerritoryResourcePickup({
  pickup: { id: "p-respawn-below-floor", resourceType: "respawn_accelerator" },
  simulation: sim,
  seat: "A",
  shipKey: "main",
  modeState: belowFloorRespawnState,
});
assert(pickupResult.modeState.respawnQueue[0].remaining === 1.25, "respawn accelerator must not increase a countdown already below two seconds");
assert(pickupResult.events[0]?.payload?.respawnSeconds === 0, "below-floor respawn feedback should report zero seconds removed");

const conflictSim = makeSimulation();
const map = generateTerritoryMap({ seed: 303, templateId: "three-lane-v1", worldSize: { width: 1440, height: 1440 } });
const node = map.resourceSpawnNodes.find((item) => item.rarity === "common");
const conflictFleet = conflictSim.fleetBySeat("A");
const mainA = conflictFleet.shipByKey("main");
const subA = conflictFleet.shipByKey("sub1");
mainA.x = node.center.x - 4;
mainA.y = node.center.y;
subA.x = node.center.x + 4;
subA.y = node.center.y;
mainA.hp = mainA.maxHp * 0.5;
subA.hp = subA.maxHp * 0.5;
let conflictState = makeModeState(303);
conflictState.map = map;
conflictState.pickups = [
  {
    id: "conflict",
    resourceType: "repair",
    rarity: "common",
    nodeId: node.id,
    position: node.center,
    radius: 28,
    spawnedAt: 0,
  },
];
const collectResult = collectTerritoryPickups({
  modeState: conflictState,
  simulation: conflictSim,
});
conflictState = collectResult.modeState;
assert(collectResult.events.filter((event) => event.type === "resource_collected").length === 1, "pickup collected once");
const collectedEvent = collectResult.events.find((event) => event.type === "resource_collected");
assert(collectedEvent.payload?.hullRatio === 0.18, "repair collection event should expose its applied hull recovery for presentation");
assert(conflictState.pickups.length === 0, "collected pickup removed");
assert(mainA.hp > mainA.maxHp * 0.5, "stable lower ship id wins equal-distance pickup");
assert(subA.hp === subA.maxHp * 0.5, "losing contact ship does not collect same pickup");

console.log("territory resource verification passed");
