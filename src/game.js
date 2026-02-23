const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const ui = {
  hullValue: document.getElementById("hullValue"),
  energyValue: document.getElementById("energyValue"),
  splitValue: document.getElementById("splitValue"),
  selectedValue: document.getElementById("selectedValue"),
  splitOneBtn: document.getElementById("splitOneBtn"),
  splitTwoBtn: document.getElementById("splitTwoBtn"),
  scoutBtn: document.getElementById("scoutBtn"),
  haruhiBtn: document.getElementById("haruhiBtn"),
  mikuruBtn: document.getElementById("mikuruBtn"),
  zoneSelect: document.getElementById("zoneSelect"),
  log: document.getElementById("log"),
  overlay: document.getElementById("overlay"),
  overlayTitle: document.getElementById("overlayTitle"),
  restartBtn: document.getElementById("restartBtn"),
};

const TAU = Math.PI * 2;
const WORLD = {
  width: canvas.width,
  height: canvas.height,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function distance(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

function distanceSq(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
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

function buildZones() {
  const zones = [];
  const zoneWidth = WORLD.width / 3;
  const zoneHeight = WORLD.height / 3;
  let id = 1;
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      zones.push({
        id,
        row,
        col,
        x: col * zoneWidth,
        y: row * zoneHeight,
        width: zoneWidth,
        height: zoneHeight,
      });
      id += 1;
    }
  }
  return zones;
}

const ZONES = buildZones();

let ENTITY_ID = 1;
function nextEntityId() {
  ENTITY_ID += 1;
  return ENTITY_ID;
}

const SHIP_BASES = {
  main: {
    name: "主舰·凉宫春日",
    hp: 820,
    speed: 38,
    turnRate: 0.42,
    vision: 300,
    range: 500,
    damage: 26,
    fireRate: 0.45,
    radius: 10,
  },
  sub1: {
    name: "副舰一·长门有希",
    hp: 500,
    speed: 42,
    turnRate: 0.52,
    vision: 250,
    range: 450,
    damage: 16,
    fireRate: 0.55,
    radius: 8,
  },
  sub2: {
    name: "副舰二·朝比奈实玖瑠",
    hp: 520,
    speed: 40,
    turnRate: 0.49,
    vision: 260,
    range: 470,
    damage: 18,
    fireRate: 0.5,
    radius: 8,
  },
};

class FloatingText {
  constructor(x, y, text, color) {
    this.x = x;
    this.y = y;
    this.text = text;
    this.color = color;
    this.life = 0.8;
  }

  update(dt) {
    this.life -= dt;
    this.y -= 18 * dt;
  }

  draw() {
    if (this.life <= 0) {
      return;
    }
    ctx.save();
    ctx.globalAlpha = clamp(this.life / 0.8, 0, 1);
    ctx.fillStyle = this.color;
    ctx.font = "bold 12px 'Noto Sans SC', 'PingFang SC', sans-serif";
    ctx.fillText(this.text, this.x, this.y);
    ctx.restore();
  }
}

class Burst {
  constructor(x, y, color, radius) {
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

  draw() {
    if (this.life <= 0) {
      return;
    }
    ctx.save();
    ctx.globalAlpha = clamp(this.life / 0.35, 0, 1);
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, TAU);
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }
}

class BeamVisual {
  constructor(x1, y1, x2, y2, color) {
    this.x1 = x1;
    this.y1 = y1;
    this.x2 = x2;
    this.y2 = y2;
    this.color = color;
    this.life = 0.22;
  }

  update(dt) {
    this.life -= dt;
  }

  draw() {
    if (this.life <= 0) {
      return;
    }
    ctx.save();
    ctx.globalAlpha = clamp(this.life / 0.22, 0, 1);
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(this.x1, this.y1);
    ctx.lineTo(this.x2, this.y2);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#ffffff";
    ctx.globalAlpha *= 0.6;
    ctx.stroke();
    ctx.restore();
  }
}

class Projectile {
  constructor({
    team,
    source,
    x,
    y,
    targetX,
    targetY,
    damage,
    speed,
    hitRadius,
    color,
  }) {
    this.id = nextEntityId();
    this.team = team;
    this.source = source;
    this.x = x;
    this.y = y;
    this.targetX = targetX;
    this.targetY = targetY;
    this.damage = damage;
    this.speed = speed;
    this.hitRadius = hitRadius;
    this.color = color;
    this.alive = true;
    this.radius = 2;
  }

  update(dt, game) {
    if (!this.alive) {
      return;
    }
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const remain = Math.hypot(dx, dy);
    const step = this.speed * dt;
    if (step >= remain || remain < 1) {
      this.x = this.targetX;
      this.y = this.targetY;
      this.resolveImpact(game);
      this.alive = false;
      return;
    }
    this.x += (dx / remain) * step;
    this.y += (dy / remain) * step;
  }

  resolveImpact(game) {
    const enemyTeam = game.otherTeam(this.team);
    const candidates = game.getTeamEntities(enemyTeam);
    let target = null;
    let closest = Infinity;
    for (const entity of candidates) {
      if (!entity.alive) {
        continue;
      }
      const d = distance(this.x, this.y, entity.x, entity.y);
      if (d <= entity.radius + this.hitRadius && d < closest) {
        closest = d;
        target = entity;
      }
    }

    if (!target) {
      game.spawnFloatingText(this.x, this.y, "未命中", "#92c5ff");
      return;
    }
    target.takeDamage(this.damage, this.source, game);
    game.spawnFloatingText(target.x + 8, target.y - 8, `-${Math.round(this.damage)}`, "#ffd178");
    game.spawnBurst(target.x, target.y, "#ffdb9b", 7);
  }

  draw() {
    if (!this.alive) {
      return;
    }
    ctx.save();
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

class Unit {
  constructor(team, x, y) {
    this.id = nextEntityId();
    this.team = team;
    this.x = x;
    this.y = y;
    this.angle = 0;
    this.speed = 0;
    this.alive = true;
    this.radius = 6;
    this.maxHp = 1;
    this.hp = 1;
  }

  takeDamage(amount, _source, _game) {
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) {
      this.alive = false;
    }
  }
}

class Ship extends Unit {
  constructor(team, key, x, y) {
    super(team, x, y);
    this.kind = "ship";
    this.key = key;
    this.base = SHIP_BASES[key];
    this.name = SHIP_BASES[key].name;
    this.radius = SHIP_BASES[key].radius;
    this.maxHp = SHIP_BASES[key].hp;
    this.hp = this.maxHp;
    this.angle = key === "main" ? 0 : rand(-0.3, 0.3);
    this.command = { x, y };
    this.throttle = 1.0;
    this.cooldown = rand(0, 0.5);
    this.separated = key === "main";
    this.formationOffset = { x: 0, y: 0 };
  }

  isAttached() {
    if (this.key === "main") {
      return false;
    }
    if (this.key === "sub1") {
      return this.team.splitLevel < 1;
    }
    if (this.key === "sub2") {
      return this.team.splitLevel < 2;
    }
    return false;
  }

  canControl() {
    if (!this.alive) {
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

  effectiveSpeed() {
    return this.base.speed * this.team.attrModifier;
  }

  effectiveTurnRate() {
    return this.base.turnRate * this.team.attrModifier;
  }

  effectiveVision() {
    let value = this.base.vision * this.team.attrModifier;
    if (this.key === "sub1" && this.team.splitLevel >= 1) {
      value += 95;
    }
    return value;
  }

  effectiveRange() {
    return this.base.range * this.team.attrModifier;
  }

  effectiveDamage() {
    return this.base.damage * this.team.attrModifier;
  }

  setCommand(x, y, throttle) {
    this.command.x = clamp(x, 20, WORLD.width - 20);
    this.command.y = clamp(y, 20, WORLD.height - 20);
    this.throttle = clamp(throttle, 0.25, 1.4);
  }

  update(dt) {
    if (!this.alive) {
      return;
    }
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.isAttached()) {
      this.followLeader(dt);
      return;
    }

    const desired = Math.atan2(this.command.y - this.y, this.command.x - this.x);
    const delta = shortestAngleDelta(this.angle, desired);
    const turnRate = this.effectiveTurnRate() * (0.2 + this.throttle * 0.38);
    this.angle += clamp(delta, -turnRate * dt, turnRate * dt);

    const dist = distance(this.x, this.y, this.command.x, this.command.y);
    const throttlePenalty = this.team.energy <= 0 ? 0.15 : 1;
    const targetSpeed = dist < 10 ? 0 : this.effectiveSpeed() * this.throttle * throttlePenalty;
    this.speed = lerp(this.speed, targetSpeed, clamp(dt * 0.85, 0, 1));
    this.x += Math.cos(this.angle) * this.speed * dt;
    this.y += Math.sin(this.angle) * this.speed * dt;
    this.x = clamp(this.x, 8, WORLD.width - 8);
    this.y = clamp(this.y, 8, WORLD.height - 8);
  }

  followLeader(dt) {
    const leader = this.team.ships.main;
    const rot = rotateOffset(this.formationOffset.x, this.formationOffset.y, leader.angle);
    const tx = leader.x + rot.x;
    const ty = leader.y + rot.y;
    this.command.x = tx;
    this.command.y = ty;
    const desired = Math.atan2(ty - this.y, tx - this.x);
    const delta = shortestAngleDelta(this.angle, desired);
    const turnRate = this.effectiveTurnRate() * 0.75;
    this.angle += clamp(delta, -turnRate * dt, turnRate * dt);
    const dist = distance(this.x, this.y, tx, ty);
    const targetSpeed = leader.speed + clamp(dist * 0.45, 0, 32);
    this.speed = lerp(this.speed, targetSpeed, clamp(dt * 1.1, 0, 1));
    this.x += Math.cos(this.angle) * this.speed * dt;
    this.y += Math.sin(this.angle) * this.speed * dt;
  }

  broadsideMultiplier(target) {
    const toTarget = Math.atan2(target.y - this.y, target.x - this.x);
    const relative = Math.abs(shortestAngleDelta(this.angle, toTarget));
    const broadsideFactor = Math.sin(relative);
    return 0.72 + broadsideFactor * 0.65;
  }

  tryAttack(game) {
    if (!this.alive || this.cooldown > 0) {
      return;
    }
    const target = game.pickTargetFor(this);
    if (!target) {
      return;
    }

    const targetDistance = distance(this.x, this.y, target.x, target.y);
    const predictedX = target.x + (target.speed || 0) * Math.cos(target.angle || 0) * (targetDistance / 300);
    const predictedY = target.y + (target.speed || 0) * Math.sin(target.angle || 0) * (targetDistance / 300);
    const spread = clamp(targetDistance / 18, 4, 26);
    const aimX = predictedX + rand(-spread, spread);
    const aimY = predictedY + rand(-spread, spread);
    const damage = this.effectiveDamage() * this.broadsideMultiplier(target);

    game.projectiles.push(
      new Projectile({
        team: this.team,
        source: this,
        x: this.x,
        y: this.y,
        targetX: clamp(aimX, 0, WORLD.width),
        targetY: clamp(aimY, 0, WORLD.height),
        damage,
        speed: 240,
        hitRadius: 8,
        color: this.team.projectileColor,
      }),
    );
    this.cooldown = 1 / this.base.fireRate;
  }

  takeDamage(amount, source, game) {
    if (!this.alive) {
      return;
    }
    if (this.team.splitLevel === 0) {
      this.team.applyCombinedDamage(amount, source, game);
      return;
    }
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) {
      this.alive = false;
      game.spawnBurst(this.x, this.y, "#ff9d7d", 10);
      game.log(`${this.team.name}损失了${this.name}`);
    }
  }
}

class Scout extends Unit {
  constructor(team, x, y, zone) {
    super(team, x, y);
    this.kind = "scout";
    this.zone = zone;
    this.mode = "transit";
    this.speed = 62;
    this.radius = 3.8;
    this.hp = 1;
    this.maxHp = 1;
    this.vision = 145;
    this.command = {
      x: zone.x + zone.width / 2,
      y: zone.y + zone.height / 2,
    };
    this.patrolTimer = rand(1.2, 2.4);
    this.angle = rand(0, TAU);
  }

  randomPatrolPoint() {
    const margin = 18;
    this.command = {
      x: rand(this.zone.x + margin, this.zone.x + this.zone.width - margin),
      y: rand(this.zone.y + margin, this.zone.y + this.zone.height - margin),
    };
  }

  update(dt) {
    if (!this.alive) {
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
        this.patrolTimer = rand(1.0, 2.6);
        this.randomPatrolPoint();
      }
    }
  }

  takeDamage(_amount, _source, game) {
    if (!this.alive) {
      return;
    }
    this.alive = false;
    game.spawnBurst(this.x, this.y, "#d5efff", 6);
  }
}

class Wingman extends Unit {
  constructor(team, x, y, zone) {
    super(team, x, y);
    this.kind = "wingman";
    this.zone = zone;
    this.mode = "transit";
    this.command = {
      x: zone.x + zone.width / 2,
      y: zone.y + zone.height / 2,
    };
    this.radius = 5.2;
    this.maxHp = 130 * team.attrModifier;
    this.hp = this.maxHp;
    this.vision = 145;
    this.speed = 72;
    this.attackRange = 280;
    this.damage = 11 * team.attrModifier;
    this.cooldown = rand(0.8, 1.4);
    this.life = 48;
    this.patrolTimer = rand(1.0, 2.5);
    this.angle = 0;
  }

  randomPatrolPoint() {
    const margin = 26;
    this.command = {
      x: rand(this.zone.x + margin, this.zone.x + this.zone.width - margin),
      y: rand(this.zone.y + margin, this.zone.y + this.zone.height - margin),
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
        this.patrolTimer = rand(1.0, 2.8);
        this.randomPatrolPoint();
      }
    }
  }

  tryAttack(game) {
    if (!this.alive || this.cooldown > 0) {
      return;
    }
    const target = game.pickTargetFor(this);
    if (!target) {
      return;
    }
    const spread = rand(-7, 7);
    const angle = Math.atan2(target.y - this.y, target.x - this.x);
    const targetX = target.x + Math.cos(angle + Math.PI / 2) * spread;
    const targetY = target.y + Math.sin(angle + Math.PI / 2) * spread;

    game.projectiles.push(
      new Projectile({
        team: this.team,
        source: this,
        x: this.x,
        y: this.y,
        targetX: clamp(targetX, 0, WORLD.width),
        targetY: clamp(targetY, 0, WORLD.height),
        damage: this.damage,
        speed: 260,
        hitRadius: 7,
        color: this.team.projectileColor,
      }),
    );
    this.cooldown = 1.4;
  }

  takeDamage(amount, _source, game) {
    if (!this.alive) {
      return;
    }
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) {
      this.alive = false;
      game.spawnBurst(this.x, this.y, "#ffd18a", 7);
    }
  }
}

