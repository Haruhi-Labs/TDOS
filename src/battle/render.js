// 共享战场渲染层:单人(solo.js)与在线(online.js)共用的全部画布绘制代码。
//
// 约定:
//  - 所有绘制函数第一个参数是 ctx,战场数据一律显式传入,不读各模式自己的模块级状态;
//    单人传本地仿真序列化状态,在线传「插值快照 + 本地航线覆盖」合并后的显示状态,
//    渲染层不感知状态来源,这是两种模式表现保持一致的关键。
//  - 表现基准以单人版为权威;要给战场加视觉效果,只改这里,两种模式天然同步。
//  - solo.js / online.js 内不允许再出现与本文件同名的绘制函数(scripts/check-battle-drift.mjs 把关)。

import { DEFAULT_WORLD_SIZE, FIRE_ARC_BANDS, clamp, quadraticPoint } from "../../shared/game-core.js";
import { characterShortName, localizeFloatingText, t } from "../i18n.js";
import { drawShipDestructionEffects, syncShipDestructionEffects } from "../ship-destruction-effects.js";

const TAU = Math.PI * 2;
const LOGICAL = DEFAULT_WORLD_SIZE;

// 航线终点/控制点把手的可视半径,画布命中检测(routeHandleAtPoint)也用它,保证「看见多大就能点多大」
export const ROUTE_HANDLE_RADIUS = 11;

// 队伍的全部舰船:三条编制舰 + 技能产生的额外舰(如双子舰),额外舰同样可选中/有航线
function teamAllShips(team) {
  if (!team || !team.ships) {
    return [];
  }
  return [...Object.values(team.ships), ...(team.extraShips || [])];
}

// 背景渐变不随帧变化,按 ctx 缓存,省去每帧重建
const backgroundGradientCache = new WeakMap();

