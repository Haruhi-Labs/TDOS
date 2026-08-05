import {
  DEFAULT_MAP_PADDING,
  DEFAULT_WORLD_SIZE,
  SNAPSHOT_RATE,
  TICK_DT,
  TICK_RATE,
} from "./game/constants.js";
import {
  DEFAULT_THROTTLE_GEAR,
  ENERGY_GEAR_PROFILES,
  THROTTLE_GEAR_VALUES,
  energyProfileForThrottle,
  energyRateForThrottle,
  normalizeThrottleToGear,
  throttleForGear,
  throttleGearForValue,
} from "./game/throttle.js";
import {
  AUTO_SCOUT_COOLDOWN_MULTIPLIER,
  EMERGENCY_BRAKE_COST,
  FIRE_ARC_BANDS,
  MANUAL_SCOUT_COOLDOWN,
  SCOUT_LAUNCH_COST,
  YUKI_RADAR_ROTATION_SECONDS,
  fireArcDensityMultiplier,
} from "./game/combat-rules.js";
import {
  CHARACTER_DEFS,
  CHARACTER_ORDER,
  DEFAULT_AI_LOADOUT,
  DEFAULT_TEAM_LOADOUT,
  characterDefinition as getCharacterDef,
  cloneLoadout,
  normalizeLoadout,
  randomAiLoadout,
  skillMetaForCharacter,
  slotLabel,
} from "./game/characters.js";
import {
  buildZones,
  clamp,
  distance,
  dot,
  lerp,
  linePointDistance,
  normalizeAngle,
  quadraticLengthApprox,
  quadraticPoint,
  quadraticStartCurvature,
  randomInRange,
  rotateOffset,
  shortestAngleDelta,
  zoneContains,
} from "./game/math.js";
import { BotController } from "./game/bot-controller.js";
import { applyMatchAction } from "./game/action-dispatcher.js";
import {
  COLLISION_SLOW_DURATION,
  COLLISION_SLOW_FLOOR,
  resolveBladeQueenContacts as resolveMatchBladeQueenContacts,
  resolveScoutClashes as resolveMatchScoutClashes,
  resolveShipCollisions as resolveMatchShipCollisions,
} from "./game/collision-system.js";
import {
  computeVisibility as computeTeamVisibility,
  createRadarContact as createTeamRadarContact,
  radarMaxDistanceFrom as teamRadarMaxDistanceFrom,
  serializeRadarPassive as serializeTeamRadarPassive,
  updateRadarPassive as updateTeamRadarPassive,
} from "./game/visibility-radar.js";
import {
  activateVisionWaveSkill as activateTeamVisionWaveSkill,
  cancelVisionWaveSkill as cancelTeamVisionWaveSkill,
  createVisionWaveSkillState,
  serializeVisionWaves as serializeTeamVisionWaves,
  updateVisionWaveSkill as updateTeamVisionWaveSkill,
} from "./game/vision-wave.js";
import {
  assignFocusTargets as assignTeamFocusTargets,
  fireCandidates as teamFireCandidates,
  focusDamageBudget as attackerFocusDamageBudget,
  isFocusWorthy as isTeamFocusWorthy,
  pickTargetFor as pickTeamTarget,
  stepCombat as stepTeamCombat,
} from "./game/targeting-system.js";

export {
  DEFAULT_MAP_PADDING,
  DEFAULT_WORLD_SIZE,
  SNAPSHOT_RATE,
  TICK_DT,
  TICK_RATE,
  DEFAULT_THROTTLE_GEAR,
  ENERGY_GEAR_PROFILES,
  THROTTLE_GEAR_VALUES,
  energyProfileForThrottle,
  energyRateForThrottle,
  normalizeThrottleToGear,
  throttleForGear,
  throttleGearForValue,
  AUTO_SCOUT_COOLDOWN_MULTIPLIER,
  EMERGENCY_BRAKE_COST,
  FIRE_ARC_BANDS,
  MANUAL_SCOUT_COOLDOWN,
  SCOUT_LAUNCH_COST,
  YUKI_RADAR_ROTATION_SECONDS,
  fireArcDensityMultiplier,
  CHARACTER_DEFS,
  CHARACTER_ORDER,
  DEFAULT_AI_LOADOUT,
  DEFAULT_TEAM_LOADOUT,
  cloneLoadout,
  normalizeLoadout,
  randomAiLoadout,
  skillMetaForCharacter,
  slotLabel,
  buildZones,
  clamp,
  distance,
  lerp,
  quadraticPoint,
  BotController,
};

const TAU = Math.PI * 2;
const BEAM_CHARGE_DURATION = 1.05;
const BEAM_VISUAL_DURATION = 0.26;
const BEAM_BASE_RANGE = 1460;
const BEAM_HIT_RADIUS = 11;
const BEAM_DAMAGE_RATIO = 0.28;
const FUTURE_1096_HULL_RATIO = 0.75;
const DEG_TO_RAD = Math.PI / 180;
const EMERGENCY_BRAKE_DURATION = 0.82;
const EMERGENCY_BRAKE_COOLDOWN = 1.25;
const FLAGSHIP_TURN_PENALTIES = {
  1: 1.14,
  2: 0.88,
  3: 0.68,
  4: 0.62,
};


// 尾击:炮弹从目标「尾部射界」方向命中时伤害放大。判定范围与尾部射界(0x 火力带)完全一致——
// 即来袭方向相对目标朝向的夹角 |θ| > 150°(正后 60° 锥)。
const REAR_STRIKE_MIN_DEG = 150;
const REAR_STRIKE_MULT = 1.2;
// 小目标闪避:对体型小于参考半径的目标(侦察机/僚机等)炮弹有概率打空——半径越小概率越高,
// 上限温和,避免过度压制(主舰等正常体型半径≥参考值,完全不受影响)。
const SMALL_TARGET_REF_RADIUS = 8;
const SMALL_TARGET_MAX_MISS = 0.3;
// 编队取舍:不分离(同队 ≥2 艘)时,受到的伤害有该比例改由同队其它船平摊(集体抗压);
// 分离/单飞(同队仅 1 艘)时开火频率 ×该倍率(火力更猛)。二者由「同队成员数」互斥切换。
const FORMATION_DAMAGE_SHARE = 0.3;
const SOLO_FIRE_RATE_BONUS = 1.2;

const TEAM_COLORS = {
  A: "#65d9ff",
  B: "#ff8692",
};

const TEAM_PROJECTILE_COLORS = {
  A: "#9be8ff",
  B: "#ffc0bd",
};

// SOS团长(春日旗舰技)随机赋予的四种强化。正向增益统一 ×1.5(+50%);异世界人的减伤(受伤 ×0.82)保持不变。
const SOS_BUFFS = [
  {
    id: "alien",
    name: "宇宙人",
    color: "#6de7ff",
    apply(ship, stat, value) {
      if (stat === "vision") {
        return value * 1.5;
      }
      if (stat === "range") {
        return value * 1.5;
      }
      return value;
    },
  },
  {
    id: "esper",
    name: "超能力者",
    color: "#a996ff",
    apply(ship, stat, value) {
      if (stat === "turnRate") {
        return value * 1.5;
      }
      if (stat === "damage") {
        return value * 1.5;
      }
      return value;
    },
  },
  {
    id: "future",
    name: "未来人",
    color: "#ffd58e",
    apply(ship, stat, value) {
      if (stat === "speed") {
        return value * 1.5;
      }
      if (stat === "regen") {
        return value * 1.5;
      }
      if (stat === "accel") {
        return value * 1.5;
      }
      return value;
    },
  },
  {
    id: "otherworlder",
    name: "异世界人",
    color: "#8cf0b0",
    apply(ship, stat, value) {
      if (stat === "fireRate") {
        return value * 1.5;
      }
      return value;
    },
    damageTakenMultiplier: 0.82,
  },
];

const SOS_BUFF_TEXT_KEYS = {
  alien: "宇宙人",
  esper: "超能力者",
  future: "未来人",
  otherworlder: "异世界人",
};

function normalizeAiSeats(mode = "pvp", aiSeats) {
  let source = aiSeats;
  if (source === undefined) {
    source = mode === "ai" ? ["B"] : [];
  }

  if (source === "all") {
    source = ["A", "B"];
  } else if (!Array.isArray(source)) {
    if (source && typeof source === "object") {
      source = Object.entries(source)
        .filter(([, enabled]) => Boolean(enabled))
        .map(([seat]) => seat);
    } else if (source == null) {
      source = [];
    } else {
      source = [source];
    }
  }

  return Array.from(
    new Set(
      source
        .map((seat) => String(seat || "").trim().toUpperCase())
        .filter((seat) => seat === "A" || seat === "B"),
    ),
  );
}

