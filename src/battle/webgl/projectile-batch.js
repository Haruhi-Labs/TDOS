import { parseColor } from "./color.js";
import { appendColorCommand, appendTextureCommand } from "./driver.js";
import { matrixScale } from "./matrix.js";

function appendColorVertex(target, point, color) {
  target.push(point.x, point.y, color[0], color[1], color[2], color[3]);
}

function appendTextureVertex(target, point, u, v, color) {
  target.push(point.x, point.y, u, v, color[0], color[1], color[2], color[3]);
}

function appendTail(context, target, start, end, width, startColor, endColor) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.max(1e-6, Math.hypot(dx, dy));
  const scale = matrixScale(context.state.transform);
  const nx = (-dy / length) * width * scale * 0.5;
  const ny = (dx / length) * width * scale * 0.5;
  const points = [
    { x: start.x + nx, y: start.y + ny },
    { x: start.x - nx, y: start.y - ny },
    { x: end.x - nx, y: end.y - ny },
    { x: end.x + nx, y: end.y + ny },
  ];
  for (const [index, color] of [
    [0, startColor], [1, startColor], [2, endColor],
    [0, startColor], [2, endColor], [3, endColor],
  ]) {
    appendColorVertex(target, points[index], color);
  }
}

function appendDisc(context, target, cx, cy, rx, ry, rotation, color) {
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const center = context.point(cx, cy);
  const axisX = context.point(cx + cosine * rx, cy + sine * rx);
  const axisY = context.point(cx - sine * ry, cy + cosine * ry);
  const vectorX = { x: axisX.x - center.x, y: axisX.y - center.y };
  const vectorY = { x: axisY.x - center.x, y: axisY.y - center.y };
  const corners = [
    { x: center.x - vectorX.x - vectorY.x, y: center.y - vectorX.y - vectorY.y },
    { x: center.x + vectorX.x - vectorY.x, y: center.y + vectorX.y - vectorY.y },
    { x: center.x + vectorX.x + vectorY.x, y: center.y + vectorX.y + vectorY.y },
    { x: center.x - vectorX.x + vectorY.x, y: center.y - vectorX.y + vectorY.y },
  ];
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;
  appendTextureVertex(target, topLeft, 0, 1, color);
  appendTextureVertex(target, bottomLeft, 0, 0, color);
  appendTextureVertex(target, bottomRight, 1, 0, color);
  appendTextureVertex(target, topLeft, 0, 1, color);
  appendTextureVertex(target, bottomRight, 1, 0, color);
  appendTextureVertex(target, topRight, 1, 1, color);
}

function appendCatPaw(context, target, projectile, angle, color) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  appendDisc(
    context,
    target,
    projectile.x - sine * 1.3,
    projectile.y + cosine * 1.3,
    3.1,
    2.5,
    angle,
    color,
  );
  for (const [toeX, toeY] of [[-2.8, -1.5], [-1, -2.8], [1, -2.8], [2.8, -1.5]]) {
    appendDisc(
      context,
      target,
      projectile.x + toeX * cosine - toeY * sine,
      projectile.y + toeX * sine + toeY * cosine,
      1.05,
      1.3,
      angle,
      color,
    );
  }
}

// 弹体是3v3压力下数量增长最快的图元。所有尾迹合成一个颜色批次，所有普通弹/猫爪
// 合成一个程序化圆点纹理批次，避免每颗弹体产生独立 draw call 或纹理上传。
export function drawNativeProjectileBatch(context, projectiles, ownSeat) {
  const tails = [];
  const bodies = [];
  for (const projectile of projectiles || []) {
    if (!projectile?.alive) continue;
    const color = parseColor(
      projectile.color || (projectile.teamSeat === ownSeat ? "#9be8ff" : "#ffc0bd"),
    );
    color[3] *= context.state.globalAlpha;
    const dx = (projectile.targetX ?? projectile.x) - projectile.x;
    const dy = (projectile.targetY ?? projectile.y) - projectile.y;
    const distance = Math.hypot(dx, dy);
    if ((Number(projectile.speed) || 0) > 0 && distance > 1e-3) {
      const trailLength = Math.max(6, Math.min(16, (Number(projectile.speed) || 0) * 0.05));
      appendTail(
        context,
        tails,
        context.point(
          projectile.x - (dx / distance) * trailLength,
          projectile.y - (dy / distance) * trailLength,
        ),
        context.point(projectile.x, projectile.y),
        Math.max(1.4, (projectile.radius || 2) * 0.9),
        [color[0], color[1], color[2], 0],
        [color[0], color[1], color[2], color[3] * 0.75],
      );
    }
    if (projectile.visualKind === "cat_paw") {
      const angle = distance > 1e-3 ? Math.atan2(dy, dx) + Math.PI * 0.5 : Math.PI * 0.5;
      appendCatPaw(context, bodies, projectile, angle, color);
    } else {
      const radius = projectile.radius || 2;
      appendDisc(context, bodies, projectile.x, projectile.y, radius, radius, 0, color);
    }
  }
  appendColorCommand(
    context.commands,
    tails,
    context.state.globalCompositeOperation,
    context.state.clip,
  );
  appendTextureCommand(
    context.commands,
    context.discTexture,
    bodies,
    context.state.globalCompositeOperation,
    context.state.clip,
  );
}
