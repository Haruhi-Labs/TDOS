// 舰船状态所有者与领域操作。
import { DEFAULT_THROTTLE_GEAR, THROTTLE_GEAR_VALUES, normalizeThrottleToGear } from "../throttle.js";
import { fireArcDensityMultiplier } from "../combat-rules.js";
import { characterDefinition as getCharacterDef, slotLabel } from "../characters.js";
import { clamp, distance, dot, lerp, quadraticLengthApprox, quadraticPoint, quadraticStartCurvature, rotateOffset, shortestAngleDelta } from "../math.js";
import { rngFor } from "../rng.js";
import { serializeShipStatusEffects, statusEffectNames } from "../status-effects.js";
import { COLLISION_SLOW_DURATION, COLLISION_SLOW_FLOOR } from "../collision-system.js";
import { dispelKoizumiOrb, serializeKoizumiOrb, updateKoizumiOrb } from "../koizumi-orb.js";
import { haruhiOtherworlderReady } from "../haruhi-flagship.js";
import { createHaruhiHeroPowerShockState, serializeHaruhiHeroPowerShock } from "../haruhi-hero-power.js";
import { DAMAGE_KIND, normalizeDamageContext } from "../damage.js";
import { purgeBunnyReliable } from "../bunny-haruhi-companion.js";
import { serializeBunnyCompanion } from "../bunny-companion-runtime.js";
import { createBunnyHaruhiState, cleanseBunnyStageControl, purgeBunnyForm, resolveBunnyThrottle } from "../bunny-haruhi.js";
import { BUNNY_HARUHI_CHARACTER, serializeBunnyShip } from "../bunny-haruhi-runtime.js";
import { Projectile } from "../model/projectile.js";
import { FORMATION_DAMAGE_SHARE, nextEntityId } from "../model/model-support.js";

