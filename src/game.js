import {
  FIRE_ARC_BANDS,
  MatchSimulation,
  CHARACTER_ORDER,
  CHARACTER_DEFS,
  DEFAULT_AI_LOADOUT,
  DEFAULT_TEAM_LOADOUT,
  clamp,
  cloneLoadout,
  distance,
  normalizeLoadout,
  quadraticPoint,
  skillMetaForCharacter,
} from "../shared/game-core.js";

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const ui = {
  hullValue: document.getElementById("hullValue"),
  energyValue: document.getElementById("energyValue"),
  splitValue: document.getElementById("splitValue"),
  selectedValue: document.getElementById("selectedValue"),
  splitOneBtn: document.getElementById("splitOneBtn"),
  splitTwoBtn: document.getElementById("splitTwoBtn"),
  powerSlider: document.getElementById("powerSlider"),
  powerValue: document.getElementById("powerValue"),
  zoneValue: document.getElementById("zoneValueLocal"),
  shipSwitchButtons: Array.from(document.querySelectorAll("#shipQuickSwitch .ship-switch-btn")),
  scoutBtn: document.getElementById("scoutBtn"),
  flagshipBtn: document.getElementById("flagshipBtn"),
  subSkillBtn: document.getElementById("subSkillBtn"),
  playerMainRole: document.getElementById("playerMainRole"),
  playerSub1Role: document.getElementById("playerSub1Role"),
  playerSub2Role: document.getElementById("playerSub2Role"),
  loadoutPreview: document.getElementById("loadoutPreview"),
  applyLoadoutBtn: document.getElementById("applyLoadoutBtn"),
  log: document.getElementById("log"),
  overlay: document.getElementById("overlay"),
  overlayTitle: document.getElementById("overlayTitle"),
  restartBtn: document.getElementById("restartBtn"),
};

const TAU = Math.PI * 2;
const ROUTE_HANDLE_RADIUS = 11;
const PLAYER_LOADOUT_STORAGE_KEY = "haruhi-player-loadout-v2";

const app = {
  sim: null,
  state: null,
  playerLoadout: readStoredLoadout(),
  enemyLoadout: cloneLoadout(DEFAULT_AI_LOADOUT),
  selectedShipKey: "main",
  selectedZoneId: 5,
  pointer: { x: canvas.width * 0.5, y: canvas.height * 0.5 },
  drag: null,
  suppressMapClick: false,
  pendingSubSkillAim: null,
  lastTime: performance.now(),
  gameOverLogged: false,
  stars: Array.from({ length: 220 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    r: Math.random() * 1.6 + 0.4,
    p: Math.random() * TAU,
  })),
};

function readStoredLoadout() {
  try {
    const raw = window.localStorage.getItem(PLAYER_LOADOUT_STORAGE_KEY);
    if (!raw) {
      return cloneLoadout(DEFAULT_TEAM_LOADOUT);
    }
    return normalizeLoadout(JSON.parse(raw), DEFAULT_TEAM_LOADOUT);
  } catch (_error) {
    return cloneLoadout(DEFAULT_TEAM_LOADOUT);
  }
}

function storeLoadout(loadout) {
  try {
    window.localStorage.setItem(PLAYER_LOADOUT_STORAGE_KEY, JSON.stringify(loadout));
  } catch (_error) {
    // 忽略存储失败
  }
}

function ownTeamState() {
  return app.state ? app.state.teams.A : null;
}

function enemyTeamState() {
  return app.state ? app.state.teams.B : null;
}

function ownTeamSim() {
  return app.sim ? app.sim.teamA : null;
}

function selectedShipState() {
  const own = ownTeamState();
  if (!own || !own.ships) {
    return null;
  }
  return own.ships[app.selectedShipKey] || null;
}

function selectedShipSim() {
  const own = ownTeamSim();
  return own ? own.ships[app.selectedShipKey] || null : null;
}

function pointerFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) * (canvas.width / rect.width);
  const y = (event.clientY - rect.top) * (canvas.height / rect.height);
  return {
    x: clamp(x, 0, canvas.width),
    y: clamp(y, 0, canvas.height),
  };
}

