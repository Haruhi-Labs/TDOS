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

assert(ALLOWED_TACTICAL_SKILLS.length >= 6, "at least six active tactical skills required");
for (const skill of ALLOWED_TACTICAL_SKILLS) {
  const blob = `${skill.id} ${skill.name} ${skill.description || ""}`.toLowerCase();
  for (const term of FORBIDDEN_SCOUT_SKILL_TERMS) {
    assert(!blob.includes(term.toLowerCase()), `forbidden scout-like skill term ${term} in ${skill.id}`);
  }
}
assert(ALLOWED_TACTICAL_SKILLS.every((skill) => skill.type === "active"), "all tactical skills must be active");

let state = makeState(818);
let events = [];
for (let i = 0; i < Math.ceil(70 / TICK_DT); i += 1) {
  const result = updateTerritorySkillLifecycle({
    modeState: state,
    dt: TICK_DT,
    simulation: null,
    parameters: stellarTerritoryMode.defaultParameters,
  });
  state = result.modeState;
  events.push(...result.events);
}
assert(events.some((event) => event.type === "skill_warning"), "skill warning should appear before spawn");
assert(events.some((event) => event.type === "skill_spawned"), "skill pickup should spawn");
assert(state.skillPickups.length > 0, "skill pickup should be stored");
assert(Math.abs(state.skillPickups[0].expiresAt - state.skillPickups[0].spawnedAt - 35) < 1e-6, "skill pickup lifetime should be 35 seconds");

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
    expiresAt: 35,
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
state = updateTerritorySkillEffects({ modeState: state, simulation: sim, dt: TICK_DT }).modeState;
assert(gravityShip.baseSpeed() < normalGravitySpeed * 0.72, "gravity field slows ships in radius");
assert(gravityShip.baseTurnRate() < normalGravityTurn * 0.82, "gravity field reduces turn rate in radius");
for (let i = 0; i < Math.ceil(9 / TICK_DT); i += 1) {
  state = updateTerritorySkillEffects({ modeState: state, simulation: sim, dt: TICK_DT }).modeState;
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
  state = updateTerritorySkillEffects({ modeState: state, simulation: sim, dt: TICK_DT }).modeState;
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
  state = updateTerritorySkillEffects({ modeState: state, simulation: sim, dt: TICK_DT }).modeState;
}
assert(!shieldedShip.territoryShield, "temporary shield clears after duration");

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
state = updateTerritorySkillEffects({ modeState: state, simulation: sim, dt: TICK_DT }).modeState;
assert(propelledShip.baseSpeed() > basePropulsionSpeed * 1.17, "propulsion overload increases allied speed");
assert(propelledShip.baseTurnRate() > basePropulsionTurn * 1.12, "propulsion overload increases allied turn rate");
for (let i = 0; i < Math.ceil(8 / TICK_DT); i += 1) {
  state = updateTerritorySkillEffects({ modeState: state, simulation: sim, dt: TICK_DT }).modeState;
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
state = updateTerritorySkillEffects({ modeState: state, simulation: sim, dt: TICK_DT }).modeState;
assert(fireShip.effectiveDamage() > baseDamage * 1.2, "firepower overload increases allied damage");
assert(fireShip.moveEnergyDrain() > baseMoveDrain * 1.2, "firepower overload increases movement energy drain");
for (let i = 0; i < Math.ceil(7 / TICK_DT); i += 1) {
  state = updateTerritorySkillEffects({ modeState: state, simulation: sim, dt: TICK_DT }).modeState;
}
assert(Math.abs(fireShip.effectiveDamage() - baseDamage) < 1e-6, "firepower overload clears after duration");

console.log("territory skill verification passed");
