import { DEFAULT_AI_LOADOUT, DEFAULT_TEAM_LOADOUT, MatchSimulation, TICK_DT, cloneLoadout } from "../shared/game-core.js";
import {
  updateTerritoryControl,
  updateTerritoryTickets,
} from "../shared/gameplay/territory-control.js";
import { stellarTerritoryMode } from "../shared/modes/stellar-territory.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function makeSimulation() {
  return new MatchSimulation({
    mode: "ai",
    teamLoadouts: { A: cloneLoadout(DEFAULT_TEAM_LOADOUT), B: cloneLoadout(DEFAULT_AI_LOADOUT) },
    aiSeats: [],
  });
}

function makeState(seed = 909) {
  return stellarTerritoryMode.createInitialModeState({
    randomSeed: seed,
    parameters: stellarTerritoryMode.defaultParameters,
  });
}

function placeFleetOn(sim, seat, point) {
  const fleet = sim.fleetBySeat(seat);
  for (const ship of Object.values(fleet.ships)) {
    ship.x = point.center.x;
    ship.y = point.center.y;
    ship.route = null;
  }
}

let sim = makeSimulation();
let state = makeState();
let cp = state.map.controlPoints[0];
placeFleetOn(sim, "A", cp);
for (let i = 0; i < Math.ceil(6 / TICK_DT); i += 1) {
  const result = updateTerritoryControl({
    modeState: state,
    simulation: sim,
    dt: TICK_DT,
    parameters: stellarTerritoryMode.defaultParameters,
  });
  state = result.modeState;
}
cp = state.map.controlPoints[0];
assert(cp.ownerAllianceId === "A", "A should capture neutral control point after captureSeconds");
assert(cp.captureProgress === 1, "captured point progress should be full");

sim = makeSimulation();
state = makeState();
cp = state.map.controlPoints[1];
placeFleetOn(sim, "A", cp);
placeFleetOn(sim, "B", cp);
const contested = updateTerritoryControl({
  modeState: state,
  simulation: sim,
  dt: 6,
  parameters: stellarTerritoryMode.defaultParameters,
}).modeState.map.controlPoints[1];
assert(contested.ownerAllianceId == null, "contested neutral point should not capture");
assert(contested.contested === true, "contested flag should be true");
assert(contested.captureProgress === 0, "contested point should not progress");

sim = makeSimulation();
state = makeState();
state.map.controlPoints[2].ownerAllianceId = "A";
state.map.controlPoints[2].captureProgress = 1;
cp = state.map.controlPoints[2];
placeFleetOn(sim, "B", cp);
for (let i = 0; i < Math.ceil(3 / TICK_DT); i += 1) {
  state = updateTerritoryControl({
    modeState: state,
    simulation: sim,
    dt: TICK_DT,
    parameters: stellarTerritoryMode.defaultParameters,
  }).modeState;
}
cp = state.map.controlPoints[2];
assert(cp.ownerAllianceId === "A", "enemy should neutralize before ownership flips");
assert(cp.captureProgress > 0 && cp.captureProgress < 1, "neutralization should reduce owner progress");
for (let i = 0; i < Math.ceil(4 / TICK_DT); i += 1) {
  state = updateTerritoryControl({
    modeState: state,
    simulation: sim,
    dt: TICK_DT,
    parameters: stellarTerritoryMode.defaultParameters,
  }).modeState;
}
cp = state.map.controlPoints[2];
assert(cp.ownerAllianceId == null || cp.ownerAllianceId === "B", "point should pass through neutral before B can capture");
assert(cp.ownerAllianceId !== "A", "A ownership should be cleared after full neutralization");

const stateA = makeState(1001);
const stateB = makeState(1001);
const simA = makeSimulation();
const simB = makeSimulation();
placeFleetOn(simA, "A", stateA.map.controlPoints[0]);
placeFleetOn(simB, "A", stateB.map.controlPoints[0]);
let stepped = stateA;
for (let i = 0; i < Math.ceil(3 / TICK_DT); i += 1) {
  stepped = updateTerritoryControl({
    modeState: stepped,
    simulation: simA,
    dt: TICK_DT,
    parameters: stellarTerritoryMode.defaultParameters,
  }).modeState;
}
const chunked = updateTerritoryControl({
  modeState: stateB,
  simulation: simB,
  dt: 3,
  parameters: stellarTerritoryMode.defaultParameters,
}).modeState;
assert(
  Math.abs(stepped.map.controlPoints[0].captureProgress - chunked.map.controlPoints[0].captureProgress) < 1e-6,
  "control progress should be frame-rate independent",
);

state = makeState();
state.map.controlPoints[0].ownerAllianceId = "A";
state.map.controlPoints[1].ownerAllianceId = "A";
state.map.controlPoints[2].ownerAllianceId = "B";
for (let i = 0; i < Math.ceil(4 / TICK_DT); i += 1) {
  state = updateTerritoryTickets({ modeState: state, dt: TICK_DT }).modeState;
}
assert(state.alliances.B.tickets === 119, `B should lose one ticket when down one point, got ${state.alliances.B.tickets}`);
assert(state.alliances.A.tickets === 120, "advantaged side should not lose tickets");

state.map.controlPoints[2].ownerAllianceId = "A";
for (let i = 0; i < Math.ceil(2.5 / TICK_DT); i += 1) {
  state = updateTerritoryTickets({ modeState: state, dt: TICK_DT }).modeState;
}
assert(state.alliances.B.tickets === 118, `B should lose another ticket when all points controlled, got ${state.alliances.B.tickets}`);

state.alliances.B.tickets = 1;
for (let i = 0; i < Math.ceil(10 / TICK_DT); i += 1) {
  state = updateTerritoryTickets({ modeState: state, dt: TICK_DT }).modeState;
}
assert(state.alliances.B.tickets === 0, "tickets should not go below zero");
assert(state.result?.finished && state.result.winnerAllianceId === "A", "ticket zero should resolve once for advantaged alliance");

console.log("territory control verification passed");
