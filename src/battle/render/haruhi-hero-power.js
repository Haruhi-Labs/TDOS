const TAU = Math.PI * 2;

const HERO_POWER_COLORS = Object.freeze({
  core: "#fff3c8",
  gold: "#f0d488",
  amber: "#ffbf5c",
  cyan: "#9befff",
  shadow: "#17214b",
});

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function easeOutCubic(value) {
  const inverse = 1 - clamp01(value);
  return 1 - inverse * inverse * inverse;
}

function traceCircle(ctx, radius) {
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(0.1, radius), 0, TAU);
}

function drawCharge(ctx, effect) {
  const progress = clamp01(effect.progress);
  const pulse = 0.5 + Math.sin(progress * Math.PI * 9) * 0.5;
  const gatherRadius = 58 - progress * 37;
  const coreRadius = 4 + progress * 7 + pulse * 1.5;

  ctx.save();
  ctx.translate(effect.x, effect.y);
  ctx.globalCompositeOperation = "lighter";

  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, coreRadius * 3.8);
  glow.addColorStop(0, "#fffdf5ee");
  glow.addColorStop(0.24, "#fff3c8c8");
  glow.addColorStop(0.58, "#ffbf5c55");
  glow.addColorStop(1, "#17214b00");
  ctx.fillStyle = glow;
  traceCircle(ctx, coreRadius * 3.8);
  ctx.fill();

  // 六束交错能量从外侧向舰体收束；不画成普通的“读条圆圈”，让聚能方向一眼可见。
  ctx.rotate(-progress * 1.8);
  ctx.lineCap = "round";
  for (let index = 0; index < 6; index += 1) {
    const angle = (index / 6) * TAU + (index % 2 ? 0.09 : -0.05);
    const outer = gatherRadius + (index % 2) * 7;
    const inner = 13 + progress * 2;
    const tangent = 5.5 * (1 - progress);
    const ax = Math.cos(angle);
    const ay = Math.sin(angle);
    const tx = -ay;
    const ty = ax;
    ctx.strokeStyle = index % 2 ? HERO_POWER_COLORS.cyan : HERO_POWER_COLORS.gold;
    ctx.globalAlpha = 0.34 + progress * 0.58;
    ctx.lineWidth = index % 2 ? 1.35 : 1.8;
    ctx.beginPath();
    ctx.moveTo(ax * outer + tx * tangent, ay * outer + ty * tangent);
    ctx.quadraticCurveTo(
      ax * (inner + outer) * 0.5 - tx * 4,
      ay * (inner + outer) * 0.5 - ty * 4,
      ax * inner,
      ay * inner,
    );
    ctx.stroke();
  }

  ctx.rotate(progress * 4.1);
  ctx.strokeStyle = HERO_POWER_COLORS.core;
  ctx.globalAlpha = 0.42 + progress * 0.5;
  ctx.lineWidth = 1.1;
  ctx.setLineDash([7, 5, 2, 5]);
  ctx.lineDashOffset = -progress * 23;
  traceCircle(ctx, 19 + (1 - progress) * 8);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = HERO_POWER_COLORS.core;
  ctx.shadowColor = HERO_POWER_COLORS.amber;
  ctx.shadowBlur = 11 + progress * 12;
  ctx.globalAlpha = 0.88;
  traceCircle(ctx, coreRadius);
  ctx.fill();
  ctx.restore();
}

function drawShock(ctx, effect) {
  const progress = clamp01(effect.progress);
  const expansion = easeOutCubic(progress);
  const radius = Math.max(1, Number(effect.radius) || 1) * expansion;
  const fade = Math.pow(1 - progress, 0.72);
  const echoRadius = Math.max(0, radius - 18 - progress * 14);

  ctx.save();
  ctx.translate(effect.x, effect.y);
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";

  if (progress < 0.34) {
    const flash = 1 - progress / 0.34;
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 52 + progress * 70);
    glow.addColorStop(0, `rgba(255,253,245,${0.86 * flash})`);
    glow.addColorStop(0.3, `rgba(240,212,136,${0.42 * flash})`);
    glow.addColorStop(1, "rgba(23,33,75,0)");
    ctx.fillStyle = glow;
    traceCircle(ctx, 52 + progress * 70);
    ctx.fill();
  }

  ctx.strokeStyle = `rgba(255,191,92,${0.12 * fade})`;
  ctx.lineWidth = 15 - progress * 8;
  traceCircle(ctx, radius);
  ctx.stroke();

  ctx.strokeStyle = `rgba(240,212,136,${0.92 * fade})`;
  ctx.lineWidth = 2.4 - progress * 0.8;
  traceCircle(ctx, radius);
  ctx.stroke();

  ctx.strokeStyle = `rgba(155,239,255,${0.42 * fade})`;
  ctx.lineWidth = 1.1;
  traceCircle(ctx, echoRadius);
  ctx.stroke();

  // 主波沿线的短切面标记带来干净的科技/勇者纹章感，数量固定，不制造粗糙粒子噪声。
  ctx.rotate(progress * 0.45);
  for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * TAU;
    const length = index % 3 === 0 ? 12 : 7;
    const ax = Math.cos(angle);
    const ay = Math.sin(angle);
    ctx.strokeStyle = index % 2
      ? `rgba(155,239,255,${0.5 * fade})`
      : `rgba(255,243,200,${0.7 * fade})`;
    ctx.lineWidth = index % 3 === 0 ? 1.7 : 1;
    ctx.beginPath();
    ctx.moveTo(ax * (radius - length * 0.35), ay * (radius - length * 0.35));
    ctx.lineTo(ax * (radius + length * 0.65), ay * (radius + length * 0.65));
    ctx.stroke();
  }
  ctx.restore();
}

export function drawHaruhiHeroPowerEffects(ctx, effects, isVisible = () => true) {
  for (const effect of Array.isArray(effects) ? effects : []) {
    if (!effect || !isVisible(effect)) continue;
    if (effect.phase === "charge") {
      drawCharge(ctx, effect);
    } else {
      drawShock(ctx, effect);
    }
  }
}

export function drawHaruhiHeroPowerShockIndicator(ctx, ship) {
  const shock = ship?.heroPowerShock;
  if (!ship?.alive || !shock?.active) return;

  const speedFactor = clamp01(shock.speedFactor);
  const locked = Boolean(shock.controlLocked);
  const alpha = locked ? 0.88 : 0.18 + (1 - speedFactor) * 0.42;
  const radius = ship.radius + 7 + speedFactor * 3;
  ctx.save();
  ctx.translate(ship.x, ship.y);
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = locked
    ? `rgba(255,226,154,${alpha})`
    : `rgba(155,239,255,${alpha})`;
  ctx.lineWidth = locked ? 1.8 : 1.1;
  ctx.setLineDash(locked ? [4, 3] : [2, 6]);
  ctx.lineDashOffset = -(1 - speedFactor) * 17;
  traceCircle(ctx, radius);
  ctx.stroke();
  ctx.setLineDash([]);
  for (let index = 0; index < 4; index += 1) {
    const angle = index * Math.PI * 0.5 + Math.PI * 0.25;
    const ax = Math.cos(angle);
    const ay = Math.sin(angle);
    ctx.beginPath();
    ctx.moveTo(ax * (radius + 5), ay * (radius + 5));
    ctx.lineTo(ax * (radius - 2), ay * (radius - 2));
    ctx.stroke();
  }
  ctx.restore();
}
