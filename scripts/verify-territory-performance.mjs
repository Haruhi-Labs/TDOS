import { performance } from "node:perf_hooks";
import { DEFAULT_AI_LOADOUT, DEFAULT_TEAM_LOADOUT, TICK_DT, __resetEntityIds, cloneLoadout } from "../shared/game-core.js";
import { createSeededRng } from "../shared/gameplay/seeded-rng.js";
import { createPrototypeRuntime } from "../src/prototype/runtime.js";
import { stellarTerritoryMode } from "../shared/modes/stellar-territory.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function makeFleetLayout() {
  return {
    alliances: {
      A: [
        { seat: "A1", control: "ai", loadout: cloneLoadout(DEFAULT_TEAM_LOADOUT) },
        { seat: "A2", control: "ai", loadout: cloneLoadout(DEFAULT_TEAM_LOADOUT) },
        { seat: "A3", control: "ai", loadout: cloneLoadout(DEFAULT_TEAM_LOADOUT) },
      ],
      B: [
        { seat: "B1", control: "ai", loadout: cloneLoadout(DEFAULT_TEAM_LOADOUT) },
        { seat: "B2", control: "ai", loadout: cloneLoadout(DEFAULT_TEAM_LOADOUT) },
        { seat: "B3", control: "ai", loadout: cloneLoadout(DEFAULT_TEAM_LOADOUT) },
      ],
    },
    localSeat: "A1",
  };
}

function runMatch(seed) {
  __resetEntityIds();
  const originalRandom = Math.random;
  const combatRng = createSeededRng(seed).fork("performance-combat");
  Math.random = () => combatRng.next();
  try {
    const runtime = createPrototypeRuntime({
      modeDefinition: stellarTerritoryMode,
      runtimePreset: {
        victoryPolicy: "external",
        aiNavigationOwner: "mode",
        fleetLayout: makeFleetLayout(),
      },
      randomSeed: seed,
    });
    runtime.start();
    const maxTicks = Math.ceil((12 * 60) / TICK_DT);
    let resourceEvents = 0;
    let skillEvents = 0;
    let respawnEvents = 0;
    const started = performance.now();
    for (let tick = 0; tick < maxTicks && !runtime.isFinished(); tick += 1) {
      runtime.step(TICK_DT);
      for (const event of runtime.consumeModeEvents()) {
        if (event.type === "resource_collected") resourceEvents += 1;
        if (event.type === "skill_used") skillEvents += 1;
        if (event.type === "ship_respawned") respawnEvents += 1;
      }
    }
    const elapsedMs = performance.now() - started;
    const result = runtime.getResult();
    const snapshot = runtime.getSnapshot();
    const modeState = runtime.getModeState();
    const duration = Number(snapshot?.elapsed || 0);
    runtime.destroy();
    return {
      seed,
      elapsedMs,
      duration,
      finished: Boolean(result?.finished),
      winnerAllianceId: result?.winnerAllianceId || result?.winnerSeat || null,
      resourceEvents,
      skillEvents,
      respawnEvents,
      ticketsA: Number(modeState?.alliances?.A?.tickets || 0),
      ticketsB: Number(modeState?.alliances?.B?.tickets || 0),
      controlOwners: (modeState?.map?.controlPoints || []).map((point) => point.ownerAllianceId || "-").join(""),
    };
  } finally {
    Math.random = originalRandom;
  }
}

const seeds = Array.from({ length: 3 }, (_, index) => 9000 + index * 37);

const elapsedRuntime = createPrototypeRuntime({
  modeDefinition: stellarTerritoryMode,
  runtimePreset: {
    victoryPolicy: "external",
    aiNavigationOwner: "mode",
    fleetLayout: makeFleetLayout(),
  },
  randomSeed: 7777,
});
elapsedRuntime.start();
for (let tick = 0; tick < 30; tick += 1) {
  elapsedRuntime.step(TICK_DT);
}
const elapsedModeState = elapsedRuntime.getModeState();
elapsedRuntime.destroy();
assert(
  Math.abs(Number(elapsedModeState?.elapsed || 0) - 1) < 1e-6,
  `territory mode elapsed should advance once per tick, got ${elapsedModeState?.elapsed}`,
);

