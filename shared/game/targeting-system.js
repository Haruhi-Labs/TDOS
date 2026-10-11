// 纯选敌策略只消费候选读模型，不持有实体、队伍或对局，也不执行攻击。
export function isFocusWorthy(focusHpFrac, target) {
  const maximumHp = target.maxHp || target.hp;
  return maximumHp > 0 && target.hp <= maximumHp * focusHpFrac;
}

export function assignFocusTargets(attackers, focusHpFrac) {
  const assignments = new Map();
  const remainingHp = new Map();
  const rankedAttackers = [...attackers].sort((left, right) => right.budget - left.budget);

  for (const { id, budget, candidates: available } of rankedAttackers) {
    const candidates = available
      .filter((candidate) => candidate.arc > 0 && isFocusWorthy(focusHpFrac, candidate.target));
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
    assignments.set(id, chosen.id);
    const remaining = remainingHp.has(chosen.id) ? remainingHp.get(chosen.id) : chosen.hp;
    remainingHp.set(chosen.id, remaining - budget);
  }
  return assignments;
}

export function pickTargetId(candidates, { huntTargetId = null, focusLowHp = false, assignedTargetId = null, focusHpFrac }) {
  if (!candidates.length) return null;
  if (huntTargetId !== null && huntTargetId !== undefined) {
    const hunted = candidates.find(
      (candidate) => candidate.target.id === huntTargetId && candidate.arc > 0,
    );
    if (hunted) return hunted.target.id;
  }
  if (focusLowHp) {
    if (candidates.some((candidate) => candidate.target.id === assignedTargetId)) return assignedTargetId;

    let weakest = null;
    let weakestHp = Infinity;
    let weakestDistance = Infinity;
    for (const candidate of candidates) {
      if (candidate.arc <= 0 || !isFocusWorthy(focusHpFrac, candidate.target)) continue;
      if (candidate.target.hp < weakestHp || (candidate.target.hp === weakestHp && candidate.dist < weakestDistance)) {
        weakest = candidate.target;
        weakestHp = candidate.target.hp;
        weakestDistance = candidate.dist;
      }
    }
    if (weakest) return weakest.id;
  }

  let nearest = null;
  let nearestDistance = Infinity;
  for (const candidate of candidates) {
    if (candidate.dist < nearestDistance) {
      nearestDistance = candidate.dist;
      nearest = candidate.target;
    }
  }
  return nearest?.id ?? null;
}
