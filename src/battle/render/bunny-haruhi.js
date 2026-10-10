import { DEFAULT_WORLD_SIZE } from "../../../shared/game/constants.js";

const TAU = Math.PI * 2;
const allShips = (team) => [...Object.values(team?.ships || {}), ...(team?.extraShips || [])];

export function bunnyShipVisible(frame, team, ship) {
  return Boolean(ship?.alive && (team?.seat === frame.ownTeam?.seat || frame.spectating
    || frame.state?.phase === "finished" || frame.visibleEnemyIds?.has(ship.id)));
}

/** 主战场与小地图共用权威圆和来源可见性，不根据头像或客户端视野重算。 */
export function bunnyStagesForFrame(frame) {
  return Object.values(frame.state?.teams || {}).filter((team) => team.bunnyStage
    && bunnyShipVisible(frame, team, team.ships?.main)).map((team) => team.bunnyStage);
}

export function drawBunnyStages(ctx, frame, rect = null) {
  const size = frame.state?.world?.size || DEFAULT_WORLD_SIZE;
  ctx.save();
  if (rect) { ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.width, rect.height); ctx.clip(); }
  for (const stage of bunnyStagesForFrame(frame)) {
    const sx = rect ? rect.width / size : 1;
    const sy = rect ? rect.height / size : 1;
    const x = (rect?.x || 0) + stage.x * sx;
    const y = (rect?.y || 0) + stage.y * sy;
    ctx.strokeStyle = stage.seat === "A" ? "#b6edff" : "#ffc2ba";
    ctx.lineWidth = rect ? 1 : 1.5;
    ctx.setLineDash(rect ? [3, 3] : [8, 8]);
    ctx.beginPath();
    ctx.ellipse(x, y, stage.radius * sx, stage.radius * sy, 0, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    if (!rect) for (let i = 0; i < 12; i += 1) {
      const angle = i * TAU / 12;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(angle) * stage.radius, y + Math.sin(angle) * stage.radius);
      ctx.lineTo(x + Math.cos(angle) * (stage.radius + 5), y + Math.sin(angle) * (stage.radius + 5));
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function drawBunnyMarkers(ctx, frame, rect = null) {
  const teams = Object.values(frame.state?.teams || {});
  const ships = teams.flatMap((team) => allShips(team).map((ship) => ({ team, ship })));
  const size = frame.state?.world?.size || DEFAULT_WORLD_SIZE;
  ctx.save();
  if (rect) { ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.width, rect.height); ctx.clip(); }
  for (const { team, ship } of ships) {
    if (!bunnyShipVisible(frame, team, ship)) continue;
    const form = ship.bunnyHaruhi;
    const companion = ship.bunnyCompanion;
    const stage = ship.bunnyStageExposure;
    if (!form && !companion && !stage?.inside) continue;
    const x = rect ? rect.x + ship.x / size * rect.width : ship.x;
    const y = rect ? rect.y + ship.y / size * rect.height : ship.y;
    ctx.strokeStyle = "#f0d488";
    ctx.fillStyle = "#fff2cf";
    ctx.lineWidth = 1.5;
    if (companion) {
      if (!rect) {
        const owner = ships.find((entry) => entry.ship.id === companion.ownerShipId);
        if (owner && bunnyShipVisible(frame, owner.team, owner.ship)) {
          ctx.globalAlpha = 0.45;
          ctx.setLineDash([3, 6]);
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(owner.ship.x, owner.ship.y); ctx.stroke();
          ctx.setLineDash([]); ctx.globalAlpha = 1;
        }
      }
      const r = rect ? 4 : ship.radius + 3;
      ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.stroke();
      if (companion.convertedRemaining > 0) {
        ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.stroke();
      }
    }
    if (form) {
      const label = ship.key === "main" ? "S" : ({ neutral: "N", bless: "B", knows: "K", encore: "E" })[form.form] || "N";
      ctx.font = `bold ${rect ? 9 : 11}px sans-serif`;
      ctx.fillText(label, x + (rect ? 5 : ship.radius + 5), y - (rect ? 2 : ship.radius + 5));
      if (!rect && form.enabled && form.immunityRemaining > 0) {
        ctx.strokeStyle = "#d9f7ff"; ctx.beginPath(); ctx.arc(x, y, ship.radius + 8, 0, TAU); ctx.stroke();
      }
    }
    if (!rect && stage?.inside) {
      ctx.strokeStyle = stage.phase === "entranced" ? "#a5f5c6" : "#f3c38e";
      ctx.setLineDash(stage.phase === "entranced" ? [] : [2, 4]);
      ctx.beginPath(); ctx.arc(x, y, ship.radius + 11, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    }
  }
  ctx.restore();
}
