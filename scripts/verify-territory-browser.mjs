import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import * as territoryPresentation from "../src/modes/stellar-territory/presentation.js";
import { routeHandleAtPoint } from "../src/battle/input.js";
import { drawBattleWorld } from "../src/battle/render.js";
import { ALLOWED_TACTICAL_SKILLS } from "../shared/gameplay/territory-skills.js";
import { firstObstacleHit, positionClearOfObstacles } from "../shared/gameplay/territory-obstacles.js";

const VITE_PORT = 30000 + Math.floor(Math.random() * 1000);
const APP_URL = `http://127.0.0.1:${VITE_PORT}/prototype`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createRecordingContext() {
  const texts = [];
  const textPositions = [];
  const arcs = [];
  const moves = [];
  const lines = [];
  const fills = [];
  const strokes = [];
  const target = {
    canvas: { width: 1200, height: 1200 },
    texts,
    textPositions,
    arcs,
    moves,
    lines,
    fills,
    strokes,
    measureText(text) {
      return { width: String(text || "").length * 12 };
    },
    fillText(text, x, y) {
      texts.push(String(text));
      textPositions.push({ text: String(text), x, y });
    },
    arc(...args) {
      arcs.push(args);
    },
    moveTo(...args) {
      moves.push(args);
    },
    lineTo(...args) {
      lines.push(args);
    },
    fill() {
      fills.push({ fillStyle: target.fillStyle, globalAlpha: target.globalAlpha });
    },
    stroke() {
      strokes.push({ strokeStyle: target.strokeStyle, lineWidth: target.lineWidth, globalAlpha: target.globalAlpha });
    },
    createLinearGradient() {
      return { addColorStop() {} };
    },
  };
  return new Proxy(target, {
    get(object, property) {
      if (property in object) return object[property];
      if (typeof property === "symbol") return undefined;
      return () => {};
    },
    set(object, property, value) {
      object[property] = value;
      return true;
    },
  });
}

function findObstacleRouteFixture(map, shipRadius = 18) {
  const obstacles = map?.obstacleRegions || [];
  const width = Number(map?.worldSize?.width) || 2160;
  const height = Number(map?.worldSize?.height) || 2160;
  for (const obstacle of obstacles) {
    const primitives = obstacle?.shape === "compound" ? obstacle.primitives || [] : [obstacle];
    for (const primitive of primitives) {
      if (primitive?.shape !== "circle" || !primitive.center || !(primitive.radius > 0)) continue;
      for (const direction of [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: Math.SQRT1_2, y: Math.SQRT1_2 }]) {
        const offset = primitive.radius + shipRadius + 110;
        const start = {
          x: primitive.center.x - direction.x * offset,
          y: primitive.center.y - direction.y * offset,
        };
        const target = {
          x: primitive.center.x + direction.x * offset,
          y: primitive.center.y + direction.y * offset,
        };
        const inBounds = [start, target].every((point) => (
          point.x >= shipRadius
          && point.y >= shipRadius
          && point.x <= width - shipRadius
          && point.y <= height - shipRadius
        ));
        if (!inBounds) continue;
        if (!positionClearOfObstacles(start, shipRadius, obstacles)) continue;
        if (!positionClearOfObstacles(target, shipRadius, obstacles)) continue;
        if (!firstObstacleHit(start, target, obstacles, shipRadius)) continue;
        return { start, target, invalidTarget: { ...primitive.center } };
      }
    }
  }
  return null;
}

function verifyControlPointPresentationState() {
  assert(
    typeof territoryPresentation.buildControlPointVisualState === "function",
    "territory presentation should expose control-point visual state",
  );
  assert(
    typeof territoryPresentation.advanceTerritoryPresentationEffects === "function",
    "territory presentation should expose deterministic effect advancement",
  );

  const neutralizing = territoryPresentation.buildControlPointVisualState({
    id: "alpha",
    ownerAllianceId: "A",
    capturingAllianceId: "B",
    captureProgress: 0.65,
    contested: false,
  });
  assert(neutralizing.status === "B 占领中 35%", `enemy neutralization progress should be readable: ${JSON.stringify(neutralizing)}`);
  assert(neutralizing.statusFontSize >= 18, `control status should remain readable under the full-map camera: ${JSON.stringify(neutralizing)}`);

  const first = territoryPresentation.advanceTerritoryPresentationEffects(null, {
    dt: 0.1,
    presentationState: {
      map: {
        controlPoints: [{ id: "alpha", ownerAllianceId: null, occupants: { A: [{ shipId: "a" }], B: [] } }],
      },
    },
    events: [],
  });
  assert(first.controls.alpha.entryStrength > 0, `entering a control point should strengthen its border: ${JSON.stringify(first)}`);

  const captured = territoryPresentation.advanceTerritoryPresentationEffects(first, {
    dt: 0.1,
    presentationState: {
      map: {
        controlPoints: [{ id: "alpha", ownerAllianceId: "A", occupants: { A: [{ shipId: "a" }], B: [] } }],
      },
    },
    events: [{ type: "control_point_owner_changed", payload: { controlPointId: "alpha", previousOwnerAllianceId: null, ownerAllianceId: "A" } }],
  });
  assert(captured.controls.alpha.captureImpact > 0, `capture completion should create an impact: ${JSON.stringify(captured)}`);

  const neutral = territoryPresentation.advanceTerritoryPresentationEffects(captured, {
    dt: 0.1,
    presentationState: {
      map: {
        controlPoints: [{ id: "alpha", ownerAllianceId: null, occupants: { A: [], B: [{ shipId: "b" }] } }],
      },
    },
    events: [{ type: "control_point_owner_changed", payload: { controlPointId: "alpha", previousOwnerAllianceId: "A", ownerAllianceId: null } }],
  });
  assert(neutral.controls.alpha.lossFade > 0, `losing control should retain a neutralizing fade: ${JSON.stringify(neutral)}`);
  assert(neutral.controls.alpha.previousOwnerAllianceId === "A", "loss fade should remember the previous owner color");

  const contestedEvent = {
    id: "control-contested-1",
    type: "control_point_contested",
    position: { x: 250, y: 210 },
    payload: { controlPointId: "alpha" },
  };
  const contested = territoryPresentation.advanceTerritoryPresentationEffects(null, {
    presentationState: {
      map: {
        controlPoints: [{
          id: "alpha",
          ownerAllianceId: null,
          contested: true,
          center: { x: 250, y: 210 },
          x: 100,
          y: 100,
          width: 300,
          height: 220,
          occupants: { A: [{ shipId: "a" }], B: [{ shipId: "b" }] },
        }],
      },
    },
    events: [contestedEvent],
  });
  assert(contested.controls.alpha.contestImpact === 1, `contested transition should create a pulse impact: ${JSON.stringify(contested.controls.alpha)}`);
  const contestedAdvanced = territoryPresentation.advanceTerritoryPresentationEffects(contested, {
    dt: 0.25,
    presentationState: {
      map: {
        controlPoints: [{
          id: "alpha",
          ownerAllianceId: null,
          contested: true,
          center: { x: 250, y: 210 },
          x: 100,
          y: 100,
          width: 300,
          height: 220,
          occupants: { A: [{ shipId: "a" }], B: [{ shipId: "b" }] },
        }],
      },
    },
    events: [contestedEvent],
  });
  assert(contestedAdvanced.controls.alpha.contestImpact < 1, "duplicate contested event ID should not restart its pulse");

  const contestedContext = createRecordingContext();
  contestedContext.roundRects = [];
  contestedContext.roundRect = (...args) => contestedContext.roundRects.push(args);
  territoryPresentation.renderTerritoryMap(contestedContext, {
    controlPoints: [{
      id: "alpha",
      label: "A",
      shape: "rect",
      ownerAllianceId: null,
      contested: true,
      captureProgress: 0,
      center: { x: 250, y: 210 },
      x: 100,
      y: 100,
      width: 300,
      height: 220,
    }],
  }, { effects: contested });
  assert(contestedContext.roundRects.some((rect) => rect[2] > 300 && rect[3] > 220), `contested transition should draw an expanded pulse: ${JSON.stringify(contestedContext.roundRects)}`);
}

function verifyTicketHudPresentationState() {
  assert(typeof territoryPresentation.buildTerritoryTicketHudState === "function", "territory presentation should expose ticket HUD state");
  assert(typeof territoryPresentation.renderTerritoryTicketHud === "function", "territory presentation should expose ticket HUD renderer");
  const presentationState = {
    elapsed: 125,
    initialTickets: 120,
    alliances: { A: { tickets: 28 }, B: { tickets: 120 } },
    ticketDrainRates: { A: 0.25, B: 0 },
    map: {
      worldSize: { width: 1200, height: 1200 },
      controlPoints: [
        { id: "alpha", label: "A", ownerAllianceId: "A", contested: false },
        { id: "beta", label: "B", ownerAllianceId: null, contested: true },
        { id: "gamma", label: "C", ownerAllianceId: "B", contested: false },
      ],
    },
    result: null,
  };
  const effects = territoryPresentation.advanceTerritoryPresentationEffects(null, {
    presentationState,
    events: [{ type: "ticket_drained", allianceId: "A", payload: { amount: 1, reason: "control_deficit" } }],
  });
  const hud = territoryPresentation.buildTerritoryTicketHudState(presentationState, effects);
  assert(hud.timeLabel === "02:05", `ticket HUD should format elapsed time: ${JSON.stringify(hud)}`);
  assert(hud.alliances.A.low && !hud.alliances.B.low, `ticket HUD should flag below 30%: ${JSON.stringify(hud)}`);
  assert(hud.alliances.A.drainLabel === "-0.25/秒", `ticket HUD should show current drain speed: ${JSON.stringify(hud)}`);
  assert(hud.controls.map((control) => `${control.label}:${control.state}`).join(",") === "A:A,B:contested,C:B", `ticket HUD should expose control ownership: ${JSON.stringify(hud)}`);
  assert(hud.alliances.A.impact.amount === 1 && hud.alliances.A.impact.reason === "控制区劣势", `ticket HUD should expose ticket loss reason: ${JSON.stringify(hud)}`);
  assert(hud.typography && Math.min(...Object.values(hud.typography)) >= 18, `primary ticket HUD text should remain readable at display scale: ${JSON.stringify(hud.typography)}`);
  assert(!hud.frozen, "running ticket HUD should not be frozen");

  const destroyedEffects = territoryPresentation.advanceTerritoryPresentationEffects(null, {
    presentationState,
    events: [{ type: "respawn_queued", allianceId: "A", payload: { ticketCost: 2 } }],
  });
  assert(destroyedEffects.tickets.A.amount === 2 && destroyedEffects.tickets.A.reason === "舰船被击毁", `ticket HUD should label ship destruction: ${JSON.stringify(destroyedEffects.tickets.A)}`);
  const wipedEffects = territoryPresentation.advanceTerritoryPresentationEffects(null, {
    presentationState,
    events: [
      { type: "respawn_queued", allianceId: "B", payload: { ticketCost: 2 } },
      { type: "fleet_wiped_ticket_penalty", allianceId: "B", payload: { amount: 3 } },
    ],
  });
  assert(wipedEffects.tickets.B.amount === 5 && wipedEffects.tickets.B.reason === "编队全灭", `ticket HUD should label and total a fleet wipe: ${JSON.stringify(wipedEffects.tickets.B)}`);

  const finished = territoryPresentation.buildTerritoryTicketHudState({
    ...presentationState,
    alliances: { ...presentationState.alliances, A: { tickets: 0 } },
    result: { finished: true, winnerAllianceId: "B", label: "B 阵营战争点数获胜" },
  }, effects);
  assert(finished.frozen && finished.alliances.A.depleted, `zero-ticket HUD should freeze in depleted state: ${JSON.stringify(finished)}`);

  const ctx = createRecordingContext();
  territoryPresentation.renderTerritoryTicketHud(ctx, presentationState, effects);
  const text = ctx.texts.join("|");
  for (const expected of ["A阵营", "28", "02:05", "-0.25/秒", "A", "B", "C", "120", "B阵营", "-1", "控制区劣势"]) {
    assert(text.includes(expected), `primary ticket HUD should render ${expected}: ${text}`);
  }
}

function verifyResourcePresentationState() {
  const warningEvent = {
    id: "resource-warning-1",
    type: "resource_warning",
    position: { x: 300, y: 420 },
    payload: {
      resourceType: "repair",
      rarity: "common",
      nodeId: "resource-node-1",
      spawnAt: 16,
    },
  };
  const warningEffects = territoryPresentation.advanceTerritoryPresentationEffects(null, {
    presentationState: { elapsed: 10 },
    events: [warningEvent],
  });
  assert(warningEffects.resources, "resource runtime events should create presentation effect state");
  const warning = warningEffects.resources?.warnings?.["resource-node-1"];
  assert(warning?.resourceType === "repair", `resource warning should preserve its type: ${JSON.stringify(warning)}`);
  assert(warning?.position?.x === 300 && warning?.position?.y === 420, `resource warning should preserve its position: ${JSON.stringify(warning)}`);
  assert(Math.abs(Number(warning?.remaining) - 6) < 1e-6, `resource warning should expose its countdown: ${JSON.stringify(warning)}`);

  const warningAdvanced = territoryPresentation.advanceTerritoryPresentationEffects(warningEffects, {
    dt: 1,
    presentationState: { elapsed: 11 },
    events: [warningEvent],
  });
  assert(Math.abs(Number(warningAdvanced.resources?.warnings?.["resource-node-1"]?.remaining) - 5) < 1e-6, "duplicate warning event ID should not restart its countdown");

  const overdueWarning = territoryPresentation.advanceTerritoryPresentationEffects(warningAdvanced, {
    presentationState: { elapsed: 17 },
    events: [],
  });
  assert(overdueWarning.resources?.warnings?.["resource-node-1"]?.remaining === 0, "blocked resource reservation should retain a zeroed warning until it spawns");

  const spawned = territoryPresentation.advanceTerritoryPresentationEffects(warningAdvanced, {
    presentationState: { elapsed: 16 },
    events: [{
      id: "resource-spawn-1",
      type: "resource_spawned",
      position: { x: 300, y: 420 },
      payload: { pickupId: "resource-1", resourceType: "repair", rarity: "common", nodeId: "resource-node-1" },
    }],
  });
  assert(!spawned.resources?.warnings?.["resource-node-1"], "resource spawn should clear its warning effect");
  assert(spawned.resources?.spawns?.["resource-1"]?.strength === 1, `resource spawn should create an impact: ${JSON.stringify(spawned.resources)}`);

  const collectionEvent = {
    id: "resource-collect-1",
    type: "resource_collected",
    position: { x: 300, y: 420 },
    allianceId: "A",
    seat: "A1",
    payload: { pickupId: "resource-1", resourceType: "repair", shipKey: "main", hullRatio: 0.18 },
  };
  const collected = territoryPresentation.advanceTerritoryPresentationEffects(spawned, {
    dt: 0.1,
    presentationState: { elapsed: 16.1 },
    snapshot: {
      fleets: { A1: { ships: { main: { id: "A1-main", alive: true, x: 350, y: 450 } } } },
    },
    events: [collectionEvent],
  });
  const collection = collected.resources?.collections?.["resource-collect-1"];
  assert(collection?.targetPosition?.x === 350 && collection?.targetPosition?.y === 450, `resource collection should attract toward the collecting ship: ${JSON.stringify(collection)}`);
  assert(collection?.labels?.includes("耐久 +18%"), `resource collection should expose recovery numbers from the event payload: ${JSON.stringify(collection)}`);
  assert(collection?.strength === 1, `resource collection should begin at full strength: ${JSON.stringify(collection)}`);

  const preciseFeedback = territoryPresentation.advanceTerritoryPresentationEffects(null, {
    presentationState: { elapsed: 18 },
    events: [{
      id: "resource-collect-precise",
      type: "resource_collected",
      position: { x: 300, y: 420 },
      allianceId: "A",
      seat: "A1",
      payload: {
        pickupId: "resource-precise",
        resourceType: "fleet_supply",
        shipKey: "main",
        hullRatio: 0.004,
        respawnSeconds: 1.25,
      },
    }],
  });
  const preciseLabels = preciseFeedback.resources?.collections?.["resource-collect-precise"]?.labels || [];
  assert(preciseLabels.includes("耐久 +0.4%"), `sub-percent recovery should retain meaningful precision: ${JSON.stringify(preciseLabels)}`);
  assert(preciseLabels.includes("复活 -1.3秒"), `fractional respawn recovery should retain meaningful precision: ${JSON.stringify(preciseLabels)}`);

  const deduped = territoryPresentation.advanceTerritoryPresentationEffects(collected, {
    dt: 0.3,
    presentationState: { elapsed: 16.4 },
    snapshot: {
      fleets: { A1: { ships: { main: { id: "A1-main", alive: true, x: 350, y: 450 } } } },
    },
    events: [collectionEvent],
  });
  assert(deduped.resources.collections["resource-collect-1"].strength < 1, "duplicate resource collection event ID should not restart its effect");

  assert(
    typeof territoryPresentation.renderTerritoryEventEffects === "function",
    "territory presentation should expose runtime event-effect rendering",
  );
  if (typeof territoryPresentation.renderTerritoryEventEffects !== "function") return;

  const warningContext = createRecordingContext();
  warningContext.arcs = [];
  warningContext.arc = (...args) => warningContext.arcs.push(args);
  territoryPresentation.renderTerritoryEventEffects(warningContext, warningEffects);
  assert(warningContext.arcs.some((arc) => arc[0] === 300 && arc[1] === 420), `resource warning should draw at its reserved position: ${JSON.stringify(warningContext.arcs)}`);
  assert(warningContext.texts.includes("6"), `resource warning should draw its countdown: ${warningContext.texts.join("|")}`);

  const spawnContext = createRecordingContext();
  spawnContext.arcs = [];
  spawnContext.arc = (...args) => spawnContext.arcs.push(args);
  territoryPresentation.renderTerritoryEventEffects(spawnContext, spawned);
  assert(spawnContext.arcs.some((arc) => arc[0] === 300 && arc[1] === 420 && arc[2] > 28), `resource spawn should draw an expanding impact: ${JSON.stringify(spawnContext.arcs)}`);

  const collectionContext = createRecordingContext();
  collectionContext.lines = [];
  collectionContext.moveTo = (...args) => collectionContext.lines.push(["move", ...args]);
  collectionContext.lineTo = (...args) => collectionContext.lines.push(["line", ...args]);
  territoryPresentation.renderTerritoryEventEffects(collectionContext, collected);
  assert(collectionContext.lines.some((line) => line[0] === "move" && line[1] === 300 && line[2] === 420), `resource collection should begin attraction at the pickup: ${JSON.stringify(collectionContext.lines)}`);
  assert(collectionContext.lines.some((line) => line[0] === "line" && line[1] === 350 && line[2] === 450), `resource collection should attract toward the collector: ${JSON.stringify(collectionContext.lines)}`);
  assert(collectionContext.texts.includes("耐久 +18%"), `resource collection should draw its recovery number: ${collectionContext.texts.join("|")}`);
}

