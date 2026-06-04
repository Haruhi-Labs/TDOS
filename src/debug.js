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
} from "../shared/game-core.js";

import { getLoadout } from "./profile.js";

// 可挂载模块状态：每次 mount 重新初始化（同一时刻只挂载一个模式）
let canvas, ctx, ui, loadoutUi, app;
let ac = null; // AbortController：统一移除 window 级监听
let rafId = 0; // 渲染循环句柄
let running = false; // 渲染循环开关

function addWin(type, handler) {
  window.addEventListener(type, handler, ac ? { signal: ac.signal } : undefined);
}

function cacheDom() {
  canvas = document.getElementById("debugCanvas");
  ctx = canvas.getContext("2d");
  ui = {
  timeValue: document.getElementById("debugTimeValue"),
  phaseValue: document.getElementById("debugPhaseValue"),
  speedValue: document.getElementById("debugSpeedValue"),
  selectedValue: document.getElementById("debugSelectedValue"),
  teamAHullValue: document.getElementById("debugTeamAHullValue"),
  teamASplitValue: document.getElementById("debugTeamASplitValue"),
  teamAVisionValue: document.getElementById("debugTeamAVisionValue"),
  teamBHullValue: document.getElementById("debugTeamBHullValue"),
  teamBSplitValue: document.getElementById("debugTeamBSplitValue"),
  teamBVisionValue: document.getElementById("debugTeamBVisionValue"),
  applySetupBtn: document.getElementById("applyDebugSetupBtn"),
  pauseBtn: document.getElementById("pauseDebugBtn"),
  stepBtn: document.getElementById("stepDebugBtn"),
  speedButtons: Array.from(document.querySelectorAll("#debugSpeedRow .debug-speed-btn")),
  focusButtons: Array.from(document.querySelectorAll("#debugFocusGrid .debug-focus-btn")),
  selectedCard: document.getElementById("debugSelectedShipCard"),
  teamAAiCard: document.getElementById("debugTeamAAiCard"),
  teamBAiCard: document.getElementById("debugTeamBAiCard"),
  log: document.getElementById("debugLog"),
  overlay: document.getElementById("debugOverlay"),
  overlayTitle: document.getElementById("debugOverlayTitle"),
  restartBtn: document.getElementById("debugRestartBtn"),
  legacyToggle: document.getElementById("debugLegacyToggle"),
  seatTagA: document.getElementById("debugSeatTagA"),
  seatTagB: document.getElementById("debugSeatTagB"),
  };

  loadoutUi = {
  A: {
    main: document.getElementById("debugTeamAMainRole"),
    sub1: document.getElementById("debugTeamASub1Role"),
    sub2: document.getElementById("debugTeamASub2Role"),
    preview: document.getElementById("debugTeamAPreview"),
  },
  B: {
    main: document.getElementById("debugTeamBMainRole"),
    sub1: document.getElementById("debugTeamBSub1Role"),
    sub2: document.getElementById("debugTeamBSub2Role"),
    preview: document.getElementById("debugTeamBPreview"),
  },
  };
}

const TAU = Math.PI * 2;
const STORAGE_KEYS = {
  A: "haruhi-debug-loadout-a-v1",
  B: "haruhi-debug-loadout-b-v1",
};
const MOBILE_ZOOM = 1.72;
const SPEED_PRESETS = [0.5, 1, 2, 4];

function initApp() {
  app = {
  sim: null,
  state: null,
  // A 队默认沿用玩家档案里的出战编队（与单机/在线共享），B 队默认 AI 阵容；两侧仍可各自独立改存
  teamALoadout: readStoredLoadout("A", getLoadout()),
  teamBLoadout: readStoredLoadout("B", DEFAULT_AI_LOADOUT),
  // 对照开关：B 队改用升级前的旧版AI，便于直观对比新AI的压制力
  opponentLegacy: window.localStorage.getItem("haruhi-debug-legacy-b") === "1",
  selected: {
    seat: "A",
    shipId: null,
  },
  paused: false,
  speedScale: 1,
  gameOverLogged: false,
  lastTime: performance.now(),
  mobileMode: false,
  cameraCenterX: canvas.width * 0.5,
  cameraCenterY: canvas.height * 0.5,
  cameraManualUntil: 0,
  stars: Array.from({ length: 220 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    r: Math.random() * 1.6 + 0.4,
    p: Math.random() * TAU,
  })),
  };
}

function readStoredLoadout(seat, fallback) {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS[seat]);
    if (!raw) {
      return cloneLoadout(fallback);
    }
    return normalizeLoadout(JSON.parse(raw), fallback);
  } catch (_error) {
    return cloneLoadout(fallback);
  }
}

function storeLoadout(seat, loadout) {
  try {
    window.localStorage.setItem(STORAGE_KEYS[seat], JSON.stringify(loadout));
  } catch (_error) {
    // 忽略存储失败
  }
}

function teamState(seat) {
  return app.state ? app.state.teams[seat] || null : null;
}

function teamSim(seat) {
  return app.sim ? app.sim.teamBySeat(seat) : null;
}

function botState(seat) {
  return app.state?.bots?.[seat] || null;
}

function splitLabel(level) {
  if (level <= 0) {
    return "编队";
  }
  return level === 1 ? "一级分离" : "二级分离";
}

function shipCollection(team) {
  if (!team) {
    return [];
  }
  return [...Object.values(team.ships || {}), ...(team.extraShips || [])].filter(Boolean);
}

function findShip(team, shipId = null) {
  if (!team) {
    return null;
  }
  if (shipId != null) {
    const match = shipCollection(team).find((ship) => ship.id === shipId);
    if (match) {
      return match;
    }
  }
  return null;
}

function findShipByKey(team, shipKey) {
  if (!team) {
    return null;
  }
  if (team.ships && team.ships[shipKey]) {
    return team.ships[shipKey];
  }
  return shipCollection(team).find((ship) => ship.key === shipKey) || null;
}

function selectedShipState() {
  return findShip(teamState(app.selected.seat), app.selected.shipId);
}

function selectedShipSim() {
  return findShip(teamSim(app.selected.seat), app.selected.shipId);
}

function slotLabel(slotKey) {
  if (slotKey === "main") {
    return "主舰";
  }
  if (slotKey === "sub1") {
    return "副舰一";
  }
  if (slotKey === "sub2") {
    return "副舰二";
  }
  if (slotKey === "twin") {
    return "1096僚舰";
  }
  return slotKey || "舰船";
}

function seatLabel(seat) {
  return seat === "A" ? "A队" : "B队";
}

