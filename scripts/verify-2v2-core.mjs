import {
  DEFAULT_TEAM_LOADOUT,
  MatchSimulation,
  TICK_DT,
} from "../shared/game-core.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runSteps(sim, seconds) {
  const steps = Math.ceil(seconds / TICK_DT);
  for (let i = 0; i < steps; i += 1) {
    sim.update(TICK_DT);
  }
}

function allPlayerShips(fleet) {
  return [fleet.ships.main, fleet.ships.sub1, fleet.ships.sub2];
}

function destroyFleet(fleet, sim) {
  for (const ship of allPlayerShips(fleet)) {
    ship.takeDamage(ship.maxHp * 4, null, sim);
  }
  for (const ship of fleet.extraShips || []) {
    ship.takeDamage(ship.maxHp * 4, null, sim);
  }
}

function collectEntityObjects(value, out = []) {
  if (!value || typeof value !== "object") {
    return out;
  }
  if (Number.isFinite(value.id)) {
    out.push(value);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectEntityObjects(item, out);
    }
    return out;
  }
  for (const item of Object.values(value)) {
    collectEntityObjects(item, out);
  }
  return out;
}

function twoVsTwoFleetModelCheck() {
  const sim = new MatchSimulation({ mode: "pvp2v2", worldSize: 1440 });

  assert(Array.isArray(sim.fleetSeats), "2v2 simulation should expose fleetSeats");
  assert(sim.fleetSeats.join(",") === "A1,A2,B1,B2", "2v2 fleet seats should be A1/A2/B1/B2");
  assert(sim.fleetBySeat("A1") !== sim.fleetBySeat("A2"), "allied players must control separate fleets");
  assert(sim.fleetBySeat("A1").allianceId === "A", "A1 should belong to alliance A");
  assert(sim.fleetBySeat("A2").allianceId === "A", "A2 should belong to alliance A");
  assert(sim.fleetBySeat("B1").allianceId === "B", "B1 should belong to alliance B");
  assert(sim.fleetBySeat("B2").allianceId === "B", "B2 should belong to alliance B");
  assert(sim.teamA === sim.fleetBySeat("A1"), "legacy teamA should remain the A1 fleet");
  assert(sim.teamB === sim.fleetBySeat("B1"), "legacy teamB should remain the B1 fleet");
}

function controllerIsolationCheck() {
  const sim = new MatchSimulation({ mode: "pvp2v2", worldSize: 1440 });
  const own = sim.fleetBySeat("A1");
  const ally = sim.fleetBySeat("A2");
  const enemy = sim.fleetBySeat("B1");

  const allyX = ally.ships.main.command.x;
  const enemyX = enemy.ships.main.command.x;
  const ok = sim.applyActionForSeat("A1", {
    type: "set_route",
    fleetSeat: "A2",
    shipKey: "main",
    endX: 520,
    endY: 700,
    throttle: 1,
  });

  assert(ok, "A1 should be able to issue an action to its own fleet");
  assert(Math.abs(own.ships.main.command.x - 520) < 0.001, "A1 action should affect A1 fleet");
  assert(Math.abs(ally.ships.main.command.x - allyX) < 0.001, "forged fleetSeat must not affect allied A2 fleet");
  assert(Math.abs(enemy.ships.main.command.x - enemyX) < 0.001, "forged fleetSeat must not affect enemy fleet");
}

function routeSignature(route) {
  if (!route) {
    return null;
  }
  return {
    p1: route.p1 ? { x: Math.round(route.p1.x), y: Math.round(route.p1.y) } : null,
    p2: route.p2 ? { x: Math.round(route.p2.x), y: Math.round(route.p2.y) } : null,
    anchorToMain: route.anchorToMain !== false,
  };
}

