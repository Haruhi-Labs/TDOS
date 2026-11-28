import { resolveBattleMode } from "./battle-mode.js";
import { CHARACTER_ASSEMBLY } from "../characters/assembly/character-assembly.js";
import { createMatchFeedback } from "./match-feedback.js";
import { resolveShipDestruction } from "../characters/interactions/ship-destruction.js";
import { createProjectilePhase } from "../characters/interactions/projectile-phase.js";
import { ProjectileSystem } from "../systems/projectile-system.js";
import { Projectile } from "../model/projectile.js";
import { createHullCollisionPort } from "../adapters/collision-port.js";
import { createHostileView } from "../adapters/combat-targets.js";
import { createBattleStateProjector } from "../projection/battle-state.js";
import { buildVictoryFacts, validateModeOutcome } from "../rules/side-outcome.js";
// 权威对局的装配与阶段编排。
import { DEFAULT_MAP_PADDING, DEFAULT_WORLD_SIZE, TICK_DT } from "../foundation/constants.js";
import { buildZones, clamp } from "../foundation/math.js";
import { createAmbientRng, createSeededRng } from "../foundation/rng.js";
import { createAiRunner } from "../ai/bridge/runner.js";
import { aiHandicapFor, validateAiParamsForSeats } from "../ai/params/index.js";
import { applyMatchAction } from "./action-dispatcher.js";
import { resolveScoutClashes as resolveMatchScoutClashes, HullCollisionSystem } from "../systems/collision-system.js";
import { createVisionWavePurgePort } from "../characters/asakura/vision-wave-port.js";
import { MatchTelemetry } from "./match-telemetry.js";
import { FloatingText } from "../model/floating-text.js";
import { Burst } from "../model/burst.js";
import { Team } from "../model/team.js";
import { normalizeAiSeats, nextEntityId } from "../model/model-support.js";
import {
  createFleetRegistry,
  createSeatAiRngMap,
  createSeatSwitchBoard,
  dispatchSeatAction,
  runBattleUpdatePhases,
} from "./fleet-registry.js";