export class Ship {
  constructor(team, key, x, y, facing, options = {}) {
    this.id = nextEntityId(team.match);
    this.kind = "ship";
    this.team = team;
    this.key = key;
    this.slotKey = options.slotKey || key;
    this.characterId = options.characterId;
    this.character = getCharacterDef(this.characterId);
    this.base = options.baseStats || this.character.stats;
    if (options.entityRole) this.entityRole = options.entityRole;
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
    this.command = { x, y };
    this.route = null;

    this.maxHp = this.base.hp;
    this.hp = this.maxHp;
    this.maxEnergy = this.base.energy;
    this.energy = this.maxEnergy;
    this.radius = this.base.radius;
    this.alive = true;
    this.collisionSlowUntil = 0; // 撞击粘滞:在此时刻前速度上限被压低并随时间回升
    this.forcedKnockback = null;
    this.koizumiOrb = null;
    this.heroPowerShock = createHaruhiHeroPowerShockState();

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
    this.clawMarks = {
      sourceSeat: null,
      stacks: 0,
      required: 4,
      expiresAt: 0,
      color: "#ffc0bd",
    };
    // 记录主动技能增益的权威生效 tick。多人同一 tick 的双方输入视为同时发生，
    // 后处理的净化不能因座位处理顺序清掉对方刚刚开启的技能。
    this.activeSkillEffectStartedTicks = Object.create(null);
    if (this.character === BUNNY_HARUHI_CHARACTER) {
      this.bunnyHaruhi = createBunnyHaruhiState();
      // 仅新角色拦截最终落值，覆盖动作、航线和AI直接赋值，不改旧舰船属性形态。
      let throttle = this.throttle;
      Object.defineProperty(this, "throttle", {
        enumerable: true, configurable: true,
        get: () => resolveBunnyThrottle(this.bunnyHaruhi, throttle, !this.team.areSkillsDisabled(), this.team.match.elapsed),
        set: (value) => { throttle = resolveBunnyThrottle(this.bunnyHaruhi, value, !this.team.areSkillsDisabled(), this.team.match.elapsed); },
      });
    }
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
    this.base = { ...this.base, ...stats };
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

  advanceSpecialRoute(traveledDistance, minimumLength, captureRadius) {
    if (!this.route) return;
    this.route.t = clamp((Number(this.route.t) || 0) + traveledDistance / Math.max(minimumLength, Number(this.route.length) || 1), 0, 1);
    if (this.route.t >= 1 && Math.hypot(this.route.p2.x - this.x, this.route.p2.y - this.y) <= captureRadius) {
      this.route = null;
    } else {
      this.enforceRouteFeasibility(this.route.p1, false);
    }
  }

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
    this.heroPowerShock = createHaruhiHeroPowerShockState();
    this.collisionSlowUntil = 0;
    this.forcedKnockback = null;
    if (this.bunnyStageExposure) this.bunnyStageExposure = cleanseBunnyStageControl(this.bunnyStageExposure);
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

  clearActiveSkillBuffs({ preserveCurrentTick = true } = {}) {
    let cleared = false;
    if (this.bunnyReliable) {
      const next = purgeBunnyReliable(this.bunnyReliable, preserveCurrentTick ? this.team.match.tick : -1);
      if (next.suppressed !== this.bunnyReliable.suppressed) cleared = true;
      this.bunnyReliable = next;
    }
    if (this.bunnyHaruhi) {
      const old = this.bunnyHaruhi;
      const next = purgeBunnyForm(old, preserveCurrentTick ? this.team.match.tick : -1);
      if (next.positiveSuppressed !== old.positiveSuppressed || next.immunityUntil !== old.immunityUntil) cleared = true;
      this.bunnyHaruhi = next;
    }
    const canClear = (effectKey) => (
      !preserveCurrentTick
      || this.activeSkillEffectStartedTicks[effectKey] !== this.team.match.tick
    );
    const clearTimedEffect = (effectKey) => {
      if (!canClear(effectKey)) {
        return;
      }
      if (this.hasEffect(effectKey)) {
        cleared = true;
      }
      this.effects[effectKey] = 0;
      delete this.activeSkillEffectStartedTicks[effectKey];
    };

    clearTimedEffect("reliableUntil");
    clearTimedEffect("bladeQueenUntil");
    clearTimedEffect("catPawUntil");
    if (this.koizumiOrb && canClear("koizumiOrb")) {
      dispelKoizumiOrb(this);
      cleared = true;
      delete this.activeSkillEffectStartedTicks.koizumiOrb;
    }
    if (canClear("nextShotDamageMultiplier")) {
      if (this.effects.nextShotDamageMultiplier > 1) {
        cleared = true;
      }
      this.effects.nextShotDamageMultiplier = 1;
      delete this.activeSkillEffectStartedTicks.nextShotDamageMultiplier;
    }
    return cleared;
  }

  clearNegativeEffects() {
    const now = this.team.match.elapsed;
    const cleared = this.isSilenced()
      || this.hasEffect("stunnedUntil")
      || this.heroPowerShock.recoveryUntil > now
      || (this.bunnyStageExposure?.recoveryUntil || 0) > now
      || this.collisionSlowUntil > now
      || Boolean(this.forcedKnockback)
      || this.activeClawMarks().stacks > 0;
    this.clearControlEffects();
    this.clawMarks.sourceSeat = null;
    this.clawMarks.stacks = 0;
    this.clawMarks.expiresAt = 0;
    return cleared;
  }

  routeAnchorShip() {
    if (this.route && this.route.anchorToMain) {
      const main = this.team.ships.main;
      if (main && main.alive) {
        return main;
      }
    }
    return this;
  }

  routeConstraintProfile() {
    const anchor = this.routeAnchorShip();
    const throttleFactor = 0.2 + clamp(this.throttle, 0.25, 1.4) * 0.38;
    const turnRate = Math.max(0.05, anchor.effectiveTurnRate() * throttleFactor);
    const speedRef = Math.max(anchor.speed, anchor.effectiveSpeed() * Math.max(0.32, this.throttle), 8);
    let minTurnRadius = clamp((speedRef / turnRate) * 1.05, 30, 560);
    // 起点切线锁定朝向:把控制点的横向偏角收得很小(~8-12°,航速越快越直),使「画出来的曲线
    // 离开舰船的方向」≈「舰船实际航向」,曲线与航迹在近场一致(实测切线偏移由峰值~77°降到~10°)。
    // 代价:不再能拖出大幅S形/强凹凸弯(单条二次贝塞尔无法既起点对齐朝向又侧弯)。
    // 反向掉头另由下方 dynamicDeviation 放宽(掉头必须侧弓一点,否则二次曲线会退化成尖点)。
    let maxStartDeviation = (Math.PI / 180) * clamp(14 - speedRef * 0.03, 8, 12);
    minTurnRadius *= this.team.match.rules.routeTurnRadiusMultiplier(this.team);
    maxStartDeviation *= this.team.match.rules.routeDeviationMultiplier(this.team);
    const minForward = clamp(minTurnRadius * 0.34, 16, 200);
    const heading = anchor.angle;
    const forward = { x: Math.cos(heading), y: Math.sin(heading) };
    const left = { x: -forward.y, y: forward.x };
    return {
      anchor,
      minTurnRadius,
      maxStartDeviation,
      minForward,
      forward,
      left,
    };
  }

  suggestControlForCurrentEndpoint() {
    if (!this.route) {
      return { x: this.x, y: this.y };
    }
    const profile = this.routeConstraintProfile();
    const p0 = { x: profile.anchor.x, y: profile.anchor.y };
    const relX = this.route.p2.x - p0.x;
    const relY = this.route.p2.y - p0.y;
    const ex = dot(relX, relY, profile.forward.x, profile.forward.y);
    const ey = dot(relX, relY, profile.left.x, profile.left.y);

    const bearingToEnd = Math.atan2(relY, relX);
    const deltaToEnd = shortestAngleDelta(profile.anchor.angle, bearingToEnd);
    const sideSign = deltaToEnd >= 0 ? 1 : -1;
    let sideEy = ey;
    if (ex < 0 && Math.abs(sideEy) < profile.minTurnRadius * 0.08) {
      sideEy = sideSign * profile.minTurnRadius * 0.34;
    }

    let u = Math.max(profile.minForward, Math.sqrt(Math.max(0, Math.abs(sideEy) * profile.minTurnRadius * 0.5)));
    if (ex < 0) {
      u = Math.max(u, profile.minForward + Math.abs(ex) * 0.24);
    } else {
      u = Math.max(u, ex * 0.24);
    }
    const maxLat = Math.max(8, u * Math.tan(profile.maxStartDeviation));
    const v = clamp(sideEy * 0.34, -maxLat, maxLat);
    return {
      x: p0.x + profile.forward.x * u + profile.left.x * v,
      y: p0.y + profile.forward.y * u + profile.left.y * v,
    };
  }

  enforceRouteFeasibility(desiredControlPoint = null, resetProgress = true) {
    if (!this.route) {
      return;
    }
    const profile = this.routeConstraintProfile();
    const p0 = { x: profile.anchor.x, y: profile.anchor.y };
    const match = this.team.match;
    this.route.p0 = p0;
    this.route.p2 = {
      x: match.clampX(this.route.p2.x, match.mapPadding),
      y: match.clampY(this.route.p2.y, match.mapPadding),
    };

    const desired = desiredControlPoint || this.route.p1 || this.suggestControlForCurrentEndpoint();
    const relX = desired.x - p0.x;
    const relY = desired.y - p0.y;
    let u = dot(relX, relY, profile.forward.x, profile.forward.y);
    let v = dot(relX, relY, profile.left.x, profile.left.y);

    const endRelX = this.route.p2.x - p0.x;
    const endRelY = this.route.p2.y - p0.y;
    const ex = dot(endRelX, endRelY, profile.forward.x, profile.forward.y);
    const ey = dot(endRelX, endRelY, profile.left.x, profile.left.y);
    const bearingToEnd = Math.atan2(endRelY, endRelX);
    const deltaToEnd = shortestAngleDelta(profile.anchor.angle, bearingToEnd);
    const sideSign = deltaToEnd >= 0 ? 1 : -1;
    const reverseRatio = clamp(-ex / Math.max(80, profile.minTurnRadius * 1.2), 0, 1.45);
    const dynamicDeviation = profile.maxStartDeviation + reverseRatio * (Math.PI / 180) * 40;
    const dFromCurvature = Math.sqrt(Math.max(0, Math.abs(ey) * profile.minTurnRadius * 0.46));
    const reversePenalty = ex < 0 ? Math.abs(ex) * 0.28 : ex * 0.05;
    u = Math.max(u, profile.minForward, dFromCurvature, profile.minForward + reversePenalty);

    let maxLat = Math.max(10, u * Math.tan(dynamicDeviation));
    v = clamp(v, -maxLat, maxLat);
    if (reverseRatio > 0.45) {
      const minLatForReverse = Math.min(maxLat * 0.75, profile.minTurnRadius * 0.45);
      if (Math.abs(v) < minLatForReverse) {
        v = sideSign * minLatForReverse;
      }
    }

    let p1 = {
      x: p0.x + profile.forward.x * u + profile.left.x * v,
      y: p0.y + profile.forward.y * u + profile.left.y * v,
    };

    const maxCurvature = 1 / Math.max(1, profile.minTurnRadius);
    let curvature = quadraticStartCurvature(p0, p1, this.route.p2);
    let guard = 0;
    while (curvature > maxCurvature && guard < 20) {
      u *= 1.1;
      maxLat = Math.max(10, u * Math.tan(dynamicDeviation));
      v = clamp(v, -maxLat, maxLat);
      p1 = {
        x: p0.x + profile.forward.x * u + profile.left.x * v,
        y: p0.y + profile.forward.y * u + profile.left.y * v,
      };
      curvature = quadraticStartCurvature(p0, p1, this.route.p2);
      guard += 1;
    }

    this.route.p1 = {
      x: p1.x,
      y: p1.y,
    };
    if (resetProgress) {
      this.route.t = 0;
    }
    this.route.length = quadraticLengthApprox(this.route.p0, this.route.p1, this.route.p2);
    this.command.x = this.route.p2.x;
    this.command.y = this.route.p2.y;
  }

  setBezierRoute(controlX, controlY, endX, endY, throttle, anchorToMain = true) {
    const match = this.team.match;
    this.throttle = normalizeThrottleToGear(throttle, this.throttle);
    this.route = {
      anchorToMain,
      p0: { x: this.x, y: this.y },
      p1: { x: this.x, y: this.y },
      p2: {
        x: match.clampX(endX, match.mapPadding),
        y: match.clampY(endY, match.mapPadding),
      },
      t: 0,
      length: 1,
    };

    const hasControl = Number.isFinite(controlX) && Number.isFinite(controlY);
    const desiredControl = hasControl
      ? {
          x: match.clampX(controlX, match.mapPadding),
          y: match.clampY(controlY, match.mapPadding),
        }
      : this.suggestControlForCurrentEndpoint();

    this.enforceRouteFeasibility(desiredControl, true);
  }

  setRouteControl(controlX, controlY, resetProgress = false) {
    if (!this.route) {
      return;
    }
    const match = this.team.match;
    this.enforceRouteFeasibility(
      {
        x: match.clampX(controlX, match.mapPadding),
        y: match.clampY(controlY, match.mapPadding),
      },
      resetProgress,
    );
  }

  setRouteEndpoint(endX, endY, resetProgress = false) {
    if (!this.route) {
      return;
    }
    const match = this.team.match;
    this.route.p2 = {
      x: match.clampX(endX, match.mapPadding),
      y: match.clampY(endY, match.mapPadding),
    };
    this.enforceRouteFeasibility(this.route.p1, resetProgress);
  }

  clearRoute() {
    this.route = null;
  }

  expireClawMarks() {
    if (this.clawMarks.stacks > 0 && this.clawMarks.expiresAt <= this.team.match.elapsed) {
      this.clawMarks.sourceSeat = null;
      this.clawMarks.stacks = 0;
      this.clawMarks.expiresAt = 0;
    }
  }

  activeClawMarks() {
    if (this.clawMarks.stacks > 0 && this.clawMarks.expiresAt <= this.team.match.elapsed) {
      return { ...this.clawMarks, sourceSeat: null, stacks: 0, expiresAt: 0 };
    }
    return { ...this.clawMarks };
  }

  registerClawHit(claw, match, source = null) {
    if (!this.alive || !claw || !this.team.match.rules.canDamage(source, this)) {
      return false;
    }
    this.expireClawMarks();
    const marks = this.clawMarks;
    const sourceSeat = claw.sourceSeat || null;
    if (marks.stacks > 0 && marks.sourceSeat !== sourceSeat) {
      marks.stacks = 0;
    }
    marks.sourceSeat = sourceSeat;
    marks.required = Math.max(1, Math.round(Number(claw.triggerHits) || 4));
    marks.stacks += 1;
    marks.expiresAt = this.team.match.elapsed + Math.max(0.5, Number(claw.markDuration) || 8);
    marks.color = claw.color || marks.color;

    if (marks.stacks < marks.required) {
      return false;
    }

    marks.stacks = 0;
    marks.expiresAt = 0;
    const burstDamage = Math.max(0, Number(claw.burstDamage) || 0);
    if (burstDamage > 0) {
      const damageImmune = this.isDamageImmune();
      const damageContext = { kind: DAMAGE_KIND.ATTACK_EFFECT };
      const displayedDamage = burstDamage * this.team.match.rules.attackDamageMultiplier(
        source,
        this,
        damageContext.kind,
      );
      this.takeDamage(burstDamage, source, match, damageContext);
      match.spawnFloatingTextKey(this.x + 10, this.y - 20, "猫爪爆发", {}, "#ffd0e4");
      if (damageImmune) {
        match.spawnFloatingTextKey(this.x + 8, this.y - 8, "免疫", {}, "#ffc5cf");
      } else {
        match.spawnFloatingText(this.x + 8, this.y - 8, `-${Math.round(displayedDamage)}`, "#ff8fbd");
      }
      match.spawnBurst(this.x, this.y, "#ff8fbd", 12);
    }
    return true;
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

    if (updateKoizumiOrb(this, dt)) {
      return;
    }

    if (this.isAttached()) {
      this.followLeader(dt);
      return;
    }

    let navTargetX = this.command.x;
    let navTargetY = this.command.y;

    if (this.route) {
      this.enforceRouteFeasibility(this.route.p1, false);
      const speedRatio = clamp(this.speed / Math.max(this.effectiveSpeed(), 1), 0, 1);
      const lookLead = 0.04 + speedRatio * 0.12;
      const lookT = clamp(this.route.t + lookLead, 0, 1);
      const lookAhead = quadraticPoint(this.route.p0, this.route.p1, this.route.p2, lookT);
      // 曲率约束可能为靠近边界的掉头航线生成地图外控制点。曲线本身可以保留，
      // 但导航前视点若也落到地图外，舰船会保持正常内部航速朝边界外航行，
      // 实际位置却被边界钳住，视觉上就像换挡后熄火。此时直接朝地图内的航线终点
      // 脱离边界；单纯钳制前视点可能恰好落在舰船脚下，反而触发到点停车。
      const lookAheadOutside = (
        lookAhead.x < 8
        || lookAhead.x > match.worldSize - 8
        || lookAhead.y < 8
        || lookAhead.y > match.worldSize - 8
      );
      navTargetX = lookAheadOutside ? this.route.p2.x : lookAhead.x;
      navTargetY = lookAheadOutside ? this.route.p2.y : lookAhead.y;
    }

    const navDx = navTargetX - this.x;
    const navDy = navTargetY - this.y;
    const dist = Math.hypot(navDx, navDy);
    // 已到达目标且没有位移需求时保持当前航向；atan2(0, 0) 会返回 0，曾令朝向 π 的 B 方旗舰
    // 在原地无故掉头，进而拖动整支附着编队散开。
    const desired = dist > 1e-4 ? Math.atan2(navDy, navDx) : this.angle;
    const delta = shortestAngleDelta(this.angle, desired);
    const deltaAbs = Math.abs(delta);
    const turnUrgency = clamp(deltaAbs / Math.PI, 0, 1);
    const reverseAssist = this.route && deltaAbs > 2.35 ? 0.85 : 0;
    const turnBoost = this.route ? 1 + turnUrgency * 2.8 + reverseAssist : 1;
    const turnRate = this.effectiveTurnRate() * (0.22 + this.throttle * 0.4) * turnBoost;
    this.angle += clamp(delta, -turnRate * dt, turnRate * dt);

    const throttlePenalty = this.team.match.rules.depletedEnergySpeedFactor(this);
    const steerBrake = this.route ? clamp(1 - turnUrgency * 0.78, 0.22, 1) : 1;
    const minimumSpeed = this.minimumFlightSpeed();
    const targetSpeed = Math.max(minimumSpeed, dist < 8 ? 0 : this.effectiveSpeed() * this.throttle * throttlePenalty * steerBrake * this.collisionSpeedFactor());

    const accelResponse = clamp(this.baseAcceleration() * this.team.accelerationModifierForShip(this), 0.65, 9.6);
    this.speed = Math.max(minimumSpeed, lerp(this.speed, targetSpeed, clamp(dt * accelResponse, 0, 1)));

    this.advanceFlight(dt);

    if (this.route) {
      const minAdvance = 5;
      // 普通 P 档保持航线进度；刀锋强制前飞时仍推进航线。
      const routeSpeed = this.throttle <= 0 && minimumSpeed <= 0 ? 0 : Math.max(minAdvance, this.speed);
      const headingAlign = clamp(Math.cos(deltaAbs), -1, 1);
      const alignFactor = clamp((headingAlign + 0.25) / 1.25, 0.12, 1);
      const deltaT = (routeSpeed * dt * alignFactor) / Math.max(130, this.route.length);
      this.route.t = clamp(this.route.t + deltaT, 0, 1);
      if (this.route.t >= 1 && distance(this.x, this.y, this.route.p2.x, this.route.p2.y) <= 20) {
        this.route = null;
      }
    }
  }

  updateForcedKnockback() {
    const forced = this.forcedKnockback;
    if (!forced) {
      return false;
    }
    if (this.isControlImmune() || this.minimumFlightSpeed() > 0) {
      // 光球免控与刀锋持续前飞均不接受旧击退插值，避免随后回跳到旧坐标。
      this.forcedKnockback = null;
      return false;
    }
    const now = this.team.match.elapsed;
    const duration = Math.max(0.001, forced.endsAt - forced.startedAt);
    const progress = clamp((now - forced.startedAt) / duration, 0, 1);
    const eased = 1 - (1 - progress) * (1 - progress);
    this.x = lerp(forced.fromX, forced.toX, eased);
    this.y = lerp(forced.fromY, forced.toY, eased);
    this.speed = 0;
    if (progress < 1) {
      return true;
    }
    this.forcedKnockback = null;
    this.route = null;
    this.collisionSlowUntil = 0;
    return false;
  }

  followLeader(dt) {
    const match = this.team.match;
    const leader = this.team.ships.main;
    const compactMode = this.team.fleetMembersByKey("main").length > 1;
    const offsetScale = compactMode ? 0.5 : 1;
    const rot = rotateOffset(this.formationOffset.x * offsetScale, this.formationOffset.y * offsetScale, leader.angle);
    const tx = leader.x + rot.x;
    const ty = leader.y + rot.y;

    this.command.x = tx;
    this.command.y = ty;

    const errorX = tx - this.x;
    const errorY = ty - this.y;
    const dist = Math.hypot(errorX, errorY);
    // 编队跟随采用「旗舰速度 + 位置误差修正」的期望速度。
    // 旧逻辑即使旗舰静止也让副舰以巡航速度冲向编队点，越过后再折返；B 方初始朝向为 π，
    // 症状尤其明显，会在开局向两侧大幅散开。现在到位后自然静止，旗舰移动时再同步跟进。
    const correctionRate = compactMode ? 1.35 : 0.82;
    const desiredVx = Math.cos(leader.angle) * leader.speed + errorX * correctionRate;
    const desiredVy = Math.sin(leader.angle) * leader.speed + errorY * correctionRate;
    const desiredSpeed = Math.hypot(desiredVx, desiredVy);
    const desired = desiredSpeed > 0.05 ? Math.atan2(desiredVy, desiredVx) : leader.angle;
    const delta = shortestAngleDelta(this.angle, desired);
    const turnRate = this.effectiveFormationTurnRate();
    this.angle += clamp(delta, -turnRate * dt, turnRate * dt);

    const fleetSpeed = this.effectiveSpeed();
    const targetSpeed = Math.min(desiredSpeed, fleetSpeed * (compactMode ? 1.4 : 1.18));
    const accelResponse = clamp(this.baseAcceleration() * this.team.accelerationModifierForShip(this) * (compactMode ? 1.8 : 1.3), 0.8, 3.2);
    this.speed = lerp(this.speed, targetSpeed, clamp(dt * accelResponse, 0, 1));

    this.x += Math.cos(this.angle) * this.speed * dt;
    this.y += Math.sin(this.angle) * this.speed * dt;
    this.x = match.clampX(this.x, 8);
    this.y = match.clampY(this.y, 8);

    if (compactMode && dist < 11) {
      this.x = lerp(this.x, tx, clamp(dt * 6, 0, 1));
      this.y = lerp(this.y, ty, clamp(dt * 6, 0, 1));
    }
  }

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
    let damage = this.effectiveDamage();
    if (this.effects.nextShotDamageMultiplier > 1) {
      damage *= this.effects.nextShotDamageMultiplier;
      match.spawnFloatingTextKey(this.x + 12, this.y - 12, "超能力", {}, "#9be0ff");
      this.effects.nextShotDamageMultiplier = 1;
      delete this.activeSkillEffectStartedTicks.nextShotDamageMultiplier;
    }

    const projectileProfile = this.team.match.rules.projectileProfile(this);
    match.projectiles.push(
      new Projectile({
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
      }),
    );
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
    const fleetEnergy = this.team.fleetEnergyForShip(this);
    const statusEffects = serializeShipStatusEffects(this);
    return {
      id: this.id,
      key: this.key,
      slotKey: this.slotKey,
      characterId: this.characterId,
      characterName: this.character.name,
      name: this.name,
      x: this.x,
      y: this.y,
      angle: this.angle,
      speed: this.speed,
      cooldown: this.cooldown,
      hp: this.hp,
      maxHp: this.maxHp,
      energy: this.energy,
      maxEnergy: this.maxEnergy,
      fleetEnergy: fleetEnergy.current,
      fleetMaxEnergy: fleetEnergy.max,
      alive: this.alive,
      radius: this.radius,
      throttle: this.throttle,
      vision: this.effectiveVision(),
      range: this.effectiveRange(),
      attached: this.isAttached(),
      canControl: this.canControl(),
      bladeQueen: this.hasEffect("bladeQueenUntil"), // 刀锋女王激活中:两端渲染层据此画猩红刀锋光环
      catPawVolley: this.hasEffect("catPawUntil"),
      silenced: this.isSilenced(),
      stunRemaining: Math.max(0, (this.effects.stunnedUntil || 0) - this.team.match.elapsed),
      silenceRemaining: Math.max(0, (this.effects.silencedUntil || 0) - this.team.match.elapsed),
      heroPowerShock: serializeHaruhiHeroPowerShock(this),
      koizumiOrb: serializeKoizumiOrb(this),
      knockedBack: Boolean(this.forcedKnockback),
      haruhiImpactReady: this.key === "main" && haruhiOtherworlderReady(this.team),
      clawMarks: (() => {
        const marks = this.activeClawMarks();
        return {
          sourceSeat: marks.sourceSeat,
          stacks: marks.stacks,
          required: marks.required,
          expiresIn: Math.max(0, marks.expiresAt - this.team.match.elapsed),
          color: marks.color,
        };
      })(),
      nameRevealed: this.nameRevealed, // 角色名是否已被敌方永久确认
      buffs: statusEffectNames(statusEffects),
      statusEffects,
      ...(this.bunnyHaruhi || this.bunnyStageExposure ? serializeBunnyShip(this) : {}),
      ...(this.bunnyCompanion ? serializeBunnyCompanion(this) : {}),
      ...(this.bunnyReliable ? { bunnyReliable: {
        sourceCompanionId: this.bunnyReliable.sourceCompanionId,
        remaining: Math.max(0, this.bunnyReliable.until - this.team.match.elapsed),
        suppressed: this.bunnyReliable.suppressed,
      } } : {}),
      route: this.route
        ? {
            anchorToMain: this.route.anchorToMain,
            p0: { ...this.route.p0 },
            p1: { ...this.route.p1 },
            p2: { ...this.route.p2 },
            t: this.route.t,
          }
        : null,
    };
  }
}