function verifySkillEffectPresentationState() {
  const warningEvent = {
    id: "skill-warning-1",
    type: "skill_warning",
    position: { x: 720, y: 560 },
    payload: { skillId: "gravity_field", nodeId: "skill-node-1", spawnAt: 28 },
  };
  const warningEffects = territoryPresentation.advanceTerritoryPresentationEffects(null, {
    presentationState: { elapsed: 20, activeSkillEffects: [] },
    events: [warningEvent],
  });
  assert(warningEffects.skills, "skill runtime events should create presentation effect state");
  const warning = warningEffects.skills?.warnings?.["skill-node-1"];
  assert(warning?.skillId === "gravity_field" && warning?.position?.x === 720, `skill warning should preserve type and position: ${JSON.stringify(warning)}`);
  assert(Math.abs(Number(warning?.remaining) - 8) < 1e-6, `skill warning should expose its countdown: ${JSON.stringify(warning)}`);

  const overdueWarning = territoryPresentation.advanceTerritoryPresentationEffects(warningEffects, {
    presentationState: { elapsed: 29, activeSkillEffects: [] },
    events: [],
  });
  assert(overdueWarning.skills?.warnings?.["skill-node-1"]?.remaining === 0, "blocked skill reservation should retain a zeroed warning until it spawns");

  const spawned = territoryPresentation.advanceTerritoryPresentationEffects(warningEffects, {
    presentationState: { elapsed: 28, activeSkillEffects: [] },
    events: [{
      id: "skill-spawn-1",
      type: "skill_spawned",
      position: { x: 720, y: 560 },
      payload: { pickupId: "skill-1", skillId: "gravity_field", nodeId: "skill-node-1" },
    }],
  });
  assert(!spawned.skills?.warnings?.["skill-node-1"], "skill spawn should clear its warning effect");
  assert(spawned.skills?.spawns?.["skill-1"]?.strength === 1, `skill spawn should create an impact: ${JSON.stringify(spawned.skills)}`);

  const collected = territoryPresentation.advanceTerritoryPresentationEffects(spawned, {
    dt: 0.1,
    presentationState: { elapsed: 28.1, activeSkillEffects: [] },
    snapshot: {
      fleets: { A1: { ships: { main: { id: "A1-main", alive: true, x: 760, y: 590 } } } },
    },
    events: [{
      id: "skill-collect-1",
      type: "skill_collected",
      position: { x: 720, y: 560 },
      allianceId: "A",
      seat: "A1",
      payload: { pickupId: "skill-1", skillId: "gravity_field", nodeId: "skill-node-1", shipKey: "main" },
    }],
  });
  const collection = collected.skills?.collections?.["skill-collect-1"];
  assert(collection?.targetPosition?.x === 760 && collection?.targetPosition?.y === 590, `skill collection should attract toward its collector: ${JSON.stringify(collection)}`);
  assert(collection?.strength === 1, `skill collection should begin at full strength: ${JSON.stringify(collection)}`);

  const activeState = {
    elapsed: 30,
    activeSkillEffects: [{
      id: "skill-effect-1",
      skillId: "gravity_field",
      allianceId: "A",
      seat: "A1",
      targetSeat: null,
      position: { x: 800, y: 620 },
      startedAt: 30,
      duration: 9,
      endsAt: 39,
      payload: { radius: 170 },
    }],
  };
  const usedEvent = {
    id: "skill-used-1",
    type: "skill_used",
    position: { x: 800, y: 620 },
    allianceId: "A",
    seat: "A1",
    payload: { skillId: "gravity_field", targetType: "point", effectId: "skill-effect-1" },
  };
  const used = territoryPresentation.advanceTerritoryPresentationEffects(collected, {
    presentationState: activeState,
    events: [usedEvent],
  });
  assert(used.skills?.uses?.["skill-used-1"]?.strength === 1, `skill use should create a release impact: ${JSON.stringify(used.skills)}`);
  assert(used.skills?.active?.["skill-effect-1"]?.remaining === 9, `active skill should expose authoritative remaining time: ${JSON.stringify(used.skills?.active)}`);
  assert(used.skills?.active?.["skill-effect-1"]?.radius === 170, "gravity field active effect should expose its authoritative radius");

  const allianceSnapshot = {
    alliances: { A: { fleetSeats: ["A1", "A2", "A3"] }, B: { fleetSeats: ["B1"] } },
    fleets: {
      A1: { ships: { main: { alive: true, x: 200, y: 1000 } } },
      A2: { ships: { main: { alive: true, x: 280, y: 1040 } } },
      A3: { ships: { main: { alive: true, x: 360, y: 1080 } } },
      B1: { ships: { main: { alive: true, x: 1200, y: 300 } } },
    },
  };
  let allianceWide = null;
  for (const skillId of ["all_fleet_shield", "propulsion_overload", "firepower_overload"]) {
    const effectId = `skill-effect-${skillId}`;
    const current = territoryPresentation.advanceTerritoryPresentationEffects(null, {
      presentationState: {
        elapsed: 30,
        activeSkillEffects: [{
          id: effectId,
          skillId,
          allianceId: "A",
          seat: "A1",
          targetSeat: null,
          position: null,
          duration: 8,
          endsAt: 38,
          payload: {},
        }],
      },
      snapshot: allianceSnapshot,
      events: [],
    });
    const allianceVisuals = Object.values(current.skills?.active || {}).filter((effect) => effect.effectId === effectId);
    assert(allianceVisuals.length === 3, `${skillId} should expose one persistent visual per allied fleet: ${JSON.stringify(current.skills?.active)}`);
    assert(new Set(allianceVisuals.map((effect) => `${effect.position?.x}:${effect.position?.y}`)).size === 3, `${skillId} visuals should use distinct allied fleet anchors`);
    if (skillId === "all_fleet_shield") allianceWide = current;
  }

  const allianceContext = createRecordingContext();
  allianceContext.arcs = [];
  allianceContext.arc = (...args) => allianceContext.arcs.push(args);
  territoryPresentation.renderTerritoryEventEffects(allianceContext, allianceWide);
  for (const [x, y] of [[200, 1000], [280, 1040], [360, 1080]]) {
    assert(allianceContext.arcs.some((arc) => arc[0] === x && arc[1] === y), `alliance-wide renderer should draw at ${x}:${y}: ${JSON.stringify(allianceContext.arcs)}`);
  }

  const allianceEnded = territoryPresentation.advanceTerritoryPresentationEffects(allianceWide, {
    presentationState: { elapsed: 38, activeSkillEffects: [] },
    snapshot: allianceSnapshot,
    events: [{
      id: "skill-ended-alliance",
      type: "skill_effect_ended",
      allianceId: "A",
      seat: "A1",
      payload: { effectId: "skill-effect-all_fleet_shield", skillId: "all_fleet_shield" },
    }],
  });
  const allianceEndings = Object.values(allianceEnded.skills?.endings || {}).filter((effect) => effect.effectId === "skill-effect-all_fleet_shield");
  assert(allianceEndings.length === 3, `alliance-wide skill should end at every prior allied fleet anchor: ${JSON.stringify(allianceEnded.skills?.endings)}`);
  assert(new Set(allianceEndings.map((effect) => `${effect.position?.x}:${effect.position?.y}`)).size === 3, "alliance-wide endings should retain distinct allied fleet anchors");

  const allianceEndingContext = createRecordingContext();
  allianceEndingContext.arcs = [];
  allianceEndingContext.arc = (...args) => allianceEndingContext.arcs.push(args);
  territoryPresentation.renderTerritoryEventEffects(allianceEndingContext, allianceEnded);
  for (const [x, y] of [[200, 1000], [280, 1040], [360, 1080]]) {
    assert(allianceEndingContext.arcs.some((arc) => arc[0] === x && arc[1] === y), `alliance-wide ending renderer should draw at ${x}:${y}: ${JSON.stringify(allianceEndingContext.arcs)}`);
  }

  const activeAdvanced = territoryPresentation.advanceTerritoryPresentationEffects(used, {
    dt: 0.3,
    presentationState: { ...activeState, elapsed: 31 },
    events: [usedEvent],
  });
  assert(activeAdvanced.skills.active["skill-effect-1"].remaining === 8, "active skill remaining time should follow presentation elapsed");
  assert(activeAdvanced.skills.uses["skill-used-1"].strength < 1, "duplicate skill-used event ID should not restart its release effect");

  const ended = territoryPresentation.advanceTerritoryPresentationEffects(activeAdvanced, {
    presentationState: { elapsed: 39, activeSkillEffects: [] },
    events: [{
      id: "skill-ended-1",
      type: "skill_effect_ended",
      position: { x: 800, y: 620 },
      allianceId: "A",
      seat: "A1",
      payload: { effectId: "skill-effect-1", skillId: "gravity_field" },
    }],
  });
  assert(!ended.skills?.active?.["skill-effect-1"], "ended skill should leave active presentation state");
  assert(ended.skills?.endings?.["skill-ended-1"]?.strength === 1, `skill end should create an ending impact: ${JSON.stringify(ended.skills)}`);

  const warningContext = createRecordingContext();
  warningContext.arcs = [];
  warningContext.arc = (...args) => warningContext.arcs.push(args);
  territoryPresentation.renderTerritoryEventEffects(warningContext, warningEffects);
  assert(warningContext.arcs.some((arc) => arc[0] === 720 && arc[1] === 560), `skill warning should draw at its reserved position: ${JSON.stringify(warningContext.arcs)}`);
  assert(warningContext.texts.includes("8"), `skill warning should draw its countdown: ${warningContext.texts.join("|")}`);

  const spawnContext = createRecordingContext();
  spawnContext.arcs = [];
  spawnContext.arc = (...args) => spawnContext.arcs.push(args);
  territoryPresentation.renderTerritoryEventEffects(spawnContext, spawned);
  assert(spawnContext.arcs.some((arc) => arc[0] === 720 && arc[1] === 560 && arc[2] > 28), `skill spawn should draw an expanding impact: ${JSON.stringify(spawnContext.arcs)}`);

  const collectionContext = createRecordingContext();
  collectionContext.lines = [];
  collectionContext.moveTo = (...args) => collectionContext.lines.push(["move", ...args]);
  collectionContext.lineTo = (...args) => collectionContext.lines.push(["line", ...args]);
  territoryPresentation.renderTerritoryEventEffects(collectionContext, collected);
  assert(collectionContext.lines.some((line) => line[0] === "line" && line[1] === 760 && line[2] === 590), `skill collection should attract toward the collector: ${JSON.stringify(collectionContext.lines)}`);
  assert(collectionContext.texts.includes("引力场"), `skill collection should identify the collected skill: ${collectionContext.texts.join("|")}`);

  const activeContext = createRecordingContext();
  activeContext.arcs = [];
  activeContext.arc = (...args) => activeContext.arcs.push(args);
  territoryPresentation.renderTerritoryEventEffects(activeContext, {
    ...used,
    resources: { warnings: {}, spawns: {}, collections: {} },
    skills: { ...used.skills, warnings: {}, spawns: {}, collections: {} },
  });
  assert(activeContext.arcs.some((arc) => arc[0] === 800 && arc[1] === 620 && arc[2] === 170), `gravity field should draw its active radius: ${JSON.stringify(activeContext.arcs)}`);
  assert(activeContext.arcs.some((arc) => arc[0] === 800 && arc[1] === 620 && arc[2] < 80), `skill use should draw a release burst: ${JSON.stringify(activeContext.arcs)}`);
  assert(activeContext.texts.some((text) => text.includes("引力场")), `active skill should identify itself in the world: ${activeContext.texts.join("|")}`);

  const endingContext = createRecordingContext();
  endingContext.arcs = [];
  endingContext.arc = (...args) => endingContext.arcs.push(args);
  territoryPresentation.renderTerritoryEventEffects(endingContext, ended);
  assert(endingContext.arcs.some((arc) => arc[0] === 800 && arc[1] === 620), `skill ending should collapse at the effect position: ${JSON.stringify(endingContext.arcs)}`);
}