for (const speedScale of [0.5, 1, 2, 4]) {
  const speedRuntime = createPrototypeRuntime({
    modeDefinition: stellarTerritoryMode,
    runtimePreset: {
      victoryPolicy: "external",
      aiNavigationOwner: "mode",
      fleetLayout: makeFleetLayout(),
    },
    randomSeed: 7800 + speedScale * 10,
  });
  speedRuntime.start();
  speedRuntime.setSpeedScale(speedScale);
  speedRuntime.update(1, { maxSteps: 140 });
  const actual = Number(speedRuntime.getModeState()?.elapsed || 0);
  speedRuntime.destroy();
  assert(Math.abs(actual - speedScale) < 1e-6, `${speedScale}x should advance ${speedScale}s in one real second, got ${actual}`);
}

const results = seeds.map((seed) => runMatch(seed));
const repeatedSeedResult = runMatch(seeds[0]);
function simulationSignature(result) {
  return JSON.stringify({
    seed: result.seed,
    duration: result.duration,
    finished: result.finished,
    winnerAllianceId: result.winnerAllianceId,
    resourceEvents: result.resourceEvents,
    skillEvents: result.skillEvents,
    respawnEvents: result.respawnEvents,
    ticketsA: result.ticketsA,
    ticketsB: result.ticketsB,
    controlOwners: result.controlOwners,
  });
}
assert(
  simulationSignature(repeatedSeedResult) === simulationSignature(results[0]),
  `same performance seed should reproduce the same simulated outcome: ${simulationSignature(results[0])} !== ${simulationSignature(repeatedSeedResult)}`,
);
const finished = results.filter((item) => item.finished);
const shortMatches = results.filter((item) => item.duration < 5 * 60);
const longMatches = results.filter((item) => item.duration > 12 * 60 - TICK_DT);
const winsA = results.filter((item) => item.winnerAllianceId === "A").length;
const winsB = results.filter((item) => item.winnerAllianceId === "B").length;
const totalSimSeconds = results.reduce((sum, item) => sum + item.duration, 0);
const totalWallMs = results.reduce((sum, item) => sum + item.elapsedMs, 0);
const avgDuration = totalSimSeconds / results.length;
const avgStepMs = totalWallMs / results.length;
const totalResources = results.reduce((sum, item) => sum + item.resourceEvents, 0);
const totalSkills = results.reduce((sum, item) => sum + item.skillEvents, 0);
const totalRespawns = results.reduce((sum, item) => sum + item.respawnEvents, 0);

console.log(JSON.stringify({
  matches: results.length,
  finished: finished.length,
  avgDurationSeconds: Number(avgDuration.toFixed(1)),
  minDurationSeconds: Number(Math.min(...results.map((item) => item.duration)).toFixed(1)),
  maxDurationSeconds: Number(Math.max(...results.map((item) => item.duration)).toFixed(1)),
  winsA,
  winsB,
  resources: totalResources,
  skills: totalSkills,
  respawns: totalRespawns,
  avgWallMs: Number(avgStepMs.toFixed(1)),
  matchWallMs: results.map((item) => Number(item.elapsedMs.toFixed(1))),
  outcomes: results.map((item) => ({
    seed: item.seed,
    finished: item.finished,
    duration: Number(item.duration.toFixed(1)),
    ticketsA: item.ticketsA,
    ticketsB: item.ticketsB,
    controlOwners: item.controlOwners,
    respawns: item.respawnEvents,
  })),
}, null, 2));

assert(finished.length >= Math.ceil(results.length * 0.5), `too many unfinished matches: ${finished.length}/${results.length}`);
assert(shortMatches.length <= Math.floor(results.length * 0.2), `too many short matches: ${shortMatches.length}/${results.length}`);
assert(longMatches.length <= Math.ceil(results.length * 0.5), `too many long matches: ${longMatches.length}/${results.length}`);
assert(totalResources > results.length * 2, `resource collection too low: ${totalResources}`);
assert(totalSkills > 0, "AI should use at least one tactical skill in batch simulation");
assert(totalRespawns > 0, "respawns should occur in batch simulation");
assert(avgStepMs < 9000, `headless match wall time too high: ${avgStepMs.toFixed(1)}ms average`);
