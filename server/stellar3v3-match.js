import { createPrototypeRuntime } from "../src/prototype/runtime.js";
import { stellarTerritoryMode } from "../shared/modes/stellar-territory.js";

function allianceIdForSeat(seat) {
  return String(seat || "").toUpperCase().startsWith("B") ? "B" : "A";
}

function planSeatAndShipKey(key) {
  const [seat, shipKey] = String(key || "").split(":");
  return { seat, shipKey };
}

function canViewerSeeShip(snapshot, viewerAllianceId, seat, shipKey, shipId = null) {
  if (!seat || allianceIdForSeat(seat) === viewerAllianceId) return true;
  if (shipId && (snapshot.contacts?.visibleEnemyIds || []).includes(shipId)) return true;
  return Boolean(snapshot.fleets?.[seat]?.ships?.[shipKey]);
}

function filterControlPointOccupants(point, snapshot, viewerAllianceId) {
  const occupants = point?.occupants;
  if (!occupants || typeof occupants !== "object") return point;
  return {
    ...point,
    occupants: Object.fromEntries(
      Object.entries(occupants).map(([allianceId, entries]) => [
        allianceId,
        Array.isArray(entries)
          ? entries.filter((entry) => canViewerSeeShip(
            snapshot,
            viewerAllianceId,
            entry?.seat,
            entry?.shipKey,
            entry?.shipId,
          ))
          : [],
      ]),
    ),
  };
}

function filterTerritoryForViewer(territory, snapshot, viewerSeat) {
  if (!territory || !viewerSeat) return territory;
  const viewerAllianceId = snapshot.viewer?.allianceId || allianceIdForSeat(viewerSeat);
  const sourceVisible = (seat, shipKey = "main", shipId = null) => canViewerSeeShip(
    snapshot,
    viewerAllianceId,
    seat,
    shipKey,
    shipId,
  );
  const navigationPlans = Object.fromEntries(
    Object.entries(territory.navigationPlans || {}).filter(([key]) => {
      const { seat, shipKey } = planSeatAndShipKey(key);
      return sourceVisible(seat, shipKey);
    }),
  );
  const activeSkillEffects = (territory.activeSkillEffects || [])
    .filter((effect) => !effect?.seat || sourceVisible(effect.seat))
    .map((effect) => ({
      ...effect,
      targetSeat: effect?.targetSeat && !sourceVisible(effect.targetSeat) ? null : effect.targetSeat || null,
    }));
  const respawnQueue = (territory.respawnQueue || [])
    .filter((item) => sourceVisible(item?.seat, item?.shipKey));
  const controlPoints = (territory.map?.controlPoints || [])
    .map((point) => filterControlPointOccupants(point, snapshot, viewerAllianceId));
  const alliances = Object.fromEntries(
    Object.entries(territory.alliances || {}).map(([allianceId, state]) => {
      if (allianceId === viewerAllianceId) return [allianceId, state];
      const { skillSlot: _hiddenSkillSlot, ...publicState } = state || {};
      return [allianceId, publicState];
    }),
  );

  return {
    ...territory,
    alliances,
    map: territory.map ? { ...territory.map, controlPoints } : territory.map,
    activeSkillEffects,
    respawnQueue,
    navigationPlans,
    telemetry: {},
  };
}

export function filterStellar3v3EventsForViewer(events, snapshot, viewerSeat) {
  if (!viewerSeat) return events.map((event) => ({ ...event }));
  const viewerAllianceId = snapshot.viewer?.allianceId || allianceIdForSeat(viewerSeat);
  return events
    .filter((event) => {
      if (event?.seat) return canViewerSeeShip(snapshot, viewerAllianceId, event.seat, event.shipKey);
      return !event?.allianceId || event.allianceId === viewerAllianceId;
    })
    .map((event) => ({ ...event }));
}

function viewerStateForSeat(simulation, base, viewerSeat) {
  const fleet = simulation.fleetBySeat(viewerSeat);
  const aliveShips = fleet ? fleet.getAllShips().filter((ship) => ship.alive).length : 0;
  const fleetDefeated = aliveShips <= 0;
  return {
    ...(base.viewer || {}),
    seat: viewerSeat,
    fleetId: viewerSeat,
    allianceId: fleet?.allianceId || allianceIdForSeat(viewerSeat),
    fleetDefeated,
    canControlFleet: !fleetDefeated && simulation.phase === "running",
  };
}

