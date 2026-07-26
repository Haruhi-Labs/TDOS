import {
  DEFAULT_AI_LOADOUT,
  DEFAULT_TEAM_LOADOUT,
  MatchSimulation,
  cloneLoadout,
} from "../shared/game-core.js";
import { createPrototypeRuntime } from "../src/prototype/runtime.js";
import { stellarTerritoryMode } from "../shared/modes/stellar-territory.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function makeFleetLayout(teamSize = 3) {
  return {
    alliances: {
      A: Array.from({ length: teamSize }, (_, index) => ({
        seat: `A${index + 1}`,
        control: index === 0 ? "human" : "ai",
        loadout: cloneLoadout(DEFAULT_TEAM_LOADOUT),
      })),
      B: Array.from({ length: teamSize }, (_, index) => ({
        seat: `B${index + 1}`,
        control: "ai",
        loadout: cloneLoadout(index === 0 ? DEFAULT_AI_LOADOUT : DEFAULT_TEAM_LOADOUT),
      })),
    },
    localSeat: "A1",
  };
}

const legacySim = new MatchSimulation({ mode: "ai", aiSeats: [] });
assert(legacySim.fleetSeats.join(",") === "A,B", "legacy A/B fleet seats remain unchanged");
assert(legacySim.fleetBySeat("A") === legacySim.teamA, "legacy A alias still resolves teamA");
assert(legacySim.fleetBySeat("B") === legacySim.teamB, "legacy B alias still resolves teamB");

const twoVsTwo = new MatchSimulation({ mode: "pvp2v2", aiSeats: [] });
assert(twoVsTwo.fleetSeats.join(",") === "A1,A2,B1,B2", "existing 2v2 seats remain unchanged");
assert(twoVsTwo.alliances.A.fleetSeats.join(",") === "A1,A2", "existing 2v2 A alliance unchanged");
assert(twoVsTwo.alliances.B.fleetSeats.join(",") === "B1,B2", "existing 2v2 B alliance unchanged");

const fleetLayout = makeFleetLayout(3);
const scaleSim = new MatchSimulation({
  mode: "ai",
  fleetLayout,
  aiSeats: ["A2", "A3", "B1", "B2", "B3"],
});
assert(scaleSim.fleetSeats.join(",") === "A1,A2,A3,B1,B2,B3", "generic 3v3 fleet seats should be honored");
assert(scaleSim.alliances.A.fleetSeats.join(",") === "A1,A2,A3", "generic 3v3 A alliance seats");
assert(scaleSim.alliances.B.fleetSeats.join(",") === "B1,B2,B3", "generic 3v3 B alliance seats");
assert(scaleSim.fleetBySeat("A") === scaleSim.fleetBySeat("A1"), "A alias should resolve primary A fleet in generic layout");
assert(scaleSim.fleetBySeat("B") === scaleSim.fleetBySeat("B1"), "B alias should resolve primary B fleet in generic layout");
assert(scaleSim.fleetSeats.flatMap((seat) => scaleSim.fleetBySeat(seat).getAllShips()).length === 18, "3v3 scale creates 18 basic ships");

const spawnPairs = [];
for (const seat of scaleSim.fleetSeats) {
  const ship = scaleSim.fleetBySeat(seat).shipByKey("main");
  spawnPairs.push(`${Math.round(ship.x)}:${Math.round(ship.y)}`);
}
assert(new Set(spawnPairs).size === 6, "3v3 main ships spawn in distinct positions");

const runtime = createPrototypeRuntime({
  modeDefinition: stellarTerritoryMode,
  runtimePreset: {
    controlA: "human",
    controlB: "ai",
    victoryPolicy: "external",
    fleetLayout,
  },
  randomSeed: 4242,
});
runtime.start();
const runtimeLayout = runtime.getFleetLayout();
assert(runtimeLayout.localSeat === "A1", "runtime exposes configured local seat");
assert(runtimeLayout.alliances.A.map((entry) => entry.seat).join(",") === "A1,A2,A3", "runtime exposes A fleet layout");
assert(runtimeLayout.alliances.B.map((entry) => entry.seat).join(",") === "B1,B2,B3", "runtime exposes B fleet layout");
assert(runtime.getSimulation().fleetSeats.length === 6, "runtime creates six fleets from fleetLayout");
assert(runtime.getSnapshot().alliances.A.fleetSeats.length === 3, "snapshot exposes three A fleets");
assert(runtime.getSnapshot().alliances.B.fleetSeats.length === 3, "snapshot exposes three B fleets");
assert(runtime.getModeState().map.spawnAreas[0].radius > 82, "territory map uses larger team spawn radius for 3v3");
runtime.destroy();

console.log("territory scale verification passed");
