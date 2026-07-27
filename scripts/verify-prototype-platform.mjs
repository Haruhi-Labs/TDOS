import { readFile } from "node:fs/promises";
import {
  DEFAULT_TEAM_LOADOUT,
  DEFAULT_AI_LOADOUT,
  MatchSimulation,
  TICK_DT,
  cloneLoadout,
} from "../shared/game-core.js";
import {
  DEFAULT_GAMEPLAY_RULES,
  normalizeGameplayRules,
} from "../shared/gameplay/rules.js";
import {
  MODE_STATUS,
  validateModeDefinition,
  normalizeModeParameters,
} from "../shared/modes/mode-definition.js";
import { standardEliminationMode } from "../shared/modes/standard-elimination.js";
import { validationSurvivalMode } from "../shared/modes/validation-survival.js";
import { stellarTerritoryMode } from "../shared/modes/stellar-territory.js";
import { createBattleCamera } from "../src/battle/camera.js";
import { drawBattleWorld, drawMinimap } from "../src/battle/render.js";
import * as battleRender from "../src/battle/render.js";
import {
  registerPrototypeMode,
  getPrototypeMode,
  listPrototypeModes,
  resetPrototypeRegistry,
} from "../src/prototype/registry.js";
import { registerBuiltInPrototypeModes, resetBuiltInPrototypeRegistrationFlag } from "../src/prototype/modes/index.js";
import { stellarTerritoryPreset } from "../src/prototype/modes/stellar-territory.js";
import { createPrototypeRuntime } from "../src/prototype/runtime.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function approxEqual(a, b, eps = 1e-6) {
  return Math.abs(Number(a) - Number(b)) <= eps;
}

function shipKeyFields(state) {
  const fleet = state?.fleets?.A || state?.teams?.A;
  const ship = fleet?.ships?.main;
  if (!ship) return null;
  return {
    x: ship.x,
    y: ship.y,
    hp: ship.hp,
    energy: ship.energy,
    alive: ship.alive,
    phase: state.phase,
  };
}

function createRecordingCanvasContext() {
  const calls = [];
  const fillRects = [];
  const strokeRects = [];
  const target = {
    calls,
    fillRects,
    strokeRects,
    canvas: { width: 1200, height: 1200 },
    createLinearGradient() {
      calls.push("createLinearGradient");
      return { addColorStop() {} };
    },
    createRadialGradient() {
      calls.push("createRadialGradient");
      return { addColorStop() {} };
    },
    measureText(text) {
      return { width: String(text || "").length * 8 };
    },
    getImageData() {
      return { data: new Uint8ClampedArray(4) };
    },
    fillRect(...args) {
      calls.push("fillRect");
      fillRects.push(args);
    },
    strokeRect(...args) {
      calls.push("strokeRect");
      strokeRects.push(args);
    },
  };
  return new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop];
      if (typeof prop === "symbol") return undefined;
      return (..._args) => {
        calls.push(String(prop));
      };
    },
    set(obj, prop, value) {
      obj[prop] = value;
      return true;
    },
  });
}

// --- dynamic camera world contract ---
const cameraCanvas = {
  width: 1440,
  height: 1440,
  clientWidth: 720,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 720, height: 720 }),
};
const dynamicCamera = createBattleCamera({
  canvas: cameraCanvas,
  isMobile: () => false,
  showMinimap: () => true,
  worldSize: { width: 2160, height: 2160 },
});
dynamicCamera.reset({ x: 2100, y: 2100, zoom: 2 });
const dynamicView = dynamicCamera.currentViewState();
assert(approxEqual(dynamicView.width, 720), `screen viewport width stays logical: ${dynamicView.width}`);
assert(dynamicView.left + dynamicView.width <= 2160 + 1e-6, `camera clamps to runtime world: ${JSON.stringify(dynamicView)}`);
assert(dynamicView.left + dynamicView.width > 1440, `camera should reach the expanded world: ${JSON.stringify(dynamicView)}`);
const screenCorner = dynamicCamera.screenPointFromEvent({ clientX: 720, clientY: 720 });
assert(approxEqual(screenCorner.x, 1440) && approxEqual(screenCorner.y, 1440), `screen coordinates remain 1440: ${JSON.stringify(screenCorner)}`);
const pointerCorner = dynamicCamera.pointerFromEvent({ clientX: 720, clientY: 720 });
assert(approxEqual(pointerCorner.x, 2160) && approxEqual(pointerCorner.y, 2160), `pointer should reach runtime world bounds: ${JSON.stringify(pointerCorner)}`);
const dynamicMinimap = dynamicCamera.minimapRect();
assert(dynamicMinimap && dynamicMinimap.y > 720, `desktop minimap should occupy lower-right: ${JSON.stringify(dynamicMinimap)}`);
const worldCorner = dynamicCamera.minimapWorldPointFromScreenPoint(
  dynamicMinimap.x + dynamicMinimap.width,
  dynamicMinimap.y + dynamicMinimap.height,
);
assert(approxEqual(worldCorner.x, 2160) && approxEqual(worldCorner.y, 2160), `minimap should project runtime world: ${JSON.stringify(worldCorner)}`);

