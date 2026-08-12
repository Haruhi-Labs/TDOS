const TAU = Math.PI * 2;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function allShips(team) {
  if (!team?.ships) return [];
  return [...Object.values(team.ships), ...(team.extraShips || [])];
}

function shipById(state, id) {
  if (!state?.teams || !Number.isFinite(id)) return null;
  for (const team of [state.teams.A, state.teams.B]) {
    const ship = allShips(team).find((candidate) => candidate?.id === id);
    if (ship) return ship;
  }
  return null;
}

// 普通玩家只接收自己三味线旗舰的标记表现；观战视角会同时展示双方标记。
// 这里不读取 visibleEnemyIds，确保迷雾中仍保留“标记”，但调用方仍按真实视野决定是否绘制舰体。
export function shamisenHuntMarkersForFrame(frame) {
  const state = frame?.state;
  if (!state?.teams) return [];
  const hunterTeams = frame.spectating
    ? [state.teams.A, state.teams.B]
    : [frame.ownTeam];
  const markers = [];
  for (const hunter of hunterTeams) {
    const targetId = hunter?.shamisenHunt?.targetId;
    const target = shipById(state, targetId);
    if (!target?.alive) continue;
    markers.push({
      hunterSeat: hunter.seat,
      sequence: Number(hunter.shamisenHunt?.sequence) || 0,
      target,
    });
  }
  return markers;
}

function drawMarker(ctx, marker, elapsed, scale = 1) {
  const target = marker.target;
  const phase = elapsed * 2.35 + marker.sequence * 0.71 + target.id * 0.17;
  const pulse = 0.5 + Math.sin(phase) * 0.5;
  const radius = (Math.max(8, Number(target.radius) || 8) + 12 + pulse * 1.8) * scale;
  const x = target.x;
  const y = target.y;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";

  // 分层普通描边在 Canvas/WebGL1 上也能形成稳定泛光，不依赖高成本 shadowBlur。
  ctx.strokeStyle = "rgba(255,24,67,0.12)";
  ctx.lineWidth = 9 * scale;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TAU);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255,45,78,0.34)";
  ctx.lineWidth = 4.2 * scale;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TAU);
  ctx.stroke();

  ctx.strokeStyle = "#ff536f";
  ctx.globalAlpha = 0.82 + pulse * 0.18;
  ctx.lineWidth = 1.65 * scale;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TAU);
  ctx.stroke();

  // 单条斜杠保持图形识别度；双层线宽让它在缩放后的移动端仍清晰。
  const slash = radius * 0.72;
  ctx.strokeStyle = "rgba(255,27,65,0.2)";
  ctx.lineWidth = 7 * scale;
  ctx.beginPath();
  ctx.moveTo(x - slash, y + slash);
  ctx.lineTo(x + slash, y - slash);
  ctx.stroke();
  ctx.strokeStyle = "#ff6a80";
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 2 * scale;
  ctx.beginPath();
  ctx.moveTo(x - slash, y + slash);
  ctx.lineTo(x + slash, y - slash);
  ctx.stroke();

  // 四个短刻度令标记更像舰队锁定框，而不是普通警示图标。
  ctx.strokeStyle = "#ffd7de";
  ctx.globalAlpha = 0.6 + pulse * 0.22;
  ctx.lineWidth = 1.2 * scale;
  for (let index = 0; index < 4; index += 1) {
    const angle = phase * 0.12 + index * Math.PI * 0.5;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(angle) * radius * 1.12, y + Math.sin(angle) * radius * 1.12);
    ctx.lineTo(x + Math.cos(angle) * radius * 1.34, y + Math.sin(angle) * radius * 1.34);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawShamisenHuntMarkers(ctx, frame) {
  const elapsed = Number(frame?.state?.elapsed) || 0;
  for (const marker of shamisenHuntMarkersForFrame(frame)) {
    drawMarker(ctx, marker, elapsed, 1);
  }
}

export function drawShamisenHuntMarkersMinimap(ctx, frame, rect, worldSize) {
  const markers = shamisenHuntMarkersForFrame(frame);
  if (!markers.length || !rect || !(worldSize > 0)) return;
  const elapsed = Number(frame?.state?.elapsed) || 0;
  const mapScale = Math.min(rect.width, rect.height) / worldSize;
  for (const marker of markers) {
    drawMarker(ctx, {
      ...marker,
      target: {
        ...marker.target,
        x: rect.x + marker.target.x / worldSize * rect.width,
        y: rect.y + marker.target.y / worldSize * rect.height,
        radius: clamp((Number(marker.target.radius) || 8) * mapScale, 0, 1.6),
      },
    }, elapsed, 0.42);
  }
}

function drawFallbackKillEffect(ctx, effect) {
  const maxLife = Math.max(0.01, Number(effect.maxLife) || 1.65);
  const progress = clamp(1 - (Number(effect.life) || 0) / maxLife, 0, 1);
  const fade = (1 - progress) ** 1.25;
  const eased = 1 - (1 - progress) ** 3;
  const radius = Math.max(12, Number(effect.radius) || 12);
  const outer = radius * (1.4 + eased * 7.2);

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = "rgba(255,43,76,0.24)";
  ctx.globalAlpha = fade;
  ctx.lineWidth = Math.max(1, 8 * (1 - progress));
  ctx.beginPath();
  ctx.arc(effect.x, effect.y, outer, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = "#ff9aae";
  ctx.globalAlpha = fade * 0.88;
  ctx.lineWidth = Math.max(0.8, 2.4 * (1 - progress));
  ctx.beginPath();
  ctx.arc(effect.x, effect.y, outer * 0.78, 0, TAU);
  ctx.stroke();

  ctx.lineCap = "round";
  for (let index = -1; index <= 1; index += 1) {
    const offset = index * radius * 0.62;
    const reach = radius * (1.4 + eased * 5.8);
    ctx.strokeStyle = index === 0 ? "#fff2f5" : "#ff4569";
    ctx.globalAlpha = fade * (index === 0 ? 0.85 : 0.58);
    ctx.lineWidth = Math.max(0.9, (3.2 - Math.abs(index) * 0.7) * (1 - progress * 0.65));
    ctx.beginPath();
    ctx.moveTo(effect.x - reach * 0.6 + offset, effect.y + reach * 0.6 + offset);
    ctx.lineTo(effect.x + reach * 0.6 + offset, effect.y - reach * 0.6 + offset);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawShamisenHuntKillEffects(ctx, effects) {
  for (const effect of effects || []) {
    if (!effect || !(Number(effect.life) > 0)) continue;
    if (typeof ctx.drawShamisenHuntKillEffect === "function" && ctx.drawShamisenHuntKillEffect(effect)) {
      continue;
    }
    drawFallbackKillEffect(ctx, effect);
  }
}
