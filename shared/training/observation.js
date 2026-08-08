// 强化学习观察契约只暴露玩家席位在同一时刻能够获得的信息。
// 禁止在此模块中引入 BotController，避免把信念图、威胁分数或策略标签混入训练输入。

import { haruhiEsperOrb } from "../game/haruhi-flagship.js";

export const RL_OBSERVATION_SCHEMA_VERSION = 1;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function quantize(value, step) {
  const safeStep = Math.max(Number.EPSILON, finite(step, 1));
  return Number((Math.round(finite(value) / safeStep) * safeStep).toFixed(6));
}

function remaining(until, elapsed) {
  return Math.max(0, finite(until) - finite(elapsed));
}

function point(value = {}) {
  return {
    x: finite(value.x),
    y: finite(value.y),
  };
}

function routeObservation(route) {
  if (!route) return null;
  return {
    anchorToMain: route.anchorToMain !== false,
    p0: point(route.p0),
    p1: point(route.p1),
    p2: point(route.p2),
    progress: finite(route.t),
  };
}

function clawMarkObservation(ship, elapsed, observerSeat) {
  const marks = typeof ship.activeClawMarks === "function"
    ? ship.activeClawMarks()
    : ship.clawMarks || {};
  return {
    sourceRelation: marks.sourceSeat === observerSeat ? "self" : marks.sourceSeat ? "opponent" : null,
    stacks: Math.max(0, finite(marks.stacks)),
    required: Math.max(0, finite(marks.required)),
    expiresIn: remaining(marks.expiresAt, elapsed),
  };
}

function visibleStatus(ship, elapsed) {
  const hasEffect = (key) => (
    typeof ship.hasEffect === "function"
      ? ship.hasEffect(key)
      : finite(ship.effects?.[key]) > elapsed
  );
  return {
    criticalVolley: hasEffect("critUntil"),
    reliable: hasEffect("reliableUntil"),
    bladeQueen: hasEffect("bladeQueenUntil"),
    catPawVolley: hasEffect("catPawUntil"),
    emergencyBraking: typeof ship.isEmergencyBraking === "function"
      ? ship.isEmergencyBraking()
      : hasEffect("brakeUntil"),
    nextShotBoosted: finite(ship.effects?.nextShotDamageMultiplier, 1) > 1,
    knockedBack: Boolean(ship.forcedKnockback),
  };
}

function ownShipObservation(ship, elapsed, observerSeat) {
  const fleetEnergy = typeof ship.team?.fleetEnergyForShip === "function"
    ? ship.team.fleetEnergyForShip(ship)
    : { current: ship.energy, max: ship.maxEnergy };
  return {
    id: ship.id,
    kind: "ship",
    controlKey: String(ship.key || ship.slotKey || ""),
    slotToken: String(ship.slotKey || ship.key || ""),
    characterToken: String(ship.characterId || "unknown"),
    flagship: ship.key === "main",
    auxiliary: Boolean(ship.isAuxiliary),
    alive: Boolean(ship.alive),
    attached: typeof ship.isAttached === "function" ? ship.isAttached() : Boolean(ship.attached),
    controllable: typeof ship.canControl === "function" ? ship.canControl() : Boolean(ship.canControl),
    x: finite(ship.x),
    y: finite(ship.y),
    angle: finite(ship.angle),
    speed: finite(ship.speed),
    radius: finite(ship.radius),
    throttle: finite(ship.throttle),
    hp: finite(ship.hp),
    maxHp: finite(ship.maxHp),
    energy: finite(ship.energy),
    maxEnergy: finite(ship.maxEnergy),
    fleetEnergy: finite(fleetEnergy.current),
    fleetMaxEnergy: finite(fleetEnergy.max),
    weaponCooldown: Math.max(0, finite(ship.cooldown)),
    skillCooldown: Math.max(0, finite(
      ship.key === "main" ? ship.team?.cooldowns?.flagship : ship.team?.cooldowns?.[ship.key],
    )),
    brakeCooldown: remaining(ship.effects?.brakeCooldownUntil, elapsed),
    limits: {
      speed: finite(typeof ship.effectiveSpeed === "function" ? ship.effectiveSpeed() : ship.base?.speed),
      turnRate: finite(typeof ship.effectiveTurnRate === "function" ? ship.effectiveTurnRate() : ship.base?.turnRate),
      acceleration: finite(typeof ship.baseAcceleration === "function" ? ship.baseAcceleration() : ship.base?.accel),
      vision: finite(typeof ship.effectiveVision === "function" ? ship.effectiveVision() : ship.vision),
      range: finite(typeof ship.effectiveRange === "function" ? ship.effectiveRange() : ship.range),
      damage: finite(typeof ship.effectiveDamage === "function" ? ship.effectiveDamage() : ship.base?.damage),
      fireRate: finite(typeof ship.effectiveFireRate === "function" ? ship.effectiveFireRate() : ship.base?.fireRate),
    },
    status: visibleStatus(ship, elapsed),
    clawMarks: clawMarkObservation(ship, elapsed, observerSeat),
    route: routeObservation(ship.route),
  };
}

