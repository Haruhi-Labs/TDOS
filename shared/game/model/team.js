import { CHARACTER_ASSEMBLY } from "../rules/character-assembly.js";
import { FleetRoster } from "../systems/fleet-roster.js";
import { FleetPerception } from "../systems/visibility.js";
import { AUTO_SCOUT_COOLDOWN_MULTIPLIER, MANUAL_SCOUT_COOLDOWN, SCOUT_LAUNCH_COST } from "../combat-rules.js";
import { AircraftOperations } from "../systems/aircraft-operations.js";
import { createAircraftPort } from "../rules/aircraft-port.js";
import { SkillCycle } from "../systems/skill-cycle.js";
import { createTeamSkillPort } from "../rules/team-skill-port.js";
import { FleetFormation } from "../systems/fleet-formation.js";
import { createFormationPort } from "../rules/formation-port.js";
import { BeamSystem } from "../systems/beam-system.js";
import { createTeamBeamPort, beamCasterState } from "../rules/beam-port.js";
// 舰队状态所有者与领域操作。
import { DEFAULT_TEAM_LOADOUT, normalizeLoadout } from "../characters.js";
import { rotateOffset } from "../math.js";
import { serializeShipStatusEffects, statusEffectNames } from "../status-effects.js";
import { visibilityInputs, serializeRadarPassive as serializeTeamRadarPassive } from "../visibility-radar.js";
import { FleetFireControl } from "../targeting-system.js";
import { projectVolleyAttackers, fireCandidates as teamFireCandidates, pickTeamTarget } from "../rules/fire-control.js";
import { Ship } from "../model/ship.js";
import { BEAM_CHARGE_DURATION, BEAM_VISUAL_DURATION, BEAM_BASE_RANGE, BEAM_HIT_RADIUS, beamDamageRatioForHitCount, FLAGSHIP_TURN_PENALTIES, TEAM_COLORS, TEAM_PROJECTILE_COLORS } from "../model/model-support.js";