const fallbackCamera = createBattleCamera({ canvas: cameraCanvas, isMobile: () => false });
fallbackCamera.reset({ x: 2100, y: 2100, zoom: 2 });
let fallbackView = fallbackCamera.currentViewState();
assert(approxEqual(fallbackView.left + fallbackView.width, 1440), `default camera should retain 1440 bounds: ${JSON.stringify(fallbackView)}`);
fallbackCamera.setWorldSize(2160, 2160);
fallbackCamera.reset({ x: 2100, y: 2100, zoom: 2 });
assert(fallbackCamera.currentViewState().left + fallbackCamera.currentViewState().width > 1440, "setWorldSize should expand camera bounds");
fallbackCamera.setWorldSize(Number.NaN, 0);
fallbackView = fallbackCamera.currentViewState();
assert(approxEqual(fallbackView.left + fallbackView.width, 1440), `invalid dimensions should restore 1440 bounds: ${JSON.stringify(fallbackView)}`);
assert(
  JSON.stringify(fallbackCamera.getWorldSize()) === JSON.stringify({ width: 1440, height: 1440 }),
  `invalid dimensions should normalize world size: ${JSON.stringify(fallbackCamera.getWorldSize())}`,
);

// --- registry ---
resetPrototypeRegistry();
registerPrototypeMode(standardEliminationMode);
registerPrototypeMode(validationSurvivalMode);
assert(listPrototypeModes().length === 2, "should list two modes");
assert(getPrototypeMode("standard-elimination")?.id === "standard-elimination", "get mode works");
assert(listPrototypeModeOrderStable(), "mode order stable");

let rejected = false;
try {
  registerPrototypeMode(standardEliminationMode);
} catch (_error) {
  rejected = true;
}
assert(rejected, "duplicate mode id must be rejected");

rejected = false;
try {
  registerPrototypeMode({ id: "bad", name: "Bad", status: "nope" });
} catch (_error) {
  rejected = true;
}
assert(rejected, "invalid mode must be rejected");

function listPrototypeModeOrderStable() {
  const a = listPrototypeModes().map((m) => m.id).join(",");
  const b = listPrototypeModes().map((m) => m.id).join(",");
  return a === b && a === "standard-elimination,validation-survival";
}

// --- mode isolation ---
const elimParams = normalizeModeParameters(standardEliminationMode.parameterSchema, {});
const survivalParams = normalizeModeParameters(validationSurvivalMode.parameterSchema, { survivalSeconds: 30 });
assert(Object.keys(elimParams).length === 0, "elimination has no params");
assert(survivalParams.survivalSeconds === 30, "survival param normalized");

const elimState = standardEliminationMode.createInitialModeState();
const survivalState = validationSurvivalMode.createInitialModeState();
assert(survivalState.survivedSeconds === 0, "survival initial state");
assert(!("survivedSeconds" in elimState), "elimination state isolated");

// --- runtime controls ---
const runtime = createPrototypeRuntime({
  modeDefinition: standardEliminationMode,
  runtimePreset: { controlA: "ai", controlB: "ai" },
  teamLoadouts: { A: cloneLoadout(DEFAULT_TEAM_LOADOUT), B: cloneLoadout(DEFAULT_AI_LOADOUT) },
  aiDifficulty: "normal",
});
runtime.start();
assert(runtime.getSimulation().worldSize === 1440, "runtime should retain the legacy 1440 fallback when no size tier is configured");
const t0 = runtime.getSnapshot().elapsed;
runtime.pause();
runtime.update(0.2);
assert(approxEqual(runtime.getSnapshot().elapsed, t0), "paused runtime should not advance");
runtime.step(TICK_DT);
const t1 = runtime.getSnapshot().elapsed;
assert(approxEqual(t1 - t0, TICK_DT, 1e-4), `step should advance one tick, got ${t1 - t0}`);
runtime.resume();
runtime.setSpeedScale(2);
runtime.update(TICK_DT); // one frame budget *2 => at least one tick
assert(runtime.getSnapshot().elapsed > t1, "resume+speed should advance");

// 亚 tick 帧必须累计，否则 60fps 下多数帧 0 step
runtime.restart();
runtime.setSpeedScale(1);
const subTick = TICK_DT * 0.4;
runtime.update(subTick);
runtime.update(subTick);
assert(approxEqual(runtime.getSnapshot().elapsed, 0, 1e-6), "two 0.4-tick frames should not yet reach one step");
runtime.update(subTick);
assert(
  approxEqual(runtime.getSnapshot().elapsed, TICK_DT, 1e-4),
  `third 0.4-tick frame should flush one step, got ${runtime.getSnapshot().elapsed}`,
);

runtime.restart();
assert(approxEqual(runtime.getSnapshot().elapsed, 0, 1e-4), "restart should zero elapsed");
runtime.destroy();
const destroyedElapsed = runtime.getSnapshot();
assert(destroyedElapsed == null, "destroy clears simulation snapshot");

