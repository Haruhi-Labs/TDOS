const TAU = Math.PI * 2;
const RED = "#ff355f";
const HOT = "#ffd5dd";
let reducedMotionMedia = null;
let reducedMotion = false;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function reducedMotionRequested() {
  if (reducedMotionMedia || typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return reducedMotion;
  }
  reducedMotionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
  reducedMotion = reducedMotionMedia.matches;
  reducedMotionMedia.addEventListener?.("change", (event) => {
    reducedMotion = event.matches;
  });
  return reducedMotion;
}

function easeOutCubic(value) {
  const rest = 1 - clamp(value, 0, 1);
  return 1 - rest * rest * rest;
}

function circleIntersectsCanvas(ctx, x, y, radius, padding = 0) {
  if (!ctx?.canvas || typeof ctx.getTransform !== "function") {
    return true;
  }
  const transform = ctx.getTransform();
  const screenX = transform.a * x + transform.c * y + transform.e;
  const screenY = transform.b * x + transform.d * y + transform.f;
  const scale = Math.max(
    Math.hypot(transform.a, transform.b),
    Math.hypot(transform.c, transform.d),
  );
  const screenRadius = radius * scale + padding;
  return screenX + screenRadius >= 0
    && screenY + screenRadius >= 0
    && screenX - screenRadius <= ctx.canvas.width
    && screenY - screenRadius <= ctx.canvas.height;
}

function normalizeArc(start, end) {
  const span = Math.max(0, Number(end) - Number(start));
  if (span >= TAU - 1e-6) {
    return [[0, TAU]];
  }
  let normalizedStart = Number(start) % TAU;
  if (normalizedStart < 0) normalizedStart += TAU;
  const normalizedEnd = normalizedStart + span;
  return normalizedEnd <= TAU
    ? [[normalizedStart, normalizedEnd]]
    : [[normalizedStart, TAU], [0, normalizedEnd - TAU]];
}

function mergeArcs(arcs) {
  const sorted = (arcs || [])
    .filter((arc) => Array.isArray(arc) && arc.length >= 2 && arc[1] - arc[0] > 1e-6)
    .map(([start, end]) => [clamp(start, 0, TAU), clamp(end, 0, TAU)])
    .sort((left, right) => left[0] - right[0]);
  const merged = [];
  for (const arc of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || arc[0] > previous[1] + 1e-6) {
      merged.push(arc);
    } else {
      previous[1] = Math.max(previous[1], arc[1]);
    }
  }
  return merged;
}

function intersectArcs(leftArcs, rightArcs) {
  const intersections = [];
  for (const left of leftArcs) {
    for (const right of rightArcs) {
      const start = Math.max(left[0], right[0]);
      const end = Math.min(left[1], right[1]);
      if (end - start > 1e-6) intersections.push([start, end]);
    }
  }
  return intersections;
}

function subtractArcs(baseArcs, cutArcs) {
  let remaining = mergeArcs(baseArcs);
  for (const [cutStart, cutEnd] of mergeArcs(cutArcs)) {
    const next = [];
    for (const [start, end] of remaining) {
      if (cutEnd <= start || cutStart >= end) {
        next.push([start, end]);
        continue;
      }
      if (cutStart > start) next.push([start, Math.min(cutStart, end)]);
      if (cutEnd < end) next.push([Math.max(cutEnd, start), end]);
    }
    remaining = next;
  }
  return remaining;
}

function circleCoverageArcs(centerX, centerY, radius, sourceX, sourceY, sourceRadius) {
  const safeRadius = Math.max(1, Number(radius) || 1);
  const safeSourceRadius = Math.max(0, Number(sourceRadius) || 0);
  if (safeSourceRadius <= 0) return [];
  const dx = Number(sourceX) - centerX;
  const dy = Number(sourceY) - centerY;
  const distance = Math.hypot(dx, dy);
  if (safeSourceRadius >= distance + safeRadius - 1e-6) {
    return [[0, TAU]];
  }
  if (
    distance >= safeRadius + safeSourceRadius
    || distance + safeSourceRadius <= safeRadius
    || distance < 1e-6
  ) {
    return [];
  }
  const cosine = clamp(
    (distance * distance + safeRadius * safeRadius - safeSourceRadius * safeSourceRadius)
      / (2 * distance * safeRadius),
    -1,
    1,
  );
  const halfAngle = Math.acos(cosine);
  const centerAngle = Math.atan2(dy, dx);
  return normalizeArc(centerAngle - halfAngle, centerAngle + halfAngle);
}

function serializedVisionSources(team) {
  const sources = [];
  for (const [key, ship] of Object.entries(team?.ships || {})) {
    if (!ship?.alive || (key !== "main" && ship.attached)) continue;
    sources.push(ship);
  }
  for (const entity of [
    ...(team?.extraShips || []),
    ...(team?.scouts || []),
    ...(team?.wingmen || []),
  ]) {
    if (entity?.alive) sources.push(entity);
  }
  return sources;
}

