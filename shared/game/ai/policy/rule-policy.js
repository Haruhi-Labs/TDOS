import { createPolicyProgram } from "./policy-program.js";
import { copyPlainData, freezePlainData } from "../../../data/plain-data.js";
// 规则策略：只通过端口读取观测、提交动作，数值来自参数表，随机取自分配的随机流。
// 本文件编排阶段并持有移动计划；情报、搜索、侦察和技能调度由各组件独占，启发式阶段读取策略上下文。
import { SCOUT_LAUNCH_COST } from "../../combat-rules.js";
import { normalizeAiDifficulty, resolveAiParams } from "../params/index.js";
import { ScoutDoctrine } from "./tactics/yuki-scout.js";
import { ObservationView } from "./observation-view.js";
import { IntelTracker } from "./intel-tracker.js";
import { SearchNavigation } from "./search-navigation.js";
import { SearchBelief } from "./belief.js";
import { characterDecisionInput } from "./characters/decision-view.js";
import { SkillDecisionCycle } from "./skill-decision-cycle.js";

export class RulePolicy {
  #program;
  #moveTimer;
  get moveTimer() { return this.#moveTimer; }
  #koizumiOrbSteerTimer;
  get koizumiOrbSteerTimer() { return this.#koizumiOrbSteerTimer; }
  #scoutTimer;
  get scoutTimer() { return this.#scoutTimer; }
  #modeTimer;
  get modeTimer() { return this.#modeTimer; }
  #mode;
  get mode() { return this.#mode; }
  #lastMainPos;
  get lastMainPos() { return this.#lastMainPos; }
  #stuckTimer;
  get stuckTimer() { return this.#stuckTimer; }
  #lastTacticalPlan;
  get lastTacticalPlan() { return this.#lastTacticalPlan; }
  #lastScoutDecision;
  get lastScoutDecision() { return this.#lastScoutDecision; }
  #lastSplitDecision;
  get lastSplitDecision() { return this.#lastSplitDecision; }
  #currentContext;
  get currentContext() { return this.#currentContext; }
  #paramSpec;
  get paramSpec() { return this.#paramSpec; }
  #params;
  get params() { return this.#params; }
  #profile;
  get profile() { return this.#profile; }
  #difficulty;
  get difficulty() { return this.#difficulty; }
  #reactionMult;
  get reactionMult() { return this.#reactionMult; }
  #replanMult;
  get replanMult() { return this.#replanMult; }
  #rng;
  get rng() { return this.#rng; }
  #port;
  get port() { return this.#port; }
  #seat;
  get seat() { return this.#seat; }
  ownShip(...args) { return this.#program.run("ownShip", ...args); }
  fleetMembers(...args) { return this.#program.run("fleetMembers", ...args); }
  fleetEnergy(...args) { return this.#program.run("fleetEnergy", ...args); }
  hasEffect(...args) { return this.#program.run("hasEffect", ...args); }
  clampX(...args) { return this.#program.run("clampX", ...args); }
  clampY(...args) { return this.#program.run("clampY", ...args); }
  zoneById(...args) { return this.#program.run("zoneById", ...args); }
  writeSplit(...args) { return this.#program.run("writeSplit", ...args); }
  writeThrottle(...args) { return this.#program.run("writeThrottle", ...args); }
  writeRoute(...args) { return this.#program.run("writeRoute", ...args); }
  writeRouteEndpoint(...args) { return this.#program.run("writeRouteEndpoint", ...args); }
  writeLaunchScout(...args) { return this.#program.run("writeLaunchScout", ...args); }
  writeScoutMission(...args) { return this.#program.run("writeScoutMission", ...args); }
  writeFlagshipSkill(...args) { return this.#program.run("writeFlagshipSkill", ...args); }
  writeSubSkill(...args) { return this.#program.run("writeSubSkill", ...args); }
  debugPoint(...args) { return this.#program.run("debugPoint", ...args); }
  debugPointMap(...args) { return this.#program.run("debugPointMap", ...args); }
  debugContact(...args) { return this.#program.run("debugContact", ...args); }
  debugThreatMap(...args) { return this.#program.run("debugThreatMap", ...args); }
  debugContext(...args) { return this.#program.run("debugContext", ...args); }
  debugDetachedPlan(...args) { return this.#program.run("debugDetachedPlan", ...args); }
  serializeDebugState(...args) { return this.#program.run("serializeDebugState", ...args); }
  zoneForPoint(...args) { return this.#program.run("zoneForPoint", ...args); }
  zoneCenter(...args) { return this.#program.run("zoneCenter", ...args); }
  safeRoutePadding(...args) { return this.#program.run("safeRoutePadding", ...args); }
  edgePressure(...args) { return this.#program.run("edgePressure", ...args); }
  stableNoise(...args) { return this.#program.run("stableNoise", ...args); }
  pointEdgeClearance(...args) { return this.#program.run("pointEdgeClearance", ...args); }
  arcDensityFromState(...args) { return this.#program.run("arcDensityFromState", ...args); }
  broadsideIntentAngle(...args) { return this.#program.run("broadsideIntentAngle", ...args); }
  contactHpRatio(...args) { return this.#program.run("contactHpRatio", ...args); }
  contactCombatValue(...args) { return this.#program.run("contactCombatValue", ...args); }
  shipCombatValue(...args) { return this.#program.run("shipCombatValue", ...args); }
  friendlyPowerAround(...args) { return this.#program.run("friendlyPowerAround", ...args); }
  enemyThreatAround(...args) { return this.#program.run("enemyThreatAround", ...args); }
  enemyIsolationScore(...args) { return this.#program.run("enemyIsolationScore", ...args); }
  estimateVisionRange(...args) { return this.#program.run("estimateVisionRange", ...args); }
  shipVitality(...args) { return this.#program.run("shipVitality", ...args); }
  shipThreatSnapshot(...args) { return this.#program.run("shipThreatSnapshot", ...args); }
  escapeTargetForShip(...args) { return this.#program.run("escapeTargetForShip", ...args); }
  evaluateArcExchange(...args) { return this.#program.run("evaluateArcExchange", ...args); }
  preferredFlankSign(...args) { return this.#program.run("preferredFlankSign", ...args); }
  energyProfile(...args) { return this.#program.run("energyProfile", ...args); }
  energyThrottleGearCap(...args) { return this.#program.run("energyThrottleGearCap", ...args); }
  energyAwareThrottleForShip(...args) { return this.#program.run("energyAwareThrottleForShip", ...args); }
  enforceEnergyThrottleCaps(...args) { return this.#program.run("enforceEnergyThrottleCaps", ...args); }
  energyRatioAfterSpend(...args) { return this.#program.run("energyRatioAfterSpend", ...args); }
  allowEnergyCommit(...args) { return this.#program.run("allowEnergyCommit", ...args); }
  selectEnemyFocus(...args) { return this.#program.run("selectEnemyFocus", ...args); }
  buildTacticalContext(...args) { return this.#program.run("buildTacticalContext", ...args); }
  splitUtilityForShip(...args) { return this.#program.run("splitUtilityForShip", ...args); }
  shouldSplit(...args) { return this.#program.run("shouldSplit", ...args); }
  scoreMode(...args) { return this.#program.run("scoreMode", ...args); }
  likelyProbeZoneId(...args) { return this.#program.run("likelyProbeZoneId", ...args); }
  pickScoutSourceKey(...args) { return this.#program.run("pickScoutSourceKey", ...args); }
  planScoutDeployment(...args) { return this.#program.run("planScoutDeployment", ...args); }
  shouldLaunchScout(...args) { return this.#program.run("shouldLaunchScout", ...args); }
  shouldReserveEnergyForHaruhiFlagship(...args) { return this.#program.run("shouldReserveEnergyForHaruhiFlagship", ...args); }
  characterSkillFacts(...args) { return this.#program.run("characterSkillFacts", ...args); }
  usesAdvancedSkillCounterplay(...args) { return this.#program.run("usesAdvancedSkillCounterplay", ...args); }
  incomingVisionWaveWillPurge(...args) { return this.#program.run("incomingVisionWaveWillPurge", ...args); }
  shouldDelayFlagshipBuff(...args) { return this.#program.run("shouldDelayFlagshipBuff", ...args); }
  shouldDelaySubBuff(...args) { return this.#program.run("shouldDelaySubBuff", ...args); }
  shouldCastFlagshipSkill(...args) { return this.#program.run("shouldCastFlagshipSkill", ...args); }
  shouldCastSubSkill(...args) { return this.#program.run("shouldCastSubSkill", ...args); }
  chooseDetachedIntelLead(...args) { return this.#program.run("chooseDetachedIntelLead", ...args); }
  detachedRetreatNeed(...args) { return this.#program.run("detachedRetreatNeed", ...args); }
  planDetachedRoles(...args) { return this.#program.run("planDetachedRoles", ...args); }
  computeDetachedDirective(...args) { return this.#program.run("computeDetachedDirective", ...args); }
  combatCenter(...args) { return this.#program.run("combatCenter", ...args); }
  computeRecoveryTarget(...args) { return this.#program.run("computeRecoveryTarget", ...args); }
  computeSearchTarget(...args) { return this.#program.run("computeSearchTarget", ...args); }
  computeSearchAssignments(...args) { return this.#program.run("computeSearchAssignments", ...args); }
  computeSectorEncirclement(...args) { return this.#program.run("computeSectorEncirclement", ...args); }
  computeMainTarget(...args) { return this.#program.run("computeMainTarget", ...args); }
  engageTarget(...args) { return this.#program.run("engageTarget", ...args); }
  issueShipRoute(...args) { return this.#program.run("issueShipRoute", ...args); }


  #observationView = new ObservationView();
  ownShips() { return this.#observationView.ships(this.obs); }
  ownShipById(id) { return this.#observationView.ship(this.obs, id); }
  get visibleIds() { return this.#observationView.visible(this.obs); }

  #search;
  get searchZoneId() { return this.#search.state.zoneId; }
  get searchSweepSign() { return this.#search.state.sweepSign; }
  #searchInput(main, focus) {
    const peak = focus?.visible && focus.zoneId ? null : this.beliefPeak();
    return {
      main, focus, peak, peakZoneId: peak ? this.zoneForPoint(peak.x, peak.y)?.id : null,
      zones: this.obs.world.zones, now: this.obs.time,
      arrivalRadius: this.#profile.searchArrivalRadius, advanceWindow: this.#profile.searchAdvanceWindow,
    };
  }
  acquireSearchCenter(main, focus = null) {
    return this.#search.planCenter(this.#searchInput(main, focus)).point;
  }
  advanceSearchCenter(main, focus) {
    return this.#search.consume(this.#search.planCenter(this.#searchInput(main, focus))).point;
  }
  #scoutSearchPlan(main, enemyEstimate) {
    const focus = enemyEstimate || this.primaryEnemyEstimate();
    const probeZoneId = focus?.zoneId ? this.likelyProbeZoneId(focus) : null;
    const input = focus?.zoneId && (focus.visible || focus.age <= 12)
      ? { focus } : this.#searchInput(main, focus);
    return this.#search.planScout({
      ...input, probeZoneId,
      visibleNoise: focus?.visible ? this.stableNoise(Math.round(this.obs.time * 10), focus.zoneId) : 1,
      recentNoise: !focus?.visible && probeZoneId ? this.stableNoise(Math.round(this.obs.time * 8), probeZoneId) : 1,
    });
  }
  pickScoutZoneId(main, focus = null) { return this.#scoutSearchPlan(main, focus).zoneId; }
  #selectScoutZone(main, focus) { return this.#search.consume(this.#scoutSearchPlan(main, focus)).zoneId; }

  chooseMode(context) {
    const result = this.#program.run("planMode", context);
    this.#mode = result.mode; this.#modeTimer = result.modeTimer;
    return this.#mode;
  }
  evaluateSplit(...args) { this.#lastSplitDecision = freezePlainData(copyPlainData(this.#program.run("executeSplit", ...args))); }
  updateStuckState(dt) {
    const result = this.#program.run("sampleStuckState", dt);
    this.#stuckTimer = result.stuckTimer; this.#lastMainPos = freezePlainData(copyPlainData(result.lastMainPos));
  }
  steerActiveKoizumiOrbs(context = this.#currentContext) {
    const timer = this.#program.run("executeOrbSteering", context);
    if (timer !== undefined) this.#koizumiOrbSteerTimer = timer;
  }
  issueMovement(context = this.#currentContext) {
    const result = this.#program.run("executeMovement", context);
    if (result) this.#lastTacticalPlan = freezePlainData(copyPlainData(result));
  }

  scheduleDecision(kind, delay) {
    if (!Number.isFinite(delay)) throw new Error("策略调度时间必须有限");
    if (kind === "movement") this.#moveTimer = delay;
    else if (kind === "orb") this.#koizumiOrbSteerTimer = delay;
    else if (kind === "scout") this.#scoutTimer = delay;
    else if (kind === "mode") this.#modeTimer = delay;
    else throw new Error("未知的策略调度类别");
  }
  pinMode(mode, duration) {
    if (!["harvest", "regroup", "kite", "collapse", "broadside", "cutoff", "press", "recover", "search"].includes(mode)) throw new Error("未知的战术模式");
    this.#mode = mode; this.scheduleDecision("mode", duration);
  }

  #skillCycle;
  #intel;
  #belief;
  #scouting = new ScoutDoctrine();
  get scoutDoctrine() { return this.#scouting.snapshot; }
  get rememberedMain() { return this.#intel.main; }
  get rememberedContacts() { return this.#intel.contacts; }
  get knownContactCount() { return this.#intel.contactCount; }
  get pendingContactCount() { return this.#intel.pendingCount; }

  // port 是 AI 与对局之间的唯一通道：port.observe() 读取观测，port.submit(action) 提交动作。
  // params 指定难度、预设与覆盖：{ difficulty, preset, overrides }。
  constructor(port, { rng, params } = {}) {
    const commands = Object.freeze({ submit: (action) => port.submit(action) });
    this.#program = createPolicyProgram((key) => key === "port" ? commands : this[key], (key, args) => this[key](...args));
    this.#port = port;
    this.#seat = port.seat;
    // 每席 AI 使用对局分配的随机流；未带种子的对局里它就是环境随机源。
    this.#rng = Object.freeze({ range: (...args) => rng.range(...args) });
    // 决策用到的全部数值都来自参数表；难度与旧版对照是其上的覆盖层。
    this.#paramSpec = freezePlainData(copyPlainData({ difficulty: "master", preset: null, overrides: null, ...(params || {}) }));
    this.applyParamSpec();

    this.#moveTimer = 0;
    this.#koizumiOrbSteerTimer = 0;
    this.#scoutTimer = this.obs.self.flags.yukiFlagship ? 0.55 : this.#profile.initialScoutTimer;
    // 春日第一次立即检查；其余角色保持原开局观察窗。
    this.#skillCycle = new SkillDecisionCycle({
      flagship: this.obs.self.loadout.main === "haruhi" ? 0 : this.#profile.initialFlagshipTimer,
      sub1: this.#profile.initialSubTimers.sub1, sub2: this.#profile.initialSubTimers.sub2,
      now: this.obs.time,
    });
    this.#modeTimer = 0;
    this.#mode = "press";

    this.#lastMainPos = freezePlainData(copyPlainData({
      x: this.obs.self.ships.main.x,
      y: this.obs.self.ships.main.y,
    }));
    this.#stuckTimer = 0;

    const enemyMain = this.#port.enemySpawn();
    const spawnZone = this.zoneForPoint(enemyMain.x, enemyMain.y);
    this.#search = new SearchNavigation(spawnZone.id, this.obs.time);
    this.#intel = new IntelTracker({
      observe: () => this.obs,
      parameters: () => ({ params: this.#params, profile: this.#profile, reactionMult: this.#reactionMult }),
      contactZone: (zoneId) => this.#search.contact(zoneId),
    }, enemyMain);
    // 情报占据图(belief)：像人一样推理敌人位置——持续预测(向外扩散可能区)、排除(己方视野
    // 看过且无敌的区清零)、缩小到最高概率未排除区去搜。初始以敌出生点为峰。
    this.#belief = new SearchBelief(this.obs.world.size, enemyMain);
    this.#lastTacticalPlan = freezePlainData(copyPlainData({
      focus: this.debugContact(this.rememberedMain),
      searchCenter: this.debugPoint(this.zoneCenter(spawnZone.id)),
      combatCenter: null,
      searchAssignments: null,
      sectorPlan: null,
      detachedPlan: null,
      orders: {},
      useSearchSectorPlan: false,
      shouldUseDetachedRoles: false,
    }));
    this.#lastScoutDecision = freezePlainData(copyPlainData({
      action: "idle",
      zoneId: spawnZone.id,
      launched: false,
      urgent: false,
      at: this.obs.time,
    }));
    this.#lastSplitDecision = freezePlainData(copyPlainData({
      attempt1: false,
      attempt2: false,
      acted: [],
      level: this.obs.self.splitLevel,
      at: this.obs.time,
    }));
  }

  get flagshipTimer() { return this.#skillCycle.timers.flagship; }
  get subTimers() {
    const { sub1, sub2 } = this.#skillCycle.timers;
    return Object.freeze({ sub1, sub2 });
  }
  get lastFlagshipDecision() { return this.#skillCycle.decisions.flagship; }
  get lastSubSkillDecision() {
    const { sub1, sub2 } = this.#skillCycle.decisions;
    return Object.freeze({ sub1, sub2 });
  }
  scheduleSkillDecision(key, delay) { this.#skillCycle.schedule(key, delay); }

  tryFlagshipSkill(context = this.#currentContext) {
    if (this.flagshipTimer > 0) return;
    const estimate = context?.focus || this.primaryEnemyEstimate();
    this.#skillCycle.tryFlagship(characterDecisionInput({
      T: this.#params.skills.flagshipTimers, now: this.obs.time,
      characterId: this.obs.self.loadout.main, estimate, context,
    }), {
      shouldCast: () => this.shouldCastFlagshipSkill(estimate, context),
      cast: () => this.writeFlagshipSkill(),
      cooldown: () => this.obs.self.cooldowns.flagship,
      randomRange: (min, max) => this.#rng.range(min, max),
      describeTarget: (target) => this.debugContact(target),
    });
  }

  trySubSkill(shipKey, context = this.#currentContext) {
    if (this.subTimers[shipKey] > 0) return;
    const ship = this.obs.self.ships[shipKey];
    // 不可用分支不读取情报，保留原判定次序。
    const estimate = ship?.alive && !ship.attached ? context?.focus || this.primaryEnemyEstimate() : null;
    const replanMovement = this.#skillCycle.trySub(characterDecisionInput({
      T: this.#params.skills.subTimers, now: this.obs.time, shipKey, ship, estimate, context,
      facts: ship ? this.characterSkillFacts(ship) : null,
    }), {
      shouldCast: () => this.shouldCastSubSkill(ship, estimate, context),
      cast: (target) => target ? this.writeSubSkill(shipKey, target) : this.writeSubSkill(shipKey),
      cooldown: () => this.obs.self.cooldowns[shipKey],
      randomRange: (min, max) => this.#rng.range(min, max),
      describeTarget: (target) => this.debugContact(target),
    });
    if (replanMovement) {
      // 破盾成功的同一帧重规划冲撞和能量球，不能等常规改航周期。
      this.#moveTimer = 0;
      this.#koizumiOrbSteerTimer = 0;
    }
  }

  predictEnemyVector(...args) { return this.#intel.predictEnemyVector(...args); }
  projectContact(...args) { return this.#intel.projectContact(...args); }
  rememberContact(...args) { return this.#intel.rememberContact(...args); }
  refreshIntel(...args) { return this.#intel.refreshIntel(...args); }
  primaryEnemyEstimate(...args) { return this.#intel.primaryEnemyEstimate(...args); }
  knownEnemyContacts(...args) { return this.#intel.knownEnemyContacts(...args); }

  updateBelief(dt) {
    this.#belief.update(dt, {
      observation: this.obs, indirectIntel: this.#params.features.indirectIntel,
      contacts: this.rememberedContacts, main: this.rememberedMain,
      projectContact: (contact, lead) => this.#intel.projectContact(contact, lead),
    });
  }
  beliefPeak() { return this.#belief.peak(); }
  beliefZoneWeights() { return this.#belief.zoneWeights(this.obs.world.zones); }

  planYukiDeployment(input) { return this.#scouting.plan(input); }
  retaskYukiCombatScouts(plan) {
    return this.#scouting.retask(plan, {
      now: this.obs.time, scouts: this.obs.self.scouts, zones: this.obs.world.zones,
    }, (id, options) => this.writeScoutMission(id, options));
  }

  get obs() {
    return this.#port.observe();
  }

  applyParamSpec() {
    this.#params = resolveAiParams(this.#paramSpec);
    this.#profile = this.#params.profile;
    this.#difficulty = normalizeAiDifficulty(this.#paramSpec.difficulty);
    this.#reactionMult = this.#params.difficulty.reactionMult;
    this.#replanMult = this.#params.difficulty.replanMult;
  }

  // 只切换 AI 决策参数的难度覆盖层；数值缩放等让分由对局在构造时写入舰队。
  setDifficulty(level) {
    this.#paramSpec = freezePlainData(copyPlainData({ ...this.#paramSpec, difficulty: level }));
    this.applyParamSpec();
    return this;
  }

  // 旧版 AI 对照：等价于启用 legacy 预设。
  get legacy() {
    return this.#paramSpec.preset === "legacy";
  }

  set legacy(value) {
    this.#paramSpec = freezePlainData(copyPlainData({ ...this.#paramSpec, preset: value ? "legacy" : null }));
    this.applyParamSpec();
  }

  // 控制变量对照：关闭间接情报。
  get noIndirectIntel() {
    return !this.#params.features.indirectIntel;
  }

  set noIndirectIntel(value) {
    const overrides = this.#paramSpec.overrides || {};
    this.#paramSpec = freezePlainData(copyPlainData({
      ...this.#paramSpec,
      overrides: { ...overrides, features: { ...overrides.features, indirectIntel: !value } },
    }));
    this.applyParamSpec();
  }

  update(dt, elapsed) {
    const ST = this.#params.scout.timers;
    this.#moveTimer -= dt;
    this.#koizumiOrbSteerTimer -= dt;
    this.#scoutTimer -= dt;
    this.#skillCycle.advance(dt);
    this.#modeTimer -= dt;

    this.refreshIntel();
    this.updateBelief(dt);
    this.updateStuckState(dt);
    const main = this.obs.self.ships.main;
    const focus = main.alive ? this.selectEnemyFocus(main) : null;
    this.#currentContext = freezePlainData(copyPlainData(main.alive && focus ? this.buildTacticalContext(main, focus) : null));
    this.evaluateSplit(elapsed, this.#currentContext);
    this.enforceEnergyThrottleCaps();
    const scoutPlan = this.#scouting.selectPlan({
      enabled: this.obs.self.flags.yukiFlagship, now: this.obs.time,
      scoutDue: this.#scoutTimer <= 0, refreshInterval: ST.planRefresh,
    }, () => this.planScoutDeployment(this.#currentContext));
    const retaskedScouts = this.retaskYukiCombatScouts(scoutPlan);

    if (
      this.#currentContext
      && this.#currentContext.intelUrgency > ST.urgentIntel
      && this.obs.self.scouts.filter((item) => item.alive).length === 0
    ) {
      this.#scoutTimer = Math.min(this.#scoutTimer, this.#profile.aggressiveScoutWindow);
    }

    if (
      this.#currentContext
      && this.#currentContext.maxShipThreat > ST.urgentThreat
      && this.obs.self.scouts.filter((item) => item.alive).length <= 1
    ) {
      this.#scoutTimer = Math.min(this.#scoutTimer, this.#profile.aggressiveScoutWindow);
    }

    if (this.#moveTimer <= 0 || this.#stuckTimer > this.#profile.stuckTrigger) {
      this.issueMovement(this.#currentContext);
      this.#moveTimer = this.#rng.range(this.#profile.moveReplanMin, this.#profile.moveReplanMax) * (this.#replanMult || 1);
      this.#stuckTimer = 0;
    }
    this.steerActiveKoizumiOrbs(this.#currentContext);

    if (this.#scoutTimer <= 0 && !this.obs.self.scoutsDisabled) {
      if (this.shouldLaunchScout(this.#currentContext, scoutPlan)) {
        const focusEst = this.#currentContext?.focus || this.primaryEnemyEstimate();
        const zoneId = scoutPlan?.zoneId || this.#selectScoutZone(this.obs.self.ships.main, focusEst);
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
          this.#currentContext,
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
          this.#scouting.deployed(scoutPlan, this.obs.time);
        }
        this.#lastScoutDecision = freezePlainData(copyPlainData({
          action: launched ? "launch" : hasScoutReserve ? "retry" : "hold-energy",
          zoneId,
          launched,
          urgent: Boolean(this.#currentContext?.emergencyCommit || this.#currentContext?.searchRequired || this.#currentContext?.trackableIntel),
          doctrineMode: scoutPlan?.mode || null,
          mission: scoutPlan?.mission || null,
          primaryZoneId: scoutPlan?.primaryZoneId || null,
          predictedZoneId: scoutPlan?.predictedZoneId || null,
          retasked: retaskedScouts,
          at: this.obs.time,
        }));
        if (launched) {
          if (scoutPlan) {
            this.#scoutTimer = this.#rng.range(scoutPlan.cadenceMin, scoutPlan.cadenceMax);
          } else if (this.#currentContext?.scoutPriority > ST.highPriority || this.#currentContext?.searchRequired || this.#currentContext?.maxShipThreat > ST.highThreat) {
            this.#scoutTimer = this.#rng.range(ST.launchedUrgent[0], ST.launchedUrgent[1]);
          } else if (this.#currentContext?.trackableIntel) {
            this.#scoutTimer = this.#rng.range(ST.launchedTrackable[0], ST.launchedTrackable[1]);
          } else if (this.#currentContext?.conserveEnergy) {
            this.#scoutTimer = this.#rng.range(ST.launchedConserve[0], ST.launchedConserve[1]);
          } else {
            this.#scoutTimer = this.#rng.range(ST.launched[0], ST.launched[1]);
          }
        } else {
          this.#scoutTimer = !hasScoutReserve
            ? this.obs.self.flags.yukiFlagship ? this.#rng.range(ST.noEnergyYuki[0], ST.noEnergyYuki[1]) : this.#rng.range(ST.noEnergy[0], ST.noEnergy[1])
            : this.#currentContext?.emergencyCommit
              ? this.#rng.range(ST.rejectedEmergency[0], ST.rejectedEmergency[1])
              : this.#rng.range(ST.rejected[0], ST.rejected[1]);
        }
      } else {
        this.#lastScoutDecision = freezePlainData(copyPlainData({
          action: "hold",
          zoneId: this.searchZoneId || null,
          launched: false,
          urgent: false,
          doctrineMode: scoutPlan?.mode || null,
          mission: scoutPlan?.mission || null,
          primaryZoneId: scoutPlan?.primaryZoneId || null,
          predictedZoneId: scoutPlan?.predictedZoneId || null,
          retasked: retaskedScouts,
          at: this.obs.time,
        }));
        this.#scoutTimer = this.obs.self.flags.yukiFlagship
          ? this.#currentContext?.conserveEnergy ? this.#rng.range(ST.holdYukiConserve[0], ST.holdYukiConserve[1]) : this.#rng.range(ST.holdYuki[0], ST.holdYuki[1])
          : this.#currentContext?.conserveEnergy ? this.#rng.range(ST.holdConserve[0], ST.holdConserve[1]) : this.#rng.range(ST.hold[0], ST.hold[1]);
      }
    }

    this.tryFlagshipSkill(this.#currentContext);
    this.trySubSkill("sub1", this.#currentContext);
    this.trySubSkill("sub2", this.#currentContext);
    // 技能可能在本 tick 内显著消耗能量，立即降档，不能等下一轮改航才停止4档消耗。
    this.enforceEnergyThrottleCaps();
  }
}
