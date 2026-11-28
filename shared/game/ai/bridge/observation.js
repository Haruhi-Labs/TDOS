import { hasShamisenFlagship } from "../../characters/shamisen/hunt.js";
// 规则层到 AI 的唯一读取出口：把实时对局对象翻译成某一席位有权知道的纯数据。
// 这里可以接触 Team/Ship 实例；AI 决策代码只消费本模块产出的观测。
import { nextBunnyForm } from "../../characters/bunny-haruhi/rules.js";
import { bunnyTransformBlockReason } from "../../characters/bunny-haruhi/form-port.js";
import { haruhiOtherworlderReady } from "../../characters/haruhi/flagship.js";
import { koizumiBarrierGeometry } from "../../characters/koizumi/barrier.js";
import { distance } from "../../foundation/math.js";
import { freezePlainData } from "../../../data/plain-data.js";

export const OBSERVATION_SCHEMA = 1;
export const MULTI_FLEET_OBSERVATION_SCHEMA = "multi-fleet-ai-v1";

function remaining(until, now) {
  return Math.max(0, Number(until || 0) - now);
}

function primitiveFields(source) {
  const output = {};
  for (const [key, value] of Object.entries(source || {})) {
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
      output[key] = value;
    }
  }
  return output;
}

// 只把玩家同样能从可见舰船上判断出的技能状态写进可见实体；雷达接触不会调用这里，
// 因而角色战术层不会借服务端对象越过战争迷雾读取隐藏技能。
export function snapshotVisibleCharacterTactics(entity, now) {
  const orb = entity?.koizumiOrb;
  const barrier = entity?.slotKey === "main" && entity.characterId === "koizumi"
    ? koizumiBarrierGeometry(entity.team)
    : null;
  return {
    ...(entity?.bunnyStageExposure?.inside ? { bunnyStagePhase: entity.bunnyStageExposure.phase } : {}),
    ...(entity?.slotKey === "main" && entity.characterId === "bunny_haruhi"
      ? { bunnyStageRadius: entity.team.areSkillsDisabled() ? 0 : entity.effectiveVision() }
      : {}),
    bladeQueenRemaining: remaining(entity?.effects?.bladeQueenUntil, now),
    catPawRemaining: remaining(entity?.effects?.catPawUntil, now),
    koizumiOrbRemaining: orb
      ? orb.phase === "active"
        ? remaining(orb.activeUntil, now)
        : 3
      : 0,
    haruhiImpactReady: Boolean(
      entity?.slotKey === "main"
      && entity.characterId === "haruhi"
      && haruhiOtherworlderReady(entity.team),
    ),
    haruhiSupportCount: entity?.slotKey === "main" && entity.characterId === "haruhi"
      ? Number(entity.team?.haruhiFlagship?.supporters?.size || 0)
      : 0,
    haruhiBoostActive: Boolean(
      entity?.slotKey === "main"
      && entity.characterId === "haruhi"
      && Number(entity.team?.effects?.haruhiBoostUntil || 0) > now,
    ),
    future1096Form: entity?.slotKey === "main" && entity.characterId === "future1096"
      ? entity.team?.future1096Form || null
      : null,
    koizumiBarrierActive: Boolean(barrier?.active),
    koizumiBarrierRadius: barrier?.radius || 0,
    koizumiBarrierDisabledRemaining: barrier?.disabledRemaining || 0,
  };
}

// 时间相关字段保留绝对时间戳，由决策侧与观测时间比较，避免换算改变浮点结果。
export function observeEnemyEntity(entity, now) {
  return {
    id: entity.id,
    kind: entity.kind ?? null,
    key: entity.key ?? null,
    slotKey: entity.slotKey ?? null,
    characterId: entity.characterId ?? null,
    x: entity.x,
    y: entity.y,
    angle: entity.angle ?? null,
    speed: entity.speed ?? null,
    hp: entity.hp ?? null,
    maxHp: entity.maxHp ?? null,
    radius: entity.radius ?? null,
    combatCapable: Boolean(entity.combatCapable),
    pattern: entity.pattern ?? null,
    effects: {
      reliableUntil: entity.effects?.reliableUntil ?? null,
      bladeQueenUntil: entity.effects?.bladeQueenUntil ?? null,
      nextShotDamageMultiplier: entity.effects?.nextShotDamageMultiplier ?? null,
    },
    tactics: snapshotVisibleCharacterTactics(entity, now),
  };
}

