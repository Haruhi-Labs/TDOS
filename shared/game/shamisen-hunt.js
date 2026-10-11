const states = new WeakMap();

import { isAttackDamageKind } from "./damage.js";

export const SHAMISEN_HUNT_DAMAGE_MULTIPLIER = 1.5;
export const SHAMISEN_HUNT_KILL_EFFECT_SECONDS = 1.65;

export function createShamisenHuntState() {
  return {
    targetId: null,
    sequence: 0,
  };
}

export function hasShamisenFlagship(team) {
  return Boolean(team?.mainCharacterId?.() === "shamisen");
}

function livingHuntTargets(enemyTeam) {
  return (enemyTeam?.getVictoryShips?.() || []).filter((ship) => ship?.alive);
}

export function selectShamisenHuntTarget(team, enemyTeam, random = Math.random) {
  if (!states.get(team) || !hasShamisenFlagship(team)) {
    return null;
  }
  const candidates = livingHuntTargets(enemyTeam);
  if (!candidates.length) {
    states.get(team).targetId = null;
    return null;
  }
  const roll = Math.max(0, Math.min(0.999999, Number(random()) || 0));
  const target = candidates[Math.floor(roll * candidates.length)];
  states.get(team).targetId = target.id;
  states.get(team).sequence += 1;
  return target;
}

export function ensureShamisenHuntTarget(team, enemyTeam, random = Math.random) {
  if (!hasShamisenFlagship(team)) {
    if (states.get(team)) states.get(team).targetId = null;
    return null;
  }
  const currentId = states.get(team)?.targetId;
  const current = livingHuntTargets(enemyTeam).find((ship) => ship.id === currentId);
  return current || selectShamisenHuntTarget(team, enemyTeam, random);
}

export function isShamisenHuntTarget(team, target) {
  return Boolean(
    hasShamisenFlagship(team)
      && target?.alive
      && states.get(team)?.targetId === target.id,
  );
}

// 只放大子弹与其命中触发的攻击特效；技能、状态效果和碰撞即使带有攻击方来源也不增幅。
// 编队分摊的递归伤害由承伤入口保证不再次叠加猎杀倍率。
export function shamisenHuntDamageMultiplier(source, target, damageKind = null) {
  const sourceTeam = source?.team || source;
  return isAttackDamageKind(damageKind) && isShamisenHuntTarget(sourceTeam, target)
    ? SHAMISEN_HUNT_DAMAGE_MULTIPLIER
    : 1;
}

export function resolveShamisenHuntKill(team, enemyTeam, destroyedShip, random = Math.random) {
  if (!states.get(team) || states.get(team).targetId !== destroyedShip?.id) {
    return null;
  }
  states.get(team).targetId = null;
  return selectShamisenHuntTarget(team, enemyTeam, random);
}

export function serializeShamisenHunt(team) {
  return {
    targetId: Number.isFinite(states.get(team)?.targetId)
      ? states.get(team).targetId
      : null,
    sequence: Math.max(0, Number(states.get(team)?.sequence) || 0),
    damageMultiplier: SHAMISEN_HUNT_DAMAGE_MULTIPLIER,
  };
}

export function initializeShamisenHunt(team) {
  if (states.has(team)) return;
  states.set(team, createShamisenHuntState());
  Object.defineProperty(team, "shamisenHunt", { enumerable: true,
    get: () => Object.freeze({ ...states.get(team) }),
  });
}
