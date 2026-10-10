// 规则层到 AI 的唯一读取出口：把实时对局对象翻译成某一席位有权知道的纯数据。
// 这里可以接触 Team/Ship 实例；AI 决策代码只消费本模块产出的观测。
import { nextBunnyForm } from "../../bunny-haruhi.js";
import { bunnyTransformBlockReason } from "../../bunny-haruhi-runtime.js";
import { haruhiOtherworlderReady } from "../../haruhi-flagship.js";
import { koizumiBarrierGeometry } from "../../koizumi-barrier.js";
import { distance } from "../../math.js";

export const OBSERVATION_SCHEMA = 1;

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

// 敌方旗舰的出生点对称且公开，仅在 AI 建立初始情报时读取一次。
export function observeEnemySpawn(match, seat) {
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

export function buildObservation(match, seat) {
  const team = match.teamBySeat(seat);
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
  if (team.hasYukiFlagship() && team.radarPassive?.contacts instanceof Map) {
    const aliveIds = new Set(enemyShips.filter((ship) => ship.alive).map((ship) => ship.id));
    radar = {
      contacts: [...team.radarPassive.contacts.values()]
        .filter((contact) => aliveIds.has(Number(contact?.targetId ?? contact?.id)))
        .map((contact) => primitiveFields(contact)),
    };
  }

  // 猫爪印记对猎杀方持续显示精确位置，但不暴露角色、席位、血量或朝向。
  let hunt = null;
  if (team.hasShamisenFlagship?.()) {
    const targetId = team.shamisenHunt?.targetId;
    const target = enemyShips.find((ship) => ship?.alive && ship.id === targetId);
    if (target) {
      hunt = { targetId: target.id, x: target.x, y: target.y, visible: visibleIds.has(target.id) };
    }
  }
  let hunted = null;
  if (enemy.hasShamisenFlagship?.()) {
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
      zones: match.zones,
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
        shamisenFlagship: Boolean(team.hasShamisenFlagship?.()),
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