function observeBunnyState(ship) {
  const state = ship.bunnyHaruhi;
  if (!state) return null;
  return {
    form: state.form ?? null,
    nextForm: nextBunnyForm(state),
    companionSpawned: Boolean(state.companionSpawned),
    companionAlive: ship.team.extraShips.some((unit) => unit.id === state.companionId && unit.alive),
    positiveSuppressed: Boolean(state.positiveSuppressed),
    transformBlocked: Boolean(bunnyTransformBlockReason(ship)),
  };
}

export function observeOwnShip(ship) {
  const team = ship.team;
  const pool = team.fleetEnergyForShip(ship);
  const exposure = ship.bunnyStageExposure;
  const orb = ship.koizumiOrb;
  return {
    id: ship.id,
    key: ship.key,
    slotKey: ship.slotKey ?? null,
    characterId: ship.characterId,
    isAuxiliary: Boolean(ship.isAuxiliary),
    alive: Boolean(ship.alive),
    x: ship.x,
    y: ship.y,
    angle: ship.angle,
    speed: ship.speed,
    radius: ship.radius,
    hp: ship.hp,
    maxHp: ship.maxHp,
    energy: ship.energy,
    maxEnergy: ship.maxEnergy,
    throttle: ship.throttle,
    attached: ship.isAttached(),
    canControl: ship.canControl(),
    silenced: ship.isSilenced(),
    koizumiOrbActive: ship.isKoizumiOrbActive(),
    teamSkillsDisabled: team.areSkillsDisabled(),
    route: ship.route
      ? { p2: { x: ship.route.p2.x, y: ship.route.p2.y }, t: ship.route.t }
      : null,
    stats: {
      range: ship.effectiveRange(),
      vision: ship.effectiveVision(),
      damage: ship.effectiveDamage(),
      fireRate: ship.effectiveFireRate(),
      baseSpeed: ship.baseSpeed(),
      energyRegen: ship.baseEnergyRegen(),
      moveDrain: ship.moveEnergyDrain(),
    },
    fleet: {
      memberIds: team.fleetMembersForShip(ship).map((member) => member.id),
      energy: pool.current,
      maxEnergy: pool.max,
    },
    effects: primitiveFields(ship.effects),
    koizumiOrb: orb
      ? { phase: orb.phase ?? null, cruiseSpeed: orb.cruiseSpeed ?? null, activeUntil: orb.activeUntil ?? null }
      : null,
    bunny: observeBunnyState(ship),
    stageExposure: exposure
      ? { inside: Boolean(exposure.inside), phase: exposure.phase ?? null, enteredAt: exposure.enteredAt ?? null }
      : null,
  };
}

function observeOwnScout(scout) {
  return {
    id: scout.id,
    x: scout.x,
    y: scout.y,
    alive: Boolean(scout.alive),
    combatCapable: Boolean(scout.combatCapable),
    zoneId: scout.zone?.id ?? null,
    life: scout.life,
    mode: scout.mode ?? null,
    mission: scout.mission ?? null,
    radius: scout.radius,
  };
}

function observeOwnWingman(wingman) {
  return {
    id: wingman.id,
    x: wingman.x,
    y: wingman.y,
    alive: Boolean(wingman.alive),
    hp: wingman.hp,
    maxHp: wingman.maxHp,
    radius: wingman.radius,
  };
}

function resolveRegisteredTeam(match, seat, actionLabel) {
  if (typeof seat !== "string" || seat.length === 0) {
    throw new Error(`无法为未知席位${actionLabel}：${String(seat)}`);
  }
  const team = typeof match?.teamBySeat === "function" ? match.teamBySeat(seat) : null;
  if (!team || team.seat !== seat) {
    throw new Error(`无法为未知席位${actionLabel}：${seat}`);
  }
  return team;
}

export function isLegacyTwoFleetMatch(match) {
  if (typeof match?.allTeams !== "function") {
    return typeof match?.enemyTeamBySeat === "function";
  }
  const teams = match.allTeams();
  if (!Array.isArray(teams) || teams.length !== 2) return false;
  if (teams[0]?.seat !== "A" || teams[1]?.seat !== "B") return false;
  if (typeof match.enemyTeamsOf === "function") {
    const enemiesOfA = match.enemyTeamsOf("A");
    const enemiesOfB = match.enemyTeamsOf("B");
    return enemiesOfA.length === 1 && enemiesOfA[0]?.seat === "B"
      && enemiesOfB.length === 1 && enemiesOfB[0]?.seat === "A";
  }
  return teams[0].sideId !== teams[1].sideId;
}

