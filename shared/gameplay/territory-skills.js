import { clamp } from "../game-core.js";
import { createSeededRng } from "./seeded-rng.js";

export const FORBIDDEN_SCOUT_SKILL_TERMS = Object.freeze([
  "scan",
  "radar",
  "reveal",
  "vision",
  "track",
  "scout",
  "侦察",
  "扫描",
  "雷达",
  "视野",
]);

export const ALLOWED_TACTICAL_SKILLS = Object.freeze([
  Object.freeze({
    id: "all_fleet_shield",
    name: "全舰护盾",
    type: "active",
    targetType: "none",
    duration: 8,
    description: "己方所有存活基础舰船获得最大舰体12%的临时护盾。",
  }),
  Object.freeze({
    id: "propulsion_overload",
    name: "推进过载",
    type: "active",
    targetType: "none",
    duration: 8,
    description: "己方所有存活舰船航速和转向短时提升。",
  }),
  Object.freeze({
    id: "firepower_overload",
    name: "火力过载",
    type: "active",
    targetType: "none",
    duration: 7,
    description: "己方所有存活舰船伤害提高，能量消耗提高。",
  }),
  Object.freeze({
    id: "short_warp",
    name: "短程跃迁",
    type: "active",
    targetType: "point",
    duration: 0,
    maxDistance: 260,
    description: "选择己方一支存活编队整体跃迁到指定位置。",
  }),
  Object.freeze({
    id: "gravity_field",
    name: "引力场",
    type: "active",
    targetType: "point",
    duration: 9,
    radius: 170,
    description: "指定位置生成减速场，区域内双方移动受限。",
  }),
  Object.freeze({
    id: "repair_drones",
    name: "紧急维修无人机",
    type: "active",
    targetType: "fleet",
    duration: 8,
    description: "选择己方一支存活编队，在持续时间内恢复舰体。",
  }),
]);

const SKILL_PICKUP_LIFETIME_SECONDS = 35;
const SKILL_WARNING_SECONDS = 8;
const SKILL_SPAWN_INTERVAL = Object.freeze({ min: 45, max: 65 });
const SKILL_PICKUP_RADIUS = 30;
const SKILL_MODIFIER_SOURCE = "territory-skills";

const SKILL_ENVIRONMENT_MODIFIERS = Object.freeze({
  propulsion_overload: Object.freeze({
    speedMultiplier: 1.22,
    accelerationMultiplier: 1.18,
    turnMultiplier: 1.16,
  }),
  firepower_overload: Object.freeze({
    damageMultiplier: 1.28,
    moveEnergyDrainMultiplier: 1.3,
  }),
  gravity_field: Object.freeze({
    speedMultiplier: 0.68,
    accelerationMultiplier: 0.72,
    turnMultiplier: 0.78,
  }),
});

const SKILL_BY_ID = new Map(ALLOWED_TACTICAL_SKILLS.map((skill) => [skill.id, skill]));

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function distance(a, b) {
  const dx = Number(a?.x || 0) - Number(b?.x || 0);
  const dy = Number(a?.y || 0) - Number(b?.y || 0);
  return Math.hypot(dx, dy);
}

function allianceIdForSeat(seat) {
  return String(seat || "A").toUpperCase().startsWith("B") ? "B" : "A";
}

function inWorld(point, simulation) {
  const size = Number(simulation?.worldSize) || 1440;
  return Number(point?.x) >= 0 && Number(point?.y) >= 0 && point.x <= size && point.y <= size;
}

function skillRuntime(modeState) {
  if (!modeState.skillRuntime) {
    const seed = createSeededRng(modeState.seed || 0).fork("skill");
    modeState.skillRuntime = {
      seed: seed.seed,
      nextSkillAt: seed.nextInt(SKILL_SPAWN_INTERVAL.min, SKILL_SPAWN_INTERVAL.max),
      warned: false,
      spawnSequence: 0,
      nodeSequence: 0,
      bagSequence: 0,
      bag: [],
    };
  }
  return modeState.skillRuntime;
}

function makeSkillBag(runtime) {
  const rng = createSeededRng(runtime.seed).fork(`skill-bag:${runtime.bagSequence || 0}`);
  runtime.bagSequence = (runtime.bagSequence || 0) + 1;
  return rng.shuffle(ALLOWED_TACTICAL_SKILLS.map((skill) => skill.id));
}

function drawSkillId(runtime) {
  if (!runtime.bag?.length) runtime.bag = makeSkillBag(runtime);
  return runtime.bag.shift();
}