// --- survival outcome independent of elimination ---
const survivalRuntime = createPrototypeRuntime({
  modeDefinition: validationSurvivalMode,
  runtimePreset: { controlA: "ai", controlB: "ai" },
  modeParameters: { survivalSeconds: 10 },
  teamLoadouts: { A: cloneLoadout(DEFAULT_TEAM_LOADOUT), B: cloneLoadout(DEFAULT_AI_LOADOUT) },
});
survivalRuntime.start();
// Force A dead by dealing huge damage through repeated steps is hard; instead unit-test resolveOutcome directly.
const fakeSnapAlive = {
  fleets: {
    A: { ships: { main: { alive: true, hp: 10, maxHp: 10 } } },
    B: { ships: { main: { alive: true, hp: 10, maxHp: 10 } } },
  },
  teams: {
    A: { ships: { main: { alive: true, hp: 10, maxHp: 10 } } },
    B: { ships: { main: { alive: true, hp: 10, maxHp: 10 } } },
  },
  phase: "running",
  elapsed: 0,
};
let modeState = validationSurvivalMode.createInitialModeState();
modeState = validationSurvivalMode.updateModeState({
  modeState,
  snapshot: fakeSnapAlive,
  parameters: { survivalSeconds: 10 },
  dt: 10,
});
const survived = validationSurvivalMode.resolveOutcome({
  modeState,
  parameters: { survivalSeconds: 10 },
  snapshot: fakeSnapAlive,
});
assert(survived.finished && survived.winnerAllianceId === "A", "survival win when time reached");

const deadSnap = JSON.parse(JSON.stringify(fakeSnapAlive));
deadSnap.fleets.A.ships.main.alive = false;
deadSnap.teams.A.ships.main.alive = false;
const eliminated = validationSurvivalMode.resolveOutcome({
  modeState: validationSurvivalMode.createInitialModeState(),
  parameters: { survivalSeconds: 60 },
  snapshot: deadSnap,
});
assert(eliminated.finished && eliminated.winnerAllianceId === "B", "survival lose when A dead");
survivalRuntime.destroy();

// --- default gameplay rules regression ---
const loadouts = {
  A: cloneLoadout(DEFAULT_TEAM_LOADOUT),
  B: cloneLoadout(DEFAULT_AI_LOADOUT),
};
const simA = new MatchSimulation({
  mode: "ai",
  teamLoadouts: loadouts,
  aiDifficulty: "normal",
});
const simB = new MatchSimulation({
  mode: "ai",
  teamLoadouts: {
    A: cloneLoadout(DEFAULT_TEAM_LOADOUT),
    B: cloneLoadout(DEFAULT_AI_LOADOUT),
  },
  aiDifficulty: "normal",
  gameplayRules: normalizeGameplayRules(DEFAULT_GAMEPLAY_RULES),
});
for (let i = 0; i < 90; i += 1) {
  simA.update(TICK_DT);
  simB.update(TICK_DT);
}
const fa = shipKeyFields(simA.serializeState());
const fb = shipKeyFields(simB.serializeState());
assert(fa && fb, "both sims should serialize");
assert(approxEqual(fa.x, fb.x, 1e-3), `default rules x mismatch ${fa.x} vs ${fb.x}`);
assert(approxEqual(fa.y, fb.y, 1e-3), `default rules y mismatch ${fa.y} vs ${fb.y}`);
assert(approxEqual(fa.hp, fb.hp, 1e-3), `default rules hp mismatch ${fa.hp} vs ${fb.hp}`);
assert(fa.alive === fb.alive, "default rules alive mismatch");
assert(fa.phase === fb.phase, "default rules phase mismatch");

// damage multiplier should change damage output directionally
const low = new MatchSimulation({
  mode: "ai",
  teamLoadouts: { A: cloneLoadout(DEFAULT_TEAM_LOADOUT), B: cloneLoadout(DEFAULT_AI_LOADOUT) },
  gameplayRules: normalizeGameplayRules({ damageMultiplier: 0.5 }),
  aiDifficulty: "normal",
});
const high = new MatchSimulation({
  mode: "ai",
  teamLoadouts: { A: cloneLoadout(DEFAULT_TEAM_LOADOUT), B: cloneLoadout(DEFAULT_AI_LOADOUT) },
  gameplayRules: normalizeGameplayRules({ damageMultiplier: 2 }),
  aiDifficulty: "normal",
});
const lowDmg = low.teamA.ships.main.effectiveDamage();
const highDmg = high.teamA.ships.main.effectiveDamage();
assert(highDmg > lowDmg * 1.5, `damage multiplier should scale damage (${lowDmg} vs ${highDmg})`);

const slow = new MatchSimulation({
  mode: "ai",
  teamLoadouts: { A: cloneLoadout(DEFAULT_TEAM_LOADOUT), B: cloneLoadout(DEFAULT_AI_LOADOUT) },
  gameplayRules: normalizeGameplayRules({ movementSpeedMultiplier: 0.5 }),
});
const fast = new MatchSimulation({
  mode: "ai",
  teamLoadouts: { A: cloneLoadout(DEFAULT_TEAM_LOADOUT), B: cloneLoadout(DEFAULT_AI_LOADOUT) },
  gameplayRules: normalizeGameplayRules({ movementSpeedMultiplier: 2 }),
});
assert(
  fast.teamA.ships.main.baseSpeed() > slow.teamA.ships.main.baseSpeed() * 1.5,
  "movementSpeedMultiplier should scale base speed",
);