class Team {
  constructor({ name, color, projectileColor, isPlayer, spawnX, spawnY, facing }) {
    this.name = name;
    this.color = color;
    this.projectileColor = projectileColor;
    this.isPlayer = isPlayer;
    this.attrModifier = 1;
    this.splitLevel = 0;
    this.maxEnergy = 360;
    this.energy = 300;
    this.visibleEnemyIds = new Set();
    this.cooldowns = {
      scout: 0,
      haruhi: 0,
      beam: 0,
    };
    this.ships = {
      main: new Ship(this, "main", spawnX, spawnY),
      sub1: new Ship(this, "sub1", spawnX - 26, spawnY + 20),
      sub2: new Ship(this, "sub2", spawnX - 26, spawnY - 20),
    };
    this.ships.main.angle = facing;
    this.ships.sub1.angle = facing;
    this.ships.sub2.angle = facing;
    this.ships.sub1.formationOffset = { x: -30, y: 24 };
    this.ships.sub2.formationOffset = { x: -30, y: -24 };

    this.combinedHullMax = this.totalShipMaxHull();
    this.combinedHull = this.combinedHullMax;
    this.scouts = [];
    this.wingmen = [];
  }

  totalShipMaxHull() {
    return this.ships.main.maxHp + this.ships.sub1.maxHp + this.ships.sub2.maxHp;
  }

