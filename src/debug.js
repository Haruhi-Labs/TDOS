import {
  DEFAULT_WORLD_SIZE,
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
import {
  createShipDestructionEffects,
  drawShipDestructionEffects,
  resetShipDestructionEffects,
  syncShipDestructionEffects,
} from "./ship-destruction-effects.js";
import {
  characterShortName,
  localizeFloatingText,
  seatLabel as localizedSeatLabel,
  shipCharacterName,
  slotLabel as localizedSlotLabel,
  splitLabel as localizedSplitLabel,
  t,
} from "./i18n.js";

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
// 逻辑世界尺寸:与单人/在线/服务器共用 DEFAULT_WORLD_SIZE,坐标运算都在此空间,与画布物理像素解耦。
const LOGICAL = DEFAULT_WORLD_SIZE;
const ROUTE_HANDLE_RADIUS = 11;
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
  destructionEffects: createShipDestructionEffects(),
  lastTime: performance.now(),
  mobileMode: false,
  cameraCenterX: LOGICAL * 0.5,
  cameraCenterY: LOGICAL * 0.5,
  cameraManualUntil: 0,
  stars: Array.from({ length: 220 }, () => ({
    x: Math.random() * LOGICAL,
    y: Math.random() * LOGICAL,
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
  return localizedSplitLabel(level);
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
  return localizedSlotLabel(slotKey);
}

function seatLabel(seat) {
  return localizedSeatLabel(seat);
}

function modeLabel(mode) {
  const labels = {
    press: t("压进"),
    search: t("搜索"),
    recover: t("脱边"),
    harvest: t("回能"),
    regroup: t("收拢"),
    kite: t("拉扯"),
    collapse: t("合围"),
    broadside: t("抢侧舷"),
    cutoff: t("截击"),
    support: t("支援"),
    fire: t("火力位"),
    rear: t("后撤点"),
    front: t("前探"),
    flank: t("绕后"),
    intel: t("侦察"),
    escape: t("脱困"),
  };
  return labels[mode] || mode || t("待机");
}

function decisionLabel(action) {
  const labels = {
    idle: t("待命"),
    hold: t("暂缓"),
    launch: t("已发侦察"),
    retry: t("再次尝试"),
    cast: t("已释放"),
    unavailable: t("不可用"),
  };
  return labels[action] || action || t("待命");
}

function intelSourceLabel(source) {
  const labels = {
    visible: t("可见"),
    memory: t("记忆"),
    spawn: t("出生点"),
  };
  return labels[source] || source || t("未知");
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
    return t("无");
  }
  const shortName = contact.characterId ? characterShortName(contact.characterId) : "";
  const role = contact.kind === "ship"
    ? slotLabel(contact.slotKey)
    : contact.kind === "wingman"
      ? t("僚机")
      : contact.kind === "scout"
        ? t("侦察机")
        : contact.kind;
  return `${role}${shortName ? ` ${shortName}` : ""}`.trim();
}

function roleSummaryLine(slotKey, characterId) {
  const def = CHARACTER_DEFS[characterId];
  const stat = def.stats;
  return `${slotLabel(slotKey)} ${characterShortName(characterId, def.shortName)} | ${t("舰体")}${stat.hp} | ${t("能量")}${stat.energy} | ${t("航速")}${stat.speed} | ${t("机动")}${stat.turnRate.toFixed(2)}`;
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
  option.textContent = `${characterShortName(characterId, def.shortName)} · ${def.title}`;
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
    const shortName = characterId && CHARACTER_DEFS[characterId] ? characterShortName(characterId) : shipKey;
    const prefix = seat === "A" ? "A" : "B";
    const slot = localizedSlotLabel(shipKey, "tiny");
    button.textContent = `${prefix}${slot} ${shortName}`;
  }
}

function prefersMobileBattleMode() {
  return window.matchMedia("(max-width: 980px)").matches || window.matchMedia("(pointer: coarse)").matches;
}

function screenPointFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) * (LOGICAL / rect.width);
  const y = (event.clientY - rect.top) * (LOGICAL / rect.height);
  return {
    x: clamp(x, 0, LOGICAL),
    y: clamp(y, 0, LOGICAL),
  };
}

