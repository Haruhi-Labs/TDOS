import { DEFAULT_TEAM_LOADOUT } from "../shared/game-core.js";
import { createStellar3v3Match } from "../server/stellar3v3-match.js";
import { stellarTerritoryMode } from "../shared/modes/stellar-territory.js";
import { createPrototypeRuntime } from "../src/prototype/runtime.js";
import { resolveCanvasBackingSize } from "../src/battle/camera.js";
import { territoryStaticMapCacheKey } from "../src/modes/stellar-territory/render.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const fleetLayout = {
  alliances: {
    A: ["A1", "A2", "A3"].map((seat) => ({
      seat,
      control: seat === "A1" ? "human" : "ai",
      loadout: DEFAULT_TEAM_LOADOUT,
    })),
    B: ["B1", "B2", "B3"].map((seat) => ({
      seat,
      control: "ai",
      loadout: DEFAULT_TEAM_LOADOUT,
    })),
  },
};

function countBeliefUpdates(runtime, seat, ticks = 30) {
  const bot = runtime.getSimulation().botBySeat(seat);
  assert(bot, `${seat} bot must exist`);
  const original = bot.updateBelief.bind(bot);
  let calls = 0;
  bot.updateBelief = (...args) => {
    calls += 1;
    return original(...args);
  };
  for (let index = 0; index < ticks; index += 1) {
    runtime.step(1 / 30);
  }
  return calls;
}

const legacyRuntime = createPrototypeRuntime({
  modeDefinition: stellarTerritoryMode,
  runtimePreset: {
    worldSize: 3200,
    victoryPolicy: "external",
    aiNavigationOwner: "mode",
    fleetLayout,
  },
  randomSeed: 6001,
}).start();

assert(
  countBeliefUpdates(legacyRuntime, "A2") === 30,
  "existing modes must keep their per-tick AI cognition by default",
);

const optimizedRuntime = createPrototypeRuntime({
  modeDefinition: stellarTerritoryMode,
  runtimePreset: {
    worldSize: 3200,
    victoryPolicy: "external",
    aiNavigationOwner: "mode",
    aiThinkIntervalSeconds: 0.1,
    fleetLayout,
  },
  randomSeed: 6001,
}).start();

assert(
  countBeliefUpdates(optimizedRuntime, "A2") === 10,
  "3v3 AI cognition must run at 10Hz while the authority simulation keeps 30Hz ticks",
);

const match = createStellar3v3Match({
  fleetLayout,
  randomSeed: 6002,
});

match.buildSnapshotForViewer("A1");
match.buildSnapshotForViewer("A2");
assert(
  match.getPerformanceDiagnostics().allianceSnapshotBuilds === 1,
  "same-alliance viewers must share one authority snapshot per tick",
);

match.buildSnapshotForViewer("B1");
assert(
  match.getPerformanceDiagnostics().allianceSnapshotBuilds === 2,
  "the opposing alliance must receive an independently filtered snapshot",
);

match.update(1 / 30);
match.buildSnapshotForViewer("A1");
assert(
  match.getPerformanceDiagnostics().allianceSnapshotBuilds === 3,
  "a new authority tick must invalidate the alliance snapshot cache",
);

assert(
  resolveCanvasBackingSize(1440, 2, { minBacking: 1280, maxBacking: 1920, maxDpr: 1.5 }) === 1920,
  "3v3 desktop rendering must cap the backing store at its performance budget",
);
assert(
  resolveCanvasBackingSize(800, 3, { minBacking: 960, maxBacking: 1440, maxDpr: 1.25 }) === 1000,
  "3v3 mobile rendering must respect its lower DPR ceiling",
);
assert(
  resolveCanvasBackingSize(700, 1) === 1440,
  "existing battle modes must retain the current default backing-store policy",
);

const staticMap = {
  templateId: "three-lane-v2",
  version: 2,
  seed: 6003,
  worldSize: { width: 3200, height: 3200 },
};
assert(
  territoryStaticMapCacheKey(staticMap) === territoryStaticMapCacheKey({ ...staticMap, worldSize: { ...staticMap.worldSize } }),
  "equivalent map snapshots must reuse the same static render cache",
);
assert(
  territoryStaticMapCacheKey(staticMap) !== territoryStaticMapCacheKey({ ...staticMap, seed: 6004 }),
  "a different map seed must invalidate the static render cache",
);

console.log("3v3 performance verification passed");
