import { DEFAULT_TEAM_LOADOUT } from "../shared/game-core.js";
import { stellarTerritoryMode } from "../shared/modes/stellar-territory.js";
import { createPrototypeRuntime } from "../src/prototype/runtime.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const fleetLayout = {
  alliances: {
    A: ["A1", "A2", "A3"].map((seat) => ({ seat, control: seat === "A1" ? "human" : "ai", loadout: DEFAULT_TEAM_LOADOUT })),
    B: ["B1", "B2", "B3"].map((seat) => ({ seat, control: seat === "B2" ? "human" : "ai", loadout: DEFAULT_TEAM_LOADOUT })),
  },
};

const runtime = createPrototypeRuntime({
  modeDefinition: stellarTerritoryMode,
  runtimePreset: { worldSize: 3200, victoryPolicy: "external", aiNavigationOwner: "mode", fleetLayout },
  aiDifficultiesBySeat: { A2: "easy", A3: "normal", B1: "hard", B3: "master" },
  randomSeed: 321,
}).start();

assert(runtime.getSimulation().botBySeat("A2")?.difficulty === "easy", "territory runtime must preserve A2 difficulty");
assert(runtime.getSimulation().botBySeat("B1")?.difficulty === "hard", "territory runtime must preserve B1 difficulty");
assert(runtime.getPresentationState()?.map?.worldSize?.width === 3200, "territory runtime must initialize the 3200 world map");
runtime.step();
assert(runtime.getModeState().elapsed > 0, "territory mode state must advance with the authority tick");
assert(runtime.setSeatAiControl?.("A1", { enabled: true, difficulty: "hard" }) === true, "runtime must add a temporary AI seat");
assert(runtime.getSimulation().botBySeat("A1")?.difficulty === "hard", "runtime takeover must configure its bot");
assert(runtime.setSeatAiControl?.("A1", { enabled: false }) === true, "runtime must release a reconnected human seat");
assert(runtime.getSimulation().botBySeat("A1") === null, "runtime must remove the temporary AI controller");

console.log("3v3 territory runtime verification passed");