function resolveEnemyTeams(match, seat) {
  if (typeof match?.enemyTeamsOf === "function") {
    return match.enemyTeamsOf(seat);
  }
  if (typeof match?.enemyTeamBySeat === "function") {
    return [match.enemyTeamBySeat(seat)];
  }
  return [];
}

function resolveAlliedTeams(match, seat) {
  if (typeof match?.alliedTeamsOf === "function") {
    return match.alliedTeamsOf(seat);
  }
  return [];
}

function cloneVisionSources(visionSources) {
  return (visionSources || []).map((source) => primitiveFields(source));
}

function observeAllySummary(ally) {
  const ships = ally.getAllShips();
  return {
    seat: ally.seat,
    sideId: ally.sideId,
    alive: Boolean(ally.hasLivingShips()),
    aliveShipCount: ships.filter((ship) => ship && ship.alive).length,
    hullRatio: ally.hullRatio(),
  };
}

// 敌方旗舰的出生点对称且公开，仅在旧双舰队 AI 建立初始情报时读取一次。
export function observeEnemySpawn(match, seat) {
  resolveRegisteredTeam(match, seat, "读取敌方出生点");
  if (!isLegacyTwoFleetMatch(match)) {
    throw new Error(`单敌方出生点接口仅适用于旧双舰队拓扑，多席拓扑请改用公开出生集合接口（席位：${seat}）`);
  }
  const enemyMain = match.enemyTeamBySeat(seat).ships.main;
  return {
    id: enemyMain.id,
    key: enemyMain.key,
    slotKey: enemyMain.slotKey,
    x: enemyMain.x,
    y: enemyMain.y,
    angle: enemyMain.angle,
  };
}

// 公开敌方出生事实集合：仅在模式显式允许公开出生点时提供，且多席模式只读取开局冻结坐标，绝不推测隐藏实时坐标。
export function observeEnemySpawns(match, seat) {
  resolveRegisteredTeam(match, seat, "读取公开敌方出生集合");
  const isLegacy = isLegacyTwoFleetMatch(match);
  const publicAllowed = isLegacy
    ? match.publicEnemySpawns !== false
    : Boolean(match.publicEnemySpawns === true || match.rules?.publicEnemySpawns === true);
  if (!publicAllowed) {
    return null;
  }

  const topologyFleets = Array.isArray(match.topology?.fleets) ? match.topology.fleets : null;
  const spawnBySeat = new Map();
  if (topologyFleets) {
    for (const fleet of topologyFleets) {
      if (fleet && typeof fleet.seat === "string" && fleet.spawn) {
        spawnBySeat.set(fleet.seat, fleet.spawn);
      }
    }
  }

  const enemies = resolveEnemyTeams(match, seat);
  const result = [];
  for (const enemy of enemies) {
    const enemyMain = enemy.ships.main;
    const frozenSpawn = spawnBySeat.get(enemy.seat);
    if (!isLegacy && !frozenSpawn) {
      return null;
    }
    result.push({
      seat: enemy.seat,
      sideId: enemy.sideId,
      id: enemyMain.id,
      key: enemyMain.key,
      slotKey: enemyMain.slotKey,
      x: frozenSpawn ? frozenSpawn.x : enemyMain.x,
      y: frozenSpawn ? frozenSpawn.y : enemyMain.y,
      angle: frozenSpawn ? frozenSpawn.facing : enemyMain.angle,
      sourceType: "public_spawn",
    });
  }
  return freezePlainData(result);
}