/**
 * 返回敌方古泉能量圈落入 viewerTeam 真实视野的圆周角区间。
 * 这里仅裁切表现，不把能量圈圆心或古泉本体加入可见单位集合。
 */
export function koizumiBarrierVisibleArcs(team, viewerTeam, elapsed = 0) {
  const barrier = team?.koizumiBarrier;
  const main = team?.ships?.main;
  if (!barrier || !main?.alive || !viewerTeam) return [];
  const x = Number(main.x);
  const y = Number(main.y);
  const radius = Math.max(1, Number(barrier.radius) || Number(main.vision) || 1);
  const arcs = [];

  for (const source of serializedVisionSources(viewerTeam)) {
    arcs.push(...circleCoverageArcs(
      x,
      y,
      radius,
      Number(source.x),
      Number(source.y),
      Number(source.vision),
    ));
  }

  // 朝仓视野波是有宽度的环带；用“外圆覆盖减去内圆覆盖”得到圆周交集，
  // 保持和权威层的真实视野波判定一致。
  for (const wave of viewerTeam.visionWaves || []) {
    const age = Number(elapsed) - (Number(wave.emittedAt) || 0);
    const expiresAt = Number(wave.expiresAt);
    if (age < 0 || (Number.isFinite(expiresAt) && elapsed >= expiresAt)) continue;
    const waveRadius = age * Math.max(0, Number(wave.speed) || 0);
    const halfWidth = Math.max(0.5, Number(wave.width) * 0.5 || 0.5);
    const outerArcs = circleCoverageArcs(
      x,
      y,
      radius,
      Number(wave.x),
      Number(wave.y),
      waveRadius + halfWidth,
    );
    const innerRadius = Math.max(0, waveRadius - halfWidth);
    arcs.push(...(innerRadius > 0
      ? subtractArcs(
        outerArcs,
        circleCoverageArcs(x, y, radius, Number(wave.x), Number(wave.y), innerRadius),
      )
      : outerArcs));
  }

  return mergeArcs(arcs);
}

function traceRingArcs(ctx, x, y, radius, visibleArcs) {
  for (const [start, end] of visibleArcs) {
    ctx.moveTo(x + Math.cos(start) * radius, y + Math.sin(start) * radius);
    ctx.arc(x, y, radius, start, end);
  }
}

function angleIsVisible(angle, visibleArcs) {
  let normalized = angle % TAU;
  if (normalized < 0) normalized += TAU;
  return visibleArcs.some(([start, end]) => normalized >= start && normalized <= end);
}

function traceSegmentedRing(
  ctx,
  x,
  y,
  radius,
  phase,
  alpha,
  lineWidth = 1.2,
  visibleArcs = [[0, TAU]],
) {
  const segments = 10;
  ctx.lineCap = "round";
  ctx.lineWidth = lineWidth;
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  for (let index = 0; index < segments; index += 1) {
    const offset = index * TAU / segments + phase;
    const length = 0.2 + (index % 3) * 0.04;
    traceRingArcs(
      ctx,
      x,
      y,
      radius,
      intersectArcs(normalizeArc(offset, offset + length), visibleArcs),
    );
  }
  ctx.stroke();
}

