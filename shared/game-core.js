export const DEFAULT_WORLD_SIZE = 1800;
export const DEFAULT_MAP_PADDING = 20;
export const TICK_RATE = 30;
export const SNAPSHOT_RATE = 20;
export const TICK_DT = 1 / TICK_RATE;

const TAU = Math.PI * 2;
const BEAM_CHARGE_DURATION = 1.05;
const BEAM_VISUAL_DURATION = 0.26;
const BEAM_BASE_RANGE = 1460;
const BEAM_HIT_RADIUS = 11;
const BEAM_DAMAGE_RATIO = 0.28;
const DEG_TO_RAD = Math.PI / 180;
const FLAGSHIP_TURN_PENALTIES = {
  1: 1.14,
  2: 0.88,
  3: 0.68,
  4: 0.62,
};

export const FIRE_ARC_BANDS = Object.freeze([
  { startDeg: -60, endDeg: 60, multiplier: 1 },
  { startDeg: 60, endDeg: 120, multiplier: 1.5 },
  { startDeg: -120, endDeg: -60, multiplier: 1.5 },
  { startDeg: 120, endDeg: 150, multiplier: 1 },
  { startDeg: -150, endDeg: -120, multiplier: 1 },
  { startDeg: 150, endDeg: 180, multiplier: 0 },
  { startDeg: -180, endDeg: -150, multiplier: 0 },
]);

export function fireArcDensityMultiplier(relativeAngle, uniformOutput = false) {
  if (uniformOutput) {
    return 1.02;
  }
  const absAngle = Math.abs(relativeAngle);
  if (absAngle <= 60 * DEG_TO_RAD) {
    return 1;
  }
  if (absAngle <= 120 * DEG_TO_RAD) {
    return 1.5;
  }
  if (absAngle <= 150 * DEG_TO_RAD) {
    return 1;
  }
  return 0;
}

export const CHARACTER_ORDER = ["haruhi", "koizumi", "yuki", "future1096", "kyon", "tsuruya"];

export const CHARACTER_DEFS = {
  haruhi: {
    id: "haruhi",
    name: "凉宫春日",
    shortName: "春日",
    title: "团长型火力旗舰",
    flavor: "高压制、高爆发，适合主动开团。",
    stats: {
      hp: 880,
      energy: 130,
      speed: 33,
      turnRate: 0.36,
      accel: 1.02,
      energyRegen: 12.5,
      moveDrain: 8.2,
      vision: 172,
      range: 520,
      damage: 29,
      fireRate: 0.47,
      radius: 10,
    },
    flagshipSkill: {
      id: "sos_leader",
      name: "SOS团长",
      type: "active",
      cooldown: 22,
      cost: 68,
      duration: 16,
      target: "none",
      description: "为每个分舰随机赋予一种强化。",
    },
    subSkill: {
      id: "god_says_win",
      name: "神说会赢的",
      type: "active",
      cooldown: 20,
      cost: 46,
      duration: 10,
      target: "none",
      description: "10秒内自身攻击50%概率暴击，造成3倍伤害。",
    },
  },
  koizumi: {
    id: "koizumi",
    name: "古泉一树",
    shortName: "古泉",
    title: "均衡型机动指挥舰",
    flavor: "转向和加速优秀，兼顾持续作战。",
    stats: {
      hp: 760,
      energy: 120,
      speed: 35,
      turnRate: 0.43,
      accel: 1.18,
      energyRegen: 12,
      moveDrain: 7.7,
      vision: 160,
      range: 500,
      damage: 23,
      fireRate: 0.5,
      radius: 9,
    },
    flagshipSkill: {
      id: "agency_power",
      name: "机关的力量",
      type: "active",
      cooldown: 18,
      cost: 58,
      duration: 12,
      target: "none",
      description: "全舰队获得显著加速度提升。",
    },
    subSkill: {
      id: "esper",
      name: "超能力",
      type: "active",
      cooldown: 22,
      cost: 50,
      duration: 15,
      target: "none",
      description: "15秒内自身全属性提升。",
    },
  },
  yuki: {
    id: "yuki",
    name: "长门有希",
    shortName: "有希",
    title: "高感知统合支援舰",
    flavor: "探测和能量优秀，但推进偏慢。",
    stats: {
      hp: 720,
      energy: 170,
      speed: 31,
      turnRate: 0.48,
      accel: 0.94,
      energyRegen: 14.8,
      moveDrain: 7.2,
      vision: 205,
      range: 540,
      damage: 24,
      fireRate: 0.44,
      radius: 9,
    },
    flagshipSkill: {
      id: "vanishing_world",
      name: "消失的世界",
      type: "passive",
      description: "本舰队角色技能与通用技能封印，但每艘船各自拥有一次复活。",
    },
    subSkill: {
      id: "apm_overdrive",
      name: "apm上万",
      type: "active",
      cooldown: 24,
      cost: 60,
      target: "none",
      description: "向八方向各放出一对高速侦察机。",
    },
  },
  future1096: {
    id: "future1096",
    name: "朝比奈1096",
    shortName: "1096",
    title: "高速光束突击舰",
    flavor: "机动极高，舰体偏脆，适合侧翼切入。",
    stats: {
      hp: 640,
      energy: 125,
      speed: 37,
      turnRate: 0.5,
      accel: 1.15,
      energyRegen: 11.4,
      moveDrain: 7.9,
      vision: 165,
      range: 550,
      damage: 20,
      fireRate: 0.54,
      radius: 8,
    },
    flagshipSkill: {
      id: "past_future_me",
      name: "过去与未来的我",
      type: "passive",
      description: "旗舰位额外生成一艘1096僚舰，两舰舰体各为常规旗舰的一半。",
    },
    subSkill: {
      id: "beam_1096",
      name: "1096光线",
      type: "active",
      cooldown: 12,
      cost: 74,
      target: "point",
      description: "蓄力后向指定方向发射高伤害光线。",
    },
  },
  kyon: {
    id: "kyon",
    name: "阿虚",
    shortName: "阿虚",
    title: "稳定型近战指挥舰",
    flavor: "转向稳定、容错更高，火力方向限制低。",
    stats: {
      hp: 900,
      energy: 115,
      speed: 34,
      turnRate: 0.45,
      accel: 1.1,
      energyRegen: 11,
      moveDrain: 8.1,
      vision: 158,
      range: 490,
      damage: 24,
      fireRate: 0.52,
      radius: 10,
    },
    flagshipSkill: {
      id: "reality_seeker",
      name: "在虚构世界里寻求现实感的人才有问题",
      type: "passive",
      description: "全舰队转向阻力大幅降低，任意朝向输出效率接近一致。",
    },
    subSkill: {
      id: "reliable_normal",
      name: "靠谱的普通人",
      type: "active",
      cooldown: 18,
      cost: 42,
      duration: 14,
      target: "none",
      description: "短时间提升转向与耐久，并立即回复部分舰体。",
    },
  },
  tsuruya: {
    id: "tsuruya",
    name: "鹤屋学姐",
    shortName: "鹤屋",
    title: "高周转支援舰",
    flavor: "技能回转快，干扰敌方附属单位能力强。",
    stats: {
      hp: 700,
      energy: 145,
      speed: 36,
      turnRate: 0.47,
      accel: 1.22,
      energyRegen: 12.8,
      moveDrain: 7.5,
      vision: 166,
      range: 480,
      damage: 22,
      fireRate: 0.56,
      radius: 9,
    },
    flagshipSkill: {
      id: "secret_sponsor",
      name: "神秘赞助人",
      type: "passive",
      description: "全体技能冷却流逝速度提升。",
    },
    subSkill: {
      id: "money_power",
      name: "钞能力",
      type: "active",
      cooldown: 24,
      cost: 66,
      target: "zone",
      description: "令一个战区内的敌军僚机与侦察机叛变。",
    },
  },
};

