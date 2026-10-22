import { resolveBattleMode } from "./battle-mode.js";
import { CHARACTER_ASSEMBLY } from "../characters/assembly/character-assembly.js";
import { createMatchFeedback } from "./match-feedback.js";
import { resolveShipDestruction } from "../characters/interactions/ship-destruction.js";
import { createProjectilePhase } from "../characters/interactions/projectile-phase.js";
import { ProjectileSystem } from "../systems/projectile-system.js";
import { Projectile } from "../model/projectile.js";
import { createHullCollisionPort } from "../adapters/collision-port.js";
// 权威对局的装配与阶段编排。
import { DEFAULT_MAP_PADDING, DEFAULT_WORLD_SIZE, TICK_DT } from "../foundation/constants.js";
import { cloneLoadout } from "../characters/catalog.js";
import { buildZones, clamp } from "../foundation/math.js";
import { createAmbientRng, createSeededRng } from "../foundation/rng.js";
import { createAiRunner } from "../ai/bridge/runner.js";
import { aiHandicapFor } from "../ai/params/index.js";
import { applyMatchAction } from "./action-dispatcher.js";
import { resolveScoutClashes as resolveMatchScoutClashes, HullCollisionSystem } from "../systems/collision-system.js";
import { createVisionWavePurgePort } from "../characters/asakura/vision-wave-port.js";
import { MatchTelemetry } from "./match-telemetry.js";
import { FloatingText } from "../model/floating-text.js";
import { Burst } from "../model/burst.js";
import { Team } from "../model/team.js";
import { normalizeAiSeats, nextEntityId } from "../model/model-support.js";

