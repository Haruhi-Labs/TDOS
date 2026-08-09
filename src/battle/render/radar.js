import { DEFAULT_WORLD_SIZE, clamp } from "../../../shared/game-core.js";
import { characterShortName } from "../../i18n.js";

const TAU = Math.PI * 2;
const LOGICAL = DEFAULT_WORLD_SIZE;

function radarAngleAt(radar, elapsed) {
  const sampledAt = Number(radar?.sampledAt) || 0;
  const angularVelocity = Number(radar?.angularVelocity) || 0;
  return (Number(radar?.angle) || 0) + angularVelocity * Math.max(0, (Number(elapsed) || 0) - sampledAt);
}

function rayToRectEdge(x, y, angle, left, top, right, bottom) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const candidates = [];
  if (dx > 1e-6) candidates.push((right - x) / dx);
  if (dx < -1e-6) candidates.push((left - x) / dx);
  if (dy > 1e-6) candidates.push((bottom - y) / dy);
  if (dy < -1e-6) candidates.push((top - y) / dy);
  const distanceToEdge = Math.min(...candidates.filter((value) => value >= 0));
  return {
    x: x + dx * distanceToEdge,
    y: y + dy * distanceToEdge,
  };
}

function radarContactAlpha(contact, elapsed) {
  const detectedAt = Number(contact.detectedAt) || 0;
  const expiresAt = Number(contact.expiresAt) || detectedAt;
  if (elapsed < detectedAt || elapsed >= expiresAt) {
    return 0;
  }
  const age = elapsed - detectedAt;
  const fadeIn = clamp(age / 0.22, 0, 1);
  const fadeOut = clamp((expiresAt - elapsed) / 0.9, 0, 1);
  return fadeIn * fadeOut;
}

