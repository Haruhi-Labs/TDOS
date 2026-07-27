import { DEFAULT_AI_LOADOUT, DEFAULT_TEAM_LOADOUT, MatchSimulation, TICK_DT, cloneLoadout } from "../shared/game-core.js";
import {
  ALLOWED_TACTICAL_SKILLS,
  FORBIDDEN_SCOUT_SKILL_TERMS,
  collectTerritorySkillPickups,
  spawnTerritorySkillPickup,
  updateTerritorySkillEffects,
  updateTerritorySkillLifecycle,
  useTerritoryTacticalSkill,
} from "../shared/gameplay/territory-skills.js";
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

function makeState(seed = 818) {
  return stellarTerritoryMode.createInitialModeState({
    randomSeed: seed,
    parameters: stellarTerritoryMode.defaultParameters,
  });
}

function stepSkillLifecycle(
  modeState,
  dt = TICK_DT,
  parameters = stellarTerritoryMode.defaultParameters,
  simulation = null,
) {
  const timedState = { ...modeState, elapsed: Number(modeState.elapsed || 0) + dt };
  return updateTerritorySkillLifecycle({
    modeState: timedState,
    dt,
    now: timedState.elapsed,
    simulation,
    parameters,
  });
}

function stepSkillEffects(modeState, simulation, dt = TICK_DT) {
  const timedState = { ...modeState, elapsed: Number(modeState.elapsed || 0) + dt };
  return updateTerritorySkillEffects({
    modeState: timedState,
    simulation,
    dt,
    now: timedState.elapsed,
  }).modeState;
}

assert(ALLOWED_TACTICAL_SKILLS.length >= 6, "at least six active tactical skills required");
for (const skill of ALLOWED_TACTICAL_SKILLS) {
  const blob = `${skill.id} ${skill.name} ${skill.description || ""}`.toLowerCase();
  for (const term of FORBIDDEN_SCOUT_SKILL_TERMS) {
    assert(!blob.includes(term.toLowerCase()), `forbidden scout-like skill term ${term} in ${skill.id}`);
  }
}
assert(ALLOWED_TACTICAL_SKILLS.every((skill) => skill.type === "active"), "all tactical skills must be active");

const blockedSkillState = makeState(4041);
const blockedSkillNode = blockedSkillState.map.skillSpawnNodes[0];
blockedSkillState.map.obstacleRegions.push({
  id: "skill-node-blocker",
  shape: "circle",
  center: { ...blockedSkillNode.center },
  radius: 60,
});
const blockedSkillSpawn = spawnTerritorySkillPickup({
  modeState: blockedSkillState,
  skillId: "all_fleet_shield",
  reservation: {
    skillId: "all_fleet_shield",
    nodeId: blockedSkillNode.id,
    position: { ...blockedSkillNode.center },
    spawnAt: 10,
  },
});
assert(blockedSkillSpawn.pickups.length === 0, "blocked skill reservation must not spawn inside an obstacle");

const blockedWarpState = makeState(4042);
const blockedWarpSim = new MatchSimulation({ mode: "pvp", worldSize: stellarTerritoryMode.worldSize });
stellarTerritoryMode.prepareSimulation({ simulation: blockedWarpSim, modeState: blockedWarpState });
const blockedWarpObstacle = blockedWarpState.map.obstacleRegions[0];
const blockedWarpFleet = blockedWarpSim.fleetBySeat("A");
const blockedWarpShips = Object.values(blockedWarpFleet.ships);
for (let index = 0; index < blockedWarpShips.length; index += 1) {
  const ship = blockedWarpShips[index];
  ship.x = blockedWarpObstacle.center.x - 150 - index * 24;
  ship.y = blockedWarpObstacle.center.y + index * 20;
  ship.command = { x: ship.x, y: ship.y };
  ship.route = null;
}
blockedWarpState.alliances.A.skillSlot = { skillId: "short_warp", acquiredAt: 0 };
const blockedWarpPositions = blockedWarpShips.map((ship) => ({ x: ship.x, y: ship.y }));
const blockedWarp = useTerritoryTacticalSkill({
  modeState: blockedWarpState,
  simulation: blockedWarpSim,
  seat: "A",
  action: {
    type: "use_tactical_skill",
    targetType: "point",
    targetSeat: "A",
    targetX: blockedWarpObstacle.center.x,
    targetY: blockedWarpObstacle.center.y,
  },
});
assert(!blockedWarp.accepted, "short warp landing inside an obstacle must be rejected");
assert(blockedWarp.events.length === 0, "rejected blocked warp must emit no effect event");
assert(blockedWarp.modeState.alliances.A.skillSlot?.skillId === "short_warp", "rejected blocked warp must preserve the skill slot");
assert(
  blockedWarpShips.every((ship, index) => ship.x === blockedWarpPositions[index].x && ship.y === blockedWarpPositions[index].y),
  "rejected blocked warp must not move any fleet ship",
);