function zoneFromPoint(x, y) {
  const zones = app.state ? app.state.zones : [];
  return zones.find((zone) => x >= zone.x && x < zone.x + zone.width && y >= zone.y && y < zone.y + zone.height) || null;
}

function routeHandleAtPoint(route, x, y) {
  if (!route) {
    return null;
  }
  if (distance(x, y, route.p1.x, route.p1.y) <= ROUTE_HANDLE_RADIUS) {
    return "control";
  }
  if (distance(x, y, route.p2.x, route.p2.y) <= ROUTE_HANDLE_RADIUS + 1.5) {
    return "end";
  }
  return null;
}

function log(message) {
  const row = document.createElement("div");
  const elapsed = app.state ? Math.floor(app.state.elapsed) : 0;
  row.textContent = `[${String(elapsed).padStart(3, "0")}秒] ${message}`;
  ui.log.prepend(row);
  while (ui.log.children.length > 26) {
    ui.log.removeChild(ui.log.lastChild);
  }
}

function clearLog() {
  ui.log.innerHTML = "";
}

function applyAction(action) {
  if (!app.sim) {
    return false;
  }
  return app.sim.applyActionForSeat("A", action);
}

function bindPressButton(button, handler) {
  if (!button) {
    return;
  }
  let suppressClickUntil = 0;
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || button.disabled) {
      return;
    }
    suppressClickUntil = performance.now() + 320;
    event.preventDefault();
    handler();
  });
  button.addEventListener("click", (event) => {
    if (performance.now() < suppressClickUntil) {
      event.preventDefault();
      return;
    }
    if (button.disabled) {
      return;
    }
    handler();
  });
  button.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && !button.disabled) {
      event.preventDefault();
      handler();
    }
  });
}

function createRoleOption(characterId) {
  const def = CHARACTER_DEFS[characterId];
  const option = document.createElement("option");
  option.value = characterId;
  option.textContent = `${def.shortName} · ${def.title}`;
  return option;
}

function populateLoadoutControls() {
  for (const select of [ui.playerMainRole, ui.playerSub1Role, ui.playerSub2Role]) {
    if (!select) {
      continue;
    }
    select.innerHTML = "";
    for (const characterId of CHARACTER_ORDER) {
      select.append(createRoleOption(characterId));
    }
  }
  syncLoadoutControls(app.playerLoadout);
}

function syncLoadoutControls(loadout) {
  ui.playerMainRole.value = loadout.main;
  ui.playerSub1Role.value = loadout.sub1;
  ui.playerSub2Role.value = loadout.sub2;
  renderLoadoutPreview(loadout, ui.loadoutPreview);
  updateShipSwitchLabels(loadout);
}

function readLoadoutFromControls() {
  return normalizeLoadout(
    {
      main: ui.playerMainRole.value,
      sub1: ui.playerSub1Role.value,
      sub2: ui.playerSub2Role.value,
    },
    DEFAULT_TEAM_LOADOUT,
  );
}

function roleSummaryLine(slotKey, characterId) {
  const def = CHARACTER_DEFS[characterId];
  const stat = def.stats;
  return `${slotLabel(slotKey)} ${def.shortName} | 舰体${stat.hp} | 能量${stat.energy} | 航速${stat.speed} | 机动${stat.turnRate.toFixed(2)}`;
}

function slotLabel(slotKey) {
  if (slotKey === "main") {
    return "主舰";
  }
  if (slotKey === "sub1") {
    return "副舰一";
  }
  return "副舰二";
}

function renderLoadoutPreview(loadout, target) {
  if (!target) {
    return;
  }
  target.innerHTML = "";
  ["main", "sub1", "sub2"].forEach((slotKey) => {
    const row = document.createElement("div");
    row.textContent = roleSummaryLine(slotKey, loadout[slotKey]);
    target.append(row);
  });
}

function updateShipSwitchLabels(loadout) {
  const labelMap = {
    main: `主舰 ${CHARACTER_DEFS[loadout.main].shortName}`,
    sub1: `副一 ${CHARACTER_DEFS[loadout.sub1].shortName}`,
    sub2: `副二 ${CHARACTER_DEFS[loadout.sub2].shortName}`,
  };
  for (const button of ui.shipSwitchButtons) {
    button.textContent = labelMap[button.dataset.ship] || button.textContent;
  }
}

