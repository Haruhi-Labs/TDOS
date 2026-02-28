import { MatchSimulation, clamp, distance, quadraticPoint } from "../shared/game-core.js";

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
  shipSelect: document.getElementById("shipSelect"),
  clearRouteBtn: document.getElementById("clearRouteBtn"),
  scoutBtn: document.getElementById("scoutBtn"),
  haruhiBtn: document.getElementById("haruhiBtn"),
  mikuruBtn: document.getElementById("mikuruBtn"),
  zoneSelect: document.getElementById("zoneSelect"),
  log: document.getElementById("log"),
  overlay: document.getElementById("overlay"),
  overlayTitle: document.getElementById("overlayTitle"),
  restartBtn: document.getElementById("restartBtn"),
};

const TAU = Math.PI * 2;
const ROUTE_HANDLE_RADIUS = 11;

const app = {
  sim: new MatchSimulation({
    mode: "ai",
    worldSize: canvas.width,
    teamNames: {
      A: "团长舰队",
      B: "统合思念体舰队",
    },
  }),
  state: null,
  selectedShipKey: "main",
  selectedZoneId: 5,
  pointer: { x: canvas.width * 0.5, y: canvas.height * 0.5 },
  drag: null,
  suppressMapClick: false,
  pendingBeamAim: false,
  lastTime: performance.now(),
  gameOverLogged: false,
  stars: Array.from({ length: 220 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    r: Math.random() * 1.6 + 0.4,
    p: Math.random() * TAU,
  })),
};

function ownTeamState() {
  return app.state ? app.state.teams.A : null;
}

function enemyTeamState() {
  return app.state ? app.state.teams.B : null;
}

function ownTeamSim() {
  return app.sim.teamA;
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
  return own.ships[app.selectedShipKey] || null;
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
  while (ui.log.children.length > 22) {
    ui.log.removeChild(ui.log.lastChild);
  }
}