function modeLabel(mode) {
  const labels = {
    press: "压进",
    search: "搜索",
    recover: "脱边",
    harvest: "回能",
    regroup: "收拢",
    kite: "拉扯",
    collapse: "合围",
    broadside: "抢侧舷",
    cutoff: "截击",
    support: "支援",
    fire: "火力位",
    rear: "后撤点",
    front: "前探",
    flank: "绕后",
    intel: "侦察",
    escape: "脱困",
  };
  return labels[mode] || mode || "待机";
}

function decisionLabel(action) {
  const labels = {
    idle: "待命",
    hold: "暂缓",
    launch: "已发侦察",
    retry: "再次尝试",
    cast: "已释放",
    unavailable: "不可用",
  };
  return labels[action] || action || "待命";
}

function intelSourceLabel(source) {
  const labels = {
    visible: "可见",
    memory: "记忆",
    spawn: "出生点",
  };
  return labels[source] || source || "未知";
}

function shortPercent(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

function shortNumber(value, digits = 2) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : "-";
}

function pointText(point) {
  if (!point) {
    return "-";
  }
  const zone = Number.isFinite(point.zoneId) ? ` Z${point.zoneId}` : "";
  return `${Math.round(point.x)},${Math.round(point.y)}${zone}`;
}

function botContactLabel(contact) {
  if (!contact) {
    return "无";
  }
  const def = contact.characterId ? CHARACTER_DEFS[contact.characterId] : null;
  const role = contact.kind === "ship"
    ? slotLabel(contact.slotKey)
    : contact.kind === "wingman"
      ? "僚机"
      : contact.kind === "scout"
        ? "侦察机"
        : contact.kind;
  return `${role}${def ? ` ${def.shortName}` : ""}`.trim();
}

function roleSummaryLine(slotKey, characterId) {
  const def = CHARACTER_DEFS[characterId];
  const stat = def.stats;
  return `${slotLabel(slotKey)} ${def.shortName} | 舰体${stat.hp} | 能量${stat.energy} | 航速${stat.speed} | 机动${stat.turnRate.toFixed(2)}`;
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

function createRoleOption(characterId) {
  const def = CHARACTER_DEFS[characterId];
  const option = document.createElement("option");
  option.value = characterId;
  option.textContent = `${def.shortName} · ${def.title}`;
  return option;
}

function populateLoadoutControls() {
  for (const seat of ["A", "B"]) {
    for (const key of ["main", "sub1", "sub2"]) {
      const select = loadoutUi[seat][key];
      select.innerHTML = "";
      for (const characterId of CHARACTER_ORDER) {
        select.append(createRoleOption(characterId));
      }
    }
  }
  syncLoadoutControls("A", app.teamALoadout);
  syncLoadoutControls("B", app.teamBLoadout);
}

function syncLoadoutControls(seat, loadout) {
  loadoutUi[seat].main.value = loadout.main;
  loadoutUi[seat].sub1.value = loadout.sub1;
  loadoutUi[seat].sub2.value = loadout.sub2;
  renderLoadoutPreview(loadout, loadoutUi[seat].preview);
  updateFocusButtonLabels();
}

function readLoadoutFromControls(seat, fallback) {
  return normalizeLoadout(
    {
      main: loadoutUi[seat].main.value,
      sub1: loadoutUi[seat].sub1.value,
      sub2: loadoutUi[seat].sub2.value,
    },
    fallback,
  );
}

function updateFocusButtonLabels() {
  const loadouts = {
    A: app.teamALoadout,
    B: app.teamBLoadout,
  };
  for (const button of ui.focusButtons) {
    const seat = button.dataset.seat;
    const shipKey = button.dataset.ship;
    const loadout = loadouts[seat];
    const characterId = loadout ? loadout[shipKey] : null;
    const shortName = characterId && CHARACTER_DEFS[characterId] ? CHARACTER_DEFS[characterId].shortName : shipKey;
    const prefix = seat === "A" ? "A" : "B";
    const slot = shipKey === "main" ? "主" : shipKey === "sub1" ? "一" : "二";
    button.textContent = `${prefix}${slot} ${shortName}`;
  }
}

function prefersMobileBattleMode() {
  return window.matchMedia("(max-width: 980px)").matches || window.matchMedia("(pointer: coarse)").matches;
}

function screenPointFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) * (canvas.width / rect.width);
  const y = (event.clientY - rect.top) * (canvas.height / rect.height);
  return {
    x: clamp(x, 0, canvas.width),
    y: clamp(y, 0, canvas.height),
  };
}

function currentViewState() {
  if (!app.mobileMode) {
    return {
      zoom: 1,
      left: 0,
      top: 0,
      width: canvas.width,
      height: canvas.height,
    };
  }
  const zoom = MOBILE_ZOOM;
  const width = canvas.width / zoom;
  const height = canvas.height / zoom;
  const halfW = width * 0.5;
  const halfH = height * 0.5;
  const centerX = clamp(app.cameraCenterX, halfW, canvas.width - halfW);
  const centerY = clamp(app.cameraCenterY, halfH, canvas.height - halfH);
  return {
    zoom,
    left: centerX - halfW,
    top: centerY - halfH,
    width,
    height,
  };
}

function worldPointFromScreenPoint(x, y) {
  const view = currentViewState();
  return {
    x: clamp(view.left + x / view.zoom, 0, canvas.width),
    y: clamp(view.top + y / view.zoom, 0, canvas.height),
  };
}

function pointerFromEvent(event) {
  const screen = screenPointFromEvent(event);
  return worldPointFromScreenPoint(screen.x, screen.y);
}

function minimapRect() {
  if (!app.mobileMode) {
    return null;
  }
  const size = clamp(canvas.width * 0.145, 180, 230);
  return {
    x: canvas.width - size - 18,
    y: 18,
    width: size,
    height: size,
  };
}

function minimapWorldPointFromScreenPoint(screenX, screenY) {
  const rect = minimapRect();
  if (!rect) {
    return null;
  }
  if (screenX < rect.x || screenX > rect.x + rect.width || screenY < rect.y || screenY > rect.y + rect.height) {
    return null;
  }
  return {
    x: clamp(((screenX - rect.x) / rect.width) * canvas.width, 0, canvas.width),
    y: clamp(((screenY - rect.y) / rect.height) * canvas.height, 0, canvas.height),
  };
}

function centerCameraOn(x, y, manual = true) {
  app.cameraCenterX = clamp(x, 0, canvas.width);
  app.cameraCenterY = clamp(y, 0, canvas.height);
  if (manual) {
    app.cameraManualUntil = performance.now() + 2400;
  }
}