// 战斗世界消费只读时间样本；不持有或推进权威时钟。
export class BattleRuntime {
  #readTime;
  get elapsed() { return this.#readTime().elapsed; }
  get tick() { return this.#readTime().tick; }
  #characters;
  #modeRules;
  #battleMode;
  #formatId;
  #outcomeShape;
  #isFleetAlive;
  #stateProjector;
  #projectionSource;
  #isLegacyAbTopology;
  #registry;
  #hostileViews;
  #outcome = Object.freeze({ phase: "running", winnerSeat: null, outcome: null });
  #feedback;
  #projectiles = new ProjectileSystem((profile) => new Projectile(profile));
  #hullCollisions = new HullCollisionSystem();
  #telemetry;
  #combatSwitches;
  #aiSwitches;
  #phasePort;

  get phase() { return this.#outcome.phase; }
  get winnerSeat() { return this.#outcome.winnerSeat; }
  get outcome() { return this.#outcome.outcome; }
  get endReason() { return this.#outcome.endReason; }
  get battleMode() { return this.#battleMode; }
  get formatId() { return this.#formatId; }
  get projectiles() { return this.#projectiles.items; }
  get combatEnabled() { return this.#combatSwitches.snapshot; }
  get aiEnabled() { return this.#aiSwitches.snapshot; }
  get teamA() { return this.#registry.teamBySeat("A"); }
  get teamB() { return this.#registry.teamBySeat("B"); }
  get seatOrder() { return this.#registry.seatOrder; }
  get relations() { return this.#registry.relations; }
  constructor(options, readTime) {
    this.#readTime = readTime;
    const {
      mode,
      battleMode,
      formatId,
      aiSeats,
      tutorialMode,
      rules,
      outcomeShape,
      stateSchema,
      isFleetAlive,
      topology,
    } = resolveBattleMode(options);
    this.#modeRules = rules;
    this.#battleMode = battleMode;
    this.#formatId = formatId;
    this.#outcomeShape = outcomeShape;
    this.#isFleetAlive = isFleetAlive;
    this.#stateProjector = createBattleStateProjector(stateSchema);
    this.#telemetry = new MatchTelemetry(topology.seatOrder);
    const worldSize = Number.isFinite(options.worldSize) ? options.worldSize : DEFAULT_WORLD_SIZE;
    const mapPadding = Number.isFinite(options.mapPadding) ? options.mapPadding : DEFAULT_MAP_PADDING;
    const aiAutoBeam = Boolean(options.aiAutoBeam);

    this.rules = CHARACTER_ASSEMBLY.rules;
    this.shipEffects = CHARACTER_ASSEMBLY.shipEffects;
    this.projectShip = CHARACTER_ASSEMBLY.projectShip;
    this.createProjectilePhase = createProjectilePhase;
    this.visionWavePurgePort = createVisionWavePurgePort(this);
    this.mode = mode;
    this.worldSize = worldSize;
    this.mapPadding = mapPadding;
    this.aiAutoBeam = aiAutoBeam;
    this.aiSeats = aiSeats;
    this.tutorialMode = tutorialMode;
    this.zones = buildZones(worldSize);

    // 显式传入整数种子时整局可复现，规则与各席 AI 使用互不干扰的随机流；
    // 否则沿用环境随机源，取值顺序与全局 Math.random 一致。种子不进入快照。
    const seeded = Number.isInteger(options.seed);
    this.rng = seeded ? createSeededRng(options.seed) : createAmbientRng();
    this.aiRng = createSeatAiRngMap(this.rng, topology.seatOrder);
    this.entityIds = seeded ? { value: 1 } : null;

    this.#combatSwitches = createSeatSwitchBoard(topology.seatOrder, true);
    this.#aiSwitches = createSeatSwitchBoard(topology.seatOrder, true);

    const teams = topology.fleets.map((fleet) => new Team(
      this,
      fleet.seat,
      fleet.name,
      fleet.spawn.x,
      fleet.spawn.y,
      fleet.spawn.facing,
      {
        loadout: fleet.loadout,
        sideId: fleet.sideId,
        presentation: fleet.presentation,
      },
    ));
    this.#registry = createFleetRegistry(topology, teams);
    this.#isLegacyAbTopology = topology.seatOrder.length === 2
      && topology.seatOrder[0] === "A"
      && topology.seatOrder[1] === "B"
      && this.#registry.relations.areEnemies("A", "B");
    this.#hostileViews = new Map(
      topology.seatOrder.map((seat) => [seat, createHostileView(this.#registry, seat)]),
    );
    const runtime = this;
    this.#projectionSource = Object.freeze({
      get battleMode() { return runtime.#battleMode; },
      get formatId() { return runtime.#formatId; },
      get worldSize() { return runtime.worldSize; },
      get mode() { return runtime.mode; },
      get seatOrder() { return runtime.seatOrder; },
      get aiSeats() { return runtime.aiSeats; },
      get zones() { return runtime.zones; },
      get phase() { return runtime.phase; },
      get winnerSeat() { return runtime.winnerSeat; },
      get outcome() { return runtime.outcome; },
      get endReason() { return runtime.endReason; },
      get elapsed() { return runtime.elapsed; },
      get tick() { return runtime.tick; },
      get projectiles() { return runtime.projectiles; },
      get bursts() { return runtime.bursts; },
      get floatingTexts() { return runtime.floatingTexts; },
      get teamA() { return runtime.teamA; },
      get teamB() { return runtime.teamB; },
      allTeams: () => this.#registry.allTeams(),
      botBySeat: (seat) => this.botBySeat(seat),
      projectHeroPowers: () => this.#characters.projectHeroPowers(),
      serializeHuntKills: () => this.#feedback.serializeHuntKills(),
      serializeBarrierImpacts: () => this.#feedback.serializeBarrierImpacts(),
      serializeTelemetry: () => this.#telemetry.serialize(),
    });

    this.#phasePort = Object.freeze({
      allTeams: () => this.#registry.allTeams(),
      beforeAi: (dt) => this.#characters.advance("beforeAi", dt),
      isAiEnabled: (seat) => this.#aiSwitches.isEnabled(seat),
      runAi: (seat, dt) => {
        if (Object.hasOwn(this.aiRunners, seat) && this.aiRunners[seat]) {
          this.aiRunners[seat].update(dt, this.elapsed);
        }
      },
      updateTeam: (team, dt) => team.update(dt),
      afterTeams: (dt) => this.#characters.advance("afterTeams", dt),
      resolveShipCollisions: () => this.resolveShipCollisions(),
      afterHull: (dt) => this.#characters.advance("afterHull", dt),
      resolveScoutClashes: () => this.resolveScoutClashes(),
      beforeVisibility: (dt) => this.#characters.advance("beforeVisibility", dt),
      computeVisibility: (team) => team.computeVisibility(this.hostileView(team.seat)),
      beforeBeams: (dt) => this.#characters.advance("beforeBeams", dt),
      resolveChargedBeams: (team) => team.resolveChargedBeams(this.hostileView(team.seat)),
      isCombatEnabled: (seat) => this.#combatSwitches.isEnabled(seat),
      stepCombat: (team) => team.stepCombat(this.hostileView(team.seat)),
      updateProjectiles: (dt) => this.updateProjectiles(dt),
      updateVisualEffects: (dt) => this.updateVisualEffects(dt),
      afterVisuals: (dt) => this.#characters.advance("afterVisuals", dt),
      checkVictory: () => this.checkVictory(),
    });

    this.bursts = [];
    this.#feedback = createMatchFeedback({ now: () => this.elapsed, nextId: () => nextEntityId(this) });
    this.floatingTexts = [];
    this.#characters = CHARACTER_ASSEMBLY.createBattle(this);
    this.bots = {};
    this.aiRunners = {};
    // 旧版 AI 只用于调试对照，必须显式指定。不能沿用 aiSeats 的 mode=ai 默认值，
    // 否则单人模式会把唯一的 B 席 AI 悄悄降级为旧策略。
    const hasExplicitFleets = Object.hasOwn(options, "fleets") && options.fleets !== undefined;
    const legacyAiSeats = normalizeAiSeats("pvp", options.legacyAiSeats, topology.seatOrder, {
      legacyNormalize: !hasExplicitFleets,
    });
    const aiDifficulty = options.aiDifficulty || "master"; // 单人难度(默认满状态)
    validateAiParamsForSeats(options.aiParams, topology.seatOrder);
    for (const seat of this.aiSeats) {
      // aiParams 可按席位指定预设与参数覆盖：{ A: { preset, overrides } }。
      const seatParams = options.aiParams && Object.hasOwn(options.aiParams, seat) && options.aiParams[seat]
        ? options.aiParams[seat]
        : {};
      const runner = createAiRunner(this, seat, {
        params: {
          difficulty: seatParams.difficulty ?? aiDifficulty,
          preset: legacyAiSeats.includes(seat) ? "legacy" : seatParams.preset ?? null,
          overrides: seatParams.overrides ?? null,
        },
      });
      this.aiRunners[seat] = runner;
      this.bots[seat] = runner.policy;
      // 难度让分属于规则层：数值缩放与集火残血直接写入 AI 所控舰队，不经过 AI 决策。
      const handicap = aiHandicapFor(aiDifficulty);
      const team = this.teamBySeat(seat);
      if (!team) {
        throw new Error(`无法为未注册席位配置 AI 让分：${String(seat)}`);
      }
      team.configureAiHandicap(handicap);
      runner.port.invalidate();
    }
    this.botA = this.bots.A || null;
    this.bot = this.bots.B || null;
    // 模式只取得初始化需要的领域操作；不持有世界、时钟或终局写权限。
    this.#modeRules.initialize({
      worldSize,
      setTrainingDamageFloor: (seat, fraction) => {
        const team = this.teamBySeat(seat);
        if (!team) throw new Error(`未知训练席位：${String(seat)}`);
        team.setTrainingDamageFloor(fraction);
      },
      configureTrainingFleet: (seat, stats, positions) => {
        const team = this.teamBySeat(seat);
        if (!team) throw new Error(`未知训练席位：${String(seat)}`);
        team.configureTrainingFleet(stats, positions);
      },
      setCombatEnabled: (seat, enabled) => this.setCombatEnabled(seat, enabled),
      setAiEnabled: (seat, enabled) => this.setAiEnabled(seat, enabled),
    });
  }

  queueHeroPower(ship, meta) {
    this.#characters.enqueueHeroPower(ship, meta);
  }

  get haruhiHeroPowerEffects() {
    return this.#characters.inspectHeroPowers();
  }

  discardProjectilesFrom(sourceId) {
    this.#projectiles.discardFrom(sourceId);
  }

  setCombatEnabled(seat, enabled) {
    this.#combatSwitches.set(seat, enabled);
  }

  setAiEnabled(seat, enabled) {
    this.#aiSwitches.set(seat, enabled);
  }

  clampX(x, padding = 0) {
    return clamp(x, padding, this.worldSize - padding);
  }

  clampY(y, padding = 0) {
    return clamp(y, padding, this.worldSize - padding);
  }

  zoneById(zoneId) {
    const safeId = clamp(Number(zoneId) || 5, 1, 9);
    return this.zones.find((zone) => zone.id === safeId) || this.zones[4];
  }

  allTeams() {
    return this.#registry.allTeams();
  }

  teamBySeat(seat) {
    return this.#registry.teamBySeat(seat);
  }

  alliedTeamsOf(seat) {
    return this.#registry.alliedTeamsOf(seat);
  }

  enemyTeamsOf(seat) {
    return this.#registry.enemyTeamsOf(seat);
  }

  hostilePairs() {
    return this.#registry.hostilePairs();
  }

  hostileUnorderedPairs() {
    return this.#registry.hostileUnorderedPairs();
  }

  hostileView(seat) {
    if (typeof seat !== "string" || !this.#hostileViews.has(seat)) {
      throw new Error(`未知席位 ${String(seat)}，无法获取敌对集合视图`);
    }
    return this.#hostileViews.get(seat);
  }

  // 双舰队兼容入口：仅限两支敌对舰队，多敌方或未知席位明确拒绝。
  enemyTeamBySeat(seat) {
    return this.#registry.enemyTeamBySeat(seat);
  }

  botBySeat(seat) {
    return this.#registry.hasSeat(seat) ? (this.bots[seat] || null) : null;
  }

  applyActionForSeat(seat, action) {
    return dispatchSeatAction(this.#registry, seat, action, (team, nextAction) => this.applyAction(team, nextAction));
  }

  applyAction(team, action) {
    return applyMatchAction(team, action);
  }

  recordAction(seat, action) {
    this.#telemetry.recordAction(seat, action);
  }

  recordAttack(seat, kind, hitCount = 0) {
    this.#telemetry.recordAttack(seat, kind, hitCount);
  }

  recordDamage(source, target, amount, kind) {
    this.#telemetry.recordDamage(source?.team?.seat, target?.team?.seat, amount, kind);
  }

  recordShipLoss(seat) {
    this.#telemetry.recordShipLoss(seat);
  }

  statisticsSummary() {
    return this.#stateProjector.statisticsSummary(this.#projectionSource);
  }

  // 撞击:任意两艘存活舰船的船体重叠时把彼此推开解除重叠;减速只在「刚撞上」的那一帧施加一次
  // (用上一帧的接触集做迟滞判定),持续贴着不再反复减速,避免被一路压停。同队编队跟随的舰不互撞。
  resolveShipCollisions() {
    this.#hullCollisions.resolve({
      ships: this.allTeams().flatMap((team) => team.getAllShips())
        .filter((ship) => ship.alive).map((ship) => createHullCollisionPort(ship, this.rules)),
      elapsed: this.elapsed,
    });
  }

  resolveHaruhiOtherworlderContacts() {
    this.#characters.run("haruhiRam");
  }

  resolveKoizumiOrbContacts() {
    this.#characters.run("orbContacts");
  }

  resolveKoizumiBarrierRamContacts() {
    this.#characters.run("barrierRam");
  }

  resolveScoutClashes() {
    const collide = (left, right) => {
      left.takeDamage(1, null, this);
      right.takeDamage(1, null, this);
    };
    for (const [leftTeam, rightTeam] of this.hostileUnorderedPairs()) {
      resolveMatchScoutClashes({
        leftScouts: leftTeam.scouts,
        rightScouts: rightTeam.scouts,
        collide,
      });
    }
  }

  resolveBladeQueenContacts() {
    this.#characters.run("bladeContacts");
  }

  refreshShamisenHunts() {
    this.#characters.run("hunts");
  }

  onShipDestroyed(ship) {
    resolveShipDestruction(this, ship, this.#feedback);
  }

  get shamisenHuntKillEffects() {
    return this.#feedback.inspectHuntKills();
  }

  get koizumiBarrierImpacts() {
    return this.#feedback.inspectBarrierImpacts();
  }

  checkVictory() {
    if (this.phase !== "running") {
      return;
    }
    const sampledFleets = this.#registry.allTeams().map((team) => ({
      seat: team.seat,
      sideId: team.sideId,
      alive: Boolean(this.#isFleetAlive(team)),
    }));
    const facts = buildVictoryFacts({
      elapsed: this.elapsed,
      fleets: sampledFleets,
      legacyAb: this.#isLegacyAbTopology,
    });
    const result = this.#modeRules.evaluateOutcome(facts);
    if (!result) return;
    this.#outcome = validateModeOutcome(result, {
      outcomeShape: this.#outcomeShape,
      fleets: facts.fleets,
    });
  }

  spawnFloatingText(x, y, text, color = "#ffd178", meta = {}) {
    this.floatingTexts.push(new FloatingText(x, y, text, color, meta, this));
  }

  spawnFloatingTextKey(x, y, textKey, args = {}, color = "#ffd178", fallback = textKey) {
    this.spawnFloatingText(x, y, fallback, color, {
      textKey,
      textArgs: args,
    });
  }

  spawnAnnouncementKey(x, y, textKey, args = {}, color = "#ffe59a", fallback = textKey) {
    this.spawnFloatingText(x, y, fallback, color, {
      textKey,
      textArgs: args,
      emphasis: "announcement",
      life: 2.4,
      riseSpeed: 5,
    });
  }

  spawnBurst(x, y, color = "#ffdb9b", radius = 7) {
    this.bursts.push(new Burst(x, y, color, radius, this));
  }

  spawnKoizumiBarrierImpact(options = {}) {
    return this.#feedback.barrierImpact(options);
  }

  spawnProjectile(profile) {
    return this.#projectiles.spawn(profile);
  }

  updateProjectiles(dt) {
    const phase = this.createProjectilePhase(this);
    this.#projectiles.advance(dt, phase);
  }

  updateVisualEffects(dt) {
    for (const burst of this.bursts) {
      burst.update(dt);
    }
    this.bursts = this.bursts.filter((burst) => burst.life > 0);

    this.#feedback.advance(dt);

    for (const label of this.floatingTexts) {
      label.update(dt);
    }
    this.floatingTexts = this.floatingTexts.filter((label) => label.life > 0);
  }

  updateHaruhiHeroPowers() {
    this.#characters.run("heroPower");
  }

  resolveVisionWavePurges() {
    this.#characters.run("purges");
  }

  update(dt = TICK_DT) {
    if (this.phase !== "running") {
      return;
    }

    runBattleUpdatePhases(this.#phasePort, dt);
  }

  serializeRadarForSeat(seat) {
    const team = this.teamBySeat(seat);
    return team ? team.serializeRadarPassive() : null;
  }

  serializeState() {
    return this.#stateProjector.serializeState(this.#projectionSource);
  }
}