export class Team {
  #statMult;
  get statMult() { return this.#statMult; }
  #aiFocusLowHp;
  get aiFocusLowHp() { return this.#aiFocusLowHp; }
  #forceSkillsDisabled;
  get forceSkillsDisabled() { return this.#forceSkillsDisabled; }
  #forceCharacterSkillsDisabled;
  get forceCharacterSkillsDisabled() { return this.#forceCharacterSkillsDisabled; }
  #forceScoutsDisabled;
  get forceScoutsDisabled() { return this.#forceScoutsDisabled; }
  #damageFloorRatio;
  get damageFloorRatio() { return this.#damageFloorRatio; }
  #focusHpFrac;
  get focusHpFrac() { return this.#focusHpFrac; }
  setRestrictions({ skills = this.#forceSkillsDisabled, characters = this.#forceCharacterSkillsDisabled, scouts = this.#forceScoutsDisabled }) {
    this.#forceSkillsDisabled = Boolean(skills);
    this.#forceCharacterSkillsDisabled = Boolean(characters);
    this.#forceScoutsDisabled = Boolean(scouts);
  }

  #perception = new FleetPerception();
  #fireControl = new FleetFireControl();
  get visibleEnemyIds() { return this.#perception.visibleIds; }

  #characters;
  get effects() { return this.#characters.effects; }
  #roster;
  get extraShips() { return this.#roster.extra; }
  get ships() { return this.#roster.ships; }
  #aircraft;
  get scouts() { return this.#aircraft.scouts; }
  get wingmen() { return this.#aircraft.wingmen; }
  get autoScout() { return this.#aircraft.autoScout; }
  #skills;
  get cooldowns() { return this.#skills.cooldowns; }
  startCooldown(key, duration) { this.#skills.startCooldown(key, duration); }
  #formation;
  get splitLevel() { return this.#formation.level; }
  #beamSystem;
  constructor(match, seat, name, spawnX, spawnY, facing, options = {}) {
    this.#roster = new FleetRoster(this);
    Object.defineProperties(this, {
      match: { enumerable: true, value: match },
      seat: { enumerable: true, value: seat },
      name: { enumerable: true, value: name },
      color: { enumerable: true, value: TEAM_COLORS[seat] },
      projectileColor: { enumerable: true, value: TEAM_PROJECTILE_COLORS[seat] },
    });
    Object.defineProperty(this, "loadout", {
      enumerable: true,
      value: Object.freeze(normalizeLoadout(options.loadout || DEFAULT_TEAM_LOADOUT, DEFAULT_TEAM_LOADOUT)),
    });

    this.#formation = new FleetFormation(createFormationPort(this), FLAGSHIP_TURN_PENALTIES);
    // 单人难度对本队的影响(仅当本队由AI控制时,由 MatchSimulation 按难度让分表写入):
    //  statMult    敌方数值缩放(简单0.8/普通1.0/困难1.2/极限1.0),作用于本队舰船的血量与伤害;
    //  aiFocusLowHp 极限难度专属:开火时锁定射程内血量最低的敌人(其余难度仍与玩家同规则"取最近")。
    // 玩家队没有 BotController,二者保持默认(1 / false),行为与既有完全一致。
    this.#statMult = 1;
    this.#aiFocusLowHp = false;
    // 独立教程使用的安全门：敌军全程禁用技能，友军在自由战前锁血至 1/4。
    // 常规对战均保持默认值，不改变既有规则。
    this.#forceSkillsDisabled = false;
    this.#forceCharacterSkillsDisabled = false;
    this.#forceScoutsDisabled = false;
    this.#damageFloorRatio = 0;
    // 极限集火只对"残血"目标生效(血量 ≤ 该值×自身上限才值得转火去收人头);
    // 健康目标仍走取最近以保证射界/火力密度。0=从不集火(等同取最近),1=对任何目标都集火。
    this.#focusHpFrac = 0.5;
    this.#skills = new SkillCycle(createTeamSkillPort(this, {
      activateSupport: (duration) => this.#characters.castSupport(duration),
      activateSponsor: (duration) => this.#characters.activateSponsor(duration),
    }));
    this.#aircraft = new AircraftOperations(createAircraftPort(this), {
      autoCooldownMultiplier: AUTO_SCOUT_COOLDOWN_MULTIPLIER, scoutCooldown: MANUAL_SCOUT_COOLDOWN, scoutCost: SCOUT_LAUNCH_COST,
    });

    this.#characters = CHARACTER_ASSEMBLY.createTeam(this, facing);

    const sub1FormationOffset = { x: -36, y: 22 };
    const sub2FormationOffset = { x: -36, y: -22 };
    const sub1SpawnOffset = rotateOffset(sub1FormationOffset.x * 0.5, sub1FormationOffset.y * 0.5, facing);
    const sub2SpawnOffset = rotateOffset(sub2FormationOffset.x * 0.5, sub2FormationOffset.y * 0.5, facing);

    this.#roster.initialize({
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
    });

    this.#characters.initializeMembers();

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

  get future1096Form() {
    return this.#characters.form;
  }

  future1096FormDefinition(form = this.future1096Form) {
    return this.#characters.formDefinition(form);
  }

  future1096StatMultiplier(statKey) {
    return this.#characters.statMultiplier(statKey);
  }

  future1096DamageTakenMultiplier() {
    return this.#characters.damageMultiplier();
  }

  switchFuture1096Form() {
    return this.#characters.switchForm();
  }

  hasActiveSponsor() {
    return this.#characters.sponsorActive();
  }

  hasActiveVisionWaveSkill() {
    return this.visionWaveSkill.activeUntil > this.match.elapsed;
  }

  getPlayerShips() {
    return [this.ships.main, this.ships.sub1, this.ships.sub2];
  }

  canAcceptScout(scout) { return this.#aircraft.acceptsScout(scout); }
  addScout(scout) { return this.#aircraft.addScout(scout); }
  removeScout(scout) { this.#aircraft.removeScout(scout); }
  canAcceptWingman(wingman) { return this.#aircraft.acceptsWingman(wingman); }
  addWingman(wingman) { return this.#aircraft.addWingman(wingman); }
  removeWingman(wingman) { this.#aircraft.removeWingman(wingman); }

  activateHaruhiSupport(duration, random) {
    return this.#characters.activateSupport(duration, random);
  }

  addAuxiliaryShip(ship) {
    return this.#roster.add(ship);
  }

  canAcceptAuxiliaryShip(ship) { return this.#roster.accepts(ship); }

  removeAuxiliaryShip(ship) {
    return this.#roster.remove(ship);
  }

  getAllShips() {
    return [...this.getPlayerShips(), ...this.extraShips];
  }

  configureAiHandicap({ focusLowHp, statMult }) {
    this.#aiFocusLowHp = focusLowHp;
    this.applyAiStatMult(statMult);
  }

  setTrainingDamageFloor(ratio) {
    this.#damageFloorRatio = ratio;
  }

  configureTrainingFleet(stats, positions) {
    this.#forceCharacterSkillsDisabled = true;
    this.configureFormation(2);
    for (const ship of this.getAllShips()) ship.configureTraining(stats, positions[ship.key] || positions.main);
  }

  // 难度数值缩放:按 mult 缩放本队所有舰船的最大/当前血量(伤害缩放在 effectiveDamage 中按 statMult 动态生效)。
  // 幂等——以已生效的 statMult 为基准取比值,重复调用同一倍率不再叠加。
  applyAiStatMult(mult) {
    const m = Number(mult) > 0 ? Number(mult) : 1;
    const prev = this.#statMult || 1;
    if (m !== prev) {
      const ratio = m / prev;
      for (const ship of this.getAllShips()) {
        ship.scaleHullCapacity(ratio);
      }
    }
    this.#statMult = m;
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
  fleetEnergyForShip(shipOrKey) { return this.#formation.fleetEnergyForShip(typeof shipOrKey === "string" ? shipOrKey : shipOrKey.key); }
  availableEnergyForShip(shipOrKey) { return this.fleetEnergyForShip(shipOrKey).current; }
  spendEnergyForShip(shipOrKey, cost) { return this.#formation.spendEnergyForShip(typeof shipOrKey === "string" ? shipOrKey : shipOrKey.key, cost); }

  listShipBuffs(ship) {
    return statusEffectNames(serializeShipStatusEffects(ship));
  }

  areSkillsDisabled() {
    return this.#forceSkillsDisabled || this.#forceCharacterSkillsDisabled;
  }

  areScoutsDisabled() {
    return this.#forceSkillsDisabled || this.#forceScoutsDisabled;
  }

  cooldownStep(dt) {
    return this.#characters.cooldownStep(dt);
  }

  clearActiveTeamSkillBuffs({ preserveCurrentTick = true } = {}) {
    return this.#characters.clearPositive(preserveCurrentTick);
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

  configureAutoScout(enabled, zoneId = 5) { return this.#aircraft.configureAutoScout(enabled, zoneId); }

  sponsorRegeneration(dt) {
    this.#characters.regenerate(dt);
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
    this.#characters.afterMovement(dt);
    this.#aircraft.advance(dt);
    this.advanceBeams(dt);
    this.#aircraft.collectRetired();
  }

  maybeAutoLaunchScout() { return this.#aircraft.maybeAutoLaunchScout(); }
  assignScoutMission(scout, options = {}) { return this.#aircraft.assignScoutMission(scout, options); }
  launchScout(zoneId, options = {}) { return this.#aircraft.launchScout(zoneId, options); }
  launchWingman(zoneId) { return this.#aircraft.launchWingman(zoneId); }
  castFlagshipSkill() { return this.#skills.castFlagship(); }
  castSubSkill(key, options = {}) { return this.#skills.castSub(key, options); }

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

  resolveChargedBeams(enemyTeam) {
    this.#beamSystem.resolve(enemyTeam);
  }

  serializeRadarPassive() {
    return serializeTeamRadarPassive(this);
  }

  computeVisibility(enemyTeam) {
    this.#perception.sample(visibilityInputs(this, enemyTeam));
  }

  // 某攻击者当前可开火的候选目标:已过滤"真实可见 + 进射程",并带上距离与射界密度。
  // 取最近/锁血/集火分配都基于这同一份候选,确保 AI 与玩家走完全一致的命中判定口径。
  fireCandidates(attacker, enemyTeam) {
    return teamFireCandidates(this, attacker, enemyTeam);
  }

  pickTargetFor(attacker, enemyTeam) {
    return pickTeamTarget(this, attacker, enemyTeam, this.#fireControl);
  }

  stepCombat(enemyTeam) {
    if (this.#aiFocusLowHp) this.#fireControl.prepare(projectVolleyAttackers(this, enemyTeam), this.#focusHpFrac);
    // 攻击立即结算；后续攻击者必须看见前一发造成的死亡和状态变化。
    for (const ship of this.getAllShips()) ship.tryAttack(this.match, enemyTeam);
    for (const wingman of this.wingmen) wingman.tryAttack(this.match, enemyTeam);
    for (const scout of this.scouts) scout.tryAttack(this.match, enemyTeam);
  }

  serializeBeams() { return this.#beamSystem.serialize(); }

  serialize() { return CHARACTER_ASSEMBLY.projectTeam(this); }
}