function currentViewState() {
  if (!app.mobileMode) {
    return {
      zoom: 1,
      left: 0,
      top: 0,
      width: LOGICAL,
      height: LOGICAL,
    };
  }
  const zoom = MOBILE_ZOOM;
  const width = LOGICAL / zoom;
  const height = LOGICAL / zoom;
  const halfW = width * 0.5;
  const halfH = height * 0.5;
  const centerX = clamp(app.cameraCenterX, halfW, LOGICAL - halfW);
  const centerY = clamp(app.cameraCenterY, halfH, LOGICAL - halfH);
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
    x: clamp(view.left + x / view.zoom, 0, LOGICAL),
    y: clamp(view.top + y / view.zoom, 0, LOGICAL),
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
  const size = clamp(LOGICAL * 0.145, 180, 230);
  return {
    x: LOGICAL - size - 18,
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
    x: clamp(((screenX - rect.x) / rect.width) * LOGICAL, 0, LOGICAL),
    y: clamp(((screenY - rect.y) / rect.height) * LOGICAL, 0, LOGICAL),
  };
}

function centerCameraOn(x, y, manual = true) {
  app.cameraCenterX = clamp(x, 0, LOGICAL);
  app.cameraCenterY = clamp(y, 0, LOGICAL);
  if (manual) {
    app.cameraManualUntil = performance.now() + 2400;
  }
}

function updateCamera() {
  if (!app.mobileMode) {
    app.cameraCenterX = LOGICAL * 0.5;
    app.cameraCenterY = LOGICAL * 0.5;
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
  app.cameraCenterX = clamp(app.cameraCenterX + (targetX - app.cameraCenterX) * 0.14, 0, LOGICAL);
  app.cameraCenterY = clamp(app.cameraCenterY + (targetY - app.cameraCenterY) * 0.14, 0, LOGICAL);
}

// 把 backing store(画布物理像素)对齐到显示区域的设备像素,告别固定 1440 缓冲被放大的模糊。
function resizeCanvas() {
  if (!canvas) {
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const cssW = rect.width || canvas.clientWidth || LOGICAL;
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const backing = Math.max(LOGICAL, Math.min(Math.round(cssW * dpr), 2880));
  if (canvas.width !== backing) {
    canvas.width = backing;
    canvas.height = backing;
  }
}

function syncResponsiveMode() {
  app.mobileMode = prefersMobileBattleMode();
  if (!app.mobileMode) {
    app.cameraManualUntil = 0;
  }
  resizeCanvas(); // 显示尺寸/方向变化时同步 backing store 到设备像素,保持清晰
}

function zoneFromPoint(x, y) {
  const zones = app.state ? app.state.zones : [];
  return zones.find((zone) => x >= zone.x && x < zone.x + zone.width && y >= zone.y && y < zone.y + zone.height) || null;
}

function log(message) {
  const row = document.createElement("div");
  const elapsed = app.state ? app.state.elapsed : 0;
  row.textContent = `[${t("{value}秒", { value: elapsed.toFixed(1) })}] ${message}`;
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
    worldSize: LOGICAL,
    teamNames: {
      A: legacyB ? t("新版AI · A队") : t("调试舰队A"),
      B: legacyB ? t("旧版AI · B队") : t("调试舰队B"),
    },
    teamLoadouts: {
      A: app.teamALoadout,
      B: app.teamBLoadout,
    },
  });
}

