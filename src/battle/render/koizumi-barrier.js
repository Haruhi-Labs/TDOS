const TAU = Math.PI * 2;
const RED = "#ff355f";
const HOT = "#ffd5dd";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function reducedMotionRequested() {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function easeOutCubic(value) {
  const rest = 1 - clamp(value, 0, 1);
  return 1 - rest * rest * rest;
}

function traceSegmentedRing(ctx, x, y, radius, phase, alpha, lineWidth = 1.2) {
  const segments = 12;
  ctx.lineCap = "round";
  ctx.lineWidth = lineWidth;
  for (let index = 0; index < segments; index += 1) {
    const offset = index * TAU / segments + phase;
    const length = 0.18 + (index % 3) * 0.035;
    ctx.globalAlpha = alpha * (0.62 + (index % 4) * 0.1);
    ctx.beginPath();
    ctx.arc(x, y, radius, offset, offset + length);
    ctx.stroke();
  }
}

export function drawKoizumiBarrier(ctx, team, elapsed = 0) {
  const barrier = team?.koizumiBarrier;
  const main = team?.ships?.main;
  if (!barrier || !main?.alive) {
    return false;
  }
  const x = Number(main.x);
  const y = Number(main.y);
  const radius = Math.max(1, Number(barrier.radius) || Number(main.vision) || 1);
  const reducedMotion = reducedMotionRequested();
  const pulse = reducedMotion ? 0.5 : 0.5 + Math.sin(elapsed * 2.7 + Number(main.id || 0) * 0.13) * 0.5;
  const recoveryAge = Math.max(0, Number(barrier.recoveryAge) || 0);

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = RED;
  ctx.shadowColor = RED;

  if (!barrier.active) {
    // 失效末段只显示正在重新接合的稀疏弧段；仍不具备任何拦截能力。
    const recovery = clamp((Number(barrier.recoveryProgress) - 0.72) / 0.28, 0, 1);
    if (recovery > 0) {
      ctx.shadowBlur = 8 + recovery * 8;
      traceSegmentedRing(
        ctx,
        x,
        y,
        radius,
        elapsed * 0.32,
        recovery * 0.3,
        0.8 + recovery * 0.9,
      );
    }
    ctx.restore();
    return true;
  }

  const rebuild = recoveryAge > 0 && recoveryAge < 0.9
    ? easeOutCubic(recoveryAge / 0.9)
    : 1;
  ctx.shadowBlur = 7 + pulse * 5;
  ctx.globalAlpha = (0.22 + pulse * 0.05) * rebuild;
  ctx.lineWidth = 1.15;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TAU);
  ctx.stroke();

  ctx.shadowBlur = 13 + pulse * 7;
  ctx.strokeStyle = "#ff6681";
  traceSegmentedRing(
    ctx,
    x,
    y,
    radius,
    (reducedMotion ? 0 : elapsed * 0.16) + Number(main.id || 0) * 0.19,
    (0.32 + pulse * 0.08) * rebuild,
    1.4,
  );

  // 少量沿圆周缓慢游走的能量节点，让护盾有生命感，但不盖住视野圈本身。
  const nodes = 4;
  ctx.fillStyle = HOT;
  ctx.shadowBlur = 10;
  for (let index = 0; index < nodes; index += 1) {
    const angle = index * TAU / nodes - (reducedMotion ? 0 : elapsed * 0.22);
    const nodePulse = 0.65 + Math.sin(elapsed * 3.1 + index * 1.7) * 0.25;
    ctx.globalAlpha = nodePulse * 0.46 * rebuild;
    ctx.beginPath();
    ctx.arc(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius, 1.3, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  return true;
}

function drawContactBloom(ctx, impact, progress, strength = 1) {
  const bloomRadius = (8 + easeOutCubic(progress) * 24) * strength;
  const gradient = ctx.createRadialGradient(
    impact.x,
    impact.y,
    0,
    impact.x,
    impact.y,
    bloomRadius,
  );
  gradient.addColorStop(0, `rgba(255,242,245,${0.92 * (1 - progress)})`);
  gradient.addColorStop(0.22, `rgba(255,87,116,${0.62 * (1 - progress)})`);
  gradient.addColorStop(1, "rgba(255,20,67,0)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(impact.x, impact.y, bloomRadius, 0, TAU);
  ctx.fill();
}

function drawImpactArcs(ctx, impact, progress, spread, strength) {
  const angle = Number(impact.angle) || 0;
  const radius = Math.max(1, Number(impact.radius) || 1);
  const fade = 1 - progress;
  ctx.strokeStyle = HOT;
  ctx.lineCap = "round";
  ctx.shadowColor = RED;
  ctx.shadowBlur = 15 * strength;
  for (let layer = 0; layer < 3; layer += 1) {
    ctx.globalAlpha = fade * (0.7 - layer * 0.16);
    ctx.lineWidth = Math.max(0.8, (3.2 - layer * 0.72) * strength);
    const expansion = easeOutCubic(progress) * (5 + layer * 4);
    const arcSpread = spread * (1 + layer * 0.22 + progress * 0.35);
    ctx.beginPath();
    ctx.arc(
      impact.centerX,
      impact.centerY,
      radius + expansion,
      angle - arcSpread,
      angle + arcSpread,
    );
    ctx.stroke();
  }
}

function drawImpactSparks(ctx, impact, progress, count, strength = 1) {
  const fade = (1 - progress) ** 1.35;
  const tangentX = -Math.sin(impact.angle || 0);
  const tangentY = Math.cos(impact.angle || 0);
  const normalX = Number(impact.normalX) || Math.cos(impact.angle || 0);
  const normalY = Number(impact.normalY) || Math.sin(impact.angle || 0);
  ctx.strokeStyle = HOT;
  ctx.lineCap = "round";
  for (let index = 0; index < count; index += 1) {
    const seed = (Number(impact.id) || 1) * 0.73 + index * 2.17;
    const side = Math.sin(seed) >= 0 ? 1 : -1;
    const travel = easeOutCubic(progress) * (10 + (index % 5) * 3.2) * strength;
    const tangentTravel = side * travel * (0.35 + Math.abs(Math.sin(seed * 1.7)) * 0.75);
    const normalTravel = travel * (0.3 + Math.abs(Math.cos(seed * 1.3)) * 0.7);
    const x = impact.x + tangentX * tangentTravel + normalX * normalTravel;
    const y = impact.y + tangentY * tangentTravel + normalY * normalTravel;
    ctx.globalAlpha = fade * (0.42 + (index % 3) * 0.18);
    ctx.lineWidth = 0.8 + (index % 2) * 0.7;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - normalX * (3.5 + index % 4), y - normalY * (3.5 + index % 4));
    ctx.stroke();
  }
}

function drawRamSignature(ctx, impact, progress) {
  const fade = (1 - progress) ** 1.2;
  const tangentX = -Math.sin(impact.angle || 0);
  const tangentY = Math.cos(impact.angle || 0);
  const normalX = Number(impact.normalX) || Math.cos(impact.angle || 0);
  const normalY = Number(impact.normalY) || Math.sin(impact.angle || 0);
  const travel = easeOutCubic(progress) * 22;
  ctx.strokeStyle = HOT;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = RED;
  ctx.shadowBlur = 18;
  ctx.globalAlpha = fade * 0.9;
  ctx.lineWidth = 2.2;

  if (impact.ramKind === "blade_queen") {
    // 三道切线斩痕对应刀锋女王穿透护盾的锐利接触。
    for (const offset of [-7, 0, 7]) {
      ctx.beginPath();
      ctx.moveTo(
        impact.x + tangentX * (offset - 12) - normalX * travel * 0.25,
        impact.y + tangentY * (offset - 12) - normalY * travel * 0.25,
      );
      ctx.lineTo(
        impact.x + tangentX * (offset + 12) + normalX * travel,
        impact.y + tangentY * (offset + 12) + normalY * travel,
      );
      ctx.stroke();
    }
    return;
  }

  if (impact.ramKind === "koizumi_orb") {
    // 光球撞击留下两道反向卷曲的能量涡旋。
    for (const direction of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(
        impact.x + tangentX * direction * 4,
        impact.y + tangentY * direction * 4,
        5 + travel * 0.45,
        impact.angle - direction * 1.7,
        impact.angle + direction * 0.35,
        direction < 0,
      );
      ctx.stroke();
    }
    return;
  }

  // 异世界人以船首撞击：用向外展开的 V 形冲击锋面保留明确方向感。
  const tipX = impact.x + normalX * travel;
  const tipY = impact.y + normalY * travel;
  ctx.beginPath();
  ctx.moveTo(impact.x + tangentX * 15, impact.y + tangentY * 15);
  ctx.lineTo(tipX, tipY);
  ctx.lineTo(impact.x - tangentX * 15, impact.y - tangentY * 15);
  ctx.stroke();
}

function drawBarrierImpact(ctx, impact) {
  const maxLife = Math.max(0.001, Number(impact.maxLife) || 0.62);
  const progress = clamp(1 - (Number(impact.life) || 0) / maxLife, 0, 1);
  if (progress >= 1) {
    return;
  }
  const ram = impact.kind === "ram";
  const beam = impact.kind === "beam";
  const strength = ram ? 1.45 : beam ? 1.18 : 1;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  drawContactBloom(ctx, impact, progress, strength);
  drawImpactArcs(ctx, impact, progress, ram ? 0.48 : beam ? 0.24 : 0.15, strength);
  drawImpactSparks(ctx, impact, progress, ram ? 15 : beam ? 10 : 6, strength);

  if (ram) {
    drawRamSignature(ctx, impact, progress);
    const collapse = clamp(progress / 0.78, 0, 1);
    ctx.strokeStyle = RED;
    ctx.shadowColor = RED;
    ctx.shadowBlur = 20;
    ctx.globalAlpha = (1 - collapse) * 0.52;
    ctx.lineWidth = 2.4 + collapse * 2.2;
    ctx.beginPath();
    ctx.arc(
      impact.centerX,
      impact.centerY,
      impact.radius + easeOutCubic(collapse) * 18,
      0,
      TAU,
    );
    ctx.stroke();
  }
  ctx.restore();
}

export function drawKoizumiBarrierImpacts(ctx, impacts, isVisible = () => true) {
  for (const impact of impacts || []) {
    if (!impact || !isVisible(impact)) {
      continue;
    }
    drawBarrierImpact(ctx, impact);
  }
}