let globalEntityId = 1;
function nextEntityId() {
  globalEntityId += 1;
  return globalEntityId;
}

export function __resetEntityIds(state = 1) {
  globalEntityId = state;
}

class FloatingText {
  constructor(x, y, text, color = "#ffd178", meta = {}) {
    const payload = text && typeof text === "object" ? text : null;
    const textKey = meta.textKey || payload?.textKey || payload?.key || null;
    const textArgs = meta.textArgs || payload?.textArgs || payload?.args || null;
    const fallback = payload ? payload.text || payload.fallback || textKey : text;
    this.id = nextEntityId();
    this.kind = "floating_text";
    this.x = x;
    this.y = y;
    this.text = String(fallback || "");
    this.textKey = textKey ? String(textKey) : null;
    this.textArgs = textArgs && typeof textArgs === "object" ? { ...textArgs } : null;
    this.color = payload?.color || color;
    this.life = 0.8;
  }

  update(dt) {
    this.life -= dt;
    this.y -= 18 * dt;
  }

  serialize() {
    return {
      id: this.id,
      kind: this.kind,
      x: this.x,
      y: this.y,
      text: this.text,
      textKey: this.textKey,
      textArgs: this.textArgs,
      color: this.color,
      life: this.life,
    };
  }
}

class Burst {
  constructor(x, y, color = "#ffdb9b", radius = 7) {
    this.id = nextEntityId();
    this.kind = "burst";
    this.x = x;
    this.y = y;
    this.color = color;
    this.radius = radius;
    this.life = 0.35;
  }

  update(dt) {
    this.life -= dt;
    this.radius += 60 * dt;
  }

  serialize() {
    return {
      id: this.id,
      kind: this.kind,
      x: this.x,
      y: this.y,
      color: this.color,
      radius: this.radius,
      life: this.life,
    };
  }
}

class Projectile {
  constructor({ team, source, x, y, targetX, targetY, damage, speed = 240, hitRadius = 8, color }) {
    this.id = nextEntityId();
    this.kind = "projectile";
    this.team = team;
    this.sourceId = source ? source.id : null;
    this.x = x;
    this.y = y;
    this.targetX = targetX;
    this.targetY = targetY;
    this.damage = damage;
    this.speed = speed;
    this.hitRadius = hitRadius;
    this.color = color || team.projectileColor;
    this.radius = 2;
    this.alive = true;
    // 发射点(射手开火时的位置),用于尾击判定:看来袭方向落在目标哪个射界
    this.originX = x;
    this.originY = y;
  }

  update(dt, match) {
    if (!this.alive) {
      return;
    }
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const remaining = Math.hypot(dx, dy);
    const step = this.speed * dt;
    if (step >= remaining || remaining < 1) {
      this.x = this.targetX;
      this.y = this.targetY;
      this.resolveImpact(match);
      this.alive = false;
      return;
    }
    this.x += (dx / remaining) * step;
    this.y += (dy / remaining) * step;
  }

  resolveImpact(match) {
    const enemyTeam = match.enemyTeamBySeat(this.team.seat);
    const candidates = enemyTeam.getEntities();
    let hitTarget = null;
    let nearest = Infinity;
    for (const entity of candidates) {
      if (!entity.alive) {
        continue;
      }
      const d = distance(this.x, this.y, entity.x, entity.y);
      if (d <= entity.radius + this.hitRadius && d < nearest) {
        nearest = d;
        hitTarget = entity;
      }
    }
    if (!hitTarget) {
      match.spawnFloatingTextKey(this.x, this.y, "未命中", {}, "#92c5ff");
      return;
    }
    // 小目标闪避:体型越小越容易被打空(侦察机/僚机),正常体型舰船不受影响
    const evade = clamp((SMALL_TARGET_REF_RADIUS - hitTarget.radius) / SMALL_TARGET_REF_RADIUS, 0, 1) * SMALL_TARGET_MAX_MISS;
    if (evade > 0 && Math.random() < evade) {
      match.spawnFloatingTextKey(hitTarget.x, hitTarget.y - 6, "未命中", {}, "#92c5ff");
      return;
    }
    // 尾击:来袭方向(发射点相对目标)落在目标尾部射界(|θ|>150°)→ 伤害 ×1.2
    let damage = this.damage;
    let rear = false;
    if (hitTarget.kind === "ship" && Number.isFinite(hitTarget.angle)) {
      const bearing = Math.atan2(this.originY - hitTarget.y, this.originX - hitTarget.x);
      const rel = Math.abs(shortestAngleDelta(hitTarget.angle, bearing));
      if (rel >= REAR_STRIKE_MIN_DEG * DEG_TO_RAD) {
        damage *= REAR_STRIKE_MULT;
        rear = true;
      }
    }
    hitTarget.takeDamage(damage, null, match);
    match.spawnFloatingText(hitTarget.x + 8, hitTarget.y - 8, `-${Math.round(damage)}`, rear ? "#ffb066" : "#ffd178");
    if (rear) {
      match.spawnFloatingTextKey(hitTarget.x + 12, hitTarget.y - 22, "尾击", {}, "#ff9d5a");
    }
    match.spawnBurst(hitTarget.x, hitTarget.y, "#ffdb9b", 7);
  }

  serialize() {
    return {
      id: this.id,
      kind: this.kind,
      teamSeat: this.team.seat,
      sourceId: this.sourceId,
      x: this.x,
      y: this.y,
      targetX: this.targetX,
      targetY: this.targetY,
      speed: this.speed,
      alive: this.alive,
      radius: this.radius,
      color: this.color,
    };
  }
}

class Ship {
  constructor(team, key, x, y, facing, options = {}) {
    this.id = nextEntityId();
    this.kind = "ship";
    this.team = team;
    this.key = key;
    this.slotKey = options.slotKey || key;
    this.characterId = options.characterId;
    this.character = getCharacterDef(this.characterId);
    this.base = this.character.stats;
    this.isAuxiliary = Boolean(options.isAuxiliary);
    this.attachToMain = options.attachToMain !== false;
    this.roleLabel = options.roleLabel || slotLabel(this.slotKey);
    this.name = `${this.roleLabel}·${this.character.name}`;

    this.x = x;
    this.y = y;
    this.angle = facing;
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

    this.cooldown = randomInRange(0, 0.5);
    this.formationOffset = { x: 0, y: 0 };
    // 名字确认:敌方舰船默认隐藏名字；在视野中施放技能或被长门雷达扫中后永久确认。
    this.nameRevealed = false;

    this.effects = {
      critUntil: 0,
      reliableUntil: 0,
      bladeQueenUntil: 0,
      sosBuff: null,
      brakeUntil: 0,
      brakeCooldownUntil: 0,
      nextShotDamageMultiplier: 1,
    };
    // 记录主动技能增益的权威生效 tick。多人同一 tick 的双方输入视为同时发生，
    // 后处理的净化不能因座位处理顺序清掉对方刚刚开启的技能。
    this.activeSkillEffectStartedTicks = Object.create(null);
  }