// --- optional mode hooks: handleAction + beforeSimulationStep + presentation ---
let beforeCalls = 0;
let presentationMounted = false;
let presentationDestroyed = false;
const virtualMode = {
  id: "virtual-hook-mode",
  name: "虚拟钩子模式",
  description: "仅测试通用扩展接口",
  status: MODE_STATUS.EXPERIMENTAL,
  version: 1,
  parameterSchema: [],
  defaultParameters: {},
  createInitialModeState() {
    return { counter: 0, lastAction: null };
  },
  beforeSimulationStep({ modeState }) {
    beforeCalls += 1;
    return { modeState: { ...modeState, counter: (modeState?.counter || 0) + 1 } };
  },
  handleAction({ action, modeState, seat }) {
    if (!action || action.type !== "virtual_ping") return { handled: false };
    return {
      handled: true,
      accepted: true,
      modeState: { ...modeState, lastAction: { type: action.type, seat, value: action.value || null } },
      events: [{ type: "virtual_ping", seat, payload: { value: action.value || null } }],
    };
  },
  updateModeState({ modeState }) {
    return modeState || { counter: 0, lastAction: null };
  },
  resolveOutcome() {
    return { finished: false, winnerAllianceId: null, winnerSeat: null, reason: null, label: null };
  },
  buildDiagnostics({ modeState }) {
    return { 虚拟计数: modeState?.counter || 0 };
  },
  getPresentationState({ modeState }) {
    return { counter: modeState?.counter || 0, lastAction: modeState?.lastAction || null };
  },
  serializeModeState(modeState) {
    return modeState ? { ...modeState } : { counter: 0, lastAction: null };
  },
  presentationFactory() {
    presentationMounted = true;
    return {
      sync() {},
      update() {},
      renderWorldBefore() {},
      renderWorldAfter() {},
      renderScreen() {},
      destroy() {
        presentationDestroyed = true;
      },
    };
  },
};
validateModeDefinition(virtualMode);
const hookRuntime = createPrototypeRuntime({
  modeDefinition: virtualMode,
  runtimePreset: { controlA: "ai", controlB: "ai" },
  teamLoadouts: { A: cloneLoadout(DEFAULT_TEAM_LOADOUT), B: cloneLoadout(DEFAULT_AI_LOADOUT) },
});
hookRuntime.start();
const beforeBaseline = beforeCalls;
hookRuntime.step(TICK_DT);
hookRuntime.step(TICK_DT);
assert(beforeCalls === beforeBaseline + 2, `beforeSimulationStep should run per step (${beforeCalls})`);
assert(hookRuntime.getModeState()?.counter >= 2, "beforeSimulationStep should mutate mode state counter");
const accepted = hookRuntime.applyAction({ type: "virtual_ping", value: 42 }, "A");
assert(accepted === true, "handleAction virtual_ping should accept");
assert(hookRuntime.getModeState()?.lastAction?.value === 42, "handleAction should store payload");
const events = hookRuntime.consumeModeEvents();
assert(events.length === 1 && events[0].type === "virtual_ping", "mode events should queue and consume");
assert(hookRuntime.consumeModeEvents().length === 0, "consumeModeEvents should clear queue");
const presentation = hookRuntime.getPresentationState();
assert(presentation && presentation.counter >= 2, "getPresentationState should expose serializable data");
assert(hookRuntime.getFleetLayout()?.localSeat === "A", "getFleetLayout should expose local seat");
const presentationApi = virtualMode.presentationFactory({});
assert(presentationMounted && presentationApi && typeof presentationApi.destroy === "function", "presentationFactory mount");
presentationApi.destroy();
assert(presentationDestroyed, "presentation destroy should run");
hookRuntime.destroy();
assert(hookRuntime.consumeModeEvents().length === 0, "destroy clears mode events");

