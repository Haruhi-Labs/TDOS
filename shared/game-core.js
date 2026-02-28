export const DEFAULT_WORLD_SIZE = 1800;
export const DEFAULT_MAP_PADDING = 20;
export const TICK_RATE = 30;
export const SNAPSHOT_RATE = 20;
export const TICK_DT = 1 / TICK_RATE;

const TAU = Math.PI * 2;

const SHIP_BASES = {
  main: {
    name: "主舰·凉宫春日",
    hp: 820,
    speed: 32,
    turnRate: 0.39,
    vision: 300,
    range: 500,
    damage: 26,
    fireRate: 0.45,
    radius: 10,
  },
  sub1: {
    name: "副舰一·长门有希",
    hp: 500,
    speed: 34,
    turnRate: 0.46,
    vision: 250,
    range: 450,
    damage: 16,
    fireRate: 0.55,
    radius: 8,
  },
  sub2: {
    name: "副舰二·朝比奈实玖瑠",
    hp: 520,
    speed: 33,
    turnRate: 0.44,
    vision: 260,
    range: 470,
    damage: 18,
    fireRate: 0.5,
    radius: 8,
  },
};

const TEAM_COLORS = {
  A: "#65d9ff",
  B: "#ff8692",
};

const TEAM_PROJECTILE_COLORS = {
  A: "#9be8ff",
  B: "#ffc0bd",
};

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
  constructor(team, key, x, y, facing) {
    this.id = nextEntityId();
    this.team = team;
    this.key = key;
    this.base = SHIP_BASES[key];
    this.name = this.base.name;

    this.x = x;
    this.y = y;
    this.angle = facing;
    this.speed = 0;
    this.throttle = 1;
    this.command = { x, y };
    this.route = null;

    this.maxHp = this.base.hp;
    this.hp = this.maxHp;
    this.radius = this.base.radius;
    this.alive = true;

    this.cooldown = randomInRange(0, 0.5);
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
    const minTurnRadius = clamp((speedRef / turnRate) * 1.05, 40, 580);
    const maxStartDeviation = (Math.PI / 180) * clamp(52 - speedRef * 0.22, 16, 42);
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
    const throttlePenalty = this.team.energy <= 0 ? 0.15 : 1;
    const steerBrake = this.route ? clamp(1 - turnUrgency * 0.78, 0.22, 1) : 1;
    const targetSpeed = dist < 8 ? 0 : this.effectiveSpeed() * this.throttle * throttlePenalty * steerBrake;

    this.speed = lerp(this.speed, targetSpeed, clamp(dt * 1.15, 0, 1));

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
    const compactMode = this.team.splitLevel === 0;
    const offsetScale = compactMode ? 0.5 : 1;
    const rot = rotateOffset(this.formationOffset.x * offsetScale, this.formationOffset.y * offsetScale, leader.angle);
    const tx = leader.x + rot.x;
    const ty = leader.y + rot.y;

    this.command.x = tx;
    this.command.y = ty;

    const desired = Math.atan2(ty - this.y, tx - this.x);
    const delta = shortestAngleDelta(this.angle, desired);
    const turnRate = this.effectiveTurnRate() * (compactMode ? 1.7 : 0.85);
    this.angle += clamp(delta, -turnRate * dt, turnRate * dt);

    const dist = distance(this.x, this.y, tx, ty);
    const targetSpeed = leader.speed + clamp(dist * (compactMode ? 1.1 : 0.5), 0, compactMode ? 56 : 34);
    this.speed = lerp(this.speed, targetSpeed, clamp(dt * (compactMode ? 2.8 : 1.2), 0, 1));

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
    const broadsideFactor = Math.sin(relative);
    return 0.72 + broadsideFactor * 0.62;
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
    const damage = this.effectiveDamage() * this.broadsideMultiplier(target);

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
    this.cooldown = 1 / this.base.fireRate;
  }

  takeDamage(amount, _source = null, match = null) {
    if (!this.alive) {
      return;
    }
    if (this.team.splitLevel === 0) {
      this.team.applyCombinedDamage(amount, _source, match);
      return;
    }
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) {
      this.alive = false;
      this.speed = 0;
      this.route = null;
      if (match) {
        match.spawnBurst(this.x, this.y, "#ff9d7d", 10);
      }
    }
  }

  serialize() {
    return {
      id: this.id,
      key: this.key,
      name: this.name,
      x: this.x,
      y: this.y,
      angle: this.angle,
      speed: this.speed,
      cooldown: this.cooldown,
      hp: this.hp,
      maxHp: this.maxHp,
      alive: this.alive,
      radius: this.radius,
      throttle: this.throttle,
      vision: this.effectiveVision(),
      range: this.effectiveRange(),
      attached: this.isAttached(),
      canControl: this.canControl(),
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
  constructor(team, x, y, zone) {
    this.id = nextEntityId();
    this.kind = "scout";
    this.team = team;
    this.zone = zone;
    this.mode = "transit";
    this.x = x;
    this.y = y;
    this.angle = randomInRange(0, TAU);
    this.speed = 62;
    this.radius = 3.8;
    this.hp = 1;
    this.maxHp = 1;
    this.vision = 145;
    this.alive = true;
    this.command = {
      x: zone.x + zone.width * 0.5,
      y: zone.y + zone.height * 0.5,
    };
    this.patrolTimer = randomInRange(1.2, 2.4);
  }

  randomPatrolPoint() {
    const margin = 18;
    this.command = {
      x: randomInRange(this.zone.x + margin, this.zone.x + this.zone.width - margin),
      y: randomInRange(this.zone.y + margin, this.zone.y + this.zone.height - margin),
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
        this.patrolTimer = randomInRange(1.0, 2.6);
        this.randomPatrolPoint();
      }
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
    this.maxHp = 130 * team.attrModifier;
    this.hp = this.maxHp;
    this.vision = 145;
    this.attackRange = 280;
    this.damage = 11 * team.attrModifier;
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
  constructor(match, seat, name, spawnX, spawnY, facing) {
    this.match = match;
    this.seat = seat;
    this.name = name;
    this.color = TEAM_COLORS[seat];
    this.projectileColor = TEAM_PROJECTILE_COLORS[seat];

    this.splitLevel = 0;
    this.attrModifier = 1;
    this.maxEnergy = 360;
    this.energy = 300;
    this.visibleEnemyIds = new Set();
    this.cooldowns = {
      scout: 0,
      haruhi: 0,
      beam: 0,
    };

    this.ships = {
      main: new Ship(this, "main", spawnX, spawnY, facing),
      sub1: new Ship(this, "sub1", spawnX - 18, spawnY + 14, facing),
      sub2: new Ship(this, "sub2", spawnX - 18, spawnY - 14, facing),
    };

    this.ships.sub1.formationOffset = { x: -26, y: 16 };
    this.ships.sub2.formationOffset = { x: -26, y: -16 };

    this.combinedHullMax = this.totalShipMaxHull();
    this.combinedHull = this.combinedHullMax;
    this.scouts = [];
    this.wingmen = [];
    this.beams = [];
  }

  getShips() {
    return [this.ships.main, this.ships.sub1, this.ships.sub2];
  }

  getEntities() {
    const list = [];
    for (const ship of this.getShips()) {
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

  totalShipMaxHull() {
    return this.getShips().reduce((sum, ship) => sum + ship.maxHp, 0);
  }

  hasLivingShips() {
    return this.getShips().some((ship) => ship.alive);
  }

  hullRatio() {
    if (this.splitLevel === 0) {
      if (this.combinedHullMax <= 0) {
        return 0;
      }
      return this.combinedHull / this.combinedHullMax;
    }
    const living = this.getShips();
    const hp = living.reduce((sum, ship) => sum + Math.max(0, ship.hp), 0);
    const max = living.reduce((sum, ship) => sum + ship.maxHp, 0);
    return max <= 0 ? 0 : hp / max;
  }

  getControllableShips() {
    return this.getShips().filter((ship) => ship.canControl());
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

  applyCombinedDamage(amount, _source = null, match = null) {
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
        if (!ship.alive) {
          continue;
        }
        ship.alive = false;
        ship.speed = 0;
        ship.route = null;
        if (match) {
          match.spawnBurst(ship.x, ship.y, "#ff9d7d", 10);
        }
      }
    }
  }

  split(level) {
    if (level === 1 && this.splitLevel === 0) {
      this.splitLevel = 1;
      this.attrModifier *= 0.8;
      const hullRatio = this.combinedHullMax <= 0 ? 1 : this.combinedHull / this.combinedHullMax;
      for (const ship of this.getShips()) {
        ship.maxHp = ship.base.hp * this.attrModifier;
        ship.hp = ship.maxHp * hullRatio;
      }
      this.ships.sub1.setBezierRoute(undefined, undefined, this.ships.main.x - 90, this.ships.main.y + 100, 1, false);
      return true;
    }
    if (level === 2 && this.splitLevel === 1) {
      this.splitLevel = 2;
      this.attrModifier *= 0.8;
      this.refreshStatsPreserveRatio();
      this.ships.sub2.setBezierRoute(undefined, undefined, this.ships.main.x - 90, this.ships.main.y - 100, 1, false);
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
    const regenMultiplier = throttleAvg <= 1 ? 1 + (1 - throttleAvg) * 0.88 : 1 - (throttleAvg - 1) * 0.86;
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
    for (const beam of this.beams) {
      beam.life -= dt;
    }

    this.scouts = this.scouts.filter((scout) => scout.alive);
    this.wingmen = this.wingmen.filter((wingman) => wingman.alive);
    this.beams = this.beams.filter((beam) => beam.life > 0);
  }

  launchScout(zoneId) {
    const cost = 30;
    if (this.cooldowns.scout > 0) {
      return false;
    }
    if (!this.spendEnergy(cost)) {
      return false;
    }
    const zone = this.match.zoneById(zoneId);
    const source = this.ships.main.alive ? this.ships.main : this.getShips().find((ship) => ship.alive);
    if (!source) {
      return false;
    }
    this.scouts.push(new Scout(this, source.x, source.y, zone));
    this.cooldowns.scout = 2.5;
    return true;
  }

  launchWingman(zoneId) {
    const cost = 55;
    if (this.cooldowns.haruhi > 0) {
      return false;
    }
    if (!this.spendEnergy(cost)) {
      return false;
    }
    const zone = this.match.zoneById(zoneId);
    const main = this.ships.main;
    if (!main.alive) {
      return false;
    }
    this.wingmen.push(new Wingman(this, main.x, main.y, zone));
    this.cooldowns.haruhi = 9;
    return true;
  }

  castBeam(directionX, directionY, enemyTeam) {
    const ship = this.ships.sub2;
    const cost = 78;
    if (this.splitLevel < 2 || !ship.alive) {
      return false;
    }
    if (this.cooldowns.beam > 0) {
      return false;
    }
    if (!this.spendEnergy(cost)) {
      return false;
    }

    const angle = Math.atan2(directionY - ship.y, directionX - ship.x);
    const range = 720 * this.attrModifier;
    const x2 = this.match.clampX(ship.x + Math.cos(angle) * range, 0);
    const y2 = this.match.clampY(ship.y + Math.sin(angle) * range, 0);
    this.beams.push({
      id: nextEntityId(),
      x1: ship.x,
      y1: ship.y,
      x2,
      y2,
      color: "#8ef8ff",
      life: 0.22,
    });

    const targets = enemyTeam.getEntities();
    for (const target of targets) {
      if (!target.alive) {
        continue;
      }
      const probe = linePointDistance(ship.x, ship.y, x2, y2, target.x, target.y);
      if (probe.dist <= target.radius + 8 && probe.t >= 0 && probe.t <= 1) {
        const falloff = 1 - probe.t * 0.38;
        const damage = 112 * this.attrModifier * falloff;
        target.takeDamage(damage, ship, this.match);
      }
    }
    this.cooldowns.beam = 12;
    return true;
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
    for (const ship of this.getShips()) {
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
      attrModifier: this.attrModifier,
      energy: this.energy,
      maxEnergy: this.maxEnergy,
      hullRatio: this.hullRatio(),
      cooldowns: {
        scout: this.cooldowns.scout,
        haruhi: this.cooldowns.haruhi,
        beam: this.cooldowns.beam,
      },
      visibleEnemyIds: Array.from(this.visibleEnemyIds),
      ships: {
        main: this.ships.main.serialize(),
        sub1: this.ships.sub1.serialize(),
        sub2: this.ships.sub2.serialize(),
      },
      scouts: this.scouts.filter((item) => item.alive).map((item) => item.serialize()),
      wingmen: this.wingmen.filter((item) => item.alive).map((item) => item.serialize()),
      beams: this.beams.map((beam) => ({
        id: beam.id,
        x1: beam.x1,
        y1: beam.y1,
        x2: beam.x2,
        y2: beam.y2,
        color: beam.color,
        life: beam.life,
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
    this.wingmanTimer = 10;
    this.beamTimer = 13;
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
    this.wingmanTimer -= dt;
    this.beamTimer -= dt;
    this.modeTimer -= dt;

    this.updateStuckState(dt);

    if (elapsed > 24 && this.team.splitLevel < 1) {
      this.team.split(1);
    }
    if (elapsed > 56 && this.team.splitLevel < 2) {
      this.team.split(2);
    }

    if (this.moveTimer <= 0 || this.stuckTimer > 2) {
      this.issueMovement();
      this.moveTimer = randomInRange(4.2, 6.4);
      this.stuckTimer = 0;
    }

    if (this.scoutTimer <= 0) {
      const zone = this.team.match.zones[Math.floor(Math.random() * this.team.match.zones.length)];
      this.team.launchScout(zone.id);
      this.scoutTimer = randomInRange(8, 12);
    }

    if (this.wingmanTimer <= 0) {
      const zone = this.team.match.zones[Math.floor(Math.random() * this.team.match.zones.length)];
      this.team.launchWingman(zone.id);
      this.wingmanTimer = randomInRange(18, 24);
    }

    if (this.beamTimer <= 0 && this.team.splitLevel >= 2) {
      const sub2 = this.team.ships.sub2;
      const enemyMain = this.enemy.ships.main;
      if (sub2.alive && enemyMain.alive) {
        this.team.castBeam(enemyMain.x, enemyMain.y, this.enemy);
      }
      this.beamTimer = randomInRange(14, 18);
    }
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
    const energyRatio = this.team.energy / this.team.maxEnergy;
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
    teamNames = {
      A: "玩家A舰队",
      B: mode === "ai" ? "统合思念体AI舰队" : "玩家B舰队",
    },
  } = {}) {
    this.mode = mode;
    this.worldSize = worldSize;
    this.mapPadding = mapPadding;
    this.zones = buildZones(worldSize);

    this.tick = 0;
    this.elapsed = 0;
    this.phase = "running";
    this.winnerSeat = null;

    const centerY = worldSize * 0.5;
    const leftX = worldSize * 0.35;
    const rightX = worldSize * 0.65;

    this.teamA = new Team(this, "A", teamNames.A || "玩家A舰队", leftX, centerY, 0);
    this.teamB = new Team(this, "B", teamNames.B || (mode === "ai" ? "统合思念体AI舰队" : "玩家B舰队"), rightX, centerY, Math.PI);

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
    this.applyAction(team, action);
  }

  applyAction(team, action) {
    if (!action || typeof action !== "object") {
      return;
    }

    const type = String(action.type || "");

    if (type === "set_route") {
      const shipKey = String(action.shipKey || "main");
      const ship = team.ships[shipKey];
      if (!ship || !ship.alive || !ship.canControl()) {
        return;
      }
      const endX = Number(action.endX);
      const endY = Number(action.endY);
      const controlX = Number(action.controlX);
      const controlY = Number(action.controlY);
      const throttle = Number(action.throttle);
      if (!Number.isFinite(endX) || !Number.isFinite(endY)) {
        return;
      }
      ship.setBezierRoute(
        Number.isFinite(controlX) ? controlX : undefined,
        Number.isFinite(controlY) ? controlY : undefined,
        endX,
        endY,
        Number.isFinite(throttle) ? throttle : ship.throttle,
        action.anchorToMain !== false,
      );
      return;
    }

    if (type === "route_control") {
      const shipKey = String(action.shipKey || "main");
      const ship = team.ships[shipKey];
      if (!ship || !ship.alive || !ship.canControl() || !ship.route) {
        return;
      }
      const controlX = Number(action.controlX);
      const controlY = Number(action.controlY);
      if (!Number.isFinite(controlX) || !Number.isFinite(controlY)) {
        return;
      }
      ship.setRouteControl(controlX, controlY, false);
      return;
    }

    if (type === "route_end") {
      const shipKey = String(action.shipKey || "main");
      const ship = team.ships[shipKey];
      if (!ship || !ship.alive || !ship.canControl() || !ship.route) {
        return;
      }
      const endX = Number(action.endX);
      const endY = Number(action.endY);
      if (!Number.isFinite(endX) || !Number.isFinite(endY)) {
        return;
      }
      ship.setRouteEndpoint(endX, endY, false);
      return;
    }

    if (type === "set_throttle") {
      const shipKey = String(action.shipKey || "main");
      const ship = team.ships[shipKey];
      if (!ship || !ship.alive || !ship.canControl()) {
        return;
      }
      ship.throttle = clamp(Number(action.throttle) || ship.throttle, 0.25, 1.4);
      return;
    }

    if (type === "clear_route") {
      const shipKey = String(action.shipKey || "main");
      const ship = team.ships[shipKey];
      if (!ship || !ship.alive || !ship.canControl()) {
        return;
      }
      ship.clearRoute();
      return;
    }

    if (type === "split") {
      const level = Number(action.level);
      if (level === 1 || level === 2) {
        team.split(level);
      }
      return;
    }

    if (type === "launch_scout") {
      const zoneId = Number(action.zoneId) || 5;
      team.launchScout(zoneId);
      return;
    }

    if (type === "launch_wingman") {
      const zoneId = Number(action.zoneId) || 5;
      team.launchWingman(zoneId);
      return;
    }

    if (type === "cast_beam") {
      const targetX = Number(action.targetX);
      const targetY = Number(action.targetY);
      if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) {
        return;
      }
      const enemyTeam = this.enemyTeamBySeat(team.seat);
      team.castBeam(targetX, targetY, enemyTeam);
    }
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