let state = makeState(818);
let initialized = stepSkillLifecycle(state, 0);
assert(initialized.modeState.skillRuntime.nextSkillAt >= 60 && initialized.modeState.skillRuntime.nextSkillAt <= 90, `default skill interval should be 60-90 seconds: ${initialized.modeState.skillRuntime.nextSkillAt}`);
const customSkillParameters = { ...stellarTerritoryMode.defaultParameters, skillSpawnInterval: 100 };
initialized = stepSkillLifecycle(makeState(818), 0, customSkillParameters);
assert(initialized.modeState.skillRuntime.nextSkillAt >= 80 && initialized.modeState.skillRuntime.nextSkillAt <= 120, `custom skill interval should control jitter: ${initialized.modeState.skillRuntime.nextSkillAt}`);

let events = [];
for (let i = 0; i < Math.ceil(100 / TICK_DT); i += 1) {
  const result = stepSkillLifecycle(state);
  state = result.modeState;
  events.push(...result.events);
}
assert(events.some((event) => event.type === "skill_warning"), "skill warning should appear before spawn");
assert(events.some((event) => event.type === "skill_spawned"), "skill pickup should spawn");
assert(state.skillPickups.length > 0, "skill pickup should be stored");
const skillWarning = events.find((event) => event.type === "skill_warning");
const firstSkillPickup = state.skillPickups[0];
assert(skillWarning?.position && Number.isFinite(skillWarning.position.x) && Number.isFinite(skillWarning.position.y), `skill warning should include position: ${JSON.stringify(skillWarning)}`);
assert(ALLOWED_TACTICAL_SKILLS.some((skill) => skill.id === skillWarning?.payload?.skillId), `skill warning should include type: ${JSON.stringify(skillWarning)}`);
assert(skillWarning?.payload?.nodeId, `skill warning should include node: ${JSON.stringify(skillWarning)}`);
assert(firstSkillPickup.nodeId === skillWarning.payload.nodeId, "skill spawn should use warned node");
assert(firstSkillPickup.skillId === skillWarning.payload.skillId, "skill spawn should use warned type");
assert(firstSkillPickup.position.x === skillWarning.position.x && firstSkillPickup.position.y === skillWarning.position.y, "skill spawn should use warned position");
assert(firstSkillPickup.spawnedAt === skillWarning.payload.spawnAt, "skill spawn should use warned time");
assert(!("expiresAt" in firstSkillPickup), `persistent skill must not have expiresAt: ${JSON.stringify(firstSkillPickup)}`);

const persistentSkillId = firstSkillPickup.id;
const expiredSkillEventCount = events.filter((event) => event.type === "skill_expired").length;
for (let i = 0; i < Math.ceil(180 / TICK_DT); i += 1) {
  const result = stepSkillLifecycle(state);
  state = result.modeState;
  events.push(...result.events);
}
assert(state.skillPickups.some((pickup) => pickup.id === persistentSkillId), "uncollected skill pickup should persist after 180 seconds");
assert(events.filter((event) => event.type === "skill_expired").length === expiredSkillEventCount, "persistent skills must not emit expiry events");
assert(state.skillPickups.length <= 2, `skill pickup count should be capped at two: ${state.skillPickups.length}`);