// --- shared renderer layer callbacks ---
const drawCtx = createRecordingCanvasContext();
const order = [];
drawBattleWorld(drawCtx, {
  state: {
    elapsed: 1,
    phase: "running",
    zones: [{ id: 5, x: 100, y: 100, width: 140, height: 140 }],
    projectiles: [],
    bursts: [],
    floatingTexts: [],
    fleets: {},
  },
  ownTeam: { seat: "A1", allianceId: "A", color: "#65d9ff", ships: {} },
  enemyTeam: { seat: "B1", allianceId: "B", color: "#ff8692", ships: {} },
  stars: [],
  selectedZoneId: 5,
  selectedKeyForTeam: () => null,
  worldLayerAfterBackground() {
    order.push("after-background");
  },
  worldLayerBeforeShips() {
    order.push("before-ships");
  },
  worldLayerAfterShips() {
    order.push("after-ships");
  },
});
const fillIndex = drawCtx.calls.indexOf("fillRect");
const firstTextIndex = drawCtx.calls.indexOf("fillText");
assert(fillIndex >= 0, "drawBattleWorld should draw shared background");
assert(firstTextIndex > fillIndex, "fixture should draw shared zones after background");
assert(
  order.join(",") === "after-background,before-ships,after-ships",
  `drawBattleWorld should expose deterministic world layer callbacks, got ${order.join(",") || "none"}`,
);
const expandedWorldCtx = createRecordingCanvasContext();
drawBattleWorld(expandedWorldCtx, {
  state: { elapsed: 0, phase: "running", zones: [], projectiles: [], bursts: [], floatingTexts: [], fleets: {} },
  ownTeam: null,
  enemyTeam: null,
  friendlyTeams: [],
  enemyTeams: [],
  stars: [],
  worldSize: { width: 2160, height: 2160 },
});
assert(
  expandedWorldCtx.fillRects.some(([x, y, width, height]) => x === 0 && y === 0 && width === 2160 && height === 2160),
  `background should cover runtime world extents: ${JSON.stringify(expandedWorldCtx.fillRects)}`,
);
assert(typeof battleRender.resolveFleetDrawColor === "function", "shared renderer should expose fleet pulse color resolution");
const localFleet = { seat: "A1", allianceId: "A", color: "#123456" };
const alliedFleet = { seat: "A2", allianceId: "A", color: "#345678" };
const localColorA = battleRender.resolveFleetDrawColor(localFleet, { localControlSeat: "A1" }, localFleet.color, 0);
const localColorB = battleRender.resolveFleetDrawColor(localFleet, { localControlSeat: "A1" }, localFleet.color, 0.4);
const alliedColor = battleRender.resolveFleetDrawColor(alliedFleet, { localControlSeat: "A1" }, alliedFleet.color, 0.4);
assert(localColorA !== localColorB, `A1 local color should pulse over time: ${localColorA}/${localColorB}`);
assert(alliedColor === alliedFleet.color, `A2 allied color should remain solid: ${alliedColor}`);

const legacyZoneState = {
  elapsed: 1,
  phase: "running",
  zones: [{ id: 5, x: 100, y: 100, width: 140, height: 140 }],
  projectiles: [],
  bursts: [],
  floatingTexts: [],
  fleets: {},
};
const legacyZoneFrame = {
  state: legacyZoneState,
  ownTeam: localFleet,
  enemyTeam: null,
  friendlyTeams: [],
  enemyTeams: [],
  mobileMode: true,
  visibleEnemyIds: new Set(),
  selectedKeyForTeam: () => null,
  stars: [],
};
const visibleWorldCtx = createRecordingCanvasContext();
drawBattleWorld(visibleWorldCtx, legacyZoneFrame);
const hiddenWorldCtx = createRecordingCanvasContext();
drawBattleWorld(hiddenWorldCtx, { ...legacyZoneFrame, showLegacyZones: false });

const minimapRect = { x: 20, y: 20, width: 180, height: 180 };
const minimapView = { left: 0, top: 0, width: 720, height: 720 };
const visibleMinimapCtx = createRecordingCanvasContext();
drawMinimap(visibleMinimapCtx, legacyZoneFrame, minimapRect, minimapView);
const hiddenMinimapCtx = createRecordingCanvasContext();
drawMinimap(hiddenMinimapCtx, { ...legacyZoneFrame, showLegacyZones: false }, minimapRect, minimapView);

const legacyZoneContractFailures = [];
const visibleWorldZoneTexts = visibleWorldCtx.calls.filter((call) => call === "fillText").length;
const hiddenWorldZoneTexts = hiddenWorldCtx.calls.filter((call) => call === "fillText").length;
if (visibleWorldZoneTexts < 1) legacyZoneContractFailures.push("default world zones are not visible");
if (hiddenWorldZoneTexts !== 0) legacyZoneContractFailures.push("hidden world still draws zone labels");
const visibleMinimapRects = visibleMinimapCtx.calls.filter((call) => call === "strokeRect").length;
const hiddenMinimapRects = hiddenMinimapCtx.calls.filter((call) => call === "strokeRect").length;
if (visibleMinimapRects !== hiddenMinimapRects + 1) legacyZoneContractFailures.push("hidden minimap still draws zone borders");
if (stellarTerritoryPreset.runtimePreset?.showLegacyZones !== false) legacyZoneContractFailures.push("territory preset does not hide zones");
if (typeof battleRender.resolveLegacyZoneVisibility !== "function") {
  legacyZoneContractFailures.push("platform has no generic aiming visibility resolver");
} else {
  if (!battleRender.resolveLegacyZoneVisibility({}, null)) legacyZoneContractFailures.push("default modes hide zones");
  if (battleRender.resolveLegacyZoneVisibility({ showLegacyZones: false }, null)) legacyZoneContractFailures.push("hidden preset ignored");
  if (!battleRender.resolveLegacyZoneVisibility({ showLegacyZones: false }, { shipKey: "sub1" })) {
    legacyZoneContractFailures.push("zone aiming does not reveal zones");
  }
}
assert(
  legacyZoneContractFailures.length === 0,
  `legacy zone visibility contract: ${legacyZoneContractFailures.join("; ")}`,
);