export const DEFAULT_TEAM_LOADOUT = Object.freeze({
  main: "haruhi",
  sub1: "koizumi",
  sub2: "future1096",
});

export const DEFAULT_AI_LOADOUT = Object.freeze({
  main: "kyon",
  sub1: "tsuruya",
  sub2: "yuki",
});

const TEAM_COLORS = {
  A: "#65d9ff",
  B: "#ff8692",
};

const TEAM_PROJECTILE_COLORS = {
  A: "#9be8ff",
  B: "#ffc0bd",
};

const SOS_BUFFS = [
  {
    id: "alien",
    name: "宇宙人",
    color: "#6de7ff",
    apply(ship, stat, value) {
      if (stat === "vision") {
        return value * 1.22;
      }
      if (stat === "range") {
        return value * 1.18;
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
        return value * 1.15;
      }
      if (stat === "damage") {
        return value * 1.16;
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
        return value * 1.16;
      }
      if (stat === "regen") {
        return value * 1.22;
      }
      if (stat === "accel") {
        return value * 1.14;
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
        return value * 1.18;
      }
      return value;
    },
    damageTakenMultiplier: 0.82,
  },
];

function getCharacterDef(characterId) {
  return CHARACTER_DEFS[characterId] || CHARACTER_DEFS[DEFAULT_TEAM_LOADOUT.main];
}

export function slotLabel(slotKey) {
  if (slotKey === "main") {
    return "主舰";
  }
  if (slotKey === "sub1") {
    return "副舰一";
  }
  if (slotKey === "sub2") {
    return "副舰二";
  }
  if (slotKey === "twin") {
    return "僚舰";
  }
  return "舰船";
}