function refreshLegacyLabels() {
  const on = app.opponentLegacy;
  if (ui.seatTagA) ui.seatTagA.textContent = on ? t("新AI") : "AI";
  if (ui.seatTagB) ui.seatTagB.textContent = on ? t("旧AI") : "AI";
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
  resetShipDestructionEffects(app.destructionEffects);
  app.lastTime = performance.now();
  app.selected.seat = "A";
  app.selected.shipId = app.state.teams.A.ships.main.id;
  app.cameraManualUntil = 0;
  const mainShip = app.state.teams.A.ships.main;
  app.cameraCenterX = mainShip.x;
  app.cameraCenterY = mainShip.y;
  if (logMessage) {
    clearLog();
    log(t("调试战开始。双方均由 AI 控制，可暂停、倍速和切换观察目标。"));
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
    log(t("调试倍速切换为 {speed}x", { speed: next }));
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
    target.textContent = t("该席当前未启用 AI。");
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
    context.searchRequired ? { label: "需搜索" } : null,
    context.trackableIntel ? { label: "可追踪" } : null,
    context.emergencyCommit ? { label: "紧急投入", className: " alert" } : null,
    context.conserveEnergy ? { label: "保能" } : null,
    context.killWindow ? { label: "斩杀窗" } : null,
    context.enemyBroadsideRisk ? { label: "避侧舷" } : null,
    context.safeExchange ? { label: "交换有利", className: " good" } : null,
  ].filter(Boolean);
  const tagHtml = tags.length
    ? tags.map((tag) => `<span class="debug-ai-tag${tag.className || ""}">${t(tag.label)}</span>`).join("")
    : `<span class="debug-ai-tag">${t("常规态势")}</span>`;

  const orderLines = ["main", "sub1", "sub2"].map((shipKey) => {
    const order = bot.orders?.[shipKey];
    if (!order) {
      return `<div><strong>${slotLabel(shipKey)}</strong> ${t("暂无新命令")}</div>`;
    }
    return `<div><strong>${slotLabel(shipKey)}</strong> ${modeLabel(order.role)} -> ${pointText(order.target)} @${Math.round((order.throttle || 0) * 100)}%</div>`;
  }).join("");

  const threatLines = ["main", "sub1", "sub2"].map((shipKey) => {
    const threat = context.shipThreats?.[shipKey];
    if (!threat) {
      return `<div><strong>${slotLabel(shipKey)}</strong> ${t("威胁")} -</div>`;
    }
    return `<div><strong>${slotLabel(shipKey)}</strong> ${t("威胁")} ${shortNumber(threat.danger)} | ${t("火源")} ${threat.sources}${threat.overwhelmed ? ` | ${t("被围")}` : ""}</div>`;
  }).join("");

  const splitText = split.acted && split.acted.length
    ? t("已执行 {levels} 级分离", { levels: split.acted.join("/") })
    : split.attempt1 || split.attempt2
      ? t("评估分离 {levels}", { levels: [split.attempt1 ? "1" : null, split.attempt2 ? "2" : null].filter(Boolean).join("/") })
      : t("分离层级 {level}", { level: split.level || 0 });
  const detachedText = ["sub1", "sub2"].map((shipKey) => {
    const role = detachedPlan.roles?.[shipKey];
    if (!role) {
      return `${slotLabel(shipKey)} ${t("未独立")}`;
    }
    const suffix = detachedPlan.intelLeadKey === shipKey ? t("侦察主力") : detachedPlan.retreatKey === shipKey ? t("后撤保命") : t("执行中");
    return `${slotLabel(shipKey)} ${modeLabel(role)}·${suffix}`;
  }).join(" | ");

  target.innerHTML = [
    `<div class="debug-ai-headline"><strong>${modeLabel(bot.mode)}</strong><span>${t("模式锁定 {seconds}", { seconds: t("{value}秒", { value: shortNumber(bot.modeTimer, 1) }) })}</span></div>`,
    `<div class="debug-ai-tags">${tagHtml}</div>`,
    `<div class="debug-ai-grid">`,
    `<div><strong>${t("焦点")}</strong>${botContactLabel(focus)} | ${focus ? `${intelSourceLabel(focus.source)} ${t("{value}秒", { value: shortNumber(focus.age, 1) })}` : t("无")}</div>`,
    `<div><strong>${t("焦点坐标")}</strong>${pointText(focus)}</div>`,
    `<div><strong>${t("局部优势")}</strong>${shortNumber(context.localAdvantage)}</div>`,
    `<div><strong>${t("最大威胁")}</strong>${shortNumber(context.maxShipThreat)}</div>`,
    `<div><strong>${t("舰队能量")}</strong>${shortPercent(context.energyRatio)}</div>`,
    `<div><strong>${t("回能需求")}</strong>${shortPercent(context.energyRecoveryNeed)}</div>`,
    `<div><strong>${t("压制意愿")}</strong>${shortNumber(context.pressureDrive)}</div>`,
    `<div><strong>${t("围堵压力")}</strong>${shortNumber(context.encirclePressure)}</div>`,
    `<div><strong>${t("射界交换")}</strong>${shortNumber(context.arcAdvantage)}</div>`,
    `<div><strong>${t("搜索中心")}</strong>${pointText(bot.searchCenter)}</div>`,
    `</div>`,
    `<div class="debug-ai-orders">${orderLines}</div>`,
    `<div class="debug-ai-orders">${threatLines}</div>`,
    `<div class="debug-ai-orders">`,
    `<div><strong>${t("副舰分工")}</strong> ${detachedText}</div>`,
    `<div><strong>${t("侦察")}</strong> ${decisionLabel(scout.action)}${Number.isFinite(scout.zoneId) ? ` -> ${t("战区{zone}", { zone: scout.zoneId })}` : ""} | CD ${t("{value}秒", { value: shortNumber(scout.nextIn, 1) })}</div>`,
    `<div><strong>${t("旗舰技")}</strong> ${decisionLabel(flagship.action)} | CD ${t("{value}秒", { value: shortNumber(bot.flagshipTimer, 1) })}</div>`,
    `<div><strong>${t("副舰技")}</strong> ${slotLabel("sub1")} ${decisionLabel(subSkills.sub1?.action)} ${t("{value}秒", { value: shortNumber(subSkills.sub1?.nextIn, 1) })} / ${slotLabel("sub2")} ${decisionLabel(subSkills.sub2?.action)} ${t("{value}秒", { value: shortNumber(subSkills.sub2?.nextIn, 1) })}</div>`,
    `<div><strong>${t("分离判断")}</strong> ${splitText}</div>`,
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
    ui.selectedCard.textContent = t("当前没有可观察舰船。");
    return;
  }
  const minRadius = shipSim ? Math.round(shipSim.routeConstraintProfile().minTurnRadius) : 0;
  const zone = zoneFromPoint(ship.x, ship.y);
  const zoneText = zone ? t("战区{zone}", { zone: zone.id }) : t("无战区");
  const bot = botState(app.selected.seat);
  const order = bot?.orders?.[ship.key];
  const shipThreat = bot?.context?.shipThreats?.[ship.key];
  ui.selectedCard.innerHTML = [
    `<strong>${seatLabel(app.selected.seat)} ${slotLabel(ship.key)} · ${shipCharacterName(ship)}</strong>`,
    t("舰体 {hp}/{maxHp}（{hullPercent}%） | 能量 {energy}/{maxEnergy}（{energyPercent}%）", {
      hp: Math.round(ship.hp),
      maxHp: Math.round(ship.maxHp),
      hullPercent: hullPercent(ship),
      energy: Math.round(Number(ship.fleetEnergy) || 0),
      maxEnergy: Math.round(Number(ship.fleetMaxEnergy) || 1),
      energyPercent: energyPercent(ship),
    }),
    t("推进 {throttle}% | 航速 {speed} | 最小转弯半径 {radius}", {
      throttle: Math.round((ship.throttle || 1) * 100),
      speed: (ship.speed || 0).toFixed(1),
      radius: minRadius,
    }),
    t("视野 {vision} | 射程 {range} | {zone} | {state}", {
      vision: Math.round(ship.vision || 0),
      range: Math.round(ship.range || 0),
      zone: zoneText,
      state: ship.attached ? t("附着中") : t("独立编队"),
    }),
    order ? t("AI命令 {mode} -> {target} @{throttle}%", {
      mode: modeLabel(order.role),
      target: pointText(order.target),
      throttle: Math.round((order.throttle || 0) * 100),
    }) : t("AI命令 暂无"),
    shipThreat ? t("承压 {danger} | 火源 {sources}{suffix}", {
      danger: shortNumber(shipThreat.danger),
      sources: shipThreat.sources,
      suffix: shipThreat.overwhelmed ? t(" | 被围攻") : "",
    }) : t("承压 -"),
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

  ui.timeValue.textContent = t("{value}秒", { value: app.state.elapsed.toFixed(1) });
  ui.phaseValue.textContent = app.state.phase === "finished" ? t("战斗结束") : app.paused ? t("已暂停") : t("运行中");
  ui.speedValue.textContent = `${app.speedScale}x`;
  ui.selectedValue.textContent = selected ? `${seatLabel(app.selected.seat)} ${shipCharacterName(selected)}` : t("无");

  ui.teamAHullValue.textContent = `${Math.round((teamA?.hullRatio || 0) * 100)}%`;
  ui.teamASplitValue.textContent = splitLabel(teamA?.splitLevel || 0);
  ui.teamAVisionValue.textContent = t("{count}个目标", { count: (teamA?.visibleEnemyIds || []).length });

  ui.teamBHullValue.textContent = `${Math.round((teamB?.hullRatio || 0) * 100)}%`;
  ui.teamBSplitValue.textContent = splitLabel(teamB?.splitLevel || 0);
  ui.teamBVisionValue.textContent = t("{count}个目标", { count: (teamB?.visibleEnemyIds || []).length });

  ui.pauseBtn.textContent = app.paused ? t("继续") : t("暂停");
  ui.stepBtn.disabled = !app.sim || app.state.phase === "finished";

  for (const button of ui.speedButtons) {
    button.classList.toggle("active", Number(button.dataset.speed) === app.speedScale);
  }

  if (app.state.phase === "finished") {
    ui.overlay.classList.remove("hidden");
    if (app.state.winnerSeat === "A") {
      ui.overlayTitle.textContent = t("调试战结束：A队获胜");
      if (!app.gameOverLogged) {
        log(t("调试战结束：A队获胜"));
      }
    } else if (app.state.winnerSeat === "B") {
      ui.overlayTitle.textContent = t("调试战结束：B队获胜");
      if (!app.gameOverLogged) {
        log(t("调试战结束：B队获胜"));
      }
    } else {
      ui.overlayTitle.textContent = t("调试战结束：平局");
      if (!app.gameOverLogged) {
        log(t("调试战结束：平局"));
      }
    }
    app.gameOverLogged = true;
  } else {
    ui.overlay.classList.add("hidden");
    app.gameOverLogged = false;
  }
}

function drawBackground(elapsed) {
  const gradient = ctx.createLinearGradient(0, 0, LOGICAL, LOGICAL);
  gradient.addColorStop(0, "#040d18");
  gradient.addColorStop(0.5, "#071423");
  gradient.addColorStop(1, "#050b14");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, LOGICAL, LOGICAL);

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
    ctx.fillText(t("战区 {zone}", { zone: zone.id }), zone.x + 10, zone.y + 20);
  }
}