function fleetControlSignature(fleet) {
  const ships = {};
  for (const [key, ship] of Object.entries(fleet.ships || {})) {
    ships[key] = {
      command: {
        x: Math.round(Number(ship.command?.x) || 0),
        y: Math.round(Number(ship.command?.y) || 0),
      },
      throttle: Number(ship.throttle || 0).toFixed(3),
      route: routeSignature(ship.route),
      attached: Boolean(ship.attached),
      fleetEnergy: Math.round(Number(ship.fleetEnergy) || 0),
      brakeCooldown: Number(ship.brakeCooldown || 0).toFixed(3),
    };
  }
  return JSON.stringify({
    splitLevel: fleet.splitLevel,
    cooldowns: fleet.cooldowns || {},
    autoScout: fleet.autoScout || null,
    scoutCount: Array.isArray(fleet.scouts) ? fleet.scouts.length : 0,
    ships,
  });
}

function prepareA1ForAction(sim, name) {
  const a1 = sim.fleetBySeat("A1");
  for (const ship of Object.values(a1.ships)) {
    ship.fleetEnergy = Math.max(Number(ship.fleetEnergy) || 0, 999);
  }
  if (name === "route_control" || name === "route_end" || name === "clear_route") {
    sim.applyActionForSeat("A1", {
      type: "set_route",
      shipKey: "main",
      endX: 520,
      endY: 540,
      throttle: 0.9,
    });
  }
  if (name === "cast_sub_skill") {
    sim.applyActionForSeat("A1", { type: "split", level: 1 });
  }
}

function actionIsolationMatrixCheck() {
  const cases = [
    {
      name: "set_route",
      action: { type: "set_route", fleetSeat: "A2", shipKey: "main", endX: 640, endY: 680, throttle: 1.05 },
      protectedSeats: ["A2", "B1", "B2"],
    },
    {
      name: "route_control",
      action: { type: "route_control", fleetSeat: "A2", shipKey: "main", controlX: 610, controlY: 600 },
      protectedSeats: ["A2", "B1", "B2"],
    },
    {
      name: "route_end",
      action: { type: "route_end", fleetSeat: "A2", shipKey: "main", endX: 700, endY: 650 },
      protectedSeats: ["A2", "B1", "B2"],
    },
    {
      name: "clear_route",
      action: { type: "clear_route", fleetSeat: "A2", shipKey: "main" },
      protectedSeats: ["A2", "B1", "B2"],
    },
    {
      name: "set_throttle",
      action: { type: "set_throttle", fleetSeat: "A2", shipKey: "main", throttle: 0.42 },
      protectedSeats: ["A2", "B1", "B2"],
    },
    {
      name: "split",
      action: { type: "split", fleetSeat: "A2", level: 1 },
      protectedSeats: ["A2", "B1", "B2"],
    },
    {
      name: "launch_scout",
      action: { type: "launch_scout", fleetSeat: "A2", zoneId: 3, shipKey: "main" },
      protectedSeats: ["A2", "B1", "B2"],
    },
    {
      name: "configure_auto_scout",
      action: { type: "configure_auto_scout", fleetSeat: "A2", enabled: true, zoneId: 7 },
      protectedSeats: ["A2", "B1", "B2"],
    },
    {
      name: "emergency_brake",
      action: { type: "emergency_brake", fleetSeat: "A2", shipKey: "main" },
      protectedSeats: ["A2", "B1", "B2"],
    },
    {
      name: "cast_flagship_skill",
      action: { type: "cast_flagship_skill", fleetSeat: "A2", zoneId: 5 },
      protectedSeats: ["A2"],
    },
    {
      name: "cast_sub_skill",
      action: { type: "cast_sub_skill", fleetSeat: "A2", shipKey: "sub1", zoneId: 5, targetX: 720, targetY: 720 },
      protectedSeats: ["A2"],
    },
  ];

  for (const item of cases) {
    const sim = new MatchSimulation({ mode: "pvp2v2", worldSize: 1440 });
    prepareA1ForAction(sim, item.name);
    const before = new Map(item.protectedSeats.map((seat) => [seat, fleetControlSignature(sim.fleetBySeat(seat))]));
    sim.applyActionForSeat("A1", item.action);
    for (const seat of item.protectedSeats) {
      assert(
        fleetControlSignature(sim.fleetBySeat(seat)) === before.get(seat),
        `${item.name} from A1 must not mutate ${seat} control state`,
      );
    }
  }
}

