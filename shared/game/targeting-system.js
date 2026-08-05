import { distance } from "./math.js";

export function fireCandidates(team, attacker, enemyTeam) {
  const range = attacker.attackRange || attacker.effectiveRange();
  const canArc = typeof attacker.broadsideMultiplier === "function";
  const candidates = [];
  for (const target of enemyTeam.getEntities()) {
    if (!target.alive) continue;
    const targetDistance = distance(attacker.x, attacker.y, target.x, target.y);
    if (targetDistance > range) continue;
    const arc = canArc ? attacker.broadsideMultiplier(target) : 1;
    const blindfire = canArc
      && attacker.characterId === "haruhi"
      && attacker.hasEffect("critUntil")
      && arc > 0;
    if (!team.visibleEnemyIds.has(target.id) && !blindfire) continue;
    candidates.push({ target, dist: targetDistance, arc });
  }
  return candidates;
}

export function focusDamageBudget(attacker) {
  const horizon = 1.2;
  if (typeof attacker.effectiveDamage === "function" && typeof attacker.effectiveFireRate === "function") {
    return Math.max(1, attacker.effectiveDamage() * attacker.effectiveFireRate() * horizon);
  }
  return Math.max(1, (attacker.damage || 10) * horizon);
}

export function isFocusWorthy(team, target) {
  const maximumHp = target.maxHp || target.hp;
  return maximumHp > 0 && target.hp <= maximumHp * team.focusHpFrac;
}

export function assignFocusTargets(team, enemyTeam) {
  const assignments = new Map();
  const remainingHp = new Map();
  const rankedAttackers = [
    ...team.getAllShips(),
    ...team.wingmen,
    ...team.scouts.filter((scout) => scout.combatCapable),
  ]
    .filter((attacker) => attacker.alive && attacker.cooldown <= 0)
    .map((attacker) => ({ attacker, budget: focusDamageBudget(attacker) }))
    .sort((left, right) => right.budget - left.budget);

  for (const { attacker, budget } of rankedAttackers) {
    const candidates = fireCandidates(team, attacker, enemyTeam)
      .filter((candidate) => candidate.arc > 0 && isFocusWorthy(team, candidate.target));
    if (!candidates.length) continue;

    let pick = null;
    let pickRemaining = Infinity;
    let pickDistance = Infinity;
    let overflow = null;
    let overflowHp = Infinity;
    let overflowDistance = Infinity;
    for (const candidate of candidates) {
      const remaining = remainingHp.has(candidate.target.id)
        ? remainingHp.get(candidate.target.id)
        : candidate.target.hp;
      if (remaining > 0 && (remaining < pickRemaining || (remaining === pickRemaining && candidate.dist < pickDistance))) {
        pick = candidate.target;
        pickRemaining = remaining;
        pickDistance = candidate.dist;
      }
      if (candidate.target.hp < overflowHp || (candidate.target.hp === overflowHp && candidate.dist < overflowDistance)) {
        overflow = candidate.target;
        overflowHp = candidate.target.hp;
        overflowDistance = candidate.dist;
      }
    }
    const chosen = pick || overflow;
    if (!chosen) continue;
    assignments.set(attacker.id, chosen);
    const remaining = remainingHp.has(chosen.id) ? remainingHp.get(chosen.id) : chosen.hp;
    remainingHp.set(chosen.id, remaining - budget);
  }
  team._focusTargets = assignments;
}

export function pickTargetFor(team, attacker, enemyTeam) {
  const candidates = fireCandidates(team, attacker, enemyTeam);
  if (!candidates.length) return null;
  if (team.aiFocusLowHp) {
    const assigned = team._focusTargets && team._focusTargets.get(attacker.id);
    if (assigned && assigned.alive && candidates.some((candidate) => candidate.target === assigned)) return assigned;

    let weakest = null;
    let weakestHp = Infinity;
    let weakestDistance = Infinity;
    for (const candidate of candidates) {
      if (candidate.arc <= 0 || !isFocusWorthy(team, candidate.target)) continue;
      if (candidate.target.hp < weakestHp || (candidate.target.hp === weakestHp && candidate.dist < weakestDistance)) {
        weakest = candidate.target;
        weakestHp = candidate.target.hp;
        weakestDistance = candidate.dist;
      }
    }
    if (weakest) return weakest;
  }

  let nearest = null;
  let nearestDistance = Infinity;
  for (const candidate of candidates) {
    if (candidate.dist < nearestDistance) {
      nearestDistance = candidate.dist;
      nearest = candidate.target;
    }
  }
  return nearest;
}

export function stepCombat(team, enemyTeam) {
  if (team.aiFocusLowHp) assignFocusTargets(team, enemyTeam);
  for (const ship of team.getAllShips()) ship.tryAttack(team.match, enemyTeam);
  for (const wingman of team.wingmen) wingman.tryAttack(team.match, enemyTeam);
  for (const scout of team.scouts) scout.tryAttack(team.match, enemyTeam);
}