const minimapLayers = [];
drawMinimap(drawCtx, {
  state: { phase: "running", zones: [] },
  ownTeam: localFleet,
  enemyTeam: null,
  friendlyTeams: [],
  enemyTeams: [],
  mobileMode: true,
  visibleEnemyIds: new Set(),
  minimapLayerAfterBackground() {
    minimapLayers.push("mode-layer");
  },
}, { x: 20, y: 20, width: 180, height: 180 }, { left: 0, top: 0, width: 720, height: 720 });
assert(minimapLayers.join(",") === "mode-layer", `shared minimap should expose a generic mode layer callback: ${minimapLayers.join(",") || "none"}`);

const expandedMinimapCtx = createRecordingCanvasContext();
drawMinimap(expandedMinimapCtx, {
  state: { phase: "running", zones: [] },
  ownTeam: null,
  enemyTeam: null,
  friendlyTeams: [],
  enemyTeams: [],
  mobileMode: false,
  showMinimap: true,
  worldSize: { width: 2160, height: 2160 },
  visibleEnemyIds: new Set(),
}, { x: 20, y: 20, width: 180, height: 180 }, { left: 1440, top: 1440, width: 720, height: 720 });
assert(
  expandedMinimapCtx.strokeRects.some(([x, y, width, height]) => (
    approxEqual(x, 140) && approxEqual(y, 140) && approxEqual(width, 60) && approxEqual(height, 60)
  )),
  `minimap viewport should project against runtime world dimensions: ${JSON.stringify(expandedMinimapCtx.strokeRects)}`,
);

// --- static extension checks: platform core must not hardcode mode ids ---
const coreFiles = [
  "src/prototype/index.js",
  "src/prototype/runtime.js",
  "src/prototype/parameter-panel.js",
  "src/prototype/diagnostics.js",
];
for (const file of coreFiles) {
  const source = await readFile(file, "utf8");
  assert(!source.includes('modeId === "standard-elimination"'), `${file} must not hardcode standard-elimination`);
  assert(!source.includes('modeId === "validation-survival"'), `${file} must not hardcode validation-survival`);
  assert(!source.includes('mode.id === "standard-ai-1v1"'), `${file} must not branch on standard-ai-1v1`);
  assert(!source.includes("switch (mode.id)"), `${file} must not switch on mode.id`);
  assert(!source.includes('=== "standard-elimination"'), `${file} must not compare standard-elimination`);
  assert(!source.includes('=== "validation-survival"'), `${file} must not compare validation-survival`);
  assert(!source.includes('mode.id === "stellar-territory"'), `${file} must not hardcode stellar-territory`);
  assert(!source.includes('modeId === "stellar-territory"'), `${file} must not hardcode stellar-territory id`);
}

const mainSource = await readFile("src/main.js", "utf8");
assert(mainSource.includes('"/prototype"'), "main.js must register /prototype");
assert(mainSource.includes("./prototype/index.js"), "main.js must lazy-load prototype index");

const indexSource = await readFile("src/prototype/index.js", "utf8");
assert(indexSource.includes("export function mount"), "prototype index must export mount");
assert(indexSource.includes("MatchSimulation") || indexSource.includes("createPrototypeRuntime"), "prototype must use shared runtime/sim");
assert(indexSource.includes("drawBattleWorld"), "prototype must reuse battle render");
assert(indexSource.includes("worldSize,"), "prototype runtime creation should receive the active preset world size");
assert(indexSource.includes("camera.setWorldSize(worldSize, worldSize)"), "prototype creation and restart should set camera world size before reset");
assert(
  indexSource.indexOf("camera.setWorldSize(worldSize, worldSize)") < indexSource.indexOf("camera.reset({"),
  "prototype should set camera world size before reset",
);
assert(indexSource.includes("persistentMinimap"), "prototype frame should support a generic persistent minimap preset");
assert(indexSource.includes("presentationFactory") || indexSource.includes("createPresentationForCurrentMode"), "prototype must support presentation hooks");
assert(indexSource.includes("function localSeat()"), "prototype must resolve local control through runtime fleet layout");
assert(!indexSource.includes('return app.runtime.applyAction(action, "A");'), "prototype must not send local actions through legacy A alias");
assert(!indexSource.includes("snap?.fleets?.A || snap?.teams?.A"), "prototype must not read local fleet through legacy A fields");
assert(indexSource.includes("friendlyTeams:"), "prototype must pass all friendly fleets to shared renderer");
assert(
  indexSource.includes("showLegacyZones: resolveLegacyZoneVisibility("),
  "prototype frame should derive legacy-zone visibility from the generic preset and aiming state",
);
assert(indexSource.includes("enemyTeams:"), "prototype must pass all enemy fleets to shared renderer");
assert(indexSource.includes("presentation?.handleKeyDown"), "prototype should expose generic mode key handling");
assert(indexSource.includes("presentation?.handleWorldClick"), "prototype should expose generic mode world-target handling");
assert(indexSource.includes("presentation?.cancelInteraction"), "prototype should expose generic mode cancellation handling");
assert(indexSource.includes('event.code === "KeyZ"'), "prototype should reserve Z for scout launch without removing legacy fallback controls");
assert(!indexSource.includes("class MatchSimulation"), "prototype must not copy MatchSimulation");
assert(!indexSource.includes("CHARACTER_DEFS ="), "prototype must not redefine CHARACTER_DEFS");

