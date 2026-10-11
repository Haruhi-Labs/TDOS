import { ShipStatus } from "../systems/ship-status.js";
import { WeaponCycle } from "../systems/weapon-cycle.js";
import { resolveHullDamage } from "../systems/hull-damage.js";
import { createWeaponPort, createDamagePort } from "../rules/ship-combat-port.js";
import { ShipNavigation } from "../systems/ship-navigation.js";
import { createShipNavigationPort } from "../rules/navigation-port.js";
// 舰船状态所有者与领域操作。
import { DEFAULT_THROTTLE_GEAR, THROTTLE_GEAR_VALUES, normalizeThrottleToGear } from "../throttle.js";
import { fireArcDensityMultiplier } from "../combat-rules.js";
import { characterDefinition as getCharacterDef, slotLabel } from "../characters.js";
import { clamp, shortestAngleDelta } from "../math.js";
import { rngFor } from "../rng.js";
import { COLLISION_SLOW_DURATION, COLLISION_SLOW_FLOOR } from "../collision-system.js";
import { nextEntityId } from "../model/model-support.js";
import { copyPlainData, freezePlainData } from "../../data/plain-data.js";

export class Ship {
  #base;
  #status = new ShipStatus();
  get effects() { return this.#status.effects; }
  #weapon;
  get cooldown() { return this.#weapon.remaining; }
  set cooldown(value) { this.#weapon.reset(value); }
  #navigation;
  get route() { return this.#navigation.route; }
  set route(value) { this.#navigation.replaceRoute(value); }
  get command() { return this.#navigation.command; }
  set command(value) { this.#navigation.target(value); }
  get forcedKnockback() { return this.#navigation.forcedKnockback; }
  set forcedKnockback(value) { this.#navigation.knockback(value); }

  get base() { return this.#base; }

  constructor(team, key, x, y, facing, options = {}) {
    this.id = nextEntityId(team.match);
    this.kind = "ship";
    this.team = team;
    this.key = key;
    this.slotKey = options.slotKey || key;
    // 角色身份在创建时固定；换队、编队和形态属于独立的运行状态。
    Object.defineProperties(this, {
      characterId: { enumerable: true, value: options.characterId },
      character: { enumerable: true, value: getCharacterDef(options.characterId) },
      entityRole: { enumerable: Boolean(options.entityRole), value: options.entityRole || undefined },
    });
    this.#base = options.baseStats
      ? freezePlainData(copyPlainData(options.baseStats)) : this.character.stats;
    this.isAuxiliary = Boolean(options.isAuxiliary);
    this.attachToMain = options.attachToMain !== false;
    this.roleLabel = options.roleLabel || slotLabel(this.slotKey);
    this.name = `${this.roleLabel}·${this.character.name}`;

    this.x = x;
    this.y = y;
    this.angle = facing;
    this.previousX = x;
    this.previousY = y;
    this.previousAngle = facing;
    this.speed = 0;
    this.throttle = THROTTLE_GEAR_VALUES[DEFAULT_THROTTLE_GEAR];
    this.#navigation = new ShipNavigation(createShipNavigationPort(this), { x, y });
    this.route = null;

    this.maxHp = this.base.hp;
    this.hp = this.maxHp;
    this.maxEnergy = this.base.energy;
    this.energy = this.maxEnergy;
    this.radius = this.base.radius;
    this.alive = true;
    this.collisionSlowUntil = 0; // 撞击粘滞:在此时刻前速度上限被压低并随时间回升
    this.forcedKnockback = null;

    this.#weapon = new WeaponCycle(rngFor(this.team.match).range(0, 0.5));
    this.formationOffset = { ...(options.formationOffset || { x: 0, y: 0 }) };
    // 名字确认:敌方舰船默认隐藏名字；在视野中施放技能或被长门雷达扫中后永久确认。
    this.nameRevealed = false;

    this.team.match.shipEffects.initialize(this);
  }

  isAttached() {
    if (!this.attachToMain) {
      return false;
    }
    if (this.key === "main") {
      return false;
    }
    if (this.key === "sub1") {
      return this.team.splitLevel < 1;
    }
    if (this.key === "sub2") {
      return this.team.splitLevel < 2;
    }
    return true;
  }

  canControl() {
    if (!this.alive || this.isAuxiliary) {
      return false;
    }
    if (this.isControlLocked()) {
      return false;
    }
    if (!this.team.match.rules.navigationAvailable(this)) {
      return false;
    }
    if (this.key === "main") {
      return true;
    }
    if (this.key === "sub1") {
      return this.team.splitLevel >= 1;
    }
    if (this.key === "sub2") {
      return this.team.splitLevel >= 2;
    }
    return false;
  }

  // 位移与碰撞副作用由舰船提交，规则模块只提供几何结果。
  displaceTo(x, y, padding = 0) {
    this.x = this.team.match.clampX(x, padding);
    this.y = this.team.match.clampY(y, padding);
  }

  applyCollisionSlow(until, floor) {
    this.collisionSlowUntil = Math.max(this.collisionSlowUntil, until);
    this.speed = Math.min(this.speed, this.effectiveSpeed() * floor);
  }

  beginForcedKnockback(motion) {
    this.forcedKnockback = { ...motion };
    this.speed = 0;
    this.route = null;
  }

  applyResourcePlan({ hp = this.hp, energy = this.energy }) {
    this.hp = hp;
    this.energy = energy;
  }

  scaleHullCapacity(ratio) {
    this.maxHp = Math.max(1, Math.round(this.maxHp * ratio));
    this.hp = Math.min(this.maxHp, this.hp * ratio);
  }

  configureTraining(stats, position) {
    this.#base = freezePlainData({ ...this.#base, ...copyPlainData(stats) });
    this.maxHp = this.hp = stats.hp;
    this.maxEnergy = this.energy = stats.energy;
    this.x = position.x;
    this.y = position.y;
    this.command = { ...position };
    this.route = null;
    this.speed = 0;
  }

  activateTimedEffect(key, duration) {
    this.#status.activate(key, this.team.match.elapsed + duration, this.team.match.tick);
  }

  silenceUntil(until) { this.#status.extend("silencedUntil", until); }
  stunUntil(until) {
    this.#status.extend("stunnedUntil", until);
    this.applyControlSpeedLimit();
  }
  chargeNextShot(multiplier) { this.#status.charge(multiplier, this.team.match.tick); }

  boostCombatTempo(multiplier) {
    this.speed *= multiplier;
    this.cooldown /= multiplier;
  }

  advanceSpecialRoute(distance, minimumLength, captureRadius) { this.#navigation.advanceSpecialRoute(distance, minimumLength, captureRadius); }

  resetHullCapacity(maxHp) {
    this.maxHp = maxHp;
    this.hp = maxHp;
  }

  rescaleCombatTiming(previousSpeed, previousRate) {
    if (previousSpeed > 0) this.speed *= this.effectiveSpeed() / previousSpeed;
    this.cooldown *= previousRate / this.effectiveFireRate();
  }

  followTarget(point, throttle = this.throttle) {
    this.command = { ...point };
    this.throttle = throttle;
  }

  transferToTeam(destination) {
    this.team.removeAuxiliaryShip(this);
    this.team = destination;
    destination.addAuxiliaryShip(this);
  }

  retireWithoutLoss() {
    this.alive = false;
    this.hp = 0;
    this.speed = 0;
    this.route = null;
  }

  restoreHull(amount) {
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  drainHull(amount) {
    this.hp -= amount;
  }

  restoreEnergy(amount) {
    this.energy = clamp(this.energy + amount, 0, this.maxEnergy);
  }

  spendEnergy(amount) {
    this.energy = Math.max(0, this.energy - amount);
  }

  rescaleFormMotion(speedRatio, cooldownRatio) {
    this.speed = this.alive ? Math.max(0, this.speed * speedRatio) : 0;
    this.cooldown = Math.max(0, this.cooldown * cooldownRatio);
  }

  scaleMotion(speedRatio, cooldownRatio) {
    this.speed *= speedRatio;
    this.cooldown *= cooldownRatio;
  }

  setFlightSpeed(speed) {
    this.speed = speed;
  }

  setFlightHeading(angle) {
    this.angle = angle;
  }

  navigateTo(point, throttle) {
    this.route = null;
    this.command = { ...point };
    if (throttle !== undefined) this.throttle = throttle;
  }

  revealName() {
    this.nameRevealed = true;
  }

  setThrottle(value) {
    this.throttle = normalizeThrottleToGear(value, this.throttle);
  }

  configureThrottleConstraint(resolve) {
    // 舰船持有档位存储；专属效果只提供实时约束，不替换基础属性。
    let throttle = this.throttle;
    Object.defineProperty(this, "throttle", {
      enumerable: true, configurable: true,
      get: () => resolve(throttle),
      set: (value) => { throttle = resolve(value); },
    });
  }

  hasEffect(effectKey) {
    return Number(this.effects[effectKey] || 0) > this.team.match.elapsed;
  }

  isControlLocked() {
    return this.team.match.rules.controlLocked(this);
  }

  isSilenced() {
    return this.team.match.rules.silenced(this);
  }

  isControlImmune() {
    return this.team.match.rules.controlImmune(this);
  }

  clearControlEffects() {
    this.#status.clearControl();
    this.collisionSlowUntil = 0;
    this.forcedKnockback = null;
    this.team.match.shipEffects.clearControl(this);
  }

  isKoizumiOrbActive() {
    return this.team.match.rules.orbActive(this);
  }

  isTargetableByFire() {
    return true;
  }

  isDamageImmune() {
    return this.team.match.rules.damageImmune(this);
  }

  statWithBuffs(statKey, baseValue) {
    return this.team.match.rules.statWithBuffs(this, statKey, baseValue);
  }

  baseSpeed() {
    return this.statWithBuffs("speed", this.base.speed);
  }

  baseTurnRate() {
    return this.statWithBuffs("turnRate", this.base.turnRate);
  }

  baseAcceleration() {
    return this.statWithBuffs("accel", this.base.accel);
  }

  baseEnergyRegen() {
    return this.statWithBuffs("regen", this.base.energyRegen);
  }

  moveEnergyDrain() {
    return this.base.moveDrain;
  }

  effectiveSpeed() {
    return this.team.match.rules.effectiveSpeed(this);
  }

  minimumFlightSpeed() {
    return this.team.match.rules.minimumFlightSpeed(this);
  }

  applyControlSpeedLimit() {
    if (this.team.match.rules.controlStopsFlight(this)) {
      this.speed = 0;
      return;
    }
    const minimumSpeed = this.minimumFlightSpeed();
    this.speed = minimumSpeed > 0 ? Math.max(this.speed, minimumSpeed) : 0;
  }

  advanceFlight(dt, padding = 8) {
    this.displaceTo(this.x + Math.cos(this.angle) * this.speed * dt, this.y + Math.sin(this.angle) * this.speed * dt, padding);
  }

  // 撞击粘滞:返回当前速度上限相对正常的比例。刚撞上为 COLLISION_SLOW_FLOOR,
  // 之后在 COLLISION_SLOW_DURATION 秒内线性回升到 1。
  collisionSpeedFactor() {
    const now = this.team.match.elapsed;
    if (!this.collisionSlowUntil || now >= this.collisionSlowUntil) {
      return 1;
    }
    const remain = this.collisionSlowUntil - now; // 0..DURATION
    const progress = clamp(1 - remain / COLLISION_SLOW_DURATION, 0, 1); // 撞击瞬间0 → 结束1
    return COLLISION_SLOW_FLOOR + (1 - COLLISION_SLOW_FLOOR) * progress;
  }

  effectiveTurnRate() {
    let value = this.baseTurnRate() * this.team.turnModifierForShip(this);
    value *= this.team.match.rules.turnRateMultiplier(this.team);
    return value;
  }

  effectiveFormationTurnRate() {
    let value = this.baseTurnRate();
    value *= this.team.match.rules.turnRateMultiplier(this.team, true);
    return value * (this.team.fleetMemberCountForShip(this) >= 3 ? 1.55 : 1.28);
  }

  effectiveVision() {
    return this.team.match.rules.effectiveVision(this);
  }

  effectiveRange() {
    return this.statWithBuffs("range", this.base.range);
  }

  effectiveDamage() {
    // 末乘难度数值缩放(简单0.8/普通1.0/困难1.2/极限1.0);玩家队 statMult 恒为1,不受影响。
    return this.statWithBuffs("damage", this.base.damage) * (this.team.statMult || 1);
  }

  effectiveFireRate() {
    return this.team.match.rules.effectiveFireRate(this);
  }

  damageTakenMultiplier() {
    return this.team.match.rules.damageTakenMultiplier(this);
  }

  markActiveSkillEffectStarted(key) { this.#status.mark(key, this.team.match.tick); }
  canClearActiveSkillEffect(key, preserveCurrentTick) {
    return this.#status.canClear(key, preserveCurrentTick, this.team.match.tick);
  }
  clearTimedEffect(key, preserveCurrentTick) {
    return this.#status.clear(key, preserveCurrentTick, this.team.match.tick, this.team.match.elapsed);
  }
  forgetActiveSkillEffect(key) { this.#status.forget(key); }
  consumeNextShotMultiplier() { return this.#status.consumeCharge(); }

  clearActiveSkillBuffs({ preserveCurrentTick = true } = {}) {
    return this.team.match.shipEffects.clearPositive(this, preserveCurrentTick);
  }

  clearNegativeEffects() {
    const cleared = this.isSilenced()
      || this.hasEffect("stunnedUntil")
      || this.team.match.shipEffects.hasNegative(this)
      || this.collisionSlowUntil > this.team.match.elapsed
      || Boolean(this.forcedKnockback);
    this.clearControlEffects();
    this.team.match.shipEffects.clearNegative(this);
    return cleared;
  }

  routeConstraintProfile() { return this.#navigation.routeConstraintProfile(); }
  setBezierRoute(controlX, controlY, endX, endY, throttle, anchorToMain = true) { return this.#navigation.setBezierRoute(controlX, controlY, endX, endY, throttle, anchorToMain); }
  setRouteControl(controlX, controlY, resetProgress = false) { return this.#navigation.setRouteControl(controlX, controlY, resetProgress); }
  setRouteEndpoint(endX, endY, resetProgress = false) { return this.#navigation.setRouteEndpoint(endX, endY, resetProgress); }
  clearRoute() { return this.#navigation.clearRoute(); }
  expireClawMarks() {
    this.team.match.shipEffects.expireMarks(this);
  }

  activeClawMarks() {
    return this.team.match.rules.activeClawMarks(this);
  }

  registerClawHit(claw, match, source = null) {
    return this.team.match.shipEffects.registerClawHit(this, claw, match, source);
  }

  update(dt) {
    this.expireClawMarks();
    if (!this.alive) {
      return;
    }

    const match = this.team.match;
    this.previousX = this.x;
    this.previousY = this.y;
    this.previousAngle = this.angle;
    this.#weapon.advance(dt);

    if (this.updateForcedKnockback()) {
      return;
    }

    if (this.isControlLocked()) {
      this.applyControlSpeedLimit();
      // 禁控仍拒绝输入和自动转向，刀锋只保留当前朝向上的飞行。
      if (this.minimumFlightSpeed() > 0) this.advanceFlight(dt);
      return;
    }

    if (this.team.match.shipEffects.advanceMovement(this, dt)) {
      return;
    }

    this.#navigation.advance(dt);
  }

  updateForcedKnockback() { return this.#navigation.updateForcedKnockback(); }

  broadsideMultiplier(target) {
    const toTarget = Math.atan2(target.y - this.y, target.x - this.x);
    const relative = Math.abs(shortestAngleDelta(this.angle, toTarget));
    return fireArcDensityMultiplier(relative, this.team.match.rules.improvedFireArcs(this.team));
  }

  tryAttack(match, enemyTeam) { return this.#weapon.fire(createWeaponPort(this, match, enemyTeam)); }

  takeDamage(amount, source = null, match = null, context = undefined) {
    return resolveHullDamage(createDamagePort(this, source, match), amount, context);
  }

  applyHullDamage(amount, floor) {
    const before = this.hp;
    this.hp = Math.max(floor, this.hp - amount);
    return before - this.hp;
  }

  retireAfterDamage() {
    this.alive = false;
    this.speed = 0;
    this.clearRoute();
  }

  serialize() {
    return this.team.match.projectShip(this);
  }
}