function createSimulation() {
  return new MatchSimulation({
    mode: "ai",
    worldSize: canvas.width,
    teamNames: {
      A: "SOS先遣舰队",
      B: "统合思念体舰队",
    },
    teamLoadouts: {
      A: app.playerLoadout,
      B: app.enemyLoadout,
    },
  });
}

function resetMatch(logMessage = true) {
  app.sim = createSimulation();
  app.state = app.sim.serializeState();
  app.selectedShipKey = "main";
  app.selectedZoneId = 5;
  app.drag = null;
  app.suppressMapClick = false;
  app.pendingSubSkillAim = null;
  app.gameOverLogged = false;
  app.lastTime = performance.now();
  updateShipSwitchLabels(app.playerLoadout);
  if (logMessage) {
    clearLog();
    log("战斗开始。单击选战区，双击设目标点，拖拽控制点可调曲线。");
  }
  updateUi();
}

function setSelectedShip(shipKey) {
  const own = ownTeamState();
  if (!own || !own.ships || !shipKey) {
    return false;
  }
  const ship = own.ships[shipKey];
  if (!ship || !ship.alive || !ship.canControl) {
    return false;
  }
  app.selectedShipKey = shipKey;
  if (app.pendingSubSkillAim && app.pendingSubSkillAim.shipKey !== shipKey) {
    app.pendingSubSkillAim = null;
  }
  syncPowerSliderFromSelected();
  updateUi();
  return true;
}

function syncShipSelection() {
  const own = ownTeamState();
  if (!own || !own.ships) {
    return;
  }

  const selected = own.ships[app.selectedShipKey];
  if (!selected || !selected.alive || !selected.canControl) {
    const fallback = Object.keys(own.ships).find((key) => {
      const ship = own.ships[key];
      return ship && ship.alive && ship.canControl;
    });
    if (fallback) {
      app.selectedShipKey = fallback;
    }
  }

  for (const button of ui.shipSwitchButtons) {
    const key = button.dataset.ship;
    const ship = key ? own.ships[key] : null;
    const enabled = Boolean(ship && ship.alive && ship.canControl);
    button.disabled = !enabled;
    button.classList.toggle("active", key === app.selectedShipKey);
  }
}

function syncPowerSliderFromSelected() {
  if (document.activeElement === ui.powerSlider) {
    return;
  }
  const ship = selectedShipState();
  if (!ship) {
    return;
  }
  const value = Math.round(clamp((ship.throttle || 1) * 100, 25, 140));
  ui.powerSlider.value = String(value);
  ui.powerValue.textContent = `${value}%`;
}

function energyPercentForShip(ship) {
  const max = Math.max(1, Number(ship?.fleetMaxEnergy) || Number(ship?.maxEnergy) || 1);
  const value = Number(ship?.fleetEnergy) || Number(ship?.energy) || 0;
  return Math.round((value / max) * 100);
}

function currentFlagshipMeta(own) {
  const loadout = own && own.loadout ? own.loadout : app.playerLoadout;
  return skillMetaForCharacter(loadout.main, "flagship");
}

function currentSubMeta(selected) {
  if (!selected || selected.key === "main") {
    return null;
  }
  return skillMetaForCharacter(selected.characterId, "sub");
}

