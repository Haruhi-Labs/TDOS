import {
  DEFAULT_AI_LOADOUT,
  DEFAULT_TEAM_LOADOUT,
  MatchSimulation,
  cloneLoadout,
} from "../shared/game-core.js";
import { createPrototypeRuntime } from "../src/prototype/runtime.js";
import { stellarTerritoryMode } from "../shared/modes/stellar-territory.js";
import { queueTerritoryRespawns, updateTerritoryRespawns } from "../shared/gameplay/territory-respawn.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNoHullOverlap(ships, label) {
  for (let left = 0; left < ships.length; left += 1) {
    for (let right = left + 1; right < ships.length; right += 1) {
      const a = ships[left];
      const b = ships[right];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const minimum = Number(a.radius || 0) + Number(b.radius || 0);
      assert(distance + 1e-6 >= minimum, `${label}: ${a.id} and ${b.id} overlap (${distance.toFixed(2)} < ${minimum.toFixed(2)})`);
    }
  }
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

const visibilitySim = new MatchSimulation({ mode: "ai", fleetLayout, aiSeats: [] });
const a2Scout = visibilitySim.fleetBySeat("A2").shipByKey("main");
const b2Contact = visibilitySim.fleetBySeat("B2").shipByKey("main");
a2Scout.x = 500;
a2Scout.y = 500;
b2Contact.x = 520;
b2Contact.y = 500;
visibilitySim.update(0);
assert(
  visibilitySim.fleetBySeat("A2").visibleEnemyIds.has(b2Contact.id),
  "generic 3v3 should compute visibility from A2 sensors against B2 contacts",
);
assert(
  visibilitySim.fleetBySeat("A1").visibleEnemyIds.has(b2Contact.id),
  "generic 3v3 should share A2 visibility across alliance A",
);

const botGroupSim = new MatchSimulation({ mode: "ai", fleetLayout, aiSeats: ["A2"] });
const a2EnemyShips = botGroupSim.botBySeat("A2").enemy.getAllShips();
assert(a2EnemyShips.length === 9, `generic A2 bot should receive all nine B ships, got ${a2EnemyShips.length}`);
assert(
  a2EnemyShips.every((ship) => ship.team.allianceId === "B"),
  "generic A2 bot enemy group should contain only alliance B ships",
);

const internalVictorySim = new MatchSimulation({ mode: "ai", fleetLayout, aiSeats: [] });
for (const ship of internalVictorySim.fleetBySeat("A1").getAllShips()) {
  ship.hp = 0;
  ship.alive = false;
}
internalVictorySim.checkVictory();
assert(
  internalVictorySim.phase === "running",
  "generic 3v3 internal victory should continue while A2 or A3 still has living ships",
);
for (const seat of ["A2", "A3"]) {
  for (const ship of internalVictorySim.fleetBySeat(seat).getAllShips()) {
    ship.hp = 0;
    ship.alive = false;
  }
}
internalVictorySim.checkVictory();
assert(
  internalVictorySim.phase === "finished" && internalVictorySim.winnerAllianceId === "B",
  "generic 3v3 internal victory should finish for B only after every A fleet is destroyed",
);

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
const state = runtime.getModeState();
const snap = runtime.getSnapshot();
const spawnA = state.map.spawnAreas.find((area) => area.allianceId === "A");
const spawnB = state.map.spawnAreas.find((area) => area.allianceId === "B");
const a1 = snap.fleets.A1.ships.main;
const b1 = snap.fleets.B1.ships.main;
assert(Math.hypot(a1.x - spawnA.center.x, a1.y - spawnA.center.y) <= 1, "A1 main should start at A spawn anchor");
assert(Math.hypot(b1.x - spawnB.center.x, b1.y - spawnB.center.y) <= 1, "B1 main should start at B spawn anchor");
assert(a1.x < snap.world.size * 0.2 && a1.y > snap.world.size * 0.75, "A1 should spawn in lower-left");
assert(b1.x > snap.world.size * 0.8 && b1.y < snap.world.size * 0.25, "B1 should spawn in upper-right");
assert(Math.abs(a1.angle + Math.PI / 4) < 1e-6, "A ships should face upper-right");
assert(Math.abs(b1.angle - (Math.PI * 3) / 4) < 1e-6, "B ships should face lower-left");
const fleetMainPositions = ["A1", "A2", "A3", "B1", "B2", "B3"].map((seat) => {
  const main = snap.fleets[seat].ships.main;
  return `${Math.round(main.x)}:${Math.round(main.y)}`;
});
assert(new Set(fleetMainPositions).size === 6, "territory 3v3 fleet anchors should not overlap");
for (const seat of ["A1", "A2", "A3", "B1", "B2", "B3"]) {
  const ships = snap.fleets[seat].ships;
  const positions = Object.values(ships).map((ship) => `${Math.round(ship.x)}:${Math.round(ship.y)}`);
  assert(new Set(positions).size === 3, `${seat} ships should not overlap at spawn`);
}
assertNoHullOverlap(
  ["A1", "A2", "A3", "B1", "B2", "B3"].flatMap((seat) => Object.values(snap.fleets[seat].ships)),
  "initial 3v3 deployment",
);

const initialPositions = Object.fromEntries(
  runtime.getSimulation().fleetSeats.flatMap((seat) =>
    ["main", "sub1", "sub2"].map((shipKey) => {
      const ship = runtime.getSimulation().fleetBySeat(seat).shipByKey(shipKey);
      return [`${seat}:${shipKey}`, { x: ship.x, y: ship.y }];
    }),
  ),
);
for (const seat of runtime.getSimulation().fleetSeats) {
  for (const shipKey of ["main", "sub1", "sub2"]) {
    const ship = runtime.getSimulation().fleetBySeat(seat).shipByKey(shipKey);
    ship.takeDamage(ship.maxHp * 10, null, runtime.getSimulation(), false);
  }
}
let respawnState = queueTerritoryRespawns({
  modeState: runtime.getModeState(),
  simulation: runtime.getSimulation(),
}).modeState;
respawnState.respawnQueue = respawnState.respawnQueue.map((item) => ({ ...item, remaining: 0 }));
respawnState = updateTerritoryRespawns({
  modeState: respawnState,
  simulation: runtime.getSimulation(),
  dt: 0,
}).modeState;
assert(respawnState.respawnQueue.length === 0, "all immediate 3v3 respawns should complete");
const respawnPositions = [];
const respawnShips = [];
for (const seat of runtime.getSimulation().fleetSeats) {
  for (const shipKey of ["main", "sub1", "sub2"]) {
    const ship = runtime.getSimulation().fleetBySeat(seat).shipByKey(shipKey);
    const initial = initialPositions[`${seat}:${shipKey}`];
    assert(Math.hypot(ship.x - initial.x, ship.y - initial.y) <= 1e-6, `${seat}:${shipKey} should respawn at its initial deployment`);
    respawnPositions.push(`${Math.round(ship.x)}:${Math.round(ship.y)}`);
    respawnShips.push(ship);
  }
}
assert(new Set(respawnPositions).size === 18, "all 18 respawn positions should remain distinct");
assertNoHullOverlap(respawnShips, "3v3 respawn deployment");
runtime.destroy();

console.log("territory scale verification passed");