function buildLegacyObservation(match, seat) {
  const team = resolveRegisteredTeam(match, seat, "构建 AI 观测");
  const enemy = match.enemyTeamBySeat(seat);
  const now = match.elapsed;
  const visibleIds = team.visibleEnemyIds;
  const visionSources = team.getVisionSources();
  const enemyShips = enemy.getAllShips();

  const visible = [];
  let visibleShipCount = 0;
  for (const entity of enemy.getEntities()) {
    if (!visibleIds.has(entity.id)) continue;
    visible.push(observeEnemyEntity(entity, now));
    if (entity.kind === "ship") visibleShipCount += 1;
  }

  // 只收录己方任一视野源覆盖到的敌方弹体。
  const projectiles = [];
  for (const projectile of match.projectiles || []) {
    if (!projectile || !projectile.alive || projectile.team === team) continue;
    if (!visionSources.some((source) => distance(projectile.x, projectile.y, source.x, source.y) <= source.range)) {
      continue;
    }
    projectiles.push({
      x: projectile.x,
      y: projectile.y,
      targetX: projectile.targetX,
      targetY: projectile.targetY,
    });
  }

  // 雷达接触本身带位置误差；已击沉目标的残留接触在这里剔除，不向 AI 暴露敌舰实体。
  let radar = null;
  if (team.hasYukiFlagship()) {
    const aliveIds = new Set(enemyShips.filter((ship) => ship.alive).map((ship) => ship.id));
    radar = {
      contacts: (team.serializeRadarPassive()?.contacts || [])
        .filter((contact) => aliveIds.has(Number(contact?.targetId ?? contact?.id)))
        .map((contact) => primitiveFields(contact)),
    };
  }

  // 猫爪印记对猎杀方持续显示精确位置，但不暴露角色、席位、血量或朝向。
  let hunt = null;
  if (hasShamisenFlagship(team)) {
    const targetId = team.shamisenHunt?.targetId;
    const target = enemyShips.find((ship) => ship?.alive && ship.id === targetId);
    if (target) {
      hunt = { targetId: target.id, x: target.x, y: target.y, visible: visibleIds.has(target.id) };
    }
  }
  let hunted = null;
  if (hasShamisenFlagship(enemy)) {
    const targetId = enemy.shamisenHunt?.targetId;
    const ship = team.getAllShips().find((candidate) => candidate?.alive && candidate.id === targetId);
    if (ship) hunted = { shipId: ship.id, shipKey: ship.key };
  }

  const waveState = enemy.visionWaveSkill;

  return {
    schema: OBSERVATION_SCHEMA,
    tick: match.tick,
    time: now,
    world: {
      size: match.worldSize,
      mapPadding: match.mapPadding,
      zones: match.zones.map((zone) => ({ ...zone })),
    },
    rules: {
      bunnyStage: Boolean(match.bunnyHaruhiActive),
    },
    self: {
      seat,
      loadout: { main: team.loadout.main, sub1: team.loadout.sub1, sub2: team.loadout.sub2 },
      flags: {
        yukiFlagship: team.hasYukiFlagship(),
        kyonFlagship: team.hasKyonFlagship(),
        shamisenFlagship: Boolean(hasShamisenFlagship(team)),
      },
      splitLevel: team.splitLevel,
      hullRatio: team.hullRatio(),
      cooldowns: {
        scout: team.cooldowns.scout,
        flagship: team.cooldowns.flagship,
        sub1: team.cooldowns.sub1,
        sub2: team.cooldowns.sub2,
      },
      scoutsDisabled: team.areScoutsDisabled(),
      skillsDisabled: team.areSkillsDisabled(),
      future1096Form: team.future1096Form ?? null,
      ships: {
        main: observeOwnShip(team.ships.main),
        sub1: observeOwnShip(team.ships.sub1),
        sub2: observeOwnShip(team.ships.sub2),
      },
      extraShips: team.extraShips.map(observeOwnShip),
      scouts: team.scouts.map(observeOwnScout),
      wingmen: team.wingmen.map(observeOwnWingman),
      visionSources,
      radar,
      hunt,
      hunted,
      koizumiBarrier: koizumiBarrierGeometry(team),
      haruhiOtherworlderReady: Boolean(haruhiOtherworlderReady(team)),
    },
    enemy: {
      visible,
      // 敌方编队增益只有在至少看见一艘敌舰时才可判断。
      visibleTeamBuffs: visibleShipCount > 0
        ? {
            sponsorUntil: enemy.effects.sponsorUntil,
            haruhiBoostUntil: enemy.effects.haruhiBoostUntil,
            visionWaveActiveUntil: enemy.visionWaveSkill.activeUntil,
          }
        : null,
      // 视野波的波纹对双方公开。
      visionWave: waveState
        ? {
            activeUntil: waveState.activeUntil,
            nextPulseAt: waveState.nextPulseAt,
            pulsesRemaining: waveState.pulsesRemaining,
            waves: waveState.waves.map((wave) => primitiveFields(wave)),
          }
        : null,
      projectiles,
    },
    // 现状中未经迷雾过滤的读取集中在此，行为保持不变，后续可逐项评估关闭。
    privileged: {
      enemyHullRatio: enemy.hullRatio(),
      enemyAliveCount: enemyShips.filter((ship) => ship && ship.alive).length,
      enemyHasKyonFlagship: enemy.hasKyonFlagship(),
      hasHiddenEnemyShip: enemyShips.some((ship) => ship.alive && !visibleIds.has(ship.id)),
    },
  };
}

