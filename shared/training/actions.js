import { skillMetaForCharacter } from "../game/characters.js";
import {
  EMERGENCY_BRAKE_COST,
  SCOUT_LAUNCH_COST,
} from "../game/combat-rules.js";
import { throttleForGear } from "../game/throttle.js";
import { matchActions } from "../protocol/match-actions.js";

export const RL_ACTION_SCHEMA_VERSION = 2;
export const RL_NAVIGATION_MODES = Object.freeze(["hold", "route", "clear"]);
export const RL_GEAR_COUNT = 5;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function bool(value) {
  return value === true || value === 1;
}

function activeSkill(meta) {
  return Boolean(meta && meta.type === "active");
}

function skillParameterMask(meta) {
  const target = String(meta?.target || "none");
  return {
    point: target === "point" || target === "optional_point",
    zone: target === "zone",
  };
}

function enoughEnergy(team, ship, cost) {
  return team.availableEnergyForShip(ship) + 1e-9 >= Math.max(0, finite(cost));
}

function canCastFlagship(team) {
  const main = team.ships.main;
  const meta = skillMetaForCharacter(team.mainCharacterId(), "flagship");
  return Boolean(
    main?.alive
    && activeSkill(meta)
    && !team.areSkillsDisabled()
    && team.cooldowns.flagship <= 0
    && enoughEnergy(team, main, meta.cost),
  );
}

function canCastSubSkill(team, ship) {
  const meta = skillMetaForCharacter(ship.characterId, "sub");
  return Boolean(
    ship.alive
    && ship.key !== "main"
    && !ship.isAttached()
    && activeSkill(meta)
    && !team.areSkillsDisabled()
    && (team.cooldowns[ship.key] || 0) <= 0
    && enoughEnergy(team, ship, meta.cost),
  );
}

function shipActionMask(team, ship) {
  const controllable = ship.alive && ship.canControl();
  const subSkill = skillMetaForCharacter(ship.characterId, "sub");
  const subSkillParameters = skillParameterMask(subSkill);
  return {
    entityId: ship.id,
    controlKey: String(ship.key || ship.slotKey || ""),
    navigation: [true, controllable, controllable && Boolean(ship.route)],
    setGear: controllable,
    gear: Array.from({ length: RL_GEAR_COUNT }, () => controllable),
    emergencyBrake: Boolean(
      controllable
      && !ship.isAttached()
      && (ship.effects.brakeCooldownUntil || 0) <= team.match.elapsed
      && enoughEnergy(team, ship, EMERGENCY_BRAKE_COST),
    ),
    castSubSkill: canCastSubSkill(team, ship),
    subSkillPoint: subSkillParameters.point,
    subSkillZone: subSkillParameters.zone,
  };
}

/** 动作掩码只编码权威规则中的合法性，不包含收益、目标价值或角色策略。 */
export function buildRlActionMask(simulation, seat) {
  if (!simulation || (seat !== "A" && seat !== "B")) {
    throw new TypeError("强化学习动作掩码需要有效的模拟器与席位");
  }
  const team = simulation.teamBySeat(seat);
  const ships = team.getPlayerShips();
  const scoutReady = !team.areScoutsDisabled() && team.cooldowns.scout <= 0;
  const flagshipParameters = skillParameterMask(
    skillMetaForCharacter(team.mainCharacterId(), "flagship"),
  );
  return {
    schemaVersion: RL_ACTION_SCHEMA_VERSION,
    ships: ships.map((ship) => shipActionMask(team, ship)),
    split: [
      true,
      team.splitLevel === 0 && team.ships.sub1.alive,
      team.splitLevel === 1 && team.ships.sub2.alive,
    ],
    scout: {
      launch: scoutReady && ships.some((ship) => ship.alive && enoughEnergy(team, ship, SCOUT_LAUNCH_COST)),
      sourceShips: ships.map((ship) => scoutReady && ship.alive && enoughEnergy(team, ship, SCOUT_LAUNCH_COST)),
      zones: Array.from({ length: 9 }, () => true),
    },
    flagshipSkill: {
      cast: canCastFlagship(team),
      point: flagshipParameters.point,
      zone: flagshipParameters.zone,
    },
  };
}

