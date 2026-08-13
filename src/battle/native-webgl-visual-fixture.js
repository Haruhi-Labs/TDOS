import { MatchSimulation } from "../../shared/game-core.js";
import { drawBattleWorld } from "./render.js";
import { createShipDestructionEffects } from "../ship-destruction-effects.js";

export const VISUAL_FIXTURE_TIME = 12.4;

function setShip(ship, options) {
  Object.assign(ship, {
    alive: true,
    attached: false,
    speed: 78,
    ...options,
  });
}

function projectile(id, teamSeat, x, y, targetX, targetY, visualKind = null) {
  return {
    id,
    alive: true,
    teamSeat,
    x,
    y,
    targetX,
    targetY,
    speed: 260,
    radius: visualKind ? 3.4 : 2.5,
    color: teamSeat === "A" ? "#9be8ff" : "#ffc0bd",
    visualKind,
  };
}

export function createNativeBattleVisualFixture() {
  const simulation = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    teamLoadouts: {
      A: { main: "yuki", sub1: "koizumi", sub2: "asakura" },
      B: { main: "haruhi", sub1: "future1096", sub2: "shamisen" },
    },
  });
  simulation.elapsed = VISUAL_FIXTURE_TIME;
  const state = simulation.serializeState();
  state.elapsed = VISUAL_FIXTURE_TIME;
  const teamA = state.teams.A;
  const teamB = state.teams.B;
  setShip(teamA.ships.main, {
    x: 380,
    y: 420,
    angle: 0.18,
    nameRevealed: true,
    route: {
      p0: { x: 380, y: 420 },
      p1: { x: 520, y: 260 },
      p2: { x: 720, y: 380 },
      t: 0.43,
    },
  });
  setShip(teamA.ships.sub1, {
    x: 420,
    y: 760,
    angle: -0.72,
    koizumiOrb: { active: true, phase: "active", angularVelocity: 1.7 },
  });
  setShip(teamA.ships.sub2, {
    x: 610,
    y: 610,
    angle: 0.9,
    bladeQueen: true,
  });
  setShip(teamB.ships.main, {
    x: 1050,
    y: 760,
    angle: Math.PI + 0.2,
    nameRevealed: true,
    haruhiImpactReady: true,
  });
  setShip(teamB.ships.sub1, {
    x: 890,
    y: 420,
    angle: Math.PI - 0.45,
    silenced: true,
    heroPowerShock: {
      active: true,
      controlLocked: false,
      lockRemaining: 0,
      recoveryRemaining: 2.6,
      speedFactor: 0.35,
    },
    nameRevealed: true,
  });
  setShip(teamB.ships.sub2, {
    x: 1120,
    y: 410,
    angle: Math.PI,
    nameRevealed: true,
    clawMarks: { stacks: 4, required: 5, color: "#ffd0e4" },
  });
  teamA.shamisenHunt = {
    targetId: teamB.ships.sub2.id,
    sequence: 2,
    damageMultiplier: 2,
  };

  teamA.koizumiBarrier = {
    active: true,
    x: teamA.ships.main.x,
    y: teamA.ships.main.y,
    radius: 210,
    recoveryAge: 0,
    recoveryProgress: 1,
  };
  teamA.visionWaves = [{
    id: 71,
    x: teamA.ships.sub2.x,
    y: teamA.ships.sub2.y,
    emittedAt: VISUAL_FIXTURE_TIME - 1.1,
    expiresAt: VISUAL_FIXTURE_TIME + 1.2,
    speed: 320,
    width: 42,
  }];
  teamB.haruhiFlagship.esperOrb = {
    x: 1050,
    y: 610,
    radius: 10,
    absorbRadius: 30,
  };
  teamA.scouts = [{ id: 81, alive: true, x: 650, y: 300, angle: 0.4, vision: 180 }];
  teamB.scouts = [{ id: 82, alive: true, x: 820, y: 720, angle: 2.4, vision: 180 }];
  teamA.wingmen = [{ id: 91, alive: true, x: 470, y: 380, angle: 0.1 }];
  teamB.wingmen = [{ id: 92, alive: true, x: 990, y: 700, angle: 3.1 }];
  teamA.beams = [{
    id: 101,
    phase: "charge",
    life: 0.7,
    maxLife: 1.05,
    progress: 0.34,
    x1: 380,
    y1: 420,
    x2: 1040,
    y2: 560,
    color: "#8ef8ff",
  }];
  teamB.beams = [{
    id: 102,
    phase: "fire",
    life: 0.2,
    maxLife: 0.26,
    x1: 1120,
    y1: 410,
    x2: 610,
    y2: 610,
    color: "#ff9ab2",
  }];
  state.projectiles = [
    projectile(111, "A", 700, 480, 1100, 520),
    projectile(112, "A", 740, 500, 1100, 600, "cat_paw"),
    projectile(113, "B", 860, 570, 420, 620),
  ];
  state.bursts = [{ id: 121, x: 760, y: 570, radius: 16, life: 0.24, color: "#ffdb9b" }];
  state.haruhiHeroPowerEffects = [{
    id: 124,
    teamSeat: "A",
    casterShipId: teamA.ships.sub2.id,
    phase: "shock",
    x: 760,
    y: 1010,
    radius: 240,
    progress: 0.42,
    life: 0.67,
    maxLife: 1.15,
    hitShipIds: [teamB.ships.sub1.id],
    destroyedAircraftIds: [],
  }];
  state.shamisenHuntKillEffects = [{
    id: 126,
    hunterSeat: "A",
    targetId: 9990,
    x: 820,
    y: 880,
    radius: 16,
    seed: 12.7,
    life: 1.02,
    maxLife: 1.65,
  }];
  state.koizumiBarrierImpacts = [{
    id: 131,
    kind: "projectile",
    teamSeat: "A",
    sourceSeat: "B",
    x: 580,
    y: 420,
    centerX: 380,
    centerY: 420,
    radius: 210,
    angle: 0,
    normalX: 1,
    normalY: 0,
    life: 0.38,
    maxLife: 0.62,
  }];
  state.floatingTexts = [
    { id: 141, x: 610, y: 560, text: "-16", color: "#ffb7a8", life: 0.55, maxLife: 0.8 },
    {
      id: 142,
      x: 720,
      y: 180,
      text: "我在这里！",
      color: "#ffe59a",
      emphasis: "announcement",
      life: 1.8,
      maxLife: 2.4,
    },
  ];

  const radar = {
    ...simulation.serializeRadarForSeat("A"),
    angle: -0.8,
    sampledAt: VISUAL_FIXTURE_TIME,
    contacts: [
      {
        id: 151,
        targetId: 9991,
        x: 940,
        y: 300,
        angle: 2.7,
        detectedAt: VISUAL_FIXTURE_TIME - 0.5,
        expiresAt: VISUAL_FIXTURE_TIME + 1.4,
        clarity: 0.8,
        uncertainty: 26,
        kind: "afterimage",
        characterId: "haruhi",
        seed: 23,
      },
      {
        id: 152,
        targetId: 9992,
        x: 1180,
        y: 980,
        angle: 0,
        detectedAt: VISUAL_FIXTURE_TIME - 0.7,
        expiresAt: VISUAL_FIXTURE_TIME + 1.3,
        clarity: 0.24,
        uncertainty: 120,
        kind: "disturbance",
        seed: 37,
      },
    ],
  };

  const frame = {
    state,
    ownTeam: teamA,
    enemyTeam: teamB,
    spectating: false,
    radar,
    visibleEnemyIds: new Set(Object.values(teamB.ships).map((ship) => ship.id)),
    selectedKeyForTeam: (team) => (team === teamA ? "main" : null),
    routeForShip: (_team, ship) => ship.route || null,
    mobileMode: false,
    stars: Array.from({ length: 90 }, (_, index) => ({
      x: (index * 157 + 43) % 1440,
      y: (index * 269 + 89) % 1440,
      r: 0.6 + (index % 4) * 0.35,
      p: index * 0.73,
    })),
    destructionEffects: createShipDestructionEffects(),
    selectedZoneId: 5,
    pendingSubSkillAim: { shipKey: "sub2" },
    pointer: { x: 790, y: 850 },
  };
  return { state, frame };
}

export function renderNativeBattleVisualFixture(ctx) {
  const fixture = createNativeBattleVisualFixture();
  drawBattleWorld(ctx, fixture.frame);
  return fixture;
}