export function normalizeLoadout(loadout = {}, fallback = DEFAULT_TEAM_LOADOUT) {
  const used = new Set();
  const order = [];
  const fallbackList = [fallback.main, fallback.sub1, fallback.sub2, ...CHARACTER_ORDER];

  function pick(candidate) {
    if (candidate && CHARACTER_DEFS[candidate] && !used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
    const next = fallbackList.find((id) => CHARACTER_DEFS[id] && !used.has(id));
    used.add(next);
    return next;
  }

  order.push(pick(loadout.main));
  order.push(pick(loadout.sub1));
  order.push(pick(loadout.sub2));

  return {
    main: order[0],
    sub1: order[1],
    sub2: order[2],
  };
}

export function cloneLoadout(loadout = DEFAULT_TEAM_LOADOUT) {
  const safe = normalizeLoadout(loadout, DEFAULT_TEAM_LOADOUT);
  return {
    main: safe.main,
    sub1: safe.sub1,
    sub2: safe.sub2,
  };
}

export function skillMetaForCharacter(characterId, mode = "flagship") {
  const character = getCharacterDef(characterId);
  return mode === "sub" ? character.subSkill : character.flagshipSkill;
}

let globalEntityId = 1;
function nextEntityId() {
  globalEntityId += 1;
  return globalEntityId;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function distance(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

function distanceSq(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

function dot(ax, ay, bx, by) {
  return ax * bx + ay * by;
}

function shortestAngleDelta(from, to) {
  let delta = (to - from + Math.PI) % TAU;
  if (delta < 0) {
    delta += TAU;
  }
  return delta - Math.PI;
}

function rotateOffset(x, y, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return {
    x: x * c - y * s,
    y: x * s + y * c,
  };
}

function linePointDistance(x1, y1, x2, y2, px, py) {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const wx = px - x1;
  const wy = py - y1;
  const c1 = vx * wx + vy * wy;
  const c2 = vx * vx + vy * vy;
  const t = c2 <= 0 ? 0 : clamp(c1 / c2, 0, 1);
  const projX = x1 + vx * t;
  const projY = y1 + vy * t;
  return {
    dist: distance(px, py, projX, projY),
    t,
  };
}

export function quadraticPoint(p0, p1, p2, t) {
  const inv = 1 - t;
  return {
    x: inv * inv * p0.x + 2 * inv * t * p1.x + t * t * p2.x,
    y: inv * inv * p0.y + 2 * inv * t * p1.y + t * t * p2.y,
  };
}

function quadraticLengthApprox(p0, p1, p2, steps = 22) {
  let total = 0;
  let prev = { x: p0.x, y: p0.y };
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const curr = quadraticPoint(p0, p1, p2, t);
    total += distance(prev.x, prev.y, curr.x, curr.y);
    prev = curr;
  }
  return Math.max(1, total);
}

function quadraticStartCurvature(p0, p1, p2) {
  const vx = p1.x - p0.x;
  const vy = p1.y - p0.y;
  const speed = Math.hypot(vx, vy);
  if (speed < 1e-4) {
    return Infinity;
  }
  const ax = p2.x - 2 * p1.x + p0.x;
  const ay = p2.y - 2 * p1.y + p0.y;
  const cross = Math.abs(vx * ay - vy * ax);
  return cross / (2 * speed * speed * speed);
}

function randomInRange(min, max) {
  return Math.random() * (max - min) + min;
}

function zoneContains(zone, x, y) {
  return Boolean(zone && x >= zone.x && x <= zone.x + zone.width && y >= zone.y && y <= zone.y + zone.height);
}

export function buildZones(worldSize = DEFAULT_WORLD_SIZE) {
  const zones = [];
  const zoneSize = worldSize / 3;
  let id = 1;
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      zones.push({
        id,
        row,
        col,
        x: col * zoneSize,
        y: row * zoneSize,
        width: zoneSize,
        height: zoneSize,
      });
      id += 1;
    }
  }
  return zones;
}

class FloatingText {
  constructor(x, y, text, color = "#ffd178") {
    this.id = nextEntityId();
    this.kind = "floating_text";
    this.x = x;
    this.y = y;
    this.text = String(text || "");
    this.color = color;
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
      match.spawnFloatingText(this.x, this.y, "未命中", "#92c5ff");
      return;
    }
    hitTarget.takeDamage(this.damage, null, match);
    match.spawnFloatingText(hitTarget.x + 8, hitTarget.y - 8, `-${Math.round(this.damage)}`, "#ffd178");
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
      alive: this.alive,
      radius: this.radius,
      color: this.color,
    };
  }
}

class Ship {
  constructor(team, key, x, y, facing, options = {}) {
    this.id = nextEntityId();
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
    this.throttle = 1;
    this.command = { x, y };
    this.route = null;

    this.maxHp = this.base.hp;
    this.hp = this.maxHp;
    this.maxEnergy = this.base.energy;
    this.energy = this.maxEnergy;
    this.radius = this.base.radius;
    this.alive = true;

    this.cooldown = randomInRange(0, 0.5);
    this.formationOffset = { x: 0, y: 0 };
    this.reviveCharges = 0;

    this.effects = {
      critUntil: 0,
      superpowerUntil: 0,
      reliableUntil: 0,
      sosBuff: null,
    };
  }