function drawRoute(route, selected) {
  if (!route) {
    return;
  }

  const { p0, p1, p2 } = route;
  const time = (app.state && app.state.elapsed) || 0;
  // 末段切线(二次贝塞尔 t=1 方向 ∝ p2-p1)→ 航向,用于终点箭头朝向
  let hx = p2.x - p1.x;
  let hy = p2.y - p1.y;
  if (Math.hypot(hx, hy) < 1e-3) {
    hx = p2.x - p0.x;
    hy = p2.y - p0.y;
  }
  const heading = Math.atan2(hy, hx);

  const tracePath = () => {
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y);
  };

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // 航线主体:渐变虚线 + 同步发光虚线,沿航向缓缓流动
  const dash = [11, 9];
  const dashOffset = -time * 28;

  // ① 发光虚线
  ctx.setLineDash(dash);
  ctx.lineDashOffset = dashOffset;
  ctx.lineWidth = selected ? 7.5 : 5;
  ctx.strokeStyle = selected ? "#39d8ff33" : "#39d8ff1f";
  tracePath();
  ctx.stroke();

  // ② 主虚线:舰身青 → 目标薄荷 渐变
  const grad = ctx.createLinearGradient(p0.x, p0.y, p2.x, p2.y);
  grad.addColorStop(0, selected ? "#7ce6ff" : "#6fcdeecc");
  grad.addColorStop(1, selected ? "#a9f7d2" : "#86dcc0cc");
  ctx.lineWidth = selected ? 2.8 : 2.0;
  ctx.strokeStyle = grad;
  ctx.setLineDash(dash);
  ctx.lineDashOffset = dashOffset;
  tracePath();
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;

  if (selected) {
    // 终点:目标十字标记
    drawTargetMarker(p2, heading, time);

    // ⑤ 进度点
    const progressPoint = quadraticPoint(p0, p1, p2, clamp(route.t || 0, 0, 1));
    ctx.fillStyle = "#39d8ff44";
    ctx.beginPath();
    ctx.arc(progressPoint.x, progressPoint.y, 6, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(progressPoint.x, progressPoint.y, 3, 0, TAU);
    ctx.fill();

    // ⑥ 控制点 + 控制多边形
    if (!app.mobileMode) {
      ctx.lineWidth = 1.1;
      ctx.strokeStyle = "#ffd9912e";
      ctx.setLineDash([2, 6]);
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      ctx.setLineDash([]);
      drawCurveKnob(p1);
    }
  }

  ctx.restore();
}

