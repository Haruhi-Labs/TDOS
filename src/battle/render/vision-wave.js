import { DEFAULT_WORLD_SIZE, clamp } from "../../../shared/game-core.js";

const TAU = Math.PI * 2;

function wavePalette(team) {
  return team?.seat === "B"
    ? { band: "#ff6f9f", edge: "#ffd2df", crest: "#ff9ec2" }
    : { band: "#5ec8ff", edge: "#d5f5ff", crest: "#9ce4ff" };
}

function waveFrame(wave, elapsed) {
  const emittedAt = Number(wave?.emittedAt) || 0;
  const expiresAt = Number(wave?.expiresAt) || emittedAt;
  const age = elapsed - emittedAt;
  if (age < 0 || elapsed >= expiresAt) return null;
  const fadeIn = clamp(age / 0.09, 0, 1);
  const fadeOut = clamp((expiresAt - elapsed) / 0.16, 0, 1);
  return {
    age,
    radius: age * (Number(wave.speed) || 0),
    width: Math.max(1, Number(wave.width) || 1),
    alpha: fadeIn * fadeOut,
  };
}

function traceCircle(ctx, wave, radius) {
  ctx.beginPath();
  ctx.arc(wave.x, wave.y, Math.max(0, radius), 0, TAU);
}

function drawWave(ctx, team, wave, elapsed) {
  const frame = waveFrame(wave, elapsed);
  if (!frame || frame.radius <= 1 || frame.alpha <= 0) return;
  const palette = wavePalette(team);
  const phase = frame.age * 5.4 + (Number(wave.id) || 0) * 1.37;
  const breath = 0.5 + Math.sin(phase) * 0.5;

  ctx.save();
  ctx.globalCompositeOperation = "screen";

  // 标准圆形的宽波带直接对应真实视野范围；透明度轻微呼吸，保留水波感但不扭曲轮廓。
  ctx.globalAlpha = frame.alpha * (0.052 + breath * 0.018);
  ctx.strokeStyle = palette.band;
  ctx.lineWidth = frame.width;
  traceCircle(ctx, wave, frame.radius);
  ctx.stroke();

  // 仅保留一条连续波峰。小幅径向起伏不会破坏圆形几何，也避免多层虚线造成粗糙感。
  const crestOffset = Math.sin(phase * 0.82) * Math.min(4, frame.width * 0.055);
  ctx.globalAlpha = frame.alpha * (0.46 + breath * 0.08);
  ctx.strokeStyle = palette.crest;
  ctx.lineWidth = 1.2;
  traceCircle(ctx, wave, frame.radius + crestOffset);
  ctx.stroke();
  ctx.restore();
}

export function drawAsakuraVisionWaves(ctx, teams, elapsed, worldSize = DEFAULT_WORLD_SIZE) {
  const activeTeams = (Array.isArray(teams) ? teams : [teams]).filter(Boolean);
  if (activeTeams.length === 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, worldSize, worldSize);
  ctx.clip();
  for (const team of activeTeams) {
    for (const wave of team.visionWaves || []) {
      drawWave(ctx, team, wave, elapsed);
    }
  }
  ctx.restore();
}

export function drawAsakuraVisionWavesMinimap(
  ctx,
  teams,
  elapsed,
  rect,
  worldSize = DEFAULT_WORLD_SIZE,
) {
  if (!rect) return;
  const activeTeams = (Array.isArray(teams) ? teams : [teams]).filter(Boolean);
  const scaleX = rect.width / worldSize;
  const scaleY = rect.height / worldSize;
  const radiusScale = Math.min(scaleX, scaleY);
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();
  ctx.globalCompositeOperation = "screen";
  for (const team of activeTeams) {
    const palette = wavePalette(team);
    for (const wave of team.visionWaves || []) {
      const frame = waveFrame(wave, elapsed);
      if (!frame || frame.radius <= 1 || frame.alpha <= 0) continue;
      const x = rect.x + wave.x * scaleX;
      const y = rect.y + wave.y * scaleY;
      ctx.globalAlpha = frame.alpha * 0.2;
      ctx.strokeStyle = palette.band;
      ctx.lineWidth = clamp(frame.width * radiusScale, 1.4, 6);
      ctx.beginPath();
      ctx.arc(x, y, frame.radius * radiusScale, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = frame.alpha * 0.72;
      ctx.strokeStyle = palette.edge;
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
  }
  ctx.restore();
}