const battleTemplateSource = await readFile("src/battle/template.js", "utf8");
assert(battleTemplateSource.includes('id="tacticalSkillBtn"'), "shared battle controls should provide a desktop tactical skill button");
assert(battleTemplateSource.includes('id="mobileTacticalSkillBtn"'), "shared battle controls should provide a mobile tactical skill button");

validateModeDefinition(standardEliminationMode);
validateModeDefinition(validationSurvivalMode);
assert(standardEliminationMode.status === MODE_STATUS.EXPERIMENTAL, "elimination status");
assert(validationSurvivalMode.status === MODE_STATUS.EXPERIMENTAL, "survival status");

// --- stellar territory skeleton ---
validateModeDefinition(stellarTerritoryMode);
assert(stellarTerritoryMode.id === "stellar-territory", "stellar territory mode id");
assert(stellarTerritoryMode.status === MODE_STATUS.EXPERIMENTAL, "stellar territory status");
assert(stellarTerritoryPreset.runtimePreset.worldSize === 2160, "territory preset should request 2160 world");
assert(stellarTerritoryPreset.runtimePreset.persistentMinimap === true, "territory preset should request persistent minimap");
const stellarParams = normalizeModeParameters(stellarTerritoryMode.parameterSchema, {});
assert(stellarParams.initialTickets === 120, "stellar default initial tickets");
assert(!stellarTerritoryMode.parameterSchema.some((field) => field.key === "controlPointCount"), "fixed control points should not expose an ineffective count parameter");
assert(!Object.prototype.hasOwnProperty.call(stellarTerritoryMode.defaultParameters, "controlPointCount"), "fixed control-point defaults should omit the ineffective count parameter");
assert(stellarParams.captureSeconds === 6, "stellar default capture seconds");
assert(stellarParams.commonResourceSpawnSeconds === 52, "stellar default common resource interval");
assert(stellarParams.rareResourceSpawnSeconds === 120, "stellar default rare resource interval");
assert(!("resourceSpawnInterval" in stellarParams), "stellar parameters should not expose the ineffective legacy resource interval");
assert(stellarParams.skillSpawnInterval === 75, "stellar default skill interval");
assert(stellarParams.respawnEnabled === true, "stellar default respawn enabled");
assert(stellarParams.mapTemplate === "three-lane-v2", "stellar default map template");

const stellarState = stellarTerritoryMode.createInitialModeState({
  parameters: stellarParams,
  randomSeed: 424242,
});
assert(stellarState.seed === 424242, "stellar state seed");
assert(stellarState.phase === "opening", "stellar initial phase");
assert(stellarState.alliances.A.tickets === 120, "stellar A initial tickets");
assert(stellarState.alliances.B.tickets === 120, "stellar B initial tickets");
assert(stellarState.version === 2, "stellar mode state should use V2 serialization");
assert(stellarState.map.templateId === "three-lane-v2" && stellarState.map.version === 2, "stellar V2 map template recorded");
assert(Array.isArray(stellarState.map.controlPoints), "stellar control points array");
assert(Array.isArray(stellarState.pickups), "stellar pickups array");
assert(Array.isArray(stellarState.activeSkillEffects), "stellar active skill effects array");
assert(Array.isArray(stellarState.respawnQueue), "stellar respawn queue array");

const customTicketState = stellarTerritoryMode.createInitialModeState({
  parameters: { ...stellarParams, initialTickets: 230 },
  randomSeed: 424242,
});
assert(customTicketState.initialTickets === 230, "custom initial tickets should be recorded authoritatively");
assert(customTicketState.alliances.A.tickets === 230 && customTicketState.alliances.B.tickets === 230, "custom initial tickets should initialize both alliances");

const serializedStellar = stellarTerritoryMode.serializeModeState(stellarState);
assert(serializedStellar !== stellarState, "stellar serialize returns copy");
assert(JSON.stringify(serializedStellar) === JSON.stringify(stellarState), "stellar serialize preserves state");
const stellarDiagnostics = stellarTerritoryMode.buildDiagnostics({
  modeState: stellarState,
  parameters: stellarParams,
});
assert(stellarDiagnostics["随机种子"] === 424242, "stellar diagnostics include seed");
assert(stellarDiagnostics["地图模板"] === "three-lane-v2", "stellar diagnostics include map template");
assert(stellarDiagnostics["A战争点数"] === 120, "stellar diagnostics include A tickets");
assert(stellarDiagnostics["B战争点数"] === 120, "stellar diagnostics include B tickets");