function verifyTacticalSkillPresentationState() {
  assert(
    typeof territoryPresentation.buildTerritoryTacticalHudState === "function",
    "territory presentation should expose tactical HUD state",
  );
  if (typeof territoryPresentation.buildTerritoryTacticalHudState !== "function") return;
  const baseState = {
    alliances: { A: { skillSlot: null }, B: { skillSlot: null } },
  };
  const options = { allianceId: "A", hotkey: "X", fleetSeats: ["A1", "A2", "A3"] };
  const empty = territoryPresentation.buildTerritoryTacticalHudState(baseState, options);
  assert(empty.empty && empty.hotkey === "X", `empty tactical HUD should identify the shortcut: ${JSON.stringify(empty)}`);
  assert(empty.label === "战术技能：空", `empty tactical HUD label missing: ${JSON.stringify(empty)}`);

  const expectedTargets = new Map(ALLOWED_TACTICAL_SKILLS.map((skill) => [skill.id, skill.targetType]));
  for (const skill of ALLOWED_TACTICAL_SKILLS) {
    const model = territoryPresentation.buildTerritoryTacticalHudState({
      alliances: { A: { skillSlot: { skillId: skill.id, acquiredAt: 0 } } },
    }, options);
    assert(!model.empty && model.skillId === skill.id, `tactical HUD should expose ${skill.id}: ${JSON.stringify(model)}`);
    assert(model.name === skill.name && model.description === skill.description, `tactical HUD should use authoritative metadata for ${skill.id}`);
    assert(model.targetType === expectedTargets.get(skill.id), `tactical HUD target type mismatch for ${skill.id}`);
    assert(model.hotkey === "X" && model.icon && model.targetLabel, `tactical HUD affordances missing for ${skill.id}: ${JSON.stringify(model)}`);
    if (skill.targetType === "fleet") {
      assert(model.fleetTargets.join(",") === "A1,A2,A3", `fleet target buttons missing: ${JSON.stringify(model)}`);
    }
  }

  assert(
    typeof territoryPresentation.buildTerritoryTacticalAimState === "function",
    "territory presentation should expose tactical point-aim state",
  );
  assert(
    typeof territoryPresentation.renderTerritoryTacticalAim === "function",
    "territory presentation should expose tactical point-aim rendering",
  );
  if (
    typeof territoryPresentation.buildTerritoryTacticalAimState !== "function"
    || typeof territoryPresentation.renderTerritoryTacticalAim !== "function"
  ) return;

  const warp = territoryPresentation.buildTerritoryTacticalAimState({
    skillId: "short_warp",
    source: { x: 100, y: 100 },
    point: { x: 340, y: 100 },
    worldSize: { width: 1200, height: 1200 },
  });
  assert(warp.active && warp.legal, `in-range short warp should be legal: ${JSON.stringify(warp)}`);
  assert(warp.maxDistance === 260 && warp.distance === 240, `short warp range model mismatch: ${JSON.stringify(warp)}`);
  const distantWarp = territoryPresentation.buildTerritoryTacticalAimState({
    skillId: "short_warp",
    source: { x: 100, y: 100 },
    point: { x: 370, y: 100 },
    worldSize: { width: 1200, height: 1200 },
  });
  assert(!distantWarp.legal && distantWarp.invalidReason === "range", `out-of-range warp should be illegal: ${JSON.stringify(distantWarp)}`);
  const gravity = territoryPresentation.buildTerritoryTacticalAimState({
    skillId: "gravity_field",
    source: { x: 100, y: 100 },
    point: { x: 600, y: 400 },
    worldSize: { width: 1200, height: 1200 },
  });
  assert(gravity.legal && gravity.radius === 170, `gravity aim should expose its landing radius: ${JSON.stringify(gravity)}`);
  const outsideWorld = territoryPresentation.buildTerritoryTacticalAimState({
    skillId: "gravity_field",
    source: { x: 100, y: 100 },
    point: { x: -1, y: 400 },
    worldSize: { width: 1200, height: 1200 },
  });
  assert(!outsideWorld.legal && outsideWorld.invalidReason === "bounds", `outside-world point should be illegal: ${JSON.stringify(outsideWorld)}`);

  const aimContext = createRecordingContext();
  aimContext.arcs = [];
  aimContext.arc = (...args) => aimContext.arcs.push(args);
  territoryPresentation.renderTerritoryTacticalAim(aimContext, warp);
  assert(aimContext.arcs.some((arc) => arc[2] === 260), `warp overlay should render maximum range: ${JSON.stringify(aimContext.arcs)}`);
  assert(aimContext.arcs.some((arc) => arc[0] === 340 && arc[1] === 100), `warp overlay should render target landing point: ${JSON.stringify(aimContext.arcs)}`);
}

function verifyRespawnPresentationState() {
  assert(
    typeof territoryPresentation.renderTerritoryRespawnEffects === "function",
    "territory presentation should expose respawn effect rendering",
  );
  const queuedState = {
    respawnQueue: [{
      seat: "A1",
      shipKey: "main",
      remaining: 2.4,
      total: 24,
      spawnPosition: { x: 240, y: 960 },
    }],
  };
  const queuedSnapshot = {
    fleets: { A1: { ships: { main: { id: "A1-main", alive: false, x: 240, y: 960, radius: 18, spawnProtectionRemaining: 0 } } } },
  };
  const preheat = territoryPresentation.advanceTerritoryPresentationEffects(null, {
    dt: 0.1,
    presentationState: queuedState,
    snapshot: queuedSnapshot,
    events: [],
  });
  const preheatEffect = preheat.respawns?.["A1:main"];
  assert(preheatEffect?.phase === "preheat" && preheatEffect.preheat > 0, `last-three-second preheat missing: ${JSON.stringify(preheatEffect)}`);
  assert(preheatEffect.position.x === 240 && preheatEffect.position.y === 960, `preheat should use reserved spawn position: ${JSON.stringify(preheatEffect)}`);

  const respawnEvent = {
    id: "respawn-event-1",
    type: "ship_respawned",
    position: { x: 240, y: 960 },
    seat: "A1",
    payload: { shipKey: "main" },
  };
  const protectedSnapshot = {
    fleets: { A1: { ships: { main: { id: "A1-main", alive: true, x: 240, y: 960, radius: 18, spawnProtectionRemaining: 3 } } } },
  };
  const materialized = territoryPresentation.advanceTerritoryPresentationEffects(preheat, {
    dt: 0.1,
    presentationState: { respawnQueue: [] },
    snapshot: protectedSnapshot,
    events: [respawnEvent],
  });
  const materializeEffect = materialized.respawns?.["A1:main"];
  assert(materializeEffect?.materialize === 1 && materializeEffect.shockwave === 1, `respawn materialize/shockwave missing: ${JSON.stringify(materializeEffect)}`);
  assert(materialized.protections?.["A1-main"]?.shield === 1, `respawn shield missing: ${JSON.stringify(materialized.protections)}`);

  const deduped = territoryPresentation.advanceTerritoryPresentationEffects(materialized, {
    dt: 0.4,
    presentationState: { respawnQueue: [] },
    snapshot: protectedSnapshot,
    events: [respawnEvent],
  });
  assert(deduped.respawns["A1:main"].materialize < 1, "duplicate respawn event ID should not restart materialization");

  const restartedEffects = territoryPresentation.advanceTerritoryPresentationEffects(deduped, {
    reset: true,
    dt: 0.1,
    presentationState: { respawnQueue: [] },
    snapshot: protectedSnapshot,
    events: [respawnEvent],
  });
  assert(restartedEffects.respawns["A1:main"].materialize === 1, "restart should clear event dedupe so a reused respawn event ID materializes again");

  const broken = territoryPresentation.advanceTerritoryPresentationEffects(deduped, {
    dt: 0.1,
    presentationState: { respawnQueue: [] },
    snapshot: {
      fleets: { A1: { ships: { main: { id: "A1-main", alive: true, x: 240, y: 960, radius: 18, spawnProtectionRemaining: 0 } } } },
    },
    events: [],
  });
  assert(broken.protections["A1-main"].shield === 0 && broken.protections["A1-main"].breakStrength === 1, `shield break missing: ${JSON.stringify(broken.protections)}`);

  if (typeof territoryPresentation.renderTerritoryRespawnEffects !== "function") return;
  const respawnContext = createRecordingContext();
  respawnContext.arcs = [];
  respawnContext.arc = (...args) => respawnContext.arcs.push(args);
  territoryPresentation.renderTerritoryRespawnEffects(respawnContext, materialized);
  assert(respawnContext.arcs.length >= 2, `respawn materialize/shield renderer should draw world effects: ${JSON.stringify(respawnContext.arcs)}`);
}

function verifyTerrainPresentationState() {
  assert(typeof territoryPresentation.buildTerrainVisualState === "function", "territory presentation should expose terrain visual state");
  assert(typeof territoryPresentation.buildTerritoryMinimapState === "function", "territory presentation should expose minimap state");
  assert(typeof territoryPresentation.renderTerritoryMap === "function", "territory presentation should expose terrain map rendering");
  assert(typeof territoryPresentation.renderTerritoryMinimapOverlay === "function", "territory presentation should expose minimap overlay rendering");

  const asteroid = territoryPresentation.buildTerrainVisualState({ id: "asteroid", type: "asteroid_belt", shape: "circle", center: { x: 300, y: 300 }, radius: 90 });
  const lane = territoryPresentation.buildTerrainVisualState({ id: "lane", type: "speed_lane", shape: "capsule", center: { x: 700, y: 700 }, length: 380, width: 90, angle: 0 });
  const gravity = territoryPresentation.buildTerrainVisualState({ id: "gravity", type: "gravity_mire", shape: "circle", center: { x: 1050, y: 1050 }, radius: 100 });
  assert(asteroid.kind === "asteroid" && asteroid.fragmentCount >= 14 && asteroid.label === "小行星带" && asteroid.detail === "航速降低", `asteroid visual incomplete: ${JSON.stringify(asteroid)}`);
  assert(lane.kind === "lane" && lane.arrowCount >= 5 && lane.label === "高速航道" && lane.detail === "顺向加速", `speed lane visual incomplete: ${JSON.stringify(lane)}`);
  assert(gravity.kind === "gravity" && gravity.rippleCount >= 3 && gravity.label === "引力泥沼" && gravity.detail === "航速与转向降低", `gravity visual incomplete: ${JSON.stringify(gravity)}`);

  const presentationState = {
    elapsed: 3,
    map: {
      worldSize: { width: 1440, height: 1440 },
      laneCorridors: [{ id: "lane-top", path: [{ x: 100, y: 300 }, { x: 1300, y: 300 }], width: 180 }],
      connectorCorridors: [{ id: "connector-upper", path: [{ x: 500, y: 300 }, { x: 900, y: 700 }], width: 120 }],
      obstacleRegions: [{ id: "obstacle-mid", shape: "circle", center: { x: 700, y: 700 }, radius: 90 }],
      navigationGraph: {
        nodes: [{ id: "nav-a", center: { x: 500, y: 300 } }, { id: "nav-b", center: { x: 900, y: 700 } }],
        edges: [{ id: "nav-a-b", from: "nav-a", to: "nav-b" }],
      },
      terrainRegions: [asteroid.region, lane.region, gravity.region],
      controlPoints: [{ id: "alpha", label: "A", ownerAllianceId: "A", center: { x: 500, y: 500 }, x: 450, y: 450, width: 100, height: 100 }],
      spawnAreas: [{ id: "spawn-A", allianceId: "A", center: { x: 120, y: 120 }, radius: 80 }],
      resourceSpawnNodes: [{ id: "resource-node", center: { x: 400, y: 400 }, rarity: "common" }],
      skillSpawnNodes: [{ id: "skill-node", center: { x: 800, y: 800 } }],
    },
    pickups: [{ id: "resource", position: { x: 420, y: 420 }, resourceType: "repair" }],
    skillPickups: [{ id: "skill", position: { x: 820, y: 820 }, skillId: "gravity_field" }],
  };
  const effects = territoryPresentation.advanceTerritoryPresentationEffects(null, {
    presentationState,
    events: [{ type: "terrain_entered", position: { x: 300, y: 300 }, payload: { terrainId: "asteroid", terrainType: "asteroid_belt" } }],
  });
  assert(effects.terrain.asteroid.disturbanceStrength > 0, `asteroid entry should disturb fragments: ${JSON.stringify(effects.terrain)}`);
  const navigationEffects = territoryPresentation.advanceTerritoryPresentationEffects(null, {
    presentationState,
    events: [
      { id: "nav-invalid", type: "invalid_route_target", payload: { target: { x: 700, y: 700 } } },
      { id: "nav-replanned", type: "navigation_replanned", seat: "B1", position: { x: 500, y: 300 }, payload: { shipKey: "main", entityId: "B1-main" } },
      { id: "nav-stuck", type: "navigation_stuck", position: { x: 900, y: 700 } },
      { id: "obstacle-collision", type: "obstacle_collision", position: { x: 640, y: 640 } },
    ],
  });
  assert(
    navigationEffects.navigationFeedback?.length === 4
      && navigationEffects.navigationFeedback.some((feedback) => feedback.kind === "invalid" && feedback.position.x === 700)
      && navigationEffects.navigationFeedback.some((feedback) => feedback.kind === "replanned" && feedback.seat === "B1" && feedback.entityId === "B1-main")
      && navigationEffects.navigationFeedback.some((feedback) => feedback.kind === "stuck")
      && navigationEffects.navigationFeedback.some((feedback) => feedback.kind === "collision" && feedback.position.x === 640),
    `navigation events should create bounded visual feedback: ${JSON.stringify(navigationEffects.navigationFeedback)}`,
  );
  const navigationFeedbackContext = createRecordingContext();
  territoryPresentation.renderTerritoryEventEffects(navigationFeedbackContext, navigationEffects);
  assert(
    navigationFeedbackContext.strokes.some((stroke) => stroke.strokeStyle === "#ff5f6d")
      && navigationFeedbackContext.strokes.some((stroke) => stroke.strokeStyle === "#ff9f6e"),
    `invalid targets and obstacle contacts should render distinct feedback: ${JSON.stringify(navigationFeedbackContext.strokes)}`,
  );
  const hiddenFeedbackContext = createRecordingContext();
  territoryPresentation.renderTerritoryEventEffects(hiddenFeedbackContext, navigationEffects, {
    isNavigationFeedbackVisible: (feedback) => feedback.seat !== "B1",
  });
  assert(
    !hiddenFeedbackContext.strokes.some((stroke) => stroke.strokeStyle === "#69d8ff"),
    `hidden enemy navigation feedback must not be rendered: ${JSON.stringify(hiddenFeedbackContext.strokes)}`,
  );
  const expiredNavigationEffects = territoryPresentation.advanceTerritoryPresentationEffects(navigationEffects, {
    dt: 3,
    presentationState,
    events: [],
  });
  assert(expiredNavigationEffects.navigationFeedback.length === 0, "navigation visual feedback should expire after a bounded duration");
  const localFeedbackSurvivesHiddenFlood = territoryPresentation.advanceTerritoryPresentationEffects(null, {
    presentationState,
    isNavigationFeedbackVisible: (event) => event.seat !== "B1",
    events: [
      { id: "local-invalid", type: "invalid_route_target", seat: "A1", payload: { target: { x: 280, y: 280 } } },
      ...Array.from({ length: 16 }, (_, index) => ({
        id: `hidden-collision-${index}`,
        type: "obstacle_collision",
        seat: "B1",
        position: { x: 500 + index, y: 500 },
        payload: { entityId: `B1-${index}`, shipKey: "main" },
      })),
    ],
  });
  assert(
    localFeedbackSurvivesHiddenFlood.navigationFeedback.length === 1
      && localFeedbackSurvivesHiddenFlood.navigationFeedback[0].kind === "invalid",
    `hidden enemy feedback must not evict local feedback from the bounded buffer: ${JSON.stringify(localFeedbackSurvivesHiddenFlood.navigationFeedback)}`,
  );
  const minimap = territoryPresentation.buildTerritoryMinimapState(presentationState);
  assert(minimap.terrain.length === 3 && minimap.controls.length === 1 && minimap.spawns.length === 1, `minimap strategic geometry missing: ${JSON.stringify(minimap)}`);
  assert(
    minimap.lanes?.length === 1
      && minimap.connectors?.length === 1
      && minimap.obstacles?.length === 1
      && minimap.navigationGraph?.nodes?.length === 2,
    `V2 minimap strategic arrays missing: ${JSON.stringify(minimap)}`,
  );
  assert(minimap.resources.length >= 2 && minimap.skills.length >= 1, `minimap pickups/nodes missing: ${JSON.stringify(minimap)}`);
  const minimapTopologyContext = createRecordingContext();
  territoryPresentation.renderTerritoryMinimapOverlay(minimapTopologyContext, presentationState, {
    rect: { x: 900, y: 900, width: 260, height: 260 },
  });
  assert(
    minimapTopologyContext.strokes.some((stroke) => stroke.strokeStyle === "rgba(111, 198, 207, 0.65)")
      && minimapTopologyContext.strokes.some((stroke) => stroke.strokeStyle === "rgba(189, 153, 207, 0.65)"),
    `minimap should draw lane and connector topology: ${JSON.stringify(minimapTopologyContext.strokes)}`,
  );
  assert(
    minimapTopologyContext.fills.some((fill) => fill.fillStyle === "rgba(37, 43, 50, 0.9)"),
    `minimap should draw obstacle fills: ${JSON.stringify(minimapTopologyContext.fills)}`,
  );

  const ctx = createRecordingContext();
  territoryPresentation.renderTerritoryMap(ctx, presentationState.map, { showTerrainDebug: false, effects });
  const labels = ctx.texts.join("|");
  for (const expected of ["小行星带", "航速降低", "高速航道", "顺向加速", "引力泥沼", "航速与转向降低"]) {
    assert(labels.includes(expected), `formal terrain should render with debug bounds disabled: ${labels}`);
  }
  const topologyContext = createRecordingContext();
  territoryPresentation.renderTerritoryMap(topologyContext, {
    laneCorridors: presentationState.map.laneCorridors,
    connectorCorridors: presentationState.map.connectorCorridors,
    obstacleRegions: [{
      id: "compound-obstacle",
      shape: "compound",
      primitives: [
        { shape: "circle", center: { x: 700, y: 700 }, radius: 90 },
        { shape: "polygon", points: [{ x: 760, y: 640 }, { x: 850, y: 700 }, { x: 760, y: 760 }] },
      ],
    }],
    terrainRegions: [],
    spawnAreas: [],
    controlPoints: [],
    resourceSpawnNodes: [],
    skillSpawnNodes: [],
  }, {
    localSeat: "A1",
    navigationPlans: {
      "A1:main": {
        seat: "A1",
        start: { x: 120, y: 120 },
        waypoints: [{ x: 500, y: 300, nodeId: "nav-a" }, { x: 900, y: 700, nodeId: null }],
      },
      "B1:main": {
        seat: "B1",
        start: { x: 1300, y: 1300 },
        waypoints: [{ x: 1000, y: 1000, nodeId: null }],
      },
    },
  });
  assert(topologyContext.arcs.length >= 1, `compound obstacle circles should render: ${JSON.stringify(topologyContext.arcs)}`);
  assert(topologyContext.lines.length >= 4, `lanes, connectors, obstacles, and local routes should render connected paths: ${JSON.stringify(topologyContext.lines)}`);
  assert(topologyContext.fills.length >= 1 && topologyContext.strokes.length >= 4, "V2 topology should render filled obstacles and stroked paths");

  const compoundTerrain = {
    id: "compound-gravity",
    type: "gravity_mire",
    shape: "compound",
    center: { x: 700, y: 300 },
    radius: 260,
    fields: [
      { x: 620, y: 280, radius: 160, coreRadius: 60 },
      { x: 770, y: 290, radius: 150, coreRadius: 58 },
      { x: 700, y: 400, radius: 145, coreRadius: 54 },
    ],
  };
  const compoundTerrainContext = createRecordingContext();
  territoryPresentation.renderTerritoryMap(compoundTerrainContext, {
    terrainRegions: [compoundTerrain],
    spawnAreas: [],
    controlPoints: [],
    resourceSpawnNodes: [],
    skillSpawnNodes: [],
  });
  assert(
    compoundTerrain.fields.every((field) => compoundTerrainContext.arcs.some(([x, y]) => x === field.x && y === field.y)),
    `compound terrain should render each intensity field: ${JSON.stringify(compoundTerrainContext.arcs)}`,
  );
  assert(
    compoundTerrain.fields.every((field) => (
      compoundTerrainContext.arcs.some(([x, y, radius]) => x === field.x && y === field.y && radius === field.coreRadius)
    )),
    `compound gravity core radius should match the shared intensity core: ${JSON.stringify(compoundTerrainContext.arcs)}`,
  );
  assert(
    compoundTerrainContext.textPositions.every((entry) => entry.y > compoundTerrain.center.y + compoundTerrain.radius),
    `top-edge compound captions should render below the terrain envelope: ${JSON.stringify(compoundTerrainContext.textPositions)}`,
  );
}