function visibleEnemyShipObservation(ship, elapsed, observerSeat) {
  return {
    id: ship.id,
    kind: "ship",
    characterToken: ship.nameRevealed ? String(ship.characterId || "unknown") : null,
    characterConfirmed: Boolean(ship.nameRevealed),
    alive: Boolean(ship.alive),
    attached: typeof ship.isAttached === "function" ? ship.isAttached() : Boolean(ship.attached),
    x: finite(ship.x),
    y: finite(ship.y),
    angle: finite(ship.angle),
    speed: finite(ship.speed),
    radius: finite(ship.radius),
    hp: finite(ship.hp),
    maxHp: finite(ship.maxHp),
    energy: finite(ship.energy),
    maxEnergy: finite(ship.maxEnergy),
    status: visibleStatus(ship, elapsed),
    clawMarks: clawMarkObservation(ship, elapsed, observerSeat),
  };
}

function auxiliaryObservation(entity, { own = false } = {}) {
  const observation = {
    id: entity.id,
    kind: entity.kind === "wingman" ? "wingman" : "scout",
    alive: Boolean(entity.alive),
    x: finite(entity.x),
    y: finite(entity.y),
    angle: finite(entity.angle),
    speed: finite(entity.speed),
    radius: finite(entity.radius),
    hp: finite(entity.hp),
    maxHp: finite(entity.maxHp),
    vision: finite(entity.vision),
  };
  if (own) {
    observation.life = Math.max(0, finite(entity.life));
    observation.combatCapable = Boolean(entity.combatCapable || entity.kind === "wingman");
    observation.weaponCooldown = Math.max(0, finite(entity.cooldown));
  }
  return observation;
}

function publicProjectileObservation(projectile, ownSeat) {
  return {
    id: projectile.id,
    kind: "projectile",
    relation: projectile.team?.seat === ownSeat || projectile.teamSeat === ownSeat ? "self" : "opponent",
    x: finite(projectile.x),
    y: finite(projectile.y),
    targetX: finite(projectile.targetX),
    targetY: finite(projectile.targetY),
    speed: finite(projectile.speed),
    radius: finite(projectile.radius),
    visualToken: String(projectile.visualKind || "shell"),
  };
}

function publicBeamObservation(beam, relation) {
  return {
    id: beam.id,
    kind: "beam",
    relation,
    phaseToken: String(beam.phase || "fire"),
    x1: finite(beam.x1),
    y1: finite(beam.y1),
    x2: finite(beam.x2),
    y2: finite(beam.y2),
    progress: finite(beam.progress, 1),
    life: Math.max(0, finite(beam.life)),
    maxLife: Math.max(0, finite(beam.maxLife || beam.life)),
  };
}

function publicWaveObservation(wave, relation) {
  return {
    id: wave.id,
    kind: "vision_wave",
    relation,
    x: finite(wave.x),
    y: finite(wave.y),
    emittedAt: finite(wave.emittedAt),
    speed: finite(wave.speed),
    width: finite(wave.width),
    expiresAt: finite(wave.expiresAt),
  };
}

function privateRadarObservation(simulation, seat) {
  const serialized = simulation.serializeRadarForSeat(seat);
  if (!serialized?.active) return null;
  return {
    active: true,
    angle: finite(serialized.angle),
    angularVelocity: finite(serialized.angularVelocity),
    rotationSeconds: finite(serialized.rotationSeconds),
    sampledAt: finite(serialized.sampledAt),
    contacts: (serialized.contacts || []).map((contact) => ({
      // 使用本次回波种子作为临时标识，不暴露关联真实实体的 targetId。
      contactToken: String(contact.seed ?? `${contact.detectedAt}:${contact.x}:${contact.y}`),
      x: finite(contact.x),
      y: finite(contact.y),
      angle: finite(contact.angle),
      echoToken: String(contact.kind || "disturbance"),
      characterToken: contact.characterId ? String(contact.characterId) : null,
      // 清晰度和误差只以画面可辨别的粗粒度给出，避免从公式反解真实距离。
      clarity: quantize(contact.clarity, 0.05),
      uncertainty: quantize(contact.uncertainty, 5),
      detectedAt: finite(contact.detectedAt),
      expiresAt: finite(contact.expiresAt),
    })),
  };
}

function ownTeamEffects(team, elapsed) {
  return {
    accelerationBoost: finite(team.effects?.taxiUntil) > elapsed,
    invulnerable: finite(team.effects?.taxiInvulnUntil) > elapsed,
    sponsor: finite(team.effects?.sponsorUntil) > elapsed,
    visionWave: finite(team.visionWaveSkill?.activeUntil) > elapsed,
    haruhiBroadcast: finite(team.effects?.haruhiBoostUntil) > elapsed,
  };
}