let capacityState = makeState(828);
for (let index = 0; index < 2; index += 1) {
  const spawned = spawnTerritorySkillPickup({ modeState: capacityState });
  assert(spawned.pickups.length === 1, `skill capacity slot ${index + 1} should accept one pickup`);
  capacityState = spawned.modeState;
}
assert(new Set(capacityState.skillPickups.map((pickup) => pickup.nodeId)).size === 2, "skill pickups should occupy distinct nodes");
const capacityBlocked = spawnTerritorySkillPickup({ modeState: capacityState });
assert(capacityBlocked.pickups.length === 0, "third simultaneous skill pickup should be blocked");
capacityState.skillRuntime.nextSkillAt = 10;
capacityState.skillRuntime.warned = false;
capacityState.skillRuntime.reservation = null;
let capacityLifecycle = stepSkillLifecycle(capacityState, 5);
capacityState = capacityLifecycle.modeState;
assert(!capacityLifecycle.events.some((event) => event.type === "skill_warning"), "full skill capacity should not warn");
capacityLifecycle = stepSkillLifecycle(capacityState, 7);
capacityState = capacityLifecycle.modeState;
assert(!capacityLifecycle.events.some((event) => event.type === "skill_spawned"), "full skill capacity should pause after due time");
const freedSkill = capacityState.skillPickups[0];
capacityState.skillPickups = capacityState.skillPickups.filter((pickup) => pickup.id !== freedSkill.id);
const occupiedSkillNodeIds = new Set(capacityState.skillPickups.map((pickup) => pickup.nodeId));
capacityLifecycle = stepSkillLifecycle(capacityState, 1);
capacityState = capacityLifecycle.modeState;
const resumedSkillWarning = capacityLifecycle.events.find((event) => event.type === "skill_warning");
assert(capacityState.map.skillSpawnNodes.some((node) => node.id === resumedSkillWarning?.payload?.nodeId), "skill capacity recovery should reserve a legal node");
assert(!occupiedSkillNodeIds.has(resumedSkillWarning.payload.nodeId), "skill capacity recovery should reserve an unoccupied node");
assert(resumedSkillWarning.payload.spawnAt > capacityState.elapsed, "skill capacity recovery should reserve a future spawn");
assert(!capacityLifecycle.events.some((event) => event.type === "skill_spawned"), "skill capacity recovery should not warn and spawn together");
capacityLifecycle = stepSkillLifecycle(capacityState, resumedSkillWarning.payload.spawnAt - capacityState.elapsed + TICK_DT);
capacityState = capacityLifecycle.modeState;
const resumedSkill = capacityState.skillPickups.find((pickup) => pickup.spawnedAt === resumedSkillWarning.payload.spawnAt);
assert(resumedSkill?.nodeId === resumedSkillWarning.payload.nodeId, "skill capacity recovery should use warned node");
assert(resumedSkill?.skillId === resumedSkillWarning.payload.skillId, "skill capacity recovery should use warned type");

let sim = makeSimulation();
const skillNode = state.map.skillSpawnNodes[0];
const fleet = sim.fleetBySeat("A");
const main = fleet.shipByKey("main");
main.x = skillNode.center.x;
main.y = skillNode.center.y;
state.skillPickups = [
  {
    id: "skill-a",
    skillId: "all_fleet_shield",
    nodeId: skillNode.id,
    position: skillNode.center,
    radius: 30,
    spawnedAt: 0,
  },
];
let collect = collectTerritorySkillPickups({ modeState: state, simulation: sim });
state = collect.modeState;
assert(collect.events.some((event) => event.type === "skill_collected"), "skill pickup collected");
assert(state.alliances.A.skillSlot?.skillId === "all_fleet_shield", "skill pickup goes to alliance slot");
assert(state.skillPickups.length === 0, "collected skill pickup removed");

