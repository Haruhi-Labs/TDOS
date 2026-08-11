import { TICK_DT } from "./constants.js";
import { SCOUT_LAUNCH_COST, fireArcDensityMultiplier } from "./combat-rules.js";
import {
  buildScoutRetaskOrders,
  createScoutDoctrineState,
  planYukiScoutDeployment,
  recordScoutDeployment,
  scoutMissionPoint,
} from "./bot-scout-strategy.js";
import {
  applyKoizumiBarrierMainStrategy,
  barrierBlocksRangedAttack,
  buildKoizumiBarrierTactics,
  characterTargetPriorityBonus,
  clampPointToAnchorRadius,
  keepDirectiveInsideKoizumiBarrier,
  koizumiBarrierRoleDirective,
  predictCharacterSkillAim,
  snapshotVisibleCharacterTactics,
} from "./bot-character-strategy.js";
import { CHARACTER_DEFS, skillMetaForCharacter } from "./characters.js";
import {
  energyRateForThrottle,
  normalizeThrottleToGear,
  throttleForGear,
  throttleGearForValue,
} from "./throttle.js";
import {
  clamp,
  distance,
  lerp,
  randomInRange,
  shortestAngleDelta,
  zoneContains,
} from "./math.js";

const POKE_VISION_MULT = 1.7;
const HARUHI_FLAGSHIP_ENERGY_RESERVE_WINDOW = 3;

const HARD_AI_PROFILE = Object.freeze({
  initialScoutTimer: 1.55,
  initialFlagshipTimer: 5.6,
  initialSubTimers: {
    sub1: 10.5,
    sub2: 12.5,
  },
  moveReplanMin: 1.35,
  moveReplanMax: 2.15,
  stuckTrigger: 0.9,
  searchAdvanceWindow: 4.6,
  searchArrivalRadius: 120,
  reactionScale: 0.46,
  reactionMin: 0.03,
  reactionMax: 0.16,
  memoryLeadMultiplier: 1.28,
  probeDistanceMultiplier: 1.24,
  aggressiveScoutWindow: 0.45,
});

// AI 推进的能量护栏。前进4档只在能量充裕时启动，并用不同的启动/退出阈值避免
// 3、4档在临界值附近反复切换；低能量时仍保持航行，但强制降档回能。
const AI_ENERGY_GEAR_POLICY = Object.freeze({
  criticalRatio: 0.14,
  lowRatio: 0.32,
  overdriveStartRatio: 0.72,
  overdriveStopRatio: 0.52,
});

// 单人难度:四档同时调三件事——
//  reactionMult 放大感知延迟(perceptionDelayFor):AI 看到/响应玩家动作更慢;
//  replanMult   放大改航间隔(moveReplan):AI 调整走位更不勤;
//  statMult     敌方舰队数值缩放(血量+伤害):简单0.8 / 普通1.0 / 困难1.2 / 极限1.2;
//  focusLowHp   极限专属:开火锁定射程内血量最低的敌人(收残血)。其余三档与玩家同规则"取最近"。
// 注:极限(=满状态AI,也是 benchmark/默认席位)的锁血是经用户明确要求开放的"最高难度"特性,
//  与历史上被移除的"全AI默认偷偷锁血"作弊不同——此处仅在玩家主动选择极限档时生效。
const AI_DIFFICULTY = Object.freeze({
  easy: { reactionMult: 9.0, replanMult: 2.4, statMult: 0.8, focusLowHp: false }, // 反应~0.75s/峰值~1.4s,改航~3.2-5.2s + 数值×0.8:既迟钝又脆
  normal: { reactionMult: 4.5, replanMult: 1.7, statMult: 1.0, focusLowHp: false }, // 反应~0.37s,改航~2.3-3.7s,数值×1.0
  hard: { reactionMult: 2.2, replanMult: 1.25, statMult: 1.2, focusLowHp: false }, // 反应~0.18s + 数值×1.2:更肉更痛
  master: { reactionMult: 1.0, replanMult: 1.0, statMult: 1.2, focusLowHp: true }, // 满状态AI:反应最快 + 数值×1.2(与困难持平) + 智能集火残血:无可争议最难
});

export class BotController {
  constructor(team, enemy) {
    this.team = team;
    this.enemy = enemy;
    this.profile = HARD_AI_PROFILE;
    // 旧版AI开关：true 时关闭全部升级(集火/视野收尾/收尾压制)，行为回到升级前的基线AI。
    // 用于 AI推演里「对手用旧AI」对照展示，无需打包冻结副本。
    this.legacy = false;
    // 单人难度(默认 master=满状态)。reactionMult/replanMult 放大反应延迟与改航间隔;
    // statMult/focusLowHp 在 setDifficulty 中写入本队(数值缩放 + 极限锁血)。
    this.difficulty = "master";
    this.reactionMult = 1;
    this.replanMult = 1;
    this.focusLowHp = false;

    this.moveTimer = 0;
    this.koizumiOrbSteerTimer = 0;
    this.scoutTimer = team.hasYukiFlagship() ? 0.55 : this.profile.initialScoutTimer;
    this.scoutDoctrine = createScoutDoctrineState();
    this.currentScoutPlan = null;
    this.scoutPlanRefreshAt = 0;
    // 春日的首次施放既能立即提供团队强化，也会解锁常驻支援，因此不等待通用的开局观察窗。
    this.flagshipTimer = team.mainCharacterId() === "haruhi" ? 0 : this.profile.initialFlagshipTimer;
    this.subTimers = {
      sub1: this.profile.initialSubTimers.sub1,
      sub2: this.profile.initialSubTimers.sub2,
    };
    this.modeTimer = 0;
    this.mode = "press";

    this.lastMainPos = {
      x: team.ships.main.x,
      y: team.ships.main.y,
    };
    this.stuckTimer = 0;

    const enemyMain = enemy.ships.main;
    const spawnZone = this.zoneForPoint(enemyMain.x, enemyMain.y);
    this.searchOrder = [5, 2, 8, 4, 6, 1, 7, 3, 9];
    this.searchCursor = 0;
    this.enemyIntel = {
      entities: new Map(),
      main: {
        id: enemyMain.id,
        kind: "ship",
        key: enemyMain.key,
        slotKey: enemyMain.slotKey,
        x: enemyMain.x,
        y: enemyMain.y,
        angle: enemyMain.angle,
        speed: 0,
        seenAt: this.team.match.elapsed,
        zoneId: spawnZone.id,
        source: "spawn",
      },
      searchZoneId: spawnZone.id,
    };
    this.pendingSightings = new Map();
    this.searchSweepSign = 1;
    this.lastSearchAdvanceAt = this.team.match.elapsed;
    // 情报占据图(belief)：像人一样推理敌人位置——持续预测(向外扩散可能区)、排除(己方视野
    // 看过且无敌的区清零)、缩小到最高概率未排除区去搜。初始以敌出生点为峰。
    this.belief = this.initBelief(enemyMain);
    this.lastTacticalPlan = {
      focus: this.debugContact(this.enemyIntel.main),
      searchCenter: this.debugPoint(this.zoneCenter(spawnZone.id)),
      combatCenter: null,
      searchAssignments: null,
      sectorPlan: null,
      detachedPlan: null,
      orders: {},
      useSearchSectorPlan: false,
      shouldUseDetachedRoles: false,
    };
    this.lastScoutDecision = {
      action: "idle",
      zoneId: spawnZone.id,
      launched: false,
      urgent: false,
      at: this.team.match.elapsed,
    };
    this.lastFlagshipDecision = {
      action: "idle",
      cast: false,
      at: this.team.match.elapsed,
      target: null,
    };
    this.lastSubSkillDecision = {
      sub1: {
        action: "idle",
        cast: false,
        at: this.team.match.elapsed,
        target: null,
      },
      sub2: {
        action: "idle",
        cast: false,
        at: this.team.match.elapsed,
        target: null,
      },
    };
    this.lastSplitDecision = {
      attempt1: false,
      attempt2: false,
      acted: [],
      level: this.team.splitLevel,
      at: this.team.match.elapsed,
    };
  }

