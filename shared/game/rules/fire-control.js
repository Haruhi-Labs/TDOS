import { distance } from "../math.js";

export function fireCandidates(team, attacker, enemyTeam) {
  const range = attacker.attackRange || attacker.effectiveRange();
  const canArc = typeof attacker.broadsideMultiplier === "function";
  const candidates = [];
  for (const target of enemyTeam.getEntities()) {
    if (!target.alive || !team.match.rules.canDamage(attacker, target)) continue;
    if (typeof target.isTargetableByFire === "function" && !target.isTargetableByFire()) continue;
    const targetDistance = distance(attacker.x, attacker.y, target.x, target.y);
    if (targetDistance > range) continue;
    const arc = canArc ? attacker.broadsideMultiplier(target) : 1;
    // 猎杀标记不等于真实视野：迷雾中只能追踪和走位，必须由任意己方视野实际发现后
    // 才能开火。所有舰炮都必须遵守真实视野，不再存在角色专属盲射旁路。
    if (!team.visibleEnemyIds.has(target.id)) continue;
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

// 实体只停留在执行边界，交给策略的数据不含方法或嵌套运行时引用。
function projectCandidate({ target, dist, arc }) {
  return { target: { id: target.id, hp: target.hp, maxHp: target.maxHp }, dist, arc };
}

export function projectVolleyAttackers(team, enemyTeam) {
  const attackers = [...team.getAllShips(), ...team.wingmen, ...team.scouts.filter((scout) => scout.combatCapable)]
    .filter((attacker) => attacker.alive && attacker.cooldown <= 0)
    .map((attacker) => ({ attacker, budget: focusDamageBudget(attacker) }))
    .sort((left, right) => right.budget - left.budget);
  return attackers.map(({ attacker, budget }) => ({
    id: attacker.id,
    budget,
    candidates: fireCandidates(team, attacker, enemyTeam).map(projectCandidate),
  }));
}

export function pickTeamTarget(team, attacker, enemyTeam, control) {
  const candidates = fireCandidates(team, attacker, enemyTeam);
  const id = control.pick(attacker.id, candidates.map(projectCandidate), {
    huntTargetId: team.match.rules.preferredTargetId(team),
    focusLowHp: team.aiFocusLowHp,
    focusHpFrac: team.focusHpFrac,
  });
  return candidates.find((candidate) => candidate.target.id === id)?.target || null;
}