function updateSkillButtons(own) {
  if (!own) {
    ui.scoutBtn.disabled = true;
    ui.flagshipBtn.disabled = true;
    ui.subSkillBtn.disabled = true;
    return;
  }

  const cooldowns = own.cooldowns || {};
  const selected = selectedShipState();
  const mainShip = own.ships ? own.ships.main : null;
  const mainEnergy = mainShip ? Number(mainShip.fleetEnergy) || 0 : 0;

  const scoutLocked = own.skillsDisabled;
  ui.scoutBtn.disabled = scoutLocked || (cooldowns.scout || 0) > 0 || mainEnergy < 28;
  ui.scoutBtn.textContent = scoutLocked
    ? "派出侦查机（已被封印）"
    : (cooldowns.scout || 0) > 0
      ? `派出侦查机（冷却${(cooldowns.scout || 0).toFixed(1)}秒）`
      : "派出侦查机";

  const flagMeta = currentFlagshipMeta(own);
  if (!flagMeta) {
    ui.flagshipBtn.disabled = true;
    ui.flagshipBtn.textContent = "旗舰技能";
  } else if (flagMeta.type === "passive") {
    ui.flagshipBtn.disabled = true;
    ui.flagshipBtn.textContent = `旗舰技能：${flagMeta.name}（被动）`;
  } else {
    const disabled =
      own.skillsDisabled ||
      (cooldowns.flagship || 0) > 0 ||
      mainEnergy < (flagMeta.cost || 0) ||
      !(mainShip && mainShip.alive);
    ui.flagshipBtn.disabled = disabled;
    ui.flagshipBtn.textContent =
      (cooldowns.flagship || 0) > 0
        ? `旗舰技能：${flagMeta.name}（冷却${(cooldowns.flagship || 0).toFixed(1)}秒）`
        : `旗舰技能：${flagMeta.name}`;
  }

  const subMeta = currentSubMeta(selected);
  if (!selected || !subMeta) {
    ui.subSkillBtn.disabled = true;
    ui.subSkillBtn.textContent = "分舰技能：切换到副舰后使用";
    return;
  }

  const skillEnergy = Number(selected.fleetEnergy) || 0;
  const cooldown = Number(cooldowns[selected.key] || 0);
  const detached = !selected.attached && selected.canControl;
  const disabled = own.skillsDisabled || !detached || cooldown > 0 || skillEnergy < (subMeta.cost || 0);

  let suffix = "";
  if (own.skillsDisabled) {
    suffix = "（已被封印）";
  } else if (!detached) {
    suffix = "（分离后可用）";
  } else if (cooldown > 0) {
    suffix = `（冷却${cooldown.toFixed(1)}秒）`;
  } else if (app.pendingSubSkillAim && app.pendingSubSkillAim.shipKey === selected.key) {
    suffix = "（地图点击瞄准）";
  }
  ui.subSkillBtn.disabled = disabled;
  ui.subSkillBtn.textContent = `分舰技能：${subMeta.name}${suffix}`;
}

function updateUi() {
  const own = ownTeamState();
  if (!own) {
    return;
  }

  syncShipSelection();
  syncPowerSliderFromSelected();

  ui.hullValue.textContent = `${Math.round((own.hullRatio || 0) * 100)}%`;
  ui.splitValue.textContent = own.splitLevel === 0 ? "编队" : own.splitLevel === 1 ? "一级分离" : "二级分离";
  ui.zoneValue.textContent = `战区${app.selectedZoneId}`;

  const selectedState = selectedShipState();
  const selectedSim = selectedShipSim();
  ui.energyValue.textContent = `${energyPercentForShip(selectedState || own.ships.main)}%`;
  if (selectedState && selectedSim) {
    const minRadius = Math.round(selectedSim.routeConstraintProfile().minTurnRadius);
    ui.selectedValue.textContent = `${selectedState.characterName} | 推进 ${(selectedState.throttle || 1).toFixed(2)} | 能量 ${Math.round(
      Number(selectedState.fleetEnergy) || 0,
    )}/${Math.round(Number(selectedState.fleetMaxEnergy) || 1)} | 最小半径${minRadius}`;
  } else {
    ui.selectedValue.textContent = "无";
  }

  ui.splitOneBtn.disabled = own.splitLevel >= 1;
  ui.splitTwoBtn.disabled = own.splitLevel < 1 || own.splitLevel >= 2;
  updateSkillButtons(own);

  if (app.state.phase === "finished") {
    ui.overlay.classList.remove("hidden");
    if (app.state.winnerSeat === "A") {
      ui.overlayTitle.textContent = "胜利：敌方舰队已被击溃";
      if (!app.gameOverLogged) {
        log("战斗结束：SOS先遣舰队获胜");
      }
    } else if (app.state.winnerSeat === "B") {
      ui.overlayTitle.textContent = "失败：SOS先遣舰队被歼灭";
      if (!app.gameOverLogged) {
        log("战斗结束：SOS先遣舰队战败");
      }
    } else {
      ui.overlayTitle.textContent = "战斗结束";
      if (!app.gameOverLogged) {
        log("战斗结束：平局");
      }
    }
    app.gameOverLogged = true;
  } else {
    ui.overlay.classList.add("hidden");
    app.gameOverLogged = false;
  }
}