// 多敌对舰队观测 DTO：显式 schema 标识、按来源归属敌对效果、队友仅公开许可摘要、不扩大旧 1v1 跨迷雾特权。
export function buildMultiFleetObservation(match, seat) {
  const team = resolveRegisteredTeam(match, seat, "构建多舰队 AI 观测");
  const allies = resolveAlliedTeams(match, seat);
  const enemies = resolveEnemyTeams(match, seat);
  const enemySeatSet = new Set(enemies.map((enemy) => enemy.seat));
  const now = match.elapsed;
  const visibleIds = team.visibleEnemyIds;
  const visionSources = cloneVisionSources(team.getVisionSources());
  const ownShips = team.getAllShips();

  const visibleHostiles = [];
  const visibleShipCountBySeat = new Map();
  const aliveEnemyShips = [];
  for (const enemyTeam of enemies) {
    let visibleShipCount = 0;
    for (const entity of enemyTeam.getEntities()) {
      if (!entity || !entity.alive || !visibleIds.has(entity.id)) continue;
      visibleHostiles.push({
        ...observeEnemyEntity(entity, now),
        sourceSeat: enemyTeam.seat,
        sourceSideId: enemyTeam.sideId,
        sourceType: "vision",
      });
      if (entity.kind === "ship") visibleShipCount += 1;
    }
    visibleShipCountBySeat.set(enemyTeam.seat, visibleShipCount);
    for (const ship of enemyTeam.getAllShips()) {
      if (ship && ship.alive) aliveEnemyShips.push(ship);
    }
  }

  // 仅当至少看见该敌对舰队一艘存活舰船时，才收录其公开的编队增益。
  const visibleTeamBuffs = [];
  for (const enemyTeam of enemies) {
    if ((visibleShipCountBySeat.get(enemyTeam.seat) || 0) <= 0) continue;
    visibleTeamBuffs.push({
      sourceSeat: enemyTeam.seat,
      sourceSideId: enemyTeam.sideId,
      sourceType: "vision",
      sponsorUntil: enemyTeam.effects.sponsorUntil,
      haruhiBoostUntil: enemyTeam.effects.haruhiBoostUntil,
      visionWaveActiveUntil: enemyTeam.visionWaveSkill.activeUntil,
    });
  }

  // 公开视野波只归属到对应敌对来源，不含队友，且不泄露隐藏朝仓的实时舰位。
  const visionWaves = [];
  for (const enemyTeam of enemies) {
    const waveState = enemyTeam.visionWaveSkill;
    if (!waveState) continue;
    const hasActivity = Number(waveState.activeUntil || 0) > now
      || Number(waveState.pulsesRemaining || 0) > 0
      || (Array.isArray(waveState.waves) && waveState.waves.length > 0);
    if (!hasActivity) continue;
    visionWaves.push({
      sourceSeat: enemyTeam.seat,
      sourceSideId: enemyTeam.sideId,
      sourceType: "public_wave",
      activeUntil: waveState.activeUntil,
      nextPulseAt: waveState.nextPulseAt,
      pulsesRemaining: waveState.pulsesRemaining,
      waves: waveState.waves.map((wave) => primitiveFields(wave)),
    });
  }

  // 多敌方猎杀来源：只收录以本席存活舰船为目标的敌方三味线来源。
  const huntedBy = [];
  for (const enemyTeam of enemies) {
    if (!hasShamisenFlagship(enemyTeam)) continue;
    const targetId = enemyTeam.shamisenHunt?.targetId;
    const ship = ownShips.find((candidate) => candidate?.alive && candidate.id === targetId);
    if (!ship) continue;
    huntedBy.push({
      sourceSeat: enemyTeam.seat,
      sourceSideId: enemyTeam.sideId,
      sourceType: "hunt_mark",
      shipId: ship.id,
      shipKey: ship.key,
    });
  }

  // 己方三味线施加的猎杀标记：保留精确坐标与可见性，但不暴露目标角色、席位、血量或朝向。
  const huntMarks = [];
  if (hasShamisenFlagship(team)) {
    const targetId = team.shamisenHunt?.targetId;
    const target = aliveEnemyShips.find((ship) => ship.id === targetId);
    if (target) {
      huntMarks.push({
        targetId: target.id,
        sourceType: "hunt_mark",
        x: target.x,
        y: target.y,
        visible: visibleIds.has(target.id),
      });
    }
  }

  // 长门私有雷达：只收录跨敌对舰队存活目标的带误差接触，不升级为普通视野。
  const radarContacts = [];
  let radar = null;
  if (team.hasYukiFlagship()) {
    const aliveEnemyShipIds = new Set(aliveEnemyShips.map((ship) => ship.id));
    for (const contact of team.serializeRadarPassive()?.contacts || []) {
      if (!aliveEnemyShipIds.has(Number(contact?.targetId ?? contact?.id))) continue;
      radarContacts.push({
        ...primitiveFields(contact),
        sourceType: "radar",
      });
    }
    radar = { contacts: radarContacts };
  }

  // 仅收录被本席视野源覆盖且来自敌对舰队的存活弹体，排除本席与同阵营队友弹体。
  const projectiles = [];
  for (const projectile of match.projectiles || []) {
    if (!projectile || !projectile.alive || !projectile.team || !enemySeatSet.has(projectile.team.seat)) continue;
    if (!visionSources.some((source) => distance(projectile.x, projectile.y, source.x, source.y) <= source.range)) {
      continue;
    }
    projectiles.push({
      sourceSeat: projectile.team.seat,
      sourceSideId: projectile.team.sideId,
      sourceType: "vision",
      x: projectile.x,
      y: projectile.y,
      targetX: projectile.targetX,
      targetY: projectile.targetY,
    });
  }

  const publicEnemySpawns = observeEnemySpawns(match, seat);

  return freezePlainData({
    schema: MULTI_FLEET_OBSERVATION_SCHEMA,
    tick: match.tick,
    time: now,
    selfSeat: team.seat,
    selfSideId: team.sideId,
    world: {
      size: match.worldSize,
      mapPadding: match.mapPadding,
      zones: match.zones.map((zone) => ({ ...zone })),
    },
    rules: {
      bunnyStage: Boolean(match.bunnyHaruhiActive),
      publicEnemySpawns: publicEnemySpawns !== null,
    },
    self: {
      seat: team.seat,
      sideId: team.sideId,
      loadout: { main: team.loadout.main, sub1: team.loadout.sub1, sub2: team.loadout.sub2 },
      flags: {
        yukiFlagship: team.hasYukiFlagship(),
        kyonFlagship: team.hasKyonFlagship(),
        shamisenFlagship: Boolean(hasShamisenFlagship(team)),
      },
      splitLevel: team.splitLevel,
      hullRatio: team.hullRatio(),
      cooldowns: {
        scout: team.cooldowns.scout,
        flagship: team.cooldowns.flagship,
        sub1: team.cooldowns.sub1,
        sub2: team.cooldowns.sub2,
      },
      scoutsDisabled: team.areScoutsDisabled(),
      skillsDisabled: team.areSkillsDisabled(),
      future1096Form: team.future1096Form ?? null,
      ships: {
        main: observeOwnShip(team.ships.main),
        sub1: observeOwnShip(team.ships.sub1),
        sub2: observeOwnShip(team.ships.sub2),
      },
      extraShips: team.extraShips.map(observeOwnShip),
      scouts: team.scouts.map(observeOwnScout),
      wingmen: team.wingmen.map(observeOwnWingman),
      visionSources,
      radar,
      hunt: huntMarks[0] || null,
      huntedBy,
      koizumiBarrier: koizumiBarrierGeometry(team),
      haruhiOtherworlderReady: Boolean(haruhiOtherworlderReady(team)),
    },
    allies: allies.map(observeAllySummary),
    visibleHostiles,
    hostileEffects: {
      visibleTeamBuffs,
      visionWaves,
      huntedBy,
      huntMarks,
      radarContacts,
      projectiles,
    },
    publicEnemySpawns,
    privileged: null,
  });
}

export function buildObservation(match, seat, options = {}) {
  resolveRegisteredTeam(match, seat, "构建 AI 观测");
  if (options?.schema === MULTI_FLEET_OBSERVATION_SCHEMA || !isLegacyTwoFleetMatch(match)) {
    return buildMultiFleetObservation(match, seat);
  }
  return buildLegacyObservation(match, seat);
}