function stateForViewer(runtime, modeEvents, viewerSeat = null, snapshotCache = null) {
  const simulation = runtime.getSimulation();
  const result = runtime.getResult();
  if (!viewerSeat) {
    const base = simulation.serializeState();
    return {
      ...base,
      mode: "stellar3v3",
      modeId: stellarTerritoryMode.id,
      phase: result?.finished ? "finished" : base.phase,
      winnerSeat: result?.winnerSeat || null,
      winnerAllianceId: result?.winnerAllianceId || null,
      territory: runtime.getPresentationState(),
      territoryEvents: filterStellar3v3EventsForViewer(modeEvents, base, viewerSeat),
    };
  }

  const allianceId = allianceIdForSeat(viewerSeat);
  const tick = simulation.tick;
  if (snapshotCache && snapshotCache.tick !== tick) {
    snapshotCache.tick = tick;
    snapshotCache.allianceStates.clear();
  }

  let cached = snapshotCache?.allianceStates.get(allianceId) || null;
  if (!cached) {
    const base = simulation.buildSnapshotForAlliance(allianceId);
    cached = {
      base,
      territory: filterTerritoryForViewer(runtime.getPresentationState(), base, viewerSeat),
      territoryEvents: filterStellar3v3EventsForViewer(modeEvents, base, viewerSeat),
    };
    if (snapshotCache) {
      snapshotCache.allianceStates.set(allianceId, cached);
      snapshotCache.allianceSnapshotBuilds += 1;
    }
  }

  const { base } = cached;
  return {
    ...base,
    viewer: viewerStateForSeat(simulation, base, viewerSeat),
    mode: "stellar3v3",
    modeId: stellarTerritoryMode.id,
    phase: result?.finished ? "finished" : base.phase,
    winnerSeat: result?.winnerSeat || null,
    winnerAllianceId: result?.winnerAllianceId || null,
    territory: cached.territory,
    territoryEvents: cached.territoryEvents,
  };
}

export function createStellar3v3Match({
  fleetLayout,
  teamNames = {},
  teamLoadouts = {},
  aiDifficultiesBySeat = {},
  randomSeed = null,
} = {}) {
  const runtime = createPrototypeRuntime({
    modeDefinition: stellarTerritoryMode,
    runtimePreset: {
      worldSize: stellarTerritoryMode.worldSize,
      victoryPolicy: "external",
      aiNavigationOwner: "mode",
      aiThinkIntervalSeconds: 0.1,
      teamNameA: teamNames.A1 || "星域 A 阵营",
      teamNameB: teamNames.B1 || "星域 B 阵营",
      fleetLayout,
    },
    teamLoadouts,
    aiDifficultiesBySeat,
    randomSeed,
  }).start();

  let modeEvents = runtime.consumeModeEvents();
  const snapshotCache = {
    tick: null,
    allianceStates: new Map(),
    allianceSnapshotBuilds: 0,
  };

  return {
    update(dt) {
      runtime.step(dt);
      modeEvents = runtime.consumeModeEvents();
    },
    applyActionForSeat(seat, action) {
      return runtime.applyAction(action, seat);
    },
    setSeatAiControl(seat, options) {
      return runtime.setSeatAiControl(seat, options);
    },
    buildSnapshotForViewer(seat) {
      return stateForViewer(runtime, modeEvents, seat, snapshotCache);
    },
    serializeState() {
      return stateForViewer(runtime, modeEvents);
    },
    getPerformanceDiagnostics() {
      return {
        allianceSnapshotBuilds: snapshotCache.allianceSnapshotBuilds,
      };
    },
    get tick() {
      return runtime.serialize().elapsedTicks;
    },
    get elapsed() {
      return runtime.getSimulation()?.elapsed || 0;
    },
    get phase() {
      return runtime.getResult()?.finished ? "finished" : "running";
    },
    get winnerSeat() {
      return runtime.getResult()?.winnerSeat || null;
    },
    get winnerAllianceId() {
      return runtime.getResult()?.winnerAllianceId || null;
    },
  };
}