function chooseSkillNode(modeState, runtime, nodeId = null) {
  const nodes = modeState.map?.skillSpawnNodes || [];
  if (nodeId) return nodes.find((node) => node.id === nodeId) || null;
  if (!nodes.length) return null;
  const occupied = new Set((modeState.skillPickups || []).map((pickup) => pickup.nodeId));
  const rng = createSeededRng(runtime.seed).fork(`skill-node:${runtime.nodeSequence || 0}`);
  runtime.nodeSequence = (runtime.nodeSequence || 0) + 1;
  return rng.shuffle(nodes).find((node) => !occupied.has(node.id)) || null;
}

function skillEvent(type, pickup, extra = {}) {
  return {
    type,
    position: pickup?.position ? { ...pickup.position } : null,
    payload: {
      pickupId: pickup?.id || null,
      skillId: pickup?.skillId || null,
      nodeId: pickup?.nodeId || null,
      ...extra,
    },
  };
}

export function spawnTerritorySkillPickup({ modeState, skillId = null, nodeId = null } = {}) {
  const next = cloneJson(modeState);
  const runtime = skillRuntime(next);
  const node = chooseSkillNode(next, runtime, nodeId);
  if (!node) return { modeState: next, pickups: [], events: [] };
  const safeSkillId = SKILL_BY_ID.has(skillId) ? skillId : drawSkillId(runtime);
  runtime.spawnSequence += 1;
  const pickup = {
    id: `skill-${runtime.spawnSequence}`,
    skillId: safeSkillId,
    nodeId: node.id,
    position: { ...node.center },
    radius: SKILL_PICKUP_RADIUS,
    spawnedAt: Number(next.elapsed) || 0,
    expiresAt: (Number(next.elapsed) || 0) + SKILL_PICKUP_LIFETIME_SECONDS,
  };
  next.skillPickups = [...(next.skillPickups || []), pickup];
  return { modeState: next, pickups: [pickup], events: [skillEvent("skill_spawned", pickup)] };
}

function scheduleNextSkill(runtime, now) {
  const rng = createSeededRng(runtime.seed).fork(`skill-interval:${runtime.spawnSequence}:${now}`);
  runtime.nextSkillAt = now + rng.nextInt(SKILL_SPAWN_INTERVAL.min, SKILL_SPAWN_INTERVAL.max);
  runtime.warned = false;
}

export function updateTerritorySkillLifecycle({ modeState, dt } = {}) {
  const next = cloneJson(modeState);
  next.elapsed = Number(next.elapsed || 0) + Math.max(0, Number(dt) || 0);
  const runtime = skillRuntime(next);
  const events = [];
  const now = Number(next.elapsed) || 0;
  const remaining = [];
  for (const pickup of next.skillPickups || []) {
    if (now >= Number(pickup.expiresAt)) events.push(skillEvent("skill_expired", pickup));
    else remaining.push(pickup);
  }
  next.skillPickups = remaining;
  if (!runtime.warned && now + SKILL_WARNING_SECONDS >= runtime.nextSkillAt) {
    events.push(skillEvent("skill_warning", null, { spawnAt: runtime.nextSkillAt }));
    runtime.warned = true;
  }
  if (now + 1e-9 >= runtime.nextSkillAt) {
    const spawned = spawnTerritorySkillPickup({ modeState: next });
    next.skillPickups = spawned.modeState.skillPickups;
    next.skillRuntime = spawned.modeState.skillRuntime;
    events.push(...spawned.events);
    scheduleNextSkill(next.skillRuntime, now);
  }
  next.spawnTimers = {
    ...(next.spawnTimers || {}),
    nextSkillAt: runtime.nextSkillAt,
  };
  return { modeState: next, events };
}

function skillContactCandidates(pickup, simulation) {
  const out = [];
  for (const seat of simulation?.fleetSeats || ["A", "B"]) {
    const fleet = simulation?.fleetBySeat?.(seat);
    for (const ship of Object.values(fleet?.ships || {})) {
      if (!ship?.alive) continue;
      const d = distance(pickup.position, ship);
      if (d <= (pickup.radius || SKILL_PICKUP_RADIUS) + (ship.radius || 0)) {
        out.push({ seat, shipKey: ship.key, shipId: ship.id, distance: d });
      }
    }
  }
  return out.sort((a, b) => a.distance - b.distance || String(a.shipId).localeCompare(String(b.shipId)));
}

export function collectTerritorySkillPickups({ modeState, simulation } = {}) {
  const next = cloneJson(modeState);
  const events = [];
  const remaining = [];
  for (const pickup of next.skillPickups || []) {
    const winner = skillContactCandidates(pickup, simulation)[0];
    if (!winner) {
      remaining.push(pickup);
      continue;
    }
    const allianceId = allianceIdForSeat(winner.seat);
    const previous = next.alliances?.[allianceId]?.skillSlot || null;
    next.alliances[allianceId].skillSlot = {
      skillId: pickup.skillId,
      acquiredAt: Number(next.elapsed) || 0,
      pickupId: pickup.id,
    };
    if (previous) {
      events.push(skillEvent("skill_replaced", pickup, { allianceId, previousSkillId: previous.skillId }));
    }
    events.push({
      ...skillEvent("skill_collected", pickup),
      allianceId,
      seat: winner.seat,
      payload: {
        pickupId: pickup.id,
        skillId: pickup.skillId,
        nodeId: pickup.nodeId,
        shipKey: winner.shipKey,
      },
    });
  }
  next.skillPickups = remaining;
  return { modeState: next, events };
}

