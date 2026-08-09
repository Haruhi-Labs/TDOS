const TAU = Math.PI * 2;
const TRAIL_LIFETIME_MS = 430;
const MAX_TRAIL_POINTS = 24;
const trailByShipId = new Map();

function reducedMotionRequested() {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function recordTrailPoint(ship, now) {
  let history = trailByShipId.get(ship.id);
  if (!history) {
    history = [];
    trailByShipId.set(ship.id, history);
  }
  const latest = history.at(-1);
  if (!latest || Math.hypot(ship.x - latest.x, ship.y - latest.y) >= 2.2 || now - latest.at >= 34) {
    history.push({ x: ship.x, y: ship.y, at: now });
  }
  while (history.length > MAX_TRAIL_POINTS || (history[0] && now - history[0].at > TRAIL_LIFETIME_MS)) {
    history.shift();
  }
  return history;
}

function smoothTrailPath(ctx, points) {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const next = points[index + 1];
    ctx.quadraticCurveTo(point.x, point.y, (point.x + next.x) * 0.5, (point.y + next.y) * 0.5);
  }
  const last = points.at(-1);
  ctx.lineTo(last.x, last.y);
}

function drawTrail(ctx, ship, history, now) {
  if (history.length < 2 || reducedMotionRequested()) return;
  const points = history.filter((point) => now - point.at <= TRAIL_LIFETIME_MS);
  if (points.length < 2) return;
  const oldest = points[0];
  const newest = points.at(-1);
  const gradient = ctx.createLinearGradient(oldest.x, oldest.y, newest.x, newest.y);
  gradient.addColorStop(0, "rgba(116,0,28,0)");
  gradient.addColorStop(0.45, "rgba(220,20,58,0.16)");
  gradient.addColorStop(0.8, "rgba(255,58,91,0.52)");
  gradient.addColorStop(1, "rgba(255,192,203,0.9)");

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = "#ff244f";
  ctx.shadowBlur = 14;
  ctx.strokeStyle = gradient;
  ctx.globalAlpha = 0.42;
  ctx.lineWidth = Math.max(8, ship.radius * 1.5);
  smoothTrailPath(ctx, points);
  ctx.stroke();
  ctx.globalAlpha = 0.84;
  ctx.lineWidth = Math.max(2.4, ship.radius * 0.34);
  smoothTrailPath(ctx, points);
  ctx.stroke();
  ctx.restore();
}

function drawSpeedEnvelope(ctx, ship, radius) {
  const smearLength = Math.max(radius * 2.5, Math.min(48, (Number(ship.speed) || 0) * 0.22));
  const gradient = ctx.createLinearGradient(-smearLength, 0, radius, 0);
  gradient.addColorStop(0, "rgba(150,0,35,0)");
  gradient.addColorStop(0.56, "rgba(236,25,62,0.2)");
  gradient.addColorStop(1, "rgba(255,129,151,0.68)");
  ctx.save();
  ctx.translate(ship.x, ship.y);
  ctx.rotate(ship.angle);
  ctx.fillStyle = gradient;
  ctx.shadowColor = "#ff2d55";
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.ellipse(-smearLength * 0.37, 0, smearLength * 0.64, radius * 0.78, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

export function drawKoizumiOrb(ctx, ship, { selected = false } = {}) {
  if (!ship?.koizumiOrb?.active) return false;
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  const reducedMotion = reducedMotionRequested();
  const history = recordTrailPoint(ship, now);
  const radius = Math.max(10, Number(ship.radius) * 1.08 || 11);
  const pulse = reducedMotion ? 0.5 : 0.5 + Math.sin(now * 0.009 + Number(ship.id || 0)) * 0.5;
  const turn = Math.max(-1, Math.min(1, Number(ship.koizumiOrb.angularVelocity) / 2.2 || 0));

  drawTrail(ctx, ship, history, now);
  drawSpeedEnvelope(ctx, ship, radius);

  const glow = ctx.createRadialGradient(
    ship.x - radius * 0.28,
    ship.y - radius * 0.32,
    radius * 0.08,
    ship.x,
    ship.y,
    radius * 1.7,
  );
  glow.addColorStop(0, "rgba(255,252,247,1)");
  glow.addColorStop(0.16, "rgba(255,194,197,0.98)");
  glow.addColorStop(0.4, "rgba(255,49,82,0.96)");
  glow.addColorStop(0.72, "rgba(173,7,42,0.68)");
  glow.addColorStop(1, "rgba(87,0,25,0)");

  ctx.save();
  ctx.shadowColor = "#ff3158";
  ctx.shadowBlur = 19 + pulse * 8;
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(ship.x, ship.y, radius * 1.7, 0, TAU);
  ctx.fill();

  // 两道随转向略微偏心的能量弧，让光球有方向与滚动感，又不变成复杂的实体图案。
  ctx.translate(ship.x, ship.y);
  ctx.rotate(ship.angle + turn * 0.22);
  ctx.globalAlpha = 0.54 + pulse * 0.16;
  ctx.strokeStyle = "#ffd5da";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(0, 0, radius * 1.08, radius * 0.58, 0, -0.9, 1.45);
  ctx.stroke();
  ctx.globalAlpha = 0.28;
  ctx.strokeStyle = "#ff6d88";
  ctx.beginPath();
  ctx.ellipse(0, 0, radius * 0.78, radius * 1.16, turn * 0.3, 1.5, 4.15);
  ctx.stroke();

  if (ship.koizumiOrb.phase === "returning") {
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = "#fff1f2";
    ctx.setLineDash([3, 5]);
    ctx.lineDashOffset = -now * 0.018;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.42, 0, TAU);
    ctx.stroke();
  }
  if (selected) {
    ctx.globalAlpha = 0.9;
    ctx.setLineDash([]);
    ctx.strokeStyle = "#ffe084";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, radius + 7, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
  return true;
}
