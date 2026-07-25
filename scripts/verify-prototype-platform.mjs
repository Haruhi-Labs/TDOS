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
import {
  registerPrototypeMode,
  getPrototypeMode,
  listPrototypeModes,
  resetPrototypeRegistry,
} from "../src/prototype/registry.js";
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
}

const mainSource = await readFile("src/main.js", "utf8");
assert(mainSource.includes('"/prototype"'), "main.js must register /prototype");
assert(mainSource.includes("./prototype/index.js"), "main.js must lazy-load prototype index");

const indexSource = await readFile("src/prototype/index.js", "utf8");
assert(indexSource.includes("export function mount"), "prototype index must export mount");
assert(indexSource.includes("MatchSimulation") || indexSource.includes("createPrototypeRuntime"), "prototype must use shared runtime/sim");
assert(indexSource.includes("drawBattleWorld"), "prototype must reuse battle render");
assert(!indexSource.includes("class MatchSimulation"), "prototype must not copy MatchSimulation");
assert(!indexSource.includes("CHARACTER_DEFS ="), "prototype must not redefine CHARACTER_DEFS");

validateModeDefinition(standardEliminationMode);
validateModeDefinition(validationSurvivalMode);
assert(standardEliminationMode.status === MODE_STATUS.EXPERIMENTAL, "elimination status");
assert(validationSurvivalMode.status === MODE_STATUS.EXPERIMENTAL, "survival status");

console.log("prototype platform verification passed");
