import { CHARACTER_ASSEMBLY } from "../characters/assembly/character-assembly.js";
import { createMatchFeedback } from "./match-feedback.js";
import { resolveShipDestruction } from "../characters/interactions/ship-destruction.js";
import { createProjectilePhase } from "../characters/interactions/projectile-phase.js";
import { advanceProjectiles } from "../systems/projectile-system.js";
import { Projectile } from "../model/projectile.js";
import { createHullCollisionPort } from "../adapters/collision-port.js";
// 权威对局的装配与阶段编排。
import { DEFAULT_MAP_PADDING, DEFAULT_WORLD_SIZE, TICK_DT } from "../foundation/constants.js";
import { DEFAULT_AI_LOADOUT, DEFAULT_TEAM_LOADOUT, cloneLoadout } from "../characters/catalog.js";
import { buildZones, clamp } from "../foundation/math.js";
import { createAmbientRng, createSeededRng } from "../foundation/rng.js";
import { createAiRunner } from "../ai/bridge/runner.js";
import { aiHandicapFor } from "../ai/params/index.js";
import { applyMatchAction } from "./action-dispatcher.js";
import { resolveScoutClashes as resolveMatchScoutClashes, resolveShipCollisions as resolveMatchShipCollisions } from "../systems/collision-system.js";
import { createVisionWavePurgePort } from "../characters/asakura/vision-wave-port.js";
import { createMatchTelemetry, recordTelemetryAction, recordTelemetryAttack, recordTelemetryDamage, recordTelemetryShipLoss, serializeMatchTelemetry } from "./match-telemetry.js";
import { FloatingText } from "../model/floating-text.js";
import { Burst } from "../model/burst.js";
import { Team } from "../model/team.js";
import { normalizeAiSeats, nextEntityId } from "../model/model-support.js";

export class MatchSimulation {
  #characters;
  #feedback;
  constructor(options = {}) {
    const mode = options.mode || "pvp";
    const worldSize = Number.isFinite(options.worldSize) ? options.worldSize : DEFAULT_WORLD_SIZE;
    const mapPadding = Number.isFinite(options.mapPadding) ? options.mapPadding : DEFAULT_MAP_PADDING;
    const aiAutoBeam = Boolean(options.aiAutoBeam);
    const aiSeats = normalizeAiSeats(mode, options.aiSeats);
    const teamNames = {
      A: options.teamNames?.A || (aiSeats.includes("A") ? "观察方AI舰队A" : "玩家A舰队"),
      B: options.teamNames?.B || (aiSeats.includes("B") ? "统合思念体AI舰队" : "玩家B舰队"),
    };
    const teamLoadouts = {
      A: options.teamLoadouts?.A || DEFAULT_TEAM_LOADOUT,
      B: options.teamLoadouts?.B || (aiSeats.includes("B") ? DEFAULT_AI_LOADOUT : DEFAULT_TEAM_LOADOUT),
    };

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
    this.tutorialMode = Boolean(options.tutorialMode);
    this.combatEnabled = { A: true, B: true };
    this.aiEnabled = { A: true, B: true };
    this.zones = buildZones(worldSize);

    // 显式传入整数种子时整局可复现，规则与各席 AI 使用互不干扰的随机流；
    // 否则沿用环境随机源，取值顺序与全局 Math.random 一致。种子不进入快照。
    const seeded = Number.isInteger(options.seed);
    this.rng = seeded ? createSeededRng(options.seed) : createAmbientRng();
    this.aiRng = { A: this.rng.fork("ai:A"), B: this.rng.fork("ai:B") };
    this.entityIds = seeded ? { value: 1 } : null;

    this.tick = 0;
    this.elapsed = 0;
    this.phase = "running";
    this.winnerSeat = null;

    const centerY = worldSize * 0.5;
    const zoneWidth = worldSize / 3;
    const spawnRetreat = zoneWidth * 0.25;
    // 双方沿各自后方退四分之一战区，保持关于地图中心完全对称。
    const leftX = worldSize * 0.35 - spawnRetreat;
    const rightX = worldSize * 0.65 + spawnRetreat;

    this.teamA = new Team(this, "A", teamNames.A || "玩家A舰队", leftX, centerY, 0, {
      loadout: teamLoadouts.A || DEFAULT_TEAM_LOADOUT,
    });
    this.teamB = new Team(this, "B", teamNames.B || (mode === "ai" ? "统合思念体AI舰队" : "玩家B舰队"), rightX, centerY, Math.PI, {
      loadout: teamLoadouts.B || (mode === "ai" ? DEFAULT_AI_LOADOUT : DEFAULT_TEAM_LOADOUT),
    });

    this.projectiles = [];
    this.bursts = [];
    this.#feedback = createMatchFeedback({ now: () => this.elapsed, nextId: () => nextEntityId(this) });
    this.floatingTexts = [];
    this.telemetry = createMatchTelemetry();
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
    if (this.tutorialMode) {
      this.configureTutorialBattle();
    }
  }