function updateCamera() {
  if (!app.mobileMode) {
    app.cameraCenterX = canvas.width * 0.5;
    app.cameraCenterY = canvas.height * 0.5;
    return;
  }
  const ship = selectedShipState();
  if (!ship || !ship.alive) {
    return;
  }
  if (performance.now() < app.cameraManualUntil) {
    return;
  }
  const lead = clamp((ship.speed || 0) * 3.1, 34, 92);
  const targetX = ship.x + Math.cos(ship.angle || 0) * lead;
  const targetY = ship.y + Math.sin(ship.angle || 0) * lead;
  app.cameraCenterX = clamp(app.cameraCenterX + (targetX - app.cameraCenterX) * 0.14, 0, canvas.width);
  app.cameraCenterY = clamp(app.cameraCenterY + (targetY - app.cameraCenterY) * 0.14, 0, canvas.height);
}

function syncResponsiveMode() {
  app.mobileMode = prefersMobileBattleMode();
  if (!app.mobileMode) {
    app.cameraManualUntil = 0;
  }
}

function zoneFromPoint(x, y) {
  const zones = app.state ? app.state.zones : [];
  return zones.find((zone) => x >= zone.x && x < zone.x + zone.width && y >= zone.y && y < zone.y + zone.height) || null;
}

function log(message) {
  const row = document.createElement("div");
  const elapsed = app.state ? app.state.elapsed : 0;
  row.textContent = `[${elapsed.toFixed(1)}秒] ${message}`;
  ui.log.prepend(row);
  while (ui.log.children.length > 28) {
    ui.log.removeChild(ui.log.lastChild);
  }
}

function clearLog() {
  ui.log.innerHTML = "";
}

function createSimulation() {
  const legacyB = app.opponentLegacy;
  return new MatchSimulation({
    mode: "pvp",
    aiSeats: ["A", "B"],
    legacyAiSeats: legacyB ? ["B"] : [], // B 队用旧版AI做对照
    worldSize: canvas.width,
    teamNames: {
      A: legacyB ? "新版AI · A队" : "调试舰队A",
      B: legacyB ? "旧版AI · B队" : "调试舰队B",
    },
    teamLoadouts: {
      A: app.teamALoadout,
      B: app.teamBLoadout,
    },
  });
}

function refreshLegacyLabels() {
  const on = app.opponentLegacy;
  if (ui.seatTagA) ui.seatTagA.textContent = on ? "新AI" : "AI";
  if (ui.seatTagB) ui.seatTagB.textContent = on ? "旧AI" : "AI";
}

function setSelectedShip(seat, shipId) {
  const team = teamState(seat);
  const ship = findShip(team, shipId);
  if (!ship || !ship.alive) {
    return false;
  }
  app.selected.seat = seat;
  app.selected.shipId = ship.id;
  if (app.mobileMode) {
    centerCameraOn(ship.x, ship.y, false);
  }
  updateUi();
  return true;
}

function setSelectedShipByKey(seat, shipKey) {
  const team = teamState(seat);
  const ship = findShipByKey(team, shipKey);
  return ship ? setSelectedShip(seat, ship.id) : false;
}

function firstAliveShip(seat) {
  const team = teamState(seat);
  const preferred = [
    findShipByKey(team, "main"),
    findShipByKey(team, "sub1"),
    findShipByKey(team, "sub2"),
    ...shipCollection(team),
  ];
  return preferred.find((ship) => ship && ship.alive) || null;
}

function syncSelectedShip() {
  const selected = selectedShipState();
  if (selected && selected.alive) {
    return;
  }

  const preferred = firstAliveShip(app.selected.seat);
  if (preferred) {
    app.selected.shipId = preferred.id;
    return;
  }

  const fallbackSeat = app.selected.seat === "A" ? "B" : "A";
  const fallback = firstAliveShip(fallbackSeat);
  if (fallback) {
    app.selected.seat = fallbackSeat;
    app.selected.shipId = fallback.id;
  }
}

function shipAtPoint(x, y) {
  let best = null;
  let bestDist = Infinity;
  const hitPadding = app.mobileMode ? 28 : 14;
  for (const seat of ["A", "B"]) {
    for (const ship of shipCollection(teamState(seat))) {
      if (!ship || !ship.alive) {
        continue;
      }
      const d = distance(x, y, ship.x, ship.y);
      if (d <= ship.radius + hitPadding && d < bestDist) {
        best = {
          seat,
          ship,
        };
        bestDist = d;
      }
    }
  }
  return best;
}

function advanceSimulation(seconds) {
  if (!app.sim) {
    return;
  }
  let remaining = Math.max(0, Number(seconds) || 0);
  while (remaining > 0) {
    const step = Math.min(remaining, 0.05);
    app.sim.update(step);
    remaining -= step;
  }
}

function resetMatch(logMessage = true) {
  app.sim = createSimulation();
  app.state = app.sim.serializeState();
  app.paused = false;
  app.gameOverLogged = false;
  app.lastTime = performance.now();
  app.selected.seat = "A";
  app.selected.shipId = app.state.teams.A.ships.main.id;
  app.cameraManualUntil = 0;
  const mainShip = app.state.teams.A.ships.main;
  app.cameraCenterX = mainShip.x;
  app.cameraCenterY = mainShip.y;
  if (logMessage) {
    clearLog();
    log("调试战开始。双方均由 AI 控制，可暂停、倍速和切换观察目标。");
  }
  updateUi();
}

function hullPercent(ship) {
  if (!ship) {
    return 0;
  }
  return Math.round((Number(ship.hp) || 0) / Math.max(1, Number(ship.maxHp) || 1) * 100);
}

function energyPercent(ship) {
  if (!ship) {
    return 0;
  }
  return Math.round((Number(ship.fleetEnergy) || Number(ship.energy) || 0) / Math.max(1, Number(ship.fleetMaxEnergy) || Number(ship.maxEnergy) || 1) * 100);
}

function updateFocusButtons() {
  for (const button of ui.focusButtons) {
    const seat = button.dataset.seat;
    const shipKey = button.dataset.ship;
    const ship = findShipByKey(teamState(seat), shipKey);
    button.disabled = !(ship && ship.alive);
    button.classList.toggle("active", Boolean(ship && ship.id === app.selected.shipId && seat === app.selected.seat));
  }
}

function setSpeedScale(value, silent = false) {
  const next = SPEED_PRESETS.includes(value) ? value : 1;
  app.speedScale = next;
  if (!silent) {
    log(`调试倍速切换为 ${next}x`);
  }
  updateUi();
}