export function drawKoizumiBarrier(ctx, team, elapsed = 0, options = {}) {
  const barrier = team?.koizumiBarrier;
  const main = team?.ships?.main;
  if (!barrier || !main?.alive) {
    return false;
  }
  const x = Number(main.x);
  const y = Number(main.y);
  const radius = Math.max(1, Number(barrier.radius) || Number(main.vision) || 1);
  const visibleArcs = options.visibleArcs == null
    ? [[0, TAU]]
    : mergeArcs(options.visibleArcs);
  if (visibleArcs.length === 0) {
    return false;
  }
  if (!circleIntersectsCanvas(ctx, x, y, radius, 24)) {
    return false;
  }
  const reducedMotion = reducedMotionRequested();
  const pulse = reducedMotion ? 0.5 : 0.5 + Math.sin(elapsed * 2.7 + Number(main.id || 0) * 0.13) * 0.5;
  const recoveryAge = Math.max(0, Number(barrier.recoveryAge) || 0);

  ctx.save();
  ctx.strokeStyle = RED;

  if (!barrier.active) {
    // 失效末段只显示正在重新接合的稀疏弧段；仍不具备任何拦截能力。
    const recovery = clamp((Number(barrier.recoveryProgress) - 0.72) / 0.28, 0, 1);
    if (recovery > 0) {
      ctx.strokeStyle = "rgba(255,53,95,0.2)";
      traceSegmentedRing(
        ctx,
        x,
        y,
        radius,
        elapsed * 0.32,
        recovery * 0.58,
        4.2,
        visibleArcs,
      );
      ctx.strokeStyle = "#ff6681";
      traceSegmentedRing(
        ctx,
        x,
        y,
        radius,
        elapsed * 0.32,
        recovery * 0.3,
        0.8 + recovery * 0.9,
        visibleArcs,
      );
    }
    ctx.restore();
    return true;
  }

  const rebuild = recoveryAge > 0 && recoveryAge < 0.9
    ? easeOutCubic(recoveryAge / 0.9)
    : 1;
  // 用两层普通描边替代大半径阴影。视觉仍保留柔和能量辉光，但不会让移动端
  // Canvas 每帧为整个视野圆做昂贵的阴影模糊。
  ctx.strokeStyle = "rgba(255,53,95,0.15)";
  ctx.globalAlpha = (0.45 + pulse * 0.08) * rebuild;
  ctx.lineWidth = 5.2;
  ctx.beginPath();
  traceRingArcs(ctx, x, y, radius, visibleArcs);
  ctx.stroke();

  ctx.strokeStyle = RED;
  ctx.globalAlpha = (0.3 + pulse * 0.06) * rebuild;
  ctx.lineWidth = 1.15;
  ctx.beginPath();
  traceRingArcs(ctx, x, y, radius, visibleArcs);
  ctx.stroke();

  ctx.strokeStyle = "#ff6681";
  traceSegmentedRing(
    ctx,
    x,
    y,
    radius,
    (reducedMotion ? 0 : elapsed * 0.16) + Number(main.id || 0) * 0.19,
    (0.32 + pulse * 0.08) * rebuild,
    1.4,
    visibleArcs,
  );

  // 少量沿圆周缓慢游走的能量节点，让护盾有生命感，但不盖住视野圈本身。
  const nodes = 4;
  ctx.fillStyle = HOT;
  ctx.globalAlpha = (0.35 + pulse * 0.15) * rebuild;
  ctx.beginPath();
  for (let index = 0; index < nodes; index += 1) {
    const angle = index * TAU / nodes - (reducedMotion ? 0 : elapsed * 0.22);
    if (!angleIsVisible(angle, visibleArcs)) continue;
    const nodePulse = 0.65 + Math.sin(elapsed * 3.1 + index * 1.7) * 0.25;
    ctx.moveTo(x + Math.cos(angle) * radius + nodePulse * 1.5, y + Math.sin(angle) * radius);
    ctx.arc(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius, nodePulse * 1.5, 0, TAU);
  }
  ctx.fill();
  ctx.restore();
  return true;
}

function drawContactBloom(ctx, impact, progress, strength = 1) {
  const bloomRadius = (8 + easeOutCubic(progress) * 24) * strength;
  const fade = 1 - progress;
  ctx.fillStyle = `rgba(255,53,95,${0.13 * fade})`;
  ctx.beginPath();
  ctx.arc(impact.x, impact.y, bloomRadius, 0, TAU);
  ctx.fill();
  ctx.fillStyle = `rgba(255,102,129,${0.27 * fade})`;
  ctx.beginPath();
  ctx.arc(impact.x, impact.y, bloomRadius * 0.48, 0, TAU);
  ctx.fill();
  ctx.fillStyle = `rgba(255,242,245,${0.72 * fade})`;
  ctx.beginPath();
  ctx.arc(impact.x, impact.y, Math.max(1.5, bloomRadius * 0.12), 0, TAU);
  ctx.fill();
}

function drawImpactArcs(ctx, impact, progress, spread, strength) {
  const angle = Number(impact.angle) || 0;
  const radius = Math.max(1, Number(impact.radius) || 1);
  const fade = 1 - progress;
  ctx.lineCap = "round";
  const traceArcs = () => {
    ctx.beginPath();
    for (let layer = 0; layer < 3; layer += 1) {
      const expansion = easeOutCubic(progress) * (5 + layer * 4);
      const arcSpread = spread * (1 + layer * 0.22 + progress * 0.35);
      const arcRadius = radius + expansion;
      ctx.moveTo(
        impact.centerX + Math.cos(angle - arcSpread) * arcRadius,
        impact.centerY + Math.sin(angle - arcSpread) * arcRadius,
      );
      ctx.arc(
        impact.centerX,
        impact.centerY,
        arcRadius,
        angle - arcSpread,
        angle + arcSpread,
      );
    }
    ctx.stroke();
  };
  ctx.strokeStyle = "rgba(255,53,95,0.28)";
  ctx.globalAlpha = fade;
  ctx.lineWidth = 5.2 * strength;
  traceArcs();
  ctx.strokeStyle = HOT;
  ctx.globalAlpha = fade * 0.7;
  ctx.lineWidth = 1.45 * strength;
  traceArcs();
}

