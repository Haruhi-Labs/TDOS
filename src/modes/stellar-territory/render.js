import { buildControlPointVisualState } from "./effects.js";
import { ALLOWED_TACTICAL_SKILLS } from "../../../shared/gameplay/territory-skills.js";
import { terrainIntensityAtPoint } from "../../../shared/gameplay/territory-terrain.js";

const TAU = Math.PI * 2;

const ALLIANCE_COLORS = Object.freeze({
  A: "#69d8ff",
  B: "#ff8b92",
});

const RESOURCE_COLORS = Object.freeze({
  repair: "#7bed9f",
  energy: "#6bd8ff",
  fleet_supply: "#ffd36d",
  respawn_accelerator: "#ffba7a",
});

const SKILL_META = new Map(ALLOWED_TACTICAL_SKILLS.map((skill) => [skill.id, skill]));
const SKILL_COLORS = Object.freeze({
  all_fleet_shield: "#8ae7ff",
  propulsion_overload: "#ffd978",
  firepower_overload: "#ff8f7a",
  short_warp: "#c9f8ff",
  gravity_field: "#c7a6ff",
  repair_drones: "#82e7a7",
});

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

const TICKET_HUD_TYPOGRAPHY = Object.freeze({
  label: 20,
  ticket: 40,
  meta: 18,
  control: 20,
  impact: 20,
});

function setStroke(ctx, color, width = 1, alpha = 1) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.globalAlpha = alpha;
}

