import { ShipNavigation } from "../systems/ship-navigation.js";
import { createShipNavigationPort } from "../rules/navigation-port.js";
// 舰船状态所有者与领域操作。
import { DEFAULT_THROTTLE_GEAR, THROTTLE_GEAR_VALUES, normalizeThrottleToGear } from "../throttle.js";
import { fireArcDensityMultiplier } from "../combat-rules.js";
import { characterDefinition as getCharacterDef, slotLabel } from "../characters.js";
import { clamp, distance, shortestAngleDelta } from "../math.js";
import { rngFor } from "../rng.js";
import { COLLISION_SLOW_DURATION, COLLISION_SLOW_FLOOR } from "../collision-system.js";
import { normalizeDamageContext } from "../damage.js";
import { FORMATION_DAMAGE_SHARE, nextEntityId } from "../model/model-support.js";
import { copyPlainData, freezePlainData } from "../../data/plain-data.js";

export class Ship {
  #base;
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

    this.cooldown = rngFor(this.team.match).range(0, 0.5);
    this.formationOffset = { ...(options.formationOffset || { x: 0, y: 0 }) };
    // 名字确认:敌方舰船默认隐藏名字；在视野中施放技能或被长门雷达扫中后永久确认。
    this.nameRevealed = false;

    this.effects = {
      reliableUntil: 0,
      bladeQueenUntil: 0,
      catPawUntil: 0,
      silencedUntil: 0,
      stunnedUntil: 0,
      nextShotDamageMultiplier: 1,
    };
    // 记录主动技能增益的权威生效 tick。多人同一 tick 的双方输入视为同时发生，
    // 后处理的净化不能因座位处理顺序清掉对方刚刚开启的技能。
    this.activeSkillEffectStartedTicks = Object.create(null);
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
    this.effects[key] = this.team.match.elapsed + duration;
    this.markActiveSkillEffectStarted(key);
  }

  silenceUntil(until) {
    this.effects.silencedUntil = Math.max(Number(this.effects.silencedUntil) || 0, until);
  }

  stunUntil(until) {
    this.effects.stunnedUntil = Math.max(this.effects.stunnedUntil || 0, until);
    this.applyControlSpeedLimit();
  }

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
    this.effects.silencedUntil = 0;
    this.effects.stunnedUntil = 0;
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

  markActiveSkillEffectStarted(effectKey) {
    this.activeSkillEffectStartedTicks[effectKey] = this.team.match.tick;
  }

  canClearActiveSkillEffect(key, preserveCurrentTick) {
    return !preserveCurrentTick || this.activeSkillEffectStartedTicks[key] !== this.team.match.tick;
  }

  clearTimedEffect(key, preserveCurrentTick) {
    if (!this.canClearActiveSkillEffect(key, preserveCurrentTick)) return false;
    const cleared = this.hasEffect(key);
    this.effects[key] = 0;
    delete this.activeSkillEffectStartedTicks[key];
    return cleared;
  }

  forgetActiveSkillEffect(key) {
    delete this.activeSkillEffectStartedTicks[key];
  }

  consumeNextShotMultiplier() {
    const multiplier = this.effects.nextShotDamageMultiplier;
    this.effects.nextShotDamageMultiplier = 1;
    this.forgetActiveSkillEffect("nextShotDamageMultiplier");
    return multiplier;
  }

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
    this.cooldown = Math.max(0, this.cooldown - dt);

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

  tryAttack(match, enemyTeam) {
    if (
      !this.alive
      || this.cooldown > 0
      || !this.team.match.rules.weaponAvailable(this)
      || this.isControlLocked()
    ) {
      return;
    }
    const target = this.team.pickTargetFor(this, enemyTeam);
    if (!target) {
      return;
    }

    const targetDistance = distance(this.x, this.y, target.x, target.y);
    const predictedX = target.x + (target.speed || 0) * Math.cos(target.angle || 0) * (targetDistance / 300);
    const predictedY = target.y + (target.speed || 0) * Math.sin(target.angle || 0) * (targetDistance / 300);
    const spread = clamp(targetDistance / 18, 4, 26);
    const aimX = predictedX + rngFor(this.team.match).range(-spread, spread);
    const aimY = predictedY + rngFor(this.team.match).range(-spread, spread);
    const fireDensity = this.broadsideMultiplier(target);
    if (fireDensity <= 0) {
      return;
    }
    const damage = this.team.match.shipEffects.prepareShotDamage(this, this.effectiveDamage(), match);

    const projectileProfile = this.team.match.rules.projectileProfile(this);
    match.spawnProjectile({
      team: this.team,
      source: this,
      x: this.x,
      y: this.y,
      targetX: match.clampX(aimX, 0),
      targetY: match.clampY(aimY, 0),
      damage,
      speed: 240,
      hitRadius: 8,
      ...projectileProfile,
    });
    match.recordAttack(this.team.seat, "projectile");
    this.cooldown = 1 / Math.max(0.01, this.effectiveFireRate() * fireDensity);
  }

  takeDamage(amount, _source = null, match = null, context = undefined) {
    if (!this.team.match.rules.canDamage(_source, this)) return false;
    if (!this.alive) {
      return;
    }
    if (this.isDamageImmune()) {
      return;
    }
    const { share, kind: damageKind } = normalizeDamageContext(context);
    // “猫爪印记”只放大子弹和攻击命中特效。先乘二再分摊，保证整次攻击总伤害正确；
    // 分摊递归以 share=false 投递，不会因份额碰巧落到猎杀目标而再次乘二。
    if (share) {
      amount *= this.team.match.rules.attackDamageMultiplier(_source, this, damageKind);
    }
    // 不分离(本船所在编队还有其它存活船):本次伤害的 FORMATION_DAMAGE_SHARE 比例平摊给其它船,
    // 本船只承担其余部分。平摊出去的份额以 share=false 再投递,不会二次平摊(避免连锁/递归)。
    if (share) {
      const others = this.team.fleetMembersForShip(this).filter((m) => m !== this && m.alive);
      if (others.length > 0) {
        const shared = amount * FORMATION_DAMAGE_SHARE;
        amount -= shared;
        const per = shared / others.length;
        for (const m of others) {
          m.takeDamage(per, _source, match, { share: false, kind: damageKind });
        }
      }
    }
    const finalAmount = amount * this.damageTakenMultiplier();
    const damageFloor = this.maxHp * clamp(Number(this.team.damageFloorRatio) || 0, 0, 1);
    const hpBefore = this.hp;
    this.hp = Math.max(damageFloor, this.hp - finalAmount);
    if (match) {
      match.recordDamage(_source, this, hpBefore - this.hp, damageKind);
    }
    if (this.hp > 0) {
      return;
    }
    this.alive = false;
    this.speed = 0;
    this.route = null;
    this.team.resolvePostCasualtyState(match);
    if (match) {
      if (this.team.match.rules.countsForVictory(this)) match.recordShipLoss(this.team.seat);
      match.spawnBurst(this.x, this.y, "#ff9d7d", 10);
      match.onShipDestroyed(this, _source);
    }
  }

  serialize() {
    return this.team.match.projectShip(this);
  }
}