function ownHaruhiState(team) {
  const state = team.haruhiFlagship;
  if (!state) return null;
  return {
    supportTokens: [...(state.supporters || [])].map(String).sort(),
    otherworlderReady: typeof team.mainCharacterId === "function"
      && team.mainCharacterId() === "haruhi"
      && finite(state.otherworlderReadyAt) <= team.match.elapsed,
  };
}

function visibleEnemyEntities(team, visibleIds, elapsed, observerSeat) {
  const result = [];
  for (const entity of team.getEntities()) {
    if (!visibleIds.has(entity.id)) continue;
    result.push(entity.kind === "ship"
      ? visibleEnemyShipObservation(entity, elapsed, observerSeat)
      : auxiliaryObservation(entity));
  }
  return result;
}

function ownEntities(team, elapsed, observerSeat) {
  return [
    ...team.getAllShips().map((ship) => ownShipObservation(ship, elapsed, observerSeat)),
    ...team.scouts.filter((entity) => entity.alive).map((entity) => auxiliaryObservation(entity, { own: true })),
    ...team.wingmen.filter((entity) => entity.alive).map((entity) => auxiliaryObservation(entity, { own: true })),
  ];
}

function visibleEnemyEsperOrb(enemyTeam, visibleIds) {
  const main = enemyTeam.ships?.main;
  if (!main?.alive || !visibleIds.has(main.id)) return null;
  const orb = haruhiEsperOrb(enemyTeam);
  return orb ? {
    x: finite(orb.x),
    y: finite(orb.y),
    angle: finite(orb.angle),
    radius: finite(orb.radius),
    absorbRadius: finite(orb.absorbRadius),
  } : null;
}

/**
 * 构建某个玩家席位的公平原始观察。返回值只含普通对象/数组，便于跨进程传输。
 */
export function buildRlObservation(simulation, seat) {
  if (!simulation || (seat !== "A" && seat !== "B")) {
    throw new TypeError("强化学习观察需要有效的模拟器与席位");
  }
  const ownTeam = simulation.teamBySeat(seat);
  const enemyTeam = simulation.enemyTeamBySeat(seat);
  const elapsed = finite(simulation.elapsed);
  const visibleIds = new Set(ownTeam.visibleEnemyIds || []);

  return {
    schemaVersion: RL_OBSERVATION_SCHEMA_VERSION,
    perspective: "self",
    world: {
      width: finite(simulation.worldSize),
      height: finite(simulation.worldSize),
      padding: finite(simulation.mapPadding),
      elapsed,
      phaseToken: String(simulation.phase || "running"),
      zones: (simulation.zones || []).map((zone) => ({
        id: zone.id,
        x: finite(zone.x),
        y: finite(zone.y),
        width: finite(zone.width),
        height: finite(zone.height),
      })),
    },
    self: {
      splitLevel: Math.max(0, finite(ownTeam.splitLevel)),
      flagshipCharacterToken: String(ownTeam.mainCharacterId?.() || "unknown"),
      futureFormToken: ownTeam.future1096Form ? String(ownTeam.future1096Form) : null,
      cooldowns: {
        scout: Math.max(0, finite(ownTeam.cooldowns?.scout)),
        flagship: Math.max(0, finite(ownTeam.cooldowns?.flagship)),
      },
      skillsDisabled: Boolean(ownTeam.areSkillsDisabled?.()),
      scoutsDisabled: Boolean(ownTeam.areScoutsDisabled?.()),
      effects: ownTeamEffects(ownTeam, elapsed),
      haruhi: ownHaruhiState(ownTeam),
      entities: ownEntities(ownTeam, elapsed, seat),
    },
    opponent: {
      visibleEntities: visibleEnemyEntities(enemyTeam, visibleIds, elapsed, seat),
      visibleEsperOrb: visibleEnemyEsperOrb(enemyTeam, visibleIds),
    },
    publicEffects: {
      projectiles: simulation.projectiles
        .filter((projectile) => projectile.alive !== false)
        .map((projectile) => publicProjectileObservation(projectile, seat)),
      beams: [
        ...ownTeam.beams.map((beam) => publicBeamObservation(beam, "self")),
        ...enemyTeam.beams.map((beam) => publicBeamObservation(beam, "opponent")),
      ],
      visionWaves: [
        ...ownTeam.visionWaveSkill.waves.map((wave) => publicWaveObservation(wave, "self")),
        ...enemyTeam.visionWaveSkill.waves.map((wave) => publicWaveObservation(wave, "opponent")),
      ],
    },
    privateSensors: {
      radar: privateRadarObservation(simulation, seat),
    },
  };
}
