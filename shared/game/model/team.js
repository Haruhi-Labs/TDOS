import { SkillCycle } from "../systems/skill-cycle.js";
import { createTeamSkillPort } from "../rules/team-skill-port.js";
import { FleetFormation } from "../systems/fleet-formation.js";
import { createFormationPort } from "../rules/formation-port.js";
import { createTeamHaruhiFlagship } from "../rules/haruhi-flagship-port.js";
import { ownSupportState } from "../haruhi-support.js";
import { createTeamSponsor } from "../rules/sponsor-port.js";
import { createTeamFutureForm } from "../rules/future-form-port.js";
import { futureFormDefinition } from "../future-flagship-form.js";
import { BeamSystem } from "../systems/beam-system.js";
import { createTeamBeamPort, beamCasterState } from "../rules/beam-port.js";
// 舰队状态所有者与领域操作。
import { AUTO_SCOUT_COOLDOWN_MULTIPLIER, MANUAL_SCOUT_COOLDOWN, SCOUT_LAUNCH_COST } from "../combat-rules.js";
import { DEFAULT_TEAM_LOADOUT, cloneLoadout, normalizeLoadout } from "../characters.js";
import { clamp, normalizeAngle, rotateOffset, zoneContains } from "../math.js";
import { rngFor } from "../rng.js";
import { serializeShipStatusEffects, statusEffectNames } from "../status-effects.js";
import { computeVisibility as computeTeamVisibility, createRadarContact as createTeamRadarContact, radarMaxDistanceFrom as teamRadarMaxDistanceFrom, serializeRadarPassive as serializeTeamRadarPassive, serializeRadarSweep as serializeTeamRadarSweep, updateRadarPassive as updateTeamRadarPassive } from "../visibility-radar.js";
import { cancelVisionWaveSkill as cancelTeamVisionWaveSkill, createVisionWaveSkillState, serializeVisionWaves as serializeTeamVisionWaves, updateVisionWaveSkill as updateTeamVisionWaveSkill } from "../vision-wave.js";
import { isFocusWorthy } from "../targeting-system.js";
import { assignTeamFocusTargets, fireCandidates as teamFireCandidates, focusDamageBudget as attackerFocusDamageBudget, pickTeamTarget } from "../rules/fire-control.js";
import { serializeKoizumiImpactWaves } from "../koizumi-orb.js";
import { createKoizumiBarrierState, serializeKoizumiBarrier } from "../koizumi-barrier.js";
import { createHaruhiFlagshipState, serializeHaruhiFlagship, updateHaruhiFlagship } from "../haruhi-flagship.js";
import { createShamisenHuntState, ensureShamisenHuntTarget, hasShamisenFlagship, isShamisenHuntTarget, serializeShamisenHunt } from "../shamisen-hunt.js";
import { convertBunnyCompanion } from "../bunny-companion-runtime.js";
import { spawnBunnyCompanion, updateBunnyTeamSupports, refreshBunnyVisibility } from "../bunny-haruhi-runtime.js";
import { Ship } from "../model/ship.js";
import { Scout } from "../model/scout.js";
import { Wingman } from "../model/wingman.js";
import { TAU, BEAM_CHARGE_DURATION, BEAM_VISUAL_DURATION, BEAM_BASE_RANGE, BEAM_HIT_RADIUS, beamDamageRatioForHitCount, FLAGSHIP_TURN_PENALTIES, TEAM_COLORS, TEAM_PROJECTILE_COLORS } from "../model/model-support.js";

