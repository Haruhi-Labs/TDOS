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

function traceWavyRing(ctx, wave, radius, phase, amplitudeScale = 1) {
  const segments = 96;
  const amplitude = Math.min(5.5, Math.max(0.7, radius * 0.035)) * amplitudeScale;
  ctx.beginPath();
  for (let index = 0; index <= segments; index += 1) {
    const angle = (index / segments) * TAU;
    const wobble =
      Math.sin(angle * 7 + phase) * amplitude
      + Math.sin(angle * 13 - phase * 1.35 + (Number(wave.id) || 0)) * amplitude * 0.38;
    const r = Math.max(0, radius + wobble);
    const x = wave.x + Math.cos(angle) * r;
    const y = wave.y + Math.sin(angle) * r;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawWave(ctx, team, wave, elapsed) {
  const frame = waveFrame(wave, elapsed);
  if (!frame || frame.radius <= 1 || frame.alpha <= 0) return;
  const palette = wavePalette(team);
  const phase = frame.age * 7.2 + (Number(wave.id) || 0) * 1.73;

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // 宽而克制的半透明波带承载真实视野范围；不用逐帧模糊，避免多人场景额外合成开销。
  ctx.globalAlpha = frame.alpha * 0.075;
  ctx.strokeStyle = palette.band;
  ctx.lineWidth = frame.width;
  traceWavyRing(ctx, wave, frame.radius, phase, 0.55);
  ctx.stroke();

  for (const [offset, strength] of [[-0.5, 0.44], [0.5, 0.34]]) {
    const edgeRadius = frame.radius + frame.width * offset;
    if (edgeRadius <= 1) continue;
    ctx.globalAlpha = frame.alpha * strength;
    ctx.strokeStyle = palette.edge;
    ctx.lineWidth = 1.1;
    traceWavyRing(ctx, wave, edgeRadius, phase + offset * 1.7, 0.9);
    ctx.stroke();
  }

  const crestRadius = frame.radius + Math.sin(phase * 0.72) * frame.width * 0.16;
  ctx.globalAlpha = frame.alpha * 0.62;
  ctx.strokeStyle = palette.crest;
  ctx.lineWidth = 1.35;
  ctx.setLineDash([15, 8, 3, 9]);
  ctx.lineDashOffset = -frame.age * 70;
  traceWavyRing(ctx, wave, crestRadius, phase * 1.08, 0.72);
  ctx.stroke();
  ctx.setLineDash([]);
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