// 战斗世界消费只读时间样本；不持有或推进权威时钟。
export class BattleRuntime {
  #readTime;
  get elapsed() { return this.#readTime().elapsed; }
  get tick() { return this.#readTime().tick; }
  #characters;
  #modeRules;
  #outcome = Object.freeze({ phase: "running", winnerSeat: null });
  #feedback;
  #projectiles = new ProjectileSystem((profile) => new Projectile(profile));
  #hullCollisions = new HullCollisionSystem();
  #telemetry = new MatchTelemetry();
  #combatEnabled = Object.freeze({ A: true, B: true });
  #aiEnabled = Object.freeze({ A: true, B: true });

  get phase() { return this.#outcome.phase; }
  get winnerSeat() { return this.#outcome.winnerSeat; }
  get endReason() { return this.#outcome.endReason; }
  get projectiles() { return this.#projectiles.items; }
  get combatEnabled() { return this.#combatEnabled; }
  get aiEnabled() { return this.#aiEnabled; }
  constructor(options, readTime) {
    this.#readTime = readTime;
    const { mode, aiSeats, teamNames, teamLoadouts, tutorialMode, rules } = resolveBattleMode(options);
    this.#modeRules = rules;
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
    this.aiRng = { A: this.rng.fork("ai:A"), B: this.rng.fork("ai:B") };
    this.entityIds = seeded ? { value: 1 } : null;

    const centerY = worldSize * 0.5;
    const zoneWidth = worldSize / 3;
    const spawnRetreat = zoneWidth * 0.25;
    // 双方沿各自后方退四分之一战区，保持关于地图中心完全对称。
    const leftX = worldSize * 0.35 - spawnRetreat;
    const rightX = worldSize * 0.65 + spawnRetreat;

    this.teamA = new Team(this, "A", teamNames.A, leftX, centerY, 0, {
      loadout: teamLoadouts.A,
    });
    this.teamB = new Team(this, "B", teamNames.B, rightX, centerY, Math.PI, {
      loadout: teamLoadouts.B,
    });

    this.bursts = [];
    this.#feedback = createMatchFeedback({ now: () => this.elapsed, nextId: () => nextEntityId(this) });
    this.floatingTexts = [];
    this.#characters = CHARACTER_ASSEMBLY.createBattle(this);
    this.bots = {};
    this.aiRunners = {};
    // 旧版 AI 只用于调试对照，必须显式指定。不能沿用 aiSeats 的 mode=ai 默认值，
    // 否则单人模式会把唯一的 B 席 AI 悄悄降级为旧策略。
    const legacyAiSeats = normalizeAiSeats("pvp", options.legacyAiSeats);
    const aiDifficulty = options.aiDifficulty || "master"; // 单人难度(默认满状态)
    for (const seat of this.aiSeats) {
      // aiParams 可按席位指定预设与参数覆盖：{ A: { preset, overrides } }。
      const seatParams = options.aiParams?.[seat] || {};
      const runner = createAiRunner(this, seat, {
        params: {
          difficulty: aiDifficulty,
          preset: legacyAiSeats.includes(seat) ? "legacy" : seatParams.preset ?? null,
          overrides: seatParams.overrides ?? null,
        },
      });
      this.aiRunners[seat] = runner;
      this.bots[seat] = runner.policy;
      // 难度让分属于规则层：数值缩放与集火残血直接写入 AI 所控舰队，不经过 AI 决策。
      const handicap = aiHandicapFor(aiDifficulty);
      const team = this.teamBySeat(seat);
      team.configureAiHandicap(handicap);
      runner.port.invalidate();
    }
    this.botA = this.bots.A || null;
    this.bot = this.bots.B || null;
    // 模式只取得初始化需要的领域操作；不持有世界、时钟或终局写权限。
    this.#modeRules.initialize({
      worldSize,
      setTrainingDamageFloor: (seat, fraction) => this.teamBySeat(seat).setTrainingDamageFloor(fraction),
      configureTrainingFleet: (seat, stats, positions) => this.teamBySeat(seat).configureTrainingFleet(stats, positions),
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
    if (seat !== "A" && seat !== "B") return;
    const next = Boolean(enabled);
    if (this.#combatEnabled[seat] !== next) this.#combatEnabled = Object.freeze({ ...this.#combatEnabled, [seat]: next });
  }

  setAiEnabled(seat, enabled) {
    if (seat !== "A" && seat !== "B") return;
    const next = Boolean(enabled);
    if (this.#aiEnabled[seat] !== next) this.#aiEnabled = Object.freeze({ ...this.#aiEnabled, [seat]: next });
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

  teamBySeat(seat) {
    return seat === "A" ? this.teamA : this.teamB;
  }

  enemyTeamBySeat(seat) {
    return seat === "A" ? this.teamB : this.teamA;
  }

  botBySeat(seat) {
    return this.bots[seat] || null;
  }

  applyActionForSeat(seat, action) {
    const team = this.teamBySeat(seat);
    return this.applyAction(team, action);
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
    const summarizeTeam = (team) => ({
      seat: team.seat,
      loadout: cloneLoadout(team.loadout),
      splitLevel: team.splitLevel,
      hullRatio: Math.round(team.hullRatio() * 10000) / 10000,
      ships: Object.fromEntries(["main", "sub1", "sub2"].map((key) => {
        const ship = team.ships[key];
        return [key, {
          alive: Boolean(ship.alive),
          hp: Math.round(Math.max(0, ship.hp) * 100) / 100,
          maxHp: Math.round(Math.max(0, ship.maxHp) * 100) / 100,
          energy: Math.round(Math.max(0, ship.energy) * 100) / 100,
          maxEnergy: Math.round(Math.max(0, ship.maxEnergy) * 100) / 100,
        }];
      })),
      survivingScouts: team.scouts.filter((item) => item.alive).length,
      survivingWingmen: team.wingmen.filter((item) => item.alive).length,
    });
    return {
      tick: this.tick,
      durationSeconds: Math.round(this.elapsed * 1000) / 1000,
      winnerSeat: this.winnerSeat,
      worldSize: this.worldSize,
      teams: {
        A: summarizeTeam(this.teamA),
        B: summarizeTeam(this.teamB),
      },
      telemetry: this.#telemetry.serialize(),
    };
  }

  // 撞击:任意两艘存活舰船的船体重叠时把彼此推开解除重叠;减速只在「刚撞上」的那一帧施加一次
  // (用上一帧的接触集做迟滞判定),持续贴着不再反复减速,避免被一路压停。同队编队跟随的舰不互撞。
  resolveShipCollisions() {
    this.#hullCollisions.resolve({
      ships: [...this.teamA.getAllShips(), ...this.teamB.getAllShips()]
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
    resolveMatchScoutClashes({
      leftScouts: this.teamA.scouts,
      rightScouts: this.teamB.scouts,
      collide: (left, right) => {
        left.takeDamage(1, null, this);
        right.takeDamage(1, null, this);
      },
    });
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
    const result = this.#modeRules.evaluateOutcome({
      elapsed: this.elapsed,
      aAlive: this.teamA.hasLivingShips(), bAlive: this.teamB.hasLivingShips(),
    });
    if (!result) return;
    if (result.reason !== undefined && (typeof result.reason !== "string" || !result.reason)) {
      throw new TypeError("终局原因必须是非空字符串");
    }
    this.#outcome = Object.freeze({
      phase: "finished", winnerSeat: result.winnerSeat,
      ...(result.reason ? { endReason: result.reason } : {}),
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

    const safeDt = dt;
    this.#characters.advance("beforeAi", safeDt);

    for (const [seat, runner] of Object.entries(this.aiRunners)) {
      if (this.#aiEnabled[seat] !== false) runner.update(safeDt, this.elapsed);
    }

    this.teamA.update(safeDt);
    this.teamB.update(safeDt);
    this.#characters.advance("afterTeams", safeDt);
    this.resolveShipCollisions();
    this.#characters.advance("afterHull", safeDt);
    this.resolveScoutClashes();
    this.#characters.advance("beforeVisibility", safeDt);
    this.teamA.computeVisibility(this.teamB);
    this.teamB.computeVisibility(this.teamA);
    this.#characters.advance("beforeBeams", safeDt);
    this.teamA.resolveChargedBeams(this.teamB);
    this.teamB.resolveChargedBeams(this.teamA);

    if (this.#combatEnabled.A) this.teamA.stepCombat(this.teamB);
    if (this.#combatEnabled.B) this.teamB.stepCombat(this.teamA);
    this.updateProjectiles(safeDt);
    this.updateVisualEffects(safeDt);

    this.#characters.advance("afterVisuals", safeDt);

    this.checkVictory();
  }

  serializeRadarForSeat(seat) {
    return this.teamBySeat(seat).serializeRadarPassive();
  }

  serializeState() {
    return {
      world: {
        size: this.worldSize,
      },
      mode: this.mode,
      aiSeats: [...this.aiSeats],
      zones: this.zones.map((zone) => ({ ...zone })),
      phase: this.phase,
      winnerSeat: this.winnerSeat,
      ...(this.endReason ? { endReason: this.endReason } : {}),
      elapsed: this.elapsed,
      projectiles: this.projectiles.map((projectile) => projectile.serialize()),
      bursts: this.bursts.map((burst) => burst.serialize()),
      haruhiHeroPowerEffects: this.#characters.projectHeroPowers(),
      shamisenHuntKillEffects: this.#feedback.serializeHuntKills(),
      koizumiBarrierImpacts: this.#feedback.serializeBarrierImpacts(),
      floatingTexts: this.floatingTexts.map((label) => label.serialize()),
      teams: {
        A: this.teamA.serialize(),
        B: this.teamB.serialize(),
      },
      bots: {
        A: this.botBySeat("A") ? this.botBySeat("A").serializeDebugState() : null,
        B: this.botBySeat("B") ? this.botBySeat("B").serializeDebugState() : null,
      },
    };
  }
}
