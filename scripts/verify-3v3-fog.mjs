import { DEFAULT_TEAM_LOADOUT } from "../shared/game-core.js";
import {
  createStellar3v3Match,
  filterStellar3v3EventsForViewer,
} from "../server/stellar3v3-match.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const fleetLayout = {
  alliances: {
    A: ["A1", "A2", "A3"].map((seat) => ({ seat, control: seat === "A1" ? "human" : "ai", loadout: DEFAULT_TEAM_LOADOUT })),
    B: ["B1", "B2", "B3"].map((seat) => ({ seat, control: "ai", loadout: DEFAULT_TEAM_LOADOUT })),
  },
};

const match = createStellar3v3Match({
  fleetLayout,
  aiDifficultiesBySeat: { A2: "normal", A3: "normal", B1: "normal", B2: "normal", B3: "normal" },
  randomSeed: 321,
});

for (let index = 0; index < 120; index += 1) {
  match.update(1 / 30);
}

const snapshot = match.buildSnapshotForViewer("A1");
const enemyPlans = Object.keys(snapshot.territory?.navigationPlans || {}).filter((key) => key.startsWith("B"));

assert(!snapshot.fleets?.B1, "viewer snapshot must hide an unseen enemy fleet");
assert(enemyPlans.length === 0, "viewer territory state must hide unseen enemy navigation plans");
assert(
  !Object.hasOwn(snapshot.territory?.alliances?.B || {}, "skillSlot"),
  "viewer territory state must hide an unseen enemy alliance skill slot",
);
assert(
  !(snapshot.territoryEvents || []).some((event) => String(event.seat || "").startsWith("B")),
  "viewer territory events must hide unseen enemy activity",
);

const filteredEvents = filterStellar3v3EventsForViewer(
  [{ type: "skill_replaced", allianceId: "B", position: { x: 2500, y: 2500 } }],
  { viewer: { allianceId: "A" }, fleets: { A1: { ships: { main: {} } } }, contacts: { visibleEnemyIds: [] } },
  "A1",
);
assert(filteredEvents.length === 0, "viewer territory events must hide unseen enemy alliance-only activity");

console.log("3v3 fog verification passed");