function drawCircle(ctx, node, { stroke, fill = null, lineWidth = 1, alpha = 1 } = {}) {
  if (!node?.center) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(node.center.x, node.center.y, node.radius || 20, 0, TAU);
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.arc(node.center.x, node.center.y, node.radius || 20, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

function drawLabel(ctx, text, x, y, color = "#d9e8f4", { fontSize = 12 } = {}) {
  ctx.save();
  ctx.fillStyle = "rgba(4, 10, 18, 0.72)";
  ctx.strokeStyle = "rgba(140, 170, 190, 0.36)";
  ctx.lineWidth = 1;
  ctx.font = `700 ${fontSize}px 'Noto Sans SC','PingFang SC',sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const width = Math.max(48, ctx.measureText(text).width + 18);
  const height = fontSize + 10;
  ctx.beginPath();
  ctx.roundRect(x - width / 2, y - height / 2, width, height, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillText(text, x, y + 1);
  ctx.restore();
}

function drawSpawnArea(ctx, area) {
  const color = ALLIANCE_COLORS[area.allianceId] || "#d6e6f0";
  drawCircle(ctx, area, { fill: `${color}12`, stroke: `${color}bf`, lineWidth: 2 });
  ctx.save();
  ctx.strokeStyle = `${color}66`;
  ctx.lineWidth = 1;
  ctx.setLineDash([7, 8]);
  ctx.beginPath();
  ctx.arc(area.center.x, area.center.y, (area.radius || 80) + 12, 0, TAU);
  ctx.stroke();
  ctx.restore();
  drawLabel(ctx, `${area.allianceId} 出生区`, area.center.x, area.center.y, color, { fontSize: 18 });
}

function drawControlPoint(ctx, point, effect = null, clock = 0) {
  const visual = buildControlPointVisualState(point);
  const owner = visual.ownerAllianceId;
  const capturing = visual.capturingAllianceId;
  const contested = visual.contested;
  const color = contested ? "#f1d76f" : capturing ? ALLIANCE_COLORS[capturing] : owner ? ALLIANCE_COLORS[owner] : "#d8d3bd";
  const ownerColor = ALLIANCE_COLORS[owner] || color;
  const progress = visual.captureProgress;
  const label = point.label || point.id?.toUpperCase?.() || "CP";
  const status = visual.status;
  const entryStrength = Math.max(0, Math.min(1, Number(effect?.entryStrength) || 0));
  const captureImpact = Math.max(0, Math.min(1, Number(effect?.captureImpact) || 0));
  const lossFade = Math.max(0, Math.min(1, Number(effect?.lossFade) || 0));
  const contestImpact = Math.max(0, Math.min(1, Number(effect?.contestImpact) || 0));

  ctx.save();
  if (point.shape === "rect") {
    const width = point.width || 300;
    const height = point.height || 220;
    const x = point.x ?? point.center.x - width / 2;
    const y = point.y ?? point.center.y - height / 2;
    const radius = 10;
    ctx.fillStyle = owner ? `${ownerColor}22` : `${color}0e`;
    ctx.strokeStyle = `${color}d8`;
    ctx.lineWidth = (owner ? 3 : 2.4) + entryStrength * 2.2;
    ctx.shadowColor = `${color}aa`;
    ctx.shadowBlur = entryStrength * 16;
    ctx.setLineDash(owner ? [] : [16, 10]);
    ctx.lineDashOffset = -((clock * 14) % 26);
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    ctx.fill();
    ctx.stroke();

    if (contested) {
      ctx.strokeStyle = `${ALLIANCE_COLORS.A}c8`;
      ctx.setLineDash([10, 12]);
      ctx.lineDashOffset = (clock * 16) % 22;
      ctx.stroke();
      ctx.strokeStyle = `${ALLIANCE_COLORS.B}c8`;
      ctx.lineDashOffset = -((clock * 16) % 22);
      ctx.stroke();
    }

    if (contestImpact > 0) {
      const spread = 6 + (1 - contestImpact) * 48;
      ctx.globalAlpha = contestImpact;
      ctx.strokeStyle = "#f1d76f";
      ctx.lineWidth = 2 + contestImpact * 3;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.roundRect(x - spread, y - spread, width + spread * 2, height + spread * 2, radius + spread * 0.2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    if (capturing && progress > 0) {
      ctx.setLineDash([]);
      ctx.fillStyle = `${color}a8`;
      ctx.fillRect(x + 12, y + height - 18, Math.max(4, (width - 24) * progress), 7);
      ctx.strokeStyle = `${color}99`;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 12, y + height - 18, width - 24, 7);
    }

    if (lossFade > 0 && effect?.previousOwnerAllianceId) {
      const previousColor = ALLIANCE_COLORS[effect.previousOwnerAllianceId] || "#d8d3bd";
      ctx.globalAlpha = lossFade * 0.72;
      ctx.strokeStyle = previousColor;
      ctx.lineWidth = 3;
      ctx.setLineDash([]);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    if (captureImpact > 0) {
      const spread = (1 - captureImpact) * 42;
      ctx.globalAlpha = captureImpact;
      ctx.strokeStyle = `${ownerColor}dd`;
      ctx.lineWidth = 1.5 + captureImpact * 3;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.roundRect(x - spread, y - spread, width + spread * 2, height + spread * 2, radius + spread * 0.25);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.setLineDash([]);
    ctx.strokeStyle = `${color}88`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(point.center.x - 22, point.center.y);
    ctx.lineTo(point.center.x + 22, point.center.y);
    ctx.moveTo(point.center.x, point.center.y - 22);
    ctx.lineTo(point.center.x, point.center.y + 22);
    ctx.stroke();

    ctx.fillStyle = owner ? "#f7fbff" : color;
    ctx.font = "800 30px 'Noto Sans SC','PingFang SC',sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(owner || label, point.center.x, point.center.y - 8);
    drawLabel(ctx, status, point.center.x, y + 24, color, { fontSize: visual.statusFontSize });
  } else {
    drawCircle(ctx, point, { fill: `${color}18`, stroke: `${color}d8`, lineWidth: 2.4 });
    ctx.strokeStyle = `${color}90`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(point.center.x, point.center.y, Math.max(12, (point.radius || 60) - 14), 0, TAU);
    ctx.stroke();
    drawLabel(ctx, status, point.center.x, point.center.y - (point.radius || 60) - 18, color, { fontSize: visual.statusFontSize });
  }
  ctx.restore();
}

function drawResourceNode(ctx, node) {
  const rare = node.rarity === "rare";
  const color = rare ? "#ffd36d" : "#7fd7a6";
  drawCircle(ctx, node, { fill: `${color}16`, stroke: `${color}a8`, lineWidth: rare ? 2 : 1.5 });
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  const r = rare ? 10 : 8;
  ctx.beginPath();
  ctx.moveTo(node.center.x, node.center.y - r);
  ctx.lineTo(node.center.x + r, node.center.y);
  ctx.lineTo(node.center.x, node.center.y + r);
  ctx.lineTo(node.center.x - r, node.center.y);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function drawSkillNode(ctx, node) {
  const color = "#c7a6ff";
  drawCircle(ctx, node, { fill: `${color}12`, stroke: `${color}aa`, lineWidth: 1.8 });
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < 6; i += 1) {
    const a = -Math.PI / 2 + (i * TAU) / 6;
    const x = node.center.x + Math.cos(a) * 11;
    const y = node.center.y + Math.sin(a) * 11;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function resourceGlyph(ctx, pickup) {
  const color = {
    repair: "#7bed9f",
    energy: "#6bd8ff",
    fleet_supply: "#ffd36d",
    respawn_accelerator: "#ffba7a",
  }[pickup.resourceType] || "#7bed9f";
  const x = pickup.position.x;
  const y = pickup.position.y;
  ctx.save();
  ctx.fillStyle = `${color}2f`;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(x, y, pickup.radius || 24, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = "bold 22px 'Noto Sans SC','PingFang SC',sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const glyph = {
    repair: "+",
    energy: "E",
    fleet_supply: "III",
    respawn_accelerator: "T",
  }[pickup.resourceType] || "+";
  ctx.fillText(glyph, x, y + 1);
  ctx.restore();
}

function skillGlyph(ctx, pickup) {
  const x = pickup.position.x;
  const y = pickup.position.y;
  const r = pickup.radius || 28;
  ctx.save();
  ctx.fillStyle = "#b691ff3a";
  ctx.strokeStyle = "#d6bdff";
  ctx.lineWidth = 2.3;
  ctx.beginPath();
  for (let i = 0; i < 6; i += 1) {
    const a = -Math.PI / 2 + (i * TAU) / 6;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#f1e9ff";
  ctx.font = "bold 18px 'Noto Sans SC','PingFang SC',sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("X", x, y + 1);
  ctx.restore();
}

function hashUnit(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0x100000000;
}

function terrainUnit(region, index, salt) {
  return hashUnit(`${region?.id || region?.type || "terrain"}:${index}:${salt}`);
}

function terrainFields(region) {
  if (region?.shape === "compound" && Array.isArray(region.fields) && region.fields.length > 0) {
    return region.fields.map((field) => ({
      x: Number(field.x),
      y: Number(field.y),
      radius: Math.max(1, Number(field.radius) || 1),
      coreRadius: Math.max(1, Number(field.coreRadius) || Number(field.radius) * 0.36),
    }));
  }
  return [{
    x: Number(region?.center?.x) || 0,
    y: Number(region?.center?.y) || 0,
    radius: Math.max(1, Number(region?.radius) || 72),
    coreRadius: Math.max(8, (Number(region?.radius) || 72) * 0.36),
  }];
}

export function buildTerrainVisualState(region = {}) {
  if (region.type === "asteroid_belt") {
    return {
      kind: "asteroid",
      label: "小行星带",
      detail: "航速降低",
      fragmentCount: Math.max(18, terrainFields(region).length * 12),
      region,
    };
  }
  if (region.type === "speed_lane") {
    return {
      kind: "lane",
      label: "高速航道",
      detail: "顺向加速",
      arrowCount: 7,
      region,
    };
  }
  return {
    kind: "gravity",
    label: "引力泥沼",
    detail: "航速与转向降低",
    rippleCount: Math.max(4, terrainFields(region).length + 2),
    region,
  };
}

function drawTerrainCaption(ctx, visual) {
  const region = visual.region;
  const extent = region.shape === "capsule"
    ? Math.max(36, Number(region.width) || 78) / 2
    : region.shape === "compound"
      ? Math.max(48, Number(region.radius) || 70)
    : Math.max(48, Number(region.radius) || 70);
  const above = region.center.y - extent - 28;
  const y = above < 72 ? region.center.y + extent + 28 : above;
  drawLabel(ctx, visual.label, region.center.x, y, "#eef7fa", { fontSize: 18 });
  drawLabel(ctx, visual.detail, region.center.x, y + 28, "#b8c8cf", { fontSize: 16 });
}

function drawAsteroidTerrain(ctx, visual, effect, clock) {
  const region = visual.region;
  const fields = terrainFields(region);
  const disturbance = Math.max(0, Math.min(1, Number(effect?.disturbanceStrength) || 0));
  ctx.save();
  for (const field of fields) {
    const coreIntensity = terrainIntensityAtPoint({ x: field.x, y: field.y }, region);
    ctx.fillStyle = `rgba(134, 148, 157, ${0.035 + coreIntensity * 0.055})`;
    ctx.strokeStyle = `rgba(191, 205, 213, ${0.24 + coreIntensity * 0.18})`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([10, 9]);
    ctx.beginPath();
    ctx.arc(field.x, field.y, field.radius, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(221, 229, 232, 0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(field.x, field.y, field.coreRadius, 0, TAU);
    ctx.stroke();
  }

  for (let index = 0; index < visual.fragmentCount; index += 1) {
    const field = fields[index % fields.length];
    const angle = terrainUnit(region, index, "angle") * TAU;
    const spread = Math.sqrt(terrainUnit(region, index, "spread")) * field.radius * 0.82;
    const drift = disturbance * (5 + terrainUnit(region, index, "drift") * 12);
    const wobble = Math.sin(clock * 4 + index) * disturbance * 2;
    const x = field.x + Math.cos(angle) * (spread + drift) + Math.cos(angle + Math.PI / 2) * wobble;
    const y = field.y + Math.sin(angle) * (spread + drift) + Math.sin(angle + Math.PI / 2) * wobble;
    const intensity = terrainIntensityAtPoint({ x, y }, region);
    if (intensity <= 0.04) continue;
    const size = (3 + terrainUnit(region, index, "size") * 6) * (0.62 + intensity * 0.58);
    const vertices = 5 + Math.floor(terrainUnit(region, index, "vertices") * 3);
    ctx.fillStyle = index % 3 === 0
      ? `rgba(191, 200, 205, ${0.18 + intensity * 0.34})`
      : `rgba(119, 134, 145, ${0.22 + intensity * 0.34})`;
    ctx.strokeStyle = `rgba(221, 229, 232, ${0.2 + intensity * 0.34})`;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    for (let vertex = 0; vertex < vertices; vertex += 1) {
      const vertexAngle = (vertex / vertices) * TAU;
      const vertexRadius = size * (0.72 + terrainUnit(region, index, `edge-${vertex}`) * 0.5);
      const px = x + Math.cos(vertexAngle) * vertexRadius;
      const py = y + Math.sin(vertexAngle) * vertexRadius;
      if (vertex === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawSpeedLaneTerrain(ctx, visual, clock) {
  const region = visual.region;
  const length = Number(region.length) || 320;
  const width = Number(region.width) || 78;
  ctx.save();
  ctx.translate(region.center.x, region.center.y);
  ctx.rotate(Number(region.angle) || 0);
  ctx.fillStyle = "rgba(37, 151, 174, 0.12)";
  ctx.strokeStyle = "rgba(104, 222, 238, 0.58)";
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.roundRect(-length / 2, -width / 2, length, width, width / 2);
  ctx.fill();
  ctx.stroke();
  ctx.clip();

  for (const offset of [-width * 0.24, 0, width * 0.24]) {
    ctx.strokeStyle = offset === 0 ? "rgba(153, 243, 250, 0.72)" : "rgba(88, 198, 216, 0.42)";
    ctx.lineWidth = offset === 0 ? 2 : 1.2;
    ctx.setLineDash([18, 14]);
    ctx.lineDashOffset = -((clock * (offset === 0 ? 34 : 22)) % 32);
    ctx.beginPath();
    ctx.moveTo(-length / 2, offset);
    ctx.lineTo(length / 2, offset);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  for (let index = 0; index < visual.arrowCount; index += 1) {
    const x = -length / 2 + ((index + 0.5) / visual.arrowCount) * length;
    const y = index % 2 === 0 ? -width * 0.23 : width * 0.23;
    ctx.strokeStyle = "rgba(187, 248, 251, 0.78)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 8, y - 7);
    ctx.lineTo(x, y);
    ctx.lineTo(x - 8, y + 7);
    ctx.stroke();
  }
  ctx.restore();
}

function drawGravityTerrain(ctx, visual, clock) {
  const region = visual.region;
  const fields = terrainFields(region);
  ctx.save();
  for (const [fieldIndex, field] of fields.entries()) {
    const coreIntensity = terrainIntensityAtPoint({ x: field.x, y: field.y }, region);
    ctx.fillStyle = `rgba(38, 26, 58, ${0.12 + coreIntensity * 0.18})`;
    ctx.strokeStyle = `rgba(181, 147, 218, ${0.25 + coreIntensity * 0.21})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(field.x, field.y, field.radius, 0, TAU);
    ctx.fill();
    ctx.stroke();
    for (let index = 0; index < visual.rippleCount; index += 1) {
      const rippleRadius = field.radius * (0.22 + index * 0.12);
      if (rippleRadius >= field.radius) break;
      const rotation = clock * (0.42 + index * 0.08) * (index % 2 === 0 ? 1 : -1) + fieldIndex * 0.7;
      ctx.strokeStyle = index % 2 === 0 ? "rgba(211, 178, 235, 0.58)" : "rgba(104, 190, 205, 0.4)";
      ctx.lineWidth = 1.3 + (visual.rippleCount - index) * 0.18;
      ctx.setLineDash([18 - index * 2, 10 + index * 2]);
      ctx.lineDashOffset = rotation * 18;
      ctx.beginPath();
      ctx.arc(field.x, field.y, rippleRadius, rotation, rotation + Math.PI * 1.55);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(8, 8, 18, 0.92)";
    ctx.strokeStyle = "rgba(228, 197, 244, 0.82)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(field.x, field.y, field.coreRadius, 0, TAU);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawTerrainDebugBoundary(ctx, region) {
  ctx.save();
  ctx.strokeStyle = "rgba(255, 213, 109, 0.88)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([7, 6]);
  if (region.shape === "capsule") {
    const width = Number(region.width) || 70;
    const length = Number(region.length) || 280;
    ctx.translate(region.center.x, region.center.y);
    ctx.rotate(Number(region.angle) || 0);
    ctx.beginPath();
    ctx.roundRect(-length / 2, -width / 2, length, width, width / 2);
    ctx.stroke();
  } else if (region.shape === "compound") {
    for (const field of terrainFields(region)) {
      ctx.beginPath();
      ctx.arc(field.x, field.y, field.radius, 0, TAU);
      ctx.stroke();
    }
  } else {
    ctx.beginPath();
    ctx.arc(region.center.x, region.center.y, Number(region.radius) || 60, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTerrain(ctx, region, { debugVisible = false, effect = null, clock = 0 } = {}) {
  const visual = buildTerrainVisualState(region);
  if (visual.kind === "asteroid") drawAsteroidTerrain(ctx, visual, effect, clock);
  else if (visual.kind === "lane") drawSpeedLaneTerrain(ctx, visual, clock);
  else drawGravityTerrain(ctx, visual, clock);
  drawTerrainCaption(ctx, visual);
  if (debugVisible) drawTerrainDebugBoundary(ctx, region);
}

function drawBounds(ctx, map) {
  if (!map?.safeBounds) return;
  ctx.save();
  ctx.strokeStyle = "rgba(210, 220, 230, 0.24)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([10, 8]);
  ctx.strokeRect(map.safeBounds.x, map.safeBounds.y, map.safeBounds.width, map.safeBounds.height);
  ctx.restore();
}

function traceCorridorPath(ctx, corridor) {
  const path = Array.isArray(corridor?.path) ? corridor.path : [];
  if (path.length < 2) return false;
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  for (const point of path.slice(1)) ctx.lineTo(point.x, point.y);
  return true;
}

function drawCorridor(ctx, corridor, { fill, edge, dash = [] } = {}) {
  if (!traceCorridorPath(ctx, corridor)) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = fill;
  ctx.lineWidth = Math.max(8, Number(corridor.width) || 80);
  ctx.stroke();
  traceCorridorPath(ctx, corridor);
  ctx.strokeStyle = edge;
  ctx.lineWidth = 2;
  ctx.setLineDash(dash);
  ctx.stroke();
  ctx.restore();
}

function traceObstaclePrimitive(ctx, primitive) {
  if (primitive?.shape === "circle" && primitive.center) {
    ctx.beginPath();
    ctx.arc(primitive.center.x, primitive.center.y, Math.max(0, Number(primitive.radius) || 0), 0, TAU);
    return true;
  }
  if (primitive?.shape === "polygon" && Array.isArray(primitive.points) && primitive.points.length >= 3) {
    ctx.beginPath();
    ctx.moveTo(primitive.points[0].x, primitive.points[0].y);
    for (const point of primitive.points.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.closePath();
    return true;
  }
  if (primitive?.shape === "capsule" && primitive.center) {
    const length = Math.max(0, Number(primitive.length) || 0);
    const width = Math.max(0, Number(primitive.width) || Number(primitive.radius) * 2 || 0);
    ctx.save();
    ctx.translate(primitive.center.x, primitive.center.y);
    ctx.rotate(Number(primitive.angle) || 0);
    ctx.beginPath();
    ctx.roundRect(-length / 2, -width / 2, length, width, width / 2);
    return "restore";
  }
  return false;
}

function drawObstaclePrimitive(ctx, primitive) {
  const traced = traceObstaclePrimitive(ctx, primitive);
  if (!traced) return;
  ctx.fillStyle = "rgba(37, 43, 50, 0.92)";
  ctx.strokeStyle = "rgba(219, 105, 91, 0.9)";
  ctx.lineWidth = 3;
  ctx.fill();
  ctx.stroke();
  if (traced === "restore") ctx.restore();
}

function drawObstacleRegion(ctx, obstacle) {
  if (obstacle?.shape === "compound") {
    for (const primitive of obstacle.primitives || []) drawObstaclePrimitive(ctx, primitive);
    return;
  }
  drawObstaclePrimitive(ctx, obstacle);
}

function drawNavigationPlans(ctx, plans = {}, localSeat = null) {
  if (!localSeat) return;
  for (const plan of Object.values(plans || {})) {
    if (plan?.seat !== localSeat || !plan.start || !Array.isArray(plan.waypoints) || !plan.waypoints.length) continue;
    ctx.save();
    ctx.strokeStyle = "rgba(105, 216, 255, 0.9)";
    ctx.fillStyle = "rgba(105, 216, 255, 0.92)";
    ctx.lineWidth = 3;
    ctx.setLineDash([12, 8]);
    ctx.beginPath();
    ctx.moveTo(plan.start.x, plan.start.y);
    for (const waypoint of plan.waypoints) ctx.lineTo(waypoint.x, waypoint.y);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const waypoint of plan.waypoints) {
      ctx.beginPath();
      ctx.arc(waypoint.x, waypoint.y, waypoint.nodeId ? 7 : 10, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
}

export function territoryStaticMapCacheKey(map = {}) {
  const worldSize = map.worldSize || {};
  return [
    map.templateId || "unknown",
    Number(map.version) || 0,
    Number(map.seed) || 0,
    Number(worldSize.width) || 0,
    Number(worldSize.height) || 0,
  ].join(":");
}

export function renderTerritoryStaticMap(ctx, map, options = {}) {
  if (!map) return;
  if (options.showDebugBounds) drawBounds(ctx, map);
  for (const corridor of map.laneCorridors || []) {
    drawCorridor(ctx, corridor, { fill: "rgba(74, 133, 143, 0.12)", edge: "rgba(111, 198, 207, 0.42)", dash: [18, 14] });
  }
  for (const corridor of map.connectorCorridors || []) {
    drawCorridor(ctx, corridor, { fill: "rgba(132, 105, 150, 0.1)", edge: "rgba(189, 153, 207, 0.38)", dash: [8, 12] });
  }
  for (const terrain of map.terrainRegions || []) {
    drawTerrain(ctx, terrain, {
      debugVisible: options.showTerrainDebug === true,
      effect: options.effects?.terrain?.[terrain.id],
      clock: options.effects?.time || 0,
    });
  }
  for (const obstacle of map.obstacleRegions || []) drawObstacleRegion(ctx, obstacle);
  for (const area of map.spawnAreas || []) {
    drawSpawnArea(ctx, area);
  }
  if (options.showNodes !== false) {
    for (const node of map.resourceSpawnNodes || []) {
      drawResourceNode(ctx, node);
    }
    for (const node of map.skillSpawnNodes || []) {
      drawSkillNode(ctx, node);
    }
  }
}

export function renderTerritoryDynamicMap(ctx, map, options = {}) {
  if (!map) return;
  for (const point of map.controlPoints || []) {
    drawControlPoint(ctx, point, options.effects?.controls?.[point.id], options.effects?.time || 0);
  }
  drawNavigationPlans(ctx, options.navigationPlans, options.localSeat);
}

function createDefaultCanvas(width, height) {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function createTerritoryStaticMapCache({ maxPixels = 2048, createCanvas = createDefaultCanvas } = {}) {
  let cacheKey = null;
  let surface = null;
  let worldWidth = 0;
  let worldHeight = 0;

  function rebuild(map) {
    worldWidth = Math.max(1, Number(map?.worldSize?.width) || 1);
    worldHeight = Math.max(1, Number(map?.worldSize?.height) || 1);
    const scale = Math.min(1, Math.max(1, Number(maxPixels) || 2048) / Math.max(worldWidth, worldHeight));
    const width = Math.max(1, Math.round(worldWidth * scale));
    const height = Math.max(1, Math.round(worldHeight * scale));
    surface = createCanvas(width, height);
    const cacheContext = surface?.getContext?.("2d");
    if (!cacheContext) {
      surface = null;
      return;
    }
    cacheContext.setTransform(scale, 0, 0, scale, 0, 0);
    renderTerritoryStaticMap(cacheContext, map);
  }

  return {
    draw(ctx, map) {
      if (!ctx || !map) return false;
      const nextKey = territoryStaticMapCacheKey(map);
      if (nextKey !== cacheKey || !surface) {
        cacheKey = nextKey;
        rebuild(map);
      }
      if (!surface) return false;
      ctx.drawImage(surface, 0, 0, surface.width, surface.height, 0, 0, worldWidth, worldHeight);
      return true;
    },
    clear() {
      cacheKey = null;
      surface = null;
      worldWidth = 0;
      worldHeight = 0;
    },
  };
}

export function renderTerritoryMap(ctx, map, options = {}) {
  renderTerritoryStaticMap(ctx, map, options);
  renderTerritoryDynamicMap(ctx, map, options);
}

export function renderTerritoryEntities(ctx, state) {
  if (!state) return;
  for (const pickup of state.pickups || []) {
    if (pickup?.position) resourceGlyph(ctx, pickup);
  }
  for (const pickup of state.skillPickups || []) {
    if (pickup?.position) skillGlyph(ctx, pickup);
  }
}

export function renderTerritoryTacticalAim(ctx, aim) {
  if (!ctx || !aim?.active || !aim.point) return;
  const legalColor = "#72e4f2";
  const invalidColor = "#ff6b62";
  const targetColor = aim.legal ? legalColor : invalidColor;
  ctx.save();
  ctx.lineWidth = 2;
  if (aim.maxDistance && aim.source) {
    ctx.strokeStyle = "rgba(114, 228, 242, 0.56)";
    ctx.fillStyle = "rgba(114, 228, 242, 0.045)";
    ctx.setLineDash([13, 9]);
    ctx.beginPath();
    ctx.arc(aim.source.x, aim.source.y, aim.maxDistance, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  const landingRadius = aim.radius || 22;
  ctx.strokeStyle = targetColor;
  ctx.fillStyle = aim.legal ? "rgba(114, 228, 242, 0.12)" : "rgba(255, 107, 98, 0.12)";
  ctx.setLineDash(aim.legal ? [7, 5] : [3, 5]);
  ctx.beginPath();
  ctx.arc(aim.point.x, aim.point.y, landingRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(aim.point.x - 13, aim.point.y);
  ctx.lineTo(aim.point.x + 13, aim.point.y);
  ctx.moveTo(aim.point.x, aim.point.y - 13);
  ctx.lineTo(aim.point.x, aim.point.y + 13);
  ctx.stroke();
  ctx.restore();
}

export function renderTerritoryEventEffects(ctx, effects = {}, { isNavigationFeedbackVisible = () => true } = {}) {
  if (!ctx) return;
  const clock = Number(effects.time) || 0;
  const resources = effects.resources || {};
  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  for (const warning of Object.values(resources.warnings || {})) {
    const x = Number(warning.position?.x);
    const y = Number(warning.position?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const color = RESOURCE_COLORS[warning.resourceType] || RESOURCE_COLORS.repair;
    const duration = Math.max(0.1, Number(warning.duration) || Number(warning.remaining) || 1);
    const progress = clamp01(Number(warning.remaining) / duration);
    const pulse = 0.5 + Math.sin(clock * 7) * 0.16;
    ctx.strokeStyle = color;
    ctx.fillStyle = `${color}18`;
    ctx.globalAlpha = 0.55 + pulse * 0.35;
    ctx.lineWidth = 1.6 + progress;
    ctx.setLineDash([7, 5]);
    ctx.lineDashOffset = -(clock * 18);
    ctx.beginPath();
    ctx.arc(x, y, 31 + (1 - progress) * 9, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.font = "800 17px 'Noto Sans SC','PingFang SC',sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(Math.max(0, Math.ceil(Number(warning.remaining) || 0))), x, y);
  }

  for (const spawn of Object.values(resources.spawns || {})) {
    const x = Number(spawn.position?.x);
    const y = Number(spawn.position?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const strength = clamp01(spawn.strength);
    const color = RESOURCE_COLORS[spawn.resourceType] || RESOURCE_COLORS.repair;
    ctx.globalAlpha = strength;
    ctx.strokeStyle = color;
    ctx.fillStyle = `${color}24`;
    ctx.lineWidth = 1.5 + strength * 2.5;
    ctx.beginPath();
    ctx.arc(x, y, 30 + (1 - strength) * 48, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 20 - (1 - strength) * 12, y);
    ctx.lineTo(x + 20 + (1 - strength) * 12, y);
    ctx.moveTo(x, y - 20 - (1 - strength) * 12);
    ctx.lineTo(x, y + 20 + (1 - strength) * 12);
    ctx.stroke();
  }

  for (const collection of Object.values(resources.collections || {})) {
    const x = Number(collection.position?.x);
    const y = Number(collection.position?.y);
    const targetX = Number(collection.targetPosition?.x);
    const targetY = Number(collection.targetPosition?.y);
    if (![x, y, targetX, targetY].every(Number.isFinite)) continue;
    const strength = clamp01(collection.strength);
    const color = RESOURCE_COLORS[collection.resourceType] || RESOURCE_COLORS.repair;
    ctx.globalAlpha = strength;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5 + strength * 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(targetX, targetY);
    ctx.stroke();
    for (let index = 0; index < 5; index += 1) {
      const t = clamp01((index + 1) / 6 + (1 - strength) * 0.45);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x + (targetX - x) * t, y + (targetY - y) * t, 1.8 + strength, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = strength;
    ctx.fillStyle = color;
    ctx.font = "800 17px 'Noto Sans SC','PingFang SC',sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    for (let index = 0; index < (collection.labels || []).length; index += 1) {
      ctx.fillText(collection.labels[index], targetX, targetY - 26 - index * 19 - (1 - strength) * 16);
    }
  }

  const skills = effects.skills || {};
  for (const warning of Object.values(skills.warnings || {})) {
    const x = Number(warning.position?.x);
    const y = Number(warning.position?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const color = SKILL_COLORS[warning.skillId] || "#c7a6ff";
    const duration = Math.max(0.1, Number(warning.duration) || Number(warning.remaining) || 1);
    const progress = clamp01(Number(warning.remaining) / duration);
    ctx.globalAlpha = 0.72 + Math.sin(clock * 6) * 0.16;
    ctx.strokeStyle = color;
    ctx.fillStyle = `${color}16`;
    ctx.lineWidth = 1.8 + progress;
    ctx.setLineDash([5, 5]);
    ctx.lineDashOffset = clock * 20;
    ctx.beginPath();
    ctx.arc(x, y, 34 + (1 - progress) * 10, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.font = "800 17px 'Noto Sans SC','PingFang SC',sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(Math.max(0, Math.ceil(Number(warning.remaining) || 0))), x, y);
  }

  for (const spawn of Object.values(skills.spawns || {})) {
    const x = Number(spawn.position?.x);
    const y = Number(spawn.position?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const strength = clamp01(spawn.strength);
    const color = SKILL_COLORS[spawn.skillId] || "#c7a6ff";
    ctx.globalAlpha = strength;
    ctx.strokeStyle = color;
    ctx.fillStyle = `${color}20`;
    ctx.lineWidth = 1.8 + strength * 2.8;
    ctx.beginPath();
    ctx.arc(x, y, 31 + (1 - strength) * 54, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    for (let index = 0; index < 6; index += 1) {
      const angle = -Math.PI / 2 + (index / 6) * TAU;
      const inner = 19;
      const outer = 28 + (1 - strength) * 18;
      ctx.moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner);
      ctx.lineTo(x + Math.cos(angle) * outer, y + Math.sin(angle) * outer);
    }
    ctx.stroke();
  }

  for (const collection of Object.values(skills.collections || {})) {
    const x = Number(collection.position?.x);
    const y = Number(collection.position?.y);
    const targetX = Number(collection.targetPosition?.x);
    const targetY = Number(collection.targetPosition?.y);
    if (![x, y, targetX, targetY].every(Number.isFinite)) continue;
    const strength = clamp01(collection.strength);
    const color = SKILL_COLORS[collection.skillId] || "#c7a6ff";
    ctx.globalAlpha = strength;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.8 + strength * 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(targetX, targetY);
    ctx.stroke();
    for (let index = 0; index < 6; index += 1) {
      const t = clamp01((index + 1) / 7 + (1 - strength) * 0.5);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x + (targetX - x) * t, y + (targetY - y) * t, 2 + strength, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = color;
    ctx.font = "800 17px 'Noto Sans SC','PingFang SC',sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(SKILL_META.get(collection.skillId)?.name || collection.skillId || "技能", targetX, targetY - 28 - (1 - strength) * 16);
  }

  for (const use of Object.values(skills.uses || {})) {
    const x = Number(use.position?.x);
    const y = Number(use.position?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const strength = clamp01(use.strength);
    const color = SKILL_COLORS[use.skillId] || "#c7a6ff";
    ctx.globalAlpha = strength;
    ctx.strokeStyle = color;
    ctx.fillStyle = `${color}24`;
    ctx.lineWidth = 2 + strength * 2.5;
    ctx.beginPath();
    ctx.arc(x, y, 24 + (1 - strength) * 52, 0, TAU);
    ctx.fill();
    ctx.stroke();
  }

  for (const active of Object.values(skills.active || {})) {
    const x = Number(active.position?.x);
    const y = Number(active.position?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const color = SKILL_COLORS[active.skillId] || "#c7a6ff";
    const progress = active.duration > 0 ? clamp01(active.remaining / active.duration) : 1;
    const radius = Number(active.radius) || (active.skillId === "repair_drones" ? 48 : 42);
    ctx.globalAlpha = 0.42 + progress * 0.32;
    ctx.strokeStyle = color;
    ctx.fillStyle = `${color}0d`;
    ctx.lineWidth = 1.5 + progress;
    ctx.setLineDash([10, 7]);
    ctx.lineDashOffset = active.skillId === "gravity_field" ? clock * 14 : -(clock * 14);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = color;
    ctx.font = "800 17px 'Noto Sans SC','PingFang SC',sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    const name = SKILL_META.get(active.skillId)?.name || active.skillId || "技能";
    ctx.fillText(`${name} ${Math.max(0, Math.ceil(Number(active.remaining) || 0))}s`, x, y - radius - 9);
  }

  for (const ending of Object.values(skills.endings || {})) {
    const x = Number(ending.position?.x);
    const y = Number(ending.position?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const strength = clamp01(ending.strength);
    const color = SKILL_COLORS[ending.skillId] || "#c7a6ff";
    const baseRadius = Number(ending.radius) || 44;
    ctx.globalAlpha = strength;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1 + strength * 2.5;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(10, baseRadius * strength), 0, TAU);
    ctx.stroke();
  }

  for (const feedback of effects.navigationFeedback || []) {
    if (!isNavigationFeedbackVisible(feedback)) continue;
    const x = Number(feedback.position?.x);
    const y = Number(feedback.position?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const strength = clamp01(feedback.strength);
    const color = feedback.kind === "invalid"
      ? "#ff5f6d"
      : feedback.kind === "replanned"
        ? "#69d8ff"
        : feedback.kind === "collision"
          ? "#ff9f6e"
        : "#f1b95f";
    const radius = 18 + (1 - strength) * 34;
    ctx.globalAlpha = strength;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 + strength * 2;
    ctx.setLineDash(feedback.kind === "stuck" ? [7, 6] : []);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    if (feedback.kind === "invalid") {
      const arm = radius * 0.52;
      ctx.beginPath();
      ctx.moveTo(x - arm, y - arm);
      ctx.lineTo(x + arm, y + arm);
      ctx.moveTo(x + arm, y - arm);
      ctx.lineTo(x - arm, y + arm);
      ctx.stroke();
    } else if (feedback.kind === "replanned") {
      ctx.beginPath();
      ctx.arc(x, y, Math.max(5, radius - 9), 0, TAU);
      ctx.stroke();
    }
  }

  ctx.restore();
}

export function renderTerritoryRespawnEffects(ctx, effects = {}) {
  if (!ctx) return;
  const clock = Number(effects.time) || 0;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const effect of Object.values(effects.respawns || {})) {
    const x = Number(effect.position?.x);
    const y = Number(effect.position?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (effect.preheat > 0) {
      const gather = clamp01(effect.preheat);
      ctx.strokeStyle = `rgba(120, 232, 244, ${0.3 + gather * 0.55})`;
      ctx.lineWidth = 1.5 + gather * 1.5;
      ctx.setLineDash([7, 6]);
      ctx.lineDashOffset = -(clock * 22);
      ctx.beginPath();
      ctx.arc(x, y, 48 - gather * 24, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      for (let index = 0; index < 12; index += 1) {
        const angle = (index / 12) * TAU + clock * (index % 2 === 0 ? 0.8 : -0.65);
        const radius = 54 * (1 - gather * 0.72) + (index % 3) * 3;
        ctx.fillStyle = index % 2 === 0 ? "rgba(133, 241, 248, 0.82)" : "rgba(255, 222, 132, 0.72)";
        ctx.beginPath();
        ctx.arc(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius, 2.2, 0, TAU);
        ctx.fill();
      }
    }
    if (effect.materialize > 0) {
      const strength = clamp01(effect.materialize);
      ctx.fillStyle = `rgba(192, 250, 255, ${strength * 0.2})`;
      ctx.strokeStyle = `rgba(185, 247, 255, ${strength * 0.92})`;
      ctx.lineWidth = 2 + strength * 2;
      ctx.beginPath();
      ctx.arc(x, y, 17 + (1 - strength) * 13, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, y - 38 * strength);
      ctx.lineTo(x, y + 38 * strength);
      ctx.stroke();
    }
    if (effect.shockwave > 0) {
      const strength = clamp01(effect.shockwave);
      ctx.strokeStyle = `rgba(255, 226, 145, ${strength * 0.8})`;
      ctx.lineWidth = 1 + strength * 3;
      ctx.beginPath();
      ctx.arc(x, y, 22 + (1 - strength) * 72, 0, TAU);
      ctx.stroke();
    }
  }
  for (const protection of Object.values(effects.protections || {})) {
    const x = Number(protection.position?.x);
    const y = Number(protection.position?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const radius = Number(protection.radius) || 18;
    if (protection.shield > 0) {
      const pulse = 0.5 + Math.sin(clock * 5) * 0.12;
      ctx.strokeStyle = `rgba(114, 226, 241, ${pulse})`;
      ctx.fillStyle = "rgba(83, 191, 211, 0.08)";
      ctx.lineWidth = 1.8;
      ctx.setLineDash([9, 5]);
      ctx.lineDashOffset = -(clock * 12);
      ctx.beginPath();
      ctx.arc(x, y, radius + 8, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (protection.breakStrength > 0) {
      const strength = clamp01(protection.breakStrength);
      ctx.strokeStyle = `rgba(150, 239, 250, ${strength})`;
      ctx.lineWidth = 1.6;
      for (let index = 0; index < 8; index += 1) {
        const angle = (index / 8) * TAU + 0.18;
        const inner = radius + 7 + (1 - strength) * 8;
        const outer = inner + 8 + (1 - strength) * 18;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner);
        ctx.lineTo(x + Math.cos(angle + 0.12) * outer, y + Math.sin(angle + 0.12) * outer);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

export function buildTerritoryMinimapState(state = {}) {
  const map = state.map || {};
  const copyCorridor = (corridor) => ({
    ...corridor,
    path: (corridor?.path || []).map((point) => ({ ...point })),
  });
  const copyObstacle = (obstacle) => ({
    ...obstacle,
    center: obstacle?.center ? { ...obstacle.center } : obstacle?.center,
    points: (obstacle?.points || []).map((point) => ({ ...point })),
    primitives: (obstacle?.primitives || []).map((primitive) => ({
      ...primitive,
      center: primitive?.center ? { ...primitive.center } : primitive?.center,
      points: (primitive?.points || []).map((point) => ({ ...point })),
    })),
  });
  return {
    worldSize: map.worldSize || { width: 1440, height: 1440 },
    lanes: (map.laneCorridors || []).map(copyCorridor),
    connectors: (map.connectorCorridors || []).map(copyCorridor),
    obstacles: (map.obstacleRegions || []).map(copyObstacle),
    navigationGraph: {
      nodes: (map.navigationGraph?.nodes || []).map((node) => ({
        ...node,
        center: node?.center ? { ...node.center } : node?.center,
      })),
      edges: (map.navigationGraph?.edges || []).map((edge) => ({ ...edge })),
    },
    terrain: (map.terrainRegions || []).map((region) => ({
      ...region,
      center: region?.center ? { ...region.center } : region?.center,
      fields: (region?.fields || []).map((field) => ({ ...field })),
    })),
    controls: (map.controlPoints || []).map((point) => ({ ...point })),
    spawns: (map.spawnAreas || []).map((area) => ({ ...area })),
    resources: [
      ...(map.resourceSpawnNodes || []).map((node) => ({ kind: "node", position: { ...node.center }, rarity: node.rarity })),
      ...(state.pickups || []).map((pickup) => ({ kind: "pickup", position: { ...pickup.position }, resourceType: pickup.resourceType })),
    ],
    skills: [
      ...(map.skillSpawnNodes || []).map((node) => ({ kind: "node", position: { ...node.center } })),
      ...(state.skillPickups || []).map((pickup) => ({ kind: "pickup", position: { ...pickup.position }, skillId: pickup.skillId })),
    ],
  };
}

export function renderTerritoryMinimapOverlay(ctx, state, { rect } = {}) {
  if (!ctx || !state || !rect) return;
  const model = buildTerritoryMinimapState(state);
  const worldWidth = Math.max(1, Number(model.worldSize?.width) || 1440);
  const worldHeight = Math.max(1, Number(model.worldSize?.height) || 1440);
  const point = (position) => ({
    x: rect.x + (Number(position?.x) / worldWidth) * rect.width,
    y: rect.y + (Number(position?.y) / worldHeight) * rect.height,
  });
  const radius = (value) => (Number(value) / worldWidth) * rect.width;
  const tracePath = (path) => {
    if (!Array.isArray(path) || path.length < 2) return false;
    const start = point(path[0]);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    for (const entry of path.slice(1)) {
      const projected = point(entry);
      ctx.lineTo(projected.x, projected.y);
    }
    return true;
  };
  const drawProjectedCorridor = (corridor, fill, edge) => {
    if (!tracePath(corridor?.path)) return;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = fill;
    ctx.lineWidth = Math.max(2, radius(corridor.width));
    ctx.stroke();
    tracePath(corridor.path);
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  };
  const drawProjectedObstacle = (obstacle) => {
    const primitives = obstacle?.shape === "compound" ? obstacle.primitives || [] : [obstacle];
    for (const primitive of primitives) {
      let traced = false;
      let restore = false;
      if (primitive?.shape === "circle" && primitive.center) {
        const center = point(primitive.center);
        ctx.beginPath();
        ctx.arc(center.x, center.y, radius(primitive.radius), 0, TAU);
        traced = true;
      } else if (primitive?.shape === "polygon" && primitive.points?.length >= 3) {
        const first = point(primitive.points[0]);
        ctx.beginPath();
        ctx.moveTo(first.x, first.y);
        for (const entry of primitive.points.slice(1)) {
          const projected = point(entry);
          ctx.lineTo(projected.x, projected.y);
        }
        ctx.closePath();
        traced = true;
      } else if (primitive?.shape === "capsule" && primitive.center) {
        const center = point(primitive.center);
        const width = radius(primitive.width || Number(primitive.radius) * 2);
        ctx.save();
        ctx.translate(center.x, center.y);
        ctx.rotate(Number(primitive.angle) || 0);
        ctx.beginPath();
        ctx.roundRect(-radius(primitive.length) / 2, -width / 2, radius(primitive.length), width, width / 2);
        traced = true;
        restore = true;
      }
      if (traced) {
        ctx.fillStyle = "rgba(37, 43, 50, 0.9)";
        ctx.strokeStyle = "rgba(219, 105, 91, 0.9)";
        ctx.lineWidth = 1.1;
        ctx.fill();
        ctx.stroke();
      }
      if (restore) ctx.restore();
    }
  };

  ctx.save();
  for (const lane of model.lanes) {
    drawProjectedCorridor(lane, "rgba(74, 133, 143, 0.18)", "rgba(111, 198, 207, 0.65)");
  }
  for (const connector of model.connectors) {
    drawProjectedCorridor(connector, "rgba(132, 105, 150, 0.16)", "rgba(189, 153, 207, 0.65)");
  }
  for (const obstacle of model.obstacles) drawProjectedObstacle(obstacle);
  for (const region of model.terrain) {
    ctx.strokeStyle = region.type === "speed_lane" ? "#68deee88" : region.type === "gravity_mire" ? "#b593da88" : "#aeb7c288";
    ctx.lineWidth = 1;
    if (region.shape === "capsule") {
      const center = point(region.center);
      ctx.save();
      ctx.translate(center.x, center.y);
      ctx.rotate(Number(region.angle) || 0);
      ctx.beginPath();
      ctx.roundRect(-radius(region.length) / 2, -radius(region.width) / 2, radius(region.length), radius(region.width), radius(region.width) / 2);
      ctx.stroke();
      ctx.restore();
    } else if (region.shape === "compound") {
      for (const field of region.fields || []) {
        const center = point(field);
        ctx.beginPath();
        ctx.arc(center.x, center.y, radius(field.radius), 0, TAU);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(center.x, center.y, radius(field.coreRadius), 0, TAU);
        ctx.stroke();
      }
    } else {
      const center = point(region.center);
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius(region.radius), 0, TAU);
      ctx.stroke();
    }
  }
  for (const area of model.spawns) {
    const center = point(area.center);
    ctx.strokeStyle = ALLIANCE_COLORS[area.allianceId] || "#d8e1e6";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius(area.radius), 0, TAU);
    ctx.stroke();
  }
  for (const control of model.controls) {
    const center = point(control.center);
    const color = control.contested ? "#f1d76f" : ALLIANCE_COLORS[control.ownerAllianceId] || "#8998a2";
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.3;
    ctx.strokeRect(center.x - radius(control.width) / 2, center.y - radius(control.height) / 2, radius(control.width), radius(control.height));
  }
  for (const resource of model.resources) {
    const center = point(resource.position);
    ctx.fillStyle = resource.kind === "pickup" ? "#7bed9f" : "#6e9f82";
    ctx.fillRect(center.x - 1.7, center.y - 1.7, 3.4, 3.4);
  }
  for (const skill of model.skills) {
    const center = point(skill.position);
    ctx.fillStyle = skill.kind === "pickup" ? "#d6bdff" : "#876fac";
    ctx.beginPath();
    ctx.arc(center.x, center.y, skill.kind === "pickup" ? 2.4 : 1.8, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function formatMatchTime(elapsed) {
  const total = Math.max(0, Math.floor(Number(elapsed) || 0));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function buildTerritoryTicketHudState(state = {}, effects = {}) {
  const ticketsA = Math.max(0, Number(state.alliances?.A?.tickets) || 0);
  const ticketsB = Math.max(0, Number(state.alliances?.B?.tickets) || 0);
  const initialTickets = Math.max(1, Number(state.initialTickets) || ticketsA || ticketsB || 1);
  const frozen = Boolean(state.result?.finished);
  const allianceState = (allianceId, tickets) => {
    const rate = frozen ? 0 : Math.max(0, Number(state.ticketDrainRates?.[allianceId]) || 0);
    return {
      allianceId,
      tickets,
      low: tickets > 0 && tickets / initialTickets < 0.3,
      depleted: tickets <= 0,
      drainRate: rate,
      drainLabel: frozen ? "已冻结" : rate > 0 ? `-${rate.toFixed(2)}/秒` : "稳定",
      impact: effects.tickets?.[allianceId] || { amount: 0, reason: null, strength: 0 },
    };
  };
  return {
    frozen,
    initialTickets,
    typography: TICKET_HUD_TYPOGRAPHY,
    timeLabel: formatMatchTime(state.elapsed),
    resultLabel: state.result?.label || null,
    alliances: {
      A: allianceState("A", ticketsA),
      B: allianceState("B", ticketsB),
    },
    controls: (state.map?.controlPoints || []).map((point) => ({
      id: point.id,
      label: point.label || String(point.id || "?").slice(0, 1).toUpperCase(),
      state: point.contested ? "contested" : point.ownerAllianceId || "neutral",
    })),
  };
}

function drawHudPanel(ctx, x, y, width, height, frozen) {
  ctx.fillStyle = frozen ? "rgba(8, 12, 17, 0.96)" : "rgba(4, 11, 18, 0.92)";
  ctx.strokeStyle = frozen ? "rgba(220, 226, 231, 0.72)" : "rgba(139, 170, 188, 0.72)";
  ctx.lineWidth = frozen ? 2 : 1.5;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 5);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "rgba(223, 232, 238, 0.2)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 18, y + 8);
  ctx.lineTo(x + width - 18, y + 8);
  ctx.stroke();
}

function drawHudAlliance(ctx, hud, typography, x, y, clock) {
  const color = ALLIANCE_COLORS[hud.allianceId];
  const warningPulse = hud.low && !hud.depleted ? 0.55 + Math.sin(clock * 5) * 0.3 : 0;
  if (hud.low || hud.depleted) {
    ctx.save();
    ctx.globalAlpha = hud.depleted ? 1 : warningPulse;
    ctx.strokeStyle = hud.depleted ? "#ff5f68" : "#f1d76f";
    ctx.lineWidth = hud.depleted ? 3 : 2;
    ctx.strokeRect(x - 84, y - 42, 168, 96);
    ctx.restore();
  }

  ctx.fillStyle = color;
  ctx.font = `700 ${typography.label}px 'Noto Sans SC','PingFang SC',sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${hud.allianceId}阵营`, x, y - 30);

  const impactStrength = Math.max(0, Math.min(1, Number(hud.impact?.strength) || 0));
  const scale = hud.depleted ? 1 : 1 + impactStrength * 0.18;
  ctx.save();
  ctx.translate(x, y + 7);
  ctx.scale(scale, scale);
  ctx.fillStyle = hud.depleted ? "#ff6972" : "#f5fbff";
  ctx.font = `800 ${typography.ticket}px 'Noto Sans SC','PingFang SC',sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(String(hud.tickets), 0, 0);
  ctx.restore();

  ctx.fillStyle = hud.drainRate > 0 ? "#ff9a9f" : "#93aab7";
  ctx.font = `700 ${typography.meta}px 'Noto Sans SC','PingFang SC',sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(hud.drainLabel, x, y + 43);

  if (impactStrength > 0 && hud.impact?.amount > 0) {
    ctx.save();
    ctx.globalAlpha = impactStrength;
    const floatY = y + 83 - (1 - impactStrength) * 12;
    ctx.fillStyle = "#ff6972";
    ctx.font = `800 ${typography.impact}px 'Noto Sans SC','PingFang SC',sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(`-${hud.impact.amount}`, x, floatY);
    ctx.fillStyle = "#ffc0c3";
    ctx.font = `700 ${typography.meta}px 'Noto Sans SC','PingFang SC',sans-serif`;
    ctx.fillText(hud.impact.reason || "战争点数减少", x, floatY + 22);
    ctx.restore();
  }
}

function drawHudControls(ctx, controls, typography, centerX, y, clock, frozen) {
  const gap = 48;
  const startX = centerX - ((controls.length - 1) * gap) / 2;
  for (let index = 0; index < controls.length; index += 1) {
    const control = controls[index];
    const x = startX + index * gap;
    const contested = control.state === "contested";
    const color = control.state === "A"
      ? ALLIANCE_COLORS.A
      : control.state === "B"
        ? ALLIANCE_COLORS.B
        : contested
          ? "#f1d76f"
          : "#8998a2";
    ctx.save();
    ctx.globalAlpha = contested && !frozen ? 0.65 + Math.sin(clock * 7 + index) * 0.3 : 1;
    ctx.fillStyle = `${color}26`;
    ctx.strokeStyle = color;
    ctx.lineWidth = contested ? 2.4 : 1.6;
    ctx.beginPath();
    ctx.roundRect(x - 17, y - 17, 34, 34, 3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#f4f8fa";
    ctx.font = `800 ${typography.control}px 'Noto Sans SC','PingFang SC',sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(control.label, x, y + 1);
    ctx.restore();
  }
}

export function renderTerritoryTicketHud(ctx, state, effects = {}, screenSize = {}) {
  if (!ctx || !state) return;
  const hud = buildTerritoryTicketHudState(state, effects);
  const screenWidth = Math.max(900, Number(screenSize?.width) || 1440);
  const width = Math.min(780, screenWidth - 48);
  const height = 132;
  const x = (screenWidth - width) / 2;
  const y = 18;
  const centerX = screenWidth / 2;
  const clock = hud.frozen ? 0 : Math.max(0, Number(effects.time) || 0);

  ctx.save();
  drawHudPanel(ctx, x, y, width, height, hud.frozen);
  drawHudAlliance(ctx, hud.alliances.A, hud.typography, x + 126, y + 54, clock);
  drawHudAlliance(ctx, hud.alliances.B, hud.typography, x + width - 126, y + 54, clock);

  ctx.fillStyle = hud.frozen ? "#dfe7ec" : "#f1d76f";
  ctx.font = `800 ${hud.typography.meta}px 'Noto Sans SC','PingFang SC',sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(hud.timeLabel, centerX, y + 24);
  drawHudControls(ctx, hud.controls, hud.typography, centerX, y + 66, clock, hud.frozen);
  ctx.fillStyle = hud.frozen ? "#f1d76f" : "#8fa5b2";
  ctx.font = `700 ${hud.typography.meta}px 'Noto Sans SC','PingFang SC',sans-serif`;
  ctx.fillText(hud.frozen ? hud.resultLabel || "战局已结算" : "战争点数", centerX, y + 110);
  ctx.restore();
}