export function drawBackground(ctx, stars, elapsed) {
  let gradient = backgroundGradientCache.get(ctx);
  if (!gradient) {
    gradient = ctx.createLinearGradient(0, 0, LOGICAL, LOGICAL);
    gradient.addColorStop(0, "#040d18");
    gradient.addColorStop(0.5, "#071423");
    gradient.addColorStop(1, "#050b14");
    backgroundGradientCache.set(ctx, gradient);
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, LOGICAL, LOGICAL);

  for (const star of stars || []) {
    const alpha = 0.24 + Math.sin(elapsed * 1.6 + star.p) * 0.24 + 0.34;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#b7dbff";
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.r, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function drawZones(ctx, state, selectedZoneId) {
  if (!state || !state.zones) {
    return;
  }
  for (const zone of state.zones) {
    const selected = zone.id === selectedZoneId;
    ctx.strokeStyle = selected ? "#4ec9ff99" : "#2d5d884f";
    ctx.lineWidth = selected ? 2 : 1;
    ctx.strokeRect(zone.x, zone.y, zone.width, zone.height);

    ctx.fillStyle = selected ? "#76d6ff" : "#5f8ab8";
    ctx.font = "bold 14px 'Noto Sans SC', 'PingFang SC', sans-serif";
    ctx.fillText(t("战区 {zone}", { zone: zone.id }), zone.x + 10, zone.y + 20);
  }
}

// showKnob:桌面端为选中航线画可拖拽的曲度旋钮与控制多边形(移动端不可拖,不画)
export function drawRoute(ctx, route, selected, time = 0, showKnob = true) {
  if (!route) {
    return;
  }

  const { p0, p1, p2 } = route;
  // 末段切线(二次贝塞尔在 t=1 的方向 ∝ p2-p1)→ 航向,用于终点箭头朝向
  let hx = p2.x - p1.x;
  let hy = p2.y - p1.y;
  if (Math.hypot(hx, hy) < 1e-3) {
    hx = p2.x - p0.x;
    hy = p2.y - p0.y;
  }
  const heading = Math.atan2(hy, hx);

  // 沿航线描一条二次曲线路径(供多次不同样式描边复用)
  const tracePath = () => {
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y);
  };

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // 航线主体:渐变虚线 + 同步发光虚线,沿航向缓缓流动(轻盈好看,并传达方向)
  const dash = [11, 9];
  const dashOffset = -time * 28;

  // ① 发光虚线:宽而透明,让航线在星空背景上"浮起来"
  ctx.setLineDash(dash);
  ctx.lineDashOffset = dashOffset;
  ctx.lineWidth = selected ? 7.5 : 5;
  ctx.strokeStyle = selected ? "#39d8ff33" : "#39d8ff1f";
  tracePath();
  ctx.stroke();

  // ② 主虚线:从舰身青 → 目标薄荷的渐变
  const grad = ctx.createLinearGradient(p0.x, p0.y, p2.x, p2.y);
  grad.addColorStop(0, selected ? "#7ce6ff" : "#6fcdeecc");
  grad.addColorStop(1, selected ? "#a9f7d2" : "#86dcc0cc");
  ctx.lineWidth = selected ? 2.8 : 2.0;
  ctx.strokeStyle = grad;
  ctx.setLineDash(dash);
  ctx.lineDashOffset = dashOffset;
  tracePath();
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;

  if (selected) {
    // ④ 终点:目标十字标记(环 + 四向刻度 + 心点 + 航向箭头),清楚地读作"到这里"
    drawTargetMarker(ctx, p2, heading, time);

    // ⑤ 进度点:沿曲线滑动的亮点,表示当前推进位置
    const progressPoint = quadraticPoint(p0, p1, p2, clamp(route.t || 0, 0, 1));
    ctx.fillStyle = "#39d8ff44";
    ctx.beginPath();
    ctx.arc(progressPoint.x, progressPoint.y, 6, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(progressPoint.x, progressPoint.y, 3, 0, TAU);
    ctx.fill();

    // ⑥ 控制点 + 控制多边形(仅桌面可拖拽):琥珀色"旋钮",一眼可抓
    if (showKnob) {
      ctx.lineWidth = 1.1;
      ctx.strokeStyle = "#ffd9912e";
      ctx.setLineDash([2, 6]);
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      ctx.setLineDash([]);
      drawCurveKnob(ctx, p1);
    }
  }

  ctx.restore();
}

// 目标十字标记:柔光底 + 外环(带呼吸脉冲)+ 四向刻度 + 中心点 + 航向箭头
export function drawTargetMarker(ctx, p, heading, time) {
  const r = ROUTE_HANDLE_RADIUS + 1;
  const pulse = 0.5 + 0.5 * Math.sin(time * 3.0);

  ctx.save();
  ctx.lineCap = "round";

  // 柔光底
  ctx.fillStyle = "#7df7c024";
  ctx.beginPath();
  ctx.arc(p.x, p.y, r + 5, 0, TAU);
  ctx.fill();

  // 外环(脉冲)
  ctx.strokeStyle = "#8af7c0";
  ctx.lineWidth = 2.2;
  ctx.globalAlpha = 0.75 + pulse * 0.25;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r + pulse * 2.2, 0, TAU);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // 四向刻度
  ctx.strokeStyle = "#cfffe6";
  ctx.lineWidth = 1.8;
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    ctx.beginPath();
    ctx.moveTo(p.x + ca * (r + 3), p.y + sa * (r + 3));
    ctx.lineTo(p.x + ca * (r + 7), p.y + sa * (r + 7));
    ctx.stroke();
  }

  // 中心点
  ctx.fillStyle = "#eafff5";
  ctx.beginPath();
  ctx.arc(p.x, p.y, 2.6, 0, TAU);
  ctx.fill();

  // 航向箭头(指向行进方向,落在环外)
  ctx.save();
  ctx.translate(p.x + Math.cos(heading) * (r + 11), p.y + Math.sin(heading) * (r + 11));
  ctx.rotate(heading);
  ctx.fillStyle = "#8af7c0";
  ctx.beginPath();
  ctx.moveTo(6, 0);
  ctx.lineTo(-4, -4.2);
  ctx.lineTo(-1.6, 0);
  ctx.lineTo(-4, 4.2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.restore();
}

// 曲度控制旋钮:柔光底 + 琥珀环 + 中心点,读作"可拖拽手柄"
export function drawCurveKnob(ctx, p) {
  ctx.save();
  ctx.fillStyle = "#ffd29120";
  ctx.beginPath();
  ctx.arc(p.x, p.y, ROUTE_HANDLE_RADIUS + 4, 0, TAU);
  ctx.fill();

  ctx.fillStyle = "#1b1305cc";
  ctx.beginPath();
  ctx.arc(p.x, p.y, ROUTE_HANDLE_RADIUS, 0, TAU);
  ctx.fill();

  ctx.strokeStyle = "#ffd27a";
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(p.x, p.y, ROUTE_HANDLE_RADIUS, 0, TAU);
  ctx.stroke();

  ctx.fillStyle = "#ffe6b0";
  ctx.beginPath();
  ctx.arc(p.x, p.y, 3.4, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function shipHullDrawScale(ship) {
  const baseScale = ship.key === "main" ? 0.72 : ship.key === "twin" ? 0.56 : 0.62;
  const baseRadius = ship.key === "main" ? 10 : ship.key === "twin" ? 8 : 9;
  return baseScale * ((ship.radius || baseRadius) / baseRadius);
}

// 刀锋女王光环:四段旋转猩红刀弧 + 脉动内圈柔光,标示朝仓进入无视碰撞的切割态
export function drawBladeQueenAura(ctx, ship) {
  const now = performance.now();
  const spin = now * 0.0065;
  const pulse = 0.6 + Math.sin(now * 0.012 + (ship.id || 0)) * 0.4;
  const r = ship.radius + 7 + pulse * 3;
  ctx.save();
  ctx.translate(ship.x, ship.y);
  ctx.rotate(spin);
  ctx.lineCap = "round";
  ctx.strokeStyle = "#ff2d55";
  ctx.globalAlpha = 0.55 + pulse * 0.35;
  ctx.lineWidth = 2.2;
  for (let k = 0; k < 4; k += 1) {
    const a0 = (k / 4) * TAU;
    ctx.beginPath();
    ctx.arc(0, 0, r, a0, a0 + TAU * 0.16);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.16 * pulse;
  ctx.lineWidth = 3.4;
  ctx.strokeStyle = "#ff8aa0";
  ctx.beginPath();
  ctx.arc(0, 0, r - 2, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

// 舰船下方的科技感角色名牌:半透明深色托底 + 队伍色 HUD 顶边线 + 辉光亮字 + 字距,大写更硬朗
// accent = 该舰队伍色(己方青/敌方红),用于边框与辉光,区分敌我
export function drawShipNameLabel(ctx, ship, accent) {
  const name = characterShortName(ship.characterId, ship.characterName || ship.name || "");
  if (!name) {
    return;
  }
  const label = String(name).toUpperCase();
  const cx = ship.x;
  const topY = ship.y + ship.radius + 9; // 舰体正下方,避开上方血条/能量条
  const fontSize = 12;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = `600 ${fontSize}px 'Noto Sans SC','PingFang SC',sans-serif`;
  if ("letterSpacing" in ctx) {
    ctx.letterSpacing = "1px";
  }
  const padX = 7;
  const padY = 3;
  const textW = ctx.measureText(label).width;
  const boxW = textW + padX * 2;
  const boxH = fontSize + padY * 2;
  const boxX = cx - boxW / 2;
  const r = 3;
  // 圆角托底
  ctx.beginPath();
  ctx.moveTo(boxX + r, topY);
  ctx.arcTo(boxX + boxW, topY, boxX + boxW, topY + boxH, r);
  ctx.arcTo(boxX + boxW, topY + boxH, boxX, topY + boxH, r);
  ctx.arcTo(boxX, topY + boxH, boxX, topY, r);
  ctx.arcTo(boxX, topY, boxX + boxW, topY, r);
  ctx.closePath();
  ctx.fillStyle = "rgba(6,14,26,0.62)";
  ctx.fill();
  // 边框 + 顶边高光,取队伍色
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.5;
  ctx.stroke();
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.moveTo(boxX + 3, topY + 0.5);
  ctx.lineTo(boxX + boxW - 3, topY + 0.5);
  ctx.stroke();
  // 名字:近白 + 队伍色辉光
  ctx.globalAlpha = 1;
  ctx.shadowColor = accent;
  ctx.shadowBlur = 5;
  ctx.fillStyle = "#eef6ff";
  ctx.fillText(label, cx, topY + padY);
  ctx.restore();
}

// forceName:观战模式下双方名牌常驻(观众没有"己方",需要清楚看到每艘舰是谁)
export function drawShip(ctx, ship, color, selected, attached, isEnemy = false, forceName = false) {
  if (!ship || !ship.alive) {
    return;
  }

  if (ship.bladeQueen) {
    drawBladeQueenAura(ctx, ship);
  }

  ctx.save();
  ctx.translate(ship.x, ship.y);
  ctx.rotate(ship.angle);

  const hullScale = shipHullDrawScale(ship);
  ctx.globalAlpha = attached ? 0.84 : 1;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(16 * hullScale, 0);
  ctx.lineTo(-13 * hullScale, -10 * hullScale);
  ctx.lineTo(-6 * hullScale, 0);
  ctx.lineTo(-13 * hullScale, 10 * hullScale);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "#ffffffaa";
  ctx.lineWidth = 1;
  ctx.stroke();

  if (selected) {
    ctx.strokeStyle = "#ffe084";
    ctx.lineWidth = 1.9;
    ctx.beginPath();
    ctx.arc(0, 0, ship.radius + 4, 0, TAU);
    ctx.stroke();
  }

  ctx.restore();

  const hpRatio = clamp((ship.hp || 0) / Math.max(1, ship.maxHp || 1), 0, 1);
  const energyRatio = clamp((ship.energy || 0) / Math.max(1, ship.maxEnergy || 1), 0, 1);
  const barWidth = Math.max(26, ship.radius * 2.5);
  const barLeft = ship.x - barWidth * 0.5;
  ctx.fillStyle = "#0f1f31";
  ctx.fillRect(barLeft, ship.y - ship.radius - 10, barWidth, 4);
  ctx.fillStyle = hpRatio > 0.35 ? "#72f5a8" : "#ff8a8a";
  ctx.fillRect(barLeft, ship.y - ship.radius - 10, barWidth * hpRatio, 4);
  ctx.fillStyle = "#10263d";
  ctx.fillRect(barLeft, ship.y - ship.radius - 4, barWidth, 3);
  ctx.fillStyle = "#6ad8ff";
  ctx.fillRect(barLeft, ship.y - ship.radius - 4, barWidth * energyRatio, 3);

  // 名牌:己方「已出列/独立」舰船常驻显示(附着编队内的副舰不显示,避免挤成一团);
  // 敌方默认隐藏名字,仅当其名字已永久暴露(曾在我方视野中施放技能)时才显示。
  if (forceName || (!attached && (!isEnemy || ship.nameRevealed))) {
    drawShipNameLabel(ctx, ship, color);
  }
}

export function drawScout(ctx, scout, isOwnTeam) {
  if (!scout || !scout.alive) {
    return;
  }

  if (Number.isFinite(scout.vision) && scout.vision > 0) {
    ctx.save();
    ctx.strokeStyle = isOwnTeam ? "#8adfff40" : "#ffb7c040";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(scout.x, scout.y, scout.vision, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.translate(scout.x, scout.y);
  ctx.rotate(scout.angle || 0);
  ctx.fillStyle = isOwnTeam ? "#9de8ff" : "#ffb7c0";
  ctx.beginPath();
  ctx.moveTo(5, 0);
  ctx.lineTo(0, -3);
  ctx.lineTo(-5, 0);
  ctx.lineTo(0, 3);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function drawWingman(ctx, wingman, isOwnTeam) {
  if (!wingman || !wingman.alive) {
    return;
  }
  ctx.save();
  ctx.translate(wingman.x, wingman.y);
  ctx.rotate(wingman.angle || 0);
  ctx.fillStyle = isOwnTeam ? "#ffe7aa" : "#ffc6b3";
  ctx.beginPath();
  ctx.moveTo(6, 0);
  ctx.lineTo(-4, -3);
  ctx.lineTo(-2, 0);
  ctx.lineTo(-4, 3);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function drawBeam(ctx, beam) {
  if (!beam) {
    return;
  }
  const phase = beam.phase || "fire";
  const maxLife = Math.max(0.001, Number(beam.maxLife) || (phase === "charge" ? 1.05 : 0.26));
  const alpha = clamp((beam.life || 0) / maxLife, 0, 1);
  if (alpha <= 0) {
    return;
  }

  if (phase === "charge") {
    const progress = Number.isFinite(beam.progress) ? clamp(beam.progress, 0, 1) : clamp(1 - alpha, 0, 1);
    const pulse = 0.55 + Math.sin(performance.now() * 0.02 + (beam.id || 0)) * 0.45;
    const glow = 9 + progress * 22 + pulse * 4;

    ctx.save();
    ctx.globalAlpha = 0.14 + progress * 0.28;
    ctx.strokeStyle = beam.color || "#8ef8ff";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([7, 6]);
    ctx.beginPath();
    ctx.moveTo(beam.x1, beam.y1);
    ctx.lineTo(beam.x2, beam.y2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.globalAlpha = 0.35 + progress * 0.4;
    ctx.beginPath();
    ctx.arc(beam.x1, beam.y1, glow, 0, TAU);
    ctx.strokeStyle = "#8ef8ff";
    ctx.lineWidth = 1.8;
    ctx.stroke();

    ctx.globalAlpha = 0.22 + progress * 0.45;
    ctx.beginPath();
    ctx.arc(beam.x1, beam.y1, 4.5 + pulse * 3.5, 0, TAU);
    ctx.fillStyle = "#dfffff";
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = beam.color || "#8ef8ff";
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(beam.x1, beam.y1);
  ctx.lineTo(beam.x2, beam.y2);
  ctx.stroke();
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = "#ffffff";
  ctx.globalAlpha = alpha * 0.7;
  ctx.stroke();
  ctx.restore();
}

export function drawProjectile(ctx, projectile, isOwnTeam) {
  if (!projectile || !projectile.alive) {
    return;
  }
  const color = projectile.color || (isOwnTeam ? "#9be8ff" : "#ffc0bd");
  ctx.save();

  // 弹道尾迹:沿飞行反方向拖一段渐隐短线,高速弹更长;让 20Hz 快照下的子弹运动读起来连贯
  const speed = Number(projectile.speed) || 0;
  const dx = (projectile.targetX ?? projectile.x) - projectile.x;
  const dy = (projectile.targetY ?? projectile.y) - projectile.y;
  const dist = Math.hypot(dx, dy);
  if (speed > 0 && dist > 1e-3) {
    const trailLen = clamp(speed * 0.05, 6, 16);
    const tx = projectile.x - (dx / dist) * trailLen;
    const ty = projectile.y - (dy / dist) * trailLen;
    const grad = ctx.createLinearGradient(tx, ty, projectile.x, projectile.y);
    grad.addColorStop(0, "transparent");
    grad.addColorStop(1, color);
    ctx.strokeStyle = grad;
    ctx.lineWidth = Math.max(1.4, (projectile.radius || 2) * 0.9);
    ctx.lineCap = "round";
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(projectile.x, projectile.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(projectile.x, projectile.y, projectile.radius || 2, 0, TAU);
  ctx.fill();
  ctx.restore();
}

export function drawBurst(ctx, burst) {
  if (!burst) {
    return;
  }
  const alpha = clamp((burst.life || 0) / 0.35, 0, 1);
  if (alpha <= 0) {
    return;
  }
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(burst.x, burst.y, burst.radius || 7, 0, TAU);
  ctx.strokeStyle = burst.color || "#ffdb9b";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

export function drawFloatingText(ctx, label) {
  if (!label) {
    return;
  }
  const alpha = clamp((label.life || 0) / 0.8, 0, 1);
  if (alpha <= 0) {
    return;
  }
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = label.color || "#ffd178";
  ctx.font = "bold 12px 'Noto Sans SC', 'PingFang SC', sans-serif";
  ctx.fillText(localizeFloatingText(label), label.x, label.y);
  ctx.restore();
}

export function drawSelectedVisionCircle(ctx, team, shipKey) {
  if (!team || !team.ships) {
    return;
  }
  const selected = team.ships[shipKey];
  if (!selected || !selected.alive || !selected.vision) {
    return;
  }
  ctx.save();
  ctx.strokeStyle = "#8adfff3a";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(selected.x, selected.y, selected.vision, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

// 观战专用:整支舰队的视野圈,让观众直观看到双方侦察态势
export function drawTeamVisionCircles(ctx, team, color) {
  if (!team || !team.ships) {
    return;
  }
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  for (const ship of teamAllShips(team)) {
    if (!ship || !ship.alive || !ship.vision) {
      continue;
    }
    ctx.beginPath();
    ctx.arc(ship.x, ship.y, ship.vision, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFireArcBand(ctx, ship, startDeg, endDeg, outerRadius, innerRadius, color, alpha = 0.2) {
  const start = ship.angle + (startDeg * Math.PI) / 180;
  const end = ship.angle + (endDeg * Math.PI) / 180;
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(ship.x, ship.y, outerRadius, start, end);
  ctx.arc(ship.x, ship.y, innerRadius, end, start, true);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawFireArcLabel(ctx, ship, offsetDeg, radius, text, color) {
  const angle = ship.angle + (offsetDeg * Math.PI) / 180;
  const x = ship.x + Math.cos(angle) * radius;
  const y = ship.y + Math.sin(angle) * radius;
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = "bold 10px 'Noto Sans SC', 'PingFang SC', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
  ctx.restore();
}

export function drawSelectedFireArc(ctx, team, shipKey) {
  if (!team || !team.ships) {
    return;
  }
  const ship = team.ships[shipKey];
  if (!ship || !ship.alive) {
    return;
  }

  const outerRadius = clamp((ship.range || 0) * 0.22, 84, 124);
  const innerRadius = ship.radius + 14;
  const labelRadius = outerRadius - 12;

  if (team.loadout && team.loadout.main === "kyon") {
    drawFireArcBand(ctx, ship, -180, 180, outerRadius, innerRadius, "#7de4ff", 0.14);
    drawFireArcLabel(ctx, ship, 0, labelRadius, "×1.5", "#b9f4ff");
    return;
  }

  for (const band of FIRE_ARC_BANDS) {
    let color = "#7bd8ff";
    let alpha = 0.14;
    if (band.multiplier === 1.5) {
      color = "#ffd56c";
      alpha = 0.24;
    } else if (band.multiplier === 0) {
      color = "#ff6e6e";
      alpha = 0.16;
    }
    drawFireArcBand(ctx, ship, band.startDeg, band.endDeg, outerRadius, innerRadius, color, alpha);
  }

  ctx.save();
  ctx.strokeStyle = "#d2f3ff66";
  ctx.lineWidth = 1;
  for (const boundaryDeg of [-150, -120, -60, 60, 120, 150, 180]) {
    const angle = ship.angle + (boundaryDeg * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(ship.x + Math.cos(angle) * innerRadius, ship.y + Math.sin(angle) * innerRadius);
    ctx.lineTo(ship.x + Math.cos(angle) * outerRadius, ship.y + Math.sin(angle) * outerRadius);
    ctx.stroke();
  }
  ctx.restore();

  drawFireArcLabel(ctx, ship, 0, labelRadius, "1x", "#bfefff");
  drawFireArcLabel(ctx, ship, 90, labelRadius, "1.5x", "#ffe7a1");
  drawFireArcLabel(ctx, ship, -90, labelRadius, "1.5x", "#ffe7a1");
  drawFireArcLabel(ctx, ship, 135, labelRadius, "1x", "#bfefff");
  drawFireArcLabel(ctx, ship, -135, labelRadius, "1x", "#bfefff");
  drawFireArcLabel(ctx, ship, 180, labelRadius, "0x", "#ffb0b0");
}

// 副技能瞄准提示:从待瞄准舰到指针的虚线
export function drawSubSkillAimHint(ctx, team, pendingAim, pointer) {
  if (!pendingAim || !pointer || !team || !team.ships) {
    return;
  }
  const ship = team.ships[pendingAim.shipKey];
  if (!ship || !ship.alive || ship.attached) {
    return;
  }
  ctx.save();
  ctx.strokeStyle = "#7ff4ff";
  ctx.lineWidth = 1.6;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(ship.x, ship.y);
  ctx.lineTo(pointer.x, pointer.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

// 移动端小地图:战区网格 + 敌我舰点(敌方按视野裁剪,观战全显)+ 当前镜头框。
// rect 来自各模式的 minimapRect(),view 来自 currentViewState(),均为屏幕/逻辑坐标。
export function drawMinimap(ctx, frame, rect, view) {
  const { state, ownTeam, enemyTeam, spectating = false } = frame;
  if (!frame.mobileMode || !state || !rect || !view) {
    return;
  }
  const selectedKeyForTeam = frame.selectedKeyForTeam || (() => null);
  const visibleEnemyIds = frame.visibleEnemyIds || new Set();
  const revealAll = spectating || state.phase === "finished";

  ctx.save();
  ctx.fillStyle = "#06121fda";
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.strokeStyle = "#285279";
  ctx.lineWidth = 2;
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

  if (Array.isArray(state.zones)) {
    for (const zone of state.zones) {
      const zx = rect.x + (zone.x / LOGICAL) * rect.width;
      const zy = rect.y + (zone.y / LOGICAL) * rect.height;
      const zw = (zone.width / LOGICAL) * rect.width;
      const zh = (zone.height / LOGICAL) * rect.height;
      ctx.strokeStyle = zone.id === frame.selectedZoneId ? "#6fd9ff" : "#2d5d884f";
      ctx.lineWidth = zone.id === frame.selectedZoneId ? 1.6 : 1;
      ctx.strokeRect(zx, zy, zw, zh);
    }
  }

  const plotShip = (ship, color) => {
    if (!ship || !ship.alive) {
      return;
    }
    const x = rect.x + (ship.x / LOGICAL) * rect.width;
    const y = rect.y + (ship.y / LOGICAL) * rect.height;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 3.2, 0, TAU);
    ctx.fill();
  };

  const ownSelectedKey = selectedKeyForTeam(ownTeam);
  for (const ship of teamAllShips(ownTeam)) {
    plotShip(ship, ship.key === ownSelectedKey ? "#ffe184" : "#79dcff");
  }
  const enemySelectedKey = selectedKeyForTeam(enemyTeam);
  for (const ship of teamAllShips(enemyTeam)) {
    if (!revealAll && !visibleEnemyIds.has(ship.id)) {
      continue;
    }
    plotShip(ship, ship.key === enemySelectedKey ? "#ffe184" : "#ff95a0");
  }

  ctx.strokeStyle = "#ffe08a";
  ctx.lineWidth = 1.6;
  ctx.strokeRect(
    rect.x + (view.left / LOGICAL) * rect.width,
    rect.y + (view.top / LOGICAL) * rect.height,
    (view.width / LOGICAL) * rect.width,
    (view.height / LOGICAL) * rect.height,
  );

  ctx.fillStyle = "#d2ecff";
  ctx.font = "bold 11px 'Noto Sans SC', 'PingFang SC', sans-serif";
  ctx.fillText(t("战区/镜头"), rect.x + 8, rect.y + 14);
  ctx.restore();
}

// 在线模式:快照缓冲尚未就绪时的等待提示
export function drawNoDataHint(ctx) {
  ctx.save();
  ctx.fillStyle = "#c4dbf6";
  ctx.font = "16px 'Noto Sans SC', 'PingFang SC', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(t("等待网络同步数据..."), LOGICAL * 0.5, LOGICAL * 0.5);
  ctx.restore();
}

// 联机 PvP 开局倒计时：服务端冻结模拟期间压暗战场，并以三拍圆环明确传达开战时点。
export function drawBattleCountdown(ctx, remainingMs) {
  const safeRemaining = clamp(Number(remainingMs) || 0, 0, 3000);
  const count = Math.max(1, Math.ceil(safeRemaining / 1000));
  const progress = 1 - safeRemaining / 3000;
  const cx = LOGICAL * 0.5;
  const cy = LOGICAL * 0.5;

  ctx.save();
  ctx.fillStyle = "rgba(2, 8, 18, 0.58)";
  ctx.fillRect(0, 0, LOGICAL, LOGICAL);

  ctx.fillStyle = "rgba(7, 22, 42, 0.9)";
  ctx.beginPath();
  ctx.arc(cx, cy, 92, 0, TAU);
  ctx.fill();

  ctx.strokeStyle = "rgba(121, 220, 255, 0.24)";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(cx, cy, 78, -Math.PI * 0.5, TAU - Math.PI * 0.5);
  ctx.stroke();

  ctx.strokeStyle = "#79dcff";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(cx, cy, 78, -Math.PI * 0.5, -Math.PI * 0.5 + TAU * progress);
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#f4fbff";
  ctx.font = '700 76px "Noto Sans SC", "PingFang SC", sans-serif';
  ctx.fillText(String(count), cx, cy - 6);
  ctx.fillStyle = "#9bc9e8";
  ctx.font = '700 16px "Noto Sans SC", "PingFang SC", sans-serif';
  ctx.fillText(t("准备开战"), cx, cy + 58);
  ctx.restore();
}

// 单人模式:暂停遮罩(整屏压暗 + 提示文字)
export function drawPauseOverlay(ctx) {
  ctx.save();
  ctx.fillStyle = "rgba(2,8,15,0.45)";
  ctx.fillRect(0, 0, LOGICAL, LOGICAL);
  ctx.fillStyle = "#e4f0ff";
  ctx.font = 'bold 42px "Noto Sans SC", "PingFang SC", sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(t("PAUSED"), LOGICAL * 0.5, LOGICAL * 0.5 - 20);
  ctx.fillStyle = "#8ab8d8";
  ctx.font = '16px "Noto Sans SC", "PingFang SC", sans-serif';
  ctx.fillText(t("按空格键继续"), LOGICAL * 0.5, LOGICAL * 0.5 + 24);
  ctx.restore();
}

// 世界空间的整帧战场绘制(调用方已设好相机变换)。frame 字段:
//   state              显示状态(单人=本地仿真序列化;在线=插值快照)
//   ownTeam/enemyTeam  己方/敌方队伍(观战时 own 取 A 视角)
//   spectating         观战:无迷雾、双方航线/扇区/视野圈、名牌常驻
//   visibleEnemyIds    己方可见敌单位 id 集合(Set)
//   selectedKeyForTeam(team) → 该队高亮舰 key;非观战时敌方应返回 null
//   routeForShip(team, ship) → 该舰待显示航线(在线在此合并本地预测覆盖;缺省取 ship.route)
//   mobileMode         移动端:不画航线曲度旋钮
//   stars / destructionEffects / selectedZoneId / pendingSubSkillAim / pointer
export function drawBattleWorld(ctx, frame) {
  const { state, ownTeam, enemyTeam, spectating = false } = frame;
  if (!state) {
    return;
  }
  const elapsed = state.elapsed || 0;
  const visibleEnemyIds = frame.visibleEnemyIds || new Set();
  const enemyVisible = (id) => spectating || state.phase === "finished" || visibleEnemyIds.has(id);
  const selectedKeyForTeam = frame.selectedKeyForTeam || (() => null);
  const routeForShip = frame.routeForShip || ((team, ship) => ship.route || null);
  const ownSeat = ownTeam?.seat || "A";
  // 观战与单人/普通对战共用内核队色，不另设观战专用色板。
  const ownColor = ownTeam?.color || "#65d9ff";
  const enemyColor = enemyTeam?.color || "#ff8692";

  drawBackground(ctx, frame.stars, elapsed);
  drawZones(ctx, state, frame.selectedZoneId);

  // 击毁粒子:先按最新状态同步存活/触发(敌方按视野裁剪),粒子本体在世界元素之后绘制
  syncShipDestructionEffects(frame.destructionEffects, [
    {
      seat: ownSeat,
      color: ownColor,
      ships: teamAllShips(ownTeam),
    },
    {
      seat: enemyTeam?.seat || (ownSeat === "A" ? "B" : "A"),
      color: enemyColor,
      ships: teamAllShips(enemyTeam),
      isVisible: (ship) => enemyVisible(ship.id),
    },
  ]);

  if (spectating) {
    drawTeamVisionCircles(ctx, state.teams?.A, "#79dcff26");
    drawTeamVisionCircles(ctx, state.teams?.B, "#ff95a026");
  }

  // 航线:非观战画己方全部可控航线;观战只画双方玩家当前所选舰船的航线。
  const routeTeams = spectating ? [state.teams?.A, state.teams?.B] : [ownTeam];
  for (const team of routeTeams) {
    if (!team || !team.ships) {
      continue;
    }
    const selectedKey = selectedKeyForTeam(team);
    for (const ship of teamAllShips(team)) {
      if (!ship || !ship.alive) {
        continue;
      }
      if (spectating && ship.key !== selectedKey) {
        continue;
      }
      const route = routeForShip(team, ship);
      if (!route) {
        continue;
      }
      drawRoute(ctx, route, ship.key === selectedKey, elapsed, !frame.mobileMode);
    }
  }

  for (const beam of ownTeam?.beams || []) {
    drawBeam(ctx, beam);
  }
  for (const beam of enemyTeam?.beams || []) {
    drawBeam(ctx, beam);
  }

  if (Array.isArray(state.projectiles)) {
    for (const projectile of state.projectiles) {
      if (!projectile || !projectile.alive) {
        continue;
      }
      drawProjectile(ctx, projectile, projectile.teamSeat === ownSeat);
    }
  }

  const ownSelectedKey = selectedKeyForTeam(ownTeam);
  for (const ship of teamAllShips(ownTeam)) {
    if (!ship || !ship.alive) {
      continue;
    }
    drawShip(ctx, ship, ownColor, ship.key === ownSelectedKey, ship.attached, false, spectating);
  }

  const enemySelectedKey = selectedKeyForTeam(enemyTeam);
  for (const ship of teamAllShips(enemyTeam)) {
    if (!ship || !ship.alive || !enemyVisible(ship.id)) {
      continue;
    }
    drawShip(ctx, ship, enemyColor, ship.key === enemySelectedKey, ship.attached, true, spectating);
  }

  for (const scout of ownTeam?.scouts || []) {
    drawScout(ctx, scout, true);
  }
  for (const scout of enemyTeam?.scouts || []) {
    if (!enemyVisible(scout.id)) {
      continue;
    }
    drawScout(ctx, scout, false);
  }

  for (const wingman of ownTeam?.wingmen || []) {
    drawWingman(ctx, wingman, true);
  }
  for (const wingman of enemyTeam?.wingmen || []) {
    if (!enemyVisible(wingman.id)) {
      continue;
    }
    drawWingman(ctx, wingman, false);
  }

  if (Array.isArray(state.bursts)) {
    for (const burst of state.bursts) {
      drawBurst(ctx, burst);
    }
  }
  if (Array.isArray(state.floatingTexts)) {
    for (const label of state.floatingTexts) {
      drawFloatingText(ctx, label);
    }
  }

  drawShipDestructionEffects(ctx, frame.destructionEffects);

  // 选中舰的火力扇区 + 视野圈;观战时双方都画,便于理解走位与输出朝向
  if (spectating) {
    for (const team of [state.teams?.A, state.teams?.B]) {
      if (!team) {
        continue;
      }
      const key = selectedKeyForTeam(team);
      drawSelectedFireArc(ctx, team, key);
      drawSelectedVisionCircle(ctx, team, key);
    }
  } else {
    drawSelectedFireArc(ctx, ownTeam, ownSelectedKey);
    drawSelectedVisionCircle(ctx, ownTeam, ownSelectedKey);
    drawSubSkillAimHint(ctx, ownTeam, frame.pendingSubSkillAim, frame.pointer);
  }
}