function allianceVictoryCheck() {
  const sim = new MatchSimulation({ mode: "pvp2v2", worldSize: 1440 });

  destroyFleet(sim.fleetBySeat("A1"), sim);
  sim.checkVictory();
  assert(sim.phase === "running", "destroying one fleet should not finish a 2v2 match");

  destroyFleet(sim.fleetBySeat("A2"), sim);
  sim.checkVictory();
  assert(sim.phase === "finished", "destroying all fleets in one alliance should finish a 2v2 match");
  assert(sim.winnerAllianceId === "B", "alliance B should win when all alliance A ships are destroyed");
}

function allianceSnapshotFilterCheck() {
  const sim = new MatchSimulation({ mode: "pvp2v2", worldSize: 1440 });
  const a1 = sim.fleetBySeat("A1");
  const a2 = sim.fleetBySeat("A2");
  const b1 = sim.fleetBySeat("B1");
  const b2 = sim.fleetBySeat("B2");

  for (const fleet of [a1, a2, b1, b2]) {
    for (const ship of allPlayerShips(fleet)) {
      ship.route = null;
      ship.command.x = ship.x;
      ship.command.y = ship.y;
      ship.throttle = 0.25;
    }
  }

  b1.ships.main.x = a1.ships.main.x + 90;
  b1.ships.main.y = a1.ships.main.y;
  b1.ships.main.command.x = b1.ships.main.x;
  b1.ships.main.command.y = b1.ships.main.y;

  b2.ships.main.x = 1380;
  b2.ships.main.y = 80;
  b2.ships.main.command.x = b2.ships.main.x;
  b2.ships.main.command.y = b2.ships.main.y;

  runSteps(sim, 0.2);
  const snapshot = sim.buildSnapshotForAlliance("A");

  assert(snapshot.viewer.allianceId === "A", "snapshot should record the viewer alliance");
  assert(snapshot.fleets.A1 && snapshot.fleets.A2, "allied fleets should be fully present");
  assert(snapshot.fleets.B1, "visible enemy fleet should be present");
  assert(!snapshot.fleets.B2, "hidden enemy fleet should not be present in alliance snapshot");

  const entityObjects = collectEntityObjects({
    fleets: snapshot.fleets,
    projectiles: snapshot.projectiles,
    bursts: snapshot.bursts,
    floatingTexts: snapshot.floatingTexts,
  });
  const leakedHiddenShip = entityObjects.find((entity) =>
    entity.id === b2.ships.main.id || entity.id === b2.ships.sub1.id || entity.id === b2.ships.sub2.id
  );
  assert(!leakedHiddenShip, "hidden enemy ship id leaked into snapshot");
  const leakedHiddenPoint = entityObjects.find((entity) => entity.x === b2.ships.main.x && entity.y === b2.ships.main.y);
  assert(!leakedHiddenPoint, "hidden enemy coordinate pair leaked into snapshot");
}

function defeatedViewerSnapshotCheck() {
  const sim = new MatchSimulation({ mode: "pvp2v2", worldSize: 1440 });
  destroyFleet(sim.fleetBySeat("A1"), sim);
  sim.checkVictory();
  assert(sim.phase === "running", "one defeated player fleet should not finish a 2v2 match");

  const snapshot = sim.buildSnapshotForViewer("A1");
  assert(snapshot.viewer.seat === "A1", "viewer snapshot should record the defeated player's seat");
  assert(snapshot.viewer.allianceId === "A", "defeated viewer should remain on its original alliance");
  assert(snapshot.viewer.fleetDefeated === true, "defeated viewer should be marked as fleetDefeated");
  assert(snapshot.viewer.canControlFleet === false, "defeated viewer should not be able to control a destroyed fleet");
  assert(snapshot.fleets.A2, "defeated viewer should retain allied fleet information");
  assert(!snapshot.fleets.B1 && !snapshot.fleets.B2, "defeated viewer should not receive full enemy state without alliance vision");
}