  setTwinHullMode() {
    this.maxHp = Math.round(this.base.hp * FUTURE_1096_HULL_RATIO);
    this.hp = Math.min(this.hp, this.maxHp);
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

  activeSosBuff() {
    const now = this.team.match.elapsed;
    if (!this.effects.sosBuff || this.effects.sosBuff.until <= now) {
      return null;
    }
    return SOS_BUFFS.find((item) => item.id === this.effects.sosBuff.id) || null;
  }

  hasEffect(effectKey) {
    return Number(this.effects[effectKey] || 0) > this.team.match.elapsed;
  }

  isEmergencyBraking() {
    return this.hasEffect("brakeUntil");
  }

  statWithBuffs(statKey, baseValue) {
    let value = baseValue;
    const sos = this.activeSosBuff();
    if (sos) {
      value = sos.apply(this, statKey, value);
    }

    if (this.hasEffect("reliableUntil")) {
      if (statKey === "turnRate") {
        value *= 1.28;
      }
      if (statKey === "speed") {
        value *= 1.08;
      }
      if (statKey === "damage") {
        value *= 1.08;
      }
      if (statKey === "accel") {
        value *= 1.12;
      }
    }

    if (this.hasEffect("bladeQueenUntil")) {
      if (statKey === "speed") {
        value *= 1.45;
      }
      if (statKey === "accel") {
        value *= 1.26;
      }
      if (statKey === "turnRate") {
        value *= 1.12;
      }
    }

    return value;
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
    return this.team.fleetSpeedForShip(this);
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
    if (this.team.hasKyonFlagship()) {
      value *= 1.28;
    }
    return value;
  }

  effectiveFormationTurnRate() {
    let value = this.baseTurnRate();
    if (this.team.hasKyonFlagship()) {
      value *= 1.2;
    }
    return value * (this.team.fleetMemberCountForShip(this) >= 3 ? 1.55 : 1.28);
  }

  effectiveVision() {
    let value = this.statWithBuffs("vision", this.base.vision);
    if (this.characterId === "yuki" && !this.isAttached()) {
      value += 24;
    }
    return value;
  }

  effectiveRange() {
    return this.statWithBuffs("range", this.base.range);
  }

  effectiveDamage() {
    // 末乘难度数值缩放(简单0.8/普通1.0/困难1.2/极限1.0);玩家队 statMult 恒为1,不受影响。
    return this.statWithBuffs("damage", this.base.damage) * (this.team.statMult || 1);
  }

  effectiveFireRate() {
    let value = this.statWithBuffs("fireRate", this.base.fireRate);
    // 分离/单飞(本船所在编队仅 1 艘):开火频率加成
    if (this.team.fleetMemberCountForShip(this) <= 1) {
      value *= SOLO_FIRE_RATE_BONUS;
    }
    return value;
  }

  damageTakenMultiplier() {
    let value = 1;
    const sos = this.activeSosBuff();
    if (sos && sos.damageTakenMultiplier) {
      value *= sos.damageTakenMultiplier;
    }
    if (this.hasEffect("reliableUntil")) {
      value *= 0.84;
    }
    return value;
  }

  markActiveSkillEffectStarted(effectKey) {
    this.activeSkillEffectStartedTicks[effectKey] = this.team.match.tick;
  }

  clearActiveSkillBuffs({ preserveCurrentTick = true } = {}) {
    const canClear = (effectKey) => (
      !preserveCurrentTick
      || this.activeSkillEffectStartedTicks[effectKey] !== this.team.match.tick
    );
    const clearTimedEffect = (effectKey) => {
      if (!canClear(effectKey)) {
        return;
      }
      this.effects[effectKey] = 0;
      delete this.activeSkillEffectStartedTicks[effectKey];
    };

    clearTimedEffect("critUntil");
    clearTimedEffect("reliableUntil");
    clearTimedEffect("bladeQueenUntil");
    if (canClear("sosBuff")) {
      this.effects.sosBuff = null;
      delete this.activeSkillEffectStartedTicks.sosBuff;
    }
    if (canClear("nextShotDamageMultiplier")) {
      this.effects.nextShotDamageMultiplier = 1;
      delete this.activeSkillEffectStartedTicks.nextShotDamageMultiplier;
    }
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
    if (this.team.hasKyonFlagship()) {
      minTurnRadius *= 0.62;
      maxStartDeviation *= 1.4;
    }
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

  update(dt) {
    if (!this.alive) {
      return;
    }

    const match = this.team.match;
    this.cooldown = Math.max(0, this.cooldown - dt);

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
      navTargetX = lookAhead.x;
      navTargetY = lookAhead.y;
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

    const throttlePenalty = this.team.availableEnergyForShip(this) <= 0 ? 0.15 : 1;
    const steerBrake = this.route ? clamp(1 - turnUrgency * 0.78, 0.22, 1) : 1;
    const braking = this.isEmergencyBraking();
    const cruiseTargetSpeed = dist < 8 ? 0 : this.effectiveSpeed() * this.throttle * throttlePenalty * steerBrake * this.collisionSpeedFactor();
    const targetSpeed = braking ? Math.min(cruiseTargetSpeed * 0.08, 4.2) : cruiseTargetSpeed;

    const accelResponse = clamp(this.baseAcceleration() * this.team.accelerationModifierForShip(this) * (braking ? 4.4 : 1), 0.65, 9.6);
    this.speed = lerp(this.speed, targetSpeed, clamp(dt * accelResponse, 0, 1));
    if (braking && this.speed < 1.2) {
      this.speed = 0;
    }

    this.x += Math.cos(this.angle) * this.speed * dt;
    this.y += Math.sin(this.angle) * this.speed * dt;
    this.x = match.clampX(this.x, 8);
    this.y = match.clampY(this.y, 8);

    if (this.route) {
      const minAdvance = 5;
      // P 档下保持当前航线进度，重新挂入前进档后可沿原航线继续航行。
      const routeSpeed = this.throttle <= 0 ? 0 : Math.max(minAdvance, this.speed);
      const headingAlign = clamp(Math.cos(deltaAbs), -1, 1);
      const alignFactor = clamp((headingAlign + 0.25) / 1.25, 0.12, 1);
      const deltaT = (routeSpeed * dt * alignFactor) / Math.max(130, this.route.length);
      this.route.t = clamp(this.route.t + deltaT, 0, 1);
      if (this.route.t >= 1 && distance(this.x, this.y, this.route.p2.x, this.route.p2.y) <= 20) {
        this.route = null;
      }
    }
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
    return fireArcDensityMultiplier(relative, this.team.hasKyonFlagship());
  }

  tryAttack(match, enemyTeam) {
    if (!this.alive || this.cooldown > 0) {
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
    const aimX = predictedX + randomInRange(-spread, spread);
    const aimY = predictedY + randomInRange(-spread, spread);
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

    if (this.hasEffect("critUntil") && Math.random() < 0.5) {
      damage *= 3;
      match.spawnFloatingTextKey(this.x + 12, this.y - 12, "暴击", {}, "#ffdd73");
    }

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
        color: this.team.projectileColor,
      }),
    );
    this.cooldown = 1 / Math.max(0.01, this.effectiveFireRate() * fireDensity);
  }

  takeDamage(amount, _source = null, match = null, share = true) {
    if (!this.alive) {
      return;
    }
    if (this.team.effects.taxiInvulnUntil > this.team.match.elapsed) {
      return;
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
          m.takeDamage(per, _source, match, false);
        }
      }
    }
    const finalAmount = amount * this.damageTakenMultiplier();
    const damageFloor = this.maxHp * clamp(Number(this.team.damageFloorRatio) || 0, 0, 1);
    this.hp = Math.max(damageFloor, this.hp - finalAmount);
    if (this.hp > 0) {
      return;
    }
    this.alive = false;
    this.speed = 0;
    this.route = null;
    this.team.resolvePostCasualtyState(match);
    if (match) {
      match.spawnBurst(this.x, this.y, "#ff9d7d", 10);
    }
  }

  serialize() {
    const fleetEnergy = this.team.fleetEnergyForShip(this);
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
      braking: this.isEmergencyBraking(),
      brakeCooldown: Math.max(0, (this.effects.brakeCooldownUntil || 0) - this.team.match.elapsed),
      bladeQueen: this.hasEffect("bladeQueenUntil"), // 刀锋女王激活中:两端渲染层据此画猩红刀锋光环
      nameRevealed: this.nameRevealed, // 角色名是否已被敌方永久确认
      buffs: this.team.listShipBuffs(this),
      route: this.route
        ? {
            anchorToMain: this.route.anchorToMain,
            p0: this.route.p0,
            p1: this.route.p1,
            p2: this.route.p2,
            t: this.route.t,
          }
        : null,
    };
  }
}

class Scout {
  constructor(team, x, y, config = {}) {
    this.id = nextEntityId();
    this.kind = "scout";
    this.team = team;
    this.zone = config.zone || null;
    this.pattern = config.pattern || (this.zone ? "zone" : "burst");
    this.mode = this.pattern === "zone" ? "transit" : "burst";
    this.x = x;
    this.y = y;
    this.angle = randomInRange(0, TAU);
    this.speed = config.speed || (this.pattern === "burst" ? 112 : 62);
    this.radius = config.radius || (this.pattern === "burst" ? 3.2 : 3.8);
    this.hp = 1;
    this.maxHp = 1;
    this.vision = config.vision || (this.pattern === "burst" ? 86 : 95);
    this.alive = true;
    this.life = Number.isFinite(config.life) ? config.life : this.pattern === "burst" ? 11 : 28;
    this.anchor = config.anchor || null;
    this.anchorRadius = config.anchorRadius || 22;
    this.orbitAngle = randomInRange(0, TAU);
    this.orbitSpeed = randomInRange(0.8, 1.6) * (Math.random() < 0.5 ? -1 : 1);
    this.command = {
      x: x,
      y: y,
    };

    if (this.zone) {
      this.command.x = this.zone.x + this.zone.width * 0.5;
      this.command.y = this.zone.y + this.zone.height * 0.5;
    } else if (this.anchor) {
      this.command.x = this.anchor.x;
      this.command.y = this.anchor.y;
    }
    // 若指定了 seekPoint(敌方估计位置)，先直飞该点把视野覆盖到目标，再在战区巡逻——
    // 比"飞战区中心+随机巡逻"更快找到敌人(战区≈480px ≫ 侦察视野≈95px，随机巡逻常错过)。
    if (config.seekPoint && Number.isFinite(config.seekPoint.x) && Number.isFinite(config.seekPoint.y)) {
      this.command.x = config.seekPoint.x;
      this.command.y = config.seekPoint.y;
    }

    this.patrolTimer = randomInRange(1.0, 2.4);
  }