export class Team {
  #skills;
  get cooldowns() { return this.#skills.cooldowns; }
  startCooldown(key, duration) { this.#skills.startCooldown(key, duration); }
  #formation;
  get splitLevel() { return this.#formation.level; }
  #beamSystem;
  #futureForm;
  #sponsor;
  #haruhi;
  constructor(match, seat, name, spawnX, spawnY, facing, options = {}) {
    this.match = match;
    this.seat = seat;
    this.name = name;
    this.color = TEAM_COLORS[seat];
    this.projectileColor = TEAM_PROJECTILE_COLORS[seat];
    Object.defineProperty(this, "loadout", {
      enumerable: true,
      value: Object.freeze(normalizeLoadout(options.loadout || DEFAULT_TEAM_LOADOUT, DEFAULT_TEAM_LOADOUT)),
    });

    this.#formation = new FleetFormation(createFormationPort(this), FLAGSHIP_TURN_PENALTIES);
    // 单人难度对本队的影响(仅当本队由AI控制时,由 MatchSimulation 按难度让分表写入):
    //  statMult    敌方数值缩放(简单0.8/普通1.0/困难1.2/极限1.0),作用于本队舰船的血量与伤害;
    //  aiFocusLowHp 极限难度专属:开火时锁定射程内血量最低的敌人(其余难度仍与玩家同规则"取最近")。
    // 玩家队没有 BotController,二者保持默认(1 / false),行为与既有完全一致。
    this.statMult = 1;
    this.aiFocusLowHp = false;
    // 独立教程使用的安全门：敌军全程禁用技能，友军在自由战前锁血至 1/4。
    // 常规对战均保持默认值，不改变既有规则。
    this.forceSkillsDisabled = false;
    this.forceCharacterSkillsDisabled = false;
    this.forceScoutsDisabled = false;
    this.damageFloorRatio = 0;
    // 极限集火只对"残血"目标生效(血量 ≤ 该值×自身上限才值得转火去收人头);
    // 健康目标仍走取最近以保证射界/火力密度。0=从不集火(等同取最近),1=对任何目标都集火。
    this.focusHpFrac = 0.5;
    this.visibleEnemyIds = new Set();
    this.#skills = new SkillCycle(createTeamSkillPort(this, {
      activateSupport: (duration) => this.#haruhi.cast(duration),
      activateSponsor: (duration) => this.#sponsor.activate(duration),
    }));
    this.autoScout = {
      enabled: false,
      zoneId: 5,
    };

    this.#sponsor = createTeamSponsor(this);
    this.#haruhi = createTeamHaruhiFlagship(this);
    this.effects = {};
    Object.defineProperty(this.effects, "haruhiBoostUntil", {
      enumerable: true, get: () => this.#haruhi.expiresAt,
    });
    Object.defineProperty(this.effects, "sponsorUntil", {
      enumerable: true, get: () => this.#sponsor.expiresAt,
    });
    this.#futureForm = createTeamFutureForm(this);
    Object.defineProperty(this, "haruhiFlagship", {
      enumerable: true, value: ownSupportState(createHaruhiFlagshipState(facing)),
    });
    this.koizumiBarrier = createKoizumiBarrierState();
    this.shamisenHunt = createShamisenHuntState();

    const sub1FormationOffset = { x: -36, y: 22 };
    const sub2FormationOffset = { x: -36, y: -22 };
    const sub1SpawnOffset = rotateOffset(sub1FormationOffset.x * 0.5, sub1FormationOffset.y * 0.5, facing);
    const sub2SpawnOffset = rotateOffset(sub2FormationOffset.x * 0.5, sub2FormationOffset.y * 0.5, facing);

    this.ships = {
      main: new Ship(this, "main", spawnX, spawnY, facing, {
        slotKey: "main",
        characterId: this.loadout.main,
      }),
      sub1: new Ship(this, "sub1", spawnX + sub1SpawnOffset.x, spawnY + sub1SpawnOffset.y, facing, {
        slotKey: "sub1",
        characterId: this.loadout.sub1,
        formationOffset: sub1FormationOffset,
      }),
      sub2: new Ship(this, "sub2", spawnX + sub2SpawnOffset.x, spawnY + sub2SpawnOffset.y, facing, {
        slotKey: "sub2",
        characterId: this.loadout.sub2,
        formationOffset: sub2FormationOffset,
      }),
    };

    this.extraShips = [];
    this.radarPassive = {
      epochAngle: normalizeAngle(facing),
      angle: normalizeAngle(facing),
      scanSequence: 0,
      contacts: new Map(),
    };
    this.visionWaveSkill = createVisionWaveSkillState();
    this.koizumiImpactWaves = [];
    this.koizumiImpactWaveSequence = 0;

    this.scouts = [];
    this.wingmen = [];
    this.#beamSystem = new BeamSystem(createTeamBeamPort(this), {
      range: BEAM_BASE_RANGE, chargeDuration: BEAM_CHARGE_DURATION,
      visualDuration: BEAM_VISUAL_DURATION, hitRadius: BEAM_HIT_RADIUS,
      damageRatio: beamDamageRatioForHitCount,
    });
  }

  mainCharacterId() {
    return this.loadout.main;
  }

  hasYukiFlagship() {
    return this.mainCharacterId() === "yuki";
  }

  hasKyonFlagship() {
    return this.mainCharacterId() === "kyon";
  }

  hasTsuruyaFlagship() {
    return this.mainCharacterId() === "tsuruya";
  }

  hasShamisenFlagship() {
    return hasShamisenFlagship(this);
  }

  ensureShamisenHuntTarget(enemyTeam) {
    return ensureShamisenHuntTarget(this, enemyTeam, rngFor(this.match).next);
  }

  isShamisenHuntTarget(target) {
    return isShamisenHuntTarget(this, target);
  }

  get future1096Form() {
    return this.#futureForm.current;
  }

  future1096FormDefinition(form = this.future1096Form) {
    return futureFormDefinition(form);
  }

  future1096StatMultiplier(statKey) {
    return this.#futureForm.statMultiplier(statKey);
  }

  future1096DamageTakenMultiplier() {
    return this.#futureForm.damageTakenMultiplier();
  }

  switchFuture1096Form() {
    return this.#futureForm.switch();
  }

  hasActiveSponsor() {
    return this.#sponsor.active();
  }

  hasActiveVisionWaveSkill() {
    return this.visionWaveSkill.activeUntil > this.match.elapsed;
  }

  getPlayerShips() {
    return [this.ships.main, this.ships.sub1, this.ships.sub2];
  }

  addScout(scout) {
    this.scouts.push(scout);
  }

  removeScout(scout) {
    this.scouts = this.scouts.filter((candidate) => candidate !== scout);
  }

  addWingman(wingman) {
    this.wingmen.push(wingman);
  }

  removeWingman(wingman) {
    this.wingmen = this.wingmen.filter((candidate) => candidate !== wingman);
  }

  activateHaruhiSupport(duration, random) {
    return this.#haruhi.activate(duration, random);
  }

  addAuxiliaryShip(ship) {
    this.extraShips.push(ship);
  }

  removeAuxiliaryShip(ship) {
    this.extraShips = this.extraShips.filter((candidate) => candidate !== ship);
  }

  getAllShips() {
    return [...this.getPlayerShips(), ...this.extraShips];
  }

  spawnBunnyCompanion(owner) {
    return spawnBunnyCompanion(owner, (...args) => new Ship(...args));
  }

  configureAiHandicap({ focusLowHp, statMult }) {
    this.aiFocusLowHp = focusLowHp;
    this.applyAiStatMult(statMult);
  }

  setTrainingDamageFloor(ratio) {
    this.damageFloorRatio = ratio;
  }

  configureTrainingFleet(stats, positions) {
    this.forceCharacterSkillsDisabled = true;
    this.configureFormation(2);
    for (const ship of this.getAllShips()) ship.configureTraining(stats, positions[ship.key] || positions.main);
  }

  // 难度数值缩放:按 mult 缩放本队所有舰船的最大/当前血量(伤害缩放在 effectiveDamage 中按 statMult 动态生效)。
  // 幂等——以已生效的 statMult 为基准取比值,重复调用同一倍率不再叠加。
  applyAiStatMult(mult) {
    const m = Number(mult) > 0 ? Number(mult) : 1;
    const prev = this.statMult || 1;
    if (m !== prev) {
      const ratio = m / prev;
      for (const ship of this.getAllShips()) {
        ship.scaleHullCapacity(ratio);
      }
    }
    this.statMult = m;
    return this;
  }

  shipByKey(key) {
    if (this.ships[key]) {
      return this.ships[key];
    }
    return this.extraShips.find((ship) => ship.key === key || ship.slotKey === key) || null;
  }

  getEntities() {
    const list = [];
    for (const ship of this.getAllShips()) {
      if (ship.alive) {
        list.push(ship);
      }
    }
    for (const scout of this.scouts) {
      if (scout.alive) {
        list.push(scout);
      }
    }
    for (const wingman of this.wingmen) {
      if (wingman.alive) {
        list.push(wingman);
      }
    }
    return list;
  }

  getVisionSources() {
    const sources = [];
    for (const ship of this.getAllShips()) {
      if (ship.alive) {
        if (ship.key !== "main" && ship.isAttached() && !ship.isAuxiliary) {
          continue;
        }
        sources.push({
          id: ship.id,
          x: ship.x,
          y: ship.y,
          range: ship.effectiveVision(),
        });
      }
    }
    for (const scout of this.scouts) {
      if (scout.alive) {
        sources.push({
          id: scout.id,
          x: scout.x,
          y: scout.y,
          range: scout.vision,
        });
      }
    }
    for (const wingman of this.wingmen) {
      if (wingman.alive) {
        sources.push({
          id: wingman.id,
          x: wingman.x,
          y: wingman.y,
          range: wingman.vision,
        });
      }
    }
    return sources;
  }

  getVictoryShips() {
    return this.getAllShips().filter((ship) => this.match.rules.countsForVictory(ship));
  }

  hasLivingShips() {
    return this.getVictoryShips().some((ship) => ship.alive);
  }

  hullRatio() {
    const ships = this.getVictoryShips();
    const hp = ships.reduce((sum, ship) => sum + Math.max(0, ship.hp), 0);
    const max = ships.reduce((sum, ship) => sum + ship.maxHp, 0);
    return max <= 0 ? 0 : hp / max;
  }

  fleetKeyForShip(shipOrKey) { return this.#formation.fleetKeyForShip(typeof shipOrKey === "string" ? shipOrKey : shipOrKey.key); }
  fleetMembersByKey(key) { return this.#formation.fleetMembersByKey(key).map((unit) => this.shipByKey(unit.key)); }
  fleetMembersForShip(shipOrKey) { return this.fleetMembersByKey(this.fleetKeyForShip(shipOrKey)); }
  fleetMemberCountForShip(shipOrKey) { return this.fleetMembersForShip(shipOrKey).length; }
  turnModifierForShip(shipOrKey) { return this.#formation.turnModifierForShip(typeof shipOrKey === "string" ? shipOrKey : shipOrKey.key); }
  accelerationModifierForShip(shipOrKey) { return this.#formation.accelerationModifierForShip(); }
  fleetSpeedForShip(shipOrKey) { return this.#formation.fleetSpeedForShip(typeof shipOrKey === "string" ? shipOrKey : shipOrKey.key); }
  fleetEnergyForShip(shipOrKey) { return this.#formation.fleetEnergyForShip(typeof shipOrKey === "string" ? shipOrKey : shipOrKey.key); }
  availableEnergyForShip(shipOrKey) { return this.fleetEnergyForShip(shipOrKey).current; }
  spendEnergyForShip(shipOrKey, cost) { return this.#formation.spendEnergyForShip(typeof shipOrKey === "string" ? shipOrKey : shipOrKey.key, cost); }

  listShipBuffs(ship) {
    return statusEffectNames(serializeShipStatusEffects(ship));
  }

  areSkillsDisabled() {
    return this.forceSkillsDisabled || this.forceCharacterSkillsDisabled;
  }

  areScoutsDisabled() {
    return this.forceSkillsDisabled || this.forceScoutsDisabled;
  }

  cooldownStep(dt) {
    return this.#sponsor.cooldownStep(dt);
  }

  setShipEffect(ship, key, duration) {
    ship.activateTimedEffect(key, duration);
  }

  clearActiveTeamSkillBuffs({ preserveCurrentTick = true } = {}) {
    let cleared = this.#sponsor.clear({ preserveCurrentTick });
    if (this.#haruhi.clear({ preserveCurrentTick })) cleared = true;
    if (cancelTeamVisionWaveSkill(this, { preserveCurrentTick })) {
      cleared = true;
    }
    return cleared;
  }

  clearActiveSkillBuffs({ preserveCurrentTick = true } = {}) {
    let cleared = this.clearActiveTeamSkillBuffs({ preserveCurrentTick });
    for (const ship of this.getAllShips()) {
      if (ship.clearActiveSkillBuffs({ preserveCurrentTick })) {
        cleared = true;
      }
    }
    return cleared;
  }

  clearActiveSkillBuffsForShip(ship, { preserveCurrentTick = true } = {}) {
    if (!ship || ship.team !== this) return false;
    const teamCleared = this.clearActiveTeamSkillBuffs({ preserveCurrentTick });
    const shipCleared = ship.clearActiveSkillBuffs({ preserveCurrentTick });
    return teamCleared || shipCleared;
  }

  configureAutoScout(enabled, zoneId = 5) {
    this.autoScout.enabled = Boolean(enabled);
    if (Number.isFinite(Number(zoneId))) {
      this.autoScout.zoneId = clamp(Number(zoneId), 1, 9);
    }
    return true;
  }

  blinkShip(ship, targetX, targetY, maxRange = 240) {
    if (!ship || !ship.alive) {
      return false;
    }
    const fromX = ship.x;
    const fromY = ship.y;
    const aimX = Number.isFinite(targetX) ? targetX : ship.x;
    const aimY = Number.isFinite(targetY) ? targetY : ship.y;
    const dx = aimX - ship.x;
    const dy = aimY - ship.y;
    const len = Math.hypot(dx, dy);
    const step = len > 1e-4 ? Math.min(len, maxRange) : 0;
    const dirX = len > 1e-4 ? dx / len : Math.cos(ship.angle);
    const dirY = len > 1e-4 ? dy / len : Math.sin(ship.angle);
    const padding = Math.max(this.match.mapPadding, ship.radius + 4);
    ship.displaceTo(ship.x + dirX * step, ship.y + dirY * step, padding);
    ship.navigateTo({ x: ship.x, y: ship.y });
    this.match.spawnBurst(fromX, fromY, "#d8f7ff", 8);
    this.match.spawnBurst(ship.x, ship.y, "#9be0ff", 9);
    this.match.spawnFloatingTextKey(ship.x + 10, ship.y - 12, "闪现", {}, "#9be0ff");
    return true;
  }

  sponsorRegeneration(dt) {
    this.#sponsor.regenerate(dt);
  }

  configureFormation(level) { this.#formation.configure(level); }
  resolvePostCasualtyState() { this.#formation.resolvePostCasualtyState(); }
  split(level) { return this.#formation.split(level); }

  updateEnergy(dt) {
    for (const ship of this.getAllShips()) {
      if (!ship.alive) {
        continue;
      }
      const throttle = ship.isAttached() ? this.ships.main.throttle : ship.throttle;
      const energyRate = this.match.rules.energyRate(ship, throttle);
      ship.restoreEnergy(energyRate * dt);
    }
  }

  update(dt) {
    this.resolvePostCasualtyState();
    const cooldownStep = this.cooldownStep(dt);
    this.#skills.advance(cooldownStep);

    this.sponsorRegeneration(dt);
    this.updateEnergy(dt);
    for (const ship of this.getAllShips()) {
      ship.update(dt);
    }
    updateHaruhiFlagship(this, {
      dt,
      launchAlienWingmen: (ship) => this.launchHaruhiAlienWingmen(ship),
      launchRandomBeam: (ship) => this.launchHaruhiRandomBeam(ship),
    });
    if (this.match.bunnyHaruhiActive) updateBunnyTeamSupports(this, dt);
    updateTeamVisionWaveSkill(this);
    this.maybeAutoLaunchScout();
    for (const scout of this.scouts) {
      scout.update(dt);
    }
    for (const wingman of this.wingmen) {
      wingman.update(dt);
    }
    this.advanceBeams(dt);

    this.scouts = this.scouts.filter((scout) => scout.alive);
    this.wingmen = this.wingmen.filter((wingman) => wingman.alive);
  }

  maybeAutoLaunchScout() {
    if (!this.autoScout.enabled) {
      return false;
    }
    return this.launchScout(this.autoScout.zoneId, {
      cooldownMultiplier: AUTO_SCOUT_COOLDOWN_MULTIPLIER,
    });
  }

  assignScoutMission(scout, options = {}) {
    if (!scout?.alive || scout.team !== this) {
      return false;
    }
    const zone = this.match.zoneById(options.zoneId || scout.zone?.id || 5);
    scout.assignMission(zone, options);
    return true;
  }

  launchScout(zoneId, options = {}) {
    if (!this.match.rules.scoutOrderAvailable(this.shipByKey(options.fromShipKey))) return false;
    const cost = SCOUT_LAUNCH_COST;
    const cooldownMultiplier = Number.isFinite(options.cooldownMultiplier) ? Math.max(1, options.cooldownMultiplier) : 1;
    if (this.areScoutsDisabled()) {
      return false;
    }
    if (this.cooldowns.scout > 0) {
      return false;
    }
    // 侦察机从「指定舰船」处发出(默认主舰)——前出的分离舰可更快把侦察部署到位。
    // 能量从该舰所属能量池扣除(分离后副舰用自己的池)。
    const requested = options.fromShipKey ? this.ships[options.fromShipKey] : null;
    if (requested && requested.isControlLocked()) {
      return false;
    }
    const source = (requested && requested.alive ? requested : null)
      || (this.ships.main.alive ? this.ships.main : this.getAllShips().find((ship) => ship.alive));
    if (!source || source.isControlLocked() || !this.match.rules.scoutLaunchAvailable(source)) {
      return false;
    }
    if (!this.spendEnergyForShip(source.key || "main", cost)) {
      return false;
    }
    const zone = this.match.zoneById(zoneId);
    const launchCount = this.match.rules.scoutLaunchCount(this);
    const lateralAngle = source.angle + Math.PI * 0.5;
    const lateralDistance = source.radius + 6;
    for (let index = 0; index < launchCount; index += 1) {
      const side = launchCount === 1 ? 0 : index * 2 - 1;
      const x = this.match.clampX(source.x + Math.cos(lateralAngle) * lateralDistance * side, 8);
      const y = this.match.clampY(source.y + Math.sin(lateralAngle) * lateralDistance * side, 8);
      this.scouts.push(new Scout(this, x, y, {
        zone,
        seekPoint: options.seekPoint,
        mission: options.mission,
        patrolCenter: options.patrolCenter,
        patrolRadius: options.patrolRadius,
      }));
    }
    this.startCooldown("scout", MANUAL_SCOUT_COOLDOWN * cooldownMultiplier);
    this.match.recordAction(this.seat, options.cooldownMultiplier ? "auto_scout" : "launch_scout");
    return true;
  }

  launchWingman(zoneId) {
    const cost = 55;
    if (this.cooldowns.flagship > 0) {
      return false;
    }
    if (!this.spendEnergyForShip("main", cost)) {
      return false;
    }
    const zone = this.match.zoneById(zoneId);
    const main = this.ships.main;
    if (!main.alive) {
      return false;
    }
    this.wingmen.push(new Wingman(this, main.x, main.y, zone));
    return true;
  }

  launchBurstScouts(ship) {
    const directions = 8;
    for (let i = 0; i < directions; i += 1) {
      const angle = (TAU / directions) * i;
      for (const offset of [-0.07, 0.07]) {
        const targetAngle = angle + offset;
        const anchor = {
          x: this.match.clampX(ship.x + Math.cos(targetAngle) * 230, 22),
          y: this.match.clampY(ship.y + Math.sin(targetAngle) * 230, 22),
        };
        this.scouts.push(
          new Scout(this, ship.x, ship.y, {
            pattern: "burst",
            anchor,
            anchorRadius: 18,
            speed: 118,
            vision: 82,
            life: 10.5,
            radius: 3,
          }),
        );
      }
    }
  }

  zoneForPoint(x, y) {
    return this.match.zones.find((zone) => zoneContains(zone, x, y)) || this.match.zones[4];
  }

  launchHaruhiAlienWingmen(ship) {
    const zone = this.zoneForPoint(ship.x, ship.y);
    const releaseAngle = rngFor(this.match).range(0, TAU);
    const spawnRadius = ship.radius + 12;
    const x = this.match.clampX(ship.x + Math.cos(releaseAngle) * spawnRadius, 8);
    const y = this.match.clampY(ship.y + Math.sin(releaseAngle) * spawnRadius, 8);
    this.scouts.push(new Scout(this, x, y, { zone, combatCapable: true }));
    this.match.spawnBurst(x, y, "#8fe8ff", 5);
  }

  launchHaruhiRandomBeam(ship) {
    const angle = rngFor(this.match).range(0, TAU);
    return this.queueBeamDirection(ship, Math.cos(angle), Math.sin(angle));
  }

  castFlagshipSkill() { return this.#skills.castFlagship(); }
  castSubSkill(key, options = {}) { return this.#skills.castSub(key, options); }
  completeSubSkillCast(ship, cooldown) { this.#skills.completeSub(ship.key, cooldown); }

  castBeamFromShip(shipKey, directionX, directionY) {
    const ship = this.ships[shipKey];
    if (!ship || ship.isAttached() || !ship.alive) {
      return false;
    }
    const aimDx = Number(directionX) - ship.x;
    const aimDy = Number(directionY) - ship.y;
    const aimLen = Math.hypot(aimDx, aimDy);
    if (!Number.isFinite(aimLen) || aimLen < 1e-4) {
      return false;
    }
    const dirX = aimDx / aimLen;
    const dirY = aimDy / aimLen;
    return this.queueBeamDirection(ship, dirX, dirY);
  }

  get beams() {
    return this.#beamSystem.inspect();
  }

  advanceBeams(dt) {
    this.#beamSystem.advance(dt);
  }

  queueBeamDirection(ship, dirX, dirY) {
    return this.#beamSystem.enqueue(beamCasterState(ship), dirX, dirY);
  }

  bribeZone(ship, zoneId) {
    const zone = this.match.zoneById(zoneId);
    const enemyTeam = this.match.enemyTeamBySeat(this.seat);
    let converted = 0;

    for (const scout of [...enemyTeam.scouts]) {
      if (!scout.alive || !zoneContains(zone, scout.x, scout.y)) {
        continue;
      }
      scout.transferToTeam(this, zone);
      converted += 1;
    }

    for (const wingman of [...enemyTeam.wingmen]) {
      if (!wingman.alive || !zoneContains(zone, wingman.x, wingman.y)) {
        continue;
      }
      wingman.transferToTeam(this, zone);
      converted += 1;
    }

    // 使用固定集合，避免原地转移遗漏实体；普通飞行器保留原永久策反语义。
    for (const companion of [...enemyTeam.extraShips]) {
      if (companion.alive && zoneContains(zone, companion.x, companion.y)
        && convertBunnyCompanion(companion, this, zone)) converted += 1;
    }
    if (this.match.bunnyHaruhiActive && converted > 0) refreshBunnyVisibility(this.match);

    if (converted > 0) {
      this.match.spawnFloatingTextKey(ship.x + 10, ship.y - 14, "钞能力 x{count}", { count: converted }, "#ffd27e", `钞能力 x${converted}`);
    }
    return converted > 0;
  }

  resolveChargedBeams(enemyTeam) {
    this.#beamSystem.resolve(enemyTeam);
  }

  radarMaxDistanceFrom(source) {
    return teamRadarMaxDistanceFrom(this, source);
  }

  createRadarContact(target, source) {
    return createTeamRadarContact(this, target, source);
  }

  updateRadarPassive(enemyTeam, dt) {
    updateTeamRadarPassive(this, enemyTeam, dt);
  }

  serializeRadarPassive() {
    return serializeTeamRadarPassive(this);
  }

  serializeVisionWaves() {
    return serializeTeamVisionWaves(this);
  }

  computeVisibility(enemyTeam) {
    this.visibleEnemyIds = computeTeamVisibility(this, enemyTeam);
  }

  // 某攻击者当前可开火的候选目标:已过滤"真实可见 + 进射程",并带上距离与射界密度。
  // 取最近/锁血/集火分配都基于这同一份候选,确保 AI 与玩家走完全一致的命中判定口径。
  fireCandidates(attacker, enemyTeam) {
    return teamFireCandidates(this, attacker, enemyTeam);
  }

  focusDamageBudget(attacker) {
    return attackerFocusDamageBudget(attacker);
  }

  isFocusWorthy(target) {
    return isFocusWorthy(this.focusHpFrac, target);
  }

  assignFocusTargets(enemyTeam) {
    this._focusTargets = assignTeamFocusTargets(this, enemyTeam);
  }

  pickTargetFor(attacker, enemyTeam) {
    return pickTeamTarget(this, attacker, enemyTeam, this._focusTargets?.get(attacker.id));
  }

  stepCombat(enemyTeam) {
    if (this.aiFocusLowHp) this.assignFocusTargets(enemyTeam);
    // 攻击立即结算；后续攻击者必须看见前一发造成的死亡和状态变化。
    for (const ship of this.getAllShips()) ship.tryAttack(this.match, enemyTeam);
    for (const wingman of this.wingmen) wingman.tryAttack(this.match, enemyTeam);
    for (const scout of this.scouts) scout.tryAttack(this.match, enemyTeam);
  }

  serialize() {
    return {
      seat: this.seat,
      name: this.name,
      color: this.color,
      splitLevel: this.splitLevel,
      loadout: this.match.bunnyHaruhiActive ? { ...this.loadout } : cloneLoadout(this.loadout),
      ...(this.ships.main.bunnyHaruhi ? { bunnyStage: this.bunnyStage ? { ...this.bunnyStage } : null } : {}),
      energy: this.fleetEnergyForShip("main").current,
      maxEnergy: this.fleetEnergyForShip("main").max,
      hullRatio: this.hullRatio(),
      future1096Form: this.future1096Form,
      haruhiFlagship: serializeHaruhiFlagship(this),
      koizumiBarrier: serializeKoizumiBarrier(this),
      shamisenHunt: serializeShamisenHunt(this),
      skillsDisabled: this.areSkillsDisabled(),
      autoScout: {
        enabled: this.autoScout.enabled,
        zoneId: this.autoScout.zoneId,
      },
      cooldowns: {
        scout: this.cooldowns.scout,
        flagship: this.cooldowns.flagship,
        sub1: this.cooldowns.sub1,
        sub2: this.cooldowns.sub2,
      },
      visibleEnemyIds: Array.from(this.visibleEnemyIds),
      radarSweep: serializeTeamRadarSweep(this),
      visionWaves: this.serializeVisionWaves(),
      koizumiImpactWaves: serializeKoizumiImpactWaves(this),
      ships: {
        main: this.ships.main.serialize(),
        sub1: this.ships.sub1.serialize(),
        sub2: this.ships.sub2.serialize(),
      },
      extraShips: this.extraShips.map((ship) => ship.serialize()),
      scouts: this.scouts.filter((item) => item.alive).map((item) => item.serialize()),
      wingmen: this.wingmen.filter((item) => item.alive).map((item) => item.serialize()),
      beams: this.#beamSystem.serialize(),
    };
  }
}