  setHalfHullMode() {
    this.maxHp = Math.round(this.base.hp * 0.55);
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

  statWithBuffs(statKey, baseValue) {
    let value = baseValue;
    const sos = this.activeSosBuff();
    if (sos) {
      value = sos.apply(this, statKey, value);
    }

    if (this.hasEffect("superpowerUntil")) {
      if (["speed", "turnRate", "damage", "vision", "range", "fireRate", "regen", "accel"].includes(statKey)) {
        value *= 1.18;
      }
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
    return this.statWithBuffs("damage", this.base.damage);
  }

  effectiveFireRate() {
    return this.statWithBuffs("fireRate", this.base.fireRate);
  }

  damageTakenMultiplier() {
    let value = 1;
    const sos = this.activeSosBuff();
    if (sos && sos.damageTakenMultiplier) {
      value *= sos.damageTakenMultiplier;
    }
    if (this.hasEffect("superpowerUntil")) {
      value *= 0.9;
    }
    if (this.hasEffect("reliableUntil")) {
      value *= 0.84;
    }
    return value;
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
    let maxStartDeviation = (Math.PI / 180) * clamp(52 - speedRef * 0.22, 16, 42);
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
    this.throttle = clamp(throttle, 0.25, 1.4);
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

    const desired = Math.atan2(navTargetY - this.y, navTargetX - this.x);
    const delta = shortestAngleDelta(this.angle, desired);
    const deltaAbs = Math.abs(delta);
    const turnUrgency = clamp(deltaAbs / Math.PI, 0, 1);
    const reverseAssist = this.route && deltaAbs > 2.35 ? 0.85 : 0;
    const turnBoost = this.route ? 1 + turnUrgency * 2.8 + reverseAssist : 1;
    const turnRate = this.effectiveTurnRate() * (0.22 + this.throttle * 0.4) * turnBoost;
    this.angle += clamp(delta, -turnRate * dt, turnRate * dt);

    const dist = distance(this.x, this.y, navTargetX, navTargetY);
    const throttlePenalty = this.team.availableEnergyForShip(this) <= 0 ? 0.15 : 1;
    const steerBrake = this.route ? clamp(1 - turnUrgency * 0.78, 0.22, 1) : 1;
    const targetSpeed = dist < 8 ? 0 : this.effectiveSpeed() * this.throttle * throttlePenalty * steerBrake;

    const accelResponse = clamp(this.baseAcceleration() * this.team.accelerationModifierForShip(this), 0.65, 2.4);
    this.speed = lerp(this.speed, targetSpeed, clamp(dt * accelResponse, 0, 1));

    this.x += Math.cos(this.angle) * this.speed * dt;
    this.y += Math.sin(this.angle) * this.speed * dt;
    this.x = match.clampX(this.x, 8);
    this.y = match.clampY(this.y, 8);

    if (this.route) {
      const minAdvance = 5;
      const routeSpeed = Math.max(minAdvance, this.speed);
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

    const desired = Math.atan2(ty - this.y, tx - this.x);
    const delta = shortestAngleDelta(this.angle, desired);
    const turnRate = this.effectiveFormationTurnRate();
    this.angle += clamp(delta, -turnRate * dt, turnRate * dt);

    const dist = distance(this.x, this.y, tx, ty);
    const fleetSpeed = this.effectiveSpeed();
    const catchup = clamp(dist * (compactMode ? 0.86 : 0.52), 0, compactMode ? 52 : 30);
    const targetSpeed = Math.min(fleetSpeed + catchup, fleetSpeed * (compactMode ? 1.4 : 1.18));
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

    if (this.hasEffect("critUntil") && Math.random() < 0.5) {
      damage *= 3;
      match.spawnFloatingText(this.x + 12, this.y - 12, "暴击", "#ffdd73");
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

  tryRevive(match) {
    if (this.reviveCharges <= 0) {
      return false;
    }
    this.reviveCharges -= 1;
    this.hp = this.maxHp * 0.52;
    this.energy = Math.max(this.energy, this.maxEnergy * 0.4);
    this.alive = true;
    match.spawnBurst(this.x, this.y, "#8cf7ff", 13);
    match.spawnFloatingText(this.x + 6, this.y - 14, "再起动", "#9bf7ff");
    return true;
  }

  takeDamage(amount, _source = null, match = null) {
    if (!this.alive) {
      return;
    }
    const finalAmount = amount * this.damageTakenMultiplier();
    this.hp = Math.max(0, this.hp - finalAmount);
    if (this.hp > 0) {
      return;
    }
    if (match && this.tryRevive(match)) {
      return;
    }
    this.alive = false;
    this.speed = 0;
    this.route = null;
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
      reviveCharges: this.reviveCharges,
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
    this.visibleEnemyIds = new Set();
    this.cooldowns = {
      scout: 0,
      flagship: 0,
      sub1: 0,
      sub2: 0,
    };

    this.effects = {
      taxiUntil: 0,
    };

    this.ships = {
      main: new Ship(this, "main", spawnX, spawnY, facing, {
        slotKey: "main",
        characterId: this.loadout.main,
      }),
      sub1: new Ship(this, "sub1", spawnX - 18, spawnY + 14, facing, {
        slotKey: "sub1",
        characterId: this.loadout.sub1,
      }),
      sub2: new Ship(this, "sub2", spawnX - 18, spawnY - 14, facing, {
        slotKey: "sub2",
        characterId: this.loadout.sub2,
      }),
    };

    this.ships.sub1.formationOffset = { x: -28, y: 18 };
    this.ships.sub2.formationOffset = { x: -28, y: -18 };

    this.extraShips = [];
    this.applyFlagshipPassives(spawnX, spawnY, facing);

    this.scouts = [];
    this.wingmen = [];
    this.beams = [];
  }

  applyFlagshipPassives(spawnX, spawnY, facing) {
    if (this.hasYukiFlagship()) {
      for (const ship of this.getPlayerShips()) {
        ship.reviveCharges = 1;
      }
    }

    if (this.mainCharacterId() === "future1096") {
      this.ships.main.setHalfHullMode();
      const twin = new Ship(this, "twin", spawnX - 34, spawnY, facing, {
        slotKey: "twin",
        roleLabel: "1096僚舰",
        characterId: "future1096",
        isAuxiliary: true,
        attachToMain: true,
      });
      twin.setHalfHullMode();
      twin.formationOffset = { x: -42, y: 0 };
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

  getPlayerShips() {
    return [this.ships.main, this.ships.sub1, this.ships.sub2];
  }

  getAllShips() {
    return [...this.getPlayerShips(), ...this.extraShips];
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
    if (ship.hasEffect("superpowerUntil")) {
      list.push("超能力");
    }
    if (ship.hasEffect("reliableUntil")) {
      list.push("靠谱的普通人");
    }
    return list;
  }

  areSkillsDisabled() {
    return this.hasYukiFlagship();
  }

  cooldownStep(dt) {
    return dt * (this.hasTsuruyaFlagship() ? 1.28 : 1);
  }

  setShipEffect(ship, key, duration) {
    ship.effects[key] = this.match.elapsed + duration;
  }

  applySosBuff(ship) {
    const buff = SOS_BUFFS[Math.floor(Math.random() * SOS_BUFFS.length)];
    ship.effects.sosBuff = {
      id: buff.id,
      until: this.match.elapsed + 16,
    };
    this.match.spawnFloatingText(ship.x + 10, ship.y - 12, buff.name, buff.color);
  }

  split(level) {
    if (level === 1 && this.splitLevel === 0) {
      this.splitLevel = 1;
      this.ships.sub1.setBezierRoute(undefined, undefined, this.ships.main.x - 90, this.ships.main.y + 100, 1, false);
      return true;
    }
    if (level === 2 && this.splitLevel === 1) {
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
      const regenMultiplier = throttle <= 1 ? 1 + (1 - throttle) * 0.76 : 1 - (throttle - 1) * 0.72;
      const regen = Math.max(1.2, ship.baseEnergyRegen() * regenMultiplier);
      const moveCost = ship.moveEnergyDrain() * clamp(throttle, 0.2, 1.4);
      ship.energy = clamp(ship.energy + (regen - moveCost) * dt, 0, ship.maxEnergy);
    }
  }

  update(dt) {
    const cooldownStep = this.cooldownStep(dt);
    this.cooldowns.scout = Math.max(0, this.cooldowns.scout - cooldownStep);
    this.cooldowns.flagship = Math.max(0, this.cooldowns.flagship - cooldownStep);
    this.cooldowns.sub1 = Math.max(0, this.cooldowns.sub1 - cooldownStep);
    this.cooldowns.sub2 = Math.max(0, this.cooldowns.sub2 - cooldownStep);

    this.updateEnergy(dt);
    for (const ship of this.getAllShips()) {
      ship.update(dt);
    }
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

  launchScout(zoneId) {
    const cost = 28;
    if (this.areSkillsDisabled()) {
      return false;
    }
    if (this.cooldowns.scout > 0) {
      return false;
    }
    if (!this.spendEnergyForShip("main", cost)) {
      return false;
    }
    const zone = this.match.zoneById(zoneId);
    const source = this.ships.main.alive ? this.ships.main : this.getAllShips().find((ship) => ship.alive);
    if (!source) {
      return false;
    }
    this.scouts.push(new Scout(this, source.x, source.y, { zone }));
    this.cooldowns.scout = 2.6;
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
      for (const ship of this.fleetMembersByKey("main")) {
        this.match.spawnFloatingText(ship.x + 10, ship.y - 10, "加速", "#9be0ff");
      }
      ok = true;
    }

    if (!ok) {
      return false;
    }
    this.cooldowns.flagship = meta.cooldown || 0;
    return true;
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
      this.setShipEffect(ship, "critUntil", meta.duration || 10);
      ok = true;
    } else if (ship.characterId === "koizumi") {
      this.setShipEffect(ship, "superpowerUntil", meta.duration || 15);
      ok = true;
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
    }

    if (!ok) {
      return false;
    }
    this.cooldowns[shipKey] = meta.cooldown || 0;
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
    if (aimLen < 1e-4) {
      return false;
    }
    const dirX = aimDx / aimLen;
    const dirY = aimDy / aimLen;
    const range = BEAM_BASE_RANGE;
    const x2 = this.match.clampX(ship.x + dirX * range, 0);
    const y2 = this.match.clampY(ship.y + dirY * range, 0);
    this.beams.push({
      id: nextEntityId(),
      shipKey,
      phase: "charge",
      x1: ship.x,
      y1: ship.y,
      x2,
      y2,
      dirX,
      dirY,
      range,
      color: "#8ef8ff",
      life: BEAM_CHARGE_DURATION,
      maxLife: BEAM_CHARGE_DURATION,
      progress: 0,
      fired: false,
    });
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
      this.match.spawnFloatingText(ship.x + 10, ship.y - 14, `钞能力 x${converted}`, "#ffd27e");
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

  computeVisibility(enemyTeam) {
    this.visibleEnemyIds.clear();
    const sensors = this.getVisionSources();
    if (sensors.length === 0) {
      return;
    }
    const enemyEntities = enemyTeam.getEntities();
    for (const enemy of enemyEntities) {
      for (const sensor of sensors) {
        if (distanceSq(enemy.x, enemy.y, sensor.x, sensor.y) <= sensor.range * sensor.range) {
          this.visibleEnemyIds.add(enemy.id);
          break;
        }
      }
    }
  }

  pickTargetFor(attacker, enemyTeam) {
    const candidates = enemyTeam.getEntities();
    const range = attacker.attackRange || attacker.effectiveRange();
    let nearest = null;
    let nearestDist = Infinity;
    for (const target of candidates) {
      if (!target.alive) {
        continue;
      }
      if (!this.visibleEnemyIds.has(target.id)) {
        continue;
      }
      const d = distance(attacker.x, attacker.y, target.x, target.y);
      if (d <= range && d < nearestDist) {
        nearestDist = d;
        nearest = target;
      }
    }
    return nearest;
  }

  stepCombat(enemyTeam) {
    for (const ship of this.getAllShips()) {
      ship.tryAttack(this.match, enemyTeam);
    }
    for (const wingman of this.wingmen) {
      wingman.tryAttack(this.match, enemyTeam);
    }
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
      cooldowns: {
        scout: this.cooldowns.scout,
        flagship: this.cooldowns.flagship,
        sub1: this.cooldowns.sub1,
        sub2: this.cooldowns.sub2,
      },
      visibleEnemyIds: Array.from(this.visibleEnemyIds),
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

class BotController {
  constructor(team, enemy) {
    this.team = team;
    this.enemy = enemy;

    this.moveTimer = 0;
    this.scoutTimer = 4;
    this.flagshipTimer = 8;
    this.subTimers = {
      sub1: 14,
      sub2: 17,
    };
    this.modeTimer = 0;
    this.mode = "press";

    this.lastMainPos = {
      x: team.ships.main.x,
      y: team.ships.main.y,
    };
    this.stuckTimer = 0;
  }

  update(dt, elapsed) {
    this.moveTimer -= dt;
    this.scoutTimer -= dt;
    this.flagshipTimer -= dt;
    this.subTimers.sub1 -= dt;
    this.subTimers.sub2 -= dt;
    this.modeTimer -= dt;

    this.updateStuckState(dt);

    if (elapsed > 22 && this.team.splitLevel < 1) {
      this.team.split(1);
    }
    if (elapsed > 46 && this.team.splitLevel < 2) {
      this.team.split(2);
    }

    if (this.moveTimer <= 0 || this.stuckTimer > 2) {
      this.issueMovement();
      this.moveTimer = randomInRange(4.2, 6.4);
      this.stuckTimer = 0;
    }

    if (this.scoutTimer <= 0 && !this.team.areSkillsDisabled()) {
      const zone = this.team.match.zones[Math.floor(Math.random() * this.team.match.zones.length)];
      this.team.launchScout(zone.id);
      this.scoutTimer = randomInRange(8, 12);
    }

    this.tryFlagshipSkill();
    this.trySubSkill("sub1");
    this.trySubSkill("sub2");
  }

  tryFlagshipSkill() {
    if (this.flagshipTimer > 0) {
      return;
    }
    const ok = this.team.castFlagshipSkill();
    this.flagshipTimer = ok ? randomInRange(16, 22) : randomInRange(6, 10);
  }

  trySubSkill(shipKey) {
    if (this.subTimers[shipKey] > 0) {
      return;
    }
    const ship = this.team.ships[shipKey];
    const enemyMain = this.enemy.ships.main;
    if (!ship || !ship.alive || ship.isAttached()) {
      this.subTimers[shipKey] = randomInRange(4, 7);
      return;
    }

    let ok = false;
    if (ship.characterId === "future1096" && enemyMain && enemyMain.alive) {
      ok = this.team.castSubSkill(shipKey, { targetX: enemyMain.x, targetY: enemyMain.y });
    } else if (ship.characterId === "tsuruya") {
      const zone = this.team.match.zones.find((item) => zoneContains(item, enemyMain.x, enemyMain.y)) || this.team.match.zones[4];
      ok = this.team.castSubSkill(shipKey, { zoneId: zone.id });
    } else {
      ok = this.team.castSubSkill(shipKey);
    }
    this.subTimers[shipKey] = ok ? randomInRange(18, 26) : randomInRange(6, 10);
  }

  updateStuckState(dt) {
    const main = this.team.ships.main;
    if (!main.alive || !main.route) {
      this.stuckTimer = 0;
      this.lastMainPos = { x: main.x, y: main.y };
      return;
    }

    const moved = distance(main.x, main.y, this.lastMainPos.x, this.lastMainPos.y);
    const progressing = main.route.t > 0.08;
    if (moved < 2.5 && main.speed < 3.5 && progressing) {
      this.stuckTimer += dt;
    } else {
      this.stuckTimer = Math.max(0, this.stuckTimer - dt * 0.9);
    }

    this.lastMainPos = { x: main.x, y: main.y };
  }

  chooseMode(main, enemyMain) {
    if (this.modeTimer > 0) {
      return this.mode;
    }

    const hull = this.team.hullRatio();
    const energyRatio = this.team.fleetEnergyForShip("main").current / Math.max(1, this.team.fleetEnergyForShip("main").max);
    const dist = distance(main.x, main.y, enemyMain.x, enemyMain.y);

    if (hull < 0.28) {
      this.mode = "withdraw";
      this.modeTimer = randomInRange(5, 8);
      return this.mode;
    }
    if (energyRatio < 0.22) {
      this.mode = "guard";
      this.modeTimer = randomInRange(4, 7);
      return this.mode;
    }
    if (dist > this.team.match.worldSize * 0.28) {
      this.mode = "press";
      this.modeTimer = randomInRange(3.4, 5.4);
      return this.mode;
    }

    const roll = Math.random();
    if (roll < 0.27) {
      this.mode = "flank_left";
    } else if (roll < 0.54) {
      this.mode = "flank_right";
    } else if (roll < 0.74) {
      this.mode = "cutoff";
    } else {
      this.mode = "press";
    }
    this.modeTimer = randomInRange(4, 6.8);
    return this.mode;
  }

  computeMainTarget(mode, main, enemyMain, center) {
    const toEnemyX = enemyMain.x - main.x;
    const toEnemyY = enemyMain.y - main.y;
    const len = Math.max(1, Math.hypot(toEnemyX, toEnemyY));
    const toward = { x: toEnemyX / len, y: toEnemyY / len };
    const side = { x: -toward.y, y: toward.x };
    const enemyForward = { x: Math.cos(enemyMain.angle), y: Math.sin(enemyMain.angle) };

    if (mode === "withdraw") {
      return {
        x: main.x - toward.x * 280 + side.x * randomInRange(-100, 100),
        y: main.y - toward.y * 280 + side.y * randomInRange(-100, 100),
      };
    }
    if (mode === "guard") {
      return {
        x: lerp(center.x, main.x, 0.58) + randomInRange(-70, 70),
        y: lerp(center.y, main.y, 0.58) + randomInRange(-70, 70),
      };
    }
    if (mode === "flank_left") {
      return {
        x: enemyMain.x + side.x * 320 - toward.x * 100 + randomInRange(-40, 40),
        y: enemyMain.y + side.y * 320 - toward.y * 100 + randomInRange(-40, 40),
      };
    }
    if (mode === "flank_right") {
      return {
        x: enemyMain.x - side.x * 320 - toward.x * 100 + randomInRange(-40, 40),
        y: enemyMain.y - side.y * 320 - toward.y * 100 + randomInRange(-40, 40),
      };
    }
    if (mode === "cutoff") {
      return {
        x: enemyMain.x + enemyForward.x * 280 + side.x * randomInRange(-90, 90),
        y: enemyMain.y + enemyForward.y * 280 + side.y * randomInRange(-90, 90),
      };
    }
    return {
      x: lerp(center.x, enemyMain.x, 0.7) + randomInRange(-44, 44),
      y: lerp(center.y, enemyMain.y, 0.7) + randomInRange(-44, 44),
    };
  }

  issueShipRoute(ship, targetX, targetY, throttle) {
    if (!ship || !ship.alive) {
      return;
    }
    const tx = this.team.match.clampX(targetX, this.team.match.mapPadding);
    const ty = this.team.match.clampY(targetY, this.team.match.mapPadding);
    const th = clamp(throttle, 0.45, 1.2);

    if (!ship.route) {
      ship.setBezierRoute(undefined, undefined, tx, ty, th, false);
      return;
    }

    const endpointGap = distance(ship.route.p2.x, ship.route.p2.y, tx, ty);
    if (endpointGap > 90 || ship.route.t > 0.7) {
      ship.setBezierRoute(undefined, undefined, tx, ty, th, false);
    } else {
      ship.throttle = th;
      ship.setRouteEndpoint(tx, ty, false);
    }
  }

  issueMovement() {
    const centerZone = this.team.match.zones[Math.floor(Math.random() * this.team.match.zones.length)];
    const center = {
      x: centerZone.x + centerZone.width * 0.5,
      y: centerZone.y + centerZone.height * 0.5,
    };

    const main = this.team.ships.main;
    const enemyMain = this.enemy.ships.main;
    if (!main.alive || !enemyMain.alive) {
      return;
    }

    const mode = this.chooseMode(main, enemyMain);
    const mainTarget = this.computeMainTarget(mode, main, enemyMain, center);
    this.issueShipRoute(this.team.ships.main, mainTarget.x, mainTarget.y, randomInRange(0.58, 1.12));

    if (this.team.splitLevel >= 1 && this.team.ships.sub1.alive) {
      this.issueShipRoute(
        this.team.ships.sub1,
        enemyMain.x + randomInRange(-250, 250),
        enemyMain.y + randomInRange(-250, 250),
        randomInRange(0.55, 1.08),
      );
    }

    if (this.team.splitLevel >= 2 && this.team.ships.sub2.alive) {
      this.issueShipRoute(
        this.team.ships.sub2,
        enemyMain.x + Math.cos(enemyMain.angle + Math.PI * 0.5) * randomInRange(160, 300),
        enemyMain.y + Math.sin(enemyMain.angle + Math.PI * 0.5) * randomInRange(160, 300),
        randomInRange(0.5, 1.02),
      );
    }
  }
}

export class MatchSimulation {
  constructor({
    mode = "pvp",
    worldSize = DEFAULT_WORLD_SIZE,
    mapPadding = DEFAULT_MAP_PADDING,
    aiAutoBeam = false,
    teamNames = {
      A: "玩家A舰队",
      B: mode === "ai" ? "统合思念体AI舰队" : "玩家B舰队",
    },
    teamLoadouts = {
      A: DEFAULT_TEAM_LOADOUT,
      B: mode === "ai" ? DEFAULT_AI_LOADOUT : DEFAULT_TEAM_LOADOUT,
    },
  } = {}) {
    this.mode = mode;
    this.worldSize = worldSize;
    this.mapPadding = mapPadding;
    this.aiAutoBeam = Boolean(aiAutoBeam);
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
    this.bot = mode === "ai" ? new BotController(this.teamB, this.teamA) : null;
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

  applyActionForSeat(seat, action) {
    const team = this.teamBySeat(seat);
    return this.applyAction(team, action);
  }

  applyAction(team, action) {
    if (!action || typeof action !== "object") {
      return false;
    }

    const type = String(action.type || "");

    if (type === "set_route") {
      const shipKey = String(action.shipKey || "main");
      const ship = team.ships[shipKey];
      if (!ship || !ship.alive || !ship.canControl()) {
        return false;
      }
      const endX = Number(action.endX);
      const endY = Number(action.endY);
      const controlX = Number(action.controlX);
      const controlY = Number(action.controlY);
      const throttle = Number(action.throttle);
      if (!Number.isFinite(endX) || !Number.isFinite(endY)) {
        return false;
      }
      ship.setBezierRoute(
        Number.isFinite(controlX) ? controlX : undefined,
        Number.isFinite(controlY) ? controlY : undefined,
        endX,
        endY,
        Number.isFinite(throttle) ? throttle : ship.throttle,
        action.anchorToMain !== false,
      );
      return true;
    }

    if (type === "route_control") {
      const shipKey = String(action.shipKey || "main");
      const ship = team.ships[shipKey];
      if (!ship || !ship.alive || !ship.canControl() || !ship.route) {
        return false;
      }
      const controlX = Number(action.controlX);
      const controlY = Number(action.controlY);
      if (!Number.isFinite(controlX) || !Number.isFinite(controlY)) {
        return false;
      }
      ship.setRouteControl(controlX, controlY, false);
      return true;
    }

    if (type === "route_end") {
      const shipKey = String(action.shipKey || "main");
      const ship = team.ships[shipKey];
      if (!ship || !ship.alive || !ship.canControl() || !ship.route) {
        return false;
      }
      const endX = Number(action.endX);
      const endY = Number(action.endY);
      if (!Number.isFinite(endX) || !Number.isFinite(endY)) {
        return false;
      }
      ship.setRouteEndpoint(endX, endY, false);
      return true;
    }

    if (type === "set_throttle") {
      const shipKey = String(action.shipKey || "main");
      const ship = team.ships[shipKey];
      if (!ship || !ship.alive || !ship.canControl()) {
        return false;
      }
      ship.throttle = clamp(Number(action.throttle) || ship.throttle, 0.25, 1.4);
      return true;
    }

    if (type === "clear_route") {
      const shipKey = String(action.shipKey || "main");
      const ship = team.ships[shipKey];
      if (!ship || !ship.alive || !ship.canControl()) {
        return false;
      }
      ship.clearRoute();
      return true;
    }

    if (type === "split") {
      const level = Number(action.level);
      if (level === 1 || level === 2) {
        return team.split(level);
      }
      return false;
    }

    if (type === "launch_scout") {
      const zoneId = Number(action.zoneId) || 5;
      return team.launchScout(zoneId);
    }

    if (type === "cast_flagship_skill") {
      const zoneId = Number(action.zoneId) || 5;
      return team.castFlagshipSkill(zoneId);
    }

    if (type === "cast_sub_skill") {
      const shipKey = String(action.shipKey || "sub1");
      return team.castSubSkill(shipKey, {
        zoneId: Number(action.zoneId) || 5,
        targetX: Number(action.targetX),
        targetY: Number(action.targetY),
      });
    }

    return false;
  }

  resolveScoutClashes() {
    for (const scoutA of this.teamA.scouts) {
      if (!scoutA.alive) {
        continue;
      }
      for (const scoutB of this.teamB.scouts) {
        if (!scoutB.alive) {
          continue;
        }
        if (distance(scoutA.x, scoutA.y, scoutB.x, scoutB.y) <= scoutA.radius + scoutB.radius + 2) {
          scoutA.takeDamage(1, null, this);
          scoutB.takeDamage(1, null, this);
        }
      }
    }
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

  spawnFloatingText(x, y, text, color = "#ffd178") {
    this.floatingTexts.push(new FloatingText(x, y, text, color));
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

    if (this.bot) {
      this.bot.update(safeDt, this.elapsed);
    }

    this.teamA.update(safeDt);
    this.teamB.update(safeDt);

    this.resolveScoutClashes();
    this.teamA.computeVisibility(this.teamB);
    this.teamB.computeVisibility(this.teamA);
    this.teamA.resolveChargedBeams(this.teamB);
    this.teamB.resolveChargedBeams(this.teamA);

    this.teamA.stepCombat(this.teamB);
    this.teamB.stepCombat(this.teamA);
    this.updateProjectiles(safeDt);
    this.updateVisualEffects(safeDt);

    this.checkVictory();
  }

  serializeState() {
    return {
      world: {
        size: this.worldSize,
      },
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
    };
  }
}