resetPrototypeRegistry();
resetBuiltInPrototypeRegistrationFlag();
registerBuiltInPrototypeModes();
assert(getPrototypeMode("stellar-territory")?.id === "stellar-territory", "built-ins register stellar territory");
const presetWorldRuntime = createPrototypeRuntime({
  modeDefinition: { ...standardEliminationMode, worldSize: 1720 },
  runtimePreset: { controlA: "ai", controlB: "ai", worldSize: 1800 },
});
presetWorldRuntime.start();
assert(
  presetWorldRuntime.getSimulation().worldSize === 1800,
  `runtime preset world size should override the mode preference: ${presetWorldRuntime.getSimulation().worldSize}`,
);
presetWorldRuntime.destroy();
const explicitWorldRuntime = createPrototypeRuntime({
  modeDefinition: { ...standardEliminationMode, worldSize: 1720 },
  runtimePreset: { controlA: "ai", controlB: "ai", worldSize: 1800 },
  worldSize: 1900,
});
explicitWorldRuntime.start();
assert(
  explicitWorldRuntime.getSimulation().worldSize === 1900,
  `explicit world size should override preset and mode preferences: ${explicitWorldRuntime.getSimulation().worldSize}`,
);
explicitWorldRuntime.destroy();
let unsupportedStellarWorldRejected = false;
try {
  createPrototypeRuntime({
    modeDefinition: getPrototypeMode("stellar-territory"),
    runtimePreset: { controlA: "ai", controlB: "ai" },
    worldSize: 1440,
  });
} catch (error) {
  unsupportedStellarWorldRejected = error instanceof RangeError && error.message.includes("does not support world size 1440");
}
assert(unsupportedStellarWorldRejected, "fixed-size modes should reject explicit unsupported world sizes before simulation creation");
const stellarRuntime = createPrototypeRuntime({
  modeDefinition: getPrototypeMode("stellar-territory"),
  runtimePreset: { controlA: "ai", controlB: "ai" },
  teamLoadouts: { A: cloneLoadout(DEFAULT_TEAM_LOADOUT), B: cloneLoadout(DEFAULT_AI_LOADOUT) },
  randomSeed: 13579,
});
stellarRuntime.start();
assert(
  stellarRuntime.getSimulation().worldSize === 2160,
  `stellar runtime should inherit the mode-preferred 2160 world: ${stellarRuntime.getSimulation().worldSize}`,
);
stellarRuntime.pause();
stellarRuntime.step(TICK_DT);
assert(stellarRuntime.getModeState()?.elapsed >= TICK_DT, "stellar mode steps while paused via explicit single step");
assert(stellarRuntime.serialize().modeState.seed === 13579, "stellar runtime serializes mode state");
assert(stellarRuntime.getDiagnostics()["模式ID"] === "stellar-territory", "stellar runtime diagnostics mode id");
stellarRuntime.destroy();

const generatedSeeds = [7001, 7002];
const restartSeedRuntime = createPrototypeRuntime({
  modeDefinition: getPrototypeMode("stellar-territory"),
  runtimePreset: { controlA: "ai", controlB: "ai" },
  teamLoadouts: { A: cloneLoadout(DEFAULT_TEAM_LOADOUT), B: cloneLoadout(DEFAULT_AI_LOADOUT) },
  randomSeed: null,
  randomSeedFactory: () => generatedSeeds.shift(),
});
restartSeedRuntime.start();
const initialGeneratedSeed = restartSeedRuntime.getRandomSeed();
const initialGeneratedMap = JSON.stringify(restartSeedRuntime.getModeState()?.map);
assert(initialGeneratedSeed === 7001, `missing seed should allocate a concrete random seed: ${initialGeneratedSeed}`);
assert(restartSeedRuntime.getModeState()?.seed === initialGeneratedSeed, "mode state should record the allocated runtime seed");

restartSeedRuntime.getPresentationState();
restartSeedRuntime.getPresentationState();
restartSeedRuntime.restart();
assert(restartSeedRuntime.getRandomSeed() === initialGeneratedSeed, "plain restart should preserve the current seed");
assert(JSON.stringify(restartSeedRuntime.getModeState()?.map) === initialGeneratedMap, "same-seed restart should reproduce the map exactly");

restartSeedRuntime.restart({ randomSeed: null });
const nextGeneratedSeed = restartSeedRuntime.getRandomSeed();
const nextGeneratedMap = JSON.stringify(restartSeedRuntime.getModeState()?.map);
assert(nextGeneratedSeed === 7002, `new-map restart should allocate the next seed: ${nextGeneratedSeed}`);
assert(nextGeneratedMap !== initialGeneratedMap, "new-map restart should regenerate random map features");

restartSeedRuntime.restart({ randomSeed: initialGeneratedSeed });
assert(restartSeedRuntime.getRandomSeed() === initialGeneratedSeed, "explicit seed restart should load the requested seed");
assert(JSON.stringify(restartSeedRuntime.getModeState()?.map) === initialGeneratedMap, "explicit seed restart should replay the original map");
restartSeedRuntime.destroy();

console.log("prototype platform verification passed");
