export const DAMAGE_KIND = Object.freeze({
  PROJECTILE: "projectile",
  ATTACK_EFFECT: "attack_effect",
  SKILL: "skill",
  STATUS_EFFECT: "status_effect",
  COLLISION: "collision",
});
const DAMAGE_KINDS = new Set(Object.values(DAMAGE_KIND));

/**
 * 承伤入口历史上以第四个布尔参数控制编队分摊。这里兼容旧调用，
 * 同时为需要区分子弹、技能与碰撞的规则提供明确伤害来源。
 */
export function normalizeDamageContext(context) {
  if (typeof context === "boolean") {
    return { share: context, kind: null };
  }
  return {
    share: context?.share !== false,
    kind: DAMAGE_KINDS.has(context?.kind) ? context.kind : null,
  };
}

export function isAttackDamageKind(kind) {
  return kind === DAMAGE_KIND.PROJECTILE || kind === DAMAGE_KIND.ATTACK_EFFECT;
}