  debugPoint(point) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return null;
    }
    return {
      x: point.x,
      y: point.y,
      zoneId: Number.isFinite(point.zoneId) ? point.zoneId : this.zoneForPoint(point.x, point.y).id,
      intentAngle: Number.isFinite(point.intentAngle) ? point.intentAngle : null,
      preferredRange: Number.isFinite(point.preferredRange) ? point.preferredRange : null,
    };
  }

  debugPointMap(plan) {
    if (!plan) {
      return null;
    }
    const output = {};
    for (const [key, point] of Object.entries(plan)) {
      output[key] = this.debugPoint(point);
    }
    return output;
  }

  debugContact(contact) {
    if (!contact) {
      return null;
    }
    const age = Number.isFinite(contact.age) ? contact.age : Math.max(0, this.team.match.elapsed - (contact.seenAt || this.team.match.elapsed));
    return {
      id: contact.id,
      kind: contact.kind || "ship",
      key: contact.key || null,
      slotKey: contact.slotKey || null,
      characterId: contact.characterId || null,
      x: contact.x,
      y: contact.y,
      angle: Number.isFinite(contact.angle) ? contact.angle : 0,
      speed: Number.isFinite(contact.speed) ? contact.speed : 0,
      zoneId: Number.isFinite(contact.zoneId) ? contact.zoneId : this.zoneForPoint(contact.x, contact.y).id,
      source: contact.source || "visible",
      age,
      confidence: Number.isFinite(contact.confidence) ? contact.confidence : 1,
      uncertainty: Number.isFinite(contact.uncertainty) ? contact.uncertainty : 0,
      visible: Boolean(contact.visible || contact.source === "visible"),
      hp: Number.isFinite(contact.hp) ? contact.hp : null,
      maxHp: Number.isFinite(contact.maxHp) ? contact.maxHp : null,
      combatCapable: Boolean(contact.combatCapable),
    };
  }

  debugThreatMap(shipThreats) {
    const output = {};
    if (!(shipThreats instanceof Map)) {
      return output;
    }
    for (const [key, threat] of shipThreats.entries()) {
      output[key] = {
        sources: threat.sources || 0,
        pressure: threat.pressure || 0,
        friendlySupport: threat.friendlySupport || 0,
        danger: threat.danger || 0,
        overwhelmed: Boolean(threat.overwhelmed),
      };
    }
    return output;
  }

  debugContext(context) {
    if (!context) {
      return null;
    }
    return {
      dist: context.dist,
      rangeRef: context.rangeRef,
      mainHull: context.mainHull,
      mainEnergyRatio: context.mainEnergyRatio,
      fleetHull: context.fleetHull,
      energyRatio: context.energyRatio,
      friendlyLocal: context.friendlyLocal,
      enemyLocal: context.enemyLocal,
      localAdvantage: context.localAdvantage,
      intelSolid: Boolean(context.intelSolid),
      searchRequired: Boolean(context.searchRequired),
      killWindow: Boolean(context.killWindow),
      broadsideWindow: Boolean(context.broadsideWindow),
      detachedCount: context.detachedCount,
      detachedSpread: context.detachedSpread,
      overextended: Boolean(context.overextended),
      defensivePressure: Boolean(context.defensivePressure),
      edgePressure: context.edgePressure,
      flankSign: context.flankSign,
      ownArcDensity: context.ownArcDensity,
      enemyArcDensity: context.enemyArcDensity,
      arcAdvantage: context.arcAdvantage,
      enemyBroadsideRisk: Boolean(context.enemyBroadsideRisk),
      safeExchange: Boolean(context.safeExchange),
      focusFreshness: context.focusFreshness,
      trackableIntel: Boolean(context.trackableIntel),
      intelUrgency: context.intelUrgency,
      combatUrgency: context.combatUrgency,
      emergencyCommit: Boolean(context.emergencyCommit),
      energySurplus: context.energySurplus,
      energyRecoveryNeed: context.energyRecoveryNeed,
      conserveEnergy: Boolean(context.conserveEnergy),
      mobilityBias: context.mobilityBias,
      skillAggression: context.skillAggression,
      scoutPriority: context.scoutPriority,
      encirclePressure: context.encirclePressure,
      pressureDrive: context.pressureDrive,
      isolatedTargetScore: context.isolatedTargetScore,
      maxShipThreat: context.maxShipThreat,
      overwhelmedShipKey: context.overwhelmedShipKey || null,
      counterCollapse: context.counterCollapse,
      shipThreats: this.debugThreatMap(context.shipThreats),
      barrierTactics: context.barrierTactics
        ? {
            own: context.barrierTactics.own
              ? {
                  active: Boolean(context.barrierTactics.own.active),
                  radius: context.barrierTactics.own.radius,
                  disabledRemaining: context.barrierTactics.own.disabledRemaining,
                }
              : null,
            enemy: context.barrierTactics.enemy
              ? {
                  active: Boolean(context.barrierTactics.enemy.active),
                  radius: context.barrierTactics.enemy.radius,
                  disabledRemaining: context.barrierTactics.enemy.disabledRemaining,
                  age: context.barrierTactics.enemy.age,
                }
              : null,
            breachShipKey: context.barrierTactics.breachShipKey || null,
            breachKind: context.barrierTactics.breachKind || null,
            breachActive: Boolean(context.barrierTactics.breachActive),
            infiltratorKey: context.barrierTactics.infiltratorKey || null,
            incomingKind: context.barrierTactics.incoming?.kind || null,
            incomingId: context.barrierTactics.incoming?.contact?.id || null,
          }
        : null,
    };
  }

  debugDetachedPlan(plan) {
    if (!plan) {
      return null;
    }
    return {
      intelLeadKey: plan.intelLeadKey || null,
      retreatKey: plan.retreatKey || null,
      roles: { ...plan.roles },
      laneSigns: { ...plan.laneSigns },
    };
  }

  serializeDebugState() {
    const focus = this.currentContext?.focus || this.lastTacticalPlan?.focus || this.enemyIntel.main;
    let visibleContacts = 0;
    for (const contact of this.enemyIntel.entities.values()) {
      const age = this.team.match.elapsed - contact.seenAt;
      if ((contact.source === "visible" || age <= 0.6) && age <= 1.2) {
        visibleContacts += 1;
      }
    }
    return {
      seat: this.team.seat,
      mode: this.mode,
      modeTimer: this.modeTimer,
      moveTimer: this.moveTimer,
      scoutTimer: this.scoutTimer,
      flagshipTimer: this.flagshipTimer,
      subTimers: {
        sub1: this.subTimers.sub1,
        sub2: this.subTimers.sub2,
      },
      intel: {
        searchZoneId: this.enemyIntel.searchZoneId || null,
        knownContacts: this.enemyIntel.entities.size,
        visibleContacts,
        pendingContacts: this.pendingSightings.size,
      },
      focus: this.debugContact(focus),
      context: this.debugContext(this.currentContext),
      searchCenter: this.lastTacticalPlan?.searchCenter || null,
      combatCenter: this.lastTacticalPlan?.combatCenter || null,
      searchAssignments: this.lastTacticalPlan?.searchAssignments || null,
      sectorPlan: this.lastTacticalPlan?.sectorPlan || null,
      detachedPlan: this.lastTacticalPlan?.detachedPlan || null,
      orders: this.lastTacticalPlan?.orders || {},
      useSearchSectorPlan: Boolean(this.lastTacticalPlan?.useSearchSectorPlan),
      shouldUseDetachedRoles: Boolean(this.lastTacticalPlan?.shouldUseDetachedRoles),
      scoutDecision: {
        ...this.lastScoutDecision,
        nextIn: this.scoutTimer,
      },
      scoutDoctrine: {
        mode: this.scoutDoctrine.mode,
        primaryZoneId: this.scoutDoctrine.primaryZoneId,
        committedUntil: this.scoutDoctrine.committedUntil,
        deployments: this.scoutDoctrine.deployments,
        lastPlan: this.scoutDoctrine.lastPlan,
      },
      flagshipDecision: {
        ...this.lastFlagshipDecision,
        nextIn: this.flagshipTimer,
      },
      subSkillDecision: {
        sub1: {
          ...this.lastSubSkillDecision.sub1,
          nextIn: this.subTimers.sub1,
        },
        sub2: {
          ...this.lastSubSkillDecision.sub2,
          nextIn: this.subTimers.sub2,
        },
      },
      splitDecision: {
        ...this.lastSplitDecision,
        level: this.team.splitLevel,
      },
    };
  }

  zoneForPoint(x, y) {
    return this.team.match.zones.find((zone) => zoneContains(zone, x, y)) || this.team.match.zones[4];
  }

  zoneCenter(zoneId) {
    const zone = this.team.match.zoneById(zoneId);
    return {
      zoneId: zone.id,
      x: zone.x + zone.width * 0.5,
      y: zone.y + zone.height * 0.5,
    };
  }

  safeRoutePadding(extra = 0) {
    return clamp(this.team.match.worldSize * 0.08, 90, 145) + extra;
  }

  edgePressure(ship) {
    if (!ship) {
      return 0;
    }
    const worldSize = this.team.match.worldSize;
    const margin = clamp(worldSize * 0.12, 120, 190);
    const edgeDistance = Math.min(ship.x, ship.y, worldSize - ship.x, worldSize - ship.y);
    if (edgeDistance >= margin) {
      return 0;
    }
    return clamp(1 - edgeDistance / margin, 0, 1);
  }

  stableNoise(seed, salt = 0) {
    const value = Math.sin(seed * 12.9898 + salt * 78.233 + 0.9157) * 43758.5453;
    return value - Math.floor(value);
  }

  setDifficulty(level) {
    const d = AI_DIFFICULTY[level] || AI_DIFFICULTY.master;
    this.difficulty = AI_DIFFICULTY[level] ? level : "master";
    this.reactionMult = d.reactionMult;
    this.replanMult = d.replanMult;
    this.focusLowHp = !!d.focusLowHp;
    // 把"数值缩放"与"极限锁血"落到本AI所控舰队上(玩家队无 bot,不受影响)
    this.team.aiFocusLowHp = this.focusLowHp;
    this.team.applyAiStatMult(d.statMult);
    return this;
  }

  perceptionDelayFor(entity) {
    const base = entity.kind === "ship" ? 0.14 : entity.kind === "wingman" ? 0.1 : 0.08;
    const roleBias = entity.slotKey === "main" ? -0.02 : 0;
    const jitter = this.stableNoise(entity.id, 3) * 0.08;
    const mult = this.reactionMult || 1; // 难度:放大反应时间(感知延迟),不改任何能力
    return clamp(
      (base + roleBias + jitter) * this.profile.reactionScale * mult,
      this.profile.reactionMin * mult,
      this.profile.reactionMax * mult,
    );
  }

  queueSighting(entity) {
    const snapshot = this.snapshotEnemyContact(entity, "visible");
    const now = this.team.match.elapsed;
    const pending = this.pendingSightings.get(snapshot.id);
    if (pending) {
      pending.snapshot = snapshot;
      return;
    }

    const committed = this.enemyIntel.entities.get(snapshot.id) || (snapshot.slotKey === "main" ? this.enemyIntel.main : null);
    const delay = this.perceptionDelayFor(entity);
    if (committed && now - committed.seenAt < delay * 0.82) {
      return;
    }

    this.pendingSightings.set(snapshot.id, {
      snapshot,
      readyAt: now + delay,
    });
  }

  flushPendingSightings() {
    const now = this.team.match.elapsed;
    for (const [id, pending] of this.pendingSightings) {
      if (pending.readyAt > now) {
        continue;
      }
      const snapshot = pending.snapshot;
      this.enemyIntel.entities.set(snapshot.id, snapshot);
      if (snapshot.slotKey === "main") {
        this.enemyIntel.main = snapshot;
      }
      this.enemyIntel.searchZoneId = snapshot.zoneId;
      this.pendingSightings.delete(id);
    }
  }

  snapshotEnemyContact(entity, source = "visible") {
    const zone = this.zoneForPoint(entity.x, entity.y);
    return {
      id: entity.id,
      kind: entity.kind || "ship",
      key: entity.key || entity.slotKey || null,
      slotKey: entity.slotKey || entity.key || null,
      characterId: entity.characterId || null,
      x: entity.x,
      y: entity.y,
      angle: Number.isFinite(entity.angle) ? entity.angle : 0,
      speed: Number.isFinite(entity.speed) ? entity.speed : 0,
      hp: Number.isFinite(entity.hp) ? entity.hp : null,
      maxHp: Number.isFinite(entity.maxHp) ? entity.maxHp : null,
      radius: Number.isFinite(entity.radius) ? entity.radius : null,
      combatCapable: Boolean(entity.combatCapable),
      seenAt: this.team.match.elapsed,
      zoneId: zone.id,
      source,
      ...snapshotVisibleCharacterTactics(entity, this.team.match.elapsed),
    };
  }

  ingestRadarContacts() {
    if (!this.team.hasYukiFlagship() || !(this.team.radarPassive?.contacts instanceof Map)) {
      return;
    }

    const now = this.team.match.elapsed;
    const enemyShips = new Map(this.enemy.getAllShips().map((ship) => [ship.id, ship]));
    for (const radarContact of this.team.radarPassive.contacts.values()) {
      const targetId = Number(radarContact?.targetId ?? radarContact?.id);
      const detectedAt = Number(radarContact?.detectedAt);
      const expiresAt = Number(radarContact?.expiresAt);
      if (
        !Number.isFinite(targetId)
        || !Number.isFinite(detectedAt)
        || !Number.isFinite(radarContact?.x)
        || !Number.isFinite(radarContact?.y)
        || (Number.isFinite(expiresAt) && expiresAt <= now)
        || this.team.visibleEnemyIds.has(targetId)
      ) {
        continue;
      }

      // 雷达本身已经带有位置误差；AI只读取同一份误差接触，不回查舰船真实坐标。
      // 难度仍影响其理解扫描结果的速度，避免简单难度瞬间响应。
      const clarity = clamp(Number(radarContact.clarity) || 0.12, 0.08, 0.92);
      const reactionDelay = clamp(
        (0.07 + (1 - clarity) * 0.1) * (this.reactionMult || 1),
        0.04,
        1.2,
      );
      if (now - detectedAt + 1e-9 < reactionDelay) {
        continue;
      }

      const existing = this.enemyIntel.entities.get(targetId)
        || (this.enemyIntel.main?.id === targetId ? this.enemyIntel.main : null);
      if (existing && existing.seenAt >= detectedAt) {
        continue;
      }

      const targetMeta = enemyShips.get(targetId);
      if (!targetMeta?.alive) {
        continue;
      }
      const identifiedCharacterId = radarContact.characterId && CHARACTER_DEFS[radarContact.characterId]
        ? radarContact.characterId
        : null;
      const zone = this.zoneForPoint(radarContact.x, radarContact.y);
      const snapshot = {
        id: targetId,
        kind: "ship",
        // 远距离波动本身不能区分旗舰/副舰；角色可辨识后也只记录角色，不借实体 ID
        // 反查隐藏席位，保证 AI 与玩家拿到的信息等价。
        key: null,
        slotKey: null,
        // 仅在雷达进入可辨识范围后使用角色信息，远距离扫描不会偷看真实阵容身份。
        characterId: identifiedCharacterId,
        x: radarContact.x,
        y: radarContact.y,
        angle: Number.isFinite(radarContact.angle) ? radarContact.angle : 0,
        speed: CHARACTER_DEFS[identifiedCharacterId]?.stats?.speed || 31,
        hp: null,
        maxHp: null,
        radius: null,
        seenAt: detectedAt,
        zoneId: zone.id,
        source: "radar",
        confidence: clamp(0.2 + clarity * 0.74, 0.24, 0.88),
        uncertainty: clamp(Number(radarContact.uncertainty) || 90, 8, 260),
        radarExpiresAt: Number.isFinite(expiresAt) ? expiresAt : detectedAt + 3,
      };
      this.enemyIntel.entities.set(targetId, snapshot);
      this.enemyIntel.searchZoneId = snapshot.zoneId;
    }
  }

  predictEnemyVector(contact) {
    if (!contact) {
      return {
        x: 0,
        y: 0,
        angle: 0,
        speed: 0,
      };
    }
    const baseSpeed = Number.isFinite(contact.speed) && contact.speed > 0 ? contact.speed : contact.kind === "ship" ? 31 : 72;
    let vx = Math.cos(contact.angle || 0) * baseSpeed;
    let vy = Math.sin(contact.angle || 0) * baseSpeed;

    const pressureTarget = this.team.ships.main;
    const pullX = pressureTarget.x - contact.x;
    const pullY = pressureTarget.y - contact.y;
    const pullLen = Math.max(1, Math.hypot(pullX, pullY));
    const sourcePull = contact.source === "spawn" ? 0.56 : contact.source === "memory" ? 0.34 : 0.14;
    vx += (pullX / pullLen) * baseSpeed * sourcePull;
    vy += (pullY / pullLen) * baseSpeed * sourcePull;

    const len = Math.max(1, Math.hypot(vx, vy));
    return {
      x: vx,
      y: vy,
      angle: Math.atan2(vy, vx),
      speed: len,
    };
  }

  projectContact(contact, maxLead = 2.4) {
    if (!contact) {
      return null;
    }
    const age = Math.max(0, this.team.match.elapsed - contact.seenAt);
    const lead = contact.source === "spawn" ? 0 : Math.min(age * this.profile.memoryLeadMultiplier, Math.max(maxLead, 0)) * 0.78;
    const padding = this.safeRoutePadding();
    const worldSize = this.team.match.worldSize;
    const travel = this.predictEnemyVector(contact);
    let x = clamp(contact.x + travel.x * lead, padding, worldSize - padding);
    let y = clamp(contact.y + travel.y * lead, padding, worldSize - padding);

    let source = contact.source;
    let confidence = 1;
    let radarDerived = false;
    if (source === "radar") {
      radarDerived = true;
      const freshDuration = Math.max(0.8, (contact.radarExpiresAt || contact.seenAt + 3) - contact.seenAt);
      source = age <= freshDuration ? "radar" : "memory";
      confidence = clamp((contact.confidence ?? 0.42) - age * 0.055, 0.12, 0.88);
    } else if (source === "spawn") {
      confidence = clamp(0.42 - age * 0.028, 0.14, 0.42);
    } else if (age > TICK_DT * 1.5) {
      source = "memory";
      confidence = clamp(0.88 - age * 0.05, 0.18, 0.88);
    }

    let uncertainty = 0;
    if (radarDerived) {
      uncertainty = clamp((contact.uncertainty || 60) + age * 16, 8, 280);
    } else if (source === "spawn") {
      uncertainty = clamp(90 + age * 20, 90, 230);
    } else if (source === "memory") {
      uncertainty = clamp(14 + age * 28 + (1 - confidence) * 75, 14, 210);
    }

    if (uncertainty > 0 && !radarDerived) {
      const seed = contact.id * 97 + Math.round(contact.seenAt * 10);
      const sideAngle = travel.angle + Math.PI * 0.5;
      const forwardDrift = uncertainty * (0.24 + this.stableNoise(seed, 11) * 0.32);
      const lateralDrift = uncertainty * (this.stableNoise(seed, 7) - 0.5) * 0.78;
      x = clamp(x + Math.cos(travel.angle) * forwardDrift + Math.cos(sideAngle) * lateralDrift, padding, worldSize - padding);
      y = clamp(y + Math.sin(travel.angle) * forwardDrift + Math.sin(sideAngle) * lateralDrift, padding, worldSize - padding);
    }

    const projectedZone = this.zoneForPoint(x, y);

    return {
      ...contact,
      x,
      y,
      zoneId: projectedZone.id,
      age,
      source,
      confidence,
      uncertainty,
      radarDerived,
      visible: source === "visible",
    };
  }

  rememberContact(entity, source = "visible") {
    const snapshot = this.snapshotEnemyContact(entity, source);
    this.enemyIntel.entities.set(snapshot.id, snapshot);
    if (snapshot.slotKey === "main") {
      this.enemyIntel.main = snapshot;
    }
    this.enemyIntel.searchZoneId = snapshot.zoneId;
    return this.projectContact(snapshot, 0);
  }

  // ── 情报占据图(belief)：类人地推理"敌人可能在哪" ──
  initBelief(enemyMain) {
    const ws = this.team.match.worldSize;
    const cols = 16;
    const rows = 16;
    const belief = { cols, rows, cell: ws / cols, w: new Float64Array(cols * rows) };
    if (enemyMain) {
      belief.w[this.beliefIdxFor(belief, enemyMain.x, enemyMain.y)] = 1;
    }
    return belief;
  }

  beliefIdxFor(b, x, y) {
    const cx = clamp(Math.floor(x / b.cell), 0, b.cols - 1);
    const cy = clamp(Math.floor(y / b.cell), 0, b.rows - 1);
    return cy * b.cols + cx;
  }

  // 该点是否在我方任一视野源覆盖内(用于"只采信我方能看见的间接情报",保持公平)
  perceivesPoint(x, y) {
    for (const src of this.team.getVisionSources()) {
      if (distance(x, y, src.x, src.y) <= src.range) return true;
    }
    return false;
  }

  // 每tick更新：①看见→坍缩到可见处；否则 ②预测(向四邻扩散) ③排除(己方视野看过且无敌的区清零)
  // ④间接情报(敌子弹/侦察机反推) ⑤兜底重播种
  updateBelief(dt) {
    const b = this.belief;
    if (!b) return;
    const { cols, rows, cell } = b;
    const n = cols * rows;

    const visible = [];
    for (const s of this.enemy.getAllShips()) {
      if (s && s.alive && this.team.visibleEnemyIds.has(s.id)) visible.push(s);
    }
    if (visible.length) {
      // 坍缩：看得见就把概率集中到可见位置(清掉旧弥散)
      b.w.fill(0);
      for (const s of visible) b.w[this.beliefIdxFor(b, s.x, s.y)] = 1;
      return;
    }

    // ① 预测：敌可能已移动→概率按"敌最大速度×dt"向四邻扩散
    const enemyMaxSpeed = 46;
    const leak = clamp((enemyMaxSpeed * Math.max(dt, 0)) / Math.max(cell, 1), 0, 0.22);
    let w = b.w;
    if (leak > 0.0008) {
      const next = new Float64Array(n);
      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          const i = cy * cols + cx;
          const v = w[i];
          if (v <= 1e-9) continue;
          const nb = [];
          if (cx > 0) nb.push(i - 1);
          if (cx < cols - 1) nb.push(i + 1);
          if (cy > 0) nb.push(i - cols);
          if (cy < rows - 1) nb.push(i + cols);
          const out = v * leak;
          next[i] += v - out;
          const share = out / Math.max(1, nb.length);
          for (const j of nb) next[j] += share;
        }
      }
      b.w = next;
      w = next;
    }

    // ② 排除：己方每个视野源覆盖到的cell若无敌→几乎清零(看过、是空的)
    for (const src of this.team.getVisionSources()) {
      const r = src.range;
      if (!(r > 0)) continue;
      const minx = clamp(Math.floor((src.x - r) / cell), 0, cols - 1);
      const maxx = clamp(Math.floor((src.x + r) / cell), 0, cols - 1);
      const miny = clamp(Math.floor((src.y - r) / cell), 0, rows - 1);
      const maxy = clamp(Math.floor((src.y + r) / cell), 0, rows - 1);
      for (let cy = miny; cy <= maxy; cy++) {
        for (let cx = minx; cx <= maxx; cx++) {
          const ccx = (cx + 0.5) * cell;
          const ccy = (cy + 0.5) * cell;
          if (distance(src.x, src.y, ccx, ccy) <= r + cell * 0.3) {
            w[cy * cols + cx] *= 0.04;
          }
        }
      }
    }

    // ── 间接情报(很关键:敌舰本体多数时间在视野外，靠"看到的子弹/敌侦察机"反推敌方范围) ──
    // noIndirectIntel=true 时整体跳过(用于控制变量对照实验)
    if (!this.noIndirectIntel) {
      const match = this.team.match;
      // (a) 敌方子弹:朝我方飞来→开火的敌舰在其"逆飞行方向"、射程之内。只用我方能感知到的子弹(公平)。
      if (match.projectiles) {
        for (const p of match.projectiles) {
          if (!p || !p.alive || p.team === this.team) continue;
          if (!this.perceivesPoint(p.x, p.y)) continue;
          const vx = p.targetX - p.x;
          const vy = p.targetY - p.y;
          const vl = Math.hypot(vx, vy);
          if (vl < 1) continue;
          const bx = -vx / vl;
          const by = -vy / vl; // 指向开火舰
          for (const seg of [[130, 0.4], [280, 0.6], [430, 0.4]]) {
            w[this.beliefIdxFor(b, p.x + bx * seg[0], p.y + by * seg[0])] += seg[1];
          }
        }
      }
      // (b) 敌方侦察机:区分两类,避免被长门"一圈侦察机"误导——
      //   · burst(长门分舰技):一圈(16架)围着发射舰orbit,逐个回溯方向会被环切线带偏、且落点成一圈
      //     (峰偏到环上而非中心)。正确读法=一圈侦察机的"质心"≈敌舰所在 → 只在质心加权,不逐个回溯。
      //   · 普通(transit):单架从敌舰飞向战区,逆其朝向≈发射处有敌舰 → 回溯加权。
      let bx0 = 0;
      let by0 = 0;
      let bn = 0;
      for (const sc of this.enemy.scouts) {
        if (!sc || !sc.alive || !this.team.visibleEnemyIds.has(sc.id)) continue;
        if (sc.pattern === "burst") {
          bx0 += sc.x; by0 += sc.y; bn++;
          continue; // burst 不逐个回溯(会误导),留到下面按质心处理
        }
        const ang = Number.isFinite(sc.angle) ? sc.angle : 0;
        w[this.beliefIdxFor(b, sc.x - Math.cos(ang) * 240, sc.y - Math.sin(ang) * 240)] += 0.35;
        w[this.beliefIdxFor(b, sc.x, sc.y)] += 0.18;
      }
      if (bn >= 3) {
        // 看到≥3架一圈侦察机→敌舰在它们质心附近(一圈对称,质心≈圆心=发射舰)。这是很强的情报,给高权重。
        w[this.beliefIdxFor(b, bx0 / bn, by0 / bn)] += 1.3;
      }
    }

    // 长门雷达只把带误差的接触注入占据图，不会像真实视野一样把概率坍缩到真值。
    // 模糊接触铺得更宽，近距离高置信接触则形成更集中的搜索峰。
    for (const stored of this.enemyIntel.entities.values()) {
      if (stored.source !== "radar") continue;
      const contact = this.projectContact(stored, 1.2);
      if (!contact || contact.age > 9 || contact.confidence < 0.1) continue;
      const sigma = Math.max(cell * 0.65, contact.uncertainty * 0.62);
      const radiusCells = clamp(Math.ceil((sigma * 2.2) / cell), 1, 4);
      const centerX = clamp(Math.floor(contact.x / cell), 0, cols - 1);
      const centerY = clamp(Math.floor(contact.y / cell), 0, rows - 1);
      for (let oy = -radiusCells; oy <= radiusCells; oy += 1) {
        for (let ox = -radiusCells; ox <= radiusCells; ox += 1) {
          const cx = centerX + ox;
          const cy = centerY + oy;
          if (cx < 0 || cx >= cols || cy < 0 || cy >= rows) continue;
          const px = (cx + 0.5) * cell;
          const py = (cy + 0.5) * cell;
          const d = distance(px, py, contact.x, contact.y);
          const weight = Math.exp(-(d * d) / Math.max(2 * sigma * sigma, 1));
          w[cy * cols + cx] += weight * contact.confidence * 0.34;
        }
      }
    }

    // ③ 兜底：若几乎全被排除(敌一定还在地图某处)→铺一层弱先验，以最后已知/出生点加权，保持有处可搜
    let total = 0;
    for (let i = 0; i < n; i++) total += w[i];
    if (total < 0.04) {
      for (let i = 0; i < n; i++) w[i] += 0.015;
      const seed = this.enemyIntel?.main;
      if (seed && Number.isFinite(seed.x)) w[this.beliefIdxFor(b, seed.x, seed.y)] += 0.4;
    }
  }

  // 最高概率(且未排除)区域的中心——下一步该去搜/侦察的地方
  beliefPeak() {
    const b = this.belief;
    if (!b) return null;
    let best = -1;
    let bi = -1;
    for (let i = 0; i < b.w.length; i++) {
      if (b.w[i] > best) { best = b.w[i]; bi = i; }
    }
    if (bi < 0 || best <= 1e-6) return null;
    const cx = bi % b.cols;
    const cy = Math.floor(bi / b.cols);
    return { x: (cx + 0.5) * b.cell, y: (cy + 0.5) * b.cell, weight: best };
  }

  beliefZoneWeights() {
    const weights = new Map(this.team.match.zones.map((zone) => [zone.id, 0]));
    const belief = this.belief;
    if (!belief) return weights;
    for (let index = 0; index < belief.w.length; index += 1) {
      const col = index % belief.cols;
      const row = Math.floor(index / belief.cols);
      const x = (col + 0.5) * belief.cell;
      const y = (row + 0.5) * belief.cell;
      const zone = this.zoneForPoint(x, y);
      weights.set(zone.id, (weights.get(zone.id) || 0) + belief.w[index]);
    }
    return weights;
  }

  refreshIntel() {
    this.ingestRadarContacts();
    for (const entity of this.enemy.getEntities()) {
      if (this.team.visibleEnemyIds.has(entity.id)) {
        this.queueSighting(entity);
      }
    }
    this.flushPendingSightings();

    const staleCutoff = this.team.match.elapsed - 18;
    for (const [id, contact] of this.enemyIntel.entities) {
      if (contact.seenAt < staleCutoff) {
        this.enemyIntel.entities.delete(id);
      }
    }
  }

  visibleMainContact() {
    if (!this.enemyIntel.main || this.enemyIntel.main.source !== "visible") {
      return null;
    }
    const age = this.team.match.elapsed - this.enemyIntel.main.seenAt;
    if (age > 0.7) {
      return null;
    }
    return this.projectContact(this.enemyIntel.main, 0.3);
  }

  contactPriority(contact) {
    if (contact.slotKey === "main") {
      return 4;
    }
    if (contact.kind === "ship") {
      return 3;
    }
    if (contact.kind === "wingman") {
      return 2;
    }
    if (contact.kind === "scout" && contact.combatCapable) {
      return 2;
    }
    return 1;
  }

  freshestKnownContact({ requireShip = false, maxAge = 12 } = {}) {
    let best = null;
    for (const contact of this.enemyIntel.entities.values()) {
      if (requireShip && contact.kind !== "ship") {
        continue;
      }
      const age = this.team.match.elapsed - contact.seenAt;
      if (age > maxAge) {
        continue;
      }
      if (
        !best
        || contact.seenAt > best.seenAt
        || (contact.seenAt === best.seenAt && this.contactPriority(contact) > this.contactPriority(best))
      ) {
        best = contact;
      }
    }
    return best ? this.projectContact(best, 1.8) : null;
  }

  primaryEnemyEstimate() {
    const visibleMain = this.visibleMainContact();
    if (visibleMain) {
      return visibleMain;
    }

    // 雷达无法判断旗舰席位，但最新扫描到的任意舰船都比陈旧出生点更适合作为搜索焦点。
    let freshestRadar = null;
    for (const stored of this.enemyIntel.entities.values()) {
      if (stored.source !== "radar") continue;
      const projected = this.projectContact(stored, 1.8);
      if (
        projected.age <= 8
        && (!freshestRadar || stored.seenAt > freshestRadar.seenAt)
      ) {
        freshestRadar = { ...projected, seenAt: stored.seenAt };
      }
    }
    if (freshestRadar) {
      return freshestRadar;
    }

    const mainIntel = this.projectContact(this.enemyIntel.main, this.enemyIntel.main?.source === "spawn" ? 0 : 2.6);
    if (mainIntel && (mainIntel.age <= 16 || mainIntel.source === "spawn")) {
      return mainIntel;
    }

    const recentShip = this.freshestKnownContact({ requireShip: true, maxAge: 10 });
    if (recentShip) {
      return recentShip;
    }

    return this.freshestKnownContact({ requireShip: false, maxAge: 6 }) || mainIntel;
  }

  knownEnemyContacts({ maxAge = 10, includeScouts = false } = {}) {
    const contacts = [];
    for (const stored of this.enemyIntel.entities.values()) {
      const projected = this.projectContact(stored, 1.8);
      if (!projected || projected.age > maxAge) {
        continue;
      }
      if (!includeScouts && projected.kind === "scout" && !projected.combatCapable) {
        continue;
      }
      contacts.push(projected);
    }

    const mainEstimate = this.projectContact(this.enemyIntel.main, this.enemyIntel.main?.source === "spawn" ? 0 : 1.8);
    if (mainEstimate && mainEstimate.age <= maxAge && !contacts.some((item) => item.id === mainEstimate.id)) {
      if (includeScouts || mainEstimate.kind !== "scout" || mainEstimate.combatCapable) {
        contacts.unshift(mainEstimate);
      }
    }
    return contacts;
  }

  contactHpRatio(contact) {
    const hp = Number(contact?.hp);
    const maxHp = Number(contact?.maxHp);
    if (Number.isFinite(hp) && Number.isFinite(maxHp) && maxHp > 0) {
      return clamp(hp / maxHp, 0.08, 1);
    }
    return contact?.kind === "scout" ? 0.4 : contact?.kind === "wingman" ? 0.8 : 0.82;
  }

  contactCombatValue(contact) {
    if (!contact) {
      return 0;
    }
    const confidence = clamp(contact.confidence ?? 1, 0.2, 1);
    if (contact.kind === "scout") {
      const baseValue = contact.combatCapable ? 0.21 : 0.08;
      return baseValue * confidence * (contact.visible ? 1 : 0.75);
    }
    if (contact.kind === "wingman") {
      return 0.42 * this.contactHpRatio(contact) * confidence * (contact.visible ? 1 : 0.86);
    }

    const stats = CHARACTER_DEFS[contact.characterId]?.stats || null;
    const roleFactor = contact.slotKey === "main" ? 1.28 : 0.98;
    const rangeFactor = stats ? clamp(stats.range / 520, 0.84, 1.18) : 1;
    const dpsFactor = stats ? clamp((stats.damage / Math.max(stats.fireRate, 0.22)) / 58, 0.78, 1.32) : 1;
    return roleFactor * rangeFactor * dpsFactor * (0.34 + 0.66 * this.contactHpRatio(contact)) * confidence * (contact.visible ? 1 : 0.92);
  }

  shipCombatValue(ship) {
    if (!ship || !ship.alive) {
      return 0;
    }
    const hpRatio = clamp(ship.hp / Math.max(ship.maxHp, 1), 0.08, 1);
    const energyRatio = clamp(ship.energy / Math.max(ship.maxEnergy, 1), 0, 1);
    const roleFactor = ship.key === "main" ? 1.24 : ship.isAuxiliary ? 0.72 : 1;
    const rangeFactor = clamp(ship.effectiveRange() / 520, 0.84, 1.2);
    const dpsFactor = clamp((ship.effectiveDamage() / Math.max(ship.effectiveFireRate(), 0.22)) / 60, 0.78, 1.34);
    return roleFactor * rangeFactor * dpsFactor * (0.38 + 0.62 * hpRatio) * (0.48 + 0.52 * energyRatio);
  }

  friendlyPowerAround(x, y, radius = 320) {
    let total = 0;
    for (const ship of this.team.getAllShips()) {
      if (!ship.alive) {
        continue;
      }
      const d = distance(ship.x, ship.y, x, y);
      if (d > radius * 1.2) {
        continue;
      }
      total += this.shipCombatValue(ship) * clamp(1 - d / Math.max(radius * 1.2, 1), 0.25, 1);
    }
    for (const wingman of this.team.wingmen) {
      if (!wingman.alive) {
        continue;
      }
      const d = distance(wingman.x, wingman.y, x, y);
      if (d > radius * 1.2) {
        continue;
      }
      total += 0.36 * clamp(wingman.hp / Math.max(wingman.maxHp, 1), 0.2, 1) * clamp(1 - d / Math.max(radius * 1.2, 1), 0.22, 1);
    }
    for (const scout of this.team.scouts) {
      if (!scout.alive || !scout.combatCapable) {
        continue;
      }
      const d = distance(scout.x, scout.y, x, y);
      if (d > radius * 1.2) {
        continue;
      }
      total += 0.21 * clamp(1 - d / Math.max(radius * 1.2, 1), 0.22, 1);
    }
    return total;
  }

  enemyThreatAround(x, y, radius = 320, maxAge = 8) {
    let total = 0;
    for (const contact of this.knownEnemyContacts({ maxAge })) {
      const d = distance(contact.x, contact.y, x, y);
      if (d > radius * 1.25) {
        continue;
      }
      total += this.contactCombatValue(contact) * clamp(1 - d / Math.max(radius * 1.25, 1), 0.22, 1);
    }
    return total;
  }

  enemyIsolationScore(contact, maxAge = 6) {
    if (!contact) {
      return 0;
    }
    const nearbyThreat = this.enemyThreatAround(contact.x, contact.y, 240, maxAge) - this.contactCombatValue(contact);
    return clamp(1.2 - nearbyThreat, -0.4, 1.1);
  }

  estimateVisionRange(contact) {
    if (!contact) {
      return 165;
    }
    if (contact.kind === "scout") {
      return contact.combatCapable ? CHARACTER_DEFS.yuki.stats.vision : 100;
    }
    if (contact.kind === "wingman") {
      return 100;
    }
    const stats = CHARACTER_DEFS[contact.characterId]?.stats;
    let value = stats?.vision || 165;
    if (contact.characterId === "yuki" && contact.slotKey && contact.slotKey !== "main") {
      value += 24;
    }
    return value;
  }

  shipVitality(ship) {
    if (!ship || !ship.alive) {
      return {
        hpRatio: 0,
        energyRatio: 0,
        value: 0,
        fragile: true,
        healthy: false,
      };
    }
    const hpRatio = clamp(ship.hp / Math.max(ship.maxHp, 1), 0, 1);
    const energyRatio = clamp(ship.energy / Math.max(ship.maxEnergy, 1), 0, 1);
    const value = hpRatio * 0.7 + energyRatio * 0.3;
    return {
      hpRatio,
      energyRatio,
      value,
      fragile: hpRatio < 0.4 || energyRatio < 0.18,
      healthy: hpRatio >= 0.7 && energyRatio >= 0.34,
    };
  }

  shipThreatSnapshot(ship, maxAge = 7) {
    if (!ship || !ship.alive) {
      return {
        sources: 0,
        pressure: 0,
        friendlySupport: 0,
        danger: 0,
        overwhelmed: false,
      };
    }

    let sources = 0;
    let pressure = 0;
    for (const contact of this.knownEnemyContacts({ maxAge })) {
      if (contact.kind === "scout" && !contact.combatCapable) {
        continue;
      }
      const range = contact.kind === "ship"
        ? ((CHARACTER_DEFS[contact.characterId]?.stats?.range || 500) + 70)
        : contact.combatCapable
          ? CHARACTER_DEFS.yuki.stats.range + 70
          : 300;
      const d = distance(ship.x, ship.y, contact.x, contact.y);
      if (d > range) {
        continue;
      }
      sources += 1;
      pressure += this.contactCombatValue(contact) * clamp(1 - d / Math.max(range, 1), 0.24, 1);
    }

    const friendlySupport = Math.max(0.1, this.friendlyPowerAround(ship.x, ship.y, 250) - this.shipCombatValue(ship) * 0.22);
    const danger = pressure / friendlySupport;
    return {
      sources,
      pressure,
      friendlySupport,
      danger,
      overwhelmed: sources >= 2 && danger > 0.96,
    };
  }

  escapeTargetForShip(ship, anchorX, anchorY, maxAge = 7) {
    if (!ship || !ship.alive) {
      return null;
    }
    const hostiles = this.knownEnemyContacts({ maxAge }).filter((contact) => {
      if (contact.kind === "scout" && !contact.combatCapable) {
        return false;
      }
      return distance(ship.x, ship.y, contact.x, contact.y) <= 360;
    });
    if (hostiles.length === 0) {
      return null;
    }

    let sumX = 0;
    let sumY = 0;
    let weightTotal = 0;
    for (const hostile of hostiles) {
      const weight = this.contactCombatValue(hostile) * clamp(1.2 - this.contactHpRatio(hostile) * 0.2, 0.8, 1.3);
      sumX += hostile.x * weight;
      sumY += hostile.y * weight;
      weightTotal += weight;
    }
    const centerX = weightTotal > 0 ? sumX / weightTotal : ship.x;
    const centerY = weightTotal > 0 ? sumY / weightTotal : ship.y;
    const awayX = ship.x - centerX;
    const awayY = ship.y - centerY;
    const awayLen = Math.max(1, Math.hypot(awayX, awayY));
    const anchorDx = anchorX - ship.x;
    const anchorDy = anchorY - ship.y;
    const anchorLen = Math.max(1, Math.hypot(anchorDx, anchorDy));
    const safeReach = clamp(210 + hostiles.length * 18, 210, 320);
    return {
      x: this.team.match.clampX(ship.x + (awayX / awayLen) * safeReach + (anchorDx / anchorLen) * 90, this.safeRoutePadding(14)),
      y: this.team.match.clampY(ship.y + (awayY / awayLen) * safeReach + (anchorDy / anchorLen) * 90, this.safeRoutePadding(14)),
      hostiles,
    };
  }

  splitUtilityForShip(ship, context) {
    if (!ship || !ship.alive || !context) {
      return 0;
    }
    const vitality = this.shipVitality(ship);
    const visionEdge = clamp((ship.effectiveVision() - this.estimateVisionRange(context.focus)) / 52, -0.18, 0.7);
    const characterBias = ship.characterId === "yuki"
      ? 0.46
      : ship.characterId === "future1096"
        ? 0.28
        : ship.characterId === "asakura"
          ? 0.24
          : ship.characterId === "shamisen"
            ? 0.22
          : 0.12;
    return vitality.value + visionEdge + characterBias;
  }

  energyProfile(shipOrKey) {
    const members = this.team.fleetMembersForShip(shipOrKey).filter((ship) => ship.alive);
    const pool = this.team.fleetEnergyForShip(shipOrKey);
    const ratio = pool.current / Math.max(pool.max, 1);
    const regen = members.reduce((sum, ship) => sum + ship.baseEnergyRegen(), 0);
    const moveLoad = members.reduce((sum, ship) => sum + ship.moveEnergyDrain(), 0);
    const sustainCruise = members.reduce((sum, ship) => (
      sum + energyRateForThrottle(ship.baseEnergyRegen(), ship.moveEnergyDrain(), throttleForGear(3))
    ), 0);
    const sustainRecover = members.reduce((sum, ship) => (
      sum + energyRateForThrottle(ship.baseEnergyRegen(), ship.moveEnergyDrain(), throttleForGear(2))
    ), 0);
    return {
      current: pool.current,
      max: pool.max,
      ratio,
      regen,
      moveLoad,
      sustainCruise,
      sustainRecover,
      high: ratio >= 0.7,
      low: ratio <= 0.32,
      critical: ratio <= 0.16,
    };
  }

  energyThrottleGearCap(shipOrKey) {
    const profile = this.energyProfile(shipOrKey);
    if (profile.ratio <= AI_ENERGY_GEAR_POLICY.criticalRatio) {
      return 1;
    }
    if (profile.ratio <= AI_ENERGY_GEAR_POLICY.lowRatio) {
      return 2;
    }
    const ship = typeof shipOrKey === "string" ? this.team.ships[shipOrKey] : shipOrKey;
    const currentGear = throttleGearForValue(ship?.throttle);
    const overdriveThreshold = currentGear === 4
      ? AI_ENERGY_GEAR_POLICY.overdriveStopRatio
      : AI_ENERGY_GEAR_POLICY.overdriveStartRatio;
    return profile.ratio >= overdriveThreshold ? 4 : 3;
  }

  energyAwareThrottleForShip(ship, requestedThrottle) {
    const intendedGear = requestedThrottle > 1
      ? 4
      : throttleGearForValue(requestedThrottle);
    return throttleForGear(Math.min(intendedGear, this.energyThrottleGearCap(ship)));
  }

  enforceEnergyThrottleCaps() {
    for (const ship of Object.values(this.team.ships)) {
      if (!ship?.alive || ship.isAttached()) {
        continue;
      }
      const currentGear = throttleGearForValue(ship.throttle);
      const gearCap = this.energyThrottleGearCap(ship);
      if (currentGear > gearCap) {
        ship.throttle = throttleForGear(gearCap);
      }
    }
  }

  energyRatioAfterSpend(shipOrKey, cost) {
    const profile = this.energyProfile(shipOrKey);
    if (profile.max <= 0) {
      return 0;
    }
    return (profile.current - cost) / profile.max;
  }

  allowEnergyCommit(shipOrKey, cost, context, {
    emergencyFloor = 0.05,
    normalFloor = 0.14,
    conserveFloor = 0.24,
  } = {}) {
    const profile = this.energyProfile(shipOrKey);
    if (profile.current < cost) {
      return false;
    }
    const afterRatio = this.energyRatioAfterSpend(shipOrKey, cost);
    const floor = context?.emergencyCommit
      ? emergencyFloor
      : context?.energyRecoveryNeed > 0.62
        ? conserveFloor
        : normalFloor - Math.min(0.08, (context?.energySurplus || 0) * 0.1);
    return afterRatio >= floor || profile.high;
  }

  pointEdgeClearance(x, y) {
    const size = this.team.match.worldSize;
    return Math.min(x, y, size - x, size - y);
  }

  arcDensityFromState(facingAngle, fromX, fromY, toX, toY, uniformOutput = false) {
    const bearing = Math.atan2(toY - fromY, toX - fromX);
    return fireArcDensityMultiplier(Math.abs(shortestAngleDelta(facingAngle, bearing)), uniformOutput);
  }

  broadsideIntentAngle(fromX, fromY, targetX, targetY, sign = 1) {
    const bearing = Math.atan2(targetY - fromY, targetX - fromX);
    return bearing - sign * Math.PI * 0.5;
  }

  evaluateArcExchange(ship, enemyEstimate, candidate, exposureWeight = 1) {
    if (!ship || !enemyEstimate || !candidate) {
      return {
        ownDensity: 1,
        enemyDensity: 1,
        score: 0,
      };
    }

    const intentAngle = Number.isFinite(candidate.intentAngle)
      ? candidate.intentAngle
      : Math.atan2(candidate.y - ship.y, candidate.x - ship.x);
    const enemyFacing = Number.isFinite(candidate.enemyFacingAngle) ? candidate.enemyFacingAngle : enemyEstimate.angle;
    const ownDensity = this.arcDensityFromState(
      intentAngle,
      candidate.x,
      candidate.y,
      enemyEstimate.x,
      enemyEstimate.y,
      this.team.hasKyonFlagship(),
    );
    const enemyDensity = this.arcDensityFromState(
      enemyFacing,
      enemyEstimate.x,
      enemyEstimate.y,
      candidate.x,
      candidate.y,
      this.enemy.hasKyonFlagship(),
    );
    const edgePenalty = clamp((150 - this.pointEdgeClearance(candidate.x, candidate.y)) / 150, 0, 1) * 0.55;
    const preferredRange = Number.isFinite(candidate.preferredRange) ? candidate.preferredRange : ship.effectiveRange() * 0.9;
    const actualRange = distance(candidate.x, candidate.y, enemyEstimate.x, enemyEstimate.y);
    const rangePenalty = Math.abs(actualRange - preferredRange) / Math.max(preferredRange, 1);
    return {
      ownDensity,
      enemyDensity,
      score: ownDensity * 1.35 - enemyDensity * exposureWeight - edgePenalty - rangePenalty * 0.3,
    };
  }

  preferredFlankSign(main, contact) {
    if (!contact) {
      return this.searchSweepSign;
    }
    const enemyForward = { x: Math.cos(contact.angle), y: Math.sin(contact.angle) };
    const enemySide = { x: -enemyForward.y, y: enemyForward.x };
    const sideOffset = clamp(main.effectiveRange() * 0.82, 180, 320);
    const rearOffset = clamp(main.effectiveRange() * 0.22, 55, 130);
    let bestSign = this.searchSweepSign;
    let bestScore = -Infinity;
    for (const sign of [1, -1]) {
      const candidate = {
        x: this.team.match.clampX(contact.x - enemyForward.x * rearOffset + enemySide.x * sideOffset * sign, this.safeRoutePadding()),
        y: this.team.match.clampY(contact.y - enemyForward.y * rearOffset + enemySide.y * sideOffset * sign, this.safeRoutePadding()),
      };
      candidate.intentAngle = this.broadsideIntentAngle(candidate.x, candidate.y, contact.x, contact.y, sign);
      candidate.preferredRange = clamp(main.effectiveRange() * 0.86, 180, 340);
      const exchange = this.evaluateArcExchange(main, contact, candidate, 1.2);
      const clearanceBias = this.pointEdgeClearance(candidate.x, candidate.y) / 220;
      const score = exchange.score + clearanceBias;
      if (score > bestScore) {
        bestScore = score;
        bestSign = sign;
      }
    }
    return bestSign;
  }

  selectEnemyFocus(main) {
    const contacts = this.knownEnemyContacts({ maxAge: 8 });
    if (contacts.length === 0) {
      return this.primaryEnemyEstimate();
    }

    let best = null;
    let bestScore = -Infinity;
    for (const contact of contacts) {
      if (contact.kind === "scout") {
        continue;
      }
      const dist = distance(main.x, main.y, contact.x, contact.y);
      const proximity = clamp(1 - dist / Math.max(main.effectiveRange() * 2.4, 1), -0.18, 0.95);
      const freshness = clamp(1 - contact.age / 8, 0, 1);
      const vulnerability = 1 - this.contactHpRatio(contact);
      const isolation = this.enemyIsolationScore(contact, 6);
      const overwhelmOpportunity = clamp(
        (this.friendlyPowerAround(contact.x, contact.y, 300) + 0.2) / Math.max(this.enemyThreatAround(contact.x, contact.y, 280, 6) + 0.2, 0.2) - 1,
        -0.2,
        1.4,
      );
      const typeBias = contact.slotKey === "main" ? 1.28 : contact.kind === "ship" ? 0.9 : 0.32;
      const visibleBias = contact.visible ? 0.82 : 0.3;
      const uncertaintyPenalty = clamp((contact.uncertainty || 0) / 240, 0, 1.4);
      const score = typeBias
        + proximity
        + freshness * 0.82
        + vulnerability * 1.08
        + isolation * 0.82
        + overwhelmOpportunity * 0.92
        + visibleBias
        + (this.legacy ? 0 : characterTargetPriorityBonus(contact, this.team.match.elapsed))
        - uncertaintyPenalty;
      if (score > bestScore) {
        bestScore = score;
        best = contact;
      }
    }
    return best || this.primaryEnemyEstimate();
  }

  buildTacticalContext(main, focus) {
    const fleetEnergy = this.energyProfile("main");
    const rangeRef = main.effectiveRange();
    const dist = distance(main.x, main.y, focus.x, focus.y);
    const mainHull = main.hp / Math.max(main.maxHp, 1);
    const mainEnergyRatio = clamp(main.energy / Math.max(main.maxEnergy, 1), 0, 1);
    const fleetHull = this.team.hullRatio();
    const energyRatio = fleetEnergy.ratio;
    const friendlyLocal = this.friendlyPowerAround(focus.x, focus.y, 330);
    const friendlyEscort = this.friendlyPowerAround(main.x, main.y, 240);
    const enemyLocal = this.enemyThreatAround(focus.x, focus.y, 330, 8);
    const localAdvantage = (friendlyLocal + friendlyEscort * 0.34 + 0.25) / Math.max(enemyLocal + 0.25, 0.25);
    const intelSolid = focus.visible || (focus.source !== "spawn" && focus.age <= 5.5 && focus.confidence >= 0.42);
    const searchRequired = focus.source === "spawn" || focus.age > 9 || focus.confidence < 0.26;
    const killWindow = this.contactHpRatio(focus) < 0.44 && dist < rangeRef * 1.75;
    const broadsideWindow = dist > rangeRef * 0.58 && dist < rangeRef * 1.2 && intelSolid;
    const detachedShips = [this.team.ships.sub1, this.team.ships.sub2].filter((ship) => ship.alive && !ship.isAttached());
    const detachedSpread = detachedShips.reduce((max, ship) => Math.max(max, distance(ship.x, ship.y, main.x, main.y)), 0);
    const overextended = detachedSpread > 320 && localAdvantage < 0.92;
    const shipThreats = new Map();
    let maxShipThreat = 0;
    let overwhelmedShipKey = null;
    for (const ship of [main, ...detachedShips]) {
      const threat = this.shipThreatSnapshot(ship);
      shipThreats.set(ship.key, threat);
      if (threat.danger > maxShipThreat) {
        maxShipThreat = threat.danger;
      }
      if (!overwhelmedShipKey && threat.overwhelmed) {
        overwhelmedShipKey = ship.key;
      }
    }
    const defensivePressure = (localAdvantage < 0.72 && dist < rangeRef * 1.22) || mainHull < 0.28;
    const flankSign = this.preferredFlankSign(main, focus);
    const ownArcDensity = this.arcDensityFromState(main.angle, main.x, main.y, focus.x, focus.y, this.team.hasKyonFlagship());
    const enemyArcDensity = this.arcDensityFromState(focus.angle, focus.x, focus.y, main.x, main.y, this.enemy.hasKyonFlagship());
    const arcAdvantage = ownArcDensity - enemyArcDensity;
    const enemyBroadsideRisk = enemyArcDensity >= 1.45;
    const safeExchange = enemyArcDensity <= 1 && ownArcDensity >= 1;
    const focusFreshness = clamp(1 - focus.age / 10, 0, 1);
    const trackableIntel = !intelSolid && focus.source !== "spawn" && focus.age <= 13 && focus.confidence >= 0.16;
    const intelUrgency = focus.visible ? 0.08 : focus.source === "spawn" ? 1.28 : clamp(0.52 + focus.age / 9 + (1 - focus.confidence) * 0.78, 0.3, 1.6);
    const isolatedTargetScore = clamp(this.enemyIsolationScore(focus, 6) + Math.max(0, localAdvantage - 0.92) * 0.65, -0.25, 1.5);
    const combatUrgency = clamp(
      (focus.visible ? 0.38 : 0.12)
      + (dist < rangeRef * 1.08 ? 0.32 : 0)
      + (killWindow ? 0.38 : 0)
      + (enemyLocal > friendlyLocal * 0.9 && dist < rangeRef * 1.32 ? 0.12 : 0)
      + (trackableIntel ? 0.22 : 0)
      + Math.max(0, maxShipThreat - 0.88) * 0.36
      + isolatedTargetScore * 0.18,
      0,
      1.55,
    );
    const counterCollapse = clamp(maxShipThreat - 0.82, 0, 1.1) * clamp(localAdvantage, 0.6, 1.4);
    const emergencyCommit = killWindow
      || maxShipThreat > 0.96
      || (focus.visible && (combatUrgency > 0.68 || dist < rangeRef * 0.92))
      || (trackableIntel && dist < rangeRef * 0.82 && localAdvantage > 1.12);
    const energySurplus = clamp((energyRatio - 0.58) / 0.42, 0, 1);
    const energyRecoveryNeed = clamp((0.46 - energyRatio) / 0.46, 0, 1) * (emergencyCommit ? 0.18 : 0.82);
    const conserveEnergy = energyRecoveryNeed > 0.78 && !emergencyCommit && !trackableIntel;
    const mobilityBias = clamp(0.88 + energySurplus * 0.34 + (emergencyCommit ? 0.26 : 0) - energyRecoveryNeed * 0.24, 0.62, 1.34);
    const skillAggression = clamp(
      0.38
      + energySurplus * 0.84
      + combatUrgency * 0.72
      + (trackableIntel ? 0.24 : 0)
      + isolatedTargetScore * 0.18
      - energyRecoveryNeed * 0.28,
      0,
      1.8,
    );
    const scoutPriority = clamp(
      intelUrgency * 0.94
      + (searchRequired ? 0.34 : 0)
      + (trackableIntel ? 0.34 : 0)
      + Math.max(0, maxShipThreat - 0.9) * 0.45
      - combatUrgency * 0.22
      - energyRecoveryNeed * 0.28,
      0,
      1.8,
    );
    const encirclePressure = clamp(
      0.82
      + focusFreshness * 0.46
      + (trackableIntel ? 0.42 : 0)
      + (searchRequired ? 0.32 : 0)
      + isolatedTargetScore * 0.24,
      0.6,
      1.65,
    );
    const pressureDrive = clamp(localAdvantage - 0.76, 0, 1.1) * 1.34
      + energySurplus * 0.78
      + clamp(focusFreshness - 0.18, 0, 0.82) * 0.74
      + (killWindow ? 0.82 : 0)
      + (trackableIntel ? 0.64 : 0)
      + (emergencyCommit ? 0.28 : 0)
      + counterCollapse * 0.22
      + isolatedTargetScore * 0.26
      - energyRecoveryNeed * 0.32;

    // 收尾判断：是否占优(领先) + 是否到了该收尾的窗口(敌方濒临覆灭)。
    // 领先时不应因自身低血/低能转入防守，而应压制收尾——破解"双方都低血同时转防守"的平局僵局。
    const enemyHullTeam = this.enemy.hullRatio();
    const ownHullTeam = this.team.hullRatio();
    const enemyAliveCount = this.enemy.getAllShips().filter((s) => s && s.alive).length;
    const ownAliveCount = this.team.getAllShips().filter((s) => s && s.alive).length;
    const winning = this.legacy ? false : (ownAliveCount > enemyAliveCount || ownHullTeam > enemyHullTeam + 0.08);
    const closeoutWindow = this.legacy ? false : (enemyAliveCount > 0
      && (enemyAliveCount < ownAliveCount || enemyHullTeam < 0.3 || (killWindow && winning)));
    const enemyMainContact = this.projectContact(this.enemyIntel.main, 1.2);
    const advancedCounterplay = this.usesAdvancedSkillCounterplay();
    const barrierTactics = buildKoizumiBarrierTactics({
      team: this.team,
      enemyMainContact,
      main,
      detachedShips,
      enemyContacts: this.knownEnemyContacts({ maxAge: 4.5 }),
      now: this.team.match.elapsed,
      legacy: this.legacy,
      advanced: advancedCounterplay,
      mainHull,
      localAdvantage,
      killWindow,
    });

    return {
      focus,
      rangeRef,
      winning,
      closeoutWindow,
      dist,
      mainHull,
      mainEnergyRatio,
      fleetHull,
      energyRatio,
      friendlyLocal,
      enemyLocal,
      localAdvantage,
      intelSolid,
      searchRequired,
      killWindow,
      broadsideWindow,
      detachedCount: detachedShips.length,
      detachedSpread,
      overextended,
      defensivePressure,
      edgePressure: this.edgePressure(main),
      flankSign,
      ownArcDensity,
      enemyArcDensity,
      arcAdvantage,
      enemyBroadsideRisk,
      safeExchange,
      fleetEnergy,
      focusFreshness,
      trackableIntel,
      intelUrgency,
      combatUrgency,
      emergencyCommit,
      energySurplus,
      energyRecoveryNeed,
      conserveEnergy,
      mobilityBias,
      skillAggression,
      scoutPriority,
      encirclePressure,
      pressureDrive,
      isolatedTargetScore,
      maxShipThreat,
      overwhelmedShipKey,
      counterCollapse,
      shipThreats,
      barrierTactics,
    };
  }

  shouldSplit(level, context, elapsed) {
    if (!context) {
      return false;
    }
    if (level === 1) {
      const ship = this.team.ships.sub1;
      if (this.team.splitLevel !== 0 || !ship.alive) {
        return false;
      }
      if (
        context.barrierTactics?.enemy?.active
        && ["asakura", "koizumi"].includes(ship.characterId)
        && elapsed > 4
        && context.fleetHull > 0.54
      ) {
        return true;
      }
      const splitUtility = this.splitUtilityForShip(ship, context);
      if ((context.mainHull < 0.32 && context.mainEnergyRatio < 0.18) || context.fleetHull < 0.42 || context.energyRatio < 0.14 || (context.defensivePressure && context.maxShipThreat > 1.15)) {
        return elapsed > 30 && context.dist > context.rangeRef * 1.5;
      }
      if (context.searchRequired && elapsed < (splitUtility > 1.3 ? 10 : 14) && !context.trackableIntel) {
        return false;
      }
      const earlyWindow = splitUtility > 1.34 ? 6.2 : splitUtility > 1.08 ? 7.8 : 9.2;
      return elapsed > earlyWindow && (
        context.killWindow
        || context.trackableIntel
        || context.intelSolid
        || context.isolatedTargetScore > 0.34
        || context.focusFreshness > 0.44
        || context.localAdvantage > (splitUtility > 1.08 ? 0.72 : 0.82)
        || context.dist < context.rangeRef * 1.9
      );
    }
    if (level === 2) {
      const ship = this.team.ships.sub2;
      if (this.team.splitLevel !== 1 || !ship.alive) {
        return false;
      }
      if (
        context.barrierTactics?.enemy?.active
        && ["asakura", "koizumi"].includes(ship.characterId)
        && elapsed > 8
        && context.fleetHull > 0.58
        && !context.overextended
      ) {
        return true;
      }
      const splitUtility = this.splitUtilityForShip(ship, context);
      if ((context.mainHull < 0.38 && context.mainEnergyRatio < 0.22) || context.fleetHull < 0.5 || context.energyRatio < 0.2 || context.overextended || (context.defensivePressure && context.maxShipThreat > 1.08)) {
        return elapsed > 58 && context.localAdvantage > 0.9;
      }
      if (!context.intelSolid && !context.trackableIntel && elapsed < (splitUtility > 1.18 ? 22 : 30)) {
        return false;
      }
      const earlyWindow = splitUtility > 1.28 ? 13.5 : splitUtility > 1.04 ? 16.5 : 18.5;
      return elapsed > earlyWindow && (
        context.killWindow
        || context.trackableIntel
        || context.intelSolid
        || context.isolatedTargetScore > 0.42
        || context.localAdvantage > (splitUtility > 1.12 ? 0.86 : 0.98)
        || context.dist < context.rangeRef * 1.35
      );
    }
    return false;
  }

  evaluateSplit(elapsed, context) {
    const acted = [];
    const attempt1 = this.shouldSplit(1, context, elapsed);
    if (attempt1 && this.team.split(1)) {
      acted.push(1);
    }
    const attempt2 = this.shouldSplit(2, context, elapsed);
    if (attempt2 && this.team.split(2)) {
      acted.push(2);
    }
    this.lastSplitDecision = {
      attempt1,
      attempt2,
      acted,
      level: this.team.splitLevel,
      at: elapsed,
    };
  }

  acquireSearchCenter(main, enemyEstimate = null) {
    // 看得见敌人→直接以其所在战区为中心
    if (enemyEstimate && enemyEstimate.visible && enemyEstimate.zoneId) {
      this.enemyIntel.searchZoneId = enemyEstimate.zoneId;
      return this.zoneCenter(enemyEstimate.zoneId);
    }

    // 看不见→去 belief 占据图的"最高概率(且未被排除)区域"——类人:持续预测+排除看过的+缩小可能区
    const peak = this.beliefPeak();
    if (peak) {
      const zone = this.zoneForPoint(peak.x, peak.y);
      if (zone) this.enemyIntel.searchZoneId = zone.id;
      return { zoneId: this.enemyIntel.searchZoneId || 5, x: peak.x, y: peak.y };
    }

    if (!this.enemyIntel.searchZoneId) {
      this.enemyIntel.searchZoneId = this.searchOrder[this.searchCursor % this.searchOrder.length];
      this.searchCursor = (this.searchCursor + 1) % this.searchOrder.length;
    }

    const current = this.zoneCenter(this.enemyIntel.searchZoneId);
    if (
      distance(main.x, main.y, current.x, current.y) <= this.profile.searchArrivalRadius
      || this.team.match.elapsed - this.lastSearchAdvanceAt > this.profile.searchAdvanceWindow
    ) {
      this.enemyIntel.searchZoneId = this.searchOrder[this.searchCursor % this.searchOrder.length];
      this.searchCursor = (this.searchCursor + 1) % this.searchOrder.length;
      this.searchSweepSign *= -1;
      this.lastSearchAdvanceAt = this.team.match.elapsed;
    }

    return this.zoneCenter(this.enemyIntel.searchZoneId);
  }

  likelyProbeZoneId(focus) {
    if (!focus) {
      return null;
    }
    const travel = this.predictEnemyVector(focus);
    const probeDistance = clamp((140 + (focus.uncertainty || 0) * 0.9) * this.profile.probeDistanceMultiplier, 150, this.team.match.worldSize / 2.6);
    const probeX = this.team.match.clampX(focus.x + Math.cos(travel.angle) * probeDistance, this.safeRoutePadding());
    const probeY = this.team.match.clampY(focus.y + Math.sin(travel.angle) * probeDistance, this.safeRoutePadding());
    return this.zoneForPoint(probeX, probeY).id;
  }

  // 选侦察机起源舰：取离"敌方估计位置(或目标战区中心)"最近的存活舰，使侦察最快抵近目标(前出分离舰优先)
  pickScoutSourceKey(zoneId, aimPoint = null) {
    const c = (aimPoint && Number.isFinite(aimPoint.x)) ? aimPoint : this.zoneCenter(zoneId);
    let bestKey = "main";
    let bestD = Infinity;
    for (const key of ["main", "sub1", "sub2"]) {
      const ship = this.team.ships[key];
      if (!ship || !ship.alive) continue;
      const d = c ? distance(ship.x, ship.y, c.x, c.y) : 0;
      if (d < bestD) { bestD = d; bestKey = key; }
    }
    return bestKey;
  }

  pickScoutZoneId(main, enemyEstimate = null) {
    const focus = enemyEstimate || this.primaryEnemyEstimate();
    if (focus && focus.zoneId) {
      const probeZoneId = this.likelyProbeZoneId(focus);
      if (focus.visible) {
        this.enemyIntel.searchZoneId = focus.zoneId;
        return this.stableNoise(Math.round(this.team.match.elapsed * 10), focus.zoneId) < 0.72 && probeZoneId
          ? probeZoneId
          : focus.zoneId;
      }
      if (focus.age <= 12) {
        this.enemyIntel.searchZoneId = probeZoneId || focus.zoneId;
        if (probeZoneId && this.stableNoise(Math.round(this.team.match.elapsed * 8), probeZoneId) < 0.92) {
          return probeZoneId;
        }
        return focus.zoneId;
      }
    }
    return this.acquireSearchCenter(main, focus).zoneId;
  }

  planScoutDeployment(context = this.currentContext) {
    if (!this.team.hasYukiFlagship() || !this.team.ships.main.alive) {
      return null;
    }
    const focus = context?.focus || this.primaryEnemyEstimate();
    const activeScouts = this.team.scouts
      .filter((scout) => scout.alive && scout.combatCapable)
      .map((scout) => ({
        id: scout.id,
        zoneId: scout.zone?.id || this.zoneForPoint(scout.x, scout.y).id,
        life: scout.life,
        mode: scout.mode,
        mission: scout.mission,
      }));
    return planYukiScoutDeployment({
      state: this.scoutDoctrine,
      zones: this.team.match.zones,
      worldSize: this.team.match.worldSize,
      ownMain: this.team.ships.main,
      forwardSign: this.team.seat === "A" ? 1 : -1,
      focus,
      contacts: this.knownEnemyContacts({ maxAge: 12 }),
      beliefZoneWeights: this.beliefZoneWeights(),
      activeScouts,
      context: context || {},
      now: this.team.match.elapsed,
      probeZoneId: this.likelyProbeZoneId(focus),
    });
  }

  retaskYukiCombatScouts(plan) {
    const now = this.team.match.elapsed;
    if (!plan || now < this.scoutDoctrine.nextRetaskAt) {
      return 0;
    }
    const activeScouts = this.team.scouts
      .filter((scout) => scout.alive && scout.combatCapable)
      .map((scout) => ({
        id: scout.id,
        zoneId: scout.zone?.id || this.zoneForPoint(scout.x, scout.y).id,
        life: scout.life,
        mode: scout.mode,
        mission: scout.mission,
      }));
    const orders = buildScoutRetaskOrders(plan, activeScouts, 2);
    let retasked = 0;
    for (const [index, order] of orders.entries()) {
      const scout = this.team.scouts.find((item) => item.id === order.scoutId && item.alive);
      if (!scout) continue;
      const seekPoint = scoutMissionPoint(plan, this.team.match.zones, order.zoneId, index + 1);
      if (this.team.assignScoutMission(scout, {
        zoneId: order.zoneId,
        seekPoint,
        patrolCenter: seekPoint,
        patrolRadius: plan.patrolRadius,
        mission: order.mission,
      })) {
        retasked += 1;
      }
    }
    this.scoutDoctrine.nextRetaskAt = now + (retasked > 0 ? 2.4 : 1.2);
    return retasked;
  }

  shouldLaunchScout(context = this.currentContext, scoutPlan = null) {
    if (this.shouldReserveEnergyForHaruhiFlagship()) {
      return false;
    }
    if (!context) {
      return true;
    }
    const fleetEnergy = context.fleetEnergy || this.energyProfile("main");
    if (fleetEnergy.current < SCOUT_LAUNCH_COST) {
      return false;
    }
    if (this.team.hasYukiFlagship()) {
      const activeScouts = this.team.scouts.filter((item) => item.alive && item.combatCapable).length;
      const desiredActive = scoutPlan?.desiredActive || 4;
      const maxActive = scoutPlan?.maxActive || 6;
      if (activeScouts >= maxActive) {
        return false;
      }
      if (context.emergencyCommit && context.intelSolid && fleetEnergy.ratio < 0.24 && activeScouts >= 2) {
        return false;
      }
      if (context.conserveEnergy && activeScouts >= 2 && !context.searchRequired && !context.trackableIntel) {
        return false;
      }
      return activeScouts < desiredActive
        || context.scoutPriority > 0.82
        || context.trackableIntel
        || context.maxShipThreat > 0.92;
    }
    if (context.emergencyCommit && context.intelSolid && fleetEnergy.ratio < 0.34) {
      return false;
    }
    if (context.conserveEnergy && !context.searchRequired && !context.trackableIntel) {
      return false;
    }
    return context.scoutPriority > 0.12;
  }

  shouldReserveEnergyForHaruhiFlagship() {
    if (this.team.mainCharacterId() !== "haruhi" || !this.team.ships.main.alive) {
      return false;
    }
    const meta = skillMetaForCharacter("haruhi", "flagship");
    const cost = Number(meta?.cost) || 0;
    const readyIn = Math.max(
      0,
      Number(this.team.cooldowns.flagship) || 0,
      Number(this.flagshipTimer) || 0,
    );
    if (readyIn > HARUHI_FLAGSHIP_ENERGY_RESERVE_WINDOW) {
      return false;
    }
    const energy = this.energyProfile("main");
    // 即将可以施放时，侦察机不能抢走技能所需能量；仍保留5%余量，避免施放后立刻失去机动能力。
    return energy.current - SCOUT_LAUNCH_COST < cost + energy.max * 0.05;
  }

  combatCenter(enemyEstimate) {
    const worldCenter = this.team.match.worldSize * 0.5;
    return {
      x: lerp(worldCenter, enemyEstimate.x, 0.24),
      y: lerp(worldCenter, enemyEstimate.y, 0.24),
    };
  }

  computeRecoveryTarget(main, enemyEstimate) {
    const padding = this.safeRoutePadding(24);
    const worldSize = this.team.match.worldSize;
    const inwardX = clamp(main.x, padding, worldSize - padding);
    const inwardY = clamp(main.y, padding, worldSize - padding);
    const toEnemyX = enemyEstimate.x - main.x;
    const toEnemyY = enemyEstimate.y - main.y;
    const len = Math.max(1, Math.hypot(toEnemyX, toEnemyY));
    const towardX = toEnemyX / len;
    const towardY = toEnemyY / len;

    return {
      x: clamp(lerp(main.x, inwardX, 0.92) + towardX * 150, padding, worldSize - padding),
      y: clamp(lerp(main.y, inwardY, 0.92) + towardY * 150, padding, worldSize - padding),
    };
  }

  update(dt, elapsed) {
    this.moveTimer -= dt;
    this.koizumiOrbSteerTimer -= dt;
    this.scoutTimer -= dt;
    this.flagshipTimer -= dt;
    this.subTimers.sub1 -= dt;
    this.subTimers.sub2 -= dt;
    this.modeTimer -= dt;

    this.refreshIntel();
    this.updateBelief(dt);
    this.updateStuckState(dt);
    const main = this.team.ships.main;
    const focus = main.alive ? this.selectEnemyFocus(main) : null;
    this.currentContext = main.alive && focus ? this.buildTacticalContext(main, focus) : null;
    this.evaluateSplit(elapsed, this.currentContext);
    this.enforceEnergyThrottleCaps();
    const shouldRefreshScoutPlan = this.team.hasYukiFlagship() && (
      !this.currentScoutPlan
      || this.team.match.elapsed >= this.scoutPlanRefreshAt
      || this.scoutTimer <= 0
      || this.team.match.elapsed >= this.scoutDoctrine.nextRetaskAt
    );
    if (shouldRefreshScoutPlan) {
      this.currentScoutPlan = this.planScoutDeployment(this.currentContext);
      this.scoutPlanRefreshAt = this.team.match.elapsed + 0.4;
    }
    const scoutPlan = this.currentScoutPlan;
    const retaskedScouts = this.retaskYukiCombatScouts(scoutPlan);

    if (
      this.currentContext
      && this.currentContext.intelUrgency > 0.88
      && this.team.scouts.filter((item) => item.alive).length === 0
    ) {
      this.scoutTimer = Math.min(this.scoutTimer, this.profile.aggressiveScoutWindow);
    }

    if (
      this.currentContext
      && this.currentContext.maxShipThreat > 0.94
      && this.team.scouts.filter((item) => item.alive).length <= 1
    ) {
      this.scoutTimer = Math.min(this.scoutTimer, this.profile.aggressiveScoutWindow);
    }

    if (this.moveTimer <= 0 || this.stuckTimer > this.profile.stuckTrigger) {
      this.issueMovement(this.currentContext);
      this.moveTimer = randomInRange(this.profile.moveReplanMin, this.profile.moveReplanMax) * (this.replanMult || 1);
      this.stuckTimer = 0;
    }
    this.steerActiveKoizumiOrbs(this.currentContext);

    if (this.scoutTimer <= 0 && !this.team.areScoutsDisabled()) {
      if (this.shouldLaunchScout(this.currentContext, scoutPlan)) {
        const focusEst = this.currentContext?.focus || this.primaryEnemyEstimate();
        const zoneId = scoutPlan?.zoneId || this.pickScoutZoneId(this.team.ships.main, focusEst);
        // 侦察目标点：看得见就奔可见处；看不见就奔 belief 占据图的最高概率(未排除)区——
        // 让侦察去"最该排查"的地方，系统化缩小可能区(类人搜索)。前出分离舰就近发出，最快覆盖。
        const peak = (focusEst && focusEst.visible) ? null : this.beliefPeak();
        const scoutAim = scoutPlan?.seekPoint || peak || focusEst;
        const scoutSourceKey = this.pickScoutSourceKey(zoneId, scoutAim);
        const seekPoint = scoutAim && Number.isFinite(scoutAim.x) ? { x: scoutAim.x, y: scoutAim.y } : null;
        // 侦察机也必须纳入能量预算。尤其是分离副舰，不能只因刚好攒够28点就立即花光，
        // 否则下一秒既无法机动，也无法使用自保技能。
        const scoutEnergyFloors = this.team.hasYukiFlagship()
          ? { emergencyFloor: 0.08, normalFloor: 0.12, conserveFloor: 0.2 }
          : { emergencyFloor: 0.12, normalFloor: 0.18, conserveFloor: 0.28 };
        const hasScoutReserve = this.allowEnergyCommit(
          scoutSourceKey,
          SCOUT_LAUNCH_COST,
          this.currentContext,
          scoutEnergyFloors,
        );
        const launched = hasScoutReserve
          && this.team.launchScout(zoneId, {
            fromShipKey: scoutSourceKey,
            seekPoint,
            patrolCenter: scoutPlan?.seekPoint || seekPoint,
            patrolRadius: scoutPlan?.patrolRadius,
            mission: scoutPlan?.mission,
          });
        if (launched && scoutPlan) {
          recordScoutDeployment(this.scoutDoctrine, scoutPlan, this.team.match.elapsed);
        }
        this.lastScoutDecision = {
          action: launched ? "launch" : hasScoutReserve ? "retry" : "hold-energy",
          zoneId,
          launched,
          urgent: Boolean(this.currentContext?.emergencyCommit || this.currentContext?.searchRequired || this.currentContext?.trackableIntel),
          doctrineMode: scoutPlan?.mode || null,
          mission: scoutPlan?.mission || null,
          primaryZoneId: scoutPlan?.primaryZoneId || null,
          predictedZoneId: scoutPlan?.predictedZoneId || null,
          retasked: retaskedScouts,
          at: this.team.match.elapsed,
        };
        if (launched) {
          if (scoutPlan) {
            this.scoutTimer = randomInRange(scoutPlan.cadenceMin, scoutPlan.cadenceMax);
          } else if (this.currentContext?.scoutPriority > 1.05 || this.currentContext?.searchRequired || this.currentContext?.maxShipThreat > 0.92) {
            this.scoutTimer = randomInRange(3.1, 4.8);
          } else if (this.currentContext?.trackableIntel) {
            this.scoutTimer = randomInRange(3.6, 5.4);
          } else if (this.currentContext?.conserveEnergy) {
            this.scoutTimer = randomInRange(5.2, 7.4);
          } else {
            this.scoutTimer = randomInRange(4.5, 6.8);
          }
        } else {
          this.scoutTimer = !hasScoutReserve
            ? this.team.hasYukiFlagship() ? randomInRange(1.2, 2.2) : randomInRange(2.2, 3.8)
            : this.currentContext?.emergencyCommit
              ? randomInRange(0.9, 1.8)
              : randomInRange(1.4, 2.8);
        }
      } else {
        this.lastScoutDecision = {
          action: "hold",
          zoneId: this.enemyIntel.searchZoneId || null,
          launched: false,
          urgent: false,
          doctrineMode: scoutPlan?.mode || null,
          mission: scoutPlan?.mission || null,
          primaryZoneId: scoutPlan?.primaryZoneId || null,
          predictedZoneId: scoutPlan?.predictedZoneId || null,
          retasked: retaskedScouts,
          at: this.team.match.elapsed,
        };
        this.scoutTimer = this.team.hasYukiFlagship()
          ? this.currentContext?.conserveEnergy ? randomInRange(1.4, 2.2) : randomInRange(0.8, 1.4)
          : this.currentContext?.conserveEnergy ? randomInRange(2.2, 3.4) : randomInRange(1.2, 2.2);
      }
    }

    this.tryFlagshipSkill(this.currentContext);
    this.trySubSkill("sub1", this.currentContext);
    this.trySubSkill("sub2", this.currentContext);
    // 技能可能在本 tick 内显著消耗能量，立即降档，不能等下一轮改航才停止4档消耗。
    this.enforceEnergyThrottleCaps();
  }

  tryFlagshipSkill(context = this.currentContext) {
    if (this.flagshipTimer > 0) {
      return;
    }
    const estimate = context?.focus || this.primaryEnemyEstimate();
    const characterId = this.team.mainCharacterId();
    const isHaruhi = characterId === "haruhi";
    if (!this.shouldCastFlagshipSkill(estimate, context)) {
      this.lastFlagshipDecision = {
        action: "hold",
        cast: false,
        at: this.team.match.elapsed,
        target: this.debugContact(estimate),
      };
      this.flagshipTimer = isHaruhi
        ? randomInRange(0.25, 0.45)
        : context?.conserveEnergy
          ? randomInRange(1.8, 3.2)
          : context?.skillAggression > 0.95
            ? randomInRange(0.45, 0.9)
            : randomInRange(1.2, 2.4);
      return;
    }
    const ok = this.team.castFlagshipSkill();
    this.lastFlagshipDecision = {
      action: ok ? "cast" : "retry",
      cast: ok,
      at: this.team.match.elapsed,
      target: this.debugContact(estimate),
    };
    this.flagshipTimer = ok
      ? isHaruhi
        // 与真实冷却对齐；两者每帧同步递减，冷却归零的同一帧立即进入下一次施放判断。
        ? Math.max(0.15, Number(this.team.cooldowns.flagship) || 0)
        : (context?.skillAggression > 0.95 ? randomInRange(12, 17) : randomInRange(14, 20))
      : isHaruhi
        ? randomInRange(0.18, 0.35)
        : context?.conserveEnergy
          ? randomInRange(4.8, 7.4)
          : context?.skillAggression > 0.95
            ? randomInRange(1, 2.1)
            : randomInRange(2.8, 5.6);
  }

  trySubSkill(shipKey, context = this.currentContext) {
    if (this.subTimers[shipKey] > 0) {
      return;
    }
    const ship = this.team.ships[shipKey];
    if (!ship || !ship.alive || ship.isAttached()) {
      this.lastSubSkillDecision[shipKey] = {
        action: "unavailable",
        cast: false,
        at: this.team.match.elapsed,
        target: null,
      };
      this.subTimers[shipKey] = randomInRange(4, 7);
      return;
    }

    const estimate = context?.focus || this.primaryEnemyEstimate();
    if (!this.shouldCastSubSkill(ship, estimate, context)) {
      this.lastSubSkillDecision[shipKey] = {
        action: "hold",
        cast: false,
        at: this.team.match.elapsed,
        target: this.debugContact(estimate),
      };
      this.subTimers[shipKey] = context?.conserveEnergy
        ? randomInRange(2, 3.6)
        : context?.skillAggression > 1
          ? randomInRange(0.45, 1.1)
          : randomInRange(0.9, 1.8);
      return;
    }
    let ok = false;
    if (ship.characterId === "future1096" && estimate && estimate.source !== "spawn" && (estimate.visible || estimate.age <= 1.6)) {
      // 1096 光线蓄力期间方向已经锁定；按公开的航向和航速预判 1.05 秒后的落点，
      // 避免高难度 AI 仍把固定射线瞄在移动目标的旧位置。
      const aim = predictCharacterSkillAim(
        estimate,
        this.legacy ? 0 : 1.05,
        this.team.match.worldSize,
        this.safeRoutePadding(4),
      );
      ok = this.team.castSubSkill(shipKey, {
        targetX: aim?.x ?? estimate.x,
        targetY: aim?.y ?? estimate.y,
      });
    } else if (ship.characterId === "tsuruya") {
      const zoneId = estimate?.zoneId || this.enemyIntel.searchZoneId || 5;
      ok = this.team.castSubSkill(shipKey, { zoneId });
    } else {
      ok = this.team.castSubSkill(shipKey);
    }
    this.lastSubSkillDecision[shipKey] = {
      action: ok ? "cast" : "retry",
      cast: ok,
      at: this.team.match.elapsed,
      target: this.debugContact(estimate),
    };
    if (
      ok
      && context?.barrierTactics?.enemy?.active
      && context.barrierTactics.breachShipKey === shipKey
    ) {
      // 破盾技能刚生效便立即重规划冲撞路线，不能等常规 1～2 秒改航周期。
      this.moveTimer = 0;
      this.koizumiOrbSteerTimer = 0;
    }
    this.subTimers[shipKey] = ok
      ? (context?.skillAggression > 1 ? randomInRange(12, 18) : randomInRange(15, 22))
      : context?.conserveEnergy
        ? randomInRange(4.6, 7.8)
        : context?.skillAggression > 1
          ? randomInRange(1.1, 2.2)
          : randomInRange(2.8, 5.4);
  }

  updateStuckState(dt) {
    const main = this.team.ships.main;
    if (!main.alive || !main.route) {
      this.stuckTimer = 0;
      this.lastMainPos = { x: main.x, y: main.y };
      return;
    }

    const moved = distance(main.x, main.y, this.lastMainPos.x, this.lastMainPos.y);
    const progressing = main.route.t > 0.08;
    const edgePressure = this.edgePressure(main);
    const pinnedOnEdge = edgePressure > 0.42 && main.speed < 6.5;
    if ((moved < 2.5 && main.speed < 3.5 && progressing) || pinnedOnEdge) {
      this.stuckTimer += dt * (1 + edgePressure * 1.8);
    } else {
      this.stuckTimer = Math.max(0, this.stuckTimer - dt * (0.9 + edgePressure));
    }

    this.lastMainPos = { x: main.x, y: main.y };
  }

  scoreMode(mode, context) {
    const rangeRatio = context.dist / Math.max(context.rangeRef, 1);
    const ownBarrier = context.barrierTactics?.own;
    const enemyBarrier = context.barrierTactics?.enemy;
    const barrierBreachWindow = Boolean(
      enemyBarrier
      && !enemyBarrier.active
      && enemyBarrier.disabledRemaining > 0,
    );
    const organizedBreach = Boolean(
      enemyBarrier?.active
      && context.barrierTactics?.breachShipKey,
    );
    if (mode === "recover") {
      return context.edgePressure * 5 + (context.mainHull < 0.22 ? 1.8 : 0);
    }
    if (mode === "harvest") {
      return context.energyRecoveryNeed * 3.2
        + (context.emergencyCommit ? -3.2 : 0.3)
        + (context.dist > context.rangeRef * 1.04 ? 0.24 : -0.42)
        + (context.intelSolid ? -0.55 : 0.08)
        - context.pressureDrive * 0.45
        - context.isolatedTargetScore * 0.24;
    }
    if (mode === "search") {
      return (context.searchRequired ? (context.focus.source === "spawn" ? 4.8 : 2.8) : -0.8)
        + (context.intelSolid ? -1.05 : 0.72)
        + (context.trackableIntel ? 0.4 : 0)
        + context.encirclePressure * 0.34
        - context.energyRecoveryNeed * 0.26;
    }
    if (mode === "regroup") {
      return (context.overextended ? 2.1 : 0)
        + (context.defensivePressure ? 1.2 : 0)
        + (ownBarrier && !ownBarrier.active ? 1.9 : 0)
        + (context.barrierTactics?.incoming ? 1.45 : 0)
        + (context.energyRatio < 0.16 ? 1.1 : 0)
        + (context.enemyBroadsideRisk ? 0.8 : 0)
        + context.energyRecoveryNeed * 0.52
        - context.counterCollapse * 0.4;
    }
    if (mode === "kite") {
      return (context.defensivePressure ? 2.1 : 0)
        + (ownBarrier && !ownBarrier.active ? 2.35 : 0)
        + (context.barrierTactics?.incoming ? 1.8 : 0)
        + (rangeRatio < 1.06 ? 0.95 : 0)
        + (context.localAdvantage < 0.78 ? 1.1 : 0)
        + (context.enemyArcDensity > 1 ? 0.9 : 0)
        + context.maxShipThreat * 0.18
        + context.energyRecoveryNeed * 0.24;
    }
    if (mode === "collapse") {
      return (context.killWindow ? 3.4 : 0)
        + (barrierBreachWindow ? 2.3 : 0)
        + (organizedBreach ? 0.9 : 0)
        - (enemyBarrier?.active && !organizedBreach ? 1.15 : 0)
        + (context.localAdvantage > 1 ? 1.9 : 0)
        + (context.closeoutWindow ? 1.6 : 0) // 收尾窗口：强力倾向冲杀残敌
        + (context.intelSolid ? 1 : -0.55)
        + (context.safeExchange ? 0.72 : 0)
        + context.isolatedTargetScore * 0.92
        + context.counterCollapse * 0.68
        + (context.pressureDrive > 0.85 ? 0.55 : 0)
        + context.energySurplus * 0.48
        - context.energyRecoveryNeed * (context.closeoutWindow ? 0.12 : 0.55); // 收尾时不为省能放弃击杀
    }
    if (mode === "broadside") {
      return (context.broadsideWindow ? 2.4 : -0.45)
        + (ownBarrier?.active ? 0.72 : 0)
        + (barrierBreachWindow ? 0.48 : 0)
        - (enemyBarrier?.active && !organizedBreach ? 0.55 : 0)
        + (context.localAdvantage > 0.9 ? 0.82 : 0)
        + (context.killWindow ? 0.55 : 0)
        + (context.arcAdvantage < 0.2 ? 1 : 0)
        + (context.enemyBroadsideRisk ? 0.9 : 0)
        + context.energySurplus * 0.24
        - context.energyRecoveryNeed * 0.42;
    }
    if (mode === "cutoff") {
      return (context.intelSolid ? 1.3 : -0.2)
        + (enemyBarrier?.active && context.barrierTactics?.infiltratorKey ? 0.9 : 0)
        + (organizedBreach ? 0.58 : 0)
        + (rangeRatio > 0.86 && rangeRatio < 1.95 ? 1 : 0)
        + (context.localAdvantage > 0.9 ? 0.58 : 0)
        + (context.enemyArcDensity > 1.2 ? 0.44 : 0)
        + (context.trackableIntel ? 0.96 : 0)
        + context.isolatedTargetScore * 0.34
        + context.energySurplus * 0.3
        - context.energyRecoveryNeed * 0.28;
    }
    if (mode === "press") {
      return 1.55
        + (barrierBreachWindow ? 1.85 : 0)
        + (organizedBreach ? 0.72 : 0)
        - (enemyBarrier?.active && !organizedBreach && !context.barrierTactics?.infiltratorKey ? 0.82 : 0)
        + (context.closeoutWindow ? 1.3 : 0) // 收尾窗口：维持压制把残敌打死
        + (rangeRatio > 1.08 ? 0.92 : 0)
        + (context.localAdvantage > 0.9 ? 0.72 : 0)
        - (context.defensivePressure && !context.winning ? 1.05 : 0) // 占优时防御压力不削弱压制
        - (context.enemyBroadsideRisk ? 0.78 : 0)
        + (context.arcAdvantage > 0.2 ? 0.36 : 0)
        + context.pressureDrive * 1.08
        + (context.trackableIntel ? 0.82 : 0)
        + context.counterCollapse * 0.34
        + context.energySurplus * 0.34
        - context.energyRecoveryNeed * (context.emergencyCommit || context.closeoutWindow ? 0.08 : 0.34);
    }
    return 0;
  }

  chooseMode(context) {
    const ownBarrier = context.barrierTactics?.own;
    const forcedMode = context.edgePressure > 0.34
      ? "recover"
      : ownBarrier && !ownBarrier.active && context.dist < context.rangeRef * 1.42 && !context.winning
        ? context.detachedCount > 0 ? "regroup" : "kite"
      : context.barrierTactics?.incoming && !context.killWindow
        ? "kite"
      : context.barrierTactics?.enemy
        && !context.barrierTactics.enemy.active
        && context.barrierTactics.enemy.disabledRemaining > 0
        && context.intelSolid
        && context.mainHull > 0.32
        ? "collapse"
      // 收尾窗口下不强制去充能(harvest)——该把残局打完，否则双方都去充能拖成平局
      : (context.energyRecoveryNeed >= 0.78 || context.energyRatio < 0.12) && !context.emergencyCommit && !context.closeoutWindow && !context.focus.visible && context.dist > context.rangeRef * 0.84
        ? "harvest"
      : context.searchRequired && context.focus.source === "spawn"
        ? "search"
        : null;
    if (forcedMode) {
      this.mode = forcedMode;
      this.modeTimer = randomInRange(1.2, forcedMode === "search" ? 2.8 : forcedMode === "harvest" ? 3.2 : 2.2);
      return this.mode;
    }

    // 低血转防守——但若正占优(领先/敌濒覆灭)则不退，继续压制把对手打死，避免领先方陪跑成平局
    if (context.mainHull < 0.26 && context.dist < context.rangeRef * 1.22 && !context.winning) {
      this.mode = context.detachedCount > 0 ? "regroup" : "kite";
      this.modeTimer = randomInRange(1.6, 2.8);
      return this.mode;
    }
    if ((context.focus.visible || context.maxShipThreat > 0.7) && context.energyRatio < 0.12 && context.dist < context.rangeRef * 0.96 && !context.winning) {
      this.mode = "regroup";
      this.modeTimer = randomInRange(1.8, 3);
      return this.mode;
    }

    if (this.modeTimer > 0) {
      return this.mode;
    }

    const modes = ["harvest", "regroup", "kite", "collapse", "broadside", "cutoff", "press"];
    let bestMode = "press";
    let bestScore = -Infinity;
    for (const mode of modes) {
      const score = this.scoreMode(mode, context);
      if (score > bestScore) {
        bestScore = score;
        bestMode = mode;
      }
    }
    this.mode = bestMode;
    this.modeTimer = randomInRange(
      bestMode === "collapse" || bestMode === "kite" || bestMode === "cutoff" ? 1.2 : 1.8,
      bestMode === "regroup" || bestMode === "harvest" ? 3.2 : 2.8,
    );
    return this.mode;
  }

  computeSearchTarget(main, enemyEstimate, searchCenter) {
    // 直奔 belief 占据图给出的最高概率区(searchCenter 已含"预测扩散+排除看过的")，
    // 仅叠加小幅横扫提升覆盖。不再按"敌朝向"额外外推——belief 已含预测，再外推会把搜索带偏
    // (静止/朝我之敌会被推过头而错过)，这正是原搜索找不到龟缩敌人的根因。
    const visible = enemyEstimate && enemyEstimate.visible;
    if (visible) {
      // 看得见时(罕见进此分支)：贴近其估计位置
      const t = Math.atan2(enemyEstimate.y - main.y, enemyEstimate.x - main.x);
      const sweep = this.searchSweepSign * 90;
      return {
        x: enemyEstimate.x + Math.cos(t + Math.PI * 0.5) * sweep,
        y: enemyEstimate.y + Math.sin(t + Math.PI * 0.5) * sweep,
      };
    }
    const unc = enemyEstimate ? (enemyEstimate.uncertainty || 0) : 90;
    const spread = clamp(64 + unc * 0.4, 64, 190);
    const toward = Math.atan2(searchCenter.y - main.y, searchCenter.x - main.x);
    const perp = toward + Math.PI * 0.5;
    const sweepOffset = this.searchSweepSign * spread * 0.34;
    return {
      x: searchCenter.x + Math.cos(perp) * sweepOffset + randomInRange(-spread * 0.14, spread * 0.14),
      y: searchCenter.y + Math.sin(perp) * sweepOffset + randomInRange(-spread * 0.14, spread * 0.14),
    };
  }

  computeSearchAssignments(main, focus, searchCenter) {
    const basisAngle = Number.isFinite(focus?.angle)
      ? focus.angle
      : Math.atan2(searchCenter.y - main.y, searchCenter.x - main.x);
    const sideAngle = basisAngle + Math.PI * 0.5;
    const zoneSpan = this.team.match.worldSize / 3;
    const spawnFactor = focus?.source === "spawn" ? 1.48 : 1;
    const wingReach = clamp((zoneSpan * 0.54 + (focus?.uncertainty || 0) * 0.32) * spawnFactor, 160, 430);
    const forwardReach = clamp((zoneSpan * 0.36 + (focus?.uncertainty || 0) * 0.22) * (focus?.source === "spawn" ? 1.16 : 1), 120, 300);
    const feintBias = this.searchSweepSign * clamp(zoneSpan * (focus?.source === "spawn" ? 0.22 : 0.14), 54, 150);

    return {
      main: {
        x: searchCenter.x + Math.cos(sideAngle) * feintBias,
        y: searchCenter.y + Math.sin(sideAngle) * feintBias,
      },
      sub1: {
        x: searchCenter.x - Math.cos(sideAngle) * wingReach + Math.cos(basisAngle) * forwardReach,
        y: searchCenter.y - Math.sin(sideAngle) * wingReach + Math.sin(basisAngle) * forwardReach,
      },
      sub2: {
        x: searchCenter.x + Math.cos(sideAngle) * wingReach + Math.cos(basisAngle) * forwardReach,
        y: searchCenter.y + Math.sin(sideAngle) * wingReach + Math.sin(basisAngle) * forwardReach,
      },
    };
  }

  computeSectorEncirclement(main, focus, searchCenter, pressure = 1) {
    const target = focus || searchCenter;
    const basisAngle = Number.isFinite(focus?.angle)
      ? focus.angle
      : Math.atan2(searchCenter.y - main.y, searchCenter.x - main.x);
    const sideAngle = basisAngle + Math.PI * 0.5;
    const uncertainty = focus?.uncertainty || 0;
    const forwardReach = clamp(main.effectiveRange() * (0.7 + pressure * 0.18) + uncertainty * 0.42, 190, 430);
    const wingReach = clamp(main.effectiveRange() * 0.56 + uncertainty * 0.42 + pressure * 56, 165, 390);
    const centerReach = clamp(forwardReach * 0.86, 150, 360);
    const mainBias = this.searchSweepSign * clamp(54 + uncertainty * 0.1, 54, 118);

    return {
      main: {
        x: target.x + Math.cos(basisAngle) * centerReach + Math.cos(sideAngle) * mainBias,
        y: target.y + Math.sin(basisAngle) * centerReach + Math.sin(sideAngle) * mainBias,
      },
      sub1: {
        x: target.x + Math.cos(basisAngle) * forwardReach - Math.cos(sideAngle) * wingReach,
        y: target.y + Math.sin(basisAngle) * forwardReach - Math.sin(sideAngle) * wingReach,
      },
      sub2: {
        x: target.x + Math.cos(basisAngle) * forwardReach + Math.cos(sideAngle) * wingReach,
        y: target.y + Math.sin(basisAngle) * forwardReach + Math.sin(sideAngle) * wingReach,
      },
    };
  }

  chooseDetachedIntelLead(detachedShips, enemyEstimate, context) {
    if (!enemyEstimate || !detachedShips.length) {
      return null;
    }
    let best = null;
    let bestScore = -Infinity;
    const enemyVision = this.estimateVisionRange(enemyEstimate);
    for (const ship of detachedShips) {
      const vitality = this.shipVitality(ship);
      if (vitality.fragile) {
        continue;
      }
      const visionMargin = ship.effectiveVision() - enemyVision;
      const score = vitality.value
        + clamp(visionMargin / 55, -0.2, 0.85)
        + clamp((ship.effectiveVision() - 160) / 70, 0, 0.65)
        + clamp((ship.baseSpeed() - 33) / 8, -0.1, 0.3)
        + (ship.characterId === "yuki" ? 0.9 : 0)
        + (ship.characterId === "asakura" ? 0.32 : 0)
        + (ship.characterId === "future1096" ? 0.18 : 0)
        + (context?.searchRequired || context?.trackableIntel ? 0.18 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = ship;
      }
    }
    return bestScore > 1 ? best : null;
  }

  detachedRetreatNeed(ship, enemyEstimate, context) {
    if (!ship || !ship.alive || !enemyEstimate || !context) {
      return 0;
    }
    const vitality = this.shipVitality(ship);
    const dist = distance(ship.x, ship.y, enemyEstimate.x, enemyEstimate.y);
    return clamp(
      (0.48 - vitality.hpRatio) * 2.4
      + (0.26 - vitality.energyRatio) * 1.8
      + (dist < ship.effectiveRange() * 0.92 ? 0.22 : 0)
      + (context.enemyBroadsideRisk ? 0.16 : 0)
      + (context.defensivePressure ? 0.14 : 0),
      0,
      1.8,
    );
  }

  planDetachedRoles(main, enemyEstimate, context) {
    const detachedShips = [this.team.ships.sub1, this.team.ships.sub2].filter((ship) => ship.alive && !ship.isAttached());
    const preferredSign = context?.flankSign || this.preferredFlankSign(main, enemyEstimate);
    const intelLead = this.chooseDetachedIntelLead(detachedShips, enemyEstimate, context);
    let retreatShip = null;
    let retreatScore = 0.72;
    for (const ship of detachedShips) {
      const score = this.detachedRetreatNeed(ship, enemyEstimate, context);
      if (score > retreatScore && (!intelLead || ship.id !== intelLead.id)) {
        retreatScore = score;
        retreatShip = ship;
      }
    }

    const plan = {
      intelLeadKey: intelLead?.key || null,
      retreatKey: retreatShip?.key || null,
      laneSigns: {},
      roles: {},
    };

    for (const ship of detachedShips) {
      if (context?.barrierTactics?.breachShipKey === ship.key) {
        plan.roles[ship.key] = "breach";
      } else if (context?.barrierTactics?.infiltratorKey === ship.key) {
        plan.roles[ship.key] = "infiltrate";
      } else if (intelLead && ship.id === intelLead.id) {
        plan.roles[ship.key] = "intel";
      } else if (retreatShip && ship.id === retreatShip.id) {
        plan.roles[ship.key] = "rear";
      } else if (["future1096", "asakura", "shamisen"].includes(ship.characterId)) {
        plan.roles[ship.key] = "flank";
      } else if (this.shipVitality(ship).healthy && ((context?.pressureDrive || 0) > 0.42 || (context?.isolatedTargetScore || 0) > 0.34)) {
        plan.roles[ship.key] = "front";
      } else {
        plan.roles[ship.key] = (context?.pressureDrive || 0) > 0.72 ? "flank" : "fire";
      }
    }

    let nextSign = preferredSign;
    for (const ship of detachedShips) {
      if (plan.roles[ship.key] === "rear") {
        plan.laneSigns[ship.key] = -preferredSign;
        continue;
      }
      plan.laneSigns[ship.key] = nextSign;
      nextSign *= -1;
    }
    return plan;
  }

  computeDetachedDirective(ship, role, enemyEstimate, context, main, mainTarget, laneSign = 1) {
    if (!ship || !ship.alive || !enemyEstimate) {
      return null;
    }
    const toEnemyX = enemyEstimate.x - main.x;
    const toEnemyY = enemyEstimate.y - main.y;
    const len = Math.max(1, Math.hypot(toEnemyX, toEnemyY));
    const toward = { x: toEnemyX / len, y: toEnemyY / len };
    const side = { x: -toward.y, y: toward.x };
    const enemyForward = { x: Math.cos(enemyEstimate.angle), y: Math.sin(enemyEstimate.angle) };
    const enemySide = { x: -enemyForward.y, y: enemyForward.x };
    const vitality = this.shipVitality(ship);
    const threat = this.shipThreatSnapshot(ship, 7);
    const ownVision = ship.effectiveVision();
    const enemyVision = this.estimateVisionRange(enemyEstimate);
    const blindLower = enemyVision + 16;
    const blindUpper = ownVision - 8;
    const mainAngle = Math.atan2(mainTarget.y - enemyEstimate.y, mainTarget.x - enemyEstimate.x);
    const preferredRange = clamp(ship.effectiveRange() * 0.9, 170, 380);
    const emergencyEscape = threat.overwhelmed || (threat.danger > 1.18 && role !== "intel");

    const barrierDirective = koizumiBarrierRoleDirective(
      ship,
      role,
      enemyEstimate,
      context?.barrierTactics?.enemy,
      laneSign,
    );
    if (barrierDirective) {
      return barrierDirective;
    }

    if (emergencyEscape) {
      const escape = this.escapeTargetForShip(ship, main.x, main.y, 7);
      if (escape) {
        return {
          target: {
            x: escape.x,
            y: escape.y,
            intentAngle: Math.atan2(enemyEstimate.y - escape.y, enemyEstimate.x - escape.x),
            preferredRange: clamp(ship.effectiveRange() * 1.08, 220, 420),
          },
          throttle: { min: 1.04, max: 1.2 },
          role: "escape",
        };
      }
    }

    const scoreCandidate = (candidate, exposureWeight) => {
      const exchange = this.evaluateArcExchange(ship, enemyEstimate, candidate, exposureWeight);
      const candidateDist = distance(candidate.x, candidate.y, enemyEstimate.x, enemyEstimate.y);
      const candidateAngle = Math.atan2(candidate.y - enemyEstimate.y, candidate.x - enemyEstimate.x);
      const spread = Math.abs(shortestAngleDelta(candidateAngle, mainAngle));
      let score = exchange.score;

      if (role === "intel") {
        if (blindUpper > blindLower) {
          if (candidateDist >= blindLower && candidateDist <= blindUpper) {
            score += 1.35;
          }
          if (candidateDist < enemyVision + 6) {
            score -= 1.55;
          }
          if (candidateDist > ownVision - 4) {
            score -= 1.1;
          }
        } else {
          score += clamp((ownVision - candidateDist) / 80, -0.5, 0.5);
        }
        score += clamp(spread / 1.7, 0, 0.5);
        score += clamp(distance(candidate.x, candidate.y, main.x, main.y) / 280, 0, 0.55);
      } else if (role === "rear") {
        score += candidateDist > distance(mainTarget.x, mainTarget.y, enemyEstimate.x, enemyEstimate.y) + 26 ? 0.72 : -0.65;
        score += exchange.enemyDensity <= 1 ? 0.34 : -0.42;
        score += vitality.hpRatio < 0.35 ? 0.24 : 0;
      } else if (role === "fire") {
        score += clamp(spread / 1.55, 0, 0.82);
        score += candidateDist >= ship.effectiveRange() * 0.72 && candidateDist <= ship.effectiveRange() * 1.02 ? 0.4 : -0.16;
      } else if (role === "flank") {
        const rearBias = -Math.cos(shortestAngleDelta(candidateAngle, enemyEstimate.angle));
        score += clamp(spread / 1.4, 0, 0.98);
        score += candidateDist <= ship.effectiveRange() * 0.9 ? 0.34 : 0;
        score += clamp(rearBias * 0.7, -0.18, 0.8);
      } else if (role === "front") {
        score += candidateDist < distance(mainTarget.x, mainTarget.y, enemyEstimate.x, enemyEstimate.y) - 16 ? 0.42 : -0.08;
        score += candidateDist <= ship.effectiveRange() * 0.94 ? 0.3 : -0.12;
      }
      return score;
    };

    const pickBest = (candidates, exposureWeight = 1.18) => {
      let best = null;
      let bestScore = -Infinity;
      for (const item of candidates) {
        const candidate = {
          ...item,
          x: this.team.match.clampX(item.x, this.safeRoutePadding(10)),
          y: this.team.match.clampY(item.y, this.safeRoutePadding(10)),
        };
        const score = scoreCandidate(candidate, exposureWeight);
        if (score > bestScore) {
          bestScore = score;
          best = candidate;
        }
      }
      return best || candidates[0];
    };

    let candidates = [];
    let throttle = { min: 0.76, max: 1.02 };
    if (role === "intel") {
      const fallbackMax = Math.max(150, Math.min(ownVision, preferredRange));
      const scoutRange = blindUpper > blindLower
        ? clamp(lerp(blindLower, blindUpper, 0.52), blindLower, blindUpper)
        : Math.min(Math.max(enemyVision + 22, 150), fallbackMax);
      const sideOffset = clamp(140 + Math.max(0, ownVision - enemyVision) * 1.1, 140, 260);
      candidates = [
        {
          x: enemyEstimate.x - enemyForward.x * scoutRange + enemySide.x * laneSign * sideOffset,
          y: enemyEstimate.y - enemyForward.y * scoutRange + enemySide.y * laneSign * sideOffset,
          intentAngle: Math.atan2(enemyEstimate.y - (enemyEstimate.y - enemyForward.y * scoutRange + enemySide.y * laneSign * sideOffset), enemyEstimate.x - (enemyEstimate.x - enemyForward.x * scoutRange + enemySide.x * laneSign * sideOffset)),
          preferredRange: scoutRange,
        },
        {
          x: enemyEstimate.x - toward.x * scoutRange + side.x * laneSign * (sideOffset * 1.08),
          y: enemyEstimate.y - toward.y * scoutRange + side.y * laneSign * (sideOffset * 1.08),
          intentAngle: Math.atan2(enemyEstimate.y - (enemyEstimate.y - toward.y * scoutRange + side.y * laneSign * (sideOffset * 1.08)), enemyEstimate.x - (enemyEstimate.x - toward.x * scoutRange + side.x * laneSign * (sideOffset * 1.08))),
          preferredRange: scoutRange,
        },
        {
          x: enemyEstimate.x - enemyForward.x * (scoutRange * 0.88) - enemySide.x * laneSign * (sideOffset * 0.54),
          y: enemyEstimate.y - enemyForward.y * (scoutRange * 0.88) - enemySide.y * laneSign * (sideOffset * 0.54),
          intentAngle: Math.atan2(enemyEstimate.y - (enemyEstimate.y - enemyForward.y * (scoutRange * 0.88) - enemySide.y * laneSign * (sideOffset * 0.54)), enemyEstimate.x - (enemyEstimate.x - enemyForward.x * (scoutRange * 0.88) - enemySide.x * laneSign * (sideOffset * 0.54))),
          preferredRange: scoutRange * 0.94,
        },
      ];
      throttle = {
        min: context?.searchRequired || context?.trackableIntel ? 0.94 : 0.84,
        max: context?.searchRequired || context?.trackableIntel ? 1.12 : 1.02,
      };
    } else if (role === "rear") {
      const safeRange = clamp(ship.effectiveRange() * 1.04 + (0.6 - vitality.hpRatio) * 110, 220, 460);
      candidates = [
        {
          x: enemyEstimate.x - toward.x * safeRange + side.x * laneSign * 170,
          y: enemyEstimate.y - toward.y * safeRange + side.y * laneSign * 170,
          intentAngle: Math.atan2(enemyEstimate.y - (enemyEstimate.y - toward.y * safeRange + side.y * laneSign * 170), enemyEstimate.x - (enemyEstimate.x - toward.x * safeRange + side.x * laneSign * 170)),
          preferredRange: safeRange,
        },
        {
          x: mainTarget.x - toward.x * 70 + side.x * laneSign * 155,
          y: mainTarget.y - toward.y * 70 + side.y * laneSign * 155,
          intentAngle: Math.atan2(enemyEstimate.y - (mainTarget.y - toward.y * 70 + side.y * laneSign * 155), enemyEstimate.x - (mainTarget.x - toward.x * 70 + side.x * laneSign * 155)),
          preferredRange: safeRange * 0.92,
        },
      ];
      throttle = { min: 0.58, max: 0.84 };
    } else if (role === "flank") {
      const strikeRange = clamp(ship.effectiveRange() * 0.72, 130, 280);
      candidates = [
        {
          x: enemyEstimate.x - enemyForward.x * 48 + enemySide.x * laneSign * 220,
          y: enemyEstimate.y - enemyForward.y * 48 + enemySide.y * laneSign * 220,
          intentAngle: this.broadsideIntentAngle(
            enemyEstimate.x - enemyForward.x * 48 + enemySide.x * laneSign * 220,
            enemyEstimate.y - enemyForward.y * 48 + enemySide.y * laneSign * 220,
            enemyEstimate.x,
            enemyEstimate.y,
            laneSign,
          ),
          preferredRange: strikeRange,
        },
        {
          x: enemyEstimate.x + enemyForward.x * 46 + enemySide.x * laneSign * 165,
          y: enemyEstimate.y + enemyForward.y * 46 + enemySide.y * laneSign * 165,
          intentAngle: this.broadsideIntentAngle(
            enemyEstimate.x + enemyForward.x * 46 + enemySide.x * laneSign * 165,
            enemyEstimate.y + enemyForward.y * 46 + enemySide.y * laneSign * 165,
            enemyEstimate.x,
            enemyEstimate.y,
            laneSign,
          ),
          preferredRange: strikeRange * 0.88,
        },
        {
          x: enemyEstimate.x - enemyForward.x * 210 + enemySide.x * laneSign * 150,
          y: enemyEstimate.y - enemyForward.y * 210 + enemySide.y * laneSign * 150,
          intentAngle: this.broadsideIntentAngle(
            enemyEstimate.x - enemyForward.x * 210 + enemySide.x * laneSign * 150,
            enemyEstimate.y - enemyForward.y * 210 + enemySide.y * laneSign * 150,
            enemyEstimate.x,
            enemyEstimate.y,
            laneSign,
          ),
          preferredRange: strikeRange * 1.04,
        },
        {
          x: enemyEstimate.x - enemyForward.x * 240 - enemySide.x * laneSign * 46,
          y: enemyEstimate.y - enemyForward.y * 240 - enemySide.y * laneSign * 46,
          intentAngle: Math.atan2(
            enemyEstimate.y - (enemyEstimate.y - enemyForward.y * 240 - enemySide.y * laneSign * 46),
            enemyEstimate.x - (enemyEstimate.x - enemyForward.x * 240 - enemySide.x * laneSign * 46),
          ),
          preferredRange: strikeRange * 1.06,
        },
        {
          x: enemyEstimate.x - toward.x * strikeRange + side.x * laneSign * 210,
          y: enemyEstimate.y - toward.y * strikeRange + side.y * laneSign * 210,
          intentAngle: Math.atan2(enemyEstimate.y - (enemyEstimate.y - toward.y * strikeRange + side.y * laneSign * 210), enemyEstimate.x - (enemyEstimate.x - toward.x * strikeRange + side.x * laneSign * 210)),
          preferredRange: strikeRange,
        },
      ];
      throttle = { min: 0.98, max: 1.18 };
    } else if (role === "front") {
      const screenRange = clamp(Math.max(enemyVision + 12, ship.effectiveRange() * 0.78), 150, 320);
      candidates = [
        {
          x: enemyEstimate.x - toward.x * screenRange + side.x * laneSign * 120,
          y: enemyEstimate.y - toward.y * screenRange + side.y * laneSign * 120,
          intentAngle: Math.atan2(enemyEstimate.y - (enemyEstimate.y - toward.y * screenRange + side.y * laneSign * 120), enemyEstimate.x - (enemyEstimate.x - toward.x * screenRange + side.x * laneSign * 120)),
          preferredRange: screenRange,
        },
        {
          x: enemyEstimate.x - enemyForward.x * (screenRange * 0.84) + enemySide.x * laneSign * 175,
          y: enemyEstimate.y - enemyForward.y * (screenRange * 0.84) + enemySide.y * laneSign * 175,
          intentAngle: this.broadsideIntentAngle(
            enemyEstimate.x - enemyForward.x * (screenRange * 0.84) + enemySide.x * laneSign * 175,
            enemyEstimate.y - enemyForward.y * (screenRange * 0.84) + enemySide.y * laneSign * 175,
            enemyEstimate.x,
            enemyEstimate.y,
            laneSign,
          ),
          preferredRange: screenRange,
        },
      ];
      throttle = { min: 0.96, max: 1.14 };
    } else {
      const supportRange = clamp(ship.effectiveRange() * 0.94, 180, 360);
      candidates = [
        {
          x: enemyEstimate.x - enemyForward.x * 72 + enemySide.x * laneSign * 210,
          y: enemyEstimate.y - enemyForward.y * 72 + enemySide.y * laneSign * 210,
          intentAngle: this.broadsideIntentAngle(
            enemyEstimate.x - enemyForward.x * 72 + enemySide.x * laneSign * 210,
            enemyEstimate.y - enemyForward.y * 72 + enemySide.y * laneSign * 210,
            enemyEstimate.x,
            enemyEstimate.y,
            laneSign,
          ),
          preferredRange: supportRange,
        },
        {
          x: enemyEstimate.x - toward.x * supportRange + side.x * laneSign * 155,
          y: enemyEstimate.y - toward.y * supportRange + side.y * laneSign * 155,
          intentAngle: Math.atan2(enemyEstimate.y - (enemyEstimate.y - toward.y * supportRange + side.y * laneSign * 155), enemyEstimate.x - (enemyEstimate.x - toward.x * supportRange + side.x * laneSign * 155)),
          preferredRange: supportRange,
        },
        {
          x: mainTarget.x + side.x * laneSign * 92 - toward.x * 36,
          y: mainTarget.y + side.y * laneSign * 92 - toward.y * 36,
          intentAngle: Math.atan2(enemyEstimate.y - (mainTarget.y + side.y * laneSign * 92 - toward.y * 36), enemyEstimate.x - (mainTarget.x + side.x * laneSign * 92 - toward.x * 36)),
          preferredRange: supportRange * 0.94,
        },
      ];
      throttle = { min: 0.84, max: 1.08 };
    }

    return {
      target: pickBest(candidates, role === "rear" ? 1.4 : role === "intel" ? 1.26 : 1.12),
      throttle,
      role,
    };
  }

  usesAdvancedSkillCounterplay() {
    return !this.legacy && (this.difficulty === "hard" || this.difficulty === "master");
  }

  incomingVisionWaveWillPurge(ships, buffDuration) {
    if (!this.usesAdvancedSkillCounterplay()) {
      return false;
    }
    const targets = ships.filter((ship) => ship?.alive);
    const state = this.enemy.visionWaveSkill;
    const horizon = Math.max(0.2, Number(buffDuration) || 0);
    if (targets.length === 0 || !state) {
      return false;
    }

    const now = this.team.match.elapsed;
    const waves = state.waves.filter((wave) => wave.expiresAt > now);
    const willReachWithin = (wave, ship, delay = 0) => {
      const speed = Math.max(1, Number(wave.speed) || 480);
      const width = Math.max(0, Number(wave.width) || 0);
      const currentRadius = Math.max(0, (now - wave.emittedAt) * speed);
      const targetRadius = distance(wave.x, wave.y, ship.x, ship.y);
      const contactRadius = width * 0.5 + Math.max(0, Number(ship.radius) || 0);
      // 波前已经完全越过该舰时不会回头；否则按公开可见的波心、速度和宽度估算到达时间。
      if (currentRadius - contactRadius > targetRadius) {
        return false;
      }
      const arrival = delay + Math.max(0, targetRadius - contactRadius - currentRadius) / speed;
      return arrival <= horizon;
    };

    for (const wave of waves) {
      if (targets.some((ship) => willReachWithin(wave, ship))) {
        return true;
      }
    }

    // 技能仍会继续发波时，以最新一圈公开波纹的波心预测下一圈。不会读取隐藏朝仓的
    // 实时坐标；若朝仓正在移动，这只是困难以上 AI 对已见轨迹的合理外推。
    const hasFuturePulse = state.pulsesRemaining > 0
      && state.nextPulseAt < state.activeUntil - 1e-9;
    const latestWave = waves.at(-1);
    if (!hasFuturePulse || !latestWave) {
      return false;
    }
    const nextPulseDelay = Math.max(0, state.nextPulseAt - now);
    const projectedWave = {
      ...latestWave,
      emittedAt: now,
    };
    return targets.some((ship) => willReachWithin(projectedWave, ship, nextPulseDelay));
  }

  shouldDelayFlagshipBuff(characterId, meta) {
    if (!["haruhi", "tsuruya", "asakura"].includes(characterId)) {
      return false;
    }
    const targets = this.team.getAllShips();
    return this.incomingVisionWaveWillPurge(targets, meta?.duration || 6);
  }

  shouldDelaySubBuff(ship, meta) {
    if (!ship || !["haruhi", "koizumi", "kyon", "asakura", "shamisen"].includes(ship.characterId)) {
      return false;
    }
    const usefulDuration = meta?.duration || 6;
    return this.incomingVisionWaveWillPurge([ship], usefulDuration);
  }

  shouldCastFlagshipSkill(estimate, context = this.currentContext) {
    const main = this.team.ships.main;
    const characterId = this.team.mainCharacterId();
    if (!estimate || !main.alive) {
      return false;
    }
    const meta = skillMetaForCharacter(characterId, "flagship");
    if (!meta || meta.type !== "active") {
      return false; // 被动旗舰(阿虚/有希):没有可主动释放的技能,别空试
    }
    if (this.shouldDelayFlagshipBuff(characterId, meta)) {
      return false;
    }
    const energyFloors = characterId === "haruhi"
      ? { emergencyFloor: 0.03, normalFloor: 0.05, conserveFloor: 0.08 }
      : { emergencyFloor: 0.1, normalFloor: 0.16, conserveFloor: 0.26 };
    if (meta?.cost && !this.allowEnergyCommit("main", meta.cost, context, energyFloors)) {
      return false;
    }
    const dist = distance(main.x, main.y, estimate.x, estimate.y);
    if (characterId === "haruhi") {
      // 常驻支援集齐后，16秒团队强化本身仍值得尽快使用；不再等待接敌或距离条件。
      return true;
    }
    if (characterId === "future1096") {
      const form = this.team.future1096Form;
      const hull = this.team.hullRatio();
      const pressure = Number(context?.defensivePressure) || 0;
      const aggression = Number(context?.skillAggression) || 0;
      if (!form) {
        return Boolean(
          estimate.source !== "spawn"
          && (estimate.visible || estimate.age <= 3)
          && hull > 0.58
          && (aggression > 0.18 || context?.trackableIntel),
        );
      }
      if (form === "A") {
        return hull < 0.62 || pressure > 0.58 || this.mode === "recover";
      }
      return hull > 0.48 && pressure < 0.42 && aggression > 0.46;
    }
    if (characterId === "tsuruya") {
      return this.team.hullRatio() < 0.995 || (context?.skillAggression || 0) > 0.18 || (context?.combatUrgency || 0) > 0.34;
    }
    if (characterId === "asakura") {
      const now = this.team.match.elapsed;
      const visibleShips = this.enemy.getAllShips().filter(
        (ship) => ship.alive && this.team.visibleEnemyIds.has(ship.id),
      );
      let visibleBuffRemaining = 0;
      if (visibleShips.length > 0) {
        visibleBuffRemaining = Math.max(
          0,
          this.enemy.effects.sponsorUntil - now,
          this.enemy.effects.haruhiBoostUntil - now,
          this.enemy.visionWaveSkill.activeUntil - now,
        );
        for (const ship of visibleShips) {
          visibleBuffRemaining = Math.max(
            visibleBuffRemaining,
            Number(ship.effects.critUntil || 0) - now,
            Number(ship.effects.reliableUntil || 0) - now,
            Number(ship.effects.bladeQueenUntil || 0) - now,
            ship.effects.nextShotDamageMultiplier > 1 ? 6 : 0,
          );
        }
      }

      const waveArrivalSeconds = dist / 480;
      const canPurgeBeforeExpiry = visibleBuffRemaining > waveArrivalSeconds + 0.2;
      const hasHiddenEnemyShip = this.enemy.getAllShips().some(
        (enemy) => enemy.alive && !this.team.visibleEnemyIds.has(enemy.id),
      );
      const usefulSearchPulse = hasHiddenEnemyShip && Boolean(
        estimate.source === "radar"
        || (!estimate.visible && estimate.source !== "spawn" && estimate.age <= 7)
        || context?.trackableIntel
        || (this.mode === "search" && (context?.searchRequired || context?.intelUrgency > 0.82)),
      );
      return canPurgeBeforeExpiry || usefulSearchPulse;
    }
    return true;
  }

  shouldCastSubSkill(ship, estimate, context = this.currentContext) {
    if (!ship || !ship.alive) {
      return false;
    }
    const meta = skillMetaForCharacter(ship.characterId, "sub");
    if (this.shouldDelaySubBuff(ship, meta)) {
      return false;
    }
    if (meta?.cost && !this.allowEnergyCommit(ship, meta.cost, context, { emergencyFloor: 0.08, normalFloor: 0.14, conserveFloor: 0.24 })) {
      return false;
    }
    const dist = estimate ? distance(ship.x, ship.y, estimate.x, estimate.y) : Infinity;
    const enemyBarrier = context?.barrierTactics?.enemy;
    const assignedToBreach = Boolean(
      enemyBarrier?.active
      && context?.barrierTactics?.breachShipKey === ship.key,
    );
    const breachDistance = enemyBarrier
      ? distance(ship.x, ship.y, enemyBarrier.x, enemyBarrier.y)
      : dist;
    const blockedByBarrier = barrierBlocksRangedAttack(enemyBarrier, ship, 4);
    if (ship.characterId === "haruhi") {
      if (blockedByBarrier) {
        return false;
      }
      return Boolean(
        estimate
        && (estimate.visible || estimate.age <= 2.5)
        && dist <= ship.effectiveRange() * 1.35
        && (((context?.skillAggression) || 0) > 0.16 || this.energyProfile(ship).high),
      );
    }
    if (ship.characterId === "koizumi") {
      if (assignedToBreach) {
        return Boolean(
          estimate
          && !ship.isKoizumiOrbActive()
          && estimate.source !== "spawn"
          && (estimate.visible || estimate.age <= 4.2)
          && breachDistance <= ship.effectiveRange() * 1.75,
        );
      }
      return Boolean(
        estimate
        && !ship.isKoizumiOrbActive()
        && estimate.source !== "spawn"
        && (estimate.visible || estimate.age <= 3.2 || context?.trackableIntel)
        && dist <= ship.effectiveRange() * 1.55
        && (((context?.skillAggression) || 0) > 0.14 || this.energyProfile(ship).high),
      );
    }
    if (ship.characterId === "future1096") {
      if (blockedByBarrier) {
        return false;
      }
      return Boolean(
        estimate
        && estimate.source !== "spawn"
        && (estimate.visible || estimate.age <= 1.6)
        && (((context?.skillAggression) || 0) > 0.18 || context?.emergencyCommit),
      );
    }
    if (ship.characterId === "kyon") {
      return ship.hp / Math.max(1, ship.maxHp) < 0.84 || Boolean(estimate && dist <= ship.effectiveRange() * 1.18);
    }
    if (ship.characterId === "tsuruya") {
      return Boolean(
        estimate
        && (estimate.visible || estimate.age <= 7)
        && (((context?.skillAggression) || 0) > 0.08 || (context?.trackableIntel)),
      );
    }
    if (ship.characterId === "yuki") {
      return (((context?.scoutPriority) || 0) > 0.28 || this.energyProfile(ship).high)
        && (!estimate || !estimate.visible || estimate.age > 2.5 || this.team.scouts.length < 3);
    }
    if (ship.characterId === "asakura") {
      if (assignedToBreach) {
        return Boolean(
          estimate
          && (estimate.visible || estimate.age <= 4.2)
          && breachDistance <= ship.effectiveRange() * 1.5,
        );
      }
      return Boolean(
        estimate
        && (estimate.visible || estimate.age <= 2.4)
        && dist <= ship.effectiveRange() * 0.95
        && (((context?.skillAggression) || 0) > 0.14 || context?.killWindow || context?.combatUrgency > 0.5),
      );
    }
    if (ship.characterId === "shamisen") {
      if (blockedByBarrier) {
        return false;
      }
      return Boolean(
        estimate
        && (estimate.visible || estimate.age <= 2.2)
        && dist <= ship.effectiveRange() * 1.12
        && (((context?.skillAggression) || 0) > 0.12 || context?.killWindow || this.energyProfile(ship).high),
      );
    }
    return true;
  }

  computeMainTarget(mode, main, enemyEstimate, center) {
    const toEnemyX = enemyEstimate.x - main.x;
    const toEnemyY = enemyEstimate.y - main.y;
    const len = Math.max(1, Math.hypot(toEnemyX, toEnemyY));
    const toward = { x: toEnemyX / len, y: toEnemyY / len };
    const side = { x: -toward.y, y: toward.x };
    const enemyForward = { x: Math.cos(enemyEstimate.angle), y: Math.sin(enemyEstimate.angle) };
    const enemySide = { x: -enemyForward.y, y: enemyForward.x };
    const broadsideSign = this.preferredFlankSign(main, enemyEstimate);
    const preferredRange = clamp(main.effectiveRange() * 0.88, 180, 340);

    const pickBest = (candidates, exposureWeight = 1) => {
      let best = null;
      let bestScore = -Infinity;
      for (const item of candidates) {
        const candidate = {
          ...item,
          x: this.team.match.clampX(item.x, this.safeRoutePadding()),
          y: this.team.match.clampY(item.y, this.safeRoutePadding()),
        };
        const exchange = this.evaluateArcExchange(main, enemyEstimate, candidate, exposureWeight);
        if (exchange.score > bestScore) {
          bestScore = exchange.score;
          best = candidate;
        }
      }
      return best || candidates[0];
    };

    if (mode === "recover") {
      return this.computeRecoveryTarget(main, enemyEstimate);
    }
    if (mode === "harvest") {
      const conserveRange = clamp(main.effectiveRange() * 1.22, 240, 420);
      return pickBest([
        {
          x: enemyEstimate.x - toward.x * conserveRange + side.x * 130,
          y: enemyEstimate.y - toward.y * conserveRange + side.y * 130,
          intentAngle: Math.atan2(enemyEstimate.y - (enemyEstimate.y - toward.y * conserveRange + side.y * 130), enemyEstimate.x - (enemyEstimate.x - toward.x * conserveRange + side.x * 130)),
          preferredRange: conserveRange,
        },
        {
          x: enemyEstimate.x - toward.x * (conserveRange + 45) - side.x * 130,
          y: enemyEstimate.y - toward.y * (conserveRange + 45) - side.y * 130,
          intentAngle: Math.atan2(enemyEstimate.y - (enemyEstimate.y - toward.y * (conserveRange + 45) - side.y * 130), enemyEstimate.x - (enemyEstimate.x - toward.x * (conserveRange + 45) - side.x * 130)),
          preferredRange: conserveRange * 1.05,
        },
      ], 1.42);
    }
    if (mode === "regroup") {
      return pickBest([
        {
          x: lerp(center.x, main.x, 0.74) - toward.x * 140 + side.x * 110,
          y: lerp(center.y, main.y, 0.74) - toward.y * 140 + side.y * 110,
          intentAngle: Math.atan2(enemyEstimate.y - main.y, enemyEstimate.x - main.x),
          preferredRange: preferredRange * 1.08,
        },
        {
          x: lerp(center.x, main.x, 0.74) - toward.x * 140 - side.x * 110,
          y: lerp(center.y, main.y, 0.74) - toward.y * 140 - side.y * 110,
          intentAngle: Math.atan2(enemyEstimate.y - main.y, enemyEstimate.x - main.x),
          preferredRange: preferredRange * 1.08,
        },
      ], 1.35);
    }
    if (mode === "kite") {
      const retreatRange = clamp(main.effectiveRange() * 1.16, 220, 420);
      return pickBest([
        {
          x: enemyEstimate.x - toward.x * retreatRange + side.x * 140,
          y: enemyEstimate.y - toward.y * retreatRange + side.y * 140,
          intentAngle: Math.atan2(enemyEstimate.y - (enemyEstimate.y - toward.y * retreatRange + side.y * 140), enemyEstimate.x - (enemyEstimate.x - toward.x * retreatRange + side.x * 140)),
          preferredRange: retreatRange,
        },
        {
          x: enemyEstimate.x - toward.x * retreatRange - side.x * 140,
          y: enemyEstimate.y - toward.y * retreatRange - side.y * 140,
          intentAngle: Math.atan2(enemyEstimate.y - (enemyEstimate.y - toward.y * retreatRange - side.y * 140), enemyEstimate.x - (enemyEstimate.x - toward.x * retreatRange - side.x * 140)),
          preferredRange: retreatRange,
        },
      ], 1.5);
    }
    if (mode === "collapse") {
      return pickBest([
        {
          x: enemyEstimate.x - enemyForward.x * 54 + enemySide.x * broadsideSign * 150,
          y: enemyEstimate.y - enemyForward.y * 54 + enemySide.y * broadsideSign * 150,
          intentAngle: this.broadsideIntentAngle(
            enemyEstimate.x - enemyForward.x * 54 + enemySide.x * broadsideSign * 150,
            enemyEstimate.y - enemyForward.y * 54 + enemySide.y * broadsideSign * 150,
            enemyEstimate.x,
            enemyEstimate.y,
            broadsideSign,
          ),
          preferredRange: clamp(preferredRange * 0.72, 100, 230),
        },
        {
          x: enemyEstimate.x - toward.x * 62,
          y: enemyEstimate.y - toward.y * 62,
          intentAngle: Math.atan2(enemyEstimate.y - (enemyEstimate.y - toward.y * 62), enemyEstimate.x - (enemyEstimate.x - toward.x * 62)),
          preferredRange: clamp(preferredRange * 0.62, 80, 180),
        },
      ], 1.05);
    }
    if (mode === "broadside") {
      const sideOffset = clamp(main.effectiveRange() * 0.82, 180, 320);
      const rearOffset = clamp(main.effectiveRange() * 0.24, 50, 130);
      return pickBest([
        {
          x: enemyEstimate.x - enemyForward.x * rearOffset + enemySide.x * broadsideSign * sideOffset,
          y: enemyEstimate.y - enemyForward.y * rearOffset + enemySide.y * broadsideSign * sideOffset,
          intentAngle: this.broadsideIntentAngle(
            enemyEstimate.x - enemyForward.x * rearOffset + enemySide.x * broadsideSign * sideOffset,
            enemyEstimate.y - enemyForward.y * rearOffset + enemySide.y * broadsideSign * sideOffset,
            enemyEstimate.x,
            enemyEstimate.y,
            broadsideSign,
          ),
          preferredRange,
        },
        {
          x: enemyEstimate.x - enemyForward.x * (rearOffset + 54) + enemySide.x * broadsideSign * (sideOffset * 0.9),
          y: enemyEstimate.y - enemyForward.y * (rearOffset + 54) + enemySide.y * broadsideSign * (sideOffset * 0.9),
          intentAngle: this.broadsideIntentAngle(
            enemyEstimate.x - enemyForward.x * (rearOffset + 54) + enemySide.x * broadsideSign * (sideOffset * 0.9),
            enemyEstimate.y - enemyForward.y * (rearOffset + 54) + enemySide.y * broadsideSign * (sideOffset * 0.9),
            enemyEstimate.x,
            enemyEstimate.y,
            broadsideSign,
          ),
          preferredRange: preferredRange * 0.96,
        },
      ], 1.25);
    }
    if (mode === "cutoff") {
      return pickBest([
        {
          x: enemyEstimate.x + enemyForward.x * 250 + enemySide.x * broadsideSign * 110,
          y: enemyEstimate.y + enemyForward.y * 250 + enemySide.y * broadsideSign * 110,
          intentAngle: this.broadsideIntentAngle(
            enemyEstimate.x + enemyForward.x * 250 + enemySide.x * broadsideSign * 110,
            enemyEstimate.y + enemyForward.y * 250 + enemySide.y * broadsideSign * 110,
            enemyEstimate.x,
            enemyEstimate.y,
            broadsideSign,
          ),
          preferredRange: preferredRange * 1.02,
        },
        {
          x: enemyEstimate.x + enemyForward.x * 220 - enemySide.x * broadsideSign * 90,
          y: enemyEstimate.y + enemyForward.y * 220 - enemySide.y * broadsideSign * 90,
          intentAngle: Math.atan2(enemyEstimate.y - (enemyEstimate.y + enemyForward.y * 220 - enemySide.y * broadsideSign * 90), enemyEstimate.x - (enemyEstimate.x + enemyForward.x * 220 - enemySide.x * broadsideSign * 90)),
          preferredRange: preferredRange * 1.1,
        },
      ], 1.18);
    }
    return pickBest([
      {
        x: enemyEstimate.x - enemyForward.x * 96 + enemySide.x * broadsideSign * 90,
        y: enemyEstimate.y - enemyForward.y * 96 + enemySide.y * broadsideSign * 90,
        intentAngle: this.broadsideIntentAngle(
          enemyEstimate.x - enemyForward.x * 96 + enemySide.x * broadsideSign * 90,
          enemyEstimate.y - enemyForward.y * 96 + enemySide.y * broadsideSign * 90,
          enemyEstimate.x,
          enemyEstimate.y,
          broadsideSign,
        ),
        preferredRange: preferredRange * 0.94,
      },
      {
        x: enemyEstimate.x - toward.x * 122,
        y: enemyEstimate.y - toward.y * 122,
        intentAngle: Math.atan2(enemyEstimate.y - (enemyEstimate.y - toward.y * 122), enemyEstimate.x - (enemyEstimate.x - toward.x * 122)),
        preferredRange: preferredRange * 0.88,
      },
      {
        x: enemyEstimate.x - enemyForward.x * 70 - enemySide.x * broadsideSign * 110,
        y: enemyEstimate.y - enemyForward.y * 70 - enemySide.y * broadsideSign * 110,
        intentAngle: this.broadsideIntentAngle(
          enemyEstimate.x - enemyForward.x * 70 - enemySide.x * broadsideSign * 110,
          enemyEstimate.y - enemyForward.y * 70 - enemySide.y * broadsideSign * 110,
          enemyEstimate.x,
          enemyEstimate.y,
          -broadsideSign,
        ),
        preferredRange,
      },
    ], 1.22);
  }

  // U1 视野收尾：交火落点常停在"打得到却看不见"的盲区(vision≈166 ≪ range≈505)，
  // 双方互相失明便不开火、拖成平局。此处在进攻意图下把落点从盲区沿原方向(保留侧舷角)
  // 拉进视野距离，使舰真正夺取目标并持续开火。仅作用于进攻模式+愿意交战时。
  engageTarget(ship, enemy, target, mode, tactical, { combatRole = true } = {}) {
    if (this.legacy) return target; // 旧版AI：不做视野收尾压近
    if (!target || !enemy || !ship) return target;
    // 情报前探、后卫和侧翼已有各自的距离契约；通用交火收尾只能改写正面火力角色，
    // 否则会把长门前探从视野边缘推回普通射击距离，反而丢失情报价值。
    if (!combatRole) return target;
    // 吊在远处打(攻击射程≈505 ≫ 视野≈166，开火只需"队伍视野")：已侦得目标(enemy.visible)且落点在
    // 0.9×射程以内→把落点外推到 0.9×射程。敌视野够不到这个距离→敌看不见我便打不还手。
    // 情境化：中立交火期远吊安全输出(也抗对手远吊)；但到了收尾窗口(已占优、敌濒覆灭)就改为压近快速补杀。
    const barrierBreachWindow = Boolean(
      tactical.barrierTactics?.enemy
      && !tactical.barrierTactics.enemy.active
      && tactical.barrierTactics.enemy.disabledRemaining > 0,
    );
    if (enemy.visible && !tactical.closeoutWindow && !barrierBreachWindow) {
      // 站在敌视野之外打：交火距离取"敌方视野×POKE_VISION_MULT"(刚好够不到我)，clamp 在射程内。
      // 比满射程远吊更靠前→火力更集中/压制更强，又仍在敌视野外→不挨打。
      const enemyVis = this.estimateVisionRange(enemy);
      const pokeR = clamp(enemyVis * POKE_VISION_MULT, enemyVis + 30, ship.effectiveRange() * 0.95);
      const px = target.x - enemy.x;
      const py = target.y - enemy.y;
      const pOff = Math.hypot(px, py);
      if (pOff > 1 && Math.abs(pOff - pokeR) > 12 && pOff < ship.effectiveRange() * 0.98) {
        const pk = pokeR / pOff;
        return {
          ...target,
          x: this.team.match.clampX(enemy.x + px * pk, this.safeRoutePadding()),
          y: this.team.match.clampY(enemy.y + py * pk, this.safeRoutePadding()),
        };
      }
    }
    const aggressive = combatRole && (mode === "press" || mode === "collapse" || mode === "broadside" || mode === "cutoff");
    if (!aggressive) return target;
    // 是否压近夺视野要judicious：常规敌人压近能吃到侧舷1.5倍密度，值得贴上去交火；
    // 但对手是阿虚(Kyon)旗舰时射界密度被抹平、贴脸纯比血厚——此时只有真正占优/收尾才压近，
    // 否则保持站位别一头扎进肉阵容被对耗(对抗实测的回归)。
    const enemyFlatDensity = typeof this.enemy.hasKyonFlagship === "function" && this.enemy.hasKyonFlagship();
    const want = tactical.killWindow || tactical.emergencyCommit || tactical.winning
      || (enemyFlatDensity
        ? tactical.localAdvantage >= 1.05
        : (tactical.localAdvantage >= 0.82 || tactical.intelSolid));
    if (!want) return target;
    const vision = ship.effectiveVision();
    const ox = target.x - enemy.x;
    const oy = target.y - enemy.y;
    const off = Math.hypot(ox, oy);
    if (off < 1) return target;
    const visionEngage = clamp(vision * 0.88, 90, Math.max(vision, 90));
    if (off <= visionEngage + 6) return target; // 已在视野内
    const k = visionEngage / off;
    return {
      ...target,
      x: this.team.match.clampX(enemy.x + ox * k, this.safeRoutePadding()),
      y: this.team.match.clampY(enemy.y + oy * k, this.safeRoutePadding()),
    };
  }

  issueShipRoute(ship, targetX, targetY, throttle, padding = this.team.match.mapPadding) {
    if (!ship || !ship.alive || !ship.canControl()) {
      return null;
    }
    const tx = this.team.match.clampX(targetX, padding);
    const ty = this.team.match.clampY(targetY, padding);
    const requestedThrottle = clamp(throttle, 0.45, 1.2);
    // AI 的战术层以 >1 表示明确的超速意图；离散化后应进入前进4档，
    // 不能因为 1.04～1.18 在数值上更靠近标准巡航而丢掉脱困/追击加速。
    const th = this.energyAwareThrottleForShip(ship, requestedThrottle);
    let update = "new";

    if (!ship.route) {
      ship.setBezierRoute(undefined, undefined, tx, ty, th, false);
      return {
        x: tx,
        y: ty,
        throttle: th,
        padding,
        update,
      };
    }

    const endpointGap = distance(ship.route.p2.x, ship.route.p2.y, tx, ty);
    if (endpointGap > 90 || ship.route.t > 0.7) {
      ship.setBezierRoute(undefined, undefined, tx, ty, th, false);
      update = "reset";
    } else {
      ship.throttle = normalizeThrottleToGear(th, ship.throttle);
      ship.setRouteEndpoint(tx, ty, false);
      update = "retarget";
    }
    return {
      x: tx,
      y: ty,
      throttle: th,
      padding,
      update,
    };
  }

  steerActiveKoizumiOrbs(context = this.currentContext) {
    if (this.koizumiOrbSteerTimer > 0) return;
    const activeOrbs = [this.team.ships.sub1, this.team.ships.sub2].filter(
      (ship) => ship?.alive && ship.koizumiOrb?.phase === "active" && ship.canControl(),
    );
    if (activeOrbs.length === 0) {
      this.koizumiOrbSteerTimer = 0;
      return;
    }

    for (const ship of activeOrbs) {
      const barrier = context?.barrierTactics?.enemy;
      const knownBarrierMain = barrier?.active
        ? this.projectContact(this.enemyIntel.main, 0.8)
        : null;
      const estimate = knownBarrierMain
        ? { ...knownBarrierMain, x: barrier.x, y: barrier.y }
        : this.selectEnemyFocus(ship) || context?.focus || this.primaryEnemyEstimate();
      if (!estimate || estimate.source === "spawn") continue;
      const dist = distance(ship.x, ship.y, estimate.x, estimate.y);
      const cruiseSpeed = Math.max(120, Number(ship.koizumiOrb.cruiseSpeed) || 164);
      const leadSeconds = clamp(dist / cruiseSpeed, 0.16, 0.72);
      const targetX = estimate.x + Math.cos(Number(estimate.angle) || 0) * (Number(estimate.speed) || 0) * leadSeconds;
      const targetY = estimate.y + Math.sin(Number(estimate.angle) || 0) * (Number(estimate.speed) || 0) * leadSeconds;
      this.issueShipRoute(ship, targetX, targetY, 1.2, this.safeRoutePadding(4));
    }
    // 高速冲撞需要比常规舰队战术更密的前视修正；难度仍通过反应倍率保留差异。
    this.koizumiOrbSteerTimer = clamp(0.18 * Math.sqrt(this.reactionMult || 1), 0.18, 0.48);
  }

  issueMovement(context = this.currentContext) {
    const main = this.team.ships.main;
    if (!main.alive) {
      return;
    }

    const enemyEstimate = context?.focus || this.selectEnemyFocus(main) || this.primaryEnemyEstimate();
    if (!enemyEstimate) {
      return;
    }

    const tactical = context || this.buildTacticalContext(main, enemyEstimate);
    const searchCenter = this.acquireSearchCenter(main, enemyEstimate);
    const mode = this.chooseMode(tactical);
    const center = mode === "search" ? searchCenter : this.combatCenter(enemyEstimate);
    const sectorPlan = ((mode === "search" || mode === "cutoff" || mode === "collapse" || mode === "press") && (tactical.trackableIntel || tactical.searchRequired || tactical.isolatedTargetScore > 0.28 || !tactical.intelSolid))
      ? this.computeSectorEncirclement(main, enemyEstimate, searchCenter, tactical.encirclePressure)
      : null;
    const useSearchSectorPlan = Boolean(sectorPlan && mode === "search" && (tactical.trackableIntel || tactical.focus.source !== "spawn"));
    const searchAssignments = mode === "search"
      ? (useSearchSectorPlan ? sectorPlan : this.computeSearchAssignments(main, enemyEstimate, searchCenter))
      : null;
    let mainTarget = mode === "search"
      ? (useSearchSectorPlan ? sectorPlan.main : this.computeSearchTarget(main, enemyEstimate, searchAssignments.main))
      : sectorPlan && (mode === "cutoff" || mode === "press")
        ? sectorPlan.main
        : this.computeMainTarget(mode, main, enemyEstimate, center);
    const toEnemyX = enemyEstimate.x - main.x;
    const toEnemyY = enemyEstimate.y - main.y;
    const len = Math.max(1, Math.hypot(toEnemyX, toEnemyY));
    const toward = { x: toEnemyX / len, y: toEnemyY / len };
    const side = { x: -toward.y, y: toward.x };
    const sign = tactical.flankSign || this.preferredFlankSign(main, enemyEstimate);
    const detachedPlan = this.planDetachedRoles(main, enemyEstimate, tactical);
    const debugPlan = {
      focus: this.debugContact(enemyEstimate),
      searchCenter: this.debugPoint(searchCenter),
      combatCenter: this.debugPoint(center),
      searchAssignments: this.debugPointMap(searchAssignments),
      sectorPlan: this.debugPointMap(sectorPlan),
      detachedPlan: this.debugDetachedPlan(detachedPlan),
      orders: {},
      useSearchSectorPlan,
      shouldUseDetachedRoles: false,
    };
    const intelLeadShip = detachedPlan.intelLeadKey ? this.team.ships[detachedPlan.intelLeadKey] : null;
    const barrierBreachWindow = Boolean(
      tactical.barrierTactics?.enemy
      && !tactical.barrierTactics.enemy.active
      && tactical.barrierTactics.enemy.disabledRemaining > 0,
    );
    let mainHeldForIntelLead = false;
    if (
      detachedPlan.intelLeadKey
      && !barrierBreachWindow
      && !tactical.killWindow
      && (!tactical.emergencyCommit || (intelLeadShip?.characterId === "yuki" && (enemyEstimate.visible || tactical.intelSolid)))
      && (mode !== "collapse" || (intelLeadShip?.characterId === "yuki" && (enemyEstimate.visible || tactical.intelSolid)))
    ) {
      const supportRange = clamp(
        main.effectiveRange() * (tactical.trackableIntel || tactical.searchRequired ? 1.04 : 0.96) * (intelLeadShip?.characterId === "yuki" ? 1.18 : 1),
        240,
        intelLeadShip?.characterId === "yuki" ? 430 : 390,
      );
      const supportCandidate = {
        x: this.team.match.clampX(enemyEstimate.x - toward.x * supportRange - side.x * sign * 54, this.safeRoutePadding(8)),
        y: this.team.match.clampY(enemyEstimate.y - toward.y * supportRange - side.y * sign * 54, this.safeRoutePadding(8)),
        intentAngle: Math.atan2(
          enemyEstimate.y - (enemyEstimate.y - toward.y * supportRange - side.y * sign * 54),
          enemyEstimate.x - (enemyEstimate.x - toward.x * supportRange - side.x * sign * 54),
        ),
        preferredRange: supportRange,
      };
      const currentRange = distance(mainTarget.x, mainTarget.y, enemyEstimate.x, enemyEstimate.y);
      const supportExchange = this.evaluateArcExchange(main, enemyEstimate, supportCandidate, 1.24);
      if (currentRange < supportRange - 28 || supportExchange.enemyDensity <= 1.15 || (intelLeadShip?.characterId === "yuki" && (enemyEstimate.visible || tactical.intelSolid))) {
        mainTarget = supportCandidate;
        // 仅长门前探(其视野远、专职侦察)时主舰保持支援位不压近；其余情况仍可压近夺视野/吃侧舷
        mainHeldForIntelLead = intelLeadShip?.characterId === "yuki";
      }
    }
    // U1 视野收尾：主舰若非"为前探僚舰保持火力支援位"，则在进攻意图下压近到视野距离夺取目标
    if (!mainHeldForIntelLead) {
      mainTarget = this.engageTarget(main, enemyEstimate, mainTarget, mode, tactical);
    }
    mainTarget = applyKoizumiBarrierMainStrategy({
      main,
      enemyEstimate,
      target: mainTarget,
      tactics: tactical.barrierTactics,
      match: this.team.match,
      padding: this.safeRoutePadding(14),
      flankSign: tactical.flankSign || 1,
    });
    const throttleShift = tactical.emergencyCommit
      ? 0.06 + tactical.energySurplus * 0.05
      : tactical.energySurplus * 0.05 - tactical.energyRecoveryNeed * 0.18;
    const throttleBand = (min, max) => {
      const adjustedMin = clamp(min + throttleShift, 0.52, 1.18);
      const adjustedMax = clamp(max + throttleShift, adjustedMin + 0.04, 1.2);
      return randomInRange(adjustedMin, adjustedMax);
    };
    let mainThrottle = mode === "recover"
      ? throttleBand(1.02, 1.18)
      : mode === "harvest"
        ? throttleBand(0.68, 0.88)
        : mode === "search"
          ? throttleBand(tactical.conserveEnergy ? 0.94 : 1.04, tactical.conserveEnergy ? 1.08 : 1.18)
        : mode === "collapse"
          ? throttleBand(1.02, 1.18)
          : mode === "regroup"
            ? throttleBand(0.9, 1.08)
            : mode === "kite"
              ? throttleBand(0.86, 1.04)
              : tactical.pressureDrive > 0.95 || tactical.emergencyCommit
                ? throttleBand(1.02, 1.18)
                : throttleBand(0.94, 1.14);
    if (
      tactical.barrierTactics?.incoming
      || (tactical.barrierTactics?.own && !tactical.barrierTactics.own.active)
      || (
        tactical.barrierTactics?.enemy?.active
        && (
          tactical.barrierTactics.breachShipKey === "main"
          || tactical.barrierTactics.infiltratorKey === "main"
        )
      )
    ) {
      mainThrottle = throttleForGear(4);
    }
    const mainIssued = this.issueShipRoute(
      this.team.ships.main,
      mainTarget.x,
      mainTarget.y,
      mainThrottle,
      this.safeRoutePadding(mode === "recover" ? 24 : 0),
    );
    if (mainIssued) {
      debugPlan.orders.main = {
        shipKey: "main",
        role: mode,
        detached: false,
        target: this.debugPoint(mainTarget),
        throttle: mainIssued.throttle,
        padding: mainIssued.padding,
        update: mainIssued.update,
      };
    }

    const focus = mode === "search" ? searchCenter : enemyEstimate;
    const shouldUseDetachedRoles = this.team.splitLevel > 0
      && !(sectorPlan && !tactical.intelSolid && !enemyEstimate.visible && tactical.trackableIntel)
      && (mode !== "search" || tactical.trackableIntel || tactical.intelSolid || tactical.focus.source !== "spawn");
    debugPlan.shouldUseDetachedRoles = shouldUseDetachedRoles;
    const routeDetachedShip = (ship) => {
      if (!ship || !ship.alive || ship.isAttached()) {
        return;
      }
      const role = detachedPlan.roles[ship.key] || "fire";
      const laneSign = detachedPlan.laneSigns[ship.key] || sign;
      let directive = this.computeDetachedDirective(ship, role, enemyEstimate, tactical, main, mainTarget, laneSign);
      if (!directive) {
        return;
      }
      if (role !== "breach" && role !== "infiltrate") {
        directive.target = this.engageTarget(ship, enemyEstimate, directive.target, mode, tactical, { combatRole: role === "fire" || role === "front" });
      }
      directive = keepDirectiveInsideKoizumiBarrier(
        directive,
        ship,
        mainTarget,
        tactical.barrierTactics,
        role,
      );
      // 编队凝聚(反孤立)：交战角色的分离舰不得离主力太远，避免被各个击破，并让火力自然汇聚到同一片战区
      // (公平的"集中兵力"——靠站位凝聚，而非锁定目标)。后撤/侦察/逃逸不受此限。
      if (!this.legacy && (role === "fire" || role === "flank" || role === "front") && main.alive) {
        const leash = clamp(main.effectiveRange() * 0.40, 150, 235);
        const dxm = directive.target.x - main.x;
        const dym = directive.target.y - main.y;
        const dm = Math.hypot(dxm, dym);
        if (dm > leash) {
          directive.target = {
            ...directive.target,
            x: this.team.match.clampX(main.x + (dxm / dm) * leash, this.safeRoutePadding(8)),
            y: this.team.match.clampY(main.y + (dym / dm) * leash, this.safeRoutePadding(8)),
          };
        }
      }
      let throttleRange = directive.throttle;
      if (role === "escape") {
        throttleRange = { min: 1.04, max: 1.2 };
      } else if (role === "breach" || role === "infiltrate") {
        throttleRange = role === "breach"
          ? { min: 1.12, max: 1.2 }
          : { min: 1.04, max: 1.18 };
      } else if (mode === "harvest" && role !== "intel") {
        throttleRange = { min: 0.58, max: Math.min(0.88, throttleRange.max) };
      } else if (mode === "regroup" && role !== "intel" && role !== "front") {
        throttleRange = {
          min: Math.max(0.68, throttleRange.min - 0.08),
          max: Math.max(Math.max(0.78, throttleRange.min), throttleRange.max - 0.06),
        };
      } else if (mode === "kite" && role === "rear") {
        throttleRange = { min: 0.54, max: 0.76 };
      }
      const issued = this.issueShipRoute(
        ship,
        directive.target.x,
        directive.target.y,
        throttleBand(throttleRange.min, throttleRange.max),
        this.safeRoutePadding(role === "rear" || role === "escape" ? 14 : 8),
      );
      if (issued) {
        debugPlan.orders[ship.key] = {
          shipKey: ship.key,
          role: directive.role,
          detached: true,
          target: this.debugPoint(directive.target),
          throttle: issued.throttle,
          padding: issued.padding,
          update: issued.update,
        };
      }
    };

    if (this.team.splitLevel >= 1 && this.team.ships.sub1.alive) {
      if (shouldUseDetachedRoles) {
        routeDetachedShip(this.team.ships.sub1);
      } else {
        let sub1Target = mode === "search"
        ? searchAssignments.sub1
        : sectorPlan && (mode === "cutoff" || mode === "press")
          ? sectorPlan.sub1
        : {
            x: mode === "harvest"
              ? main.x - toward.x * 70 + side.x * 145
              : mode === "regroup"
                ? main.x - toward.x * 70 + side.x * 120
                : mode === "kite"
                  ? main.x - toward.x * 40 + side.x * 170
                  : mode === "collapse"
                    ? focus.x - side.x * 180 - toward.x * 28
                    : mode === "broadside"
                      ? focus.x + side.x * sign * 220 - toward.x * 90
                      : focus.x + randomInRange(-250, 250),
            y: mode === "harvest"
              ? main.y - toward.y * 70 + side.y * 145
              : mode === "regroup"
                ? main.y - toward.y * 70 + side.y * 120
                : mode === "kite"
                  ? main.y - toward.y * 40 + side.y * 170
                  : mode === "collapse"
                    ? focus.y - side.y * 180 - toward.y * 28
                    : mode === "broadside"
                      ? focus.y + side.y * sign * 220 - toward.y * 90
                      : focus.y + randomInRange(-250, 250),
          };
      if (tactical.barrierTactics?.own) {
        const barrier = tactical.barrierTactics.own;
        sub1Target = clampPointToAnchorRadius(
          sub1Target,
          mainTarget,
          barrier.active ? Math.max(42, barrier.radius - 34) : Math.min(96, barrier.radius * 0.58),
        );
      }
      const issued = this.issueShipRoute(
        this.team.ships.sub1,
        sub1Target.x,
        sub1Target.y,
        mode === "harvest"
          ? throttleBand(0.7, 0.88)
          : mode === "collapse"
            ? throttleBand(1, 1.16)
            : mode === "regroup"
                ? throttleBand(0.92, 1.08)
                : throttleBand(0.86, 1.12),
        this.safeRoutePadding(10),
      );
      if (issued) {
        debugPlan.orders.sub1 = {
          shipKey: "sub1",
          role: mode === "search" ? "search" : "support",
          detached: false,
          target: this.debugPoint(sub1Target),
          throttle: issued.throttle,
          padding: issued.padding,
          update: issued.update,
        };
      }
      }
    }

    if (this.team.splitLevel >= 2 && this.team.ships.sub2.alive) {
      if (shouldUseDetachedRoles) {
        routeDetachedShip(this.team.ships.sub2);
      } else {
        const orbitAngle = Number.isFinite(focus.angle) ? focus.angle : Math.atan2(focus.y - main.y, focus.x - main.x);
        let sub2Target = mode === "search"
        ? searchAssignments.sub2
        : sectorPlan && (mode === "cutoff" || mode === "press")
          ? sectorPlan.sub2
        : {
            x: mode === "harvest"
              ? main.x - toward.x * 70 - side.x * 145
              : mode === "regroup"
                ? main.x - toward.x * 70 - side.x * 120
                : mode === "kite"
                  ? main.x - toward.x * 40 - side.x * 170
                  : mode === "collapse"
                    ? focus.x + side.x * 180 - toward.x * 28
                    : mode === "broadside"
                      ? focus.x + side.x * sign * 120 + toward.x * 70
                      : focus.x + Math.cos(orbitAngle + Math.PI * 0.5) * randomInRange(160, 300),
            y: mode === "harvest"
              ? main.y - toward.y * 70 - side.y * 145
              : mode === "regroup"
                ? main.y - toward.y * 70 - side.y * 120
                : mode === "kite"
                  ? main.y - toward.y * 40 - side.y * 170
                  : mode === "collapse"
                    ? focus.y + side.y * 180 - toward.y * 28
                    : mode === "broadside"
                      ? focus.y + side.y * sign * 120 + toward.y * 70
                      : focus.y + Math.sin(orbitAngle + Math.PI * 0.5) * randomInRange(160, 300),
          };
      if (tactical.barrierTactics?.own) {
        const barrier = tactical.barrierTactics.own;
        sub2Target = clampPointToAnchorRadius(
          sub2Target,
          mainTarget,
          barrier.active ? Math.max(42, barrier.radius - 34) : Math.min(96, barrier.radius * 0.58),
        );
      }
      const issued = this.issueShipRoute(
        this.team.ships.sub2,
        sub2Target.x,
        sub2Target.y,
        mode === "harvest"
          ? throttleBand(0.68, 0.86)
          : mode === "collapse"
            ? throttleBand(0.98, 1.14)
            : mode === "regroup"
                ? throttleBand(0.9, 1.06)
                : throttleBand(0.84, 1.1),
        this.safeRoutePadding(6),
      );
      if (issued) {
        debugPlan.orders.sub2 = {
          shipKey: "sub2",
          role: mode === "search" ? "search" : "support",
          detached: false,
          target: this.debugPoint(sub2Target),
          throttle: issued.throttle,
          padding: issued.padding,
          update: issued.update,
        };
      }
      }
    }
    this.lastTacticalPlan = debugPlan;
  }
}