function verifyGraphRouteHandleAuthority() {
  const route = {
    p0: { x: 100, y: 100 },
    p1: { x: 200, y: 220 },
    p2: { x: 320, y: 300 },
  };
  assert(routeHandleAtPoint(route, 200, 220) === "control", "direct routes should retain control-handle editing");
  assert(
    routeHandleAtPoint(route, 200, 220, { allowControl: false }) === null,
    "graph routes should suppress manual Bezier control editing",
  );
  assert(
    routeHandleAtPoint(route, 320, 300, { allowControl: false }) === "end",
    "graph routes should retain endpoint dragging for replanning",
  );
}

function verifyGraphRouteControlKnobSuppression() {
  const graphRoute = {
    p0: { x: 100, y: 100 },
    p1: { x: 220, y: 180 },
    p2: { x: 360, y: 120 },
    t: 0,
  };
  const ship = {
    id: "A1-main",
    key: "main",
    alive: true,
    canControl: true,
    x: graphRoute.p0.x,
    y: graphRoute.p0.y,
    angle: 0,
    radius: 18,
    hull: 100,
    maxHull: 100,
    energy: 100,
    maxEnergy: 100,
    route: graphRoute,
  };
  const team = { seat: "A1", allianceId: "A", color: "#69d8ff", ships: { main: ship } };
  const context = createRecordingContext();
  drawBattleWorld(context, {
    state: { elapsed: 0, fleets: { A1: team }, projectiles: [], bursts: [], floatingTexts: [] },
    ownTeam: team,
    enemyTeam: null,
    friendlyTeams: [team],
    enemyTeams: [],
    selectedKeyForTeam: (candidate) => (candidate === team ? "main" : null),
    routeControlKnobVisibleForShip: () => false,
    worldSize: { width: 1440, height: 1440 },
    stars: [],
  });
  assert(
    !context.arcs.some(([x, y]) => x === graphRoute.p1.x && y === graphRoute.p1.y),
    "graph navigation routes should not render the generic Bezier control knob",
  );
}

async function eventually(fn, timeoutMs = 12000, intervalMs = 50) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await wait(intervalMs);
  }
  if (lastError) throw lastError;
  throw new Error("Timed out waiting for condition");
}

function worldPointToCanvasCss(point, inspection, canvasBox) {
  const camera = inspection?.camera;
  assert(camera && canvasBox, "world-point projection requires camera and Canvas bounds");
  return {
    x: ((point.x - (camera.centerX - camera.width / 2)) * camera.zoom / 1440) * canvasBox.width,
    y: ((point.y - (camera.centerY - camera.height / 2)) * camera.zoom / 1440) * canvasBox.height,
  };
}

async function sampleRedWorldPixels(page, point) {
  return page.evaluate((worldPoint) => {
    const surface = document.querySelector("#gameCanvas");
    const inspection = window.__TDOS_PROTOTYPE_INSPECT__?.();
    const camera = inspection?.camera;
    if (!surface || !camera) return { red: 0, maxRed: 0, maxGreen: 0, maxBlue: 0 };
    const scale = surface.width / 1440;
    const centerX = (worldPoint.x - (camera.centerX - camera.width / 2)) * camera.zoom * scale;
    const centerY = (worldPoint.y - (camera.centerY - camera.height / 2)) * camera.zoom * scale;
    const radius = Math.max(8, Math.ceil(26 * camera.zoom * scale));
    const left = Math.max(0, Math.floor(centerX - radius));
    const top = Math.max(0, Math.floor(centerY - radius));
    const right = Math.min(surface.width, Math.ceil(centerX + radius));
    const bottom = Math.min(surface.height, Math.ceil(centerY + radius));
    const data = surface.getContext("2d").getImageData(left, top, Math.max(1, right - left), Math.max(1, bottom - top)).data;
    let red = 0;
    let maxRed = 0;
    let maxGreen = 0;
    let maxBlue = 0;
    for (let index = 0; index < data.length; index += 4) {
      maxRed = Math.max(maxRed, data[index]);
      maxGreen = Math.max(maxGreen, data[index + 1]);
      maxBlue = Math.max(maxBlue, data[index + 2]);
      if (data[index] > 100 && data[index] > data[index + 1] * 1.3 && data[index] > data[index + 2] * 1.08) red += 1;
    }
    return { red, maxRed, maxGreen, maxBlue, left, top, right, bottom };
  }, point);
}

function startVite() {
  const child = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(VITE_PORT)], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += String(chunk);
  });
  child.output = () => output;
  return child;
}

async function waitForHttp(url) {
  await eventually(async () => {
    const response = await fetch(url, { method: "GET" }).catch(() => null);
    return Boolean(response && response.ok);
  }, 15000);
}

async function sampleTicketHudPixels(page) {
  return page.locator("#gameCanvas").evaluate((canvas) => {
    const ctx = canvas.getContext("2d");
    const scale = canvas.width / 1440;
    const left = Math.floor(330 * scale);
    const top = Math.floor(18 * scale);
    const width = Math.floor(780 * scale);
    const height = Math.floor(150 * scale);
    const data = ctx.getImageData(left, top, width, height).data;
    let cyan = 0;
    let coral = 0;
    let bright = 0;
    let opaque = 0;
    let maxRed = 0;
    let maxGreen = 0;
    let maxBlue = 0;
    for (let index = 0; index < data.length; index += 4) {
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      if (data[index + 3] > 0) opaque += 1;
      maxRed = Math.max(maxRed, red);
      maxGreen = Math.max(maxGreen, green);
      maxBlue = Math.max(maxBlue, blue);
      if (red < 155 && green > 145 && blue > 185) cyan += 1;
      if (red > 185 && green < 175 && blue < 190) coral += 1;
      if (red > 190 && green > 190 && blue > 190) bright += 1;
    }
    return {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      sample: { left, top, width, height },
      opaque,
      maxRed,
      maxGreen,
      maxBlue,
      cyan,
      coral,
      bright,
    };
  });
}