// 目标十字标记:柔光底 + 外环(呼吸脉冲)+ 四向刻度 + 中心点 + 航向箭头
function drawTargetMarker(p, heading, time) {
  const r = ROUTE_HANDLE_RADIUS + 1;
  const pulse = 0.5 + 0.5 * Math.sin(time * 3.0);

  ctx.save();
  ctx.lineCap = "round";

  ctx.fillStyle = "#7df7c024";
  ctx.beginPath();
  ctx.arc(p.x, p.y, r + 5, 0, TAU);
  ctx.fill();

  ctx.strokeStyle = "#8af7c0";
  ctx.lineWidth = 2.2;
  ctx.globalAlpha = 0.75 + pulse * 0.25;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r + pulse * 2.2, 0, TAU);
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.strokeStyle = "#cfffe6";
  ctx.lineWidth = 1.8;
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    ctx.beginPath();
    ctx.moveTo(p.x + ca * (r + 3), p.y + sa * (r + 3));
    ctx.lineTo(p.x + ca * (r + 7), p.y + sa * (r + 7));
    ctx.stroke();
  }

  ctx.fillStyle = "#eafff5";
  ctx.beginPath();
  ctx.arc(p.x, p.y, 2.6, 0, TAU);
  ctx.fill();

  ctx.save();
  ctx.translate(p.x + Math.cos(heading) * (r + 11), p.y + Math.sin(heading) * (r + 11));
  ctx.rotate(heading);
  ctx.fillStyle = "#8af7c0";
  ctx.beginPath();
  ctx.moveTo(6, 0);
  ctx.lineTo(-4, -4.2);
  ctx.lineTo(-1.6, 0);
  ctx.lineTo(-4, 4.2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.restore();
}