function worldPoint(simulation, normalized = {}) {
  const padding = Math.max(0, finite(simulation.mapPadding));
  const span = Math.max(0, finite(simulation.worldSize) - padding * 2);
  return {
    x: padding + (clamp(finite(normalized.x), -1, 1) + 1) * 0.5 * span,
    y: padding + (clamp(finite(normalized.y), -1, 1) + 1) * 0.5 * span,
  };
}

function zoneId(value) {
  return clamp(Math.round(finite(value, 5)), 1, 9);
}

function navigationMode(value) {
  if (typeof value === "string") {
    const index = RL_NAVIGATION_MODES.indexOf(value);
    return index >= 0 ? index : 0;
  }
  return clamp(Math.round(finite(value)), 0, RL_NAVIGATION_MODES.length - 1);
}

function shipCommandActions(simulation, ship, command, mask) {
  if (!command || !ship || !mask) return [];
  const actions = [];
  const mode = navigationMode(command.navigation);
  const gear = clamp(Math.round(finite(command.gear, 3)), 0, RL_GEAR_COUNT - 1);
  if (mode === 1 && mask.navigation[1]) {
    const end = worldPoint(simulation, command.end);
    const control = worldPoint(simulation, command.control);
    actions.push(matchActions.setRoute({
      shipKey: ship.key,
      endX: end.x,
      endY: end.y,
      controlX: control.x,
      controlY: control.y,
      throttle: throttleForGear(gear),
      anchorToMain: ship.key === "main",
    }));
  } else if (mode === 2 && mask.navigation[2]) {
    actions.push(matchActions.clearRoute(ship.key));
  } else if (bool(command.setGear) && mask.setGear && mask.gear[gear]) {
    actions.push(matchActions.setThrottle({ shipKey: ship.key, throttle: throttleForGear(gear) }));
  }

  if (bool(command.emergencyBrake) && mask.emergencyBrake) {
    actions.push(matchActions.emergencyBrake(ship.key));
  }
  if (bool(command.castSubSkill) && mask.castSubSkill) {
    const target = worldPoint(simulation, command.skillTarget);
    actions.push(matchActions.castSubSkill({
      shipKey: ship.key,
      targetX: target.x,
      targetY: target.y,
      zoneId: zoneId(command.skillZone),
    }));
  }
  return actions;
}

/**
 * 把通用、角色无关的策略输出解码为现有权威动作。策略始终输出点和战区，
 * 具体技能会由现有规则自行使用需要的参数，解码层不编写角色战术。
 */
export function decodeRlAction(simulation, seat, policyAction = {}) {
  const team = simulation.teamBySeat(seat);
  const ships = team.getPlayerShips();
  const mask = buildRlActionMask(simulation, seat);
  const commands = Array.isArray(policyAction.ships) ? policyAction.ships : [];
  const actions = [];

  for (let index = 0; index < ships.length; index += 1) {
    actions.push(...shipCommandActions(simulation, ships[index], commands[index], mask.ships[index]));
  }

  const split = clamp(Math.round(finite(policyAction.split)), 0, 2);
  if (split > 0 && mask.split[split]) {
    actions.push(matchActions.split(split));
  }

  const scout = policyAction.scout || {};
  const sourceIndex = clamp(Math.round(finite(scout.sourceShip)), 0, ships.length - 1);
  if (bool(scout.launch) && mask.scout.launch && mask.scout.sourceShips[sourceIndex]) {
    actions.push(matchActions.launchScout({
      shipKey: ships[sourceIndex].key,
      zoneId: zoneId(scout.zone),
    }));
  }

  const flagship = policyAction.flagshipSkill || {};
  if (bool(flagship.cast) && mask.flagshipSkill.cast) {
    actions.push(matchActions.castFlagshipSkill(zoneId(flagship.zone)));
  }
  return actions;
}

/** 同一决策 tick 内按既有权威入口顺序执行组合动作，并返回逐项结果。 */
export function applyRlAction(simulation, seat, policyAction = {}) {
  const actions = decodeRlAction(simulation, seat, policyAction);
  return actions.map((action) => ({
    action,
    accepted: simulation.applyActionForSeat(seat, action),
  }));
}
