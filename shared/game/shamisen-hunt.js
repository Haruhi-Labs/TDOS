import { isAttackDamageKind } from "./damage.js";

export const SHAMISEN_HUNT_DAMAGE_MULTIPLIER = 2;
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
  return (enemyTeam?.getAllShips?.() || []).filter((ship) => ship?.alive);
}

export function selectShamisenHuntTarget(team, enemyTeam, random = Math.random) {
  if (!team?.shamisenHunt || !hasShamisenFlagship(team)) {
    return null;
  }
  const candidates = livingHuntTargets(enemyTeam);
  if (!candidates.length) {
    team.shamisenHunt.targetId = null;
    return null;
  }
  const roll = Math.max(0, Math.min(0.999999, Number(random()) || 0));
  const target = candidates[Math.floor(roll * candidates.length)];
  team.shamisenHunt.targetId = target.id;
  team.shamisenHunt.sequence += 1;
  return target;
}

export function ensureShamisenHuntTarget(team, enemyTeam, random = Math.random) {
  if (!hasShamisenFlagship(team)) {
    if (team?.shamisenHunt) team.shamisenHunt.targetId = null;
    return null;
  }
  const currentId = team.shamisenHunt?.targetId;
  const current = livingHuntTargets(enemyTeam).find((ship) => ship.id === currentId);
  return current || selectShamisenHuntTarget(team, enemyTeam, random);
}

export function isShamisenHuntTarget(team, target) {
  return Boolean(
    hasShamisenFlagship(team)
      && target?.alive
      && team.shamisenHunt?.targetId === target.id,
  );
}

// 只放大子弹与其命中触发的攻击特效；技能、状态效果和碰撞即使带有攻击方来源也不增幅。
// 编队分摊的递归伤害由承伤入口保证不再次乘二。
export function shamisenHuntDamageMultiplier(source, target, damageKind = null) {
  const sourceTeam = source?.team || source;
  return isAttackDamageKind(damageKind) && isShamisenHuntTarget(sourceTeam, target)
    ? SHAMISEN_HUNT_DAMAGE_MULTIPLIER
    : 1;
}

export function resolveShamisenHuntKill(team, enemyTeam, destroyedShip, random = Math.random) {
  if (!team?.shamisenHunt || team.shamisenHunt.targetId !== destroyedShip?.id) {
    return null;
  }
  team.shamisenHunt.targetId = null;
  return selectShamisenHuntTarget(team, enemyTeam, random);
}

export function serializeShamisenHunt(team) {
  return {
    targetId: Number.isFinite(team?.shamisenHunt?.targetId)
      ? team.shamisenHunt.targetId
      : null,
    sequence: Math.max(0, Number(team?.shamisenHunt?.sequence) || 0),
    damageMultiplier: SHAMISEN_HUNT_DAMAGE_MULTIPLIER,
  };
}