function traceWaterRipple(ctx, x, y, radiusX, radiusY, rotation, phase) {
  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);
  ctx.beginPath();
  const segmentCount = 32;
  for (let index = 0; index <= segmentCount; index += 1) {
    const angle = (index / segmentCount) * TAU;
    const wobble = 1 + Math.sin(angle * 3 + phase) * 0.045 + Math.sin(angle * 7 - phase * 0.7) * 0.018;
    const localX = Math.cos(angle) * radiusX * wobble;
    const localY = Math.sin(angle) * radiusY * wobble;
    const px = x + localX * cosR - localY * sinR;
    const py = y + localX * sinR + localY * cosR;
    if (index === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function drawRadarDisturbance(ctx, contact, elapsed, alpha) {
  const age = Math.max(0, elapsed - (Number(contact.detectedAt) || 0));
  const uncertainty = clamp(Number(contact.uncertainty) || 40, 18, 220);
  const clarity = clamp(Number(contact.clarity) || 0.2, 0, 1);
  const seedPhase = (Number(contact.seed) || 0) * 0.00017;
  const rotation = seedPhase % TAU;
  const drift = Math.sin(age * 1.7 + seedPhase) * Math.min(7, uncertainty * 0.035);

  ctx.save();
  ctx.translate(drift * Math.cos(rotation), drift * Math.sin(rotation));
  ctx.globalCompositeOperation = "screen";
  ctx.lineCap = "round";
  for (let ring = 0; ring < 3; ring += 1) {
    const progress = clamp(age / 2.15 - ring * 0.13, 0, 1);
    if (progress <= 0) continue;
    const radius = 8 + progress * (22 + uncertainty * 0.13);
    traceWaterRipple(
      ctx,
      contact.x,
      contact.y,
      radius,
      radius * (0.3 + ring * 0.045),
      rotation + ring * 0.18,
      age * 2.2 + seedPhase + ring,
    );
    // 用低透明宽描边托住一条清晰细线，取代高开销的逐帧模糊滤镜。
    // 远距回波仍然柔和，但水面轮廓不会糊成光团。
    ctx.globalAlpha = alpha * (0.105 - ring * 0.014) * (1 - progress * 0.3);
    ctx.strokeStyle = ring === 0 ? "#6fc7d0" : "#4f9fab";
    ctx.lineWidth = 3.1 + (1 - clarity) * 0.9;
    ctx.stroke();
    ctx.globalAlpha = alpha * (0.36 - ring * 0.06) * (1 - progress * 0.32);
    ctx.strokeStyle = ring === 0 ? "#d5f6f2" : "#8bd7dc";
    ctx.lineWidth = 0.82 + (1 - clarity) * 0.38;
    ctx.stroke();
  }
  ctx.restore();
}

function traceRadarGhostHull(ctx, scale = 1) {
  ctx.beginPath();
  ctx.moveTo(15 * scale, 0);
  ctx.lineTo(-12 * scale, -8 * scale);
  ctx.lineTo(-6 * scale, 0);
  ctx.lineTo(-12 * scale, 8 * scale);
  ctx.closePath();
}

function drawRadarAfterimage(ctx, contact, elapsed, alpha) {
  const age = Math.max(0, elapsed - (Number(contact.detectedAt) || 0));
  const clarity = clamp(Number(contact.clarity) || 0.55, 0, 1);
  const uncertainty = clamp(Number(contact.uncertainty) || 24, 10, 140);
  const pulse = 0.5 + Math.sin(age * 5.2 + (Number(contact.seed) || 0) * 0.001) * 0.5;
  const scale = 0.78 + clarity * 0.18;

  ctx.save();
  ctx.translate(contact.x, contact.y);
  ctx.rotate(Number(contact.angle) || 0);
  ctx.globalCompositeOperation = "screen";
  ctx.lineJoin = "round";
  for (let echo = 2; echo >= 0; echo -= 1) {
    const trail = echo * (5 + uncertainty * 0.025);
    ctx.save();
    ctx.translate(-trail, Math.sin(age * 3.1 + echo) * (1.1 + echo * 0.45));
    ctx.globalAlpha = alpha * (0.12 + (2 - echo) * 0.13) * (0.7 + clarity * 0.3);
    ctx.fillStyle = "#91d9dc";
    ctx.strokeStyle = echo === 0 ? "#d9ffff" : "#83cad2";
    ctx.lineWidth = echo === 0 ? 1.35 : 0.9;
    traceRadarGhostHull(ctx, scale * (1 - echo * 0.045));
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = alpha * (0.2 + clarity * 0.18);
  ctx.strokeStyle = "#a6e4e6";
  ctx.lineWidth = 0.85;
  ctx.setLineDash([2.5, 5.5]);
  ctx.beginPath();
  ctx.ellipse(contact.x, contact.y, 20 + uncertainty * 0.11 + pulse * 2, 8 + uncertainty * 0.035, 0, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);

  const roleName = contact.characterId ? characterShortName(contact.characterId, "") : "";
  if (roleName) {
    ctx.globalAlpha = alpha * (0.5 + clarity * 0.38);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = "650 13px 'Noto Sans SC','PingFang SC',sans-serif";
    const textWidth = ctx.measureText(roleName).width;
    const labelY = contact.y + 16 + uncertainty * 0.035;
    ctx.fillStyle = "rgba(5, 20, 29, 0.58)";
    ctx.fillRect(contact.x - textWidth * 0.5 - 6, labelY - 2, textWidth + 12, 17);
    ctx.fillStyle = "#d9f8f5";
    ctx.fillText(roleName, contact.x, labelY);
  }
  ctx.restore();
}

// 把权威雷达状态映射到可见画布的物理像素，供最终 WebGL 合成器生成程序化扫描光束。
// 联系点仍走共享 2D 表现层，只有连续旋转的扫线与荧光余辉交给片元着色器。
export function createYukiRadarGpuEffect(frame, view, backingScale = 1) {
  const { state, ownTeam, spectating = false, radar } = frame || {};
  if (
    spectating ||
    !state ||
    state.phase === "finished" ||
    !radar?.active ||
    !ownTeam?.ships?.main?.alive ||
    !view
  ) {
    return null;
  }

  const source = ownTeam.ships.main;
  const elapsed = Number(state.elapsed) || 0;
  const angle = radarAngleAt(radar, elapsed);
  const edge = rayToRectEdge(source.x, source.y, angle, 0, 0, LOGICAL, LOGICAL);
  const worldToPixel = (point) => ({
    x: (point.x - view.left) * view.zoom * backingScale,
    y: (point.y - view.top) * view.zoom * backingScale,
  });
  const sourcePixel = worldToPixel(source);
  const edgePixel = worldToPixel(edge);

  return {
    sourceX: sourcePixel.x,
    sourceY: sourcePixel.y,
    angle,
    length: Math.max(1, Math.hypot(edgePixel.x - sourcePixel.x, edgePixel.y - sourcePixel.y)),
    elapsed,
    angularVelocity: Number(radar.angularVelocity) || 0,
    scale: Math.max(0.5, view.zoom * backingScale),
  };
}

// 长门旗舰私有雷达：只消费调用方显式传入的 frame.radar。联机对手与观战帧不带此字段，
// 因而既看不到扫线，也看不到任何回波；回波也从不参与 visibleEnemyIds。
export function drawYukiRadar(ctx, frame) {
  const { state, ownTeam, spectating = false, radar } = frame;
  if (spectating || !state || state.phase === "finished" || !radar?.active || !ownTeam?.ships?.main?.alive) {
    return;
  }
  const source = ownTeam.ships.main;
  const elapsed = Number(state.elapsed) || 0;
  const angle = radarAngleAt(radar, elapsed);
  const edge = rayToRectEdge(source.x, source.y, angle, 0, 0, LOGICAL, LOGICAL);

  // GPU 路径由可见 WebGL 画布的片元着色器绘制；只有无 WebGL 的极端应急路径
  // 才保留原来的 2D 资讯扫描束，保证能力降级时雷达仍可读。
  if (!frame.gpuRadar) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, LOGICAL, LOGICAL);
  ctx.clip();
  ctx.globalCompositeOperation = "screen";

  const rayGradient = ctx.createLinearGradient(source.x, source.y, edge.x, edge.y);
  rayGradient.addColorStop(0, "rgba(220, 255, 248, 0.82)");
  rayGradient.addColorStop(0.5, "rgba(126, 237, 224, 0.62)");
  rayGradient.addColorStop(1, "rgba(61, 170, 190, 0.08)");
  const rayDx = edge.x - source.x;
  const rayDy = edge.y - source.y;
  const rayLength = Math.max(1, Math.hypot(rayDx, rayDy));
  const normalX = -rayDy / rayLength;
  const normalY = rayDx / rayLength;

  // 资讯扫描束：不使用扇形铺色，以一条高精度亮芯、两条异步数据轨和离散校准节点
  // 构成扫描线本体，保持科技感的同时不遮盖战区信息。
  ctx.lineCap = "round";
  ctx.strokeStyle = rayGradient;
  ctx.globalAlpha = 0.2;
  ctx.lineWidth = 4.2;
  ctx.beginPath();
  ctx.moveTo(source.x, source.y);
  ctx.lineTo(edge.x, edge.y);
  ctx.stroke();

  ctx.globalAlpha = 0.92;
  ctx.lineWidth = 0.82;
  ctx.stroke();

  for (const rail of [-1, 1]) {
    const railOffset = rail * 4.3;
    ctx.strokeStyle = rail < 0 ? "rgba(191, 255, 245, 0.72)" : "rgba(89, 214, 217, 0.62)";
    ctx.globalAlpha = 0.46;
    ctx.lineWidth = 0.68;
    ctx.setLineDash(rail < 0 ? [9, 6, 2, 5] : [3, 5, 12, 7]);
    ctx.lineDashOffset = elapsed * (rail < 0 ? -34 : 27);
    ctx.beginPath();
    ctx.moveTo(source.x + normalX * railOffset, source.y + normalY * railOffset);
    ctx.lineTo(edge.x + normalX * railOffset, edge.y + normalY * railOffset);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;

  ctx.strokeStyle = "#b9f8ef";
  ctx.fillStyle = "#d9fff8";
  for (const [index, fraction] of [0.14, 0.28, 0.45, 0.64, 0.83].entries()) {
    const x = source.x + rayDx * fraction;
    const y = source.y + rayDy * fraction;
    const side = index % 2 === 0 ? 1 : -1;
    const tickInner = 2.1;
    const tickOuter = 7.2 + fraction * 2.8;
    ctx.globalAlpha = 0.54 - fraction * 0.24;
    ctx.lineWidth = 0.72;
    ctx.beginPath();
    ctx.moveTo(x + normalX * tickInner * side, y + normalY * tickInner * side);
    ctx.lineTo(x + normalX * tickOuter * side, y + normalY * tickOuter * side);
    ctx.lineTo(
      x + normalX * tickOuter * side - Math.cos(angle) * 3.2,
      y + normalY * tickOuter * side - Math.sin(angle) * 3.2,
    );
    ctx.stroke();
  }

  for (const [packetIndex, phaseOffset] of [0, 0.31, 0.67].entries()) {
    const packetFraction = (elapsed * 0.22 + phaseOffset) % 1;
    const packetX = source.x + rayDx * packetFraction;
    const packetY = source.y + rayDy * packetFraction;
    const packetRadius = 3.5 - packetFraction * 0.75;
    const packetPulse = 0.72 + Math.sin(elapsed * 7.5 + packetIndex * 2.1) * 0.28;
    ctx.globalAlpha = packetPulse * (0.72 - packetFraction * 0.38);
    ctx.lineWidth = 0.72;
    ctx.strokeStyle = "#bafff4";
    ctx.beginPath();
    ctx.moveTo(packetX - normalX * 6.4, packetY - normalY * 6.4);
    ctx.lineTo(packetX + normalX * 6.4, packetY + normalY * 6.4);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(packetX + Math.cos(angle) * packetRadius, packetY + Math.sin(angle) * packetRadius);
    ctx.lineTo(packetX + normalX * packetRadius, packetY + normalY * packetRadius);
    ctx.lineTo(packetX - Math.cos(angle) * packetRadius, packetY - Math.sin(angle) * packetRadius);
    ctx.lineTo(packetX - normalX * packetRadius, packetY - normalY * packetRadius);
    ctx.closePath();
    ctx.fill();
  }

  const sourcePulse = 0.5 + Math.sin(elapsed * 2.4) * 0.5;
  ctx.globalAlpha = 0.38;
  ctx.strokeStyle = "#a9ece4";
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.arc(source.x, source.y, 11 + sourcePulse * 2.5, angle + 0.35, angle + Math.PI * 1.65);
  ctx.stroke();
  ctx.globalAlpha = 0.22;
  ctx.beginPath();
  ctx.arc(source.x, source.y, 17 + sourcePulse * 2, angle + 1.1, angle + Math.PI * 1.25);
  ctx.stroke();
  ctx.restore();
  }

  const visibleEnemyIds = frame.visibleEnemyIds || new Set();
  for (const contact of radar.contacts || []) {
    if (!contact || visibleEnemyIds.has(contact.targetId)) {
      continue;
    }
    const alpha = radarContactAlpha(contact, elapsed);
    if (alpha <= 0) {
      continue;
    }
    if (contact.kind === "afterimage") {
      drawRadarAfterimage(ctx, contact, elapsed, alpha);
    } else {
      drawRadarDisturbance(ctx, contact, elapsed, alpha);
    }
  }
}

// 移动端镜头一次只覆盖局部战场，因此在小地图保留克制的雷达扫线与回波。
// 小地图只把矩形映射交给雷达模块；私有几何与回波淡出逻辑不向通用渲染层泄漏。
export function drawYukiRadarMinimap(ctx, frame, rect) {
  const { state, ownTeam, spectating = false, radar } = frame;
  if (
    spectating ||
    !state ||
    state.phase === "finished" ||
    !radar?.active ||
    !ownTeam?.ships?.main?.alive ||
    !rect
  ) {
    return;
  }

  const visibleEnemyIds = frame.visibleEnemyIds || new Set();
  const source = ownTeam.ships.main;
  const elapsed = Number(state.elapsed) || 0;
  const sourceX = rect.x + (source.x / LOGICAL) * rect.width;
  const sourceY = rect.y + (source.y / LOGICAL) * rect.height;
  const angle = radarAngleAt(radar, elapsed);
  const edge = rayToRectEdge(sourceX, sourceY, angle, rect.x, rect.y, rect.x + rect.width, rect.y + rect.height);

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.26;
  ctx.strokeStyle = "#9be7df";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(sourceX, sourceY);
  ctx.lineTo(edge.x, edge.y);
  ctx.stroke();
  ctx.globalAlpha = 0.34;
  ctx.beginPath();
  ctx.arc(sourceX, sourceY, 2.2, 0, TAU);
  ctx.stroke();

  for (const contact of radar.contacts || []) {
    if (!contact || visibleEnemyIds.has(contact.targetId)) continue;
    const alpha = radarContactAlpha(contact, elapsed);
    if (alpha <= 0) continue;
    const x = rect.x + (contact.x / LOGICAL) * rect.width;
    const y = rect.y + (contact.y / LOGICAL) * rect.height;
    ctx.globalAlpha = alpha * (contact.kind === "afterimage" ? 0.62 : 0.34);
    ctx.strokeStyle = contact.kind === "afterimage" ? "#d2f7ef" : "#7ccbd3";
    ctx.lineWidth = contact.kind === "afterimage" ? 1.1 : 0.75;
    ctx.beginPath();
    if (contact.kind === "afterimage") {
      ctx.moveTo(x + 3.5, y);
      ctx.lineTo(x - 2.5, y - 2.1);
      ctx.lineTo(x - 1.1, y);
      ctx.lineTo(x - 2.5, y + 2.1);
      ctx.closePath();
    } else {
      ctx.ellipse(x, y, 4.2, 1.7, 0, 0, TAU);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// showKnob:桌面端为选中航线画可拖拽的曲度旋钮与控制多边形(移动端不可拖,不画)