state = spawnTerritorySkillPickup({
  modeState: state,
  skillId: "gravity_field",
  nodeId: skillNode.id,
}).modeState;
state.skillPickups[0].position = skillNode.center;
collect = collectTerritorySkillPickups({ modeState: state, simulation: sim });
state = collect.modeState;
assert(state.alliances.A.skillSlot?.skillId === "gravity_field", "new skill replaces old slot");
assert(collect.events.some((event) => event.type === "skill_replaced"), "replacement event emitted");

const invalid = useTerritoryTacticalSkill({
  modeState: state,
  simulation: sim,
  seat: "A",
  action: { type: "use_tactical_skill", targetType: "point", targetX: -10, targetY: 200 },
});
assert(!invalid.accepted, "invalid target point rejected");
assert(state.alliances.A.skillSlot?.skillId === "gravity_field", "invalid use does not consume skill");

const usedGravity = useTerritoryTacticalSkill({
  modeState: state,
  simulation: sim,
  seat: "A",
  action: { type: "use_tactical_skill", targetType: "point", targetX: 720, targetY: 720 },
});
state = usedGravity.modeState;
assert(usedGravity.accepted, "gravity field use accepted");
assert(state.alliances.A.skillSlot === null, "skill consumed on accepted use");
assert(state.activeSkillEffects.some((effect) => effect.skillId === "gravity_field" && effect.duration === 9), "gravity effect active");
assert(usedGravity.events.some((event) => event.type === "skill_used"), "skill used event emitted");

const gravityShip = sim.fleetBySeat("B").shipByKey("main");
gravityShip.x = 720;
gravityShip.y = 720;
const normalGravitySpeed = gravityShip.baseSpeed();
const normalGravityTurn = gravityShip.baseTurnRate();
state = stepSkillEffects(state, sim);
assert(gravityShip.baseSpeed() < normalGravitySpeed * 0.72, "gravity field slows ships in radius");
assert(gravityShip.baseTurnRate() < normalGravityTurn * 0.82, "gravity field reduces turn rate in radius");
for (let i = 0; i < Math.ceil(9 / TICK_DT); i += 1) {
  state = stepSkillEffects(state, sim);
}
assert(Math.abs(gravityShip.baseSpeed() - normalGravitySpeed) < 1e-6, "gravity field movement modifier clears after duration");

const targetFleet = sim.fleetBySeat("A");
const targetShip = targetFleet.shipByKey("main");
targetShip.hp = targetShip.maxHp * 0.5;
state.alliances.A.skillSlot = { skillId: "repair_drones", acquiredAt: state.elapsed };
const repairUse = useTerritoryTacticalSkill({
  modeState: state,
  simulation: sim,
  seat: "A",
  action: { type: "use_tactical_skill", targetType: "fleet", targetSeat: "A" },
});
state = repairUse.modeState;
assert(repairUse.accepted, "repair drones accepted on own fleet");
assert(state.activeSkillEffects.some((effect) => effect.skillId === "repair_drones" && effect.targetSeat === "A"), "repair effect active");

for (let i = 0; i < Math.ceil(8 / TICK_DT); i += 1) {
  state = stepSkillEffects(state, sim);
}
assert(targetShip.hp > targetShip.maxHp * 0.64, "repair drone should heal over duration");
assert(!state.activeSkillEffects.some((effect) => effect.skillId === "repair_drones"), "repair effect cleans up after duration");