  getShips() {
    return [this.ships.main, this.ships.sub1, this.ships.sub2];
  }

  getControllableShips() {
    return this.getShips().filter((ship) => ship.canControl());
  }

  getVisionSources() {
    const sources = [];
    for (const ship of this.getShips()) {
      if (ship.alive) {
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

  spendEnergy(cost) {
    if (this.energy < cost) {
      return false;
    }
    this.energy -= cost;
    return true;
  }

  hasLivingShips() {
    return this.getShips().some((ship) => ship.alive);
  }

  hullRatio() {
    if (this.splitLevel === 0) {
      return this.combinedHullMax <= 0 ? 0 : this.combinedHull / this.combinedHullMax;
    }
    const ships = this.getShips();
    const hp = ships.reduce((sum, ship) => sum + Math.max(0, ship.hp), 0);
    const max = ships.reduce((sum, ship) => sum + ship.maxHp, 0);
    return max <= 0 ? 0 : hp / max;
  }

  refreshStatsPreserveRatio() {
    for (const ship of this.getShips()) {
      const oldMax = ship.maxHp || 1;
      const oldRatio = clamp(ship.hp / oldMax, 0, 1);
      ship.maxHp = ship.base.hp * this.attrModifier;
      ship.hp = ship.alive ? ship.maxHp * oldRatio : 0;
    }
    if (this.splitLevel === 0) {
      const ratio = this.combinedHullMax <= 0 ? 1 : this.combinedHull / this.combinedHullMax;
      this.combinedHullMax = this.totalShipMaxHull();
      this.combinedHull = this.combinedHullMax * ratio;
      for (const ship of this.getShips()) {
        ship.hp = ship.maxHp * ratio;
      }
    }
  }

  applyCombinedDamage(amount, _source, game) {
    this.combinedHull = Math.max(0, this.combinedHull - amount);
    const ratio = this.combinedHullMax <= 0 ? 0 : this.combinedHull / this.combinedHullMax;
    for (const ship of this.getShips()) {
      if (!ship.alive) {
        continue;
      }
      ship.hp = ship.maxHp * ratio;
    }
    if (this.combinedHull <= 0) {
      for (const ship of this.getShips()) {
        if (ship.alive) {
          ship.alive = false;
          game.spawnBurst(ship.x, ship.y, "#ff9d7d", 10);
        }
      }
      game.log(`${this.name}编队崩溃`);
    }
  }

  split(level, game) {
    if (level === 1 && this.splitLevel === 0) {
      this.splitLevel = 1;
      this.attrModifier *= 0.8;
      const hullRatio = this.combinedHullMax <= 0 ? 1 : this.combinedHull / this.combinedHullMax;
      for (const ship of this.getShips()) {
        ship.maxHp = ship.base.hp * this.attrModifier;
        ship.hp = ship.maxHp * hullRatio;
      }
      this.ships.sub1.separated = true;
      this.ships.sub1.setCommand(this.ships.main.x - 50, this.ships.main.y + 80, 1);
      game.spawnFloatingText(this.ships.main.x + 8, this.ships.main.y - 20, "一级分离", "#9ff2ff");
      game.log(`${this.name}执行一级分离（总属性约80%）`);
      return true;
    }
    if (level === 2 && this.splitLevel === 1) {
      this.splitLevel = 2;
      this.attrModifier *= 0.8;
      this.refreshStatsPreserveRatio();
      this.ships.sub2.separated = true;
      this.ships.sub2.setCommand(this.ships.main.x - 40, this.ships.main.y - 86, 1);
      game.spawnFloatingText(this.ships.main.x + 8, this.ships.main.y - 20, "二级分离", "#9ff2ff");
      game.log(`${this.name}执行二级分离（总属性约64%）`);
      return true;
    }
    return false;
  }

  updateEnergy(dt) {
    const controllable = this.getControllableShips().filter((ship) => ship.alive);
    if (controllable.length === 0) {
      return;
    }
    const throttleTotal = controllable.reduce((sum, ship) => sum + ship.throttle, 0);
    const throttleAvg = throttleTotal / controllable.length;
    const regenBase = 14;
    const regenMultiplier =
      throttleAvg <= 1 ? 1 + (1 - throttleAvg) * 0.88 : 1 - (throttleAvg - 1) * 0.86;
    const regen = Math.max(1.5, regenBase * regenMultiplier);
    const moveCost = 8 * throttleTotal;
    this.energy = clamp(this.energy + (regen - moveCost) * dt, 0, this.maxEnergy);
  }

  update(dt) {
    this.cooldowns.scout = Math.max(0, this.cooldowns.scout - dt);
    this.cooldowns.haruhi = Math.max(0, this.cooldowns.haruhi - dt);
    this.cooldowns.beam = Math.max(0, this.cooldowns.beam - dt);

    this.updateEnergy(dt);
    for (const ship of this.getShips()) {
      ship.update(dt);
    }
    for (const scout of this.scouts) {
      scout.update(dt);
    }
    for (const wingman of this.wingmen) {
      wingman.update(dt);
    }

    this.scouts = this.scouts.filter((scout) => scout.alive);
    this.wingmen = this.wingmen.filter((wingman) => wingman.alive);
  }

  launchScout(zone, game) {
    const cost = 30;
    if (this.cooldowns.scout > 0) {
      return false;
    }
    if (!this.spendEnergy(cost)) {
      if (this.isPlayer) {
        game.log("能量不足，无法派出侦查机");
      }
      return false;
    }
    const source = this.ships.main.alive ? this.ships.main : this.getShips().find((ship) => ship.alive);
    if (!source) {
      return false;
    }
    this.scouts.push(new Scout(this, source.x, source.y, zone));
    this.cooldowns.scout = 2.5;
    if (this.isPlayer) {
      game.log(`侦查机已派往战区${zone.id}`);
    }
    return true;
  }

  launchWingman(zone, game) {
    const cost = 55;
    if (this.cooldowns.haruhi > 0) {
      return false;
    }
    if (!this.spendEnergy(cost)) {
      if (this.isPlayer) {
        game.log("能量不足，无法使用春日技能");
      }
      return false;
    }
    const main = this.ships.main;
    if (!main.alive) {
      return false;
    }
    this.wingmen.push(new Wingman(this, main.x, main.y, zone));
    this.cooldowns.haruhi = 9;
    if (this.isPlayer) {
      game.log(`战斗僚机已部署到战区${zone.id}`);
    }
    return true;
  }

  castBeam(directionX, directionY, game) {
    const ship = this.ships.sub2;
    const cost = 78;
    if (this.splitLevel < 2 || !ship.alive) {
      if (this.isPlayer) {
        game.log("需要二级分离后才能使用实玖瑠光束");
      }
      return false;
    }
    if (this.cooldowns.beam > 0) {
      return false;
    }
    if (!this.spendEnergy(cost)) {
      if (this.isPlayer) {
        game.log("能量不足，无法使用实玖瑠光束");
      }
      return false;
    }

    const angle = Math.atan2(directionY - ship.y, directionX - ship.x);
    const range = 720 * this.attrModifier;
    const x2 = clamp(ship.x + Math.cos(angle) * range, 0, WORLD.width);
    const y2 = clamp(ship.y + Math.sin(angle) * range, 0, WORLD.height);
    game.beams.push(new BeamVisual(ship.x, ship.y, x2, y2, "#8ef8ff"));
    const enemyTeam = game.otherTeam(this);
    const targets = game.getTeamEntities(enemyTeam);
    let hits = 0;
    for (const target of targets) {
      if (!target.alive) {
        continue;
      }
      const probe = linePointDistance(ship.x, ship.y, x2, y2, target.x, target.y);
      if (probe.dist <= target.radius + 8 && probe.t >= 0 && probe.t <= 1) {
        const falloff = 1 - probe.t * 0.38;
        const damage = 112 * this.attrModifier * falloff;
        target.takeDamage(damage, ship, game);
        hits += 1;
      }
    }
    this.cooldowns.beam = 12;
    if (this.isPlayer) {
      if (hits > 0) {
        game.log(`实玖瑠光束命中${hits}个目标`);
      } else {
        game.log("实玖瑠光束未命中");
      }
    }
    return true;
  }
}

class EnemyAI {
  constructor(team, enemy, game) {
    this.team = team;
    this.enemy = enemy;
    this.game = game;
    this.moveTimer = 0;
    this.scoutTimer = 4;
    this.wingmanTimer = 10;
    this.beamTimer = 13;
  }

  update(dt) {
    if (this.game.gameOver) {
      return;
    }
    this.moveTimer -= dt;
    this.scoutTimer -= dt;
    this.wingmanTimer -= dt;
    this.beamTimer -= dt;

    if (this.game.elapsed > 24 && this.team.splitLevel < 1) {
      this.team.split(1, this.game);
    }
    if (this.game.elapsed > 56 && this.team.splitLevel < 2) {
      this.team.split(2, this.game);
    }

    if (this.moveTimer <= 0) {
      this.issueMovement();
      this.moveTimer = rand(9, 13);
    }

    if (this.scoutTimer <= 0) {
      this.team.launchScout(this.game.randomZone(), this.game);
      this.scoutTimer = rand(8, 12);
    }

    if (this.wingmanTimer <= 0) {
      this.team.launchWingman(this.game.randomZone(), this.game);
      this.wingmanTimer = rand(18, 24);
    }

    if (this.beamTimer <= 0 && this.team.splitLevel >= 2) {
      const sub2 = this.team.ships.sub2;
      const enemyMain = this.enemy.ships.main;
      if (sub2.alive && enemyMain.alive) {
        this.team.castBeam(enemyMain.x, enemyMain.y, this.game);
      }
      this.beamTimer = rand(14, 18);
    }
  }

  issueMovement() {
    const targetZone = this.game.randomZone();
    const zoneCenter = {
      x: targetZone.x + targetZone.width * 0.5,
      y: targetZone.y + targetZone.height * 0.5,
    };
    const enemyMain = this.enemy.ships.main;
    const primaryX = lerp(zoneCenter.x, enemyMain.x, 0.45) + rand(-35, 35);
    const primaryY = lerp(zoneCenter.y, enemyMain.y, 0.45) + rand(-35, 35);

    this.team.ships.main.setCommand(primaryX, primaryY, rand(0.55, 1.1));

    if (this.team.splitLevel >= 1 && this.team.ships.sub1.alive) {
      this.team.ships.sub1.setCommand(enemyMain.x + rand(-220, 220), enemyMain.y + rand(-220, 220), rand(0.5, 1.05));
    }
    if (this.team.splitLevel >= 2 && this.team.ships.sub2.alive) {
      this.team.ships.sub2.setCommand(enemyMain.x + rand(-260, 260), enemyMain.y + rand(-260, 260), rand(0.5, 1.08));
    }
  }
}

class Game {
  constructor() {
    this.zones = ZONES;
    this.stars = Array.from({ length: 220 }, () => ({
      x: rand(0, WORLD.width),
      y: rand(0, WORLD.height),
      r: rand(0.4, 1.7),
      p: rand(0, TAU),
    }));

    this.player = new Team({
      name: "团长舰队",
      color: "#65d9ff",
      projectileColor: "#9be8ff",
      isPlayer: true,
      spawnX: 320,
      spawnY: 540,
      facing: 0,
    });
    this.enemy = new Team({
      name: "统合思念体舰队",
      color: "#ff8692",
      projectileColor: "#ffc0bd",
      isPlayer: false,
      spawnX: 1480,
      spawnY: 540,
      facing: Math.PI,
    });

    this.projectiles = [];
    this.floatingTexts = [];
    this.bursts = [];
    this.beams = [];
    this.elapsed = 0;
    this.gameOver = false;
    this.selectedShip = this.player.ships.main;
    this.dragging = null;
    this.pendingBeamAim = false;
    this.pointer = { x: 0, y: 0 };

    this.ai = new EnemyAI(this.enemy, this.player, this);
    this.lastTime = performance.now();

    this.populateZones();
    this.bindEvents();
    this.log("战斗开始。拖拽舰船设置航向与推进。");
    this.updateUi();
  }

  populateZones() {
    for (const zone of this.zones) {
      const option = document.createElement("option");
      option.value = String(zone.id);
      option.textContent = `战区 ${zone.id}`;
      ui.zoneSelect.append(option);
    }
    ui.zoneSelect.value = "5";
  }

  bindEvents() {
    const pointerFromEvent = (event) => {
      const rect = canvas.getBoundingClientRect();
      const x = (event.clientX - rect.left) * (canvas.width / rect.width);
      const y = (event.clientY - rect.top) * (canvas.height / rect.height);
      return {
        x: clamp(x, 0, WORLD.width),
        y: clamp(y, 0, WORLD.height),
      };
    };

    canvas.addEventListener("mousemove", (event) => {
      this.pointer = pointerFromEvent(event);
      if (this.dragging) {
        this.dragging.current = { ...this.pointer };
      }
    });

    canvas.addEventListener("mousedown", (event) => {
      if (this.gameOver) {
        return;
      }
      const pos = pointerFromEvent(event);
      this.pointer = pos;
      if (this.pendingBeamAim) {
        if (this.player.castBeam(pos.x, pos.y, this)) {
          this.pendingBeamAim = false;
        }
        return;
      }

      const clicked = this.findPlayerControllableShip(pos.x, pos.y);
      if (clicked) {
        this.selectedShip = clicked;
        this.dragging = {
          ship: clicked,
          start: pos,
          current: pos,
        };
        this.updateUi();
        return;
      }

      const zone = this.zoneFromPoint(pos.x, pos.y);
      if (zone) {
        ui.zoneSelect.value = String(zone.id);
      }
    });

    window.addEventListener("mouseup", () => {
      if (!this.dragging) {
        return;
      }
      const drag = this.dragging;
      const dy = drag.start.y - drag.current.y;
      const throttle = clamp(1 + dy / 220, 0.25, 1.4);
      drag.ship.setCommand(drag.current.x, drag.current.y, throttle);
      if (this.player.energy <= 0) {
        this.log("能量耗尽，舰队机动能力严重下降");
      }
      this.dragging = null;
    });

    ui.splitOneBtn.addEventListener("click", () => {
      if (this.gameOver) {
        return;
      }
      this.player.split(1, this);
      this.updateUi();
    });

    ui.splitTwoBtn.addEventListener("click", () => {
      if (this.gameOver) {
        return;
      }
      this.player.split(2, this);
      this.updateUi();
    });

    ui.scoutBtn.addEventListener("click", () => {
      if (this.gameOver) {
        return;
      }
      const zone = this.getSelectedZone();
      this.player.launchScout(zone, this);
      this.updateUi();
    });

    ui.haruhiBtn.addEventListener("click", () => {
      if (this.gameOver) {
        return;
      }
      const zone = this.getSelectedZone();
      this.player.launchWingman(zone, this);
      this.updateUi();
    });

    ui.mikuruBtn.addEventListener("click", () => {
      if (this.gameOver) {
        return;
      }
      if (this.player.splitLevel < 2 || !this.player.ships.sub2.alive) {
        this.log("二级分离后才可使用实玖瑠光束");
        return;
      }
      if (this.player.cooldowns.beam > 0) {
        this.log(`光束冷却中：${this.player.cooldowns.beam.toFixed(1)}秒`);
        return;
      }
      this.pendingBeamAim = true;
      this.log("光束瞄准模式：在地图上点击开火方向");
    });

    ui.restartBtn.addEventListener("click", () => {
      window.location.reload();
    });
  }

  getSelectedZone() {
    const id = Number(ui.zoneSelect.value) || 5;
    return this.zones.find((zone) => zone.id === id) || this.zones[4];
  }

  zoneFromPoint(x, y) {
    return this.zones.find((zone) => x >= zone.x && x < zone.x + zone.width && y >= zone.y && y < zone.y + zone.height);
  }

  randomZone() {
    return this.zones[Math.floor(rand(0, this.zones.length))];
  }

  log(message) {
    const row = document.createElement("div");
    row.textContent = `[${Math.floor(this.elapsed).toString().padStart(3, "0")}秒] ${message}`;
    ui.log.prepend(row);
    while (ui.log.children.length > 18) {
      ui.log.removeChild(ui.log.lastChild);
    }
  }

  spawnFloatingText(x, y, text, color) {
    this.floatingTexts.push(new FloatingText(x, y, text, color));
  }

  spawnBurst(x, y, color, radius) {
    this.bursts.push(new Burst(x, y, color, radius));
  }

  getTeamEntities(team) {
    const entities = [];
    for (const ship of team.getShips()) {
      if (ship.alive) {
        entities.push(ship);
      }
    }
    for (const scout of team.scouts) {
      if (scout.alive) {
        entities.push(scout);
      }
    }
    for (const wingman of team.wingmen) {
      if (wingman.alive) {
        entities.push(wingman);
      }
    }
    return entities;
  }

  otherTeam(team) {
    return team === this.player ? this.enemy : this.player;
  }

  findPlayerControllableShip(x, y) {
    const candidates = this.player.getControllableShips();
    for (let i = candidates.length - 1; i >= 0; i -= 1) {
      const ship = candidates[i];
      if (!ship.alive) {
        continue;
      }
      if (distance(x, y, ship.x, ship.y) <= ship.radius + 9) {
        return ship;
      }
    }
    return null;
  }

  computeVisibility(observer, target) {
    observer.visibleEnemyIds.clear();
    const sensors = observer.getVisionSources();
    if (sensors.length === 0) {
      return;
    }
    const enemies = this.getTeamEntities(target);
    for (const enemy of enemies) {
      for (const sensor of sensors) {
        if (distanceSq(enemy.x, enemy.y, sensor.x, sensor.y) <= sensor.range * sensor.range) {
          observer.visibleEnemyIds.add(enemy.id);
          break;
        }
      }
    }
  }

  pickTargetFor(attacker) {
    const enemyTeam = this.otherTeam(attacker.team);
    const visible = attacker.team.visibleEnemyIds;
    const candidates = this.getTeamEntities(enemyTeam);
    const range = attacker.kind === "wingman" ? attacker.attackRange : attacker.effectiveRange();
    let nearest = null;
    let nearestDist = Infinity;
    for (const target of candidates) {
      if (!target.alive || !visible.has(target.id)) {
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

  resolveScoutClashes() {
    for (const scoutA of this.player.scouts) {
      if (!scoutA.alive) {
        continue;
      }
      for (const scoutB of this.enemy.scouts) {
        if (!scoutB.alive) {
          continue;
        }
        if (distance(scoutA.x, scoutA.y, scoutB.x, scoutB.y) <= scoutA.radius + scoutB.radius + 2) {
          scoutA.alive = false;
          scoutB.alive = false;
          this.spawnBurst((scoutA.x + scoutB.x) * 0.5, (scoutA.y + scoutB.y) * 0.5, "#c6ecff", 6);
        }
      }
    }
  }

  checkVictory() {
    if (this.gameOver) {
      return;
    }
    const playerAlive = this.player.hasLivingShips();
    const enemyAlive = this.enemy.hasLivingShips();
    if (playerAlive && enemyAlive) {
      return;
    }
    this.gameOver = true;
    ui.overlay.classList.remove("hidden");
    if (playerAlive) {
      ui.overlayTitle.textContent = "胜利：敌方舰队已被击溃";
      this.log("战斗结束：团长舰队获胜");
    } else {
      ui.overlayTitle.textContent = "失败：团长舰队被歼灭";
      this.log("战斗结束：团长舰队战败");
    }
  }

  updateUi() {
    ui.hullValue.textContent = `${Math.round(this.player.hullRatio() * 100)}%`;
    ui.energyValue.textContent = `${Math.round((this.player.energy / this.player.maxEnergy) * 100)}%`;
    ui.splitValue.textContent =
      this.player.splitLevel === 0 ? "编队" : this.player.splitLevel === 1 ? "一级分离" : "二级分离";
    ui.selectedValue.textContent = this.selectedShip
      ? `${this.selectedShip.name} | 推进 ${this.selectedShip.throttle.toFixed(2)}`
      : "无";

    ui.splitOneBtn.disabled = this.player.splitLevel >= 1;
    ui.splitTwoBtn.disabled = this.player.splitLevel < 1 || this.player.splitLevel >= 2;

    ui.scoutBtn.disabled = this.player.cooldowns.scout > 0 || this.player.energy < 30;
    ui.scoutBtn.textContent =
      this.player.cooldowns.scout > 0 ? `派出侦查机（冷却${this.player.cooldowns.scout.toFixed(1)}秒）` : "派出侦查机";

    ui.haruhiBtn.disabled = this.player.cooldowns.haruhi > 0 || this.player.energy < 55 || !this.player.ships.main.alive;
    ui.haruhiBtn.textContent =
      this.player.cooldowns.haruhi > 0
        ? `春日技能：战斗僚机（冷却${this.player.cooldowns.haruhi.toFixed(1)}秒）`
        : "春日技能：战斗僚机";

    const beamLocked = this.player.splitLevel < 2 || !this.player.ships.sub2.alive;
    ui.mikuruBtn.disabled = beamLocked || this.player.cooldowns.beam > 0 || this.player.energy < 78;
    ui.mikuruBtn.textContent =
      beamLocked || this.player.cooldowns.beam <= 0
        ? "实玖瑠技能：光束（地图瞄准）"
        : `实玖瑠技能：光束（冷却${this.player.cooldowns.beam.toFixed(1)}秒）`;
  }

  update(dt) {
    if (this.gameOver) {
      return;
    }
    this.elapsed += dt;
    this.player.update(dt);
    this.enemy.update(dt);
    this.ai.update(dt);

    this.resolveScoutClashes();
    this.computeVisibility(this.player, this.enemy);
    this.computeVisibility(this.enemy, this.player);

    for (const ship of this.player.getShips()) {
      ship.tryAttack(this);
    }
    for (const ship of this.enemy.getShips()) {
      ship.tryAttack(this);
    }
    for (const wingman of this.player.wingmen) {
      wingman.tryAttack(this);
    }
    for (const wingman of this.enemy.wingmen) {
      wingman.tryAttack(this);
    }

    for (const projectile of this.projectiles) {
      projectile.update(dt, this);
    }
    this.projectiles = this.projectiles.filter((projectile) => projectile.alive);

    for (const beam of this.beams) {
      beam.update(dt);
    }
    this.beams = this.beams.filter((beam) => beam.life > 0);

    for (const burst of this.bursts) {
      burst.update(dt);
    }
    this.bursts = this.bursts.filter((burst) => burst.life > 0);

    for (const label of this.floatingTexts) {
      label.update(dt);
    }
    this.floatingTexts = this.floatingTexts.filter((label) => label.life > 0);

    if (this.selectedShip && !this.selectedShip.alive) {
      this.selectedShip = this.player.getControllableShips()[0] || null;
    }

    this.checkVictory();
    this.updateUi();
  }

  drawBackground() {
    const gradient = ctx.createLinearGradient(0, 0, WORLD.width, WORLD.height);
    gradient.addColorStop(0, "#040d18");
    gradient.addColorStop(0.5, "#071423");
    gradient.addColorStop(1, "#050b14");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);

    for (const star of this.stars) {
      const alpha = 0.25 + Math.sin(this.elapsed * 1.4 + star.p) * 0.25 + 0.35;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#b7dbff";
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawZones() {
    for (const zone of this.zones) {
      const selected = zone.id === Number(ui.zoneSelect.value);
      ctx.strokeStyle = selected ? "#4ec9ff88" : "#2d5d884f";
      ctx.lineWidth = selected ? 2 : 1;
      ctx.strokeRect(zone.x, zone.y, zone.width, zone.height);
      ctx.fillStyle = selected ? "#76d6ff" : "#5f8ab8";
      ctx.font = "bold 14px 'Noto Sans SC', 'PingFang SC', sans-serif";
      ctx.fillText(`战区 ${zone.id}`, zone.x + 10, zone.y + 20);
    }
  }

  drawShip(ship, visibleToPlayer) {
    if (!ship.alive) {
      return;
    }
    if (ship.team === this.enemy && !visibleToPlayer && !this.gameOver) {
      return;
    }

    const selected = ship === this.selectedShip;
    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.angle);

    const color = ship.team.color;
    const hullSize = ship.key === "main" ? 0.72 : 0.62;
    const alpha = ship.isAttached() ? 0.84 : 1;
    ctx.globalAlpha = alpha;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(16 * hullSize, 0);
    ctx.lineTo(-13 * hullSize, -10 * hullSize);
    ctx.lineTo(-6 * hullSize, 0);
    ctx.lineTo(-13 * hullSize, 10 * hullSize);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "#ffffffaa";
    ctx.lineWidth = 1;
    ctx.stroke();

    if (selected) {
      ctx.strokeStyle = "#ffe084";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(0, 0, ship.radius + 4, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();

    const hpRatio = clamp(ship.hp / ship.maxHp, 0, 1);
    ctx.fillStyle = "#0f1f31";
    ctx.fillRect(ship.x - 13, ship.y - ship.radius - 9, 26, 4);
    ctx.fillStyle = hpRatio > 0.35 ? "#72f5a8" : "#ff8a8a";
    ctx.fillRect(ship.x - 13, ship.y - ship.radius - 9, 26 * hpRatio, 4);
  }

  drawScout(scout, visibleToPlayer) {
    if (!scout.alive) {
      return;
    }
    if (scout.team === this.enemy && !visibleToPlayer && !this.gameOver) {
      return;
    }
    ctx.save();
    ctx.translate(scout.x, scout.y);
    ctx.rotate(scout.angle);
    ctx.fillStyle = scout.team === this.player ? "#9de8ff" : "#ffb7c0";
    ctx.beginPath();
    ctx.moveTo(5, 0);
    ctx.lineTo(0, -3);
    ctx.lineTo(-5, 0);
    ctx.lineTo(0, 3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawWingman(wingman, visibleToPlayer) {
    if (!wingman.alive) {
      return;
    }
    if (wingman.team === this.enemy && !visibleToPlayer && !this.gameOver) {
      return;
    }
    ctx.save();
    ctx.translate(wingman.x, wingman.y);
    ctx.rotate(wingman.angle);
    ctx.fillStyle = wingman.team === this.player ? "#ffe7aa" : "#ffc6b3";
    ctx.beginPath();
    ctx.moveTo(6, 0);
    ctx.lineTo(-4, -3);
    ctx.lineTo(-2, 0);
    ctx.lineTo(-4, 3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawCommands() {
    if (!this.dragging) {
      return;
    }
    const { ship, current, start } = this.dragging;
    const dy = start.y - current.y;
    const throttle = clamp(1 + dy / 220, 0.25, 1.4);
    ctx.save();
    ctx.strokeStyle = "#8ee8ff";
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.moveTo(ship.x, ship.y);
    ctx.lineTo(current.x, current.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#e5f6ff";
    ctx.font = "12px 'Noto Sans SC', 'PingFang SC', sans-serif";
    ctx.fillText(`推进 ${throttle.toFixed(2)}`, current.x + 8, current.y - 6);
    ctx.restore();
  }

  drawAimHint() {
    if (!this.pendingBeamAim || !this.player.ships.sub2.alive) {
      return;
    }
    const s = this.player.ships.sub2;
    ctx.save();
    ctx.strokeStyle = "#7ff4ff";
    ctx.lineWidth = 1.6;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(this.pointer.x, this.pointer.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#c7f5ff";
    ctx.font = "12px 'Noto Sans SC', 'PingFang SC', sans-serif";
    ctx.fillText("光束瞄准", this.pointer.x + 8, this.pointer.y - 6);
    ctx.restore();
  }

  drawVision() {
    if (!this.selectedShip || !this.selectedShip.alive) {
      return;
    }
    ctx.save();
    ctx.strokeStyle = "#8adfff3a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(this.selectedShip.x, this.selectedShip.y, this.selectedShip.effectiveVision(), 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  render() {
    this.drawBackground();
    this.drawZones();
    this.drawVision();

    for (const beam of this.beams) {
      beam.draw();
    }
    for (const projectile of this.projectiles) {
      projectile.draw();
    }

    const enemyVisible = this.player.visibleEnemyIds;
    for (const ship of this.player.getShips()) {
      this.drawShip(ship, true);
    }
    for (const ship of this.enemy.getShips()) {
      this.drawShip(ship, enemyVisible.has(ship.id));
    }

    for (const scout of this.player.scouts) {
      this.drawScout(scout, true);
    }
    for (const scout of this.enemy.scouts) {
      this.drawScout(scout, enemyVisible.has(scout.id));
    }

    for (const wingman of this.player.wingmen) {
      this.drawWingman(wingman, true);
    }
    for (const wingman of this.enemy.wingmen) {
      this.drawWingman(wingman, enemyVisible.has(wingman.id));
    }

    for (const burst of this.bursts) {
      burst.draw();
    }
    for (const label of this.floatingTexts) {
      label.draw();
    }

    this.drawCommands();
    this.drawAimHint();
  }

  tick = (timestamp) => {
    const dt = clamp((timestamp - this.lastTime) / 1000, 0, 0.05);
    this.lastTime = timestamp;
    this.update(dt);
    this.render();
    requestAnimationFrame(this.tick);
  };

  start() {
    requestAnimationFrame(this.tick);
  }
}

const game = new Game();
game.start();
