const TAU = Math.PI * 2;

const ALLIANCE_COLORS = Object.freeze({
  A: "#69d8ff",
  B: "#ff8b92",
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

function drawLabel(ctx, text, x, y, color = "#d9e8f4") {
  ctx.save();
  ctx.fillStyle = "rgba(4, 10, 18, 0.72)";
  ctx.strokeStyle = "rgba(140, 170, 190, 0.36)";
  ctx.lineWidth = 1;
  ctx.font = "600 12px 'Noto Sans SC','PingFang SC',sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const width = Math.max(34, ctx.measureText(text).width + 14);
  ctx.beginPath();
  ctx.roundRect(x - width / 2, y - 10, width, 20, 4);
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
  drawLabel(ctx, `${area.allianceId} 出生`, area.center.x, area.center.y, color);
}

function drawControlPoint(ctx, point) {
  const owner = point.ownerAllianceId;
  const color = owner ? ALLIANCE_COLORS[owner] : "#d8d3bd";
  drawCircle(ctx, point, { fill: `${color}18`, stroke: `${color}d8`, lineWidth: 2.4 });
  ctx.save();
  ctx.strokeStyle = `${color}90`;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(point.center.x, point.center.y, Math.max(12, (point.radius || 60) - 14), 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(point.center.x - 16, point.center.y);
  ctx.lineTo(point.center.x + 16, point.center.y);
  ctx.moveTo(point.center.x, point.center.y - 16);
  ctx.lineTo(point.center.x, point.center.y + 16);
  ctx.stroke();
  ctx.restore();
  drawLabel(ctx, point.id?.toUpperCase?.() || "CP", point.center.x, point.center.y - (point.radius || 60) - 18, color);
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

function drawTerrain(ctx, region, debugVisible) {
  if (!debugVisible) return;
  const palette = {
    asteroid_belt: "#aeb7c2",
    speed_lane: "#67d9ff",
    gravity_mire: "#d2a86e",
  };
  const color = palette[region.type] || "#cfd8e3";
  ctx.save();
  setStroke(ctx, `${color}cc`, 1.6, 0.82);
  ctx.fillStyle = `${color}10`;
  ctx.setLineDash([8, 7]);
  if (region.shape === "capsule") {
    const width = region.width || 70;
    const length = region.length || 280;
    ctx.translate(region.center.x, region.center.y);
    ctx.rotate(region.angle || 0);
    ctx.beginPath();
    ctx.roundRect(-length / 2, -width / 2, length, width, width / 2);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(region.center.x, region.center.y, region.radius || 60, 0, TAU);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
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

export function renderTerritoryMap(ctx, map, options = {}) {
  if (!map) return;
  if (options.showDebugBounds) drawBounds(ctx, map);
  for (const terrain of map.terrainRegions || []) {
    drawTerrain(ctx, terrain, options.showTerrain !== false);
  }
  for (const area of map.spawnAreas || []) {
    drawSpawnArea(ctx, area);
  }
  for (const point of map.controlPoints || []) {
    drawControlPoint(ctx, point);
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

export function renderTerritoryEntities(ctx, state) {
  if (!state) return;
  for (const pickup of state.pickups || []) {
    if (pickup?.position) resourceGlyph(ctx, pickup);
  }
  for (const pickup of state.skillPickups || []) {
    if (pickup?.position) skillGlyph(ctx, pickup);
  }
}
