import { DEFAULT_TEAM_LOADOUT, MatchSimulation } from "../shared/game-core.js";
import { createStellar3v3Match } from "../server/stellar3v3-match.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const fleetLayout = {
  alliances: {
    A: ["A1", "A2", "A3"].map((seat) => ({ seat, control: seat === "A1" ? "human" : "ai", loadout: DEFAULT_TEAM_LOADOUT })),
    B: ["B1", "B2", "B3"].map((seat) => ({ seat, control: seat === "B2" ? "human" : "ai", loadout: DEFAULT_TEAM_LOADOUT })),
  },
};

const simulation = new MatchSimulation({
  mode: "pvp",
  fleetLayout,
  aiSeats: ["A2", "A3", "B1", "B3"],
  aiDifficultiesBySeat: { A2: "easy", A3: "normal", B1: "hard", B3: "master" },
});

assert(simulation.fleetSeats.join(",") === "A1,A2,A3,B1,B2,B3", "3v3 layout must create all six fleets");
assert(simulation.botBySeat("A2")?.difficulty === "easy", "A2 must use its configured difficulty");
assert(simulation.botBySeat("A3")?.difficulty === "normal", "A3 must use its configured difficulty");
assert(simulation.botBySeat("B1")?.difficulty === "hard", "B1 must use its configured difficulty");
assert(simulation.botBySeat("B3")?.difficulty === "master", "B3 must use its configured difficulty");
assert(simulation.botBySeat("B2") === null, "human seats must not receive bot controllers");

assert(simulation.setSeatAiControl?.("B2", { enabled: true, difficulty: "hard" }) === true, "a live human seat must support temporary AI takeover");
assert(simulation.botBySeat("B2")?.difficulty === "hard", "temporary AI takeover must use the requested difficulty");
assert(simulation.setSeatAiControl?.("B2", { enabled: false }) === true, "reconnected player seat must stop AI takeover");
assert(simulation.botBySeat("B2") === null, "AI controller must be removed when player control resumes");

const radarFleetLayout = {
  alliances: {
    A: fleetLayout.alliances.A.map((entry) => ({
      ...entry,
      loadout: entry.seat === "A1" ? { main: "yuki", sub1: "haruhi", sub2: "koizumi" } : entry.loadout,
    })),
    B: fleetLayout.alliances.B,
  },
};
const stellarMatch = createStellar3v3Match({ fleetLayout: radarFleetLayout });
stellarMatch.update(1 / 30);
const radar = stellarMatch.serializeRadarForSeat("A1");
assert(radar?.active, "3v3 长门旗舰必须获得私有雷达快照");
assert(stellarMatch.serializeRadarForSeat("B1") === null, "3v3 非长门席位不能收到长门雷达快照");

console.log("3v3 core verification passed");
