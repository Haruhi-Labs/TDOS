import { TICK_DT } from "./constants.js";
import { aiActions } from "./ai/actions.js";
import { normalizeAiDifficulty, resolveAiParams } from "./ai/params/index.js";
import { snapshotVisibleCharacterTactics } from "./ai/bridge/observation.js";
import { bunnyStageRoute, shouldTransformBunny } from "./bot-bunny-haruhi-strategy.js";
import { SCOUT_LAUNCH_COST, fireArcDensityMultiplier } from "./combat-rules.js";
import {
  buildScoutRetaskOrders,
  createScoutDoctrineState,
  planYukiScoutDeployment,
  recordScoutDeployment,
  scoutMissionPoint,
} from "./bot-scout-strategy.js";
import {
  buildShamisenHuntTactics,
  planShamisenHuntFormation,
  shamisenHuntNeedsSplit,
} from "./bot-shamisen-strategy.js";
import {
  applyKoizumiBarrierMainStrategy,
  barrierBlocksRangedAttack,
  buildKoizumiBarrierTactics,
  characterTargetPriorityBonus,
  clampPointToAnchorRadius,
  keepDirectiveInsideKoizumiBarrier,
  koizumiBarrierRoleDirective,
  predictCharacterSkillAim,
} from "./bot-character-strategy.js";
import { CHARACTER_DEFS, skillMetaForCharacter } from "./characters.js";
import {
  energyRateForThrottle,
  throttleForGear,
  throttleGearForValue,
} from "./throttle.js";
import {
  clamp,
  distance,
  lerp,
  shortestAngleDelta,
  zoneContains,
} from "./math.js";