function ownFleetForAction(simulation, seat, action) {
  const targetSeat = action.targetSeat || seat;
  if (allianceIdForSeat(targetSeat) !== allianceIdForSeat(seat)) return null;
  return simulation?.fleetBySeat?.(targetSeat) || null;
}

function livingBasicShips(fleet) {
  return Object.values(fleet?.ships || {}).filter((ship) => ship?.alive);
}

function validateTarget(skill, modeState, simulation, seat, action) {
  if (!skill) return { ok: false, reason: "missing_skill" };
  if (skill.targetType === "none") return { ok: true };
  if (skill.targetType === "point") {
    const point = { x: Number(action.targetX), y: Number(action.targetY) };
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !inWorld(point, simulation)) {
      return { ok: false, reason: "invalid_point" };
    }
    if (skill.id === "short_warp") {
      const fleet = ownFleetForAction(simulation, seat, action);
      const main = fleet?.shipByKey?.("main") || livingBasicShips(fleet)[0];
      if (!main) return { ok: false, reason: "target_fleet_dead" };
      if (distance(main, point) > (skill.maxDistance || 260)) return { ok: false, reason: "range" };
    }
    return { ok: true };
  }
  if (skill.targetType === "fleet") {
    const fleet = ownFleetForAction(simulation, seat, action);
    if (!fleet || livingBasicShips(fleet).length === 0) return { ok: false, reason: "invalid_fleet" };
    return { ok: true };
  }
  return { ok: false, reason: "unsupported_target" };
}

function addEffect(next, skill, seat, action, payload = {}) {
  const now = Number(next.elapsed) || 0;
  if (!skill.duration) return null;
  const effect = {
    id: `skill-effect-${(next.skillEffectSequence || 0) + 1}`,
    skillId: skill.id,
    allianceId: allianceIdForSeat(seat),
    seat,
    targetSeat: action.targetSeat || null,
    position: Number.isFinite(Number(action.targetX)) ? { x: Number(action.targetX), y: Number(action.targetY) } : null,
    startedAt: now,
    duration: skill.duration,
    endsAt: now + skill.duration,
    payload,
  };
  next.skillEffectSequence = (next.skillEffectSequence || 0) + 1;
  next.activeSkillEffects = [...(next.activeSkillEffects || []), effect];
  return effect;
}

function applyImmediateSkillEffect(skill, next, simulation, seat, action) {
  const allianceId = allianceIdForSeat(seat);
  const alliedFleets = simulation?.fleetsForAlliance?.(allianceId) || [];
  if (skill.id === "all_fleet_shield") {
    for (const fleet of alliedFleets) {
      for (const ship of livingBasicShips(fleet)) {
        ship.territoryShield = Math.max(Number(ship.territoryShield || 0), ship.maxHp * 0.12);
      }
    }
    return addEffect(next, skill, seat, action);
  }
  if (skill.id === "gravity_field") {
    return addEffect(next, skill, seat, action, { radius: skill.radius || 170 });
  }
  if (skill.id === "propulsion_overload" || skill.id === "firepower_overload") {
    return addEffect(next, skill, seat, action);
  }
  if (skill.id === "repair_drones") {
    return addEffect(next, skill, seat, action, { healedRatio: 0 });
  }
  if (skill.id === "short_warp") {
    const fleet = ownFleetForAction(simulation, seat, action);
    const ships = livingBasicShips(fleet);
    if (!ships.length) return null;
    const anchor = fleet.shipByKey?.("main") || ships[0];
    const dx = Number(action.targetX) - anchor.x;
    const dy = Number(action.targetY) - anchor.y;
    const size = Number(simulation?.worldSize) || 1440;
    for (const ship of ships) {
      ship.x = clamp(ship.x + dx, 8, size - 8);
      ship.y = clamp(ship.y + dy, 8, size - 8);
      ship.command.x = ship.x;
      ship.command.y = ship.y;
      ship.route = null;
    }
    return null;
  }
  return null;
}