function spawnAndResourceBalanceCheck() {
  const sharedLoadout = cloneLoadoutLike(DEFAULT_TEAM_LOADOUT);
  const sim = new MatchSimulation({
    mode: "pvp2v2",
    worldSize: 1440,
    teamLoadouts: {
      A1: sharedLoadout,
      A2: sharedLoadout,
      B1: sharedLoadout,
      B2: sharedLoadout,
    },
  });
  const state = sim.serializeState();
  const a1 = state.fleets.A1.ships.main;
  const a2 = state.fleets.A2.ships.main;
  const b1 = state.fleets.B1.ships.main;
  const b2 = state.fleets.B2.ships.main;

  assert(a1.x === a2.x && b1.x === b2.x, "2v2 allied spawn columns should align");
  assert(Math.abs((a1.x + b1.x) - 1440) < 0.001, "2v2 spawn columns should mirror across map center");
  assert(a1.y === b1.y && a2.y === b2.y, "2v2 opposing spawn lanes should mirror vertically");
  assert(a1.y < a2.y && b1.y < b2.y, "2v2 teammates should start in separate lanes");
  assert(Math.abs(a1.angle) < 0.001 && Math.abs(b1.angle - Math.PI) < 0.001, "2v2 fleets should face each other");

  sim.applyActionForSeat("A1", { type: "split", level: 1 });
  sim.applyActionForSeat("A1", { type: "launch_scout", zoneId: 5 });
  assert(sim.fleetBySeat("A1").splitLevel === 1, "A1 split should affect only A1");
  assert(sim.fleetBySeat("A2").splitLevel === 0, "A2 split level should remain independent");
  assert(sim.fleetBySeat("A1").scouts.length === 1, "A1 scout should launch from A1 resources");
  assert(sim.fleetBySeat("A2").scouts.length === 0, "A2 scout list should remain independent");
  assert(sim.fleetBySeat("A1").loadout !== sim.fleetBySeat("A2").loadout, "duplicate loadouts should be cloned per fleet");
}

function cloneLoadoutLike(loadout) {
  return {
    main: loadout.main,
    sub1: loadout.sub1,
    sub2: loadout.sub2,
  };
}

function snapshotPerformanceEnvelopeCheck() {
  const sim = new MatchSimulation({ mode: "pvp2v2", worldSize: 1440 });
  runSteps(sim, 3);
  const startedAt = performance.now();
  let largestBytes = 0;
  for (let i = 0; i < 120; i += 1) {
    const snapshotA = sim.buildSnapshotForViewer(i % 2 === 0 ? "A1" : "B1");
    largestBytes = Math.max(largestBytes, Buffer.byteLength(JSON.stringify(snapshotA), "utf8"));
  }
  const elapsedMs = performance.now() - startedAt;
  assert(largestBytes < 140_000, `2v2 filtered snapshot should stay below 140KB at spawn/search scale, got ${largestBytes}`);
  assert(elapsedMs < 250, `2v2 snapshot filtering should stay within a practical CPU envelope, got ${elapsedMs.toFixed(1)}ms`);
  console.log(`2v2 snapshot envelope: max=${largestBytes} bytes; 120 filtered snapshots=${elapsedMs.toFixed(1)}ms`);
}

function main() {
  twoVsTwoFleetModelCheck();
  controllerIsolationCheck();
  actionIsolationMatrixCheck();
  allianceVictoryCheck();
  allianceSnapshotFilterCheck();
  defeatedViewerSnapshotCheck();
  spawnAndResourceBalanceCheck();
  snapshotPerformanceEnvelopeCheck();
  console.log("2v2 core verification passed");
}

main();