export class BotController {
  // port 是 AI 与对局之间的唯一通道：port.observe() 读取观测，port.submit(action) 提交动作。
  // params 指定难度、预设与覆盖：{ difficulty, preset, overrides }。
  constructor(port, { rng, params } = {}) {
    this.port = port;
    this.seat = port.seat;
    this.indexedObservation = null;
    this.observationIndex = null;
    this.entryDepth = 0;
    this.entryGuards = new Map();
    // 每席 AI 使用对局分配的随机流；未带种子的对局里它就是环境随机源。
    this.rng = rng;
    // 决策用到的全部数值都来自参数表；难度与旧版对照是其上的覆盖层。
    this.paramSpec = { difficulty: "master", preset: null, overrides: null, ...(params || {}) };
    this.applyParamSpec();

    this.moveTimer = 0;
    this.koizumiOrbSteerTimer = 0;
    this.scoutTimer = this.obs.self.flags.yukiFlagship ? 0.55 : this.profile.initialScoutTimer;
    this.scoutDoctrine = createScoutDoctrineState();
    this.currentScoutPlan = null;
    this.scoutPlanRefreshAt = 0;
    // 春日的首次施放既能立即提供团队强化，也会解锁常驻支援，因此不等待通用的开局观察窗。
    this.flagshipTimer = this.obs.self.loadout.main === "haruhi" ? 0 : this.profile.initialFlagshipTimer;
    this.subTimers = {
      sub1: this.profile.initialSubTimers.sub1,
      sub2: this.profile.initialSubTimers.sub2,
    };
    this.modeTimer = 0;
    this.mode = "press";

    this.lastMainPos = {
      x: this.obs.self.ships.main.x,
      y: this.obs.self.ships.main.y,
    };
    this.stuckTimer = 0;

    const enemyMain = this.port.enemySpawn();
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
        seenAt: this.obs.time,
        zoneId: spawnZone.id,
        source: "spawn",
      },
      searchZoneId: spawnZone.id,
    };
    this.pendingSightings = new Map();
    this.searchSweepSign = 1;
    this.lastSearchAdvanceAt = this.obs.time;
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
      at: this.obs.time,
    };
    this.lastFlagshipDecision = {
      action: "idle",
      cast: false,
      at: this.obs.time,
      target: null,
    };
    this.lastSubSkillDecision = {
      sub1: {
        action: "idle",
        cast: false,
        at: this.obs.time,
        target: null,
      },
      sub2: {
        action: "idle",
        cast: false,
        at: this.obs.time,
        target: null,
      },
    };
    this.lastSplitDecision = {
      attempt1: false,
      attempt2: false,
      acted: [],
      level: this.obs.self.splitLevel,
      at: this.obs.time,
    };
    return new Proxy(this, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        return typeof value === "function" && Object.hasOwn(BotController.prototype, property)
          && !Object.hasOwn(target, property)
          ? target.guardedEntry(property, value)
          : value;
      },
    });
  }

  // 外部（对局循环、调试页、测试）经门面调用任一方法时刷新观测，并把传入的实时对象换成观测数据；
  // 内部互相调用直接走原型方法，不重复处理。
  guardedEntry(name, method) {
    let guard = this.entryGuards.get(name);
    if (!guard) {
      guard = (...args) => {
        if (this.entryDepth > 0) return method.apply(this, args);
        this.port.invalidate();
        this.entryDepth = 1;
        try {
          return method.apply(this, args.map((arg) => this.observeArgument(arg)));
        } finally {
          this.entryDepth = 0;
        }
      };
      this.entryGuards.set(name, guard);
    }
    return guard;
  }

  observeArgument(arg) {
    return this.port.observeLive(arg, (id) => this.ownShipById(id));
  }

  get obs() {
    return this.port.observe();
  }

  // 兼容外部读取；决策代码不得使用。
  get team() {
    return this.port.team;
  }

  get strictObservation() {
    return this.port.strict;
  }

  set strictObservation(value) {
    this.port.strict = Boolean(value);
    this.port.invalidate();
  }

  indexObservation() {
    const obs = this.obs;
    if (this.indexedObservation !== obs) {
      this.indexedObservation = obs;
      const self = obs.self;
      const ships = [self.ships.main, self.ships.sub1, self.ships.sub2, ...self.extraShips];
      this.observationIndex = {
        ships,
        shipById: new Map(ships.map((ship) => [ship.id, ship])),
        visibleIds: new Set(obs.enemy.visible.map((entity) => entity.id)),
      };
    }
    return this.observationIndex;
  }

  ownShips() {
    return this.indexObservation().ships;
  }

  ownShipById(id) {
    return this.indexObservation().shipById.get(id) || null;
  }

  get visibleIds() {
    return this.indexObservation().visibleIds;
  }

  ownShip(shipOrKey) {
    if (typeof shipOrKey === "string") {
      return this.obs.self.ships[shipOrKey] || this.ownShips().find((ship) => ship.key === shipOrKey) || null;
    }
    return shipOrKey ? this.ownShipById(shipOrKey.id) : null;
  }

  fleetMembers(shipOrKey) {
    const ship = this.ownShip(shipOrKey);
    return ship ? ship.fleet.memberIds.map((id) => this.ownShipById(id)).filter(Boolean) : [];
  }

  fleetEnergy(shipOrKey) {
    const ship = this.ownShip(shipOrKey);
    return ship ? { current: ship.fleet.energy, max: ship.fleet.maxEnergy } : { current: 0, max: 0 };
  }

  hasEffect(ship, effectKey) {
    return Number(ship?.effects?.[effectKey] || 0) > this.obs.time;
  }

  clampX(x, padding = 0) {
    return clamp(x, padding, this.obs.world.size - padding);
  }

  clampY(y, padding = 0) {
    return clamp(y, padding, this.obs.world.size - padding);
  }

  zoneById(zoneId) {
    const safeId = clamp(Number(zoneId) || 5, 1, 9);
    return this.obs.world.zones.find((zone) => zone.id === safeId) || this.obs.world.zones[4];
  }

  // 以下方法把决策结果表达为动作并提交；返回值是动作是否被接受。
  writeSplit(level) {
    return this.port.submit(aiActions.split(level));
  }

  writeThrottle(shipKey, throttle) {
    return this.port.submit(aiActions.setThrottle({ shipKey, throttle }));
  }

  writeRoute(shipKey, endX, endY, throttle) {
    return this.port.submit(aiActions.setRoute({ shipKey, endX, endY, throttle }));
  }

  writeRouteEndpoint(shipKey, endX, endY) {
    return this.port.submit(aiActions.routeEnd({ shipKey, endX, endY }));
  }

  writeLaunchScout(zoneId, { fromShipKey, ...orders }) {
    return this.port.submit(aiActions.launchScout({ zoneId, shipKey: fromShipKey, ...orders }));
  }

  writeScoutMission(scoutId, orders) {
    return this.port.submit(aiActions.retaskScout({ scoutId, ...orders }));
  }

  writeFlagshipSkill() {
    return this.port.submit(aiActions.castFlagshipSkill());
  }

  writeSubSkill(shipKey, target = {}) {
    return this.port.submit(aiActions.castSubSkill({ shipKey, ...target }));
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
    const age = Number.isFinite(contact.age) ? contact.age : Math.max(0, this.obs.time - (contact.seenAt || this.obs.time));
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
      shamisenHunt: context.shamisenHunt
        ? {
            attack: context.shamisenHunt.attack
              ? {
                  active: true,
                  targetId: context.shamisenHunt.attack.targetId,
                  targetVisible: Boolean(context.shamisenHunt.attack.targetVisible),
                  phase: context.shamisenHunt.attack.phase,
                  overcommitRisk: Boolean(context.shamisenHunt.attack.overcommitRisk),
                  leadShipKey: context.shamisenHunt.attack.leadShipKey,
                  leadGap: context.shamisenHunt.attack.leadGap,
                  spread: context.shamisenHunt.attack.spread,
                  blockerId: context.shamisenHunt.attack.blockerId,
                }
              : null,
            defense: context.shamisenHunt.defense
              ? {
                  active: true,
                  huntedShipKey: context.shamisenHunt.defense.huntedShipKey,
                  huntedShipId: context.shamisenHunt.defense.huntedShipId,
                  huntedIsMain: Boolean(context.shamisenHunt.defense.huntedIsMain),
                  huntedHpRatio: context.shamisenHunt.defense.huntedHpRatio,
                }
              : null,
          }
        : null,
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
            infiltration: context.barrierTactics.infiltration
              ? {
                  phase: context.barrierTactics.infiltration.phase,
                  shipKeys: [...context.barrierTactics.infiltration.shipKeys],
                  splitShipKeys: [...context.barrierTactics.infiltration.splitShipKeys],
                  stagedShipKeys: [...context.barrierTactics.infiltration.stagedShipKeys],
                  insideShipKeys: [...context.barrierTactics.infiltration.insideShipKeys],
                }
              : null,
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
      const age = this.obs.time - contact.seenAt;
      if ((contact.source === "visible" || age <= 0.6) && age <= 1.2) {
        visibleContacts += 1;
      }
    }
    return {
      seat: this.seat,
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
      shamisenHuntPlan: this.lastTacticalPlan?.shamisenHuntPlan || null,
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
        level: this.obs.self.splitLevel,
      },
    };
  }

  zoneForPoint(x, y) {
    return this.obs.world.zones.find((zone) => zoneContains(zone, x, y)) || this.obs.world.zones[4];
  }

  zoneCenter(zoneId) {
    const zone = this.zoneById(zoneId);
    return {
      zoneId: zone.id,
      x: zone.x + zone.width * 0.5,
      y: zone.y + zone.height * 0.5,
    };
  }

  safeRoutePadding(extra = 0) {
    return clamp(this.obs.world.size * 0.08, 90, 145) + extra;
  }

  edgePressure(ship) {
    if (!ship) {
      return 0;
    }
    const worldSize = this.obs.world.size;
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

  applyParamSpec() {
    this.params = resolveAiParams(this.paramSpec);
    this.profile = this.params.profile;
    this.difficulty = normalizeAiDifficulty(this.paramSpec.difficulty);
    this.reactionMult = this.params.difficulty.reactionMult;
    this.replanMult = this.params.difficulty.replanMult;
  }

  // 只切换 AI 决策参数的难度覆盖层；数值缩放等让分由对局在构造时写入舰队。
  setDifficulty(level) {
    this.paramSpec = { ...this.paramSpec, difficulty: level };
    this.applyParamSpec();
    return this;
  }

  // 旧版 AI 对照：等价于启用 legacy 预设。
  get legacy() {
    return this.paramSpec.preset === "legacy";
  }

  set legacy(value) {
    this.paramSpec = { ...this.paramSpec, preset: value ? "legacy" : null };
    this.applyParamSpec();
  }

  // 控制变量对照：关闭间接情报。
  get noIndirectIntel() {
    return !this.params.features.indirectIntel;
  }

  set noIndirectIntel(value) {
    const overrides = this.paramSpec.overrides || {};
    this.paramSpec = {
      ...this.paramSpec,
      overrides: { ...overrides, features: { ...overrides.features, indirectIntel: !value } },
    };
    this.applyParamSpec();
  }

  perceptionDelayFor(entity) {
    const P = this.params.perception;
    const base = entity.kind === "ship" ? P.shipDelay : entity.kind === "wingman" ? P.wingmanDelay : P.otherDelay;
    const roleBias = entity.slotKey === "main" ? P.mainBias : 0;
    const jitter = this.stableNoise(entity.id, 3) * P.jitter;
    const mult = this.reactionMult || 1; // 难度:放大反应时间(感知延迟),不改任何能力
    return clamp(
      (base + roleBias + jitter) * this.profile.reactionScale * mult,
      this.profile.reactionMin * mult,
      this.profile.reactionMax * mult,
    );
  }

  queueSighting(entity) {
    const snapshot = this.snapshotEnemyContact(entity, "visible");
    const now = this.obs.time;
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
    const now = this.obs.time;
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
      seenAt: this.obs.time,
      zoneId: zone.id,
      source,
      ...(entity.tactics || snapshotVisibleCharacterTactics(entity, this.obs.time)),
    };
  }

  ingestRadarContacts() {
    const radar = this.obs.self.radar;
    if (!radar) {
      return;
    }

    const now = this.obs.time;
    for (const radarContact of radar.contacts) {
      const targetId = Number(radarContact?.targetId ?? radarContact?.id);
      const detectedAt = Number(radarContact?.detectedAt);
      const expiresAt = Number(radarContact?.expiresAt);
      if (
        !Number.isFinite(targetId)
        || !Number.isFinite(detectedAt)
        || !Number.isFinite(radarContact?.x)
        || !Number.isFinite(radarContact?.y)
        || (Number.isFinite(expiresAt) && expiresAt <= now)
        || this.visibleIds.has(targetId)
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

  ingestShamisenHuntTarget() {
    const hunt = this.obs.self.hunt;
    if (!hunt || hunt.visible) {
      return;
    }
    const target = { id: hunt.targetId, x: hunt.x, y: hunt.y };
    const zone = this.zoneForPoint(target.x, target.y);
    // AI读取的内容与玩家看到的迷雾标记相同：精确位置会更新，但不偷看角色、席位、
    // 血量、朝向或舰体半径；source=hunt 也不会被当作真实视野。
    const snapshot = {
      id: target.id,
      kind: "ship",
      key: null,
      slotKey: null,
      characterId: null,
      x: target.x,
      y: target.y,
      angle: 0,
      speed: 0,
      hp: null,
      maxHp: null,
      radius: null,
      seenAt: this.obs.time,
      zoneId: zone.id,
      source: "hunt",
      confidence: 1,
      uncertainty: 0,
      visible: false,
    };
    this.enemyIntel.entities.set(target.id, snapshot);
    this.enemyIntel.searchZoneId = zone.id;
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

    const pressureTarget = this.obs.self.ships.main;
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
    const I = this.params.intel.projection;
    if (!contact) {
      return null;
    }
    const age = Math.max(0, this.obs.time - contact.seenAt);
    const lead = contact.source === "spawn" ? 0 : Math.min(age * this.profile.memoryLeadMultiplier, Math.max(maxLead, 0)) * I.leadFactor;
    const padding = this.safeRoutePadding();
    const worldSize = this.obs.world.size;
    const travel = this.predictEnemyVector(contact);
    let x = clamp(contact.x + travel.x * lead, padding, worldSize - padding);
    let y = clamp(contact.y + travel.y * lead, padding, worldSize - padding);

    let source = contact.source;
    let confidence = 1;
    let radarDerived = false;
    if (source === "radar") {
      radarDerived = true;
      const freshDuration = Math.max(I.radarFreshMin, (contact.radarExpiresAt || contact.seenAt + I.radarDefaultLife) - contact.seenAt);
      source = age <= freshDuration ? "radar" : "memory";
      confidence = clamp((contact.confidence ?? I.radarDefaultConfidence) - age * I.radarConfidenceDecay, I.radarConfidenceMin, I.radarConfidenceMax);
    } else if (source === "spawn") {
      confidence = clamp(I.spawnConfidence - age * I.spawnConfidenceDecay, I.spawnConfidenceMin, I.spawnConfidence);
    } else if (age > TICK_DT * 1.5) {
      source = "memory";
      confidence = clamp(I.memoryConfidence - age * I.memoryConfidenceDecay, I.memoryConfidenceMin, I.memoryConfidence);
    }

    let uncertainty = 0;
    if (radarDerived) {
      uncertainty = clamp((contact.uncertainty || I.radarDefaultUncertainty) + age * I.radarUncertaintyGrowth, I.radarUncertaintyMin, I.radarUncertaintyMax);
    } else if (source === "spawn") {
      uncertainty = clamp(I.spawnUncertainty + age * I.spawnUncertaintyGrowth, I.spawnUncertainty, I.spawnUncertaintyMax);
    } else if (source === "memory") {
      uncertainty = clamp(I.memoryUncertainty + age * I.memoryUncertaintyGrowth + (1 - confidence) * I.memoryUncertaintyConfidence, I.memoryUncertainty, I.memoryUncertaintyMax);
    }

    if (uncertainty > 0 && !radarDerived) {
      const seed = contact.id * 97 + Math.round(contact.seenAt * 10);
      const sideAngle = travel.angle + Math.PI * 0.5;
      const forwardDrift = uncertainty * (I.forwardDriftBase + this.stableNoise(seed, 11) * I.forwardDriftNoise);
      const lateralDrift = uncertainty * (this.stableNoise(seed, 7) - 0.5) * I.lateralDrift;
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
    const ws = this.obs.world.size;
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
    for (const src of this.obs.self.visionSources) {
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
    for (const s of this.obs.enemy.visible) {
      if (s.kind === "ship") visible.push(s);
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
    for (const src of this.obs.self.visionSources) {
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
    if (this.params.features.indirectIntel) {
      // (a) 敌方子弹:朝我方飞来→开火的敌舰在其"逆飞行方向"、射程之内。只用我方能感知到的子弹(公平)。
      {
        for (const p of this.obs.enemy.projectiles) {
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
      for (const sc of this.obs.enemy.visible) {
        if (sc.kind !== "scout") continue;
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

    // “猫爪印记”的标记本来就持续显示精确位置，因此可以形成一个精确搜索峰；它仍不把
    // 其它敌人或目标属性写入情报。长门雷达则只注入带误差的接触。
    for (const stored of this.enemyIntel.entities.values()) {
      if (stored.source !== "hunt") continue;
      w[this.beliefIdxFor(b, stored.x, stored.y)] += 2.4;
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
    const weights = new Map(this.obs.world.zones.map((zone) => [zone.id, 0]));
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
    this.ingestShamisenHuntTarget();
    for (const entity of this.obs.enemy.visible) {
      this.queueSighting(entity);
    }
    this.flushPendingSightings();

    const staleCutoff = this.obs.time - 18;
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
    const age = this.obs.time - this.enemyIntel.main.seenAt;
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
      const age = this.obs.time - contact.seenAt;
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
    const V = this.params.value;
    const hp = Number(contact?.hp);
    const maxHp = Number(contact?.maxHp);
    if (Number.isFinite(hp) && Number.isFinite(maxHp) && maxHp > 0) {
      return clamp(hp / maxHp, V.contactHpMin, 1);
    }
    return contact?.kind === "scout" ? V.unknownScoutHp : contact?.kind === "wingman" ? V.unknownWingmanHp : V.unknownShipHp;
  }

  contactCombatValue(contact) {
    const V = this.params.value;
    if (!contact) {
      return 0;
    }
    const confidence = clamp(contact.confidence ?? 1, V.contactConfidenceMin, 1);
    if (contact.kind === "scout") {
      const baseValue = contact.combatCapable ? V.combatScout : V.scout;
      return baseValue * confidence * (contact.visible ? 1 : V.scoutHiddenFactor);
    }
    if (contact.kind === "wingman") {
      return V.wingman * this.contactHpRatio(contact) * confidence * (contact.visible ? 1 : V.wingmanHiddenFactor);
    }

    const stats = CHARACTER_DEFS[contact.characterId]?.stats || null;
    const roleFactor = contact.slotKey === "main" ? V.contactMainRole : V.contactSubRole;
    const rangeFactor = stats ? clamp(stats.range / V.rangeRef, V.rangeFactorMin, V.contactRangeFactorMax) : 1;
    const dpsFactor = stats ? clamp((stats.damage / Math.max(stats.fireRate, V.fireRateFloor)) / V.contactDpsRef, V.dpsFactorMin, V.contactDpsFactorMax) : 1;
    return roleFactor * rangeFactor * dpsFactor * (V.contactHpBase + V.contactHpWeight * this.contactHpRatio(contact)) * confidence * (contact.visible ? 1 : V.shipHiddenFactor);
  }

  shipCombatValue(ship) {
    const V = this.params.value;
    if (!ship || !ship.alive) {
      return 0;
    }
    const hpRatio = clamp(ship.hp / Math.max(ship.maxHp, 1), V.shipHpMin, 1);
    const energyRatio = clamp(ship.energy / Math.max(ship.maxEnergy, 1), 0, 1);
    const roleFactor = ship.key === "main" ? V.shipMainRole : ship.isAuxiliary ? V.shipAuxRole : 1;
    const rangeFactor = clamp(ship.stats.range / V.rangeRef, V.rangeFactorMin, V.shipRangeFactorMax);
    const dpsFactor = clamp((ship.stats.damage / Math.max(ship.stats.fireRate, V.fireRateFloor)) / V.shipDpsRef, V.dpsFactorMin, V.shipDpsFactorMax);
    return roleFactor * rangeFactor * dpsFactor * (V.shipHpBase + V.shipHpWeight * hpRatio) * (V.shipEnergyBase + V.shipEnergyWeight * energyRatio);
  }

  friendlyPowerAround(x, y, radius = 320) {
    const V = this.params.value;
    let total = 0;
    for (const ship of this.ownShips()) {
      if (!ship.alive) {
        continue;
      }
      const d = distance(ship.x, ship.y, x, y);
      if (d > radius * V.friendlyReach) {
        continue;
      }
      total += this.shipCombatValue(ship) * clamp(1 - d / Math.max(radius * V.friendlyReach, 1), V.friendlyShipFalloffMin, 1);
    }
    for (const wingman of this.obs.self.wingmen) {
      if (!wingman.alive) {
        continue;
      }
      const d = distance(wingman.x, wingman.y, x, y);
      if (d > radius * V.friendlyReach) {
        continue;
      }
      total += V.friendlyWingman * clamp(wingman.hp / Math.max(wingman.maxHp, 1), V.friendlyWingmanHpMin, 1) * clamp(1 - d / Math.max(radius * V.friendlyReach, 1), V.friendlyAircraftFalloffMin, 1);
    }
    for (const scout of this.obs.self.scouts) {
      if (!scout.alive || !scout.combatCapable) {
        continue;
      }
      const d = distance(scout.x, scout.y, x, y);
      if (d > radius * V.friendlyReach) {
        continue;
      }
      total += V.friendlyCombatScout * clamp(1 - d / Math.max(radius * V.friendlyReach, 1), V.friendlyAircraftFalloffMin, 1);
    }
    return total;
  }

  enemyThreatAround(x, y, radius = 320, maxAge = 8) {
    const V = this.params.value;
    let total = 0;
    for (const contact of this.knownEnemyContacts({ maxAge })) {
      const d = distance(contact.x, contact.y, x, y);
      if (d > radius * V.enemyReach) {
        continue;
      }
      total += this.contactCombatValue(contact) * clamp(1 - d / Math.max(radius * V.enemyReach, 1), V.enemyFalloffMin, 1);
    }
    return total;
  }

  enemyIsolationScore(contact, maxAge = 6) {
    const V = this.params.value;
    if (!contact) {
      return 0;
    }
    const nearbyThreat = this.enemyThreatAround(contact.x, contact.y, V.isolationRadius, maxAge) - this.contactCombatValue(contact);
    return clamp(V.isolationBase - nearbyThreat, V.isolationMin, V.isolationMax);
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
    const V = this.params.value;
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
    const value = hpRatio * V.vitalityHp + energyRatio * V.vitalityEnergy;
    return {
      hpRatio,
      energyRatio,
      value,
      fragile: hpRatio < V.fragileHp || energyRatio < V.fragileEnergy,
      healthy: hpRatio >= V.healthyHp && energyRatio >= V.healthyEnergy,
    };
  }

  shipThreatSnapshot(ship, maxAge = 7) {
    const V = this.params.value;
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
        ? ((CHARACTER_DEFS[contact.characterId]?.stats?.range || V.threatDefaultRange) + V.threatRangeMargin)
        : contact.combatCapable
          ? CHARACTER_DEFS.yuki.stats.range + V.threatRangeMargin
          : V.threatAircraftRange;
      const d = distance(ship.x, ship.y, contact.x, contact.y);
      if (d > range) {
        continue;
      }
      sources += 1;
      pressure += this.contactCombatValue(contact) * clamp(1 - d / Math.max(range, 1), V.threatFalloffMin, 1);
    }

    const friendlySupport = Math.max(V.supportFloor, this.friendlyPowerAround(ship.x, ship.y, V.supportRadius) - this.shipCombatValue(ship) * V.supportSelfDiscount);
    const danger = pressure / friendlySupport;
    return {
      sources,
      pressure,
      friendlySupport,
      danger,
      overwhelmed: sources >= 2 && danger > V.overwhelmedDanger,
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
      x: this.clampX(ship.x + (awayX / awayLen) * safeReach + (anchorDx / anchorLen) * 90, this.safeRoutePadding(14)),
      y: this.clampY(ship.y + (awayY / awayLen) * safeReach + (anchorDy / anchorLen) * 90, this.safeRoutePadding(14)),
      hostiles,
    };
  }

  splitUtilityForShip(ship, context) {
    const SU = this.params.split.utility;
    if (!ship || !ship.alive || !context) {
      return 0;
    }
    const vitality = this.shipVitality(ship);
    const visionEdge = clamp((ship.stats.vision - this.estimateVisionRange(context.focus)) / SU.visionEdgeScale, SU.visionEdgeMin, SU.visionEdgeMax);
    const characterBias = ship.characterId === "yuki"
      ? SU.yukiBias
      : ship.characterId === "future1096"
        ? SU.future1096Bias
        : ship.characterId === "asakura"
          ? SU.asakuraBias
          : ship.characterId === "shamisen"
            ? SU.shamisenBias
          : SU.otherBias;
    return vitality.value + visionEdge + characterBias;
  }

  energyProfile(shipOrKey) {
    const members = this.fleetMembers(shipOrKey).filter((ship) => ship.alive);
    const pool = this.fleetEnergy(shipOrKey);
    const ratio = pool.current / Math.max(pool.max, 1);
    const regen = members.reduce((sum, ship) => sum + ship.stats.energyRegen, 0);
    const moveLoad = members.reduce((sum, ship) => sum + ship.stats.moveDrain, 0);
    const sustainCruise = members.reduce((sum, ship) => (
      sum + energyRateForThrottle(ship.stats.energyRegen, ship.stats.moveDrain, throttleForGear(3))
    ), 0);
    const sustainRecover = members.reduce((sum, ship) => (
      sum + energyRateForThrottle(ship.stats.energyRegen, ship.stats.moveDrain, throttleForGear(2))
    ), 0);
    return {
      current: pool.current,
      max: pool.max,
      ratio,
      regen,
      moveLoad,
      sustainCruise,
      sustainRecover,
      high: ratio >= this.params.energy.profile.highRatio,
      low: ratio <= this.params.energy.profile.lowRatio,
      critical: ratio <= this.params.energy.profile.criticalRatio,
    };
  }

  energyThrottleGearCap(shipOrKey) {
    const profile = this.energyProfile(shipOrKey);
    const ship = typeof shipOrKey === "string" ? this.obs.self.ships[shipOrKey] : shipOrKey;
    if (profile.ratio <= this.params.energy.gear.criticalRatio) {
      return 1;
    }
    // 刀锋期间优先以四档迅速穿入敌阵；接触伤害固定，危险能量线前仍降档保留后续机动。
    if (this.hasEffect(ship, "bladeQueenUntil")) {
      return 4;
    }
    if (profile.ratio <= this.params.energy.gear.lowRatio) {
      return 2;
    }
    const currentGear = throttleGearForValue(ship?.throttle);
    const overdriveThreshold = currentGear === 4
      ? this.params.energy.gear.overdriveStopRatio
      : this.params.energy.gear.overdriveStartRatio;
    return profile.ratio >= overdriveThreshold ? 4 : 3;
  }

  energyAwareThrottleForShip(ship, requestedThrottle) {
    const intendedGear = requestedThrottle > 1
      ? 4
      : throttleGearForValue(requestedThrottle);
    return throttleForGear(Math.min(intendedGear, this.energyThrottleGearCap(ship)));
  }

  enforceEnergyThrottleCaps() {
    for (const ship of Object.values(this.obs.self.ships)) {
      if (!ship?.alive || ship.attached) {
        continue;
      }
      const currentGear = throttleGearForValue(ship.throttle);
      const gearCap = this.energyThrottleGearCap(ship);
      if (currentGear > gearCap) {
        this.writeThrottle(ship.key, throttleForGear(gearCap));
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
      : context?.energyRecoveryNeed > this.params.energy.commit.conserveAbove
        ? conserveFloor
        : normalFloor - Math.min(this.params.energy.commit.surplusDiscountMax, (context?.energySurplus || 0) * this.params.energy.commit.surplusDiscount);
    return afterRatio >= floor || profile.high;
  }

  pointEdgeClearance(x, y) {
    const size = this.obs.world.size;
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
      this.obs.self.flags.kyonFlagship,
    );
    const enemyDensity = this.arcDensityFromState(
      enemyFacing,
      enemyEstimate.x,
      enemyEstimate.y,
      candidate.x,
      candidate.y,
      this.obs.privileged.enemyHasKyonFlagship,
    );
    const edgePenalty = clamp((150 - this.pointEdgeClearance(candidate.x, candidate.y)) / 150, 0, 1) * 0.55;
    const preferredRange = Number.isFinite(candidate.preferredRange) ? candidate.preferredRange : ship.stats.range * 0.9;
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
    const sideOffset = clamp(main.stats.range * 0.82, 180, 320);
    const rearOffset = clamp(main.stats.range * 0.22, 55, 130);
    let bestSign = this.searchSweepSign;
    let bestScore = -Infinity;
    for (const sign of [1, -1]) {
      const candidate = {
        x: this.clampX(contact.x - enemyForward.x * rearOffset + enemySide.x * sideOffset * sign, this.safeRoutePadding()),
        y: this.clampY(contact.y - enemyForward.y * rearOffset + enemySide.y * sideOffset * sign, this.safeRoutePadding()),
      };
      candidate.intentAngle = this.broadsideIntentAngle(candidate.x, candidate.y, contact.x, contact.y, sign);
      candidate.preferredRange = clamp(main.stats.range * 0.86, 180, 340);
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
    const F = this.params.focus;
    const contacts = this.knownEnemyContacts({ maxAge: F.maxAge });
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
      const proximity = clamp(1 - dist / Math.max(main.stats.range * F.proximityRangeMult, 1), F.proximityMin, F.proximityMax);
      const freshness = clamp(1 - contact.age / F.freshnessWindow, 0, 1);
      const vulnerability = 1 - this.contactHpRatio(contact);
      const isolation = this.enemyIsolationScore(contact, F.isolationMaxAge);
      const overwhelmOpportunity = clamp(
        (this.friendlyPowerAround(contact.x, contact.y, F.overwhelmFriendlyRadius) + 0.2) / Math.max(this.enemyThreatAround(contact.x, contact.y, F.overwhelmEnemyRadius, 6) + 0.2, 0.2) - 1,
        F.overwhelmMin,
        F.overwhelmMax,
      );
      const typeBias = contact.slotKey === "main" ? F.typeMain : contact.kind === "ship" ? F.typeShip : F.typeOther;
      const visibleBias = contact.visible ? F.visible : F.hidden;
      const huntBias = contact.source === "hunt" ? F.hunt : 0;
      const uncertaintyPenalty = clamp((contact.uncertainty || 0) / F.uncertaintyScale, 0, F.uncertaintyMax);
      const score = typeBias
        + proximity
        + freshness * F.freshness
        + vulnerability * F.vulnerability
        + isolation * F.isolation
        + overwhelmOpportunity * F.overwhelm
        + visibleBias
        + huntBias
        + (this.params.features.characterPriority ? characterTargetPriorityBonus(contact, this.obs.time) : 0)
        - uncertaintyPenalty;
      if (score > bestScore) {
        bestScore = score;
        best = contact;
      }
    }
    return best || this.primaryEnemyEstimate();
  }

  buildTacticalContext(main, focus) {
    const X = this.params.context;
    const fleetEnergy = this.energyProfile("main");
    const rangeRef = main.stats.range;
    const dist = distance(main.x, main.y, focus.x, focus.y);
    const mainHull = main.hp / Math.max(main.maxHp, 1);
    const mainEnergyRatio = clamp(main.energy / Math.max(main.maxEnergy, 1), 0, 1);
    const fleetHull = this.obs.self.hullRatio;
    const energyRatio = fleetEnergy.ratio;
    const friendlyLocal = this.friendlyPowerAround(focus.x, focus.y, X.localRadius);
    const friendlyEscort = this.friendlyPowerAround(main.x, main.y, X.escortRadius);
    const enemyLocal = this.enemyThreatAround(focus.x, focus.y, X.localRadius, X.localMaxAge);
    const localAdvantage = (friendlyLocal + friendlyEscort * X.escortWeight + X.advantageBias) / Math.max(enemyLocal + X.advantageBias, X.advantageBias);
    const shamisenHunt = buildShamisenHuntTactics({
      obs: this.obs,
      ships: this.ownShips(),
      main,
      focus,
      knownContacts: this.knownEnemyContacts({ maxAge: X.huntContactMaxAge }),
      localAdvantage,
    });
    const hiddenHuntTarget = Boolean(
      shamisenHunt.attack?.active
      && shamisenHunt.attack.isFocus
      && !shamisenHunt.attack.targetVisible,
    );
    const intelSolid = focus.visible || (
      focus.source !== "spawn"
      && focus.source !== "hunt"
      && focus.age <= X.solidMaxAge
      && focus.confidence >= X.solidMinConfidence
    );
    const searchRequired = hiddenHuntTarget || focus.source === "spawn" || focus.age > X.searchAgeAbove || focus.confidence < X.searchConfidenceBelow;
    const killWindow = this.contactHpRatio(focus) < X.killHpBelow && dist < rangeRef * X.killRange;
    const broadsideWindow = dist > rangeRef * X.broadsideMinRange && dist < rangeRef * X.broadsideMaxRange && intelSolid;
    const detachedShips = [this.obs.self.ships.sub1, this.obs.self.ships.sub2].filter((ship) => ship.alive && !ship.attached);
    const detachedSpread = detachedShips.reduce((max, ship) => Math.max(max, distance(ship.x, ship.y, main.x, main.y)), 0);
    const overextended = detachedSpread > X.overextendedSpread && localAdvantage < X.overextendedAdvantage;
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
    const defensivePressure = (localAdvantage < X.defensiveAdvantage && dist < rangeRef * X.defensiveRange)
      || mainHull < X.defensiveHull
      || Boolean(shamisenHunt.defense?.active && shamisenHunt.defense.huntedHpRatio < X.defensiveHuntedHp);
    const flankSign = this.preferredFlankSign(main, focus);
    const ownArcDensity = this.arcDensityFromState(main.angle, main.x, main.y, focus.x, focus.y, this.obs.self.flags.kyonFlagship);
    const enemyArcDensity = this.arcDensityFromState(focus.angle, focus.x, focus.y, main.x, main.y, this.obs.privileged.enemyHasKyonFlagship);
    const arcAdvantage = ownArcDensity - enemyArcDensity;
    const enemyBroadsideRisk = enemyArcDensity >= X.broadsideRiskDensity;
    const safeExchange = enemyArcDensity <= 1 && ownArcDensity >= 1;
    const focusFreshness = clamp(1 - focus.age / X.freshnessWindow, 0, 1);
    const trackableIntel = !intelSolid && focus.source !== "spawn" && focus.age <= X.trackableMaxAge && focus.confidence >= X.trackableMinConfidence;
    const intelUrgency = focus.visible ? X.intelUrgencyVisible : focus.source === "spawn" ? X.intelUrgencySpawn : clamp(X.intelUrgencyBase + focus.age / X.intelUrgencyAgeScale + (1 - focus.confidence) * X.intelUrgencyConfidence, X.intelUrgencyMin, X.intelUrgencyMax);
    const isolatedTargetScore = clamp(this.enemyIsolationScore(focus, X.isolationMaxAge) + Math.max(0, localAdvantage - X.isolationAdvantageFloor) * X.isolationAdvantageWeight, X.isolatedMin, X.isolatedMax);
    const combatUrgency = clamp(
      (focus.visible ? X.combatUrgency.visible : X.combatUrgency.hidden)
      + (dist < rangeRef * X.combatUrgency.inRangeRatio ? X.combatUrgency.inRange : 0)
      + (killWindow ? X.combatUrgency.killWindow : 0)
      + (enemyLocal > friendlyLocal * X.combatUrgency.pressuredRatio && dist < rangeRef * X.combatUrgency.pressuredRange ? X.combatUrgency.pressured : 0)
      + (trackableIntel ? X.combatUrgency.trackableIntel : 0)
      + Math.max(0, maxShipThreat - X.combatUrgency.threatFloor) * X.combatUrgency.threat
      + isolatedTargetScore * X.combatUrgency.isolatedTarget,
      0,
      X.combatUrgency.max,
    );
    const counterCollapse = clamp(maxShipThreat - X.counterCollapseThreatFloor, 0, X.counterCollapseMax) * clamp(localAdvantage, X.counterCollapseAdvantageMin, X.counterCollapseAdvantageMax);
    const emergencyCommit = killWindow
      || maxShipThreat > X.emergencyThreat
      || (focus.visible && (combatUrgency > X.emergencyUrgency || dist < rangeRef * X.emergencyVisibleRange))
      || (trackableIntel && !hiddenHuntTarget && dist < rangeRef * X.emergencyTrackableRange && localAdvantage > X.emergencyTrackableAdvantage);
    const energySurplus = clamp((energyRatio - X.surplusFloor) / X.surplusSpan, 0, 1);
    const energyRecoveryNeed = clamp((X.recoveryCeiling - energyRatio) / X.recoveryCeiling, 0, 1) * (emergencyCommit ? X.recoveryEmergencyFactor : X.recoveryFactor);
    const conserveEnergy = energyRecoveryNeed > X.conserveAbove && !emergencyCommit && !trackableIntel;
    const mobilityBias = clamp(X.mobilityBase + energySurplus * X.mobilitySurplus + (emergencyCommit ? X.mobilityEmergency : 0) - energyRecoveryNeed * X.mobilityRecovery, X.mobilityMin, X.mobilityMax);
    const skillAggression = clamp(
      X.skillAggression.base
      + energySurplus * X.skillAggression.energySurplus
      + combatUrgency * X.skillAggression.combatUrgency
      + (trackableIntel ? X.skillAggression.trackableIntel : 0)
      + isolatedTargetScore * X.skillAggression.isolatedTarget
      - energyRecoveryNeed * X.skillAggression.energyRecoveryNeed,
      0,
      X.skillAggression.max,
    );
    const scoutPriority = clamp(
      intelUrgency * X.scoutPriority.intelUrgency
      + (searchRequired ? X.scoutPriority.searchRequired : 0)
      + (trackableIntel ? X.scoutPriority.trackableIntel : 0)
      + (hiddenHuntTarget ? X.scoutPriority.hiddenHuntTarget : 0)
      + Math.max(0, maxShipThreat - X.scoutPriority.threatFloor) * X.scoutPriority.threat
      - combatUrgency * X.scoutPriority.combatUrgency
      - energyRecoveryNeed * X.scoutPriority.energyRecoveryNeed,
      0,
      X.scoutPriority.max,
    );
    const encirclePressure = clamp(
      X.encirclePressure.base
      + focusFreshness * X.encirclePressure.freshness
      + (trackableIntel ? X.encirclePressure.trackableIntel : 0)
      + (searchRequired ? X.encirclePressure.searchRequired : 0)
      + isolatedTargetScore * X.encirclePressure.isolatedTarget,
      X.encirclePressure.min,
      X.encirclePressure.max,
    );
    const pressureDrive = clamp(localAdvantage - X.pressureDrive.advantageFloor, 0, X.pressureDrive.advantageMax) * X.pressureDrive.advantage
      + energySurplus * X.pressureDrive.energySurplus
      + clamp(focusFreshness - X.pressureDrive.freshnessFloor, 0, X.pressureDrive.freshnessMax) * X.pressureDrive.freshness
      + (killWindow ? X.pressureDrive.killWindow : 0)
      + (trackableIntel ? X.pressureDrive.trackableIntel : 0)
      + (emergencyCommit ? X.pressureDrive.emergencyCommit : 0)
      + counterCollapse * X.pressureDrive.counterCollapse
      + isolatedTargetScore * X.pressureDrive.isolatedTarget
      + (shamisenHunt.attack?.targetVisible && !shamisenHunt.attack.overcommitRisk ? X.pressureDrive.huntTargetVisible : 0)
      - (shamisenHunt.attack?.overcommitRisk ? X.pressureDrive.huntOvercommit : 0)
      - energyRecoveryNeed * X.pressureDrive.energyRecoveryNeed;

    // 收尾判断：是否占优(领先) + 是否到了该收尾的窗口(敌方濒临覆灭)。
    // 领先时不应因自身低血/低能转入防守，而应压制收尾——破解"双方都低血同时转防守"的平局僵局。
    const enemyHullTeam = this.obs.privileged.enemyHullRatio;
    const ownHullTeam = this.obs.self.hullRatio;
    const enemyAliveCount = this.obs.privileged.enemyAliveCount;
    const ownAliveCount = this.ownShips().filter((s) => s && s.alive).length;
    const winning = !this.params.features.closeout ? false : (ownAliveCount > enemyAliveCount || ownHullTeam > enemyHullTeam + X.winningHullLead);
    const closeoutWindow = !this.params.features.closeout ? false : (enemyAliveCount > 0
      && (enemyAliveCount < ownAliveCount || enemyHullTeam < X.closeoutEnemyHull || (killWindow && winning)));
    const enemyMainContact = this.projectContact(this.enemyIntel.main, X.enemyMainLead);
    const advancedCounterplay = this.usesAdvancedSkillCounterplay();
    const barrierTactics = buildKoizumiBarrierTactics({
      obs: this.obs,
      ships: this.ownShips(),
      enemyMainContact,
      main,
      enemyContacts: this.knownEnemyContacts({ maxAge: X.barrierContactMaxAge }),
      now: this.obs.time,
      legacy: !this.params.features.barrierTactics,
      advanced: advancedCounterplay,
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
      shamisenHunt,
      barrierTactics,
    };
  }

  shouldSplit(level, context, elapsed) {
    const SP = this.params.split;
    if (!context) {
      return false;
    }
    const huntSplitNeeded = shamisenHuntNeedsSplit(context.shamisenHunt, level, elapsed);
    if (
      huntSplitNeeded
      && (
        context.shamisenHunt?.defense?.active
        || (context.fleetHull > SP.huntMinHull && context.energyRatio > SP.huntMinEnergy)
      )
    ) {
      return true;
    }
    if (level === 1) {
      const ship = this.obs.self.ships.sub1;
      if (this.obs.self.splitLevel !== 0 || !ship.alive) {
        return false;
      }
      if (
        context.barrierTactics?.enemy?.active
        && (
          ["asakura", "koizumi"].includes(ship.characterId)
          || context.barrierTactics.infiltration?.splitShipKeys?.includes(ship.key)
        )
        && elapsed > SP.level1.barrierAfter
        && context.fleetHull > SP.level1.barrierMinHull
      ) {
        return true;
      }
      const splitUtility = this.splitUtilityForShip(ship, context);
      if ((context.mainHull < SP.level1.weakMainHull && context.mainEnergyRatio < SP.level1.weakMainEnergy) || context.fleetHull < SP.level1.weakFleetHull || context.energyRatio < SP.level1.weakEnergy || (context.defensivePressure && context.maxShipThreat > SP.level1.weakThreat)) {
        return elapsed > SP.level1.weakAfter && context.dist > context.rangeRef * SP.level1.weakMinRange;
      }
      if (context.searchRequired && elapsed < (splitUtility > SP.level1.searchUtility ? SP.level1.searchHoldHigh : SP.level1.searchHoldLow) && !context.trackableIntel) {
        return false;
      }
      const earlyWindow = splitUtility > SP.level1.earlyUtilityHigh ? SP.level1.earlyHigh : splitUtility > SP.level1.earlyUtilityMid ? SP.level1.earlyMid : SP.level1.earlyLow;
      return elapsed > earlyWindow && (
        context.killWindow
        || context.trackableIntel
        || context.intelSolid
        || context.isolatedTargetScore > SP.level1.isolated
        || context.focusFreshness > SP.level1.freshness
        || context.localAdvantage > (splitUtility > SP.level1.advantageUtility ? SP.level1.advantageHigh : SP.level1.advantageLow)
        || context.dist < context.rangeRef * SP.level1.range
      );
    }
    if (level === 2) {
      const ship = this.obs.self.ships.sub2;
      if (this.obs.self.splitLevel !== 1 || !ship.alive) {
        return false;
      }
      if (
        context.barrierTactics?.enemy?.active
        && (
          ["asakura", "koizumi"].includes(ship.characterId)
          || context.barrierTactics.infiltration?.splitShipKeys?.includes(ship.key)
        )
        && elapsed > SP.level2.barrierAfter
        && context.fleetHull > SP.level2.barrierMinHull
        && !context.overextended
      ) {
        return true;
      }
      const splitUtility = this.splitUtilityForShip(ship, context);
      if ((context.mainHull < SP.level2.weakMainHull && context.mainEnergyRatio < SP.level2.weakMainEnergy) || context.fleetHull < SP.level2.weakFleetHull || context.energyRatio < SP.level2.weakEnergy || context.overextended || (context.defensivePressure && context.maxShipThreat > SP.level2.weakThreat)) {
        return elapsed > SP.level2.weakAfter && context.localAdvantage > SP.level2.weakAdvantage;
      }
      if (!context.intelSolid && !context.trackableIntel && elapsed < (splitUtility > SP.level2.intelUtility ? SP.level2.intelHoldHigh : SP.level2.intelHoldLow)) {
        return false;
      }
      const earlyWindow = splitUtility > SP.level2.earlyUtilityHigh ? SP.level2.earlyHigh : splitUtility > SP.level2.earlyUtilityMid ? SP.level2.earlyMid : SP.level2.earlyLow;
      return elapsed > earlyWindow && (
        context.killWindow
        || context.trackableIntel
        || context.intelSolid
        || context.isolatedTargetScore > SP.level2.isolated
        || context.localAdvantage > (splitUtility > SP.level2.advantageUtility ? SP.level2.advantageHigh : SP.level2.advantageLow)
        || context.dist < context.rangeRef * SP.level2.range
      );
    }
    return false;
  }

  evaluateSplit(elapsed, context) {
    const acted = [];
    const attempt1 = this.shouldSplit(1, context, elapsed);
    if (attempt1 && this.writeSplit(1)) {
      acted.push(1);
    }
    const attempt2 = this.shouldSplit(2, context, elapsed);
    if (attempt2 && this.writeSplit(2)) {
      acted.push(2);
    }
    this.lastSplitDecision = {
      attempt1,
      attempt2,
      acted,
      level: this.obs.self.splitLevel,
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
      || this.obs.time - this.lastSearchAdvanceAt > this.profile.searchAdvanceWindow
    ) {
      this.enemyIntel.searchZoneId = this.searchOrder[this.searchCursor % this.searchOrder.length];
      this.searchCursor = (this.searchCursor + 1) % this.searchOrder.length;
      this.searchSweepSign *= -1;
      this.lastSearchAdvanceAt = this.obs.time;
    }

    return this.zoneCenter(this.enemyIntel.searchZoneId);
  }

  likelyProbeZoneId(focus) {
    if (!focus) {
      return null;
    }
    const travel = this.predictEnemyVector(focus);
    const probeDistance = clamp((140 + (focus.uncertainty || 0) * 0.9) * this.profile.probeDistanceMultiplier, 150, this.obs.world.size / 2.6);
    const probeX = this.clampX(focus.x + Math.cos(travel.angle) * probeDistance, this.safeRoutePadding());
    const probeY = this.clampY(focus.y + Math.sin(travel.angle) * probeDistance, this.safeRoutePadding());
    return this.zoneForPoint(probeX, probeY).id;
  }

  // 选侦察机起源舰：取离"敌方估计位置(或目标战区中心)"最近的存活舰，使侦察最快抵近目标(前出分离舰优先)
  pickScoutSourceKey(zoneId, aimPoint = null) {
    const c = (aimPoint && Number.isFinite(aimPoint.x)) ? aimPoint : this.zoneCenter(zoneId);
    let bestKey = "main";
    let bestD = Infinity;
    for (const key of ["main", "sub1", "sub2"]) {
      const ship = this.obs.self.ships[key];
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
        return this.stableNoise(Math.round(this.obs.time * 10), focus.zoneId) < 0.72 && probeZoneId
          ? probeZoneId
          : focus.zoneId;
      }
      if (focus.age <= 12) {
        this.enemyIntel.searchZoneId = probeZoneId || focus.zoneId;
        if (probeZoneId && this.stableNoise(Math.round(this.obs.time * 8), probeZoneId) < 0.92) {
          return probeZoneId;
        }
        return focus.zoneId;
      }
    }
    return this.acquireSearchCenter(main, focus).zoneId;
  }

  planScoutDeployment(context = this.currentContext) {
    if (!this.obs.self.flags.yukiFlagship || !this.obs.self.ships.main.alive) {
      return null;
    }
    const focus = context?.focus || this.primaryEnemyEstimate();
    const activeScouts = this.obs.self.scouts
      .filter((scout) => scout.alive && scout.combatCapable)
      .map((scout) => ({
        id: scout.id,
        zoneId: scout.zoneId || this.zoneForPoint(scout.x, scout.y).id,
        life: scout.life,
        mode: scout.mode,
        mission: scout.mission,
      }));
    return planYukiScoutDeployment({
      state: this.scoutDoctrine,
      zones: this.obs.world.zones,
      worldSize: this.obs.world.size,
      ownMain: this.obs.self.ships.main,
      forwardSign: this.seat === "A" ? 1 : -1,
      focus,
      contacts: this.knownEnemyContacts({ maxAge: 12 }),
      beliefZoneWeights: this.beliefZoneWeights(),
      activeScouts,
      context: context || {},
      now: this.obs.time,
      probeZoneId: this.likelyProbeZoneId(focus),
    });
  }

  retaskYukiCombatScouts(plan) {
    const now = this.obs.time;
    if (!plan || now < this.scoutDoctrine.nextRetaskAt) {
      return 0;
    }
    const activeScouts = this.obs.self.scouts
      .filter((scout) => scout.alive && scout.combatCapable)
      .map((scout) => ({
        id: scout.id,
        zoneId: scout.zoneId || this.zoneForPoint(scout.x, scout.y).id,
        life: scout.life,
        mode: scout.mode,
        mission: scout.mission,
      }));
    const orders = buildScoutRetaskOrders(plan, activeScouts, 2);
    let retasked = 0;
    for (const [index, order] of orders.entries()) {
      const scout = this.obs.self.scouts.find((item) => item.id === order.scoutId && item.alive);
      if (!scout) continue;
      const seekPoint = scoutMissionPoint(plan, this.obs.world.zones, order.zoneId, index + 1);
      if (this.writeScoutMission(scout.id, {
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
    const SL = this.params.scout.launch;
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
    if (this.obs.self.flags.yukiFlagship) {
      const activeScouts = this.obs.self.scouts.filter((item) => item.alive && item.combatCapable).length;
      const desiredActive = scoutPlan?.desiredActive || SL.yukiDesiredActive;
      const maxActive = scoutPlan?.maxActive || SL.yukiMaxActive;
      if (activeScouts >= maxActive) {
        return false;
      }
      if (context.emergencyCommit && context.intelSolid && fleetEnergy.ratio < SL.yukiEmergencyEnergy && activeScouts >= 2) {
        return false;
      }
      if (context.conserveEnergy && activeScouts >= 2 && !context.searchRequired && !context.trackableIntel) {
        return false;
      }
      return activeScouts < desiredActive
        || context.scoutPriority > SL.yukiPriority
        || context.trackableIntel
        || context.maxShipThreat > SL.yukiThreat;
    }
    if (context.emergencyCommit && context.intelSolid && fleetEnergy.ratio < SL.emergencyEnergy) {
      return false;
    }
    if (context.conserveEnergy && !context.searchRequired && !context.trackableIntel) {
      return false;
    }
    return context.scoutPriority > SL.priority;
  }

  shouldReserveEnergyForHaruhiFlagship() {
    if (this.obs.self.loadout.main !== "haruhi" || !this.obs.self.ships.main.alive) {
      return false;
    }
    const meta = skillMetaForCharacter("haruhi", "flagship");
    const cost = Number(meta?.cost) || 0;
    const readyIn = Math.max(
      0,
      Number(this.obs.self.cooldowns.flagship) || 0,
      Number(this.flagshipTimer) || 0,
    );
    if (readyIn > this.params.skills.haruhiFlagship.energyReserveWindow) {
      return false;
    }
    const energy = this.energyProfile("main");
    // 即将可以施放时，侦察机不能抢走技能所需能量；仍保留5%余量，避免施放后立刻失去机动能力。
    return energy.current - SCOUT_LAUNCH_COST < cost + energy.max * 0.05;
  }

  combatCenter(enemyEstimate) {
    const worldCenter = this.obs.world.size * 0.5;
    return {
      x: lerp(worldCenter, enemyEstimate.x, 0.24),
      y: lerp(worldCenter, enemyEstimate.y, 0.24),
    };
  }

  computeRecoveryTarget(main, enemyEstimate) {
    const padding = this.safeRoutePadding(24);
    const worldSize = this.obs.world.size;
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
    const ST = this.params.scout.timers;
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
    const main = this.obs.self.ships.main;
    const focus = main.alive ? this.selectEnemyFocus(main) : null;
    this.currentContext = main.alive && focus ? this.buildTacticalContext(main, focus) : null;
    this.evaluateSplit(elapsed, this.currentContext);
    this.enforceEnergyThrottleCaps();
    const shouldRefreshScoutPlan = this.obs.self.flags.yukiFlagship && (
      !this.currentScoutPlan
      || this.obs.time >= this.scoutPlanRefreshAt
      || this.scoutTimer <= 0
      || this.obs.time >= this.scoutDoctrine.nextRetaskAt
    );
    if (shouldRefreshScoutPlan) {
      this.currentScoutPlan = this.planScoutDeployment(this.currentContext);
      this.scoutPlanRefreshAt = this.obs.time + ST.planRefresh;
    }
    const scoutPlan = this.currentScoutPlan;
    const retaskedScouts = this.retaskYukiCombatScouts(scoutPlan);

    if (
      this.currentContext
      && this.currentContext.intelUrgency > ST.urgentIntel
      && this.obs.self.scouts.filter((item) => item.alive).length === 0
    ) {
      this.scoutTimer = Math.min(this.scoutTimer, this.profile.aggressiveScoutWindow);
    }

    if (
      this.currentContext
      && this.currentContext.maxShipThreat > ST.urgentThreat
      && this.obs.self.scouts.filter((item) => item.alive).length <= 1
    ) {
      this.scoutTimer = Math.min(this.scoutTimer, this.profile.aggressiveScoutWindow);
    }

    if (this.moveTimer <= 0 || this.stuckTimer > this.profile.stuckTrigger) {
      this.issueMovement(this.currentContext);
      this.moveTimer = this.rng.range(this.profile.moveReplanMin, this.profile.moveReplanMax) * (this.replanMult || 1);
      this.stuckTimer = 0;
    }
    this.steerActiveKoizumiOrbs(this.currentContext);

    if (this.scoutTimer <= 0 && !this.obs.self.scoutsDisabled) {
      if (this.shouldLaunchScout(this.currentContext, scoutPlan)) {
        const focusEst = this.currentContext?.focus || this.primaryEnemyEstimate();
        const zoneId = scoutPlan?.zoneId || this.pickScoutZoneId(this.obs.self.ships.main, focusEst);
        // 侦察目标点：看得见就奔可见处；看不见就奔 belief 占据图的最高概率(未排除)区——
        // 让侦察去"最该排查"的地方，系统化缩小可能区(类人搜索)。前出分离舰就近发出，最快覆盖。
        const peak = (focusEst && focusEst.visible) ? null : this.beliefPeak();
        const scoutAim = scoutPlan?.seekPoint || peak || focusEst;
        const scoutSourceKey = this.pickScoutSourceKey(zoneId, scoutAim);
        const seekPoint = scoutAim && Number.isFinite(scoutAim.x) ? { x: scoutAim.x, y: scoutAim.y } : null;
        // 侦察机也必须纳入能量预算。尤其是分离副舰，不能只因刚好攒够28点就立即花光，
        // 否则下一秒既无法机动，也无法使用自保技能。
        const scoutEnergyFloors = this.obs.self.flags.yukiFlagship
          ? { emergencyFloor: ST.yukiEmergencyFloor, normalFloor: ST.yukiNormalFloor, conserveFloor: ST.yukiConserveFloor }
          : { emergencyFloor: ST.emergencyFloor, normalFloor: ST.normalFloor, conserveFloor: ST.conserveFloor };
        const hasScoutReserve = this.allowEnergyCommit(
          scoutSourceKey,
          SCOUT_LAUNCH_COST,
          this.currentContext,
          scoutEnergyFloors,
        );
        const launched = hasScoutReserve
          && this.writeLaunchScout(zoneId, {
            fromShipKey: scoutSourceKey,
            seekPoint,
            patrolCenter: scoutPlan?.seekPoint || seekPoint,
            patrolRadius: scoutPlan?.patrolRadius,
            mission: scoutPlan?.mission,
          });
        if (launched && scoutPlan) {
          recordScoutDeployment(this.scoutDoctrine, scoutPlan, this.obs.time);
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
          at: this.obs.time,
        };
        if (launched) {
          if (scoutPlan) {
            this.scoutTimer = this.rng.range(scoutPlan.cadenceMin, scoutPlan.cadenceMax);
          } else if (this.currentContext?.scoutPriority > ST.highPriority || this.currentContext?.searchRequired || this.currentContext?.maxShipThreat > ST.highThreat) {
            this.scoutTimer = this.rng.range(ST.launchedUrgent[0], ST.launchedUrgent[1]);
          } else if (this.currentContext?.trackableIntel) {
            this.scoutTimer = this.rng.range(ST.launchedTrackable[0], ST.launchedTrackable[1]);
          } else if (this.currentContext?.conserveEnergy) {
            this.scoutTimer = this.rng.range(ST.launchedConserve[0], ST.launchedConserve[1]);
          } else {
            this.scoutTimer = this.rng.range(ST.launched[0], ST.launched[1]);
          }
        } else {
          this.scoutTimer = !hasScoutReserve
            ? this.obs.self.flags.yukiFlagship ? this.rng.range(ST.noEnergyYuki[0], ST.noEnergyYuki[1]) : this.rng.range(ST.noEnergy[0], ST.noEnergy[1])
            : this.currentContext?.emergencyCommit
              ? this.rng.range(ST.rejectedEmergency[0], ST.rejectedEmergency[1])
              : this.rng.range(ST.rejected[0], ST.rejected[1]);
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
          at: this.obs.time,
        };
        this.scoutTimer = this.obs.self.flags.yukiFlagship
          ? this.currentContext?.conserveEnergy ? this.rng.range(ST.holdYukiConserve[0], ST.holdYukiConserve[1]) : this.rng.range(ST.holdYuki[0], ST.holdYuki[1])
          : this.currentContext?.conserveEnergy ? this.rng.range(ST.holdConserve[0], ST.holdConserve[1]) : this.rng.range(ST.hold[0], ST.hold[1]);
      }
    }

    this.tryFlagshipSkill(this.currentContext);
    this.trySubSkill("sub1", this.currentContext);
    this.trySubSkill("sub2", this.currentContext);
    // 技能可能在本 tick 内显著消耗能量，立即降档，不能等下一轮改航才停止4档消耗。
    this.enforceEnergyThrottleCaps();
  }

  tryFlagshipSkill(context = this.currentContext) {
    const T = this.params.skills.flagshipTimers;
    if (this.flagshipTimer > 0) {
      return;
    }
    const estimate = context?.focus || this.primaryEnemyEstimate();
    const characterId = this.obs.self.loadout.main;
    const isHaruhi = characterId === "haruhi";
    if (!this.shouldCastFlagshipSkill(estimate, context)) {
      this.lastFlagshipDecision = {
        action: "hold",
        cast: false,
        at: this.obs.time,
        target: this.debugContact(estimate),
      };
      this.flagshipTimer = isHaruhi
        ? this.rng.range(T.haruhiHold[0], T.haruhiHold[1])
        : context?.conserveEnergy
          ? this.rng.range(T.conserveHold[0], T.conserveHold[1])
          : context?.skillAggression > T.aggressiveAbove
            ? this.rng.range(T.aggressiveHold[0], T.aggressiveHold[1])
            : this.rng.range(T.hold[0], T.hold[1]);
      return;
    }
    const ok = this.writeFlagshipSkill();
    this.lastFlagshipDecision = {
      action: ok ? "cast" : "retry",
      cast: ok,
      at: this.obs.time,
      target: this.debugContact(estimate),
    };
    this.flagshipTimer = ok
      ? isHaruhi
        // 与真实冷却对齐；两者每帧同步递减，冷却归零的同一帧立即进入下一次施放判断。
        ? Math.max(T.haruhiMinInterval, Number(this.obs.self.cooldowns.flagship) || 0)
        : (context?.skillAggression > T.aggressiveAbove ? this.rng.range(T.aggressiveCooldown[0], T.aggressiveCooldown[1]) : this.rng.range(T.cooldown[0], T.cooldown[1]))
      : isHaruhi
        ? this.rng.range(T.haruhiRetry[0], T.haruhiRetry[1])
        : context?.conserveEnergy
          ? this.rng.range(T.conserveRetry[0], T.conserveRetry[1])
          : context?.skillAggression > T.aggressiveAbove
            ? this.rng.range(T.aggressiveRetry[0], T.aggressiveRetry[1])
            : this.rng.range(T.retry[0], T.retry[1]);
  }

  trySubSkill(shipKey, context = this.currentContext) {
    const T = this.params.skills.subTimers;
    if (this.subTimers[shipKey] > 0) {
      return;
    }
    const ship = this.obs.self.ships[shipKey];
    if (!ship || !ship.alive || ship.attached) {
      this.lastSubSkillDecision[shipKey] = {
        action: "unavailable",
        cast: false,
        at: this.obs.time,
        target: null,
      };
      this.subTimers[shipKey] = this.rng.range(T.unavailable[0], T.unavailable[1]);
      return;
    }

    const estimate = context?.focus || this.primaryEnemyEstimate();
    if (!this.shouldCastSubSkill(ship, estimate, context)) {
      this.lastSubSkillDecision[shipKey] = {
        action: "hold",
        cast: false,
        at: this.obs.time,
        target: this.debugContact(estimate),
      };
      this.subTimers[shipKey] = context?.conserveEnergy
        ? this.rng.range(T.conserveHold[0], T.conserveHold[1])
        : context?.skillAggression > T.aggressiveAbove
          ? this.rng.range(T.aggressiveHold[0], T.aggressiveHold[1])
          : this.rng.range(T.hold[0], T.hold[1]);
      return;
    }
    let ok = false;
    if (ship.characterId === "future1096" && estimate && estimate.source !== "spawn" && (estimate.visible || estimate.age <= 1.6)) {
      // 1096 光线蓄力期间方向已经锁定；按公开的航向和航速预判 1.05 秒后的落点，
      // 避免高难度 AI 仍把固定射线瞄在移动目标的旧位置。
      const aim = predictCharacterSkillAim(
        estimate,
        this.params.features.skillAimLead ? T.future1096AimLead : 0,
        this.obs.world.size,
        this.safeRoutePadding(4),
      );
      ok = this.writeSubSkill(shipKey, {
        targetX: aim?.x ?? estimate.x,
        targetY: aim?.y ?? estimate.y,
      });
    } else if (ship.characterId === "tsuruya") {
      const zoneId = estimate?.zoneId || this.enemyIntel.searchZoneId || 5;
      ok = this.writeSubSkill(shipKey, { zoneId });
    } else {
      ok = this.writeSubSkill(shipKey);
    }
    this.lastSubSkillDecision[shipKey] = {
      action: ok ? "cast" : "retry",
      cast: ok,
      at: this.obs.time,
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
      ? ship.characterId === "haruhi"
        ? Math.max(T.haruhiMinInterval, Number(this.obs.self.cooldowns[shipKey]) || 0)
        : (context?.skillAggression > T.aggressiveAbove ? this.rng.range(T.aggressiveCooldown[0], T.aggressiveCooldown[1]) : this.rng.range(T.cooldown[0], T.cooldown[1]))
      : context?.conserveEnergy
        ? this.rng.range(T.conserveRetry[0], T.conserveRetry[1])
        : context?.skillAggression > T.aggressiveAbove
          ? this.rng.range(T.aggressiveRetry[0], T.aggressiveRetry[1])
          : this.rng.range(T.retry[0], T.retry[1]);
  }

  updateStuckState(dt) {
    const main = this.obs.self.ships.main;
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
    const S = this.params.mode.scores;
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
    const organizedInfiltration = Boolean(
      enemyBarrier?.active
      && context.barrierTactics?.infiltration?.shipKeys?.length,
    );
    if (mode === "recover") {
      return context.edgePressure * S.recover.edgePressure + (context.mainHull < S.recover.lowHullBelow ? S.recover.lowHull : 0);
    }
    if (mode === "harvest") {
      return context.energyRecoveryNeed * S.harvest.energyRecoveryNeed
        + (context.emergencyCommit ? S.harvest.emergencyCommit : S.harvest.noEmergency)
        + (context.dist > context.rangeRef * S.harvest.farRangeRatio ? S.harvest.far : S.harvest.near)
        + (context.intelSolid ? S.harvest.intelSolid : S.harvest.intelWeak)
        - context.pressureDrive * S.harvest.pressureDrive
        - context.isolatedTargetScore * S.harvest.isolatedTarget;
    }
    if (mode === "search") {
      return (context.searchRequired ? (context.focus.source === "spawn" ? S.search.spawn : S.search.required) : S.search.notRequired)
        + (context.intelSolid ? S.search.intelSolid : S.search.intelWeak)
        + (context.trackableIntel ? S.search.trackableIntel : 0)
        + context.encirclePressure * S.search.encirclePressure
        - context.energyRecoveryNeed * S.search.energyRecoveryNeed;
    }
    if (mode === "regroup") {
      return (context.overextended ? S.regroup.overextended : 0)
        + (context.defensivePressure ? S.regroup.defensivePressure : 0)
        + (ownBarrier && !ownBarrier.active ? S.regroup.ownBarrierDown : 0)
        + (context.barrierTactics?.incoming ? S.regroup.incomingBreaker : 0)
        + (context.energyRatio < S.regroup.lowEnergyBelow ? S.regroup.lowEnergy : 0)
        + (context.enemyBroadsideRisk ? S.regroup.enemyBroadsideRisk : 0)
        + context.energyRecoveryNeed * S.regroup.energyRecoveryNeed
        - context.counterCollapse * S.regroup.counterCollapse;
    }
    if (mode === "kite") {
      return (context.defensivePressure ? S.kite.defensivePressure : 0)
        + (ownBarrier && !ownBarrier.active ? S.kite.ownBarrierDown : 0)
        + (context.barrierTactics?.incoming ? S.kite.incomingBreaker : 0)
        + (rangeRatio < S.kite.closeRangeBelow ? S.kite.closeRange : 0)
        + (context.localAdvantage < S.kite.outnumberedBelow ? S.kite.outnumbered : 0)
        + (context.enemyArcDensity > 1 ? S.kite.enemyArc : 0)
        + context.maxShipThreat * S.kite.maxShipThreat
        + context.energyRecoveryNeed * S.kite.energyRecoveryNeed;
    }
    if (mode === "collapse") {
      return (context.killWindow ? S.collapse.killWindow : 0)
        + (barrierBreachWindow ? S.collapse.barrierBreachWindow : 0)
        + (organizedBreach ? S.collapse.organizedBreach : 0)
        + (context.barrierTactics?.infiltration?.phase === "commit" ? S.collapse.infiltrationCommit : 0)
        - (enemyBarrier?.active && !organizedBreach && !organizedInfiltration ? S.collapse.enemyBarrierUp : 0)
        + (context.localAdvantage > 1 ? S.collapse.advantage : 0)
        + (context.closeoutWindow ? S.collapse.closeoutWindow : 0) // 收尾窗口：强力倾向冲杀残敌
        + (context.intelSolid ? S.collapse.intelSolid : S.collapse.intelWeak)
        + (context.safeExchange ? S.collapse.safeExchange : 0)
        + context.isolatedTargetScore * S.collapse.isolatedTarget
        + context.counterCollapse * S.collapse.counterCollapse
        + (context.pressureDrive > S.collapse.pressureDriveAbove ? S.collapse.pressureDrive : 0)
        + context.energySurplus * S.collapse.energySurplus
        - context.energyRecoveryNeed * (context.closeoutWindow ? S.collapse.energyRecoveryCloseout : S.collapse.energyRecoveryNeed); // 收尾时不为省能放弃击杀
    }
    if (mode === "broadside") {
      return (context.broadsideWindow ? S.broadside.window : S.broadside.noWindow)
        + (ownBarrier?.active ? S.broadside.ownBarrierUp : 0)
        + (barrierBreachWindow ? S.broadside.barrierBreachWindow : 0)
        - (enemyBarrier?.active && !organizedBreach ? S.broadside.enemyBarrierUp : 0)
        + (context.localAdvantage > S.broadside.advantageAbove ? S.broadside.advantage : 0)
        + (context.killWindow ? S.broadside.killWindow : 0)
        + (context.arcAdvantage < S.broadside.arcDeficitBelow ? S.broadside.arcDeficit : 0)
        + (context.enemyBroadsideRisk ? S.broadside.enemyBroadsideRisk : 0)
        + context.energySurplus * S.broadside.energySurplus
        - context.energyRecoveryNeed * S.broadside.energyRecoveryNeed;
    }
    if (mode === "cutoff") {
      return (context.intelSolid ? S.cutoff.intelSolid : S.cutoff.intelWeak)
        + (context.barrierTactics?.infiltration?.phase === "stage" ? S.cutoff.infiltrationStage : 0)
        + (context.barrierTactics?.infiltration?.phase === "commit" ? S.cutoff.infiltrationCommit : 0)
        + (organizedBreach ? S.cutoff.organizedBreach : 0)
        + (rangeRatio > S.cutoff.rangeMin && rangeRatio < S.cutoff.rangeMax ? S.cutoff.inRange : 0)
        + (context.localAdvantage > S.cutoff.advantageAbove ? S.cutoff.advantage : 0)
        + (context.enemyArcDensity > S.cutoff.enemyArcAbove ? S.cutoff.enemyArc : 0)
        + (context.trackableIntel ? S.cutoff.trackableIntel : 0)
        + context.isolatedTargetScore * S.cutoff.isolatedTarget
        + context.energySurplus * S.cutoff.energySurplus
        - context.energyRecoveryNeed * S.cutoff.energyRecoveryNeed;
    }
    if (mode === "press") {
      return S.press.base
        + (barrierBreachWindow ? S.press.barrierBreachWindow : 0)
        + (organizedBreach ? S.press.organizedBreach : 0)
        + (context.barrierTactics?.infiltration?.phase === "commit" ? S.press.infiltrationCommit : 0)
        - (enemyBarrier?.active && !organizedBreach && !organizedInfiltration ? S.press.enemyBarrierUp : 0)
        + (context.closeoutWindow ? S.press.closeoutWindow : 0) // 收尾窗口：维持压制把残敌打死
        + (rangeRatio > S.press.farRangeAbove ? S.press.farRange : 0)
        + (context.localAdvantage > S.press.advantageAbove ? S.press.advantage : 0)
        - (context.defensivePressure && !context.winning ? S.press.defensivePressure : 0) // 占优时防御压力不削弱压制
        - (context.enemyBroadsideRisk ? S.press.enemyBroadsideRisk : 0)
        + (context.arcAdvantage > S.press.arcAdvantageAbove ? S.press.arcAdvantage : 0)
        + context.pressureDrive * S.press.pressureDrive
        + (context.trackableIntel ? S.press.trackableIntel : 0)
        + context.counterCollapse * S.press.counterCollapse
        + context.energySurplus * S.press.energySurplus
        - context.energyRecoveryNeed * (context.emergencyCommit || context.closeoutWindow ? S.press.energyRecoveryCommitted : S.press.energyRecoveryNeed);
    }
    return 0;
  }

  chooseMode(context) {
    const C = this.params.mode.choose;
    const ownBarrier = context.barrierTactics?.own;
    const forcedMode = context.edgePressure > C.recoverEdgePressure
      ? "recover"
      : ownBarrier && !ownBarrier.active && context.dist < context.rangeRef * C.ownBarrierDownRange && !context.winning
        ? context.detachedCount > 0 ? "regroup" : "kite"
      : context.barrierTactics?.incoming && !context.killWindow
        ? "kite"
      : context.barrierTactics?.enemy
        && !context.barrierTactics.enemy.active
        && context.barrierTactics.enemy.disabledRemaining > 0
        && context.intelSolid
        && context.mainHull > C.breachCollapseMinHull
        ? "collapse"
      // 收尾窗口下不强制去充能(harvest)——该把残局打完，否则双方都去充能拖成平局
      : (context.energyRecoveryNeed >= C.harvestRecoveryNeed || context.energyRatio < C.harvestEnergyBelow) && !context.emergencyCommit && !context.closeoutWindow && !context.focus.visible && context.dist > context.rangeRef * C.harvestMinRange
        ? "harvest"
      : context.shamisenHunt?.attack?.active
        && context.shamisenHunt.attack.isFocus
        && !context.shamisenHunt.attack.targetVisible
        ? "search"
      : context.searchRequired && context.focus.source === "spawn"
        ? "search"
        : null;
    if (forcedMode) {
      this.mode = forcedMode;
      this.modeTimer = this.rng.range(C.forcedHoldMin, forcedMode === "search" ? C.forcedHoldSearch : forcedMode === "harvest" ? C.forcedHoldHarvest : C.forcedHoldOther);
      return this.mode;
    }

    // 低血转防守——但若正占优(领先/敌濒覆灭)则不退，继续压制把对手打死，避免领先方陪跑成平局
    if (context.mainHull < C.lowHullBelow && context.dist < context.rangeRef * C.lowHullRange && !context.winning) {
      this.mode = context.detachedCount > 0 ? "regroup" : "kite";
      this.modeTimer = this.rng.range(C.lowHullHold[0], C.lowHullHold[1]);
      return this.mode;
    }
    if ((context.focus.visible || context.maxShipThreat > C.lowEnergyThreat) && context.energyRatio < C.lowEnergyBelow && context.dist < context.rangeRef * C.lowEnergyRange && !context.winning) {
      this.mode = "regroup";
      this.modeTimer = this.rng.range(C.lowEnergyHold[0], C.lowEnergyHold[1]);
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
    this.modeTimer = this.rng.range(
      bestMode === "collapse" || bestMode === "kite" || bestMode === "cutoff" ? C.holdMinShort : C.holdMinLong,
      bestMode === "regroup" || bestMode === "harvest" ? C.holdMaxLong : C.holdMaxShort,
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
      x: searchCenter.x + Math.cos(perp) * sweepOffset + this.rng.range(-spread * 0.14, spread * 0.14),
      y: searchCenter.y + Math.sin(perp) * sweepOffset + this.rng.range(-spread * 0.14, spread * 0.14),
    };
  }

  computeSearchAssignments(main, focus, searchCenter) {
    const basisAngle = Number.isFinite(focus?.angle)
      ? focus.angle
      : Math.atan2(searchCenter.y - main.y, searchCenter.x - main.x);
    const sideAngle = basisAngle + Math.PI * 0.5;
    const zoneSpan = this.obs.world.size / 3;
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
    const forwardReach = clamp(main.stats.range * (0.7 + pressure * 0.18) + uncertainty * 0.42, 190, 430);
    const wingReach = clamp(main.stats.range * 0.56 + uncertainty * 0.42 + pressure * 56, 165, 390);
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
    const D = this.params.detached.intelLead;
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
      const visionMargin = ship.stats.vision - enemyVision;
      const score = vitality.value
        + clamp(visionMargin / D.visionMarginScale, D.visionMarginMin, D.visionMarginMax)
        + clamp((ship.stats.vision - D.visionBase) / D.visionScale, 0, D.visionMax)
        + clamp((ship.stats.baseSpeed - D.speedBase) / D.speedScale, D.speedMin, D.speedMax)
        + (ship.characterId === "yuki" ? D.yukiBias : 0)
        + (ship.characterId === "asakura" ? D.asakuraBias : 0)
        + (ship.characterId === "future1096" ? D.future1096Bias : 0)
        + (context?.searchRequired || context?.trackableIntel ? D.searchBias : 0);
      if (score > bestScore) {
        bestScore = score;
        best = ship;
      }
    }
    return bestScore > D.minScore ? best : null;
  }

  detachedRetreatNeed(ship, enemyEstimate, context) {
    const D = this.params.detached.retreat;
    if (!ship || !ship.alive || !enemyEstimate || !context) {
      return 0;
    }
    const vitality = this.shipVitality(ship);
    const dist = distance(ship.x, ship.y, enemyEstimate.x, enemyEstimate.y);
    return clamp(
      (D.hpCeiling - vitality.hpRatio) * D.hpWeight
      + (D.energyCeiling - vitality.energyRatio) * D.energyWeight
      + (dist < ship.stats.range * D.closeRange ? D.close : 0)
      + (context.enemyBroadsideRisk ? D.enemyBroadsideRisk : 0)
      + (context.defensivePressure ? D.defensivePressure : 0),
      0,
      D.max,
    );
  }

  planDetachedRoles(main, enemyEstimate, context) {
    const detachedShips = [this.obs.self.ships.sub1, this.obs.self.ships.sub2].filter((ship) => ship.alive && !ship.attached);
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
      } else if (context?.barrierTactics?.infiltration?.shipKeys?.includes(ship.key)) {
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
    const ownVision = ship.stats.vision;
    const enemyVision = this.estimateVisionRange(enemyEstimate);
    const blindLower = enemyVision + 16;
    const blindUpper = ownVision - 8;
    const mainAngle = Math.atan2(mainTarget.y - enemyEstimate.y, mainTarget.x - enemyEstimate.x);
    const preferredRange = clamp(ship.stats.range * 0.9, 170, 380);
    const emergencyEscape = threat.overwhelmed || (threat.danger > 1.18 && role !== "intel");

    const barrierDirective = koizumiBarrierRoleDirective(
      ship,
      role,
      enemyEstimate,
      context?.barrierTactics,
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
            preferredRange: clamp(ship.stats.range * 1.08, 220, 420),
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
        score += candidateDist >= ship.stats.range * 0.72 && candidateDist <= ship.stats.range * 1.02 ? 0.4 : -0.16;
      } else if (role === "flank") {
        const rearBias = -Math.cos(shortestAngleDelta(candidateAngle, enemyEstimate.angle));
        score += clamp(spread / 1.4, 0, 0.98);
        score += candidateDist <= ship.stats.range * 0.9 ? 0.34 : 0;
        score += clamp(rearBias * 0.7, -0.18, 0.8);
      } else if (role === "front") {
        score += candidateDist < distance(mainTarget.x, mainTarget.y, enemyEstimate.x, enemyEstimate.y) - 16 ? 0.42 : -0.08;
        score += candidateDist <= ship.stats.range * 0.94 ? 0.3 : -0.12;
      }
      return score;
    };

    const pickBest = (candidates, exposureWeight = 1.18) => {
      let best = null;
      let bestScore = -Infinity;
      for (const item of candidates) {
        const candidate = {
          ...item,
          x: this.clampX(item.x, this.safeRoutePadding(10)),
          y: this.clampY(item.y, this.safeRoutePadding(10)),
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
      const safeRange = clamp(ship.stats.range * 1.04 + (0.6 - vitality.hpRatio) * 110, 220, 460);
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
      const strikeRange = clamp(ship.stats.range * 0.72, 130, 280);
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
      const screenRange = clamp(Math.max(enemyVision + 12, ship.stats.range * 0.78), 150, 320);
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
      const supportRange = clamp(ship.stats.range * 0.94, 180, 360);
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
    return this.params.features.advancedCounterplay;
  }

  incomingVisionWaveWillPurge(ships, buffDuration) {
    if (!this.usesAdvancedSkillCounterplay()) {
      return false;
    }
    const targets = ships.filter((ship) => ship?.alive);
    const state = this.obs.enemy.visionWave;
    const horizon = Math.max(0.2, Number(buffDuration) || 0);
    if (targets.length === 0 || !state) {
      return false;
    }

    const now = this.obs.time;
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
    const targets = this.ownShips();
    return this.incomingVisionWaveWillPurge(targets, meta?.duration || 6);
  }

  shouldDelaySubBuff(ship, meta) {
    if (!ship || !["koizumi", "kyon", "asakura", "shamisen"].includes(ship.characterId)) {
      return false;
    }
    const usefulDuration = meta?.duration || 6;
    return this.incomingVisionWaveWillPurge([ship], usefulDuration);
  }

  shouldCastFlagshipSkill(estimate, context = this.currentContext) {
    const K = this.params.skills.flagship;
    const main = this.obs.self.ships.main;
    const characterId = this.obs.self.loadout.main;
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
      ? { emergencyFloor: K.haruhiEmergencyFloor, normalFloor: K.haruhiNormalFloor, conserveFloor: K.haruhiConserveFloor }
      : { emergencyFloor: K.emergencyFloor, normalFloor: K.normalFloor, conserveFloor: K.conserveFloor };
    if (meta?.cost && !this.allowEnergyCommit("main", meta.cost, context, energyFloors)) {
      return false;
    }
    const dist = distance(main.x, main.y, estimate.x, estimate.y);
    if (characterId === "haruhi") {
      // 常驻支援集齐后，16秒团队强化本身仍值得尽快使用；不再等待接敌或距离条件。
      return true;
    }
    if (characterId === "future1096") {
      const form = this.obs.self.future1096Form;
      const hull = this.obs.self.hullRatio;
      const pressure = Number(context?.defensivePressure) || 0;
      const aggression = Number(context?.skillAggression) || 0;
      if (!form) {
        return Boolean(
          estimate.source !== "spawn"
          && (estimate.visible || estimate.age <= K.future1096OpenAge)
          && hull > K.future1096OpenHull
          && (aggression > K.future1096OpenAggression || context?.trackableIntel),
        );
      }
      if (form === "A") {
        return hull < K.future1096DefendHull || pressure > K.future1096DefendPressure || this.mode === "recover";
      }
      return hull > K.future1096AttackHull && pressure < K.future1096AttackPressure && aggression > K.future1096AttackAggression;
    }
    if (characterId === "tsuruya") {
      return this.obs.self.hullRatio < K.tsuruyaHull || (context?.skillAggression || 0) > K.tsuruyaAggression || (context?.combatUrgency || 0) > K.tsuruyaUrgency;
    }
    if (characterId === "asakura") {
      const now = this.obs.time;
      const visibleShips = this.obs.enemy.visible.filter((entity) => entity.kind === "ship");
      const teamBuffs = this.obs.enemy.visibleTeamBuffs;
      let visibleBuffRemaining = 0;
      if (visibleShips.length > 0) {
        visibleBuffRemaining = Math.max(
          0,
          teamBuffs.sponsorUntil - now,
          teamBuffs.haruhiBoostUntil - now,
          teamBuffs.visionWaveActiveUntil - now,
        );
        for (const ship of visibleShips) {
          visibleBuffRemaining = Math.max(
            visibleBuffRemaining,
            Number(ship.effects.reliableUntil || 0) - now,
            Number(ship.effects.bladeQueenUntil || 0) - now,
            ship.effects.nextShotDamageMultiplier > 1 ? K.asakuraChargedShotSeconds : 0,
          );
        }
      }

      const waveArrivalSeconds = dist / K.asakuraWaveSpeed;
      const canPurgeBeforeExpiry = visibleBuffRemaining > waveArrivalSeconds + K.asakuraPurgeMargin;
      const hasHiddenEnemyShip = this.obs.privileged.hasHiddenEnemyShip;
      const usefulSearchPulse = hasHiddenEnemyShip && Boolean(
        estimate.source === "radar"
        || (!estimate.visible && estimate.source !== "spawn" && estimate.age <= K.asakuraSearchAge)
        || context?.trackableIntel
        || (this.mode === "search" && (context?.searchRequired || context?.intelUrgency > K.asakuraSearchUrgency)),
      );
      return canPurgeBeforeExpiry || usefulSearchPulse;
    }
    return true;
  }

  shouldCastSubSkill(ship, estimate, context = this.currentContext) {
    const K = this.params.skills.sub;
    if (!ship || !ship.alive) {
      return false;
    }
    if (ship.characterId === "bunny_haruhi") return shouldTransformBunny(ship, estimate, context);
    const meta = skillMetaForCharacter(ship.characterId, "sub");
    if (this.shouldDelaySubBuff(ship, meta)) {
      return false;
    }
    if (meta?.cost && !this.allowEnergyCommit(ship, meta.cost, context, { emergencyFloor: K.emergencyFloor, normalFloor: K.normalFloor, conserveFloor: K.conserveFloor })) {
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
    const blockedByBarrier = barrierBlocksRangedAttack(enemyBarrier, ship, K.barrierBlockMargin);
    if (ship.characterId === "haruhi") {
      const shockRadius = this.obs.world.size / K.haruhiShockRadiusDivisor;
      const visibleEnemyShips = this.obs.enemy.visible.filter((enemyShip) => (
        enemyShip.kind === "ship"
        && distance(ship.x, ship.y, enemyShip.x, enemyShip.y) <= shockRadius + enemyShip.radius
      ));
      const visibleEnemyAircraft = this.obs.enemy.visible.filter((aircraft) => (
        aircraft.kind !== "ship"
        && distance(ship.x, ship.y, aircraft.x, aircraft.y) <= shockRadius + aircraft.radius
      ));
      const ownAircraftAtRisk = [...this.obs.self.scouts, ...this.obs.self.wingmen].filter((aircraft) => (
        aircraft.alive
        && distance(ship.x, ship.y, aircraft.x, aircraft.y) <= shockRadius + aircraft.radius
      )).length;
      const focusWillStayInRange = Boolean(
        estimate
        && estimate.source !== "spawn"
        && (estimate.visible || estimate.age <= K.haruhiFocusAge)
        && dist <= shockRadius * K.haruhiFocusRange,
      );
      const worthwhileAircraftPurge = visibleEnemyAircraft.length >= Math.max(2, ownAircraftAtRisk + 1);
      return Boolean(
        (focusWillStayInRange || visibleEnemyShips.length >= 2 || worthwhileAircraftPurge)
        && (((context?.skillAggression) || 0) > K.haruhiAggression || this.energyProfile(ship).high),
      );
    }
    if (ship.characterId === "koizumi") {
      if (assignedToBreach) {
        return Boolean(
          estimate
          && !ship.koizumiOrbActive
          && estimate.source !== "spawn"
          && (estimate.visible || estimate.age <= K.koizumiBreachAge)
          && breachDistance <= ship.stats.range * K.koizumiBreachRange,
        );
      }
      return Boolean(
        estimate
        && !ship.koizumiOrbActive
        && estimate.source !== "spawn"
        && (estimate.visible || estimate.age <= K.koizumiAge || context?.trackableIntel)
        && dist <= ship.stats.range * K.koizumiRange
        && (((context?.skillAggression) || 0) > K.koizumiAggression || this.energyProfile(ship).high),
      );
    }
    if (ship.characterId === "future1096") {
      if (blockedByBarrier) {
        return false;
      }
      return Boolean(
        estimate
        && estimate.source !== "spawn"
        && (estimate.visible || estimate.age <= K.future1096Age)
        && (((context?.skillAggression) || 0) > K.future1096Aggression || context?.emergencyCommit),
      );
    }
    if (ship.characterId === "kyon") {
      return ship.hp / Math.max(1, ship.maxHp) < K.kyonHull || Boolean(estimate && dist <= ship.stats.range * K.kyonRange);
    }
    if (ship.characterId === "tsuruya") {
      return Boolean(
        estimate
        && (estimate.visible || estimate.age <= K.tsuruyaAge)
        && (((context?.skillAggression) || 0) > K.tsuruyaAggression || (context?.trackableIntel)),
      );
    }
    if (ship.characterId === "yuki") {
      return (((context?.scoutPriority) || 0) > K.yukiScoutPriority || this.energyProfile(ship).high)
        && (!estimate || !estimate.visible || estimate.age > K.yukiVisibleAge || this.obs.self.scouts.length < K.yukiMinScouts);
    }
    if (ship.characterId === "asakura") {
      if (assignedToBreach) {
        return Boolean(
          estimate
          && (estimate.visible || estimate.age <= K.asakuraBreachAge)
          && breachDistance <= ship.stats.range * K.asakuraBreachRange,
        );
      }
      return Boolean(
        estimate
        && (estimate.visible || estimate.age <= K.asakuraAge)
        && dist <= ship.stats.range * K.asakuraRange
        && (((context?.skillAggression) || 0) > K.asakuraAggression || context?.killWindow || context?.combatUrgency > K.asakuraUrgency),
      );
    }
    if (ship.characterId === "shamisen") {
      if (blockedByBarrier) {
        return false;
      }
      return Boolean(
        estimate
        && (estimate.visible || estimate.age <= K.shamisenAge)
        && dist <= ship.stats.range * K.shamisenRange
        && (((context?.skillAggression) || 0) > K.shamisenAggression || context?.killWindow || this.energyProfile(ship).high),
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
    const preferredRange = clamp(main.stats.range * 0.88, 180, 340);

    const pickBest = (candidates, exposureWeight = 1) => {
      let best = null;
      let bestScore = -Infinity;
      for (const item of candidates) {
        const candidate = {
          ...item,
          x: this.clampX(item.x, this.safeRoutePadding()),
          y: this.clampY(item.y, this.safeRoutePadding()),
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
      const conserveRange = clamp(main.stats.range * 1.22, 240, 420);
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
      const retreatRange = clamp(main.stats.range * 1.16, 220, 420);
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
      const sideOffset = clamp(main.stats.range * 0.82, 180, 320);
      const rearOffset = clamp(main.stats.range * 0.24, 50, 130);
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
    if (!this.params.features.visionEngage) return target; // 旧版AI：不做视野收尾压近
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
      const pokeR = clamp(enemyVis * this.params.movement.engage.pokeVisionMult, enemyVis + 30, ship.stats.range * 0.95);
      const px = target.x - enemy.x;
      const py = target.y - enemy.y;
      const pOff = Math.hypot(px, py);
      if (pOff > 1 && Math.abs(pOff - pokeR) > 12 && pOff < ship.stats.range * 0.98) {
        const pk = pokeR / pOff;
        return {
          ...target,
          x: this.clampX(enemy.x + px * pk, this.safeRoutePadding()),
          y: this.clampY(enemy.y + py * pk, this.safeRoutePadding()),
        };
      }
    }
    const aggressive = combatRole && (mode === "press" || mode === "collapse" || mode === "broadside" || mode === "cutoff");
    if (!aggressive) return target;
    // 是否压近夺视野要judicious：常规敌人压近能吃到侧舷1.5倍密度，值得贴上去交火；
    // 但对手是阿虚(Kyon)旗舰时射界密度被抹平、贴脸纯比血厚——此时只有真正占优/收尾才压近，
    // 否则保持站位别一头扎进肉阵容被对耗(对抗实测的回归)。
    const enemyFlatDensity = this.obs.privileged.enemyHasKyonFlagship;
    const want = tactical.killWindow || tactical.emergencyCommit || tactical.winning
      || (enemyFlatDensity
        ? tactical.localAdvantage >= 1.05
        : (tactical.localAdvantage >= 0.82 || tactical.intelSolid));
    if (!want) return target;
    const vision = ship.stats.vision;
    const ox = target.x - enemy.x;
    const oy = target.y - enemy.y;
    const off = Math.hypot(ox, oy);
    if (off < 1) return target;
    const visionEngage = clamp(vision * 0.88, 90, Math.max(vision, 90));
    if (off <= visionEngage + 6) return target; // 已在视野内
    const k = visionEngage / off;
    return {
      ...target,
      x: this.clampX(enemy.x + ox * k, this.safeRoutePadding()),
      y: this.clampY(enemy.y + oy * k, this.safeRoutePadding()),
    };
  }

  issueShipRoute(ship, targetX, targetY, throttle, padding = this.obs.world.mapPadding) {
    if (!ship || !ship.alive || !ship.canControl) {
      return null;
    }
    if (this.obs.rules.bunnyStage) {
      const target = bunnyStageRoute(ship, { x: targetX, y: targetY }, this.currentContext?.focus, this.obs.time);
      targetX = target.x;
      targetY = target.y;
    }
    const tx = this.clampX(targetX, padding);
    const ty = this.clampY(targetY, padding);
    const requestedThrottle = clamp(throttle, 0.45, 1.2);
    // AI 的战术层以 >1 表示明确的超速意图；离散化后应进入前进4档，
    // 不能因为 1.04～1.18 在数值上更靠近标准巡航而丢掉脱困/追击加速。
    const th = this.energyAwareThrottleForShip(ship, requestedThrottle);
    let update = "new";

    if (!ship.route) {
      this.writeRoute(ship.key, tx, ty, th);
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
      this.writeRoute(ship.key, tx, ty, th);
      update = "reset";
    } else {
      this.writeThrottle(ship.key, th);
      this.writeRouteEndpoint(ship.key, tx, ty);
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
    const activeOrbs = [this.obs.self.ships.sub1, this.obs.self.ships.sub2].filter(
      (ship) => ship?.alive && ship.koizumiOrb?.phase === "active" && ship.canControl,
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
    const main = this.obs.self.ships.main;
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
    let shamisenHuntPlan = planShamisenHuntFormation({
      tactics: tactical.shamisenHunt,
      obs: this.obs,
      ships: this.ownShips(),
      main,
      focus: enemyEstimate,
      now: this.obs.time,
      padding: this.safeRoutePadding(12),
    });
    // 古泉盾的突破/渗透已有独立的精确策略。猎杀方先执行破盾战术，避免把“追标记”
    // 误解成无视能量圈硬冲；防守方的护卫阵型仍保持生效。
    if (shamisenHuntPlan?.kind === "attack" && tactical.barrierTactics?.enemy?.active) {
      shamisenHuntPlan = null;
    }
    // 脱离地图边缘优先于角色战术，否则后撤中的被猎杀舰可能被自己的护卫阵型钉在边界。
    if (tactical.edgePressure > 0.34) {
      shamisenHuntPlan = null;
    }
    if (shamisenHuntPlan) {
      for (const [shipKey, role] of Object.entries(shamisenHuntPlan.roles)) {
        detachedPlan.roles[shipKey] = role;
      }
      detachedPlan.intelLeadKey = shamisenHuntPlan.kind === "attack"
        ? shamisenHuntPlan.leadKey
        : null;
      detachedPlan.retreatKey = shamisenHuntPlan.kind === "defense"
        ? tactical.shamisenHunt?.defense?.huntedShipKey || null
        : null;
    }
    const debugPlan = {
      focus: this.debugContact(enemyEstimate),
      searchCenter: this.debugPoint(searchCenter),
      combatCenter: this.debugPoint(center),
      searchAssignments: this.debugPointMap(searchAssignments),
      sectorPlan: this.debugPointMap(sectorPlan),
      shamisenHuntPlan: shamisenHuntPlan
        ? {
            kind: shamisenHuntPlan.kind,
            phase: shamisenHuntPlan.phase,
            targetId: shamisenHuntPlan.targetId,
            blockerId: shamisenHuntPlan.blockerId,
            leadKey: shamisenHuntPlan.leadKey,
            points: this.debugPointMap(shamisenHuntPlan.points),
            roles: { ...shamisenHuntPlan.roles },
          }
        : null,
      detachedPlan: this.debugDetachedPlan(detachedPlan),
      orders: {},
      useSearchSectorPlan,
      shouldUseDetachedRoles: false,
    };
    const intelLeadShip = detachedPlan.intelLeadKey ? this.obs.self.ships[detachedPlan.intelLeadKey] : null;
    const barrierBreachWindow = Boolean(
      tactical.barrierTactics?.enemy
      && !tactical.barrierTactics.enemy.active
      && tactical.barrierTactics.enemy.disabledRemaining > 0,
    );
    let mainHeldForIntelLead = false;
    if (
      detachedPlan.intelLeadKey
      && !shamisenHuntPlan
      && !barrierBreachWindow
      && !tactical.killWindow
      && (!tactical.emergencyCommit || (intelLeadShip?.characterId === "yuki" && (enemyEstimate.visible || tactical.intelSolid)))
      && (mode !== "collapse" || (intelLeadShip?.characterId === "yuki" && (enemyEstimate.visible || tactical.intelSolid)))
    ) {
      const supportRange = clamp(
        main.stats.range * (tactical.trackableIntel || tactical.searchRequired ? 1.04 : 0.96) * (intelLeadShip?.characterId === "yuki" ? 1.18 : 1),
        240,
        intelLeadShip?.characterId === "yuki" ? 430 : 390,
      );
      const supportCandidate = {
        x: this.clampX(enemyEstimate.x - toward.x * supportRange - side.x * sign * 54, this.safeRoutePadding(8)),
        y: this.clampY(enemyEstimate.y - toward.y * supportRange - side.y * sign * 54, this.safeRoutePadding(8)),
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
    if (!mainHeldForIntelLead && !shamisenHuntPlan) {
      mainTarget = this.engageTarget(main, enemyEstimate, mainTarget, mode, tactical);
    }
    if (shamisenHuntPlan?.points?.main) {
      mainTarget = shamisenHuntPlan.points.main;
    }
    mainTarget = applyKoizumiBarrierMainStrategy({
      main,
      enemyEstimate,
      target: mainTarget,
      tactics: tactical.barrierTactics,
      worldSize: this.obs.world.size,
      padding: this.safeRoutePadding(14),
      flankSign: tactical.flankSign || 1,
    });
    const throttleShift = tactical.emergencyCommit
      ? 0.06 + tactical.energySurplus * 0.05
      : tactical.energySurplus * 0.05 - tactical.energyRecoveryNeed * 0.18;
    const throttleBand = (min, max) => {
      const adjustedMin = clamp(min + throttleShift, 0.52, 1.18);
      const adjustedMax = clamp(max + throttleShift, adjustedMin + 0.04, 1.2);
      return this.rng.range(adjustedMin, adjustedMax);
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
    if (shamisenHuntPlan?.throttles?.main) {
      const band = shamisenHuntPlan.throttles.main;
      mainThrottle = throttleBand(band.min, band.max);
    }
    const attachedBladeQueenActive = this.fleetMembers(main).some(
      (ship) => ship.alive && this.hasEffect(ship, "bladeQueenUntil"),
    );
    if (attachedBladeQueenActive) {
      mainThrottle = throttleForGear(4);
    } else if (
      tactical.barrierTactics?.incoming
      || (tactical.barrierTactics?.own && !tactical.barrierTactics.own.active)
      || (
        tactical.barrierTactics?.enemy?.active
        && (
          tactical.barrierTactics.breachShipKey === "main"
          || (
            tactical.barrierTactics.infiltration?.phase === "commit"
            && tactical.barrierTactics.infiltration.shipKeys.includes("main")
          )
        )
      )
    ) {
      mainThrottle = throttleForGear(4);
    } else if (
      tactical.barrierTactics?.infiltration?.phase === "stage"
      && tactical.barrierTactics.infiltration.shipKeys.includes("main")
    ) {
      mainThrottle = throttleForGear(3);
    }
    const mainIssued = this.issueShipRoute(
      this.obs.self.ships.main,
      mainTarget.x,
      mainTarget.y,
      mainThrottle,
      this.safeRoutePadding(mode === "recover" ? 24 : 0),
    );
    if (mainIssued) {
      debugPlan.orders.main = {
        shipKey: "main",
        role: shamisenHuntPlan?.roles?.main || mode,
        detached: false,
        target: this.debugPoint(mainTarget),
        throttle: mainIssued.throttle,
        padding: mainIssued.padding,
        update: mainIssued.update,
      };
    }

    const focus = mode === "search" ? searchCenter : enemyEstimate;
    const shouldUseDetachedRoles = this.obs.self.splitLevel > 0 && (Boolean(shamisenHuntPlan)
      || (
        !(sectorPlan && !tactical.intelSolid && !enemyEstimate.visible && tactical.trackableIntel)
        && (mode !== "search" || tactical.trackableIntel || tactical.intelSolid || tactical.focus.source !== "spawn")
      ));
    debugPlan.shouldUseDetachedRoles = shouldUseDetachedRoles;
    const routeDetachedShip = (ship) => {
      if (!ship || !ship.alive || ship.attached) {
        return;
      }
      const role = detachedPlan.roles[ship.key] || "fire";
      const laneSign = detachedPlan.laneSigns[ship.key] || sign;
      const huntPoint = shamisenHuntPlan?.points?.[ship.key];
      let directive = huntPoint
        ? {
            target: huntPoint,
            throttle: shamisenHuntPlan.throttles[ship.key] || { min: 0.9, max: 1.08 },
            role,
          }
        : this.computeDetachedDirective(ship, role, enemyEstimate, tactical, main, mainTarget, laneSign);
      if (!directive) {
        return;
      }
      if (!huntPoint && role !== "breach" && role !== "infiltrate") {
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
      if (!huntPoint && this.params.features.formationLeash && (role === "fire" || role === "flank" || role === "front") && main.alive) {
        const leash = clamp(main.stats.range * 0.40, 150, 235);
        const dxm = directive.target.x - main.x;
        const dym = directive.target.y - main.y;
        const dm = Math.hypot(dxm, dym);
        if (dm > leash) {
          directive.target = {
            ...directive.target,
            x: this.clampX(main.x + (dxm / dm) * leash, this.safeRoutePadding(8)),
            y: this.clampY(main.y + (dym / dm) * leash, this.safeRoutePadding(8)),
          };
        }
      }
      let throttleRange = directive.throttle;
      if (role === "escape") {
        throttleRange = { min: 1.04, max: 1.2 };
      } else if (role === "breach" || role === "infiltrate") {
        throttleRange = role === "breach"
          ? { min: 1.12, max: 1.2 }
          : tactical.barrierTactics?.infiltration?.phase === "commit"
            ? { min: 1.12, max: 1.2 }
            : { min: 0.94, max: 1.04 };
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
        this.hasEffect(ship, "bladeQueenUntil")
          ? throttleForGear(4)
          : throttleBand(throttleRange.min, throttleRange.max),
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

    if (this.obs.self.splitLevel >= 1 && this.obs.self.ships.sub1.alive) {
      if (shouldUseDetachedRoles) {
        routeDetachedShip(this.obs.self.ships.sub1);
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
                      : focus.x + this.rng.range(-250, 250),
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
                      : focus.y + this.rng.range(-250, 250),
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
        this.obs.self.ships.sub1,
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

    if (this.obs.self.splitLevel >= 2 && this.obs.self.ships.sub2.alive) {
      if (shouldUseDetachedRoles) {
        routeDetachedShip(this.obs.self.ships.sub2);
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
                      : focus.x + Math.cos(orbitAngle + Math.PI * 0.5) * this.rng.range(160, 300),
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
                      : focus.y + Math.sin(orbitAngle + Math.PI * 0.5) * this.rng.range(160, 300),
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
        this.obs.self.ships.sub2,
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