function applyAction(action) {
  app.sim.applyActionForSeat("A", action);
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

  ui.shipSelect.value = app.selectedShipKey;

  for (const option of Array.from(ui.shipSelect.options)) {
    const ship = own.ships[option.value];
    option.disabled = !(ship && ship.alive && ship.canControl);
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

function updateUi() {
  const own = ownTeamState();
  if (!own) {
    return;
  }

  syncShipSelection();
  syncPowerSliderFromSelected();

  ui.hullValue.textContent = `${Math.round((own.hullRatio || 0) * 100)}%`;
  ui.energyValue.textContent = `${Math.round(((own.energy || 0) / Math.max(1, own.maxEnergy || 1)) * 100)}%`;
  ui.splitValue.textContent = own.splitLevel === 0 ? "编队" : own.splitLevel === 1 ? "一级分离" : "二级分离";

  const selectedState = selectedShipState();
  const selectedSim = selectedShipSim();
  if (selectedState && selectedSim) {
    const minRadius = Math.round(selectedSim.routeConstraintProfile().minTurnRadius);
    ui.selectedValue.textContent = `${selectedState.name} | 推进 ${(selectedState.throttle || 1).toFixed(2)} | ${
      selectedState.route ? "曲线航行" : "直航"
    } | 最小半径${minRadius}`;
  } else {
    ui.selectedValue.textContent = "无";
  }

  ui.splitOneBtn.disabled = own.splitLevel >= 1;
  ui.splitTwoBtn.disabled = own.splitLevel < 1 || own.splitLevel >= 2;
  ui.clearRouteBtn.disabled = !(selectedState && selectedState.alive && selectedState.route);

  const cooldowns = own.cooldowns || {};
  const energy = Number(own.energy) || 0;

  ui.scoutBtn.disabled = (cooldowns.scout || 0) > 0 || energy < 30;
  ui.scoutBtn.textContent =
    (cooldowns.scout || 0) > 0 ? `派出侦查机（冷却${(cooldowns.scout || 0).toFixed(1)}秒）` : "派出侦查机";

  ui.haruhiBtn.disabled =
    (cooldowns.haruhi || 0) > 0 || energy < 55 || !(own.ships && own.ships.main && own.ships.main.alive);
  ui.haruhiBtn.textContent =
    (cooldowns.haruhi || 0) > 0
      ? `春日技能：战斗僚机（冷却${(cooldowns.haruhi || 0).toFixed(1)}秒）`
      : "春日技能：战斗僚机";

  const beamLocked = own.splitLevel < 2 || !(own.ships && own.ships.sub2 && own.ships.sub2.alive);
  ui.mikuruBtn.disabled = beamLocked || (cooldowns.beam || 0) > 0 || energy < 78;
  ui.mikuruBtn.textContent =
    beamLocked || (cooldowns.beam || 0) <= 0
      ? "实玖瑠技能：光束（地图瞄准）"
      : `实玖瑠技能：光束（冷却${(cooldowns.beam || 0).toFixed(1)}秒）`;

  if (app.pendingBeamAim && ui.mikuruBtn.disabled) {
    app.pendingBeamAim = false;
  }

  ui.zoneSelect.value = String(app.selectedZoneId);

  if (app.state.phase === "finished") {
    ui.overlay.classList.remove("hidden");
    if (app.state.winnerSeat === "A") {
      ui.overlayTitle.textContent = "胜利：敌方舰队已被击溃";
      if (!app.gameOverLogged) {
        log("战斗结束：团长舰队获胜");
      }
    } else if (app.state.winnerSeat === "B") {
      ui.overlayTitle.textContent = "失败：团长舰队被歼灭";
      if (!app.gameOverLogged) {
        log("战斗结束：团长舰队战败");
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

  const hullScale = ship.key === "main" ? 0.72 : 0.62;
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
  ctx.fillStyle = "#0f1f31";
  ctx.fillRect(ship.x - 13, ship.y - ship.radius - 9, 26, 4);
  ctx.fillStyle = hpRatio > 0.35 ? "#72f5a8" : "#ff8a8a";
  ctx.fillRect(ship.x - 13, ship.y - ship.radius - 9, 26 * hpRatio, 4);
}

function drawScout(scout, isOwnTeam) {
  if (!scout || !scout.alive) {
    return;
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
  const alpha = clamp((beam.life || 0) / 0.22, 0, 1);
  if (alpha <= 0) {
    return;
  }
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = beam.color || "#8ef8ff";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(beam.x1, beam.y1);
  ctx.lineTo(beam.x2, beam.y2);
  ctx.stroke();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = "#ffffff";
  ctx.globalAlpha = alpha * 0.6;
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

function drawBeamAimHint() {
  const own = ownTeamState();
  if (!app.pendingBeamAim || !own || !own.ships || !own.ships.sub2 || !own.ships.sub2.alive) {
    return;
  }
  const ship = own.ships.sub2;
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
    const selected = own.ships[app.selectedShipKey];
    if (selected && selected.route) {
      drawRoute(selected.route, true);
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
    for (const ship of Object.values(own.ships)) {
      drawShip(ship, own.color || "#65d9ff", ship.key === app.selectedShipKey, ship.attached);
    }
  }

  if (enemy && enemy.ships) {
    for (const ship of Object.values(enemy.ships)) {
      if (!visibleEnemyIds.has(ship.id) && app.state.phase !== "finished") {
        continue;
      }
      drawShip(ship, enemy.color || "#ff8692", false, ship.attached);
    }
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

  drawSelectedVisionCircle();
  drawBeamAimHint();
}

function tick(timestamp) {
  const dt = clamp((timestamp - app.lastTime) / 1000, 0, 0.05);
  app.lastTime = timestamp;

  if (!app.state || app.state.phase !== "finished") {
    app.sim.update(dt);
  }
  app.state = app.sim.serializeState();

  updateUi();
  render();

  requestAnimationFrame(tick);
}

function populateZoneSelect() {
  for (const zone of app.sim.zones) {
    const option = document.createElement("option");
    option.value = String(zone.id);
    option.textContent = `战区 ${zone.id}`;
    ui.zoneSelect.append(option);
  }
  ui.zoneSelect.value = String(app.selectedZoneId);
}

function bindUiEvents() {
  ui.shipSelect.addEventListener("change", () => {
    app.selectedShipKey = ui.shipSelect.value;
    syncPowerSliderFromSelected();
    updateUi();
  });

  ui.zoneSelect.addEventListener("change", () => {
    app.selectedZoneId = clamp(Number(ui.zoneSelect.value) || 5, 1, 9);
  });

  ui.powerSlider.addEventListener("input", () => {
    const value = clamp(Number(ui.powerSlider.value), 25, 140);
    ui.powerValue.textContent = `${Math.round(value)}%`;
    applyAction({
      type: "set_throttle",
      shipKey: app.selectedShipKey,
      throttle: value / 100,
    });
  });

  ui.clearRouteBtn.addEventListener("click", () => {
    const ship = selectedShipState();
    if (!ship || !ship.alive) {
      return;
    }
    applyAction({
      type: "clear_route",
      shipKey: app.selectedShipKey,
    });
    log(`${ship.name}已清除航线`);
  });

  ui.splitOneBtn.addEventListener("click", () => {
    applyAction({ type: "split", level: 1 });
  });

  ui.splitTwoBtn.addEventListener("click", () => {
    applyAction({ type: "split", level: 2 });
  });

  ui.scoutBtn.addEventListener("click", () => {
    applyAction({ type: "launch_scout", zoneId: app.selectedZoneId });
    log(`侦查机已派往战区${app.selectedZoneId}`);
  });

  ui.haruhiBtn.addEventListener("click", () => {
    applyAction({ type: "launch_wingman", zoneId: app.selectedZoneId });
    log(`战斗僚机已部署到战区${app.selectedZoneId}`);
  });

  ui.mikuruBtn.addEventListener("click", () => {
    const own = ownTeamState();
    const canBeam = own && own.splitLevel >= 2 && own.ships && own.ships.sub2 && own.ships.sub2.alive;
    if (!canBeam) {
      log("二级分离后才可使用实玖瑠光束");
      return;
    }
    app.pendingBeamAim = true;
    log("光束瞄准模式：在地图上左键点击方向开火");
  });

  ui.restartBtn.addEventListener("click", () => {
    window.location.reload();
  });

  canvas.addEventListener("mousedown", (event) => {
    if (event.button !== 0 || !app.state || app.state.phase === "finished") {
      return;
    }

    const pos = pointerFromEvent(event);
    app.pointer = pos;

    if (app.pendingBeamAim) {
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

    if (app.pendingBeamAim) {
      applyAction({
        type: "cast_beam",
        targetX: pos.x,
        targetY: pos.y,
      });
      app.pendingBeamAim = false;
      log("已发射实玖瑠光束");
      return;
    }

    const zone = zoneFromPoint(pos.x, pos.y);
    if (!zone) {
      return;
    }

    if (zone.id !== app.selectedZoneId) {
      app.selectedZoneId = zone.id;
      ui.zoneSelect.value = String(zone.id);
      log(`已选中战区${zone.id}`);
    }
  });

  canvas.addEventListener("dblclick", (event) => {
    if (event.button !== 0 || !app.state || app.state.phase === "finished") {
      return;
    }

    if (app.pendingBeamAim) {
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
      anchorToMain: true,
    });
    const shipSim = selectedShipSim();
    const minRadius = shipSim ? Math.round(shipSim.routeConstraintProfile().minTurnRadius) : 0;
    log(`${ship.name}已设置贝塞尔航线`);
    log(`当前最小可行转弯半径约 ${minRadius}`);
  });
}

function start() {
  app.state = app.sim.serializeState();
  populateZoneSelect();
  bindUiEvents();
  log("战斗开始。单击选战区，双击设目标点，拖拽控制点可调曲线。");
  updateUi();
  requestAnimationFrame(tick);
}

start();