  queueHeroPower(ship, meta) {
    this.#characters.enqueueHeroPower(ship, meta);
  }

  get haruhiHeroPowerEffects() {
    return this.#characters.inspectHeroPowers();
  }

  discardProjectilesFrom(sourceId) {
    for (const projectile of this.projectiles) {
      if (projectile.sourceId === sourceId) projectile.discard();
    }
    this.projectiles = this.projectiles.filter((projectile) => projectile.alive);
  }

  configureTutorialBattle() {
    this.teamA.setTrainingDamageFloor(0.25);
    this.combatEnabled.A = false;
    this.combatEnabled.B = false;
    this.aiEnabled.B = false;

    const trainingStats = {
      hp: 400,
      energy: 80,
      speed: 20,
      turnRate: 0.4,
      accel: 0.8,
      energyRegen: 4,
      moveDrain: 3,
      vision: 50,
      range: 100,
      damage: 5,
      fireRate: 0.08,
    };
    const positions = {
      main: { x: this.worldSize * 0.67, y: this.worldSize * 0.28 },
      sub1: { x: this.worldSize * 0.69, y: this.worldSize * 0.3 },
      sub2: { x: this.worldSize * 0.69, y: this.worldSize * 0.26 },
    };
    this.teamB.configureTrainingFleet(trainingStats, positions);
  }

  setCombatEnabled(seat, enabled) {
    if (seat === "A" || seat === "B") this.combatEnabled[seat] = Boolean(enabled);
  }

  setAiEnabled(seat, enabled) {
    if (seat === "A" || seat === "B") this.aiEnabled[seat] = Boolean(enabled);
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
    recordTelemetryAction(this.telemetry, seat, action);
  }

  recordAttack(seat, kind, hitCount = 0) {
    recordTelemetryAttack(this.telemetry, seat, kind, hitCount);
  }

  recordDamage(source, target, amount, kind) {
    recordTelemetryDamage(this.telemetry, source?.team?.seat, target?.team?.seat, amount, kind);
  }

  recordShipLoss(seat) {
    recordTelemetryShipLoss(this.telemetry, seat);
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
      telemetry: serializeMatchTelemetry(this.telemetry),
    };
  }

  // 撞击:任意两艘存活舰船的船体重叠时把彼此推开解除重叠;减速只在「刚撞上」的那一帧施加一次
  // (用上一帧的接触集做迟滞判定),持续贴着不再反复减速,避免被一路压停。同队编队跟随的舰不互撞。
  resolveShipCollisions() {
    this._contactPairs = resolveMatchShipCollisions({
      ships: [...this.teamA.getAllShips(), ...this.teamB.getAllShips()]
        .filter((ship) => ship.alive).map((ship) => createHullCollisionPort(ship, this.rules)),
      previousContacts: this._contactPairs,
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
    const aAlive = this.teamA.hasLivingShips();
    const bAlive = this.teamB.hasLivingShips();
    if (aAlive && bAlive) {
      return;
    }
    this.phase = "finished";
    this.winnerSeat = aAlive ? "A" : bAlive ? "B" : null;
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
    const projectile = new Projectile(profile);
    this.projectiles.push(projectile);
    return projectile;
  }

  updateProjectiles(dt) {
    const phase = this.createProjectilePhase(this);
    this.projectiles = advanceProjectiles(this.projectiles, dt, phase);
    phase.finish();
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

    const safeDt = clamp(dt, 0, 0.05);
    this.tick += 1;
    this.elapsed += safeDt;
    this.#characters.advance("beforeAi", safeDt);

    for (const [seat, runner] of Object.entries(this.aiRunners)) {
      if (this.aiEnabled[seat] !== false) runner.update(safeDt, this.elapsed);
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

    if (this.combatEnabled.A) this.teamA.stepCombat(this.teamB);
    if (this.combatEnabled.B) this.teamB.stepCombat(this.teamA);
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