function renderAiCard(seat) {
  const target = seat === "A" ? ui.teamAAiCard : ui.teamBAiCard;
  const bot = botState(seat);
  if (!target) {
    return;
  }
  if (!bot) {
    target.textContent = "该席当前未启用 AI。";
    return;
  }

  const context = bot.context || {};
  const focus = bot.focus;
  const scout = bot.scoutDecision || {};
  const flagship = bot.flagshipDecision || {};
  const subSkills = bot.subSkillDecision || {};
  const split = bot.splitDecision || {};
  const detachedPlan = bot.detachedPlan || {};
  const tags = [
    context.searchRequired ? "需搜索" : null,
    context.trackableIntel ? "可追踪" : null,
    context.emergencyCommit ? "紧急投入" : null,
    context.conserveEnergy ? "保能" : null,
    context.killWindow ? "斩杀窗" : null,
    context.enemyBroadsideRisk ? "避侧舷" : null,
    context.safeExchange ? "交换有利" : null,
  ].filter(Boolean);
  const tagHtml = tags.length
    ? tags.map((label) => `<span class="debug-ai-tag${label === "紧急投入" ? " alert" : label === "交换有利" ? " good" : ""}">${label}</span>`).join("")
    : '<span class="debug-ai-tag">常规态势</span>';

  const orderLines = ["main", "sub1", "sub2"].map((shipKey) => {
    const order = bot.orders?.[shipKey];
    if (!order) {
      return `<div><strong>${slotLabel(shipKey)}</strong> 暂无新命令</div>`;
    }
    return `<div><strong>${slotLabel(shipKey)}</strong> ${modeLabel(order.role)} -> ${pointText(order.target)} @${Math.round((order.throttle || 0) * 100)}%</div>`;
  }).join("");

  const threatLines = ["main", "sub1", "sub2"].map((shipKey) => {
    const threat = context.shipThreats?.[shipKey];
    if (!threat) {
      return `<div><strong>${slotLabel(shipKey)}</strong> 威胁 -</div>`;
    }
    return `<div><strong>${slotLabel(shipKey)}</strong> 威胁 ${shortNumber(threat.danger)} | 火源 ${threat.sources}${threat.overwhelmed ? " | 被围" : ""}</div>`;
  }).join("");

  const splitText = split.acted && split.acted.length
    ? `已执行 ${split.acted.join("、")} 级分离`
    : split.attempt1 || split.attempt2
      ? `评估分离 ${[split.attempt1 ? "1" : null, split.attempt2 ? "2" : null].filter(Boolean).join("/")}`
      : `分离层级 ${split.level || 0}`;
  const detachedText = ["sub1", "sub2"].map((shipKey) => {
    const role = detachedPlan.roles?.[shipKey];
    if (!role) {
      return `${slotLabel(shipKey)} 未独立`;
    }
    const suffix = detachedPlan.intelLeadKey === shipKey ? "侦察主力" : detachedPlan.retreatKey === shipKey ? "后撤保命" : "执行中";
    return `${slotLabel(shipKey)} ${modeLabel(role)}·${suffix}`;
  }).join(" | ");

  target.innerHTML = [
    `<div class="debug-ai-headline"><strong>${modeLabel(bot.mode)}</strong><span>模式锁定 ${shortNumber(bot.modeTimer, 1)}秒</span></div>`,
    `<div class="debug-ai-tags">${tagHtml}</div>`,
    `<div class="debug-ai-grid">`,
    `<div><strong>焦点</strong>${botContactLabel(focus)} | ${focus ? `${intelSourceLabel(focus.source)} ${shortNumber(focus.age, 1)}秒` : "无"}</div>`,
    `<div><strong>焦点坐标</strong>${pointText(focus)}</div>`,
    `<div><strong>局部优势</strong>${shortNumber(context.localAdvantage)}</div>`,
    `<div><strong>最大威胁</strong>${shortNumber(context.maxShipThreat)}</div>`,
    `<div><strong>舰队能量</strong>${shortPercent(context.energyRatio)}</div>`,
    `<div><strong>回能需求</strong>${shortPercent(context.energyRecoveryNeed)}</div>`,
    `<div><strong>压制意愿</strong>${shortNumber(context.pressureDrive)}</div>`,
    `<div><strong>围堵压力</strong>${shortNumber(context.encirclePressure)}</div>`,
    `<div><strong>射界交换</strong>${shortNumber(context.arcAdvantage)}</div>`,
    `<div><strong>搜索中心</strong>${pointText(bot.searchCenter)}</div>`,
    `</div>`,
    `<div class="debug-ai-orders">${orderLines}</div>`,
    `<div class="debug-ai-orders">${threatLines}</div>`,
    `<div class="debug-ai-orders">`,
    `<div><strong>副舰分工</strong> ${detachedText}</div>`,
    `<div><strong>侦察</strong> ${decisionLabel(scout.action)}${Number.isFinite(scout.zoneId) ? ` -> 战区${scout.zoneId}` : ""} | CD ${shortNumber(scout.nextIn, 1)}秒</div>`,
    `<div><strong>旗舰技</strong> ${decisionLabel(flagship.action)} | CD ${shortNumber(bot.flagshipTimer, 1)}秒</div>`,
    `<div><strong>副舰技</strong> 一 ${decisionLabel(subSkills.sub1?.action)} ${shortNumber(subSkills.sub1?.nextIn, 1)}秒 / 二 ${decisionLabel(subSkills.sub2?.action)} ${shortNumber(subSkills.sub2?.nextIn, 1)}秒</div>`,
    `<div><strong>分离判断</strong> ${splitText}</div>`,
    `</div>`,
  ].join("");
}

function updateAiCards() {
  renderAiCard("A");
  renderAiCard("B");
}