function drawImpactSparks(ctx, impact, progress, count, strength = 1) {
  const fade = (1 - progress) ** 1.35;
  const tangentX = -Math.sin(impact.angle || 0);
  const tangentY = Math.cos(impact.angle || 0);
  const normalX = Number(impact.normalX) || Math.cos(impact.angle || 0);
  const normalY = Number(impact.normalY) || Math.sin(impact.angle || 0);
  ctx.strokeStyle = HOT;
  ctx.lineCap = "round";
  ctx.globalAlpha = fade * 0.72;
  ctx.lineWidth = 1.15 * strength;
  ctx.beginPath();
  for (let index = 0; index < count; index += 1) {
    const seed = (Number(impact.id) || 1) * 0.73 + index * 2.17;
    const side = Math.sin(seed) >= 0 ? 1 : -1;
    const travel = easeOutCubic(progress) * (10 + (index % 5) * 3.2) * strength;
    const tangentTravel = side * travel * (0.35 + Math.abs(Math.sin(seed * 1.7)) * 0.75);
    const normalTravel = travel * (0.3 + Math.abs(Math.cos(seed * 1.3)) * 0.7);
    const x = impact.x + tangentX * tangentTravel + normalX * normalTravel;
    const y = impact.y + tangentY * tangentTravel + normalY * normalTravel;
    ctx.moveTo(x, y);
    ctx.lineTo(x - normalX * (3.5 + index % 4), y - normalY * (3.5 + index % 4));
  }
  ctx.stroke();
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
  ctx.globalAlpha = fade * 0.9;
  ctx.lineWidth = 2.2;
  ctx.beginPath();

  if (impact.ramKind === "blade_queen") {
    // 三道切线斩痕对应刀锋女王穿透护盾的锐利接触。
    for (const offset of [-7, 0, 7]) {
      ctx.moveTo(
        impact.x + tangentX * (offset - 12) - normalX * travel * 0.25,
        impact.y + tangentY * (offset - 12) - normalY * travel * 0.25,
      );
      ctx.lineTo(
        impact.x + tangentX * (offset + 12) + normalX * travel,
        impact.y + tangentY * (offset + 12) + normalY * travel,
      );
    }
    ctx.stroke();
    return;
  }

  if (impact.ramKind === "koizumi_orb") {
    // 光球撞击留下两道反向卷曲的能量涡旋。
    for (const direction of [-1, 1]) {
      ctx.moveTo(
        impact.x + tangentX * direction * 4
          + Math.cos(impact.angle - direction * 1.7) * (5 + travel * 0.45),
        impact.y + tangentY * direction * 4
          + Math.sin(impact.angle - direction * 1.7) * (5 + travel * 0.45),
      );
      ctx.arc(
        impact.x + tangentX * direction * 4,
        impact.y + tangentY * direction * 4,
        5 + travel * 0.45,
        impact.angle - direction * 1.7,
        impact.angle + direction * 0.35,
        direction < 0,
      );
    }
    ctx.stroke();
    return;
  }

  // 异世界人以船首撞击：用向外展开的 V 形冲击锋面保留明确方向感。
  const tipX = impact.x + normalX * travel;
  const tipY = impact.y + normalY * travel;
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
  const visible = ram
    ? circleIntersectsCanvas(
      ctx,
      Number(impact.centerX) || Number(impact.x) || 0,
      Number(impact.centerY) || Number(impact.y) || 0,
      Math.max(1, Number(impact.radius) || 1) + 28,
      16,
    )
    : circleIntersectsCanvas(ctx, Number(impact.x) || 0, Number(impact.y) || 0, 42 * strength, 12);
  if (!visible) {
    return;
  }

  ctx.save();
  drawContactBloom(ctx, impact, progress, strength);
  drawImpactArcs(ctx, impact, progress, ram ? 0.48 : beam ? 0.24 : 0.15, strength);
  drawImpactSparks(ctx, impact, progress, ram ? 9 : beam ? 6 : 4, strength);

  if (ram) {
    drawRamSignature(ctx, impact, progress);
    const collapse = clamp(progress / 0.78, 0, 1);
    ctx.strokeStyle = "rgba(255,53,95,0.2)";
    ctx.globalAlpha = 1 - collapse;
    ctx.lineWidth = 7 + collapse * 2;
    ctx.beginPath();
    ctx.arc(
      impact.centerX,
      impact.centerY,
      impact.radius + easeOutCubic(collapse) * 18,
      0,
      TAU,
    );
    ctx.stroke();
    ctx.strokeStyle = RED;
    ctx.globalAlpha = (1 - collapse) * 0.68;
    ctx.lineWidth = 1.8 + collapse;
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