  randomPatrolPoint() {
    if (!this.zone) {
      return;
    }
    const margin = 18;
    this.command = {
      x: randomInRange(this.zone.x + margin, this.zone.x + this.zone.width - margin),
      y: randomInRange(this.zone.y + margin, this.zone.y + this.zone.height - margin),
    };
  }

  updateBurstCommand() {
    if (!this.anchor) {
      return;
    }
    this.orbitAngle += this.orbitSpeed * 0.08;
    this.command = {
      x: this.anchor.x + Math.cos(this.orbitAngle) * this.anchorRadius,
      y: this.anchor.y + Math.sin(this.orbitAngle) * this.anchorRadius,
    };
  }

  update(dt) {
    if (!this.alive) {
      return;
    }
    this.life -= dt;
    if (this.life <= 0) {
      this.alive = false;
      return;
    }

    const dx = this.command.x - this.x;
    const dy = this.command.y - this.y;
    const d = Math.hypot(dx, dy);
    if (d > 1) {
      this.x += (dx / d) * this.speed * dt;
      this.y += (dy / d) * this.speed * dt;
      this.angle = Math.atan2(dy, dx);
    }

    if (this.pattern === "zone") {
      if (this.mode === "transit" && d < 12) {
        this.mode = "patrol";
        this.randomPatrolPoint();
      } else if (this.mode === "patrol") {
        this.patrolTimer -= dt;
        if (d < 12 || this.patrolTimer <= 0) {
          this.patrolTimer = randomInRange(1.0, 2.6);
          this.randomPatrolPoint();
        }
      }
      return;
    }

    if (d < 8) {
      this.updateBurstCommand();
    }
  }

  takeDamage(_amount = 0, _source = null, match = null) {
    if (!this.alive) {
      return;
    }
    this.alive = false;
    if (match) {
      match.spawnBurst(this.x, this.y, "#d5efff", 6);
    }
  }

  serialize() {
    return {
      id: this.id,
      kind: this.kind,
      x: this.x,
      y: this.y,
      angle: this.angle,
      alive: this.alive,
      radius: this.radius,
      vision: this.vision,
      life: this.life,
    };
  }
}

class Wingman {
  constructor(team, x, y, zone) {
    this.id = nextEntityId();
    this.kind = "wingman";
    this.team = team;
    this.zone = zone;
    this.mode = "transit";
    this.x = x;
    this.y = y;
    this.angle = 0;
    this.speed = 72;
    this.radius = 5.2;
    this.maxHp = 132;
    this.hp = this.maxHp;
    this.vision = 100;
    this.attackRange = 280;
    this.damage = 11.5;
    this.cooldown = randomInRange(0.8, 1.4);
    this.life = 48;
    this.alive = true;
    this.command = {
      x: zone.x + zone.width * 0.5,
      y: zone.y + zone.height * 0.5,
    };
    this.patrolTimer = randomInRange(1.0, 2.5);
  }

  randomPatrolPoint() {
    const margin = 26;
    this.command = {
      x: randomInRange(this.zone.x + margin, this.zone.x + this.zone.width - margin),
      y: randomInRange(this.zone.y + margin, this.zone.y + this.zone.height - margin),
    };
  }

  update(dt) {
    if (!this.alive) {
      return;
    }
    this.life -= dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.life <= 0) {
      this.alive = false;
      return;
    }

    const dx = this.command.x - this.x;
    const dy = this.command.y - this.y;
    const d = Math.hypot(dx, dy);
    if (d > 1) {
      this.x += (dx / d) * this.speed * dt;
      this.y += (dy / d) * this.speed * dt;
      this.angle = Math.atan2(dy, dx);
    }

    if (this.mode === "transit" && d < 12) {
      this.mode = "patrol";
      this.randomPatrolPoint();
    } else if (this.mode === "patrol") {
      this.patrolTimer -= dt;
      if (d < 12 || this.patrolTimer <= 0) {
        this.patrolTimer = randomInRange(1.0, 2.8);
        this.randomPatrolPoint();
      }
    }
  }

  tryAttack(match, enemyTeam) {
    if (!this.alive || this.cooldown > 0) {
      return;
    }
    const target = this.team.pickTargetFor(this, enemyTeam);
    if (!target) {
      return;
    }

    const spread = randomInRange(-7, 7);
    const angle = Math.atan2(target.y - this.y, target.x - this.x);
    const targetX = target.x + Math.cos(angle + Math.PI * 0.5) * spread;
    const targetY = target.y + Math.sin(angle + Math.PI * 0.5) * spread;

    match.projectiles.push(
      new Projectile({
        team: this.team,
        source: this,
        x: this.x,
        y: this.y,
        targetX: match.clampX(targetX, 0),
        targetY: match.clampY(targetY, 0),
        damage: this.damage,
        speed: 260,
        hitRadius: 7,
        color: this.team.projectileColor,
      }),
    );
    this.cooldown = 1.4;
  }

  takeDamage(amount, _source = null, match = null) {
    if (!this.alive) {
      return;
    }
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) {
      this.alive = false;
      if (match) {
        match.spawnBurst(this.x, this.y, "#ffd18a", 7);
      }
    }
  }

  serialize() {
    return {
      id: this.id,
      kind: this.kind,
      x: this.x,
      y: this.y,
      angle: this.angle,
      alive: this.alive,
      radius: this.radius,
      hp: this.hp,
      maxHp: this.maxHp,
      vision: this.vision,
      life: this.life,
    };
  }
}

