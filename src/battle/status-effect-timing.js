// 只推进显示副本。以权威状态的存在与续期为准，过期或驱散的效果不能被插值复活。
export function interpolateStatusEffects(previous, current, ratio) {
  if (!Array.isArray(current)) return current;
  const before = new Map((previous || []).map((effect) => [effect.id, effect]));
  return current.map((effect) => {
    const old = before.get(effect.id);
    if (!old || effect.remaining === null || old.expiresAt !== effect.expiresAt) return { ...effect };
    return { ...effect, remaining: old.remaining + (effect.remaining - old.remaining) * ratio };
  });
}

export function advanceStatusEffects(effects, dt) {
  if (!Array.isArray(effects)) return effects;
  return effects.map((effect) => effect.remaining === null ? { ...effect } : {
    ...effect, remaining: Math.max(0, effect.remaining - dt),
  }).filter((effect) => effect.remaining === null || effect.remaining > 0);
}