// 曲度控制旋钮:柔光底 + 琥珀环 + 中心点,读作"可拖拽手柄"
function drawCurveKnob(p) {
  ctx.save();
  ctx.fillStyle = "#ffd29120";
  ctx.beginPath();
  ctx.arc(p.x, p.y, ROUTE_HANDLE_RADIUS + 4, 0, TAU);
  ctx.fill();

  ctx.fillStyle = "#1b1305cc";
  ctx.beginPath();
  ctx.arc(p.x, p.y, ROUTE_HANDLE_RADIUS, 0, TAU);
  ctx.fill();

  ctx.strokeStyle = "#ffd27a";
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(p.x, p.y, ROUTE_HANDLE_RADIUS, 0, TAU);
  ctx.stroke();

  ctx.fillStyle = "#ffe6b0";
  ctx.beginPath();
  ctx.arc(p.x, p.y, 3.4, 0, TAU);
  ctx.fill();
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
  ctx.fillText(localizeFloatingText(label), label.x, label.y);
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
    drawFireArcLabel(ship, 0, labelRadius, "×1.5", "#b9f4ff");
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
      const zx = rect.x + (zone.x / LOGICAL) * rect.width;
      const zy = rect.y + (zone.y / LOGICAL) * rect.height;
      const zw = (zone.width / LOGICAL) * rect.width;
      const zh = (zone.height / LOGICAL) * rect.height;
      ctx.strokeStyle = "#2d5d884f";
      ctx.lineWidth = 1;
      ctx.strokeRect(zx, zy, zw, zh);
    }
  }

  const plotShip = (ship, color, selected) => {
    if (!ship || !ship.alive) {
      return;
    }
    const x = rect.x + (ship.x / LOGICAL) * rect.width;
    const y = rect.y + (ship.y / LOGICAL) * rect.height;
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
    rect.x + (view.left / LOGICAL) * rect.width,
    rect.y + (view.top / LOGICAL) * rect.height,
    (view.width / LOGICAL) * rect.width,
    (view.height / LOGICAL) * rect.height,
  );

  ctx.fillStyle = "#d2ecff";
  ctx.font = "bold 11px 'Noto Sans SC', 'PingFang SC', sans-serif";
  ctx.fillText(t("观察镜头"), rect.x + 8, rect.y + 14);
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

  drawPlanMarker(bot.focus, palette, t("{seat}焦点", { seat }), "cross");
  drawPlanMarker(bot.searchCenter, palette, t("{seat}搜", { seat }), "square");

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

  // backing store(设备像素)对逻辑世界(LOGICAL)的比例:整幅画面放大到物理像素 → 矢量线条像素级清晰。
  const scale = canvas.width / LOGICAL;
  updateCamera();
  const view = currentViewState();
  ctx.setTransform(scale, 0, 0, scale, 0, 0); // 基准变换:屏幕/UI 空间(逻辑坐标 → 物理像素)
  ctx.save();
  ctx.setTransform(
    view.zoom * scale,
    0,
    0,
    view.zoom * scale,
    -view.left * view.zoom * scale,
    -view.top * view.zoom * scale
  ); // 世界/相机空间
  drawBackground(app.state.elapsed || 0);
  drawZones();

  syncShipDestructionEffects(app.destructionEffects, [
    {
      seat: "A",
      color: teamState("A")?.color || "#65d9ff",
      ships: shipCollection(teamState("A")),
    },
    {
      seat: "B",
      color: teamState("B")?.color || "#ff8692",
      ships: shipCollection(teamState("B")),
    },
  ]);

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

  drawShipDestructionEffects(ctx, app.destructionEffects);

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
    log(t("已应用双方新阵容"));
  });

  ui.pauseBtn.addEventListener("click", () => {
    app.paused = !app.paused;
    updateUi();
    log(app.paused ? t("调试战已暂停") : t("调试战继续运行"));
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
    log(t("已单步推进 1.0 秒"));
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
      log(app.opponentLegacy ? t("对照模式开启：B队改用旧版AI") : t("对照模式关闭：双方均为新AI"));
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
        <h1>${t("射手座之日")}</h1>

        <section class="controls slim-controls">
          <div class="btn-col">
            <a class="btn-link btn-link-home" href="/">${t("← 主菜单")}</a>
          </div>
        </section>

        <section class="status debug-status">
          <div><span>${t("时间")}</span><strong id="debugTimeValue">${t("{value}秒", { value: "0.0" })}</strong></div>
          <div><span>${t("状态")}</span><strong id="debugPhaseValue">${t("运行中")}</strong></div>
          <div><span>${t("倍速")}</span><strong id="debugSpeedValue">1x</strong></div>
          <div><span>${t("选中")}</span><strong id="debugSelectedValue">${t("A队 主舰")}</strong></div>
          <div><span>${t("A舰体")}</span><strong id="debugTeamAHullValue">100%</strong></div>
          <div><span>${t("A分离")}</span><strong id="debugTeamASplitValue">${t("编队")}</strong></div>
          <div><span>${t("A侦获")}</span><strong id="debugTeamAVisionValue">${t("{count}个目标", { count: 0 })}</strong></div>
          <div><span>${t("B舰体")}</span><strong id="debugTeamBHullValue">100%</strong></div>
          <div><span>${t("B分离")}</span><strong id="debugTeamBSplitValue">${t("编队")}</strong></div>
          <div><span>${t("B侦获")}</span><strong id="debugTeamBVisionValue">${t("{count}个目标", { count: 0 })}</strong></div>
        </section>

        <section class="controls slim-controls">
          <h2>${t("调试控制")}</h2>
          <div class="btn-col">
            <button id="applyDebugSetupBtn">${t("应用双方阵容并开战")}</button>
          </div>
          <div class="btn-row">
            <button id="pauseDebugBtn">${t("暂停")}</button>
            <button id="stepDebugBtn">${t("单步1秒")}</button>
          </div>
          <div id="debugSpeedRow" class="debug-speed-row">
            <button type="button" class="debug-speed-btn" data-speed="0.5">0.5x</button>
            <button type="button" class="debug-speed-btn" data-speed="1">1x</button>
            <button type="button" class="debug-speed-btn" data-speed="2">2x</button>
            <button type="button" class="debug-speed-btn" data-speed="4">4x</button>
          </div>
          <label class="debug-legacy-toggle" for="debugLegacyToggle">
            <input type="checkbox" id="debugLegacyToggle" />
            <span>${t("对手(B队)用旧版AI · 对照新AI压制力")}</span>
          </label>
          <p class="hint">${t("双方均由 AI 接管。观察者可切换任意舰船，查看射界、视野与航线；手机上点空白区域可挪动镜头。")}</p>
        </section>

        <section class="controls slim-controls">
          <h2>${t("阵容设置")}</h2>
          <div class="debug-team-stack">
            <section class="debug-team-block">
              <div class="debug-team-head"><h3>${t("A队")}</h3><strong class="debug-seat-tag seat-a" id="debugSeatTagA">AI</strong></div>
              <div class="loadout-grid">
                <label class="loadout-field" for="debugTeamAMainRole"><span>${t("主舰")}</span><select id="debugTeamAMainRole"></select></label>
                <label class="loadout-field" for="debugTeamASub1Role"><span>${t("副舰一")}</span><select id="debugTeamASub1Role"></select></label>
                <label class="loadout-field" for="debugTeamASub2Role"><span>${t("副舰二")}</span><select id="debugTeamASub2Role"></select></label>
              </div>
              <div id="debugTeamAPreview" class="loadout-preview"></div>
            </section>
            <section class="debug-team-block">
              <div class="debug-team-head"><h3>${t("B队")}</h3><strong class="debug-seat-tag seat-b" id="debugSeatTagB">AI</strong></div>
              <div class="loadout-grid">
                <label class="loadout-field" for="debugTeamBMainRole"><span>${t("主舰")}</span><select id="debugTeamBMainRole"></select></label>
                <label class="loadout-field" for="debugTeamBSub1Role"><span>${t("副舰一")}</span><select id="debugTeamBSub1Role"></select></label>
                <label class="loadout-field" for="debugTeamBSub2Role"><span>${t("副舰二")}</span><select id="debugTeamBSub2Role"></select></label>
              </div>
              <div id="debugTeamBPreview" class="loadout-preview"></div>
            </section>
          </div>
        </section>

        <section class="controls slim-controls">
          <h2>${t("快速观察")}</h2>
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
          <h2>${t("AI态势")}</h2>
          <div class="debug-team-stack">
            <section class="debug-team-block">
              <div class="debug-team-head"><h3>${t("A队判断")}</h3><strong class="debug-seat-tag seat-a">AI</strong></div>
              <div id="debugTeamAAiCard" class="loadout-preview debug-ai-card"></div>
            </section>
            <section class="debug-team-block">
              <div class="debug-team-head"><h3>${t("B队判断")}</h3><strong class="debug-seat-tag seat-b">AI</strong></div>
              <div id="debugTeamBAiCard" class="loadout-preview debug-ai-card"></div>
            </section>
          </div>
        </section>

        <section class="controls slim-controls">
          <h2>${t("日志")}</h2>
          <div id="debugLog" class="log"></div>
        </section>
      </aside>

      <main class="game-wrap">
        <canvas id="debugCanvas" width="1440" height="1440"></canvas>
        <div id="debugOverlay" class="overlay hidden">
          <h2 id="debugOverlayTitle"></h2>
          <div class="overlay-actions">
            <button id="debugRestartBtn">${t("重新推演")}</button>
            <a class="btn-link overlay-home-link" href="/">${t("返回主菜单")}</a>
          </div>
        </div>
      </main>
    </div>
  `;
}
