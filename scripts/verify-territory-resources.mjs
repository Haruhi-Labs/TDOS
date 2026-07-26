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

for (const type of ["repair", "energy", "fleet_supply", "respawn_accelerator"]) {
  assert(RESOURCE_PICKUP_TYPES.includes(type), `missing resource type ${type}`);
}
assert(!RESOURCE_PICKUP_TYPES.includes("tickets"), "resources must not restore war tickets");

const lifecycleA = createTerritoryResourceRuntime({ seed: 444 });
const lifecycleB = createTerritoryResourceRuntime({ seed: 444 });
const lifecycleC = createTerritoryResourceRuntime({ seed: 445 });
assert(JSON.stringify(lifecycleA) === JSON.stringify(lifecycleB), "same seed resource runtime deterministic");
assert(JSON.stringify(lifecycleA) !== JSON.stringify(lifecycleC), "different seed resource runtime differs");

let state = makeModeState(444);
const firstCommonAt = createTerritoryResourceRuntime({ seed: state.seed }).nextCommonAt;
let events = [];
for (let i = 0; i < Math.ceil((firstCommonAt - 5.9) / TICK_DT); i += 1) {
  const result = updateTerritoryResourceLifecycle({
    modeState: state,
    dt: TICK_DT,
    simulation: null,
    parameters: stellarTerritoryMode.defaultParameters,
  });
  state = result.modeState;
  events.push(...result.events);
}
assert(events.some((event) => event.type === "resource_warning"), "resource warning should appear before spawn");

for (let i = 0; i < Math.ceil(7 / TICK_DT); i += 1) {
  const result = updateTerritoryResourceLifecycle({
    modeState: state,
    dt: TICK_DT,
    simulation: null,
    parameters: stellarTerritoryMode.defaultParameters,
  });
  state = result.modeState;
  events.push(...result.events);
}
assert(events.some((event) => event.type === "resource_spawned"), "resource should spawn");
assert(state.pickups.length > 0, "spawned resource should be in pickups");
const firstPickup = state.pickups[0];
assert(Math.abs(firstPickup.expiresAt - firstPickup.spawnedAt - 30) < 1e-6, "pickup lifetime should be 30 seconds");
assert(!state.map.spawnAreas.some((area) => firstPickup.nodeId === area.id), "resource must not spawn in spawn area");

for (let i = 0; i < Math.ceil(35 / TICK_DT); i += 1) {
  const result = updateTerritoryResourceLifecycle({
    modeState: state,
    dt: TICK_DT,
    simulation: null,
    parameters: stellarTerritoryMode.defaultParameters,
  });
  state = result.modeState;
  events.push(...result.events);
}
assert(events.some((event) => event.type === "resource_expired"), "resource should expire");

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
for (const ship of Object.values(fleet.ships)) {
  assert(Math.abs(ship.hp - ship.maxHp * 0.58) < 1e-6, "fleet supply restores all living hull");
  assert(Math.abs(ship.energy - ship.maxEnergy * 0.65) < 1e-6, "fleet supply restores all living energy");
}

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
assert(pickupResult.modeState.respawnQueue[0].remaining === 8, "respawn accelerator reduces remaining by 4");
assert(pickupResult.modeState.respawnQueue[1].remaining === 2, "respawn accelerator keeps minimum 2 seconds");
assert(pickupResult.modeState.respawnQueue[2].remaining === 12, "respawn accelerator only affects own alliance");

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
    expiresAt: 30,
  },
];
const collectResult = collectTerritoryPickups({
  modeState: conflictState,
  simulation: conflictSim,
});
conflictState = collectResult.modeState;
assert(collectResult.events.filter((event) => event.type === "resource_collected").length === 1, "pickup collected once");
assert(conflictState.pickups.length === 0, "collected pickup removed");
assert(mainA.hp > mainA.maxHp * 0.5, "stable lower ship id wins equal-distance pickup");
assert(subA.hp === subA.maxHp * 0.5, "losing contact ship does not collect same pickup");

console.log("territory resource verification passed");