export function useTerritoryTacticalSkill({ modeState, simulation, seat, action } = {}) {
  const allianceId = allianceIdForSeat(seat);
  const slot = modeState?.alliances?.[allianceId]?.skillSlot;
  const skill = SKILL_BY_ID.get(slot?.skillId);
  const validation = validateTarget(skill, modeState, simulation, seat, action || {});
  if (!slot || !skill || !validation.ok) {
    return { accepted: false, modeState, events: [], reason: validation.reason || "no_skill" };
  }
  const next = cloneJson(modeState);
  next.alliances[allianceId].skillSlot = null;
  const effect = applyImmediateSkillEffect(skill, next, simulation, seat, action || {});
  return {
    accepted: true,
    modeState: next,
    events: [
      {
        type: "skill_used",
        position: effect?.position || (Number.isFinite(Number(action?.targetX)) ? { x: Number(action.targetX), y: Number(action.targetY) } : null),
        allianceId,
        seat,
        payload: {
          skillId: skill.id,
          targetType: skill.targetType,
          targetSeat: action?.targetSeat || null,
          effectId: effect?.id || null,
        },
      },
    ],
  };
}

function updateRepairDrone(effect, simulation, dt) {
  const fleet = simulation?.fleetBySeat?.(effect.targetSeat);
  const ships = livingBasicShips(fleet);
  const ratio = 0.15 * (Math.max(0, Number(dt) || 0) / Math.max(0.1, effect.duration || 8));
  for (const ship of ships) {
    ship.hp = Math.min(ship.maxHp, ship.hp + ship.maxHp * ratio);
  }
}

function composeEnvironmentModifier(a, b) {
  return {
    speedMultiplier: (a.speedMultiplier || 1) * (b.speedMultiplier || 1),
    accelerationMultiplier: (a.accelerationMultiplier || 1) * (b.accelerationMultiplier || 1),
    turnMultiplier: (a.turnMultiplier || 1) * (b.turnMultiplier || 1),
    damageMultiplier: (a.damageMultiplier || 1) * (b.damageMultiplier || 1),
    moveEnergyDrainMultiplier: (a.moveEnergyDrainMultiplier || 1) * (b.moveEnergyDrainMultiplier || 1),
  };
}

function modifierAppliesToShip(effect, seat, ship) {
  if (!ship?.alive) return false;
  if (effect.skillId === "propulsion_overload" || effect.skillId === "firepower_overload") {
    return allianceIdForSeat(seat) === effect.allianceId;
  }
  if (effect.skillId === "gravity_field") {
    return effect.position && distance(effect.position, ship) <= Number(effect.payload?.radius || 170);
  }
  return false;
}

function clearExpiredShield(effect, simulation) {
  if (effect.skillId !== "all_fleet_shield") return;
  const fleets = simulation?.fleetsForAlliance?.(effect.allianceId) || [];
  for (const fleet of fleets) {
    for (const ship of livingBasicShips(fleet)) {
      ship.territoryShield = 0;
    }
  }
}

export function applyTerritorySkillEnvironmentModifiers({ modeState, simulation } = {}) {
  simulation?.clearEnvironmentModifiers?.(SKILL_MODIFIER_SOURCE);
  const effects = Array.isArray(modeState?.activeSkillEffects) ? modeState.activeSkillEffects : [];
  if (!effects.length || !simulation) return false;
  for (const seat of simulation.fleetSeats || ["A", "B"]) {
    const fleet = simulation.fleetBySeat?.(seat);
    for (const ship of fleet?.getAllShips?.() || []) {
      let modifier = null;
      for (const effect of effects) {
        const effectModifier = SKILL_ENVIRONMENT_MODIFIERS[effect.skillId];
        if (!effectModifier || !modifierAppliesToShip(effect, seat, ship)) continue;
        modifier = composeEnvironmentModifier(modifier || {}, effectModifier);
      }
      if (modifier) {
        simulation.setEnvironmentModifier?.(seat, ship.key, modifier, SKILL_MODIFIER_SOURCE);
      }
    }
  }
  return true;
}

export function updateTerritorySkillEffects({ modeState, simulation, dt } = {}) {
  const next = cloneJson(modeState);
  next.elapsed = Number(next.elapsed || 0) + Math.max(0, Number(dt) || 0);
  const events = [];
  const remaining = [];
  for (const effect of next.activeSkillEffects || []) {
    if (effect.skillId === "repair_drones") {
      updateRepairDrone(effect, simulation, dt);
    }
    if (next.elapsed + 1e-9 >= Number(effect.endsAt)) {
      clearExpiredShield(effect, simulation);
      events.push({
        type: "skill_effect_ended",
        position: effect.position || null,
        allianceId: effect.allianceId || null,
        seat: effect.seat || null,
        payload: { effectId: effect.id, skillId: effect.skillId },
      });
    } else {
      remaining.push(effect);
    }
  }
  next.activeSkillEffects = remaining;
  applyTerritorySkillEnvironmentModifiers({ modeState: next, simulation });
  return { modeState: next, events };
}