async function main() {
  verifyControlPointPresentationState();
  verifyTicketHudPresentationState();
  verifyResourcePresentationState();
  verifySkillEffectPresentationState();
  verifyTacticalSkillPresentationState();
  verifyRespawnPresentationState();
  verifyTerrainPresentationState();
  verifyGraphRouteHandleAuthority();
  verifyGraphRouteControlKnobSuppression();
  const vite = startVite();
  let browser = null;
  try {
    await waitForHttp(APP_URL);
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(String(error?.message || error)));
    await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#protoModeSelect", { timeout: 10000 });
    await page.selectOption("#protoModeSelect", "stellar-territory");
    await page.click("#protoApplyModeBtn");
    await page.waitForSelector("#protoModeHud", { timeout: 10000 });

    await eventually(async () => {
      const rows = await page.locator("#protoModeHud .territory-hud > div").count();
      const tools = await page.locator("#protoModeTools .territory-tools").count();
      return rows >= 6 && tools === 1;
    }, 8000);

    const renderedParameterKeys = await page.locator("#protoModeParams [data-param-key]").evaluateAll((fields) => fields.map((field) => field.dataset.paramKey));
    const expectedParameterKeys = [
      "initialTickets",
      "captureSeconds",
      "commonResourceSpawnSeconds",
      "rareResourceSpawnSeconds",
      "skillSpawnInterval",
      "respawnEnabled",
      "mapTemplate",
    ];
    assert(
      JSON.stringify(renderedParameterKeys) === JSON.stringify(expectedParameterKeys),
      `territory parameter panel should expose only effective fields: ${JSON.stringify(renderedParameterKeys)}`,
    );
    await page.fill('#protoModeParams [data-param-key="initialTickets"]', "230");
    await page.click("#protoApplyModeParamsBtn");
    await eventually(async () => page.evaluate(() => {
      const state = window.__TDOS_PROTOTYPE_RUNTIME__?.getModeState?.();
      return state?.initialTickets === 230 && state?.alliances?.A?.tickets === 230 && state?.alliances?.B?.tickets === 230;
    }), 3000);
    await page.fill('#protoModeParams [data-param-key="initialTickets"]', "120");
    await page.click("#protoApplyModeParamsBtn");
    await eventually(async () => page.evaluate(() => window.__TDOS_PROTOTYPE_RUNTIME__?.getModeState?.()?.initialTickets === 120), 3000);

    const layout = await page.evaluate(() => {
      const runtime = window.__TDOS_PROTOTYPE_RUNTIME__;
      return runtime?.getFleetLayout?.();
    });
    assert(layout?.localSeat === "A1", `expected A1 local seat, got ${JSON.stringify(layout)}`);
    assert(layout.alliances.A.length === 3 && layout.alliances.B.length === 3, `expected 3v3 layout, got ${JSON.stringify(layout)}`);

    const seedInput = page.locator('#protoModeTools input[data-territory-seed-input]');
    assert(await seedInput.count() === 1, "territory tools should expose a seed input");
    const initialSeedState = await page.evaluate(() => {
      const runtime = window.__TDOS_PROTOTYPE_RUNTIME__;
      return {
        seed: runtime?.getRandomSeed?.(),
        map: JSON.stringify(runtime?.getModeState?.()?.map),
        inspection: window.__TDOS_PROTOTYPE_INSPECT__?.(),
      };
    });
    assert(Number.isInteger(initialSeedState.seed) && initialSeedState.seed >= 0, `ordinary start should allocate a seed: ${JSON.stringify(initialSeedState)}`);

    await page.evaluate(() => {
      const runtime = window.__TDOS_PROTOTYPE_RUNTIME__;
      runtime.applyAction({ type: "split", level: 1 }, "A1");
      runtime.step();
    });
    await page.keyboard.press("Digit2");
    await eventually(async () => (await page.evaluate(() => window.__TDOS_PROTOTYPE_INSPECT__?.()?.selectedShipKey)) === "sub1", 3000);
    await page.click("#subSkillBtn");
    await page.click("#zoomOutBtn");
    await page.evaluate(() => {
      const runtime = window.__TDOS_PROTOTYPE_RUNTIME__;
      const simulation = runtime.getSimulation();
      const destroyed = simulation.fleetBySeat("A1").shipByKey("sub2");
      destroyed.takeDamage(destroyed.maxHp * 10, null, simulation, false);
      runtime.step();
      runtime.getModeState().alliances.A.skillSlot = { skillId: "gravity_field", acquiredAt: runtime.getModeState().elapsed };
    });
    await eventually(async () => (await page.locator("#protoModeHud .territory-tactical-hud").getAttribute("data-skill-id")) === "gravity_field", 3000);
    await page.keyboard.press("x");
    await eventually(async () => (await page.locator("#protoModeHud .territory-tactical-hud").getAttribute("data-aiming")) === "true", 3000);
    await eventually(async () => (await page.evaluate(() => window.__TDOS_PROTOTYPE_INSPECT__?.()?.destructionEffectCount)) > 0, 3000);
    await page.evaluate(() => {
      const runtime = window.__TDOS_PROTOTYPE_RUNTIME__;
      runtime.getModeState().result = {
        finished: true,
        winnerAllianceId: "A",
        winnerSeat: null,
        reason: "tickets_depleted",
        label: "A 阵营战争点数获胜",
      };
      runtime.step();
    });
    await eventually(async () => !(await page.locator("#overlay").evaluate((element) => element.classList.contains("hidden"))), 3000);
    const dirtyHostState = await page.evaluate(() => ({
      inspection: window.__TDOS_PROTOTYPE_INSPECT__?.(),
      overlayHidden: document.querySelector("#overlay")?.classList.contains("hidden"),
      tacticalAiming: document.querySelector("#protoModeHud .territory-tactical-hud")?.dataset.aiming,
    }));
    assert(dirtyHostState.inspection?.selectedShipKey === "sub1", `seed-restart fixture should select sub1: ${JSON.stringify(dirtyHostState)}`);
    assert(dirtyHostState.inspection?.pendingSubSkillAim?.shipKey === "sub1", `seed-restart fixture should enter sub-skill aim: ${JSON.stringify(dirtyHostState)}`);
    assert(dirtyHostState.inspection?.destructionEffectCount > 0, `seed-restart fixture should contain a destruction effect: ${JSON.stringify(dirtyHostState)}`);
    assert(dirtyHostState.inspection?.resultShown && dirtyHostState.overlayHidden === false, `seed-restart fixture should show the result overlay: ${JSON.stringify(dirtyHostState)}`);
    assert(dirtyHostState.tacticalAiming === "true", `seed-restart fixture should enter tactical aim: ${JSON.stringify(dirtyHostState)}`);
    assert(dirtyHostState.inspection?.camera?.zoom !== initialSeedState.inspection?.camera?.zoom, `seed-restart fixture should move camera zoom: ${JSON.stringify(dirtyHostState)}`);

    await page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === "同种子重开");
      button?.click();
    });
    const sameSeedState = await eventually(async () => {
      const current = await page.evaluate(() => {
        const runtime = window.__TDOS_PROTOTYPE_RUNTIME__;
        return {
          seed: runtime?.getRandomSeed?.(),
          map: JSON.stringify(runtime?.getModeState?.()?.map),
          inspection: window.__TDOS_PROTOTYPE_INSPECT__?.(),
          overlayHidden: document.querySelector("#overlay")?.classList.contains("hidden"),
          tacticalAiming: document.querySelector("#protoModeHud .territory-tactical-hud")?.dataset.aiming,
        };
      });
      return current.seed === initialSeedState.seed && current.tacticalAiming === "false" ? current : null;
    }, 3000);
    assert(sameSeedState.seed === initialSeedState.seed, `same-seed restart changed seed: ${JSON.stringify({ initialSeedState, sameSeedState })}`);
    assert(sameSeedState.map === initialSeedState.map, "same-seed restart should reproduce the exact map");
    assert(sameSeedState.inspection?.selectedShipKey === "main", `same-seed restart should restore main selection: ${JSON.stringify(sameSeedState)}`);
    assert(!sameSeedState.inspection?.pendingSubSkillAim, `same-seed restart should clear sub-skill aim: ${JSON.stringify(sameSeedState)}`);
    assert(sameSeedState.inspection?.destructionEffectCount === 0, `same-seed restart should clear destruction effects: ${JSON.stringify(sameSeedState)}`);
    assert(!sameSeedState.inspection?.resultShown && sameSeedState.overlayHidden, `same-seed restart should clear the result overlay: ${JSON.stringify(sameSeedState)}`);
    assert(sameSeedState.tacticalAiming === "false", `same-seed restart should clear tactical aim: ${JSON.stringify(sameSeedState)}`);
    assert(Math.abs(sameSeedState.inspection.camera.zoom - initialSeedState.inspection.camera.zoom) <= 1e-9, `same-seed restart should restore initial camera zoom: ${JSON.stringify(sameSeedState)}`);
    assert(sameSeedState.inspection.worldSize === 2160, `same-seed restart should retain the 2160 world: ${JSON.stringify(sameSeedState)}`);
    assert(sameSeedState.inspection.cameraWorldSize?.width === 2160, `same-seed restart should reapply camera world bounds: ${JSON.stringify(sameSeedState)}`);

    await page.getByRole("button", { name: "新地图重开", exact: true }).click();
    const newSeedState = await eventually(async () => {
      const current = await page.evaluate(() => {
        const runtime = window.__TDOS_PROTOTYPE_RUNTIME__;
        return { seed: runtime?.getRandomSeed?.(), map: JSON.stringify(runtime?.getModeState?.()?.map), inspection: window.__TDOS_PROTOTYPE_INSPECT__?.() };
      });
      return current.seed !== initialSeedState.seed ? current : null;
    }, 3000);
    assert(newSeedState.map !== initialSeedState.map, "new-map restart should change random map features");
    assert(newSeedState.inspection?.worldSize === 2160 && newSeedState.inspection?.cameraWorldSize?.width === 2160, `new-map restart should retain runtime and camera world size: ${JSON.stringify(newSeedState)}`);

    await seedInput.fill(String(initialSeedState.seed));
    await page.getByRole("button", { name: "载入种子", exact: true }).click();
    const replayedSeedState = await eventually(async () => {
      const current = await page.evaluate(() => {
        const runtime = window.__TDOS_PROTOTYPE_RUNTIME__;
        return { seed: runtime?.getRandomSeed?.(), map: JSON.stringify(runtime?.getModeState?.()?.map), inspection: window.__TDOS_PROTOTYPE_INSPECT__?.() };
      });
      return current.seed === initialSeedState.seed ? current : null;
    }, 3000);
    assert(replayedSeedState.map === initialSeedState.map, "loading a seed should replay the original map exactly");
    assert(replayedSeedState.inspection?.worldSize === 2160 && replayedSeedState.inspection?.cameraWorldSize?.width === 2160, `seed replay should retain runtime and camera world size: ${JSON.stringify(replayedSeedState)}`);

    const viewInspection = await page.evaluate(() => window.__TDOS_PROTOTYPE_INSPECT__?.());
    assert(viewInspection, "prototype should expose a generic browser inspection snapshot");
    assert(viewInspection.localSeat === "A1", `inspection should report A1 local seat: ${JSON.stringify(viewInspection)}`);
    assert(viewInspection.selectedShipKey === "main", `inspection should report the selected A1 main ship: ${JSON.stringify(viewInspection)}`);
    assert(viewInspection.worldSize === 2160, `inspection should report the 2160 runtime world: ${JSON.stringify(viewInspection)}`);
    assert(viewInspection.cameraWorldSize?.width === 2160 && viewInspection.cameraWorldSize?.height === 2160, `inspection should report matching camera bounds: ${JSON.stringify(viewInspection)}`);
    assert(viewInspection.minimapRect?.x > 720 && viewInspection.minimapRect?.y > 720, `desktop minimap should be persistent in the lower-right: ${JSON.stringify(viewInspection)}`);
    assert(viewInspection.camera.zoom >= 1.6, `territory should open with a focused camera: ${JSON.stringify(viewInspection)}`);
    const expectedCameraX = Math.max(
      viewInspection.camera.width / 2,
      Math.min(viewInspection.worldSize - viewInspection.camera.width / 2, viewInspection.localShip.x),
    );
    const expectedCameraY = Math.max(
      viewInspection.camera.height / 2,
      Math.min(viewInspection.worldSize - viewInspection.camera.height / 2, viewInspection.localShip.y),
    );
    assert(
      Math.hypot(viewInspection.camera.centerX - expectedCameraX, viewInspection.camera.centerY - expectedCameraY) <= 1,
      `initial camera should focus A1 within world bounds: ${JSON.stringify(viewInspection)}`,
    );

    const territoryState = await page.evaluate(() => window.__TDOS_PROTOTYPE_RUNTIME__?.getPresentationState?.());
    const controlPoints = territoryState?.map?.controlPoints || [];
    const worldSize = territoryState?.map?.worldSize;
    assert(territoryState?.navigationPlans && typeof territoryState.navigationPlans === "object", "presentation state should expose copied navigation plans");
    assert(Object.prototype.hasOwnProperty.call(territoryState || {}, "telemetry"), "presentation state should expose telemetry for diagnostics");
    assert(controlPoints.length === 3, `expected three real control points: ${JSON.stringify(controlPoints)}`);
    assert(worldSize?.width > 0 && worldSize?.height > 0, `territory world size missing: ${JSON.stringify(worldSize)}`);
    const expectedControls = [
      ["control-top", 860, 330, 340, 240],
      ["control-mid", 1080, 1080, 360, 260],
      ["control-bottom", 1300, 1830, 340, 240],
    ];
    for (let index = 0; index < controlPoints.length; index += 1) {
      const point = controlPoints[index];
      const [id, x, y, width, height] = expectedControls[index];
      assert(point.id === id, `control point ${index} id should be ${id}: ${point.id}`);
      assert(point.shape === "rect", `control point ${point.id} should be rectangular`);
      assert(point.center.x === x && point.center.y === y, `control point ${point.id} position should be fixed: ${JSON.stringify(point.center)}`);
      assert(point.width === width && point.height === height, `control point ${point.id} size should be fixed: ${point.width}x${point.height}`);
    }
    const realTerrainTypes = new Set((territoryState?.map?.terrainRegions || []).map((region) => region.type));
    for (const terrainType of ["asteroid_belt", "speed_lane", "gravity_mire"]) {
      assert(realTerrainTypes.has(terrainType), `real browser state should include ${terrainType}: ${JSON.stringify([...realTerrainTypes])}`);
    }

    const snapshotInfo = await page.evaluate(() => {
      const snap = window.__TDOS_PROTOTYPE_RUNTIME__?.getSnapshot?.();
      const fleetPositions = Object.fromEntries(Object.entries(snap?.fleets || {}).map(([seat, fleet]) => [
        seat,
        { x: fleet?.ships?.main?.x, y: fleet?.ships?.main?.y },
      ]));
      return {
        worldSize: snap?.world?.size,
        aSeats: snap?.alliances?.A?.fleetSeats || [],
        bSeats: snap?.alliances?.B?.fleetSeats || [],
        shipCount: Object.values(snap?.fleets || {}).reduce((sum, fleet) => sum + Object.keys(fleet?.ships || {}).length, 0),
        fleetPositions,
      };
    });
    assert(snapshotInfo.worldSize === 2160, `territory snapshot should use a 2160 world: ${JSON.stringify(snapshotInfo)}`);
    assert(snapshotInfo.aSeats.length === 3, `snapshot should expose three A fleets: ${JSON.stringify(snapshotInfo)}`);
    assert(snapshotInfo.bSeats.length === 3, `snapshot should expose three B fleets: ${JSON.stringify(snapshotInfo)}`);
    assert(snapshotInfo.shipCount === 18, `snapshot should expose 18 basic ships: ${JSON.stringify(snapshotInfo)}`);
    const aPositions = snapshotInfo.aSeats.map((seat) => snapshotInfo.fleetPositions[seat]);
    const bPositions = snapshotInfo.bSeats.map((seat) => snapshotInfo.fleetPositions[seat]);
    assert(aPositions.every((position) => position.x < worldSize.width / 2 && position.y > worldSize.height / 2), `A fleets should start in the lower-left quadrant: ${JSON.stringify(aPositions)}`);
    assert(bPositions.every((position) => position.x > worldSize.width / 2 && position.y < worldSize.height / 2), `B fleets should start in the upper-right quadrant: ${JSON.stringify(bPositions)}`);
    assert(new Set(aPositions.map((position) => `${position.x}:${position.y}`)).size === 3, `A1/A2/A3 should start at distinct positions: ${JSON.stringify(aPositions)}`);
    assert(new Set(bPositions.map((position) => `${position.x}:${position.y}`)).size === 3, `B1/B2/B3 should start at distinct positions: ${JSON.stringify(bPositions)}`);

    const routesBefore = await page.evaluate(() => {
      const runtime = window.__TDOS_PROTOTYPE_RUNTIME__;
      runtime.pause();
      const snap = runtime.getSnapshot();
      return {
        a1: JSON.stringify(snap.fleets.A1.ships.main.route),
        a2: JSON.stringify(snap.fleets.A2.ships.main.route),
      };
    });
    const canvas = page.locator("#gameCanvas");
    const canvasBox = await canvas.boundingBox();
    assert(canvasBox?.width > 0 && canvasBox?.height > 0, `canvas box missing: ${JSON.stringify(canvasBox)}`);
    const desktopMinimapPixels = await canvas.evaluate((surface, minimapRect) => {
      const scale = surface.width / 1440;
      const inset = 4;
      const left = Math.floor((minimapRect.x + inset) * scale);
      const top = Math.floor((minimapRect.y + inset) * scale);
      const width = Math.max(1, Math.floor((minimapRect.width - inset * 2) * scale));
      const height = Math.max(1, Math.floor((minimapRect.height - inset * 2) * scale));
      const data = surface.getContext("2d").getImageData(left, top, width, height).data;
      let colored = 0;
      for (let index = 0; index < data.length; index += 4) {
        const red = data[index];
        const green = data[index + 1];
        const blue = data[index + 2];
        if (Math.max(red, green, blue) - Math.min(red, green, blue) > 18 && Math.max(red, green, blue) > 55) colored += 1;
      }
      return { colored, pixels: data.length / 4 };
    }, viewInspection.minimapRect);
    assert(desktopMinimapPixels.colored > 30, `territory desktop minimap pixels missing: ${JSON.stringify(desktopMinimapPixels)}`);
    await canvas.click({
      position: {
        x: canvasBox.width * ((viewInspection.minimapRect.x + viewInspection.minimapRect.width * 0.94) / 1440),
        y: canvasBox.height * ((viewInspection.minimapRect.y + viewInspection.minimapRect.height * 0.94) / 1440),
      },
    });
    const expandedCamera = await eventually(async () => {
      const inspection = await page.evaluate(() => window.__TDOS_PROTOTYPE_INSPECT__?.());
      return inspection?.camera?.centerX > 1440 && inspection?.camera?.centerY > 1440 ? inspection : null;
    }, 3000);
    assert(expandedCamera.camera.centerX <= 2160 && expandedCamera.camera.centerY <= 2160, `minimap navigation should remain inside the 2160 world: ${JSON.stringify(expandedCamera)}`);
    const routeBeforeMinimapRightClick = await page.evaluate(() => {
      const runtime = window.__TDOS_PROTOTYPE_RUNTIME__;
      runtime?.applyAction?.({ type: "clear_route", shipKey: "main" }, "A1");
      return JSON.stringify(runtime?.getSimulation?.()?.fleetBySeat?.("A1")?.shipByKey?.("main")?.route);
    });
    assert(routeBeforeMinimapRightClick === "null", `minimap right-click fixture should start without a route: ${routeBeforeMinimapRightClick}`);
    await canvas.click({
      button: "right",
      position: {
        x: canvasBox.width * ((viewInspection.minimapRect.x + viewInspection.minimapRect.width * 0.5) / 1440),
        y: canvasBox.height * ((viewInspection.minimapRect.y + viewInspection.minimapRect.height * 0.5) / 1440),
      },
    });
    const routeAfterMinimapRightClick = await page.evaluate(() => {
      const runtime = window.__TDOS_PROTOTYPE_RUNTIME__;
      return JSON.stringify(runtime?.getSimulation?.()?.fleetBySeat?.("A1")?.shipByKey?.("main")?.route);
    });
    assert(
      routeAfterMinimapRightClick === routeBeforeMinimapRightClick,
      `right-clicking the minimap must not issue a route: ${JSON.stringify({ routeBeforeMinimapRightClick, routeAfterMinimapRightClick })}`,
    );
    await canvas.click({
      position: {
        x: canvasBox.width * ((viewInspection.minimapRect.x + viewInspection.minimapRect.width * (viewInspection.localShip.x / 2160)) / 1440),
        y: canvasBox.height * ((viewInspection.minimapRect.y + viewInspection.minimapRect.height * (viewInspection.localShip.y / 2160)) / 1440),
      },
    });
    await canvas.click({
      button: "right",
      position: { x: canvasBox.width * 0.62, y: canvasBox.height * 0.42 },
    });
    const routesAfter = await eventually(async () => {
      const routes = await page.evaluate(() => {
        const snap = window.__TDOS_PROTOTYPE_RUNTIME__?.getSnapshot?.();
        return {
          a1: JSON.stringify(snap?.fleets?.A1?.ships?.main?.route),
          a2: JSON.stringify(snap?.fleets?.A2?.ships?.main?.route),
        };
      });
      return routes.a1 !== routesBefore.a1 ? routes : null;
    }, 3000);
    assert(routesAfter.a2 === routesBefore.a2, `right-click must not change A2 route: ${JSON.stringify({ routesBefore, routesAfter })}`);

    const obstacleRouteFixture = findObstacleRouteFixture(territoryState.map);
    assert(obstacleRouteFixture, "real browser map should expose a legal obstacle-crossing route fixture");
    const centerCameraThroughMinimap = async (point) => {
      const currentCanvasBox = await canvas.boundingBox();
      assert(currentCanvasBox, "obstacle fixture requires current Canvas bounds");
      await page.mouse.move(currentCanvasBox.x + currentCanvasBox.width / 2, currentCanvasBox.y + currentCanvasBox.height / 2);
      for (let step = 0; step < 6; step += 1) await page.mouse.wheel(0, 1000);
      await wait(150);
      const inspection = await page.evaluate(() => ({
        ...window.__TDOS_PROTOTYPE_INSPECT__?.(),
        coarse: matchMedia("(pointer: coarse)").matches,
        narrow: matchMedia("(max-width: 980px)").matches,
      }));
      assert(
        Math.abs((inspection?.camera?.zoom || 0) - 1) < 1e-6
          && Math.abs(inspection.camera.centerX - 1080) < 2
          && Math.abs(inspection.camera.centerY - 1080) < 2,
        `wheel overview fixture did not settle: ${JSON.stringify({ currentCanvasBox, inspection })}`,
      );
      const projected = worldPointToCanvasCss(point, inspection, currentCanvasBox);
      assert(
        projected.x > 0 && projected.y > 0 && projected.x < currentCanvasBox.width && projected.y < currentCanvasBox.height,
        `obstacle fixture point should be visible in overview: ${JSON.stringify({ point, projected, inspection })}`,
      );
      return inspection;
    };

    const routeBeforeInvalidTarget = await page.evaluate(() => {
      const runtime = window.__TDOS_PROTOTYPE_RUNTIME__;
      return {
        plan: JSON.stringify(runtime?.getModeState?.()?.navigationPlans?.["A1:main"] || null),
        route: JSON.stringify(runtime?.getSimulation?.()?.fleetBySeat?.("A1")?.shipByKey?.("main")?.route || null),
      };
    });
    assert(routeBeforeInvalidTarget.plan !== "null" && routeBeforeInvalidTarget.route !== "null", "invalid-target fixture requires an existing valid route");
    let obstacleInspection = await centerCameraThroughMinimap(obstacleRouteFixture.invalidTarget);
    const invalidTargetCss = worldPointToCanvasCss(obstacleRouteFixture.invalidTarget, obstacleInspection, canvasBox);
    const redPixelsBeforeInvalid = await sampleRedWorldPixels(page, obstacleRouteFixture.invalidTarget);
    await canvas.click({ button: "right", position: invalidTargetCss });
    await wait(120);
    const routeAfterInvalidTarget = await page.evaluate(() => {
      const runtime = window.__TDOS_PROTOTYPE_RUNTIME__;
      return {
        plan: JSON.stringify(runtime?.getModeState?.()?.navigationPlans?.["A1:main"] || null),
        route: JSON.stringify(runtime?.getSimulation?.()?.fleetBySeat?.("A1")?.shipByKey?.("main")?.route || null),
      };
    });
    assert(
      routeAfterInvalidTarget.plan === routeBeforeInvalidTarget.plan && routeAfterInvalidTarget.route === routeBeforeInvalidTarget.route,
      `right-clicking an obstacle interior should preserve the prior route: ${JSON.stringify({ routeBeforeInvalidTarget, routeAfterInvalidTarget })}`,
    );
    const redPixelsAfterInvalid = await sampleRedWorldPixels(page, obstacleRouteFixture.invalidTarget);
    await page.screenshot({ path: "artifacts/stellar-territory-v2-invalid-target-diagnostic.png", fullPage: true });
    assert(
      redPixelsAfterInvalid.red > redPixelsBeforeInvalid.red + 6,
      `obstacle rejection should add red world feedback pixels: ${JSON.stringify({ redPixelsBeforeInvalid, redPixelsAfterInvalid })}`,
    );
    await page.screenshot({ path: "artifacts/stellar-territory-v2-invalid-target.png", fullPage: true });

    await page.evaluate(({ start }) => {
      const runtime = window.__TDOS_PROTOTYPE_RUNTIME__;
      runtime.pause();
      runtime.applyAction({ type: "clear_route", shipKey: "main" }, "A1");
      const ship = runtime.getSimulation().fleetBySeat("A1").shipByKey("main");
      ship.x = start.x;
      ship.y = start.y;
      ship.command.x = start.x;
      ship.command.y = start.y;
      ship.route = null;
    }, obstacleRouteFixture);
    obstacleInspection = await centerCameraThroughMinimap(obstacleRouteFixture.invalidTarget);
    const detourTargetCss = worldPointToCanvasCss(obstacleRouteFixture.target, obstacleInspection, canvasBox);
    assert(
      detourTargetCss.x > 0 && detourTargetCss.y > 0 && detourTargetCss.x < canvasBox.width && detourTargetCss.y < canvasBox.height,
      `detour target should be visible after centering its obstacle: ${JSON.stringify(detourTargetCss)}`,
    );
    await canvas.click({ button: "right", position: detourTargetCss });
    const detourPlan = await eventually(async () => page.evaluate(() => {
      const plan = window.__TDOS_PROTOTYPE_RUNTIME__?.getPresentationState?.()?.navigationPlans?.["A1:main"];
      return plan?.waypoints?.length >= 2 ? plan : null;
    }), 3000);
    assert(detourPlan.kind === "graph", `obstacle-crossing right-click should create a graph plan: ${JSON.stringify(detourPlan)}`);
    const detourCoreRoute = await page.evaluate(() => {
      const route = window.__TDOS_PROTOTYPE_RUNTIME__?.getSimulation?.()?.fleetBySeat?.("A1")?.shipByKey?.("main")?.route;
      return route ? { p2: { ...route.p2 } } : null;
    });
    assert(
      detourCoreRoute?.p2?.x === detourPlan.waypoints[0].x && detourCoreRoute?.p2?.y === detourPlan.waypoints[0].y,
      `core should own only the first A* segment: ${JSON.stringify({ detourCoreRoute, detourPlan })}`,
    );

    const laterSegment = [detourPlan.waypoints[0], detourPlan.waypoints[1]];
    const laterMidpoint = {
      x: (laterSegment[0].x + laterSegment[1].x) / 2,
      y: (laterSegment[0].y + laterSegment[1].y) / 2,
    };
    await centerCameraThroughMinimap(laterMidpoint);
    await page.evaluate(() => {
      const runtime = window.__TDOS_PROTOTYPE_RUNTIME__;
      const state = runtime.getModeState();
      window.__TDOS_ROUTE_PLAN_FIXTURE__ = state.navigationPlans["A1:main"];
      delete state.navigationPlans["A1:main"];
    });
    await wait(100);
    await page.evaluate(() => {
      const surface = document.querySelector("#gameCanvas");
      window.__TDOS_ROUTE_BASELINE__ = surface.getContext("2d").getImageData(0, 0, surface.width, surface.height).data.slice();
      window.__TDOS_PROTOTYPE_RUNTIME__.getModeState().navigationPlans["A1:main"] = window.__TDOS_ROUTE_PLAN_FIXTURE__;
    });
    await wait(100);
    const plannedRoutePixels = await page.evaluate((segment) => {
      const surface = document.querySelector("#gameCanvas");
      const baseline = window.__TDOS_ROUTE_BASELINE__;
      const inspection = window.__TDOS_PROTOTYPE_INSPECT__?.();
      const camera = inspection?.camera;
      if (!surface || !baseline || !camera) return { changedCyan: 0, reason: "missing_surface_baseline_or_camera" };
      const current = surface.getContext("2d").getImageData(0, 0, surface.width, surface.height).data;
      const scale = surface.width / 1440;
      const project = (point) => ({
        x: (point.x - (camera.centerX - camera.width / 2)) * camera.zoom * scale,
        y: (point.y - (camera.centerY - camera.height / 2)) * camera.zoom * scale,
      });
      const start = project(segment[0]);
      const end = project(segment[1]);
      const minX = Math.max(0, Math.floor(Math.min(start.x, end.x) - 8));
      const maxX = Math.min(surface.width - 1, Math.ceil(Math.max(start.x, end.x) + 8));
      const minY = Math.max(0, Math.floor(Math.min(start.y, end.y) - 8));
      const maxY = Math.min(surface.height - 1, Math.ceil(Math.max(start.y, end.y) + 8));
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const lengthSquared = Math.max(1, dx * dx + dy * dy);
      const lineRadius = Math.max(3, 5 * camera.zoom * scale);
      let changedCyan = 0;
      let changedPixels = 0;
      let cyanPixels = 0;
      let maxRed = 0;
      let maxGreen = 0;
      let maxBlue = 0;
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const t = Math.max(0, Math.min(1, ((x - start.x) * dx + (y - start.y) * dy) / lengthSquared));
          if (Math.hypot(x - (start.x + dx * t), y - (start.y + dy * t)) > lineRadius) continue;
          const index = (y * surface.width + x) * 4;
          const difference = Math.abs(current[index] - baseline[index])
            + Math.abs(current[index + 1] - baseline[index + 1])
            + Math.abs(current[index + 2] - baseline[index + 2]);
          maxRed = Math.max(maxRed, current[index]);
          maxGreen = Math.max(maxGreen, current[index + 1]);
          maxBlue = Math.max(maxBlue, current[index + 2]);
          if (difference > 24) changedPixels += 1;
          if (current[index + 1] > 100 && current[index + 2] > 125 && current[index] < 145) cyanPixels += 1;
          if (difference > 24 && current[index + 1] > 145 && current[index + 2] > 175 && current[index] < 175) changedCyan += 1;
        }
      }
      delete window.__TDOS_ROUTE_BASELINE__;
      delete window.__TDOS_ROUTE_PLAN_FIXTURE__;
      return { changedCyan, changedPixels, cyanPixels, maxRed, maxGreen, maxBlue, start, end, minX, maxX, minY, maxY, camera };
    }, laterSegment);
    await page.screenshot({ path: "artifacts/stellar-territory-v2-a-star-detour.png", fullPage: true });
    assert(
      plannedRoutePixels.cyanPixels > 8,
      `full local A* route should render beyond the core-owned first segment: ${JSON.stringify({ plannedRoutePixels, detourPlan, laterSegment })}`,
    );

    const graphRouteInput = await page.evaluate(() => {
      const route = window.__TDOS_PROTOTYPE_RUNTIME__?.getSimulation?.()?.fleetBySeat?.("A1")?.shipByKey?.("main")?.route;
      return route ? { p1: { ...route.p1 }, p2: { ...route.p2 } } : null;
    });
    assert(graphRouteInput?.p1 && graphRouteInput?.p2, "graph route input fixture requires core Bezier handles");
    const inputCanvasBox = await canvas.boundingBox();
    const inputInspection = await page.evaluate(() => window.__TDOS_PROTOTYPE_INSPECT__?.());
    const controlCss = worldPointToCanvasCss(graphRouteInput.p1, inputInspection, inputCanvasBox);
    const endpointCss = worldPointToCanvasCss(graphRouteInput.p2, inputInspection, inputCanvasBox);
    await page.mouse.move(inputCanvasBox.x + controlCss.x, inputCanvasBox.y + controlCss.y);
    await page.mouse.down();
    await wait(20);
    const graphControlDrag = await page.evaluate(() => window.__TDOS_PROTOTYPE_INSPECT__?.());
    await page.mouse.up();
    assert(
      Object.prototype.hasOwnProperty.call(graphControlDrag || {}, "dragHandle"),
      "prototype inspection should expose the active route-drag handle",
    );
    assert(graphControlDrag.dragHandle === null, `graph routes should suppress control-handle dragging: ${JSON.stringify(graphControlDrag)}`);
    await page.mouse.move(inputCanvasBox.x + endpointCss.x, inputCanvasBox.y + endpointCss.y);
    await page.mouse.down();
    await wait(20);
    const graphEndpointDrag = await page.evaluate(() => window.__TDOS_PROTOTYPE_INSPECT__?.());
    await page.mouse.up();
    assert(graphEndpointDrag.dragHandle === "end", `graph routes should retain endpoint dragging: ${JSON.stringify(graphEndpointDrag)}`);

    const a2SplitBefore = await page.evaluate(() => window.__TDOS_PROTOTYPE_RUNTIME__?.getSnapshot?.()?.fleets?.A2?.splitLevel);
    await page.click("#splitOneBtn");
    await eventually(async () => {
      const snap = await page.evaluate(() => window.__TDOS_PROTOTYPE_RUNTIME__?.getSnapshot?.());
      return snap?.fleets?.A1?.splitLevel === 1 && snap?.fleets?.A2?.splitLevel === a2SplitBefore;
    }, 3000);
    await page.keyboard.press("2");
    const subSelection = await page.evaluate(() => window.__TDOS_PROTOTYPE_INSPECT__?.());
    assert(subSelection.localSeat === "A1" && subSelection.selectedShipKey === "sub1", `Digit2 should select only A1 sub1: ${JSON.stringify(subSelection)}`);
    await page.keyboard.press("1");
    await page.evaluate(() => window.__TDOS_PROTOTYPE_RUNTIME__?.resume?.());

    const tacticalControls = await page.evaluate(() => ({
      desktopHidden: document.querySelector("#tacticalSkillBtn")?.hidden,
      mobileHidden: document.querySelector("#mobileTacticalSkillBtn")?.hidden,
      hudCount: document.querySelectorAll("#protoModeHud .territory-tactical-hud").length,
    }));
    assert(tacticalControls.desktopHidden === false && tacticalControls.mobileHidden === false, `territory tactical buttons should be enabled: ${JSON.stringify(tacticalControls)}`);
    assert(tacticalControls.hudCount === 1, `territory tactical HUD should render once: ${JSON.stringify(tacticalControls)}`);

    const setPlayerTacticalSkill = async (skillId) => {
      await page.evaluate((nextSkillId) => {
        const state = window.__TDOS_PROTOTYPE_RUNTIME__?.getModeState?.();
        state.alliances.A.skillSlot = { skillId: nextSkillId, acquiredAt: state.elapsed };
      }, skillId);
      await eventually(async () => (await page.locator("#protoModeHud .territory-tactical-hud").getAttribute("data-skill-id")) === skillId, 3000);
    };
    const playerSkillState = () => page.evaluate(() => {
      const runtime = window.__TDOS_PROTOTYPE_RUNTIME__;
      const state = runtime?.getModeState?.();
      return {
        slot: state?.alliances?.A?.skillSlot?.skillId || null,
        effects: (state?.activeSkillEffects || []).map((effect) => ({
          id: effect.id,
          skillId: effect.skillId,
          seat: effect.seat,
          targetSeat: effect.targetSeat,
          position: effect.position,
          startedAt: effect.startedAt,
          endsAt: effect.endsAt,
        })),
        scouts: runtime?.getSimulation?.()?.fleetBySeat?.("A1")?.scouts?.length || 0,
      };
    });

    const scoutBaseline = (await playerSkillState()).scouts;
    for (const skillId of ["all_fleet_shield", "propulsion_overload", "firepower_overload"]) {
      await setPlayerTacticalSkill(skillId);
      await page.keyboard.press("x");
      await eventually(async () => {
        const current = await playerSkillState();
        return current.slot == null && current.effects.some((effect) => effect.skillId === skillId);
      }, 3000);
    }
    assert((await playerSkillState()).scouts === scoutBaseline, "X tactical shortcut must not launch a scout");
    await page.keyboard.press("z");
    await eventually(async () => (await playerSkillState()).scouts > scoutBaseline, 3000);

    await setPlayerTacticalSkill("gravity_field");
    await page.keyboard.press("x");
    await eventually(async () => (await page.locator("#protoModeHud .territory-tactical-hud").getAttribute("data-aiming")) === "true", 3000);
    await wait(900);
    const duringHumanAim = await playerSkillState();
    assert(duringHumanAim.slot === "gravity_field", `allied AI should not consume the human alliance slot during aiming: ${JSON.stringify(duringHumanAim)}`);
    await mkdir("artifacts", { recursive: true });
    await page.locator("#protoModeHud .territory-tactical-hud").scrollIntoViewIfNeeded();
    await page.screenshot({ path: "artifacts/stellar-territory-loop13-tactical-aim.png", fullPage: true });
    await page.keyboard.press("Escape");
    const afterEscape = await playerSkillState();
    assert(afterEscape.slot === "gravity_field", `Escape cancellation should preserve the tactical slot: ${JSON.stringify(afterEscape)}`);
    await page.keyboard.press("x");
    await eventually(async () => (await page.locator("#protoModeHud .territory-tactical-hud").getAttribute("data-aiming")) === "true", 3000);
    await page.keyboard.press("x");
    await eventually(async () => (await page.locator("#protoModeHud .territory-tactical-hud").getAttribute("data-aiming")) === "false", 3000);
    const afterRepeatCancel = await playerSkillState();
    assert(afterRepeatCancel.slot === "gravity_field", `pressing X again should cancel aiming without consuming the slot: ${JSON.stringify(afterRepeatCancel)}`);
    await page.keyboard.press("x");
    await canvas.click({ position: { x: canvasBox.width * 0.55, y: canvasBox.height * 0.45 } });
    await eventually(async () => {
      const current = await playerSkillState();
      return current.slot == null && current.effects.some((effect) => effect.skillId === "gravity_field");
    }, 3000);

    await setPlayerTacticalSkill("short_warp");
    await page.keyboard.press("x");
    await canvas.click({ position: { x: canvasBox.width * 0.96, y: canvasBox.height * 0.04 } });
    await eventually(async () => (await page.locator("#protoModeHud .territory-tactical-hud").getAttribute("data-invalid")) === "true", 3000);
    assert((await playerSkillState()).slot === "short_warp", "invalid point should not consume short warp");
    await canvas.click({ button: "right", position: { x: canvasBox.width * 0.5, y: canvasBox.height * 0.5 } });
    assert((await playerSkillState()).slot === "short_warp", "right-click cancellation should preserve the tactical slot");
    await page.keyboard.press("x");
    const warpTarget = await page.evaluate(() => {
      const inspection = window.__TDOS_PROTOTYPE_INSPECT__?.();
      const runtime = window.__TDOS_PROTOTYPE_RUNTIME__;
      const view = inspection.camera;
      const simulation = runtime?.getSimulation?.();
      const bounds = runtime?.getModeState?.()?.map?.safeBounds;
      const fleet = simulation?.fleetBySeat?.("A1");
      const ships = fleet?.getAllShips?.().filter((ship) => ship.alive) || [];
      const anchor = fleet?.shipByKey?.("main");
      const movingShips = new Set(ships);
      const otherShips = (simulation?.fleetSeats || []).flatMap((seat) => (
        simulation.fleetBySeat(seat).getAllShips().filter((ship) => ship.alive && !movingShips.has(ship))
      ));
      const offsets = [
        { x: -100, y: 0 }, { x: 0, y: -100 }, { x: 0, y: 100 }, { x: 100, y: 0 },
        { x: -70, y: -70 }, { x: -70, y: 70 }, { x: 70, y: -70 }, { x: 70, y: 70 },
      ];
      const offset = offsets.find(({ x: dx, y: dy }) => ships.every((ship) => {
        const position = { x: ship.x + dx, y: ship.y + dy };
        const radius = Math.max(0, Number(ship.radius) || 0);
        const insideBounds = !bounds || (
          position.x - radius >= bounds.x
          && position.y - radius >= bounds.y
          && position.x + radius <= bounds.x + bounds.width
          && position.y + radius <= bounds.y + bounds.height
        );
        return insideBounds
          && simulation?.canOccupyEnvironment?.(position, radius, { entity: ship, kind: "short_warp_test" }) !== false
          && otherShips.every((other) => (
            Math.hypot(position.x - other.x, position.y - other.y) >= radius + Math.max(0, Number(other.radius) || 0)
          ));
      }));
      if (!offset || !anchor) throw new Error("browser fixture could not find a clear short-warp target");
      const target = { x: anchor.x + offset.x, y: anchor.y + offset.y };
      return {
        xRatio: (target.x - (view.centerX - view.width / 2)) / view.width,
        yRatio: (target.y - (view.centerY - view.height / 2)) / view.height,
      };
    });
    await canvas.click({
      position: {
        x: Math.max(4, Math.min(canvasBox.width - 4, canvasBox.width * warpTarget.xRatio)),
        y: Math.max(4, Math.min(canvasBox.height - 4, canvasBox.height * warpTarget.yRatio)),
      },
    });
    await eventually(async () => (await playerSkillState()).slot == null, 3000);

    await page.evaluate(() => {
      const fleet = window.__TDOS_PROTOTYPE_RUNTIME__?.getSimulation?.()?.fleetBySeat?.("A2");
      const ship = fleet?.shipByKey?.("main");
      if (ship) ship.hp = ship.maxHp * 0.5;
    });
    await setPlayerTacticalSkill("repair_drones");
    await page.locator("#protoModeHud .territory-tactical-hud").scrollIntoViewIfNeeded();
    await page.screenshot({ path: "artifacts/stellar-territory-loop13-repair-targets.png", fullPage: true });
    await page.locator('#protoModeHud [data-tactical-target-seat="A2"]').click();
    await eventually(async () => {
      const current = await playerSkillState();
      return current.slot == null && current.effects.some((effect) => effect.skillId === "repair_drones" && effect.targetSeat === "A2");
    }, 3000);

    const preheatState = await page.evaluate(() => {
      const runtime = window.__TDOS_PROTOTYPE_RUNTIME__;
      runtime.pause();
      const simulation = runtime.getSimulation();
      const ship = simulation.fleetBySeat("A1").shipByKey("main");
      ship.spawnProtectionUntil = 0;
      ship.takeDamage(ship.maxHp * 10, null, simulation, false);
      runtime.step();
      const item = runtime.getModeState().respawnQueue.find((entry) => entry.seat === "A1" && entry.shipKey === "main");
      if (item) item.remaining = 2.4;
      runtime.resume();
      return item ? { remaining: item.remaining, spawnPosition: item.spawnPosition } : null;
    });
    assert(preheatState?.remaining === 2.4 && Number.isFinite(preheatState.spawnPosition?.x), `real respawn preheat queue missing: ${JSON.stringify(preheatState)}`);
    await wait(120);
    await page.screenshot({ path: "artifacts/stellar-territory-loop14-respawn-preheat.png", fullPage: true });

    const materializedState = await page.evaluate(() => {
      const runtime = window.__TDOS_PROTOTYPE_RUNTIME__;
      runtime.pause();
      const item = runtime.getModeState().respawnQueue.find((entry) => entry.seat === "A1" && entry.shipKey === "main");
      if (item) item.remaining = 0;
      runtime.step();
      const simulation = runtime.getSimulation();
      const ship = simulation.fleetBySeat("A1").shipByKey("main");
      return {
        alive: ship.alive,
        protection: Math.max(0, ship.spawnProtectionUntil - simulation.elapsed),
        queueCount: runtime.getModeState().respawnQueue.filter((entry) => entry.seat === "A1" && entry.shipKey === "main").length,
        ledgerCount: Object.keys(runtime.getModeState().deathLedger || {}).length,
      };
    });
    assert(materializedState.alive && materializedState.protection > 2.9, `real respawn should materialize with protection: ${JSON.stringify(materializedState)}`);
    assert(materializedState.queueCount === 0 && materializedState.ledgerCount === 0, `real respawn should clear queue/ledger: ${JSON.stringify(materializedState)}`);
    await page.evaluate(() => window.__TDOS_PROTOTYPE_RUNTIME__?.resume?.());
    await eventually(async () => page.evaluate(() => {
      const ship = window.__TDOS_PROTOTYPE_RUNTIME__?.getSnapshot?.()?.fleets?.A1?.ships?.main;
      return ship?.alive && ship.spawnProtectionRemaining > 2.8;
    }), 3000);
    await page.screenshot({ path: "artifacts/stellar-territory-loop14-respawn-materialize.png", fullPage: true });

    const shieldBreakState = await page.evaluate(() => {
      const runtime = window.__TDOS_PROTOTYPE_RUNTIME__;
      const state = runtime.getModeState();
      state.alliances.A.skillSlot = { skillId: "all_fleet_shield", acquiredAt: state.elapsed };
      const accepted = runtime.applyAction({ type: "use_tactical_skill" }, "A1");
      const ship = runtime.getSimulation().fleetBySeat("A1").shipByKey("main");
      return { accepted, protection: Math.max(0, ship.spawnProtectionUntil - runtime.getSimulation().elapsed) };
    });
    assert(shieldBreakState.accepted && shieldBreakState.protection === 0, `accepted skill should break real respawn protection: ${JSON.stringify(shieldBreakState)}`);
    await wait(80);
    await page.screenshot({ path: "artifacts/stellar-territory-loop14-shield-break.png", fullPage: true });

    await page.getByRole("button", { name: "生成维修包", exact: true }).click();
    await page.getByRole("button", { name: "生成技能包", exact: true }).click();
    await eventually(async () => {
      const state = await page.evaluate(() => window.__TDOS_PROTOTYPE_RUNTIME__?.getPresentationState?.());
      return state?.pickups?.length >= 1 && state?.skillPickups?.length >= 1;
    }, 5000);

    const pixels = await page.locator("#gameCanvas").evaluate((canvas) => {
      const ctx = canvas.getContext("2d");
      const sample = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let resourceLike = 0;
      let skillLike = 0;
      let controlLike = 0;
      for (let i = 0; i < sample.length; i += 4) {
        const r = sample[i];
        const g = sample[i + 1];
        const b = sample[i + 2];
        if (g > 150 && r < 150 && b < 190) resourceLike += 1;
        if (r > 150 && b > 180 && g < 180) skillLike += 1;
        if (r > 170 && g > 155 && b > 100) controlLike += 1;
      }
      return { resourceLike, skillLike, controlLike };
    });
    assert(pixels.resourceLike > 40, `resource pixels missing: ${JSON.stringify(pixels)}`);
    assert(pixels.skillLike > 40, `skill pixels missing: ${JSON.stringify(pixels)}`);
    assert(pixels.controlLike > 150, `control/map pixels missing: ${JSON.stringify(pixels)}`);

    await mkdir("artifacts", { recursive: true });
    await page.screenshot({ path: "artifacts/stellar-territory-loop2-map.png", fullPage: true });

    const warningEvidence = await page.evaluate(() => {
      const runtime = window.__TDOS_PROTOTYPE_RUNTIME__;
      runtime.pause();
      const state = runtime.getModeState();
      state.resourceRuntime.reservations.common = null;
      state.resourceRuntime.warned.common = false;
      state.resourceRuntime.nextCommonAt = state.elapsed + 6;
      state.skillRuntime.reservation = null;
      state.skillRuntime.warned = false;
      state.skillRuntime.nextSkillAt = state.elapsed + 8;
      runtime.step();
      const resource = runtime.getModeState().resourceRuntime.reservations.common;
      const skill = runtime.getModeState().skillRuntime.reservation;
      const simulation = runtime.getSimulation();
      const farX = resource?.position?.x > simulation.worldSize / 2 ? 100 : simulation.worldSize - 100;
      const farY = resource?.position?.y > simulation.worldSize / 2 ? 100 : simulation.worldSize - 100;
      for (const seat of simulation.fleetSeats) {
        for (const ship of simulation.fleetBySeat(seat).getAllShips()) {
          ship.x = farX;
          ship.y = farY;
          ship.command.x = farX;
          ship.command.y = farY;
          ship.route = null;
        }
      }
      const main = simulation.fleetBySeat("A1").shipByKey("main");
      if (resource?.position && main) {
        const cameraOffsetX = resource.position.x > simulation.worldSize / 2 ? -220 : 220;
        main.x = Math.max(60, Math.min(simulation.worldSize - 60, resource.position.x + cameraOffsetX));
        main.y = resource.position.y;
        main.command.x = main.x;
        main.command.y = main.y;
        main.route = null;
      }
      const subjectClearance = resource?.position && main
        ? Math.hypot(main.x - resource.position.x, main.y - resource.position.y)
        : 0;
      runtime.resume();
      return { resource, skill, subjectClearance };
    });
    assert(warningEvidence.resource?.position && warningEvidence.resource.spawnAt > 0, `real resource warning reservation missing: ${JSON.stringify(warningEvidence)}`);
    assert(warningEvidence.skill?.position && warningEvidence.skill.spawnAt > 0, `real skill warning reservation missing: ${JSON.stringify(warningEvidence)}`);
    assert(warningEvidence.subjectClearance >= 180, `warning evidence should clear the selected-ship overlay: ${JSON.stringify(warningEvidence)}`);
    const nodeToggle = page.locator("#protoModeTools input[type=checkbox]").nth(1);
    if (await nodeToggle.isChecked()) await nodeToggle.uncheck();
    await wait(100);
    await page.screenshot({ path: "artifacts/stellar-territory-loop16-warnings.png", fullPage: true });

    const resourcePersistenceEvidence = await page.evaluate(() => {
      const runtime = window.__TDOS_PROTOTYPE_RUNTIME__;
      runtime.pause();
      runtime.applyAction({ type: "debug_clear_resources" }, "A1");
      const accepted = runtime.applyAction({ type: "debug_spawn_resource", resourceType: "repair", rarity: "common" }, "A1");
      const pickup = runtime.getModeState().pickups[0];
      const simulation = runtime.getSimulation();
      const originalAuxiliaryFlags = [];
      for (const seat of simulation.fleetSeats) {
        for (const ship of simulation.fleetBySeat(seat).getAllShips()) {
          originalAuxiliaryFlags.push({ ship, isAuxiliary: ship.isAuxiliary });
          ship.isAuxiliary = true;
        }
      }
      const startedAt = runtime.getModeState().elapsed;
      let evidence;
      try {
        for (let index = 0; index < 1800; index += 1) runtime.step();
        const currentState = runtime.getModeState();
        const remaining = currentState.pickups.find((item) => item.id === pickup?.id);
        evidence = {
          accepted,
          pickupId: pickup?.id || null,
          elapsedDelta: currentState.elapsed - startedAt,
          spawnHasExpiresAt: Boolean(pickup && Object.prototype.hasOwnProperty.call(pickup, "expiresAt")),
          remaining: Boolean(remaining),
          remainingHasExpiresAt: Boolean(remaining && Object.prototype.hasOwnProperty.call(remaining, "expiresAt")),
        };
      } finally {
        for (const entry of originalAuxiliaryFlags) entry.ship.isAuxiliary = entry.isAuxiliary;
      }
      return evidence;
    });
    assert(resourcePersistenceEvidence.accepted && resourcePersistenceEvidence.pickupId, `real resource action should spawn a pickup: ${JSON.stringify(resourcePersistenceEvidence)}`);
    assert(Math.abs(resourcePersistenceEvidence.elapsedDelta - 60) < 1e-6, `resource persistence fixture should advance exactly 60 simulated seconds: ${JSON.stringify(resourcePersistenceEvidence)}`);
    assert(resourcePersistenceEvidence.remaining, `spawned resource should persist for 60 simulated seconds: ${JSON.stringify(resourcePersistenceEvidence)}`);
    assert(!resourcePersistenceEvidence.spawnHasExpiresAt && !resourcePersistenceEvidence.remainingHasExpiresAt, `persistent resource should have no expiresAt field: ${JSON.stringify(resourcePersistenceEvidence)}`);

    const resourceCollectionEvidence = await page.evaluate((pickupId) => {
      const runtime = window.__TDOS_PROTOTYPE_RUNTIME__;
      runtime.pause();
      const state = runtime.getModeState();
      const pickup = state.pickups.find((item) => item.id === pickupId);
      const main = runtime.getSimulation().fleetBySeat("A1").shipByKey("main");
      if (!pickup || !main) return null;
      main.hp = main.maxHp * 0.5;
      main.x = pickup.position.x + 38;
      main.y = pickup.position.y;
      main.command.x = main.x;
      main.command.y = main.y;
      main.route = null;
      runtime.step();
      const collected = !runtime.getModeState().pickups.some((item) => item.id === pickup.id);
      const hullRatio = main.hp / main.maxHp;
      runtime.resume();
      return { collected, hullRatio, resourceType: pickup.resourceType };
    }, resourcePersistenceEvidence.pickupId);
    assert(resourceCollectionEvidence?.collected, `real resource pickup should be collected: ${JSON.stringify(resourceCollectionEvidence)}`);
    assert(resourceCollectionEvidence.hullRatio > 0.5, `real repair pickup should restore hull: ${JSON.stringify(resourceCollectionEvidence)}`);
    await wait(80);
    await page.screenshot({ path: "artifacts/stellar-territory-loop16-resource-collection.png", fullPage: true });

    await page.getByRole("button", { name: "同种子重开", exact: true }).click();
    await eventually(async () => page.evaluate(() => {
      const state = window.__TDOS_PROTOTYPE_RUNTIME__?.getModeState?.();
      return state?.elapsed < 0.5 && state?.activeSkillEffects?.length === 0;
    }), 3000);

    const skillCollectionEvidence = await page.evaluate(() => {
      const runtime = window.__TDOS_PROTOTYPE_RUNTIME__;
      runtime.pause();
      runtime.applyAction({ type: "debug_spawn_skill", skillId: "all_fleet_shield" }, "A1");
      const state = runtime.getModeState();
      const pickup = state.skillPickups[0];
      const main = runtime.getSimulation().fleetBySeat("A1").shipByKey("main");
      if (!pickup || !main) return null;
      main.x = pickup.position.x + 38;
      main.y = pickup.position.y;
      main.command.x = main.x;
      main.command.y = main.y;
      main.route = null;
      runtime.step();
      const collectedSkillId = runtime.getModeState().alliances.A.skillSlot?.skillId || null;
      runtime.resume();
      return { collectedSkillId, removed: !runtime.getModeState().skillPickups.some((item) => item.id === pickup.id) };
    });
    assert(skillCollectionEvidence?.collectedSkillId === "all_fleet_shield" && skillCollectionEvidence.removed, `real skill collection should fill the slot and remove the pickup: ${JSON.stringify(skillCollectionEvidence)}`);
    await eventually(async () => (await page.locator("#protoModeHud .territory-tactical-hud").getAttribute("data-skill-id")) === "all_fleet_shield", 3000);
    await wait(80);
    await page.screenshot({ path: "artifacts/stellar-territory-loop16-skill-collection.png", fullPage: true });
    await page.keyboard.press("x");
    const collectedSkillUseEvidence = await eventually(async () => {
      const current = await playerSkillState();
      return current.slot == null && current.effects.some((effect) => effect.skillId === "all_fleet_shield")
        ? current
        : null;
    }, 3000);
    assert(collectedSkillUseEvidence.effects.some((effect) => effect.skillId === "all_fleet_shield"), `keyboard use of the collected skill should create an authoritative effect and clear the slot: ${JSON.stringify(collectedSkillUseEvidence)}`);

    await page.getByRole("button", { name: "同种子重开", exact: true }).click();
    await eventually(async () => page.evaluate(() => window.__TDOS_PROTOTYPE_RUNTIME__?.getModeState?.()?.elapsed < 0.5), 3000);
    const skillUseEvidence = await page.evaluate(() => {
      const runtime = window.__TDOS_PROTOTYPE_RUNTIME__;
      runtime.pause();
      const simulation = runtime.getSimulation();
      const state = runtime.getModeState();
      for (const seat of simulation.fleetSeats) {
        for (const ship of simulation.fleetBySeat(seat).getAllShips()) {
          ship.x = seat === "A1" && ship.key === "main" ? 610 : 120;
          ship.y = seat === "A1" && ship.key === "main" ? 720 : 120;
          ship.command.x = ship.x;
          ship.command.y = ship.y;
          ship.route = null;
        }
      }
      state.alliances.A.skillSlot = { skillId: "gravity_field", acquiredAt: state.elapsed };
      const accepted = runtime.applyAction({ type: "use_tactical_skill", targetX: 760, targetY: 720 }, "A1");
      const active = runtime.getModeState().activeSkillEffects.find((effect) => effect.skillId === "gravity_field");
      runtime.resume();
      return { accepted, active: Boolean(active), radius: active?.payload?.radius || null };
    });
    assert(skillUseEvidence.accepted && skillUseEvidence.active && skillUseEvidence.radius === 170, `real gravity-field use should create its authoritative active area: ${JSON.stringify(skillUseEvidence)}`);
    await wait(80);
    await page.screenshot({ path: "artifacts/stellar-territory-loop16-skill-use.png", fullPage: true });

    await page.getByRole("button", { name: "同种子重开", exact: true }).click();
    await eventually(async () => page.evaluate(() => window.__TDOS_PROTOTYPE_RUNTIME__?.getModeState?.()?.elapsed < 0.5), 3000);
    const contestedEvidence = await page.evaluate(() => {
      const runtime = window.__TDOS_PROTOTYPE_RUNTIME__;
      runtime.pause();
      const state = runtime.getModeState();
      const point = state.map.controlPoints[1];
      point.contested = false;
      for (const seat of ["A1", "B1"]) {
        const main = runtime.getSimulation().fleetBySeat(seat).shipByKey("main");
        main.x = point.center.x;
        main.y = point.center.y;
        main.command.x = main.x;
        main.command.y = main.y;
        main.route = null;
      }
      runtime.step();
      const contested = runtime.getModeState().map.controlPoints[1].contested;
      runtime.resume();
      return { contested, point: { ...point.center } };
    });
    assert(contestedEvidence.contested, `real opposing presence should contest the point: ${JSON.stringify(contestedEvidence)}`);
    await wait(60);
    await page.screenshot({ path: "artifacts/stellar-territory-loop16-contested-pulse.png", fullPage: true });

    const lowTicketState = await page.evaluate(() => {
      const runtime = window.__TDOS_PROTOTYPE_RUNTIME__;
      runtime.pause();
      const state = runtime.getModeState();
      state.alliances.A.tickets = 29;
      state.map.controlPoints[0].ownerAllianceId = "B";
      state.map.controlPoints[1].ownerAllianceId = "B";
      state.map.controlPoints[2].ownerAllianceId = "A";
      state.ticketTimers.A = 3.99;
      runtime.step();
      const presentationState = runtime.getPresentationState();
      runtime.resume();
      return presentationState;
    });
    assert(lowTicketState.alliances.A.tickets === 28, `real control deficit should deduct one A ticket: ${JSON.stringify(lowTicketState.alliances)}`);
    assert(lowTicketState.alliances.B.tickets === 120, `primary ticket HUD state should retain the visible B ticket value: ${JSON.stringify(lowTicketState.alliances)}`);
    assert(lowTicketState.ticketDrainRates.A === 0.25, `real HUD state should expose A drain rate: ${JSON.stringify(lowTicketState.ticketDrainRates)}`);
    await wait(120);
    const ticketHudPixels = await sampleTicketHudPixels(page);
    await page.screenshot({ path: "artifacts/stellar-territory-loop8-ticket-loss.png", fullPage: true });
    assert(ticketHudPixels.cyan > 20 && ticketHudPixels.coral > 20 && ticketHudPixels.bright > 40, `primary ticket HUD pixels missing: ${JSON.stringify(ticketHudPixels)}`);

    const developerPanelHidden = await page.locator(".prototype-dev-panel").evaluate((panel) => {
      panel.style.display = "none";
      return getComputedStyle(panel).display === "none";
    });
    assert(developerPanelHidden, "territory developer panel should be hidden for primary HUD independence coverage");
    await wait(120);
    const hiddenPanelTicketState = await page.evaluate(() => window.__TDOS_PROTOTYPE_RUNTIME__?.getPresentationState?.()?.alliances);
    const hiddenPanelTicketPixels = await sampleTicketHudPixels(page);
    assert(
      hiddenPanelTicketState?.A?.tickets === lowTicketState.alliances.A.tickets
        && hiddenPanelTicketState?.B?.tickets === lowTicketState.alliances.B.tickets,
      `A/B ticket state should remain visible after hiding the developer panel: ${JSON.stringify(hiddenPanelTicketState)}`,
    );
    assert(
      hiddenPanelTicketPixels.cyan > 20 && hiddenPanelTicketPixels.coral > 20 && hiddenPanelTicketPixels.bright > 40,
      `primary ticket HUD pixels should remain after hiding the developer panel: ${JSON.stringify(hiddenPanelTicketPixels)}`,
    );
    await page.locator(".prototype-dev-panel").evaluate((panel) => {
      panel.style.display = "";
    });

    await page.evaluate(() => {
      const runtime = window.__TDOS_PROTOTYPE_RUNTIME__;
      runtime.pause();
      const point = runtime.getModeState().map.controlPoints[0];
      point.ownerAllianceId = null;
      point.capturingAllianceId = null;
      point.captureProgress = 0;
      point.contested = false;
      const fleet = runtime.getSimulation().fleetBySeat("A1");
      const offsets = [{ x: 0, y: 0 }, { x: -24, y: 18 }, { x: 24, y: 18 }];
      Object.values(fleet.ships).forEach((ship, index) => {
        ship.x = point.center.x + offsets[index].x;
        ship.y = point.center.y + offsets[index].y;
        ship.command = { x: ship.x, y: ship.y };
        ship.route = null;
        ship.speed = 0;
      });
      for (let index = 0; index < 90; index += 1) runtime.step();
    });
    await eventually(async () => {
      const point = await page.evaluate(() => window.__TDOS_PROTOTYPE_RUNTIME__?.getPresentationState?.()?.map?.controlPoints?.[0]);
      return point?.capturingAllianceId === "A" && point.captureProgress > 0.35 && point.captureProgress < 0.75;
    }, 5000);
    await page.screenshot({ path: "artifacts/stellar-territory-loop2-capturing.png", fullPage: true });

    await page.evaluate(() => {
      const runtime = window.__TDOS_PROTOTYPE_RUNTIME__;
      for (let index = 0; index < 110; index += 1) runtime.step();
    });
    await eventually(async () => {
      const point = await page.evaluate(() => window.__TDOS_PROTOTYPE_RUNTIME__?.getPresentationState?.()?.map?.controlPoints?.[0]);
      return point?.ownerAllianceId === "A" && point.captureProgress === 1;
    }, 5000);
    await page.screenshot({ path: "artifacts/stellar-territory-loop2-captured.png", fullPage: true });

    const terrainShowcase = await page.evaluate(() => {
      const runtime = window.__TDOS_PROTOTYPE_RUNTIME__;
      const inspection = window.__TDOS_PROTOTYPE_INSPECT__();
      const state = runtime.getModeState();
      const centerX = inspection.camera.centerX;
      const centerY = inspection.camera.centerY - inspection.camera.height * 0.2;
      const spacing = Math.min(220, inspection.camera.width * 0.27);
      state.map.terrainRegions = [
        {
          id: "showcase-asteroid",
          type: "asteroid_belt",
          shape: "compound",
          center: { x: centerX - spacing, y: centerY },
          radius: 128,
          fields: [
            { x: centerX - spacing - 42, y: centerY - 14, radius: 76, coreRadius: 28 },
            { x: centerX - spacing + 42, y: centerY - 6, radius: 72, coreRadius: 27 },
            { x: centerX - spacing, y: centerY + 52, radius: 68, coreRadius: 25 },
          ],
          blocksPath: false,
        },
        {
          id: "showcase-lane",
          type: "speed_lane",
          shape: "capsule",
          center: { x: centerX, y: centerY },
          length: 190,
          width: 76,
          angle: 0,
          blocksPath: false,
        },
        {
          id: "showcase-gravity",
          type: "gravity_mire",
          shape: "compound",
          center: { x: centerX + spacing, y: centerY },
          radius: 132,
          fields: [
            { x: centerX + spacing - 40, y: centerY - 12, radius: 78, coreRadius: 29 },
            { x: centerX + spacing + 43, y: centerY - 4, radius: 74, coreRadius: 28 },
            { x: centerX + spacing, y: centerY + 54, radius: 70, coreRadius: 26 },
          ],
          blocksPath: false,
        },
      ];
      runtime.resume();
      return state.map.terrainRegions.map((region) => ({
        type: region.type,
        shape: region.shape,
        fieldCount: region.fields?.length || 0,
      }));
    });
    assert(
      terrainShowcase.map((region) => region.type).join(",") === "asteroid_belt,speed_lane,gravity_mire"
        && terrainShowcase[0].shape === "compound" && terrainShowcase[0].fieldCount === 3
        && terrainShowcase[2].shape === "compound" && terrainShowcase[2].fieldCount === 3,
      `terrain showcase state missing compound fields: ${JSON.stringify(terrainShowcase)}`,
    );
    await wait(180);
    await page.screenshot({ path: "artifacts/stellar-territory-loop9-terrain-showcase.png", fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await eventually(async () => page.evaluate(() => window.matchMedia("(max-width: 980px)").matches), 3000);
    await wait(180);
    await page.evaluate(() => window.scrollTo(0, 0));
    const mobileMinimapHit = await page.evaluate(() => {
      const surface = document.querySelector("#gameCanvas");
      const inspection = window.__TDOS_PROTOTYPE_INSPECT__?.();
      const minimap = inspection?.minimapRect;
      if (!surface || !minimap) return null;
      const bounds = surface.getBoundingClientRect();
      const clientX = bounds.left + bounds.width * ((minimap.x + minimap.width * 0.9) / 1440);
      const clientY = bounds.top + bounds.height * ((minimap.y + minimap.height * 0.9) / 1440);
      const hit = document.elementFromPoint(clientX, clientY);
      const hudBounds = document.querySelector("#mobileBattleHud")?.getBoundingClientRect();
      const rect = (value) => value ? {
        left: value.left,
        top: value.top,
        right: value.right,
        bottom: value.bottom,
        width: value.width,
        height: value.height,
      } : null;
      return {
        clientX,
        clientY,
        inViewport: clientX >= 0 && clientX <= innerWidth && clientY >= 0 && clientY <= innerHeight,
        hitsCanvas: hit === surface,
        hit: hit ? { tag: hit.tagName, id: hit.id, className: String(hit.className || "") } : null,
        canvasBounds: rect(bounds),
        hudBounds: rect(hudBounds),
        camera: inspection.camera,
      };
    });
    assert(
      mobileMinimapHit?.inViewport && mobileMinimapHit?.hitsCanvas,
      `mobile minimap should be CSS-visible and pointer-accessible: ${JSON.stringify(mobileMinimapHit)}`,
    );
    await page.mouse.click(mobileMinimapHit.clientX, mobileMinimapHit.clientY);
    await eventually(async () => {
      const inspection = await page.evaluate(() => window.__TDOS_PROTOTYPE_INSPECT__?.());
      return inspection?.camera?.centerX > 1440 && inspection?.camera?.centerY > 1440;
    }, 3000);
    await setPlayerTacticalSkill("all_fleet_shield");
    const mobileTacticalButton = page.locator("#mobileTacticalSkillBtn");
    assert(await mobileTacticalButton.isVisible(), "territory mobile tactical button should be visible");
    await mobileTacticalButton.click();
    await eventually(async () => {
      const current = await playerSkillState();
      return current.slot == null && current.effects.some((effect) => effect.skillId === "all_fleet_shield");
    }, 3000);
    await setPlayerTacticalSkill("repair_drones");
    const mobileFleetTargets = page.locator("#mobileBattleHud [data-mobile-tactical-target-seat]");
    assert(await mobileFleetTargets.count() === 3, "mobile repair drones should expose A1/A2/A3 targets in the fixed battle controls");
    await page.evaluate(() => {
      const ship = window.__TDOS_PROTOTYPE_RUNTIME__?.getSimulation?.()?.fleetBySeat?.("A3")?.shipByKey?.("main");
      if (ship) ship.hp = ship.maxHp * 0.5;
    });
    await page.locator('#mobileBattleHud [data-mobile-tactical-target-seat="A3"]').click();
    await eventually(async () => {
      const current = await playerSkillState();
      return current.slot == null && current.effects.some((effect) => effect.skillId === "repair_drones" && effect.targetSeat === "A3");
    }, 3000);
    await setPlayerTacticalSkill("repair_drones");
    await page.screenshot({ path: "artifacts/stellar-territory-loop13-mobile-tactical.png", fullPage: true });
    const minimapPixels = await page.locator("#gameCanvas").evaluate((canvas) => {
      const logical = 1440;
      const minimapSize = Math.max(180, Math.min(230, logical * 0.145));
      const scale = canvas.width / logical;
      const left = Math.floor((logical - minimapSize - 18) * scale);
      const top = Math.floor((logical - minimapSize - 18) * scale);
      const size = Math.floor(minimapSize * scale);
      const data = canvas.getContext("2d").getImageData(left, top, size, size).data;
      let opaque = 0;
      let colored = 0;
      const bins = new Set();
      for (let index = 0; index < data.length; index += 4) {
        const red = data[index];
        const green = data[index + 1];
        const blue = data[index + 2];
        if (data[index + 3] > 0) opaque += 1;
        if (Math.max(red, green, blue) - Math.min(red, green, blue) > 24 && Math.max(red, green, blue) > 75) {
          colored += 1;
          bins.add(`${Math.floor(red / 32)}:${Math.floor(green / 32)}:${Math.floor(blue / 32)}`);
        }
      }
      return { opaque, colored, colorBins: bins.size, size };
    });
    assert(minimapPixels.opaque > 1000 && minimapPixels.colored > 30 && minimapPixels.colorBins >= 4, `territory mobile minimap overlay missing: ${JSON.stringify(minimapPixels)}`);
    await page.screenshot({ path: "artifacts/stellar-territory-loop9-mobile-minimap.png", fullPage: true });
    await page.setViewportSize({ width: 1280, height: 820 });
    await wait(180);

    await page.selectOption("#protoModeSelect", "standard-ai-1v1");
    await page.click("#protoApplyModeBtn");
    await wait(250);
    const cleanup = await page.evaluate(() => ({
      tools: document.querySelector("#protoModeTools")?.textContent || "",
      hud: document.querySelector("#protoModeHud")?.textContent || "",
      mode: window.__TDOS_PROTOTYPE_RUNTIME__?.getModeDefinition?.()?.id,
      desktopTacticalHidden: document.querySelector("#tacticalSkillBtn")?.hidden,
      mobileTacticalHidden: document.querySelector("#mobileTacticalSkillBtn")?.hidden,
      mobileTargetCount: document.querySelectorAll("[data-mobile-tactical-target-seat]").length,
    }));
    assert(cleanup.mode === "standard-ai-1v1", `mode should switch away from territory: ${JSON.stringify(cleanup)}`);
    assert((await page.locator("#protoModeTools .territory-tools").count()) === 0, "territory tools should be cleared after mode switch");
    assert((await page.locator("#protoModeHud .territory-hud").count()) === 0, "territory HUD should be cleared after mode switch");
    assert(cleanup.desktopTacticalHidden && cleanup.mobileTacticalHidden, `tactical buttons should restore hidden state: ${JSON.stringify(cleanup)}`);
    assert(cleanup.mobileTargetCount === 0, `mobile tactical targets should be removed after mode switch: ${JSON.stringify(cleanup)}`);
    assert(pageErrors.length === 0, `browser page errors: ${pageErrors.join(" | ")}`);
    await page.close();
  } finally {
    if (browser) await browser.close();
    if (vite && vite.exitCode === null) vite.kill();
    await wait(100);
    if (vite && vite.exitCode === null) vite.kill("SIGKILL");
  }
  console.log("territory browser verification passed");
}

main();