state.alliances.A.skillSlot = { skillId: "short_warp", acquiredAt: state.elapsed };
const warpTooFar = useTerritoryTacticalSkill({
  modeState: state,
  simulation: sim,
  seat: "A",
  action: { type: "use_tactical_skill", targetType: "point", targetSeat: "A", targetX: targetShip.x + 500, targetY: targetShip.y },
});
assert(!warpTooFar.accepted, "short warp max distance enforced");
const warpOk = useTerritoryTacticalSkill({
  modeState: state,
  simulation: sim,
  seat: "A",
  action: { type: "use_tactical_skill", targetType: "point", targetSeat: "A", targetX: targetShip.x + 120, targetY: targetShip.y },
});
assert(warpOk.accepted, "short warp accepted within range");
assert(Math.abs(targetShip.x - (warpOk.events[0].position.x)) < 80, "warp moves target fleet near destination");

state = makeState(918);
sim = makeSimulation();
const deadWarpMain = sim.fleetBySeat("A").shipByKey("main");
const livingWarpSub = sim.fleetBySeat("A").shipByKey("sub1");
deadWarpMain.alive = false;
deadWarpMain.hp = 0;
deadWarpMain.x = 100;
deadWarpMain.y = 100;
livingWarpSub.x = 600;
livingWarpSub.y = 600;
state.alliances.A.skillSlot = { skillId: "short_warp", acquiredAt: state.elapsed };
const livingAnchorWarp = useTerritoryTacticalSkill({
  modeState: state,
  simulation: sim,
  seat: "A",
  action: { type: "use_tactical_skill", targetType: "point", targetSeat: "A", targetX: 720, targetY: 600 },
});
assert(livingAnchorWarp.accepted, "short warp should use the first living ship when the flagship is dead");
assert(livingWarpSub.x === 720 && livingWarpSub.y === 600, "short warp should land its living anchor exactly on the selected point");

state = makeState(920);
sim = makeSimulation();
const protectedWarpShip = sim.fleetBySeat("A").shipByKey("main");
protectedWarpShip.spawnProtectionUntil = 99;
state.alliances.A.skillSlot = { skillId: "short_warp", acquiredAt: state.elapsed };
const protectedInvalidWarp = stellarTerritoryMode.handleAction({
  action: { type: "use_tactical_skill", targetSeat: "A", targetX: -10, targetY: protectedWarpShip.y },
  seat: "A",
  simulation: sim,
  modeState: state,
});
assert(!protectedInvalidWarp.accepted, "invalid short warp should remain rejected through mode action handling");
assert(protectedWarpShip.spawnProtectionUntil === 99, "rejected tactical target should not clear respawn protection");
const protectedValidWarp = stellarTerritoryMode.handleAction({
  action: { type: "use_tactical_skill", targetSeat: "A", targetX: protectedWarpShip.x + 100, targetY: protectedWarpShip.y },
  seat: "A",
  simulation: sim,
  modeState: state,
});
assert(protectedValidWarp.accepted, "valid short warp should be accepted through mode action handling");
assert(protectedWarpShip.spawnProtectionUntil === 0, "accepted tactical skill should clear respawn protection");

state = makeState(919);
state.alliances.A.skillSlot = { skillId: "all_fleet_shield", acquiredAt: 0 };
sim = makeSimulation();
const shieldUse = stellarTerritoryMode.handleAction({
  action: { type: "use_tactical_skill", targetType: "none" },
  seat: "A",
  simulation: sim,
  modeState: state,
});
assert(shieldUse.handled && shieldUse.accepted, "mode handleAction uses same tactical skill interface");
const shieldedShip = sim.fleetBySeat("A").shipByKey("main");
const shieldedHp = shieldedShip.hp;
assert(shieldedShip.territoryShield > 0, "all fleet shield grants temporary shield");
shieldedShip.takeDamage(shieldedShip.territoryShield * 0.5, null, sim, false);
assert(shieldedShip.hp === shieldedHp, "temporary shield absorbs damage before hull");
state = shieldUse.modeState;
for (let i = 0; i < Math.ceil(8 / TICK_DT); i += 1) {
  state = stepSkillEffects(state, sim);
}
assert(!shieldedShip.territoryShield, "temporary shield clears after duration");