function updateSelectedCard() {
  const ship = selectedShipState();
  const shipSim = selectedShipSim();
  if (!ship || !ship.alive) {
    ui.selectedCard.textContent = "当前没有可观察舰船。";
    return;
  }
  const minRadius = shipSim ? Math.round(shipSim.routeConstraintProfile().minTurnRadius) : 0;
  const zone = zoneFromPoint(ship.x, ship.y);
  const zoneText = zone ? `战区${zone.id}` : "无战区";
  const bot = botState(app.selected.seat);
  const order = bot?.orders?.[ship.key];
  const shipThreat = bot?.context?.shipThreats?.[ship.key];
  ui.selectedCard.innerHTML = [
    `<strong>${seatLabel(app.selected.seat)} ${slotLabel(ship.key)} · ${ship.characterName}</strong>`,
    `舰体 ${Math.round(ship.hp)}/${Math.round(ship.maxHp)}（${hullPercent(ship)}%） | 能量 ${Math.round(Number(ship.fleetEnergy) || 0)}/${Math.round(Number(ship.fleetMaxEnergy) || 1)}（${energyPercent(ship)}%）`,
    `推进 ${Math.round((ship.throttle || 1) * 100)}% | 航速 ${(ship.speed || 0).toFixed(1)} | 最小转弯半径 ${minRadius}`,
    `视野 ${Math.round(ship.vision || 0)} | 射程 ${Math.round(ship.range || 0)} | ${zoneText} | ${ship.attached ? "附着中" : "独立编队"}`,
    order ? `AI命令 ${modeLabel(order.role)} -> ${pointText(order.target)} @${Math.round((order.throttle || 0) * 100)}%` : "AI命令 暂无",
    shipThreat ? `承压 ${shortNumber(shipThreat.danger)} | 火源 ${shipThreat.sources}${shipThreat.overwhelmed ? " | 被围攻" : ""}` : "承压 -",
  ].join("<br />");
}