class Team {
  constructor(match, seat, name, spawnX, spawnY, facing, options = {}) {
    this.match = match;
    this.seat = seat;
    this.name = name;
    this.color = TEAM_COLORS[seat];
    this.projectileColor = TEAM_PROJECTILE_COLORS[seat];
    this.loadout = normalizeLoadout(options.loadout || DEFAULT_TEAM_LOADOUT, DEFAULT_TEAM_LOADOUT);

    this.splitLevel = 0;
    // 单人难度对本队的影响(仅当本队由AI控制时,由 BotController.setDifficulty 写入):
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
    this.cooldowns = {
      scout: 0,
      flagship: 0,
      sub1: 0,
      sub2: 0,
    };
    this.autoScout = {
      enabled: false,
      zoneId: 5,
    };

    this.effects = {
      taxiUntil: 0,
      taxiInvulnUntil: 0,
      sponsorUntil: 0,
    };
    this.activeSkillEffectStartedTicks = Object.create(null);

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
      }),
      sub2: new Ship(this, "sub2", spawnX + sub2SpawnOffset.x, spawnY + sub2SpawnOffset.y, facing, {
        slotKey: "sub2",
        characterId: this.loadout.sub2,
      }),
    };

    this.ships.sub1.formationOffset = sub1FormationOffset;
    this.ships.sub2.formationOffset = sub2FormationOffset;

    this.extraShips = [];
    this.radarPassive = {
      epochAngle: normalizeAngle(facing),
      angle: normalizeAngle(facing),
      scanSequence: 0,
      contacts: new Map(),
    };
    this.visionWaveSkill = createVisionWaveSkillState();
    this.applyFlagshipPassives(spawnX, spawnY, facing);

    this.scouts = [];
    this.wingmen = [];
    this.beams = [];
  }

  applyFlagshipPassives(spawnX, spawnY, facing) {
    if (this.mainCharacterId() === "future1096") {
      this.ships.main.setTwinHullMode();
      const twinFormationOffset = { x: -52, y: 0 };
      const twinSpawnOffset = rotateOffset(twinFormationOffset.x * 0.5, twinFormationOffset.y * 0.5, facing);
      const twin = new Ship(this, "twin", spawnX + twinSpawnOffset.x, spawnY + twinSpawnOffset.y, facing, {
        slotKey: "twin",
        roleLabel: "1096僚舰",
        characterId: "future1096",
        isAuxiliary: true,
        attachToMain: true,
      });
      twin.setTwinHullMode();
      twin.formationOffset = twinFormationOffset;
      this.extraShips.push(twin);
    }
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

  hasActiveSponsor() {
    return this.effects.sponsorUntil > this.match.elapsed;
  }

  hasActiveVisionWaveSkill() {
    return this.visionWaveSkill.activeUntil > this.match.elapsed;
  }

  getPlayerShips() {
    return [this.ships.main, this.ships.sub1, this.ships.sub2];
  }

  getAllShips() {
    return [...this.getPlayerShips(), ...this.extraShips];
  }

  // 难度数值缩放:按 mult 缩放本队所有舰船的最大/当前血量(伤害缩放在 effectiveDamage 中按 statMult 动态生效)。
  // 幂等——以已生效的 statMult 为基准取比值,重复调用同一倍率不再叠加;在舰船构造(含半血旗舰)之后调用。
  applyAiStatMult(mult) {
    const m = Number(mult) > 0 ? Number(mult) : 1;
    const prev = this.statMult || 1;
    if (m !== prev) {
      const ratio = m / prev;
      for (const ship of this.getAllShips()) {
        ship.maxHp = Math.max(1, Math.round(ship.maxHp * ratio));
        ship.hp = Math.min(ship.maxHp, ship.hp * ratio);
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

  hasLivingShips() {
    return this.getAllShips().some((ship) => ship.alive);
  }

  hullRatio() {
    const ships = this.getAllShips();
    const hp = ships.reduce((sum, ship) => sum + Math.max(0, ship.hp), 0);
    const max = ships.reduce((sum, ship) => sum + ship.maxHp, 0);
    return max <= 0 ? 0 : hp / max;
  }

  fleetKeyForShip(shipOrKey) {
    const key = typeof shipOrKey === "string" ? shipOrKey : shipOrKey.key;
    if (key === "sub1" && this.splitLevel >= 1) {
      return "sub1";
    }
    if (key === "sub2" && this.splitLevel >= 2) {
      return "sub2";
    }
    return "main";
  }

  fleetMembersByKey(fleetKey) {
    const members = [];
    if (fleetKey === "main") {
      if (this.ships.main.alive) {
        members.push(this.ships.main);
      }
      if (this.splitLevel < 1 && this.ships.sub1.alive) {
        members.push(this.ships.sub1);
      }
      if (this.splitLevel < 2 && this.ships.sub2.alive) {
        members.push(this.ships.sub2);
      }
      for (const ship of this.extraShips) {
        if (ship.alive) {
          members.push(ship);
        }
      }
      return members;
    }
    const ship = this.ships[fleetKey];
    if (ship && ship.alive) {
      members.push(ship);
    }
    return members;
  }

  fleetMembersForShip(shipOrKey) {
    return this.fleetMembersByKey(this.fleetKeyForShip(shipOrKey));
  }

  fleetMemberCountForShip(shipOrKey) {
    return this.fleetMembersForShip(shipOrKey).length;
  }

  turnModifierForShip(shipOrKey) {
    const count = this.fleetMemberCountForShip(shipOrKey);
    const penalty = FLAGSHIP_TURN_PENALTIES[count] || 0.62;
    return count <= 1 ? 1.16 : penalty;
  }

  accelerationModifierForShip(shipOrKey) {
    let value = 1;
    if (this.effects.taxiUntil > this.match.elapsed) {
      value *= 1.75;
    }
    if (this.hasKyonFlagship()) {
      value *= 1.16;
    }
    return value;
  }

  fleetSpeedForShip(shipOrKey) {
    const members = this.fleetMembersForShip(shipOrKey);
    if (members.length === 0) {
      return 0;
    }
    return members.reduce((min, ship) => Math.min(min, ship.baseSpeed()), Infinity);
  }

  fleetEnergyForShip(shipOrKey) {
    const members = this.fleetMembersForShip(shipOrKey);
    return {
      current: members.reduce((sum, ship) => sum + Math.max(0, ship.energy), 0),
      max: members.reduce((sum, ship) => sum + ship.maxEnergy, 0),
    };
  }

  availableEnergyForShip(shipOrKey) {
    return this.fleetEnergyForShip(shipOrKey).current;
  }

  spendEnergyForShip(shipOrKey, cost) {
    const members = this.fleetMembersForShip(shipOrKey).filter((ship) => ship.alive && ship.energy > 0);
    if (members.length === 0) {
      return false;
    }
    const total = members.reduce((sum, ship) => sum + ship.energy, 0);
    if (total < cost) {
      return false;
    }
    let spent = 0;
    for (let i = 0; i < members.length; i += 1) {
      const ship = members[i];
      const remaining = cost - spent;
      if (remaining <= 0) {
        break;
      }
      const slice = i === members.length - 1 ? remaining : Math.min(ship.energy, (cost * ship.energy) / total);
      ship.energy = Math.max(0, ship.energy - slice);
      spent += slice;
    }
    if (spent < cost) {
      const richest = [...members].sort((a, b) => b.energy - a.energy)[0];
      if (richest) {
        richest.energy = Math.max(0, richest.energy - (cost - spent));
      }
    }
    return true;
  }

  listShipBuffs(ship) {
    const list = [];
    const sos = ship.activeSosBuff();
    if (sos) {
      list.push(sos.name);
    }
    if (ship.hasEffect("critUntil")) {
      list.push("神说会赢的");
    }
    if (ship.effects.nextShotDamageMultiplier > 1) {
      list.push("超能力");
    }
    if (ship.hasEffect("reliableUntil")) {
      list.push("靠谱的普通人");
    }
    if (ship.hasEffect("bladeQueenUntil")) {
      list.push("刀锋女王");
    }
    if (ship.isEmergencyBraking()) {
      list.push("急刹");
    }
    if (this.effects.taxiUntil > this.match.elapsed) {
      list.push("机关的力量");
    }
    if (this.effects.taxiInvulnUntil > this.match.elapsed) {
      list.push("无敌");
    }
    if (this.hasActiveSponsor()) {
      list.push("神秘赞助人");
    }
    if (this.hasActiveVisionWaveSkill()) {
      list.push("我不会绕过你哦");
    }
    return list;
  }

  areSkillsDisabled() {
    return this.forceSkillsDisabled || this.forceCharacterSkillsDisabled;
  }

  areScoutsDisabled() {
    return this.forceSkillsDisabled || this.forceScoutsDisabled;
  }

  cooldownStep(dt) {
    return dt * (this.hasActiveSponsor() ? 2 : 1);
  }

  setShipEffect(ship, key, duration) {
    ship.effects[key] = this.match.elapsed + duration;
    ship.markActiveSkillEffectStarted(key);
  }

  markActiveSkillEffectStarted(effectKey) {
    this.activeSkillEffectStartedTicks[effectKey] = this.match.tick;
  }

  clearActiveSkillBuffs({ preserveCurrentTick = true } = {}) {
    const clearTeamEffect = (effectKey) => {
      if (preserveCurrentTick && this.activeSkillEffectStartedTicks[effectKey] === this.match.tick) {
        return;
      }
      this.effects[effectKey] = 0;
      delete this.activeSkillEffectStartedTicks[effectKey];
    };
    clearTeamEffect("taxiUntil");
    clearTeamEffect("taxiInvulnUntil");
    clearTeamEffect("sponsorUntil");
    cancelTeamVisionWaveSkill(this, { preserveCurrentTick });
    for (const ship of this.getAllShips()) {
      ship.clearActiveSkillBuffs({ preserveCurrentTick });
    }
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
    ship.x = this.match.clampX(ship.x + dirX * step, padding);
    ship.y = this.match.clampY(ship.y + dirY * step, padding);
    ship.command.x = ship.x;
    ship.command.y = ship.y;
    ship.route = null;
    this.match.spawnBurst(fromX, fromY, "#d8f7ff", 8);
    this.match.spawnBurst(ship.x, ship.y, "#9be0ff", 9);
    this.match.spawnFloatingTextKey(ship.x + 10, ship.y - 12, "闪现", {}, "#9be0ff");
    return true;
  }

  sponsorRegeneration(dt) {
    if (!this.hasActiveSponsor()) {
      return;
    }
    for (const ship of this.getAllShips()) {
      if (!ship.alive) {
        continue;
      }
      ship.hp = Math.min(ship.maxHp, ship.hp + ship.maxHp * 0.01 * dt);
    }
  }

  normalizeSplitLevel() {
    let level = this.splitLevel;
    while (level < 1 && !this.ships.sub1.alive) {
      level = 1;
    }
    while (level < 2 && level >= 1 && !this.ships.sub2.alive) {
      level = 2;
    }
    this.splitLevel = level;
  }

  promoteTwinToMain(match = null) {
    if (this.ships.main.alive) {
      return false;
    }
    const twin = this.extraShips.find((ship) => ship.slotKey === "twin" && ship.alive);
    if (!twin) {
      return false;
    }
    this.extraShips = this.extraShips.filter((ship) => ship !== twin);
    twin.key = "main";
    twin.slotKey = "main";
    twin.isAuxiliary = false;
    twin.attachToMain = false;
    twin.roleLabel = "主舰";
    twin.name = `${twin.roleLabel}·${twin.character.name}`;
    twin.formationOffset = { x: 0, y: 0 };
    this.ships.main = twin;
    if (match) {
      match.spawnFloatingTextKey(twin.x + 8, twin.y - 12, "主舰接管", {}, "#8ef8ff");
    }
    return true;
  }

  releaseShipAfterFlagshipLoss(ship, lateralSign = 1) {
    if (!ship || !ship.alive) {
      return;
    }
    const padding = Math.max(this.match.mapPadding, ship.radius + 6);
    const forwardX = Math.cos(ship.angle || 0);
    const forwardY = Math.sin(ship.angle || 0);
    const sideX = -forwardY;
    const sideY = forwardX;
    ship.setBezierRoute(
      undefined,
      undefined,
      this.match.clampX(ship.x + forwardX * 90 + sideX * 88 * lateralSign, padding),
      this.match.clampY(ship.y + forwardY * 90 + sideY * 88 * lateralSign, padding),
      1,
      false,
    );
  }

  resolvePostCasualtyState(match = null) {
    this.promoteTwinToMain(match);
    this.normalizeSplitLevel();

    if (!this.ships.main.alive) {
      if (this.splitLevel < 1) {
        this.splitLevel = 1;
        this.releaseShipAfterFlagshipLoss(this.ships.sub1, 1);
      }
      this.normalizeSplitLevel();
      if (this.splitLevel < 2) {
        this.splitLevel = 2;
        this.releaseShipAfterFlagshipLoss(this.ships.sub2, -1);
      }
    }

    this.normalizeSplitLevel();
  }

  applySosBuff(ship) {
    const buff = SOS_BUFFS[Math.floor(Math.random() * SOS_BUFFS.length)];
    ship.effects.sosBuff = {
      id: buff.id,
      until: this.match.elapsed + 16,
    };
    ship.markActiveSkillEffectStarted("sosBuff");
    this.match.spawnFloatingTextKey(ship.x + 10, ship.y - 12, SOS_BUFF_TEXT_KEYS[buff.id] || buff.name, {}, buff.color, buff.name);
  }

  split(level) {
    this.resolvePostCasualtyState();
    if (level === 1 && this.splitLevel === 0 && this.ships.sub1.alive) {
      this.splitLevel = 1;
      this.ships.sub1.setBezierRoute(undefined, undefined, this.ships.main.x - 90, this.ships.main.y + 100, 1, false);
      return true;
    }
    if (level === 2 && this.splitLevel === 1 && this.ships.sub2.alive) {
      this.splitLevel = 2;
      this.ships.sub2.setBezierRoute(undefined, undefined, this.ships.main.x - 90, this.ships.main.y - 100, 1, false);
      return true;
    }
    return false;
  }

  updateEnergy(dt) {
    for (const ship of this.getAllShips()) {
      if (!ship.alive) {
        continue;
      }
      const throttle = ship.isAttached() ? this.ships.main.throttle : ship.throttle;
      const energyRate = energyRateForThrottle(ship.baseEnergyRegen(), ship.moveEnergyDrain(), throttle);
      ship.energy = clamp(ship.energy + energyRate * dt, 0, ship.maxEnergy);
    }
  }

  update(dt) {
    this.resolvePostCasualtyState();
    const cooldownStep = this.cooldownStep(dt);
    this.cooldowns.scout = Math.max(0, this.cooldowns.scout - cooldownStep);
    this.cooldowns.flagship = Math.max(0, this.cooldowns.flagship - cooldownStep);
    this.cooldowns.sub1 = Math.max(0, this.cooldowns.sub1 - cooldownStep);
    this.cooldowns.sub2 = Math.max(0, this.cooldowns.sub2 - cooldownStep);

    this.sponsorRegeneration(dt);
    this.updateEnergy(dt);
    for (const ship of this.getAllShips()) {
      ship.update(dt);
    }
    updateTeamVisionWaveSkill(this);
    this.maybeAutoLaunchScout();
    for (const scout of this.scouts) {
      scout.update(dt);
    }
    for (const wingman of this.wingmen) {
      wingman.update(dt);
    }
    for (const beam of this.beams) {
      if (beam.phase === "charge") {
        const ship = this.shipByKey(beam.shipKey);
        if (!ship || !ship.alive || ship.isAttached()) {
          beam.fired = true;
          beam.phase = "cancel";
          beam.life = 0;
          continue;
        }
        beam.x1 = ship.x;
        beam.y1 = ship.y;
        beam.x2 = this.match.clampX(ship.x + beam.dirX * beam.range, 0);
        beam.y2 = this.match.clampY(ship.y + beam.dirY * beam.range, 0);
        beam.progress = clamp(1 - beam.life / Math.max(beam.maxLife, 0.001), 0, 1);
      }
      beam.life -= dt;
    }

    this.scouts = this.scouts.filter((scout) => scout.alive);
    this.wingmen = this.wingmen.filter((wingman) => wingman.alive);
    this.beams = this.beams.filter((beam) => beam.life > 0 || (beam.phase === "charge" && !beam.fired));
  }

  maybeAutoLaunchScout() {
    if (!this.autoScout.enabled) {
      return false;
    }
    return this.launchScout(this.autoScout.zoneId, {
      cooldownMultiplier: AUTO_SCOUT_COOLDOWN_MULTIPLIER,
    });
  }

  launchScout(zoneId, options = {}) {
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
    const source = (requested && requested.alive ? requested : null)
      || (this.ships.main.alive ? this.ships.main : this.getAllShips().find((ship) => ship.alive));
    if (!source) {
      return false;
    }
    if (!this.spendEnergyForShip(source.key || "main", cost)) {
      return false;
    }
    const zone = this.match.zoneById(zoneId);
    this.scouts.push(new Scout(this, source.x, source.y, { zone, seekPoint: options.seekPoint }));
    this.cooldowns.scout = MANUAL_SCOUT_COOLDOWN * cooldownMultiplier;
    return true;
  }

  emergencyBrake(shipOrKey) {
    const ship = typeof shipOrKey === "string" ? this.shipByKey(shipOrKey) : shipOrKey;
    if (!ship || !ship.alive || !ship.canControl() || ship.isAttached()) {
      return false;
    }
    if ((ship.effects.brakeCooldownUntil || 0) > this.match.elapsed) {
      return false;
    }
    if (!this.spendEnergyForShip(ship, EMERGENCY_BRAKE_COST)) {
      return false;
    }
    ship.speed *= 0.34;
    ship.effects.brakeUntil = this.match.elapsed + EMERGENCY_BRAKE_DURATION;
    ship.effects.brakeCooldownUntil = this.match.elapsed + EMERGENCY_BRAKE_COOLDOWN;
    this.match.spawnBurst(ship.x, ship.y, "#98e9ff", 7);
    this.match.spawnFloatingTextKey(ship.x + 10, ship.y - 12, "急刹", {}, "#9eefff");
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

  castFlagshipSkill(zoneId = 5) {
    const characterId = this.loadout.main;
    const meta = skillMetaForCharacter(characterId, "flagship");
    if (!meta || meta.type !== "active") {
      return false;
    }
    if (!this.ships.main.alive) {
      return false;
    }
    if (this.areSkillsDisabled()) {
      return false;
    }
    if (this.cooldowns.flagship > 0) {
      return false;
    }

    let ok = false;
    if (characterId === "haruhi") {
      const targets = [this.ships.sub1, this.ships.sub2].filter((ship) => ship.alive);
      if (targets.length === 0) {
        return false;
      }
      if (!this.spendEnergyForShip("main", meta.cost || 0)) {
        return false;
      }
      for (const ship of targets) {
        this.applySosBuff(ship);
      }
      ok = true;
    } else if (characterId === "koizumi") {
      if (!this.spendEnergyForShip("main", meta.cost || 0)) {
        return false;
      }
      this.effects.taxiUntil = this.match.elapsed + (meta.duration || 12);
      this.effects.taxiInvulnUntil = this.match.elapsed + (meta.invulnerableDuration || 6);
      this.markActiveSkillEffectStarted("taxiUntil");
      this.markActiveSkillEffectStarted("taxiInvulnUntil");
      for (const ship of this.fleetMembersByKey("main")) {
        this.match.spawnFloatingTextKey(ship.x + 10, ship.y - 10, "加速", {}, "#9be0ff");
      }
      ok = true;
    } else if (characterId === "tsuruya") {
      if (!this.spendEnergyForShip("main", meta.cost || 0)) {
        return false;
      }
      this.effects.sponsorUntil = this.match.elapsed + (meta.duration || 8);
      this.markActiveSkillEffectStarted("sponsorUntil");
      for (const ship of this.getAllShips()) {
        if (!ship.alive) {
          continue;
        }
        this.match.spawnFloatingTextKey(ship.x + 10, ship.y - 10, "赞助", {}, "#ffd27e");
      }
      ok = true;
    } else if (characterId === "asakura") {
      if (!this.spendEnergyForShip("main", meta.cost || 0)) {
        return false;
      }
      const enemyTeam = this.match.enemyTeamBySeat(this.seat);
      enemyTeam.clearActiveSkillBuffs();
      activateTeamVisionWaveSkill(this, {
        duration: meta.duration || 6,
        interval: meta.pulseInterval || 1,
      });
      for (const ship of enemyTeam.getAllShips()) {
        if (!ship.alive) {
          continue;
        }
        this.match.spawnFloatingTextKey(ship.x + 10, ship.y - 10, "净化", {}, "#ff9db5");
      }
      ok = true;
    }

    if (!ok) {
      return false;
    }
    this.cooldowns.flagship = meta.cooldown || 0;
    this.revealCasterIfSeen(this.ships.main); // 旗舰技由主舰施放:若此刻正被敌方看见,永久暴露其名字
    return true;
  }

  // 施放技能的舰船若此刻正处于敌方视野内,则永久暴露它的名字(仅用于名牌显示)
  revealCasterIfSeen(ship) {
    if (!ship || ship.nameRevealed) {
      return;
    }
    const enemyTeam = this.match.enemyTeamBySeat(this.seat);
    if (enemyTeam && enemyTeam.visibleEnemyIds && enemyTeam.visibleEnemyIds.has(ship.id)) {
      ship.nameRevealed = true;
    }
  }

  castSubSkill(shipKey, options = {}) {
    const ship = this.ships[shipKey];
    if (!ship || !ship.alive || ship.isAttached()) {
      return false;
    }
    if (this.areSkillsDisabled()) {
      return false;
    }
    const meta = skillMetaForCharacter(ship.characterId, "sub");
    if (!meta || meta.type !== "active") {
      return false;
    }
    if ((this.cooldowns[shipKey] || 0) > 0) {
      return false;
    }
    if (!this.spendEnergyForShip(ship, meta.cost || 0)) {
      return false;
    }

    let ok = false;
    if (ship.characterId === "haruhi") {
      this.setShipEffect(ship, "critUntil", meta.duration || 8);
      ok = true;
    } else if (ship.characterId === "koizumi") {
      ok = this.blinkShip(ship, options.targetX, options.targetY, meta.blinkRange || 240);
      if (ok) {
        ship.effects.nextShotDamageMultiplier = 4;
        ship.markActiveSkillEffectStarted("nextShotDamageMultiplier");
      }
    } else if (ship.characterId === "yuki") {
      this.launchBurstScouts(ship);
      ok = true;
    } else if (ship.characterId === "future1096") {
      ok = this.castBeamFromShip(shipKey, options.targetX, options.targetY);
      if (!ok) {
        ship.energy = clamp(ship.energy + (meta.cost || 0), 0, ship.maxEnergy);
      }
    } else if (ship.characterId === "kyon") {
      this.setShipEffect(ship, "reliableUntil", meta.duration || 14);
      ship.hp = Math.min(ship.maxHp, ship.hp + ship.maxHp * 0.18);
      ok = true;
    } else if (ship.characterId === "tsuruya") {
      ok = this.bribeZone(ship, Number(options.zoneId) || 5);
      if (!ok) {
        ship.energy = clamp(ship.energy + (meta.cost || 0), 0, ship.maxEnergy);
      }
    } else if (ship.characterId === "asakura") {
      this.setShipEffect(ship, "bladeQueenUntil", meta.duration || 10);
      ok = true;
    }

    if (!ok) {
      return false;
    }
    this.cooldowns[shipKey] = meta.cooldown || 0;
    this.revealCasterIfSeen(ship); // 分舰技由该舰施放:若此刻正被敌方看见,永久暴露其名字
    return true;
  }

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
    const range = BEAM_BASE_RANGE;
    const beam = {
      id: nextEntityId(),
      shipKey,
      phase: "charge",
      x1: ship.x,
      y1: ship.y,
      x2: this.match.clampX(ship.x + dirX * range, 0),
      y2: this.match.clampY(ship.y + dirY * range, 0),
      dirX,
      dirY,
      range,
      color: "#8ef8ff",
      life: BEAM_CHARGE_DURATION,
      maxLife: BEAM_CHARGE_DURATION,
      progress: 0,
      fired: false,
    };
    this.beams.push(beam);
    return true;
  }

  bribeZone(ship, zoneId) {
    const zone = this.match.zoneById(zoneId);
    const enemyTeam = this.match.enemyTeamBySeat(this.seat);
    let converted = 0;

    for (const scout of enemyTeam.scouts) {
      if (!scout.alive || !zoneContains(zone, scout.x, scout.y)) {
        continue;
      }
      scout.team = this;
      this.scouts.push(scout);
      scout.command = { x: zone.x + zone.width * 0.5, y: zone.y + zone.height * 0.5 };
      converted += 1;
    }
    enemyTeam.scouts = enemyTeam.scouts.filter((scout) => scout.team === enemyTeam);

    for (const wingman of enemyTeam.wingmen) {
      if (!wingman.alive || !zoneContains(zone, wingman.x, wingman.y)) {
        continue;
      }
      wingman.team = this;
      wingman.zone = zone;
      wingman.command = { x: zone.x + zone.width * 0.5, y: zone.y + zone.height * 0.5 };
      this.wingmen.push(wingman);
      converted += 1;
    }
    enemyTeam.wingmen = enemyTeam.wingmen.filter((wingman) => wingman.team === enemyTeam);

    if (converted > 0) {
      this.match.spawnFloatingTextKey(ship.x + 10, ship.y - 14, "钞能力 x{count}", { count: converted }, "#ffd27e", `钞能力 x${converted}`);
    }
    return converted > 0;
  }

  spawnBeamHitParticles(x, y) {
    this.match.spawnBurst(x, y, "#8ef8ff", 11);
    for (let i = 0; i < 7; i += 1) {
      const angle = randomInRange(0, TAU);
      const offset = randomInRange(4, 28);
      const px = this.match.clampX(x + Math.cos(angle) * offset, 0);
      const py = this.match.clampY(y + Math.sin(angle) * offset, 0);
      this.match.spawnBurst(px, py, i % 2 === 0 ? "#bdf7ff" : "#9ef2ff", randomInRange(3.5, 7.5));
    }
  }

  resolveChargedBeams(enemyTeam) {
    for (const beam of this.beams) {
      if (beam.phase !== "charge" || beam.life > 0 || beam.fired) {
        continue;
      }
      const ship = this.shipByKey(beam.shipKey);
      if (!ship || !ship.alive || ship.isAttached()) {
        beam.fired = true;
        beam.phase = "cancel";
        beam.life = 0;
        continue;
      }

      beam.fired = true;
      beam.phase = "fire";
      beam.life = BEAM_VISUAL_DURATION;
      beam.maxLife = BEAM_VISUAL_DURATION;
      beam.progress = 1;
      beam.x1 = ship.x;
      beam.y1 = ship.y;
      beam.x2 = this.match.clampX(ship.x + beam.dirX * beam.range, 0);
      beam.y2 = this.match.clampY(ship.y + beam.dirY * beam.range, 0);

      let hitAny = false;
      for (const target of enemyTeam.getAllShips()) {
        if (!target.alive) {
          continue;
        }
        const probe = linePointDistance(beam.x1, beam.y1, beam.x2, beam.y2, target.x, target.y);
        if (probe.dist > target.radius + BEAM_HIT_RADIUS || probe.t < 0 || probe.t > 1) {
          continue;
        }
        const damage = target.maxHp * BEAM_DAMAGE_RATIO;
        target.takeDamage(damage, ship, this.match);
        this.match.spawnFloatingText(target.x + 8, target.y - 10, `-${Math.round(damage)}`, "#ffb7a8");
        this.spawnBeamHitParticles(target.x, target.y);
        hitAny = true;
      }

      if (!hitAny) {
        this.match.spawnBurst(beam.x2, beam.y2, "#78dfff", 9);
      }
    }
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
    computeTeamVisibility(this, enemyTeam);
  }

  // 某攻击者当前可开火的候选目标:已过滤"可见(或春日盲射)+ 进射程",并带上距离与射界密度。
  // 取最近/锁血/集火分配都基于这同一份候选,确保 AI 与玩家走完全一致的命中判定口径。
  fireCandidates(attacker, enemyTeam) {
    return teamFireCandidates(this, attacker, enemyTeam);
  }

  focusDamageBudget(attacker) {
    return attackerFocusDamageBudget(attacker);
  }

  isFocusWorthy(target) {
    return isTeamFocusWorthy(this, target);
  }

  assignFocusTargets(enemyTeam) {
    assignTeamFocusTargets(this, enemyTeam);
  }

  pickTargetFor(attacker, enemyTeam) {
    return pickTeamTarget(this, attacker, enemyTeam);
  }

  stepCombat(enemyTeam) {
    stepTeamCombat(this, enemyTeam);
  }

  serialize() {
    return {
      seat: this.seat,
      name: this.name,
      color: this.color,
      splitLevel: this.splitLevel,
      loadout: cloneLoadout(this.loadout),
      energy: this.fleetEnergyForShip("main").current,
      maxEnergy: this.fleetEnergyForShip("main").max,
      hullRatio: this.hullRatio(),
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
      visionWaves: this.serializeVisionWaves(),
      ships: {
        main: this.ships.main.serialize(),
        sub1: this.ships.sub1.serialize(),
        sub2: this.ships.sub2.serialize(),
      },
      extraShips: this.extraShips.map((ship) => ship.serialize()),
      scouts: this.scouts.filter((item) => item.alive).map((item) => item.serialize()),
      wingmen: this.wingmen.filter((item) => item.alive).map((item) => item.serialize()),
      beams: this.beams.map((beam) => ({
        id: beam.id,
        shipKey: beam.shipKey,
        phase: beam.phase || "fire",
        x1: beam.x1,
        y1: beam.y1,
        x2: beam.x2,
        y2: beam.y2,
        progress: Number.isFinite(beam.progress) ? beam.progress : 1,
        color: beam.color,
        life: beam.life,
        maxLife: beam.maxLife || beam.life,
      })),
    };
  }
}

export class MatchSimulation {
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

    this.mode = mode;
    this.worldSize = worldSize;
    this.mapPadding = mapPadding;
    this.aiAutoBeam = aiAutoBeam;
    this.aiSeats = aiSeats;
    this.tutorialMode = Boolean(options.tutorialMode);
    this.combatEnabled = { A: true, B: true };
    this.aiEnabled = { A: true, B: true };
    this.zones = buildZones(worldSize);

    this.tick = 0;
    this.elapsed = 0;
    this.phase = "running";
    this.winnerSeat = null;

    const centerY = worldSize * 0.5;
    const leftX = worldSize * 0.35;
    const rightX = worldSize * 0.65;

    this.teamA = new Team(this, "A", teamNames.A || "玩家A舰队", leftX, centerY, 0, {
      loadout: teamLoadouts.A || DEFAULT_TEAM_LOADOUT,
    });
    this.teamB = new Team(this, "B", teamNames.B || (mode === "ai" ? "统合思念体AI舰队" : "玩家B舰队"), rightX, centerY, Math.PI, {
      loadout: teamLoadouts.B || (mode === "ai" ? DEFAULT_AI_LOADOUT : DEFAULT_TEAM_LOADOUT),
    });

    this.projectiles = [];
    this.bursts = [];
    this.floatingTexts = [];
    this.bots = {};
    const legacyAiSeats = normalizeAiSeats(mode, options.legacyAiSeats); // 指定哪些AI席位用旧版AI
    const aiDifficulty = options.aiDifficulty || "master"; // 单人难度(默认满状态);只影响AI反应延迟,不改能力
    for (const seat of this.aiSeats) {
      const bot = new BotController(this.teamBySeat(seat), this.enemyTeamBySeat(seat));
      bot.legacy = legacyAiSeats.includes(seat);
      bot.setDifficulty(aiDifficulty);
      this.bots[seat] = bot;
    }
    this.botA = this.bots.A || null;
    this.bot = this.bots.B || null;
    if (this.tutorialMode) {
      this.configureTutorialBattle();
    }
  }

  configureTutorialBattle() {
    this.teamA.damageFloorRatio = 0.25;
    this.teamB.forceCharacterSkillsDisabled = true;
    this.teamB.splitLevel = 2;
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
    for (const ship of this.teamB.getAllShips()) {
      ship.base = { ...ship.base, ...trainingStats };
      ship.maxHp = trainingStats.hp;
      ship.hp = trainingStats.hp;
      ship.maxEnergy = trainingStats.energy;
      ship.energy = trainingStats.energy;
      const pos = positions[ship.key] || positions.main;
      ship.x = pos.x;
      ship.y = pos.y;
      ship.command = { x: pos.x, y: pos.y };
      ship.route = null;
      ship.speed = 0;
    }
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

  // 撞击:任意两艘存活舰船的船体重叠时把彼此推开解除重叠;减速只在「刚撞上」的那一帧施加一次
  // (用上一帧的接触集做迟滞判定),持续贴着不再反复减速,避免被一路压停。同队编队跟随的舰不互撞。
  resolveShipCollisions() {
    resolveMatchShipCollisions(this);
  }

  resolveScoutClashes() {
    resolveMatchScoutClashes(this);
  }

  resolveBladeQueenContacts() {
    resolveMatchBladeQueenContacts(this);
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
    this.floatingTexts.push(new FloatingText(x, y, text, color, meta));
  }

  spawnFloatingTextKey(x, y, textKey, args = {}, color = "#ffd178", fallback = textKey) {
    this.spawnFloatingText(x, y, fallback, color, {
      textKey,
      textArgs: args,
    });
  }

  spawnBurst(x, y, color = "#ffdb9b", radius = 7) {
    this.bursts.push(new Burst(x, y, color, radius));
  }

  updateProjectiles(dt) {
    for (const projectile of this.projectiles) {
      projectile.update(dt, this);
    }
    this.projectiles = this.projectiles.filter((projectile) => projectile.alive);
  }

  updateVisualEffects(dt) {
    for (const burst of this.bursts) {
      burst.update(dt);
    }
    this.bursts = this.bursts.filter((burst) => burst.life > 0);

    for (const label of this.floatingTexts) {
      label.update(dt);
    }
    this.floatingTexts = this.floatingTexts.filter((label) => label.life > 0);
  }

  update(dt = TICK_DT) {
    if (this.phase !== "running") {
      return;
    }

    const safeDt = clamp(dt, 0, 0.05);
    this.tick += 1;
    this.elapsed += safeDt;

    for (const [seat, bot] of Object.entries(this.bots)) {
      if (this.aiEnabled[seat] !== false) bot.update(safeDt, this.elapsed);
    }

    this.teamA.update(safeDt);
    this.teamB.update(safeDt);

    this.resolveShipCollisions();
    this.resolveBladeQueenContacts();
    this.resolveScoutClashes();
    this.teamA.computeVisibility(this.teamB);
    this.teamB.computeVisibility(this.teamA);
    this.teamA.updateRadarPassive(this.teamB, safeDt);
    this.teamB.updateRadarPassive(this.teamA, safeDt);
    this.teamA.resolveChargedBeams(this.teamB);
    this.teamB.resolveChargedBeams(this.teamA);

    if (this.combatEnabled.A) this.teamA.stepCombat(this.teamB);
    if (this.combatEnabled.B) this.teamB.stepCombat(this.teamA);
    this.updateProjectiles(safeDt);
    this.updateVisualEffects(safeDt);

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
      zones: this.zones,
      phase: this.phase,
      winnerSeat: this.winnerSeat,
      elapsed: this.elapsed,
      projectiles: this.projectiles.map((projectile) => projectile.serialize()),
      bursts: this.bursts.map((burst) => burst.serialize()),
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