state = makeState(1019);
sim = makeSimulation();
state.alliances.A.skillSlot = { skillId: "all_fleet_shield", acquiredAt: 0 };
const firstOverlappingShield = useTerritoryTacticalSkill({
  modeState: state,
  simulation: sim,
  seat: "A",
  action: { type: "use_tactical_skill", targetType: "none" },
});
state = { ...firstOverlappingShield.modeState, elapsed: 1 };
state.alliances.A.skillSlot = { skillId: "all_fleet_shield", acquiredAt: 1 };
const secondOverlappingShield = useTerritoryTacticalSkill({
  modeState: state,
  simulation: sim,
  seat: "A",
  action: { type: "use_tactical_skill", targetType: "none" },
});
state = secondOverlappingShield.modeState;
const overlappingShieldedShip = sim.fleetBySeat("A").shipByKey("main");
const overlappingShieldAmount = overlappingShieldedShip.territoryShield;
assert(state.activeSkillEffects.filter((effect) => effect.skillId === "all_fleet_shield").length === 2, "overlapping shield fixture should contain two active effects");
state = updateTerritorySkillEffects({ modeState: { ...state, elapsed: 8 }, simulation: sim, dt: 7, now: 8 }).modeState;
assert(state.activeSkillEffects.filter((effect) => effect.skillId === "all_fleet_shield").length === 1, "first overlapping shield should expire while the second remains");
assert(overlappingShieldedShip.territoryShield === overlappingShieldAmount, "expiring one overlapping shield must not clear the still-active alliance shield");
state = updateTerritorySkillEffects({ modeState: { ...state, elapsed: 9 }, simulation: sim, dt: 1, now: 9 }).modeState;
assert(!overlappingShieldedShip.territoryShield, "alliance shield should clear after the final overlapping effect expires");

state = makeState(1020);
sim = makeSimulation();
const propelledShip = sim.fleetBySeat("A").shipByKey("main");
const basePropulsionSpeed = propelledShip.baseSpeed();
const basePropulsionTurn = propelledShip.baseTurnRate();
state.alliances.A.skillSlot = { skillId: "propulsion_overload", acquiredAt: 0 };
const propulsionUse = useTerritoryTacticalSkill({
  modeState: state,
  simulation: sim,
  seat: "A",
  action: { type: "use_tactical_skill", targetType: "none" },
});
state = propulsionUse.modeState;
state = stepSkillEffects(state, sim);
assert(propelledShip.baseSpeed() > basePropulsionSpeed * 1.17, "propulsion overload increases allied speed");
assert(propelledShip.baseTurnRate() > basePropulsionTurn * 1.12, "propulsion overload increases allied turn rate");
for (let i = 0; i < Math.ceil(8 / TICK_DT); i += 1) {
  state = stepSkillEffects(state, sim);
}
assert(Math.abs(propelledShip.baseSpeed() - basePropulsionSpeed) < 1e-6, "propulsion overload clears after duration");

state = makeState(1030);
sim = makeSimulation();
const fireShip = sim.fleetBySeat("A").shipByKey("main");
const baseDamage = fireShip.effectiveDamage();
const baseMoveDrain = fireShip.moveEnergyDrain();
state.alliances.A.skillSlot = { skillId: "firepower_overload", acquiredAt: 0 };
const fireUse = useTerritoryTacticalSkill({
  modeState: state,
  simulation: sim,
  seat: "A",
  action: { type: "use_tactical_skill", targetType: "none" },
});
state = fireUse.modeState;
state = stepSkillEffects(state, sim);
assert(fireShip.effectiveDamage() > baseDamage * 1.2, "firepower overload increases allied damage");
assert(fireShip.moveEnergyDrain() > baseMoveDrain * 1.2, "firepower overload increases movement energy drain");
for (let i = 0; i < Math.ceil(7 / TICK_DT); i += 1) {
  state = stepSkillEffects(state, sim);
}
assert(Math.abs(fireShip.effectiveDamage() - baseDamage) < 1e-6, "firepower overload clears after duration");

console.log("territory skill verification passed");