function updateUi() {
  if (!app.state) {
    return;
  }

  syncSelectedShip();
  updateFocusButtons();
  updateSelectedCard();
  updateAiCards();

  const teamA = teamState("A");
  const teamB = teamState("B");
  const selected = selectedShipState();

  ui.timeValue.textContent = `${app.state.elapsed.toFixed(1)}秒`;
  ui.phaseValue.textContent = app.state.phase === "finished" ? "战斗结束" : app.paused ? "已暂停" : "运行中";
  ui.speedValue.textContent = `${app.speedScale}x`;
  ui.selectedValue.textContent = selected ? `${seatLabel(app.selected.seat)} ${selected.characterName}` : "无";

  ui.teamAHullValue.textContent = `${Math.round((teamA?.hullRatio || 0) * 100)}%`;
  ui.teamASplitValue.textContent = splitLabel(teamA?.splitLevel || 0);
  ui.teamAVisionValue.textContent = `${(teamA?.visibleEnemyIds || []).length}个目标`;

  ui.teamBHullValue.textContent = `${Math.round((teamB?.hullRatio || 0) * 100)}%`;
  ui.teamBSplitValue.textContent = splitLabel(teamB?.splitLevel || 0);
  ui.teamBVisionValue.textContent = `${(teamB?.visibleEnemyIds || []).length}个目标`;

  ui.pauseBtn.textContent = app.paused ? "继续" : "暂停";
  ui.stepBtn.disabled = !app.sim || app.state.phase === "finished";

  for (const button of ui.speedButtons) {
    button.classList.toggle("active", Number(button.dataset.speed) === app.speedScale);
  }

  if (app.state.phase === "finished") {
    ui.overlay.classList.remove("hidden");
    if (app.state.winnerSeat === "A") {
      ui.overlayTitle.textContent = "调试战结束：A队获胜";
      if (!app.gameOverLogged) {
        log("调试战结束：A队获胜");
      }
    } else if (app.state.winnerSeat === "B") {
      ui.overlayTitle.textContent = "调试战结束：B队获胜";
      if (!app.gameOverLogged) {
        log("调试战结束：B队获胜");
      }
    } else {
      ui.overlayTitle.textContent = "调试战结束：平局";
      if (!app.gameOverLogged) {
        log("调试战结束：平局");
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
    ctx.strokeStyle = "#2d5d884f";
    ctx.lineWidth = 1;
    ctx.strokeRect(zone.x, zone.y, zone.width, zone.height);

    ctx.fillStyle = "#5f8ab8";
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

  if (selected && !app.mobileMode) {
    ctx.fillStyle = "#ffdd8a";
    ctx.beginPath();
    ctx.arc(p1.x, p1.y, 11, 0, TAU);
    ctx.fill();

    ctx.fillStyle = "#9af7b5";
    ctx.beginPath();
    ctx.arc(p2.x, p2.y, 10, 0, TAU);
    ctx.fill();

    const progressPoint = quadraticPoint(p0, p1, p2, clamp(route.t || 0, 0, 1));
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(progressPoint.x, progressPoint.y, 3.2, 0, TAU);
    ctx.fill();
  }

  ctx.restore();
}

function shipHullDrawScale(ship) {
  const baseScale = ship.key === "main" ? 0.72 : ship.key === "twin" ? 0.56 : 0.62;
  const baseRadius = ship.key === "main" ? 10 : ship.key === "twin" ? 8 : 9;
  return baseScale * ((ship.radius || baseRadius) / baseRadius);
}

function drawShip(ship, color, selected, attached) {
  if (!ship || !ship.alive) {
    return;
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
    ctx.lineWidth = 2;
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
}

function drawScout(scout, isTeamA) {
  if (!scout || !scout.alive) {
    return;
  }

  if (Number.isFinite(scout.vision) && scout.vision > 0) {
    ctx.save();
    ctx.strokeStyle = isTeamA ? "#8adfff40" : "#ffb7c040";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(scout.x, scout.y, scout.vision, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.translate(scout.x, scout.y);
  ctx.rotate(scout.angle || 0);
  ctx.fillStyle = isTeamA ? "#9de8ff" : "#ffb7c0";
  ctx.beginPath();
  ctx.moveTo(5, 0);
  ctx.lineTo(0, -3);
  ctx.lineTo(-5, 0);
  ctx.lineTo(0, 3);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawWingman(wingman, isTeamA) {
  if (!wingman || !wingman.alive) {
    return;
  }
  ctx.save();
  ctx.translate(wingman.x, wingman.y);
  ctx.rotate(wingman.angle || 0);
  ctx.fillStyle = isTeamA ? "#ffe7aa" : "#ffc6b3";
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

function drawProjectile(projectile, isTeamA) {
  if (!projectile || !projectile.alive) {
    return;
  }
  ctx.save();
  ctx.fillStyle = projectile.color || (isTeamA ? "#9be8ff" : "#ffc0bd");
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
  const ship = selectedShipState();
  if (!ship || !ship.alive || !ship.vision) {
    return;
  }
  ctx.save();
  ctx.strokeStyle = "#8adfff3a";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(ship.x, ship.y, ship.vision, 0, TAU);
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
  const ship = selectedShipState();
  const team = teamState(app.selected.seat);
  if (!ship || !ship.alive || !team) {
    return;
  }

  const outerRadius = clamp((ship.range || 0) * 0.22, 84, 124);
  const innerRadius = ship.radius + 14;
  const labelRadius = outerRadius - 12;

  if (team.loadout && team.loadout.main === "kyon") {
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

function drawMinimap() {
  if (!app.mobileMode || !app.state) {
    return;
  }
  const rect = minimapRect();
  if (!rect) {
    return;
  }

  ctx.save();
  ctx.fillStyle = "#06121fda";
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.strokeStyle = "#285279";
  ctx.lineWidth = 2;
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

  if (Array.isArray(app.state.zones)) {
    for (const zone of app.state.zones) {
      const zx = rect.x + (zone.x / canvas.width) * rect.width;
      const zy = rect.y + (zone.y / canvas.height) * rect.height;
      const zw = (zone.width / canvas.width) * rect.width;
      const zh = (zone.height / canvas.height) * rect.height;
      ctx.strokeStyle = "#2d5d884f";
      ctx.lineWidth = 1;
      ctx.strokeRect(zx, zy, zw, zh);
    }
  }

  const plotShip = (ship, color, selected) => {
    if (!ship || !ship.alive) {
      return;
    }
    const x = rect.x + (ship.x / canvas.width) * rect.width;
    const y = rect.y + (ship.y / canvas.height) * rect.height;
    ctx.fillStyle = selected ? "#ffe184" : color;
    ctx.beginPath();
    ctx.arc(x, y, selected ? 4 : 3.2, 0, TAU);
    ctx.fill();
  };

  for (const seat of ["A", "B"]) {
    const color = seat === "A" ? "#79dcff" : "#ff95a0";
    for (const ship of shipCollection(teamState(seat))) {
      plotShip(ship, color, ship.id === app.selected.shipId && seat === app.selected.seat);
    }
  }

  const view = currentViewState();
  ctx.strokeStyle = "#ffe08a";
  ctx.lineWidth = 1.6;
  ctx.strokeRect(
    rect.x + (view.left / canvas.width) * rect.width,
    rect.y + (view.top / canvas.height) * rect.height,
    (view.width / canvas.width) * rect.width,
    (view.height / canvas.height) * rect.height,
  );

  ctx.fillStyle = "#d2ecff";
  ctx.font = "bold 11px 'Noto Sans SC', 'PingFang SC', sans-serif";
  ctx.fillText("观察镜头", rect.x + 8, rect.y + 14);
  ctx.restore();
}

function botOverlayPalette(seat) {
  if (seat === "A") {
    return {
      line: "#67d9ff",
      fill: "#67d9ff22",
      text: "#dff7ff",
      soft: "#67d9ff88",
    };
  }
  return {
    line: "#ff93a7",
    fill: "#ff93a722",
    text: "#ffe5ea",
    soft: "#ff93a788",
  };
}

function drawPlanMarker(point, palette, label, shape = "circle") {
  if (!point) {
    return;
  }
  ctx.save();
  ctx.strokeStyle = palette.line;
  ctx.fillStyle = palette.fill;
  ctx.lineWidth = 1.6;
  if (shape === "square") {
    ctx.fillRect(point.x - 8, point.y - 8, 16, 16);
    ctx.strokeRect(point.x - 8, point.y - 8, 16, 16);
  } else if (shape === "cross") {
    ctx.beginPath();
    ctx.moveTo(point.x - 9, point.y);
    ctx.lineTo(point.x + 9, point.y);
    ctx.moveTo(point.x, point.y - 9);
    ctx.lineTo(point.x, point.y + 9);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(point.x, point.y, 7, 0, TAU);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 7, 0, TAU);
    ctx.fill();
    ctx.stroke();
  }
  if (label) {
    ctx.font = "bold 10px 'Noto Sans SC', 'PingFang SC', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = palette.text;
    ctx.fillText(label, point.x, point.y - 10);
  }
  ctx.restore();
}

function drawPlanPolygon(points, palette) {
  const valid = points.filter(Boolean);
  if (valid.length < 2) {
    return;
  }
  ctx.save();
  ctx.strokeStyle = palette.soft;
  ctx.fillStyle = palette.fill;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([7, 6]);
  ctx.beginPath();
  ctx.moveTo(valid[0].x, valid[0].y);
  for (let i = 1; i < valid.length; i += 1) {
    ctx.lineTo(valid[i].x, valid[i].y);
  }
  if (valid.length >= 3) {
    ctx.closePath();
    ctx.fill();
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawBotOverlay(seat) {
  const bot = botState(seat);
  const team = teamState(seat);
  if (!bot || !team) {
    return;
  }
  const palette = botOverlayPalette(seat);
  const main = findShipByKey(team, "main");
  const sub1 = findShipByKey(team, "sub1");
  const sub2 = findShipByKey(team, "sub2");

  if (bot.searchAssignments && bot.mode === "search" && !bot.useSearchSectorPlan) {
    drawPlanPolygon([bot.searchAssignments.main, bot.searchAssignments.sub1, bot.searchAssignments.sub2], palette);
  }
  if (bot.sectorPlan) {
    drawPlanPolygon([bot.sectorPlan.main, bot.sectorPlan.sub1, bot.sectorPlan.sub2], palette);
  }

  drawPlanMarker(bot.focus, palette, `${seat}焦点`, "cross");
  drawPlanMarker(bot.searchCenter, palette, `${seat}搜`, "square");

  for (const shipKey of ["main", "sub1", "sub2"]) {
    const order = bot.orders?.[shipKey];
    const ship = shipKey === "main" ? main : shipKey === "sub1" ? sub1 : sub2;
    if (!order || !ship || !ship.alive || !order.target) {
      continue;
    }
    ctx.save();
    ctx.strokeStyle = palette.line;
    ctx.lineWidth = shipKey === "main" ? 1.8 : 1.2;
    ctx.setLineDash(order.detached ? [10, 6] : [6, 5]);
    ctx.beginPath();
    ctx.moveTo(ship.x, ship.y);
    ctx.lineTo(order.target.x, order.target.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    drawPlanMarker(order.target, palette, `${slotLabel(shipKey)} ${modeLabel(order.role)}`);
  }

  if (main && main.alive) {
    ctx.save();
    ctx.fillStyle = palette.text;
    ctx.font = "bold 12px 'Noto Sans SC', 'PingFang SC', sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(`${seat} ${modeLabel(bot.mode)}`, main.x + 12, main.y - main.radius - 18);
    ctx.restore();
  }
}

function drawShipGroup(seat, color) {
  for (const ship of shipCollection(teamState(seat))) {
    drawShip(ship, color, ship.id === app.selected.shipId && seat === app.selected.seat, ship.attached);
  }
}

function render() {
  if (!app.state) {
    return;
  }

  updateCamera();
  const view = currentViewState();
  ctx.save();
  ctx.setTransform(view.zoom, 0, 0, view.zoom, -view.left * view.zoom, -view.top * view.zoom);
  drawBackground(app.state.elapsed || 0);
  drawZones();

  for (const seat of ["A", "B"]) {
    const team = teamState(seat);
    if (!team) {
      continue;
    }
    for (const ship of shipCollection(team)) {
      if (!ship || !ship.alive || !ship.route) {
        continue;
      }
      drawRoute(ship.route, ship.id === app.selected.shipId && seat === app.selected.seat);
    }
  }

  drawBotOverlay("A");
  drawBotOverlay("B");

  for (const seat of ["A", "B"]) {
    const team = teamState(seat);
    if (team && Array.isArray(team.beams)) {
      for (const beam of team.beams) {
        drawBeam(beam);
      }
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

  drawShipGroup("A", teamState("A")?.color || "#65d9ff");
  drawShipGroup("B", teamState("B")?.color || "#ff8692");

  for (const seat of ["A", "B"]) {
    const team = teamState(seat);
    if (team && Array.isArray(team.scouts)) {
      for (const scout of team.scouts) {
        drawScout(scout, seat === "A");
      }
    }
    if (team && Array.isArray(team.wingmen)) {
      for (const wingman of team.wingmen) {
        drawWingman(wingman, seat === "A");
      }
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
  ctx.restore();
  drawMinimap();
}

function tick(timestamp) {
  if (!running) return;
  const dt = clamp((timestamp - app.lastTime) / 1000, 0, 0.08);
  app.lastTime = timestamp;

  if (app.sim && !app.paused && (!app.state || app.state.phase !== "finished")) {
    advanceSimulation(dt * app.speedScale);
  }
  app.state = app.sim ? app.sim.serializeState() : null;

  updateUi();
  render();

  rafId = requestAnimationFrame(tick);
}

function handleMinimapTap(screenPos) {
  if (!app.mobileMode) {
    return false;
  }
  const world = minimapWorldPointFromScreenPoint(screenPos.x, screenPos.y);
  if (!world) {
    return false;
  }
  centerCameraOn(world.x, world.y, true);
  return true;
}

function bindUiEvents() {
  for (const seat of ["A", "B"]) {
    for (const key of ["main", "sub1", "sub2"]) {
      loadoutUi[seat][key].addEventListener("change", () => {
        const fallback = seat === "A" ? DEFAULT_TEAM_LOADOUT : DEFAULT_AI_LOADOUT;
        const next = readLoadoutFromControls(seat, fallback);
        if (seat === "A") {
          app.teamALoadout = next;
        } else {
          app.teamBLoadout = next;
        }
        syncLoadoutControls(seat, next);
      });
    }
  }

  ui.applySetupBtn.addEventListener("click", () => {
    app.teamALoadout = readLoadoutFromControls("A", DEFAULT_TEAM_LOADOUT);
    app.teamBLoadout = readLoadoutFromControls("B", DEFAULT_AI_LOADOUT);
    syncLoadoutControls("A", app.teamALoadout);
    syncLoadoutControls("B", app.teamBLoadout);
    storeLoadout("A", app.teamALoadout);
    storeLoadout("B", app.teamBLoadout);
    resetMatch(true);
    log("已应用双方新阵容");
  });

  ui.pauseBtn.addEventListener("click", () => {
    app.paused = !app.paused;
    updateUi();
    log(app.paused ? "调试战已暂停" : "调试战继续运行");
  });

  ui.stepBtn.addEventListener("click", () => {
    if (!app.sim || app.state?.phase === "finished") {
      return;
    }
    app.paused = true;
    advanceSimulation(1);
    app.state = app.sim.serializeState();
    updateUi();
    render();
    log("已单步推进 1.0 秒");
  });

  for (const button of ui.speedButtons) {
    button.addEventListener("click", () => {
      setSpeedScale(Number(button.dataset.speed));
    });
  }

  for (const button of ui.focusButtons) {
    button.addEventListener("click", () => {
      setSelectedShipByKey(button.dataset.seat, button.dataset.ship);
    });
  }

  ui.restartBtn.addEventListener("click", () => {
    resetMatch(true);
  });

  if (ui.legacyToggle) {
    ui.legacyToggle.checked = app.opponentLegacy;
    refreshLegacyLabels();
    ui.legacyToggle.addEventListener("change", () => {
      app.opponentLegacy = ui.legacyToggle.checked;
      window.localStorage.setItem("haruhi-debug-legacy-b", app.opponentLegacy ? "1" : "0");
      refreshLegacyLabels();
      resetMatch(true);
      log(app.opponentLegacy ? "对照模式开启：B队改用旧版AI" : "对照模式关闭：双方均为新AI");
    });
  }

  canvas.addEventListener("click", (event) => {
    if (!app.state) {
      return;
    }
    const screenPos = screenPointFromEvent(event);
    if (handleMinimapTap(screenPos)) {
      return;
    }
    const pos = pointerFromEvent(event);
    const hit = shipAtPoint(pos.x, pos.y);
    if (hit) {
      setSelectedShip(hit.seat, hit.ship.id);
      return;
    }
    if (app.mobileMode) {
      centerCameraOn(pos.x, pos.y, true);
    }
  });

  addWin("keydown", (event) => {
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

    if (event.code === "Space") {
      event.preventDefault();
      ui.pauseBtn.click();
      return;
    }
    if (event.code === "KeyR") {
      event.preventDefault();
      resetMatch(true);
      return;
    }

    const focusMap = {
      Digit1: ["A", "main"],
      Digit2: ["A", "sub1"],
      Digit3: ["A", "sub2"],
      Digit4: ["B", "main"],
      Digit5: ["B", "sub1"],
      Digit6: ["B", "sub2"],
      Numpad1: ["A", "main"],
      Numpad2: ["A", "sub1"],
      Numpad3: ["A", "sub2"],
      Numpad4: ["B", "main"],
      Numpad5: ["B", "sub1"],
      Numpad6: ["B", "sub2"],
    };
    const focus = focusMap[event.code];
    if (focus) {
      event.preventDefault();
      setSelectedShipByKey(focus[0], focus[1]);
      return;
    }

    if (event.code === "BracketLeft") {
      event.preventDefault();
      const index = Math.max(0, SPEED_PRESETS.indexOf(app.speedScale) - 1);
      setSpeedScale(SPEED_PRESETS[index]);
      return;
    }
    if (event.code === "BracketRight") {
      event.preventDefault();
      const index = Math.min(SPEED_PRESETS.length - 1, SPEED_PRESETS.indexOf(app.speedScale) + 1);
      setSpeedScale(SPEED_PRESETS[index]);
    }
  });

  addWin("resize", () => {
    syncResponsiveMode();
    updateUi();
  });
}

// ── 可挂载入口 ──
export function mount(root) {
  root.innerHTML = debugTemplate();
  cacheDom();
  initApp();
  ac = new AbortController();
  running = true;
  syncResponsiveMode();
  populateLoadoutControls();
  bindUiEvents();
  setSpeedScale(1, true);
  resetMatch(true);
  rafId = requestAnimationFrame(tick);
  return unmount;
}

function unmount() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  if (ac) ac.abort();
  ac = null;
  app = null;
}

function debugTemplate() {
  return `
    <div class="app-shell debug-shell">
      <aside class="panel compact-panel debug-panel">
        <h1>射手座之日</h1>

        <section class="controls slim-controls">
          <div class="btn-col">
            <a class="btn-link btn-link-home" href="/">← 主菜单</a>
          </div>
        </section>

        <section class="status debug-status">
          <div><span>时间</span><strong id="debugTimeValue">0.0秒</strong></div>
          <div><span>状态</span><strong id="debugPhaseValue">运行中</strong></div>
          <div><span>倍速</span><strong id="debugSpeedValue">1x</strong></div>
          <div><span>选中</span><strong id="debugSelectedValue">A队 主舰</strong></div>
          <div><span>A舰体</span><strong id="debugTeamAHullValue">100%</strong></div>
          <div><span>A分离</span><strong id="debugTeamASplitValue">编队</strong></div>
          <div><span>A侦获</span><strong id="debugTeamAVisionValue">0个目标</strong></div>
          <div><span>B舰体</span><strong id="debugTeamBHullValue">100%</strong></div>
          <div><span>B分离</span><strong id="debugTeamBSplitValue">编队</strong></div>
          <div><span>B侦获</span><strong id="debugTeamBVisionValue">0个目标</strong></div>
        </section>

        <section class="controls slim-controls">
          <h2>调试控制</h2>
          <div class="btn-col">
            <button id="applyDebugSetupBtn">应用双方阵容并开战</button>
          </div>
          <div class="btn-row">
            <button id="pauseDebugBtn">暂停</button>
            <button id="stepDebugBtn">单步1秒</button>
          </div>
          <div id="debugSpeedRow" class="debug-speed-row">
            <button type="button" class="debug-speed-btn" data-speed="0.5">0.5x</button>
            <button type="button" class="debug-speed-btn" data-speed="1">1x</button>
            <button type="button" class="debug-speed-btn" data-speed="2">2x</button>
            <button type="button" class="debug-speed-btn" data-speed="4">4x</button>
          </div>
          <label class="debug-legacy-toggle" for="debugLegacyToggle">
            <input type="checkbox" id="debugLegacyToggle" />
            <span>对手(B队)用旧版AI · 对照新AI压制力</span>
          </label>
          <p class="hint">双方均由 AI 接管。观察者可切换任意舰船，查看射界、视野与航线；手机上点空白区域可挪动镜头。</p>
        </section>

        <section class="controls slim-controls">
          <h2>阵容设置</h2>
          <div class="debug-team-stack">
            <section class="debug-team-block">
              <div class="debug-team-head"><h3>A队</h3><strong class="debug-seat-tag seat-a" id="debugSeatTagA">AI</strong></div>
              <div class="loadout-grid">
                <label class="loadout-field" for="debugTeamAMainRole"><span>主舰</span><select id="debugTeamAMainRole"></select></label>
                <label class="loadout-field" for="debugTeamASub1Role"><span>副舰一</span><select id="debugTeamASub1Role"></select></label>
                <label class="loadout-field" for="debugTeamASub2Role"><span>副舰二</span><select id="debugTeamASub2Role"></select></label>
              </div>
              <div id="debugTeamAPreview" class="loadout-preview"></div>
            </section>
            <section class="debug-team-block">
              <div class="debug-team-head"><h3>B队</h3><strong class="debug-seat-tag seat-b" id="debugSeatTagB">AI</strong></div>
              <div class="loadout-grid">
                <label class="loadout-field" for="debugTeamBMainRole"><span>主舰</span><select id="debugTeamBMainRole"></select></label>
                <label class="loadout-field" for="debugTeamBSub1Role"><span>副舰一</span><select id="debugTeamBSub1Role"></select></label>
                <label class="loadout-field" for="debugTeamBSub2Role"><span>副舰二</span><select id="debugTeamBSub2Role"></select></label>
              </div>
              <div id="debugTeamBPreview" class="loadout-preview"></div>
            </section>
          </div>
        </section>

        <section class="controls slim-controls">
          <h2>快速观察</h2>
          <div id="debugFocusGrid" class="debug-focus-grid">
            <button type="button" class="debug-focus-btn" data-seat="A" data-ship="main">A主</button>
            <button type="button" class="debug-focus-btn" data-seat="B" data-ship="main">B主</button>
            <button type="button" class="debug-focus-btn" data-seat="A" data-ship="sub1">A一</button>
            <button type="button" class="debug-focus-btn" data-seat="B" data-ship="sub1">B一</button>
            <button type="button" class="debug-focus-btn" data-seat="A" data-ship="sub2">A二</button>
            <button type="button" class="debug-focus-btn" data-seat="B" data-ship="sub2">B二</button>
          </div>
          <div id="debugSelectedShipCard" class="loadout-preview debug-selected-card"></div>
        </section>

        <section class="controls slim-controls">
          <h2>AI态势</h2>
          <div class="debug-team-stack">
            <section class="debug-team-block">
              <div class="debug-team-head"><h3>A队判断</h3><strong class="debug-seat-tag seat-a">AI</strong></div>
              <div id="debugTeamAAiCard" class="loadout-preview debug-ai-card"></div>
            </section>
            <section class="debug-team-block">
              <div class="debug-team-head"><h3>B队判断</h3><strong class="debug-seat-tag seat-b">AI</strong></div>
              <div id="debugTeamBAiCard" class="loadout-preview debug-ai-card"></div>
            </section>
          </div>
        </section>

        <section class="controls slim-controls">
          <h2>日志</h2>
          <div id="debugLog" class="log"></div>
        </section>
      </aside>

      <main class="game-wrap">
        <canvas id="debugCanvas" width="1440" height="1440"></canvas>
        <div id="debugOverlay" class="overlay hidden">
          <h2 id="debugOverlayTitle"></h2>
          <div class="overlay-actions">
            <button id="debugRestartBtn">重新推演</button>
            <a class="btn-link overlay-home-link" href="/">返回主菜单</a>
          </div>
        </div>
      </main>
    </div>
  `;
}
