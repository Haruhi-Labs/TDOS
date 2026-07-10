const EFFECT_DURATION_MS = 900;
const PARTICLE_COUNT = 18;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function hash01(seed) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function shipIdentity(group, ship, index) {
  return `${group.seat || "?"}:${ship.id ?? ship.key ?? index}`;
}

function spawnEffect(effects, ship, color, identity, nowMs) {
  const numericId = Number(ship.id);
  const identitySeed = Array.from(identity).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  effects.bursts.push({
    x: finiteOr(ship.x, 0),
    y: finiteOr(ship.y, 0),
    radius: Math.max(7, finiteOr(ship.radius, 9)),
    color: color || "#ff9d7d",
    seed: Number.isFinite(numericId) ? numericId : identitySeed,
    startedAt: nowMs,
  });
}

export function createShipDestructionEffects() {
  return {
    shipStates: new Map(),
    bursts: [],
  };
}

export function resetShipDestructionEffects(effects) {
  if (!effects) {
    return;
  }
  effects.shipStates.clear();
  effects.bursts.length = 0;
}

// 每帧同步可见舰船状态；只在“上一帧存活、本帧击毁”时生成一次动画。
export function syncShipDestructionEffects(effects, groups, nowMs = performance.now()) {
  if (!effects) {
    return;
  }

  for (const group of groups || []) {
    const ships = Array.isArray(group.ships) ? group.ships : [];
    for (let index = 0; index < ships.length; index += 1) {
      const ship = ships[index];
      if (!ship) {
        continue;
      }
      const identity = shipIdentity(group, ship, index);
      const previous = effects.shipStates.get(identity);
      const alive = ship.alive !== false;
      const visible = typeof group.isVisible === "function" ? group.isVisible(ship) : true;

      if (previous?.alive && !alive && visible) {
        spawnEffect(effects, ship, group.color, identity, nowMs);
      }

      effects.shipStates.set(identity, { alive });
    }
  }

  effects.bursts = effects.bursts.filter((burst) => nowMs - burst.startedAt < EFFECT_DURATION_MS);
}

export function drawShipDestructionEffects(ctx, effects, nowMs = performance.now()) {
  if (!ctx || !effects) {
    return;
  }

  for (const burst of effects.bursts) {
    const progress = Math.max(0, Math.min(1, (nowMs - burst.startedAt) / EFFECT_DURATION_MS));
    const fade = (1 - progress) ** 1.6;
    const eased = 1 - (1 - progress) ** 2;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // 短促的中心闪光让舰体消失与碎片飞散在视觉上连成一次爆炸。
    if (progress < 0.42) {
      const flash = 1 - progress / 0.42;
      const glowRadius = burst.radius * (1.4 + eased * 2.6);
      const glow = ctx.createRadialGradient(burst.x, burst.y, 0, burst.x, burst.y, glowRadius);
      glow.addColorStop(0, `rgba(255, 255, 235, ${0.9 * flash})`);
      glow.addColorStop(0.28, `rgba(255, 176, 92, ${0.62 * flash})`);
      glow.addColorStop(1, "rgba(255, 80, 45, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(burst.x, burst.y, glowRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    // 冲击波使用队伍色，既保留爆炸的暖色，也能辨认被击毁舰船的阵营。
    ctx.globalAlpha = fade * 0.72;
    ctx.strokeStyle = burst.color;
    ctx.lineWidth = Math.max(1, 2.4 * (1 - progress));
    ctx.beginPath();
    ctx.arc(burst.x, burst.y, burst.radius + eased * burst.radius * 3.8, 0, Math.PI * 2);
    ctx.stroke();

    for (let index = 0; index < PARTICLE_COUNT; index += 1) {
      const speed = 38 + hash01(burst.seed + index * 3.17) * 62;
      const angle = burst.seed * 0.37 + index * GOLDEN_ANGLE + (hash01(index + burst.seed) - 0.5) * 0.34;
      const distance = burst.radius * 0.35 + speed * progress * 0.9;
      const x = burst.x + Math.cos(angle) * distance;
      const y = burst.y + Math.sin(angle) * distance;
      const size = 1.2 + hash01(burst.seed * 2 + index * 5.3) * 2.5;

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle + progress * (index % 2 === 0 ? 2.4 : -2.4));
      ctx.globalAlpha = fade * (0.58 + hash01(index * 7.1) * 0.42);
      ctx.fillStyle = index % 4 === 0 ? burst.color : index % 3 === 0 ? "#fff0b5" : "#ff9a5c";
      ctx.fillRect(-size * 1.4, -size * 0.45, size * 2.8, size * 0.9);
      ctx.restore();
    }

    ctx.restore();
  }
}