function drawBackground(elapsed) {
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#040d18");
  gradient.addColorStop(0.5, "#071423");
  gradient.addColorStop(1, "#050b14");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (const star of app.stars) {
    const alpha = 0.24 + Math.sin(elapsed * 1.6 + star.p) * 0.24 + 0.34;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#b7dbff";
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.r, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawZones() {
  if (!app.state || !app.state.zones) {
    return;
  }
  for (const zone of app.state.zones) {
    const selected = zone.id === app.selectedZoneId;
    ctx.strokeStyle = selected ? "#4ec9ff99" : "#2d5d884f";
    ctx.lineWidth = selected ? 2 : 1;
    ctx.strokeRect(zone.x, zone.y, zone.width, zone.height);

    ctx.fillStyle = selected ? "#76d6ff" : "#5f8ab8";
    ctx.font = "bold 14px 'Noto Sans SC', 'PingFang SC', sans-serif";
    ctx.fillText(`战区 ${zone.id}`, zone.x + 10, zone.y + 20);
  }
}

function drawRoute(route, selected) {
  if (!route) {
    return;
  }

  const { p0, p1, p2 } = route;

  ctx.save();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = selected ? "#a6ebff66" : "#77d8ff55";
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.strokeStyle = selected ? "#c4f4ff" : "#8fe9ff";
  ctx.lineWidth = selected ? 2.8 : 2.2;
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y);
  ctx.stroke();

  if (selected) {
    ctx.fillStyle = "#ffdd8a";
    ctx.beginPath();
    ctx.arc(p1.x, p1.y, ROUTE_HANDLE_RADIUS, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "#fff2bf";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = "#9af7b5";
    ctx.beginPath();
    ctx.arc(p2.x, p2.y, ROUTE_HANDLE_RADIUS - 1, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "#ddffe8";
    ctx.stroke();

    const progressPoint = quadraticPoint(p0, p1, p2, clamp(route.t || 0, 0, 1));
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(progressPoint.x, progressPoint.y, 3.2, 0, TAU);
    ctx.fill();
  }

  ctx.restore();
}

function drawShip(ship, color, selected, attached) {
  if (!ship || !ship.alive) {
    return;
  }

  ctx.save();
  ctx.translate(ship.x, ship.y);
  ctx.rotate(ship.angle);

  const hullScale = ship.key === "main" ? 0.72 : ship.key === "twin" ? 0.56 : 0.62;
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
  ctx.fillStyle = "#0f1f31";
  ctx.fillRect(ship.x - 13, ship.y - ship.radius - 10, 26, 4);
  ctx.fillStyle = hpRatio > 0.35 ? "#72f5a8" : "#ff8a8a";
  ctx.fillRect(ship.x - 13, ship.y - ship.radius - 10, 26 * hpRatio, 4);
  ctx.fillStyle = "#10263d";
  ctx.fillRect(ship.x - 13, ship.y - ship.radius - 4, 26, 3);
  ctx.fillStyle = "#6ad8ff";
  ctx.fillRect(ship.x - 13, ship.y - ship.radius - 4, 26 * energyRatio, 3);
}

function drawScout(scout, isOwnTeam) {
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

function drawWingman(wingman, isOwnTeam) {
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

function drawBeam(beam) {
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

function drawProjectile(projectile, isOwnTeam) {
  if (!projectile || !projectile.alive) {
    return;
  }
  ctx.save();
  ctx.fillStyle = projectile.color || (isOwnTeam ? "#9be8ff" : "#ffc0bd");
  ctx.beginPath();
  ctx.arc(projectile.x, projectile.y, projectile.radius || 2, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawBurst(burst) {
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

function drawFloatingText(label) {
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
  ctx.fillText(label.text || "", label.x, label.y);
  ctx.restore();
}

function drawSelectedVisionCircle() {
  const own = ownTeamState();
  if (!own || !own.ships) {
    return;
  }
  const selected = own.ships[app.selectedShipKey];
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

function drawFireArcBand(ship, startDeg, endDeg, outerRadius, innerRadius, color, alpha = 0.2) {
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

function drawFireArcLabel(ship, offsetDeg, radius, text, color) {
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

function drawSelectedFireArc() {
  const own = ownTeamState();
  if (!own || !own.ships) {
    return;
  }
  const ship = own.ships[app.selectedShipKey];
  if (!ship || !ship.alive) {
    return;
  }

  const outerRadius = clamp((ship.range || 0) * 0.22, 84, 124);
  const innerRadius = ship.radius + 14;
  const labelRadius = outerRadius - 12;

  if (own.loadout && own.loadout.main === "kyon") {
    drawFireArcBand(ship, -180, 180, outerRadius, innerRadius, "#7de4ff", 0.14);
    drawFireArcLabel(ship, 0, labelRadius, "均匀", "#b9f4ff");
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
    drawFireArcBand(ship, band.startDeg, band.endDeg, outerRadius, innerRadius, color, alpha);
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

  drawFireArcLabel(ship, 0, labelRadius, "1x", "#bfefff");
  drawFireArcLabel(ship, 90, labelRadius, "1.5x", "#ffe7a1");
  drawFireArcLabel(ship, -90, labelRadius, "1.5x", "#ffe7a1");
  drawFireArcLabel(ship, 135, labelRadius, "1x", "#bfefff");
  drawFireArcLabel(ship, -135, labelRadius, "1x", "#bfefff");
  drawFireArcLabel(ship, 180, labelRadius, "0x", "#ffb0b0");
}

function drawSubSkillAimHint() {
  const own = ownTeamState();
  if (!app.pendingSubSkillAim || !own || !own.ships) {
    return;
  }
  const ship = own.ships[app.pendingSubSkillAim.shipKey];
  if (!ship || !ship.alive || ship.attached) {
    return;
  }
  ctx.save();
  ctx.strokeStyle = "#7ff4ff";
  ctx.lineWidth = 1.6;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(ship.x, ship.y);
  ctx.lineTo(app.pointer.x, app.pointer.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawShipGroup(shipGroup, color, visibleEnemyIds = null) {
  for (const ship of shipGroup) {
    if (!ship || !ship.alive) {
      continue;
    }
    if (visibleEnemyIds && !visibleEnemyIds.has(ship.id) && app.state.phase !== "finished") {
      continue;
    }
    drawShip(ship, color, ship.key === app.selectedShipKey, ship.attached);
  }
}

function render() {
  if (!app.state) {
    return;
  }

  drawBackground(app.state.elapsed || 0);
  drawZones();

  const own = ownTeamState();
  const enemy = enemyTeamState();
  const visibleEnemyIds = new Set((own && own.visibleEnemyIds) || []);

  if (own && own.ships) {
    for (const ship of Object.values(own.ships)) {
      if (!ship || !ship.alive || !ship.route) {
        continue;
      }
      drawRoute(ship.route, ship.key === app.selectedShipKey);
    }
  }

  if (own && Array.isArray(own.beams)) {
    for (const beam of own.beams) {
      drawBeam(beam);
    }
  }
  if (enemy && Array.isArray(enemy.beams)) {
    for (const beam of enemy.beams) {
      drawBeam(beam);
    }
  }

  if (Array.isArray(app.state.projectiles)) {
    for (const projectile of app.state.projectiles) {
      if (!projectile || !projectile.alive) {
        continue;
      }
      drawProjectile(projectile, projectile.teamSeat === "A");
    }
  }

  if (own && own.ships) {
    drawShipGroup([...Object.values(own.ships), ...(own.extraShips || [])], own.color || "#65d9ff");
  }

  if (enemy && enemy.ships) {
    drawShipGroup([...Object.values(enemy.ships), ...(enemy.extraShips || [])], enemy.color || "#ff8692", visibleEnemyIds);
  }

  if (own && Array.isArray(own.scouts)) {
    for (const scout of own.scouts) {
      drawScout(scout, true);
    }
  }
  if (enemy && Array.isArray(enemy.scouts)) {
    for (const scout of enemy.scouts) {
      if (!visibleEnemyIds.has(scout.id) && app.state.phase !== "finished") {
        continue;
      }
      drawScout(scout, false);
    }
  }

  if (own && Array.isArray(own.wingmen)) {
    for (const wingman of own.wingmen) {
      drawWingman(wingman, true);
    }
  }
  if (enemy && Array.isArray(enemy.wingmen)) {
    for (const wingman of enemy.wingmen) {
      if (!visibleEnemyIds.has(wingman.id) && app.state.phase !== "finished") {
        continue;
      }
      drawWingman(wingman, false);
    }
  }

  if (Array.isArray(app.state.bursts)) {
    for (const burst of app.state.bursts) {
      drawBurst(burst);
    }
  }
  if (Array.isArray(app.state.floatingTexts)) {
    for (const label of app.state.floatingTexts) {
      drawFloatingText(label);
    }
  }

  drawSelectedFireArc();
  drawSelectedVisionCircle();
  drawSubSkillAimHint();
}

function tick(timestamp) {
  const dt = clamp((timestamp - app.lastTime) / 1000, 0, 0.05);
  app.lastTime = timestamp;

  if (app.sim && (!app.state || app.state.phase !== "finished")) {
    app.sim.update(dt);
  }
  app.state = app.sim ? app.sim.serializeState() : null;

  updateUi();
  render();

  requestAnimationFrame(tick);
}

function useFlagshipSkill() {
  const own = ownTeamState();
  const meta = currentFlagshipMeta(own);
  if (!meta || meta.type !== "active") {
    return;
  }
  const ok = applyAction({ type: "cast_flagship_skill", zoneId: app.selectedZoneId });
  if (ok) {
    log(`旗舰技能 ${meta.name} 已发动`);
  }
}

function useSubSkill() {
  const selected = selectedShipState();
  const own = ownTeamState();
  const meta = currentSubMeta(selected);
  if (!selected || !meta || !own) {
    return;
  }
  if (meta.target === "point") {
    app.pendingSubSkillAim = { shipKey: selected.key };
    log(`${meta.name} 瞄准模式：在地图上左键点击方向开火`);
    updateUi();
    return;
  }
  const ok = applyAction({
    type: "cast_sub_skill",
    shipKey: selected.key,
    zoneId: app.selectedZoneId,
  });
  if (ok) {
    log(`${selected.characterName} 使用 ${meta.name}`);
  }
}

function bindUiEvents() {
  for (const select of [ui.playerMainRole, ui.playerSub1Role, ui.playerSub2Role]) {
    select.addEventListener("change", () => {
      const normalized = readLoadoutFromControls();
      syncLoadoutControls(normalized);
    });
  }

  ui.applyLoadoutBtn.addEventListener("click", () => {
    app.playerLoadout = readLoadoutFromControls();
    syncLoadoutControls(app.playerLoadout);
    storeLoadout(app.playerLoadout);
    resetMatch(true);
    log("已应用新的出击阵容");
  });

  for (const button of ui.shipSwitchButtons) {
    button.addEventListener("click", () => {
      setSelectedShip(button.dataset.ship || "");
    });
  }

  ui.powerSlider.addEventListener("input", () => {
    const value = clamp(Number(ui.powerSlider.value), 25, 140);
    ui.powerValue.textContent = `${Math.round(value)}%`;
    applyAction({
      type: "set_throttle",
      shipKey: app.selectedShipKey,
      throttle: value / 100,
    });
  });

  bindPressButton(ui.splitOneBtn, () => {
    applyAction({ type: "split", level: 1 });
  });

  bindPressButton(ui.splitTwoBtn, () => {
    applyAction({ type: "split", level: 2 });
  });

  bindPressButton(ui.scoutBtn, () => {
    const ok = applyAction({ type: "launch_scout", zoneId: app.selectedZoneId });
    if (ok) {
      log(`侦查机已派往战区${app.selectedZoneId}`);
    }
  });

  bindPressButton(ui.flagshipBtn, useFlagshipSkill);
  bindPressButton(ui.subSkillBtn, useSubSkill);

  ui.restartBtn.addEventListener("click", () => {
    resetMatch(true);
  });

  canvas.addEventListener("mousedown", (event) => {
    if (event.button !== 0 || !app.state || app.state.phase === "finished") {
      return;
    }

    const pos = pointerFromEvent(event);
    app.pointer = pos;

    if (app.pendingSubSkillAim) {
      return;
    }

    const ship = selectedShipState();
    if (!ship || !ship.alive || !ship.canControl) {
      return;
    }

    const handle = routeHandleAtPoint(ship.route, pos.x, pos.y);
    if (!handle) {
      return;
    }

    app.drag = {
      handle,
      shipKey: ship.key,
    };
  });

  canvas.addEventListener("mousemove", (event) => {
    const pos = pointerFromEvent(event);
    app.pointer = pos;

    if (!app.drag || !app.state || app.state.phase === "finished") {
      return;
    }

    if (app.drag.handle === "control") {
      applyAction({
        type: "route_control",
        shipKey: app.drag.shipKey,
        controlX: pos.x,
        controlY: pos.y,
      });
    } else {
      applyAction({
        type: "route_end",
        shipKey: app.drag.shipKey,
        endX: pos.x,
        endY: pos.y,
      });
    }
  });

  window.addEventListener("mouseup", () => {
    if (!app.drag) {
      return;
    }
    app.drag = null;
    app.suppressMapClick = true;
  });

  canvas.addEventListener("click", (event) => {
    if (event.button !== 0 || !app.state || app.state.phase === "finished") {
      return;
    }

    if (app.suppressMapClick) {
      app.suppressMapClick = false;
      return;
    }

    const pos = pointerFromEvent(event);
    app.pointer = pos;

    if (app.pendingSubSkillAim) {
      const shipKey = app.pendingSubSkillAim.shipKey;
      applyAction({
        type: "cast_sub_skill",
        shipKey,
        targetX: pos.x,
        targetY: pos.y,
      });
      const ship = ownTeamState()?.ships?.[shipKey];
      const meta = ship ? currentSubMeta(ship) : null;
      app.pendingSubSkillAim = null;
      log(`${meta ? meta.name : "分舰技能"} 开始蓄力`);
      return;
    }

    const zone = zoneFromPoint(pos.x, pos.y);
    if (!zone) {
      return;
    }

    if (zone.id !== app.selectedZoneId) {
      app.selectedZoneId = zone.id;
      log(`已选中战区${zone.id}`);
    }
  });

  canvas.addEventListener("dblclick", (event) => {
    if (event.button !== 0 || !app.state || app.state.phase === "finished") {
      return;
    }

    if (app.pendingSubSkillAim) {
      return;
    }

    const pos = pointerFromEvent(event);
    app.pointer = pos;

    const ship = selectedShipState();
    if (!ship || !ship.alive || !ship.canControl) {
      log("当前没有可用舰船可设置目标点");
      return;
    }

    const throttle = clamp(Number(ui.powerSlider.value) / 100, 0.25, 1.4);
    applyAction({
      type: "set_route",
      shipKey: ship.key,
      endX: pos.x,
      endY: pos.y,
      throttle,
      anchorToMain: ship.key === "main",
    });
    const shipSim = selectedShipSim();
    const minRadius = shipSim ? Math.round(shipSim.routeConstraintProfile().minTurnRadius) : 0;
    log(`${ship.name} 已设置贝塞尔航线`);
    log(`当前最小可行转弯半径约 ${minRadius}`);
  });

  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) {
      return;
    }
    const active = document.activeElement;
    if (
      active &&
      (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT" || active.isContentEditable)
    ) {
      return;
    }

    const shipByKey = {
      Digit1: "main",
      Digit2: "sub1",
      Digit3: "sub2",
      Numpad1: "main",
      Numpad2: "sub1",
      Numpad3: "sub2",
    };
    const nextShip = shipByKey[event.code];
    if (!nextShip) {
      return;
    }
    if (setSelectedShip(nextShip)) {
      event.preventDefault();
    }
  });
}

function start() {
  populateLoadoutControls();
  bindUiEvents();
  resetMatch(true);
  requestAnimationFrame(tick);
}

start();
