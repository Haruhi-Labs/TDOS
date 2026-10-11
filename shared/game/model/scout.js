// 战斗实体的状态与生命周期。
import { clamp, distance, normalizeAngle } from "../math.js";
import { rngFor } from "../rng.js";
import { Projectile } from "../model/projectile.js";
import { TAU, YUKI_COMBAT_SCOUT_STATS, nextEntityId } from "../model/model-support.js";

export class Scout {
  constructor(team, x, y, config = {}) {
    this.id = nextEntityId(team.match);
    this.kind = "scout";
    this.team = team;
    this.zone = config.zone || null;
    this.pattern = config.pattern || (this.zone ? "zone" : "burst");
    this.mission = config.mission || "patrol";
    this.mode = "transit";
    this.x = x;
    this.y = y;
    this.angle = rngFor(this.team.match).range(0, TAU);
    this.speed = config.speed || (this.pattern === "burst" ? 112 : 62);
    this.radius = config.radius || (this.pattern === "burst" ? 3.2 : 3.8);
    this.hp = 1;
    this.maxHp = 1;
    // 只在释放时根据旗舰判定；即使之后被鹤屋策反，也保留这架侦察机原本的机体能力。
    this.combatCapable = config.combatCapable ?? team.hasYukiFlagship();
    this.vision = this.combatCapable
      ? YUKI_COMBAT_SCOUT_STATS.vision
      : config.vision || (this.pattern === "burst" ? 86 : 95);
    this.attackRange = this.combatCapable ? this.vision : 0;
    this.damage = this.combatCapable ? YUKI_COMBAT_SCOUT_STATS.damage : 0;
    this.fireRate = this.combatCapable ? YUKI_COMBAT_SCOUT_STATS.fireRate : 0;
    this.cooldown = this.combatCapable ? rngFor(this.team.match).range(0, 0.5) : 0;
    this.alive = true;
    this.life = Number.isFinite(config.life) ? config.life : this.pattern === "burst" ? 11 : 28;
    this.anchor = config.anchor || null;
    this.anchorRadius = config.anchorRadius || 22;
    this.patrolCenter = config.patrolCenter && Number.isFinite(config.patrolCenter.x) && Number.isFinite(config.patrolCenter.y)
      ? { x: config.patrolCenter.x, y: config.patrolCenter.y }
      : null;
    this.patrolRadius = Number.isFinite(config.patrolRadius) ? Math.max(24, config.patrolRadius) : null;
    this.orbitAngle = rngFor(this.team.match).range(0, TAU);
    const orbitSpeedRange = this.pattern === "burst" ? [2.4, 4.8] : [0.8, 1.6];
    this.orbitSpeed = rngFor(this.team.match).range(...orbitSpeedRange) * (rngFor(this.team.match).next() < 0.5 ? -1 : 1);
    this.command = {
      x: x,
      y: y,
    };

    if (this.zone) {
      this.command.x = this.zone.x + this.zone.width * 0.5;
      this.command.y = this.zone.y + this.zone.height * 0.5;
    } else if (this.anchor) {
      const target = this.burstOrbitPoint();
      this.command.x = target.x;
      this.command.y = target.y;
    }
    // 若指定了 seekPoint(敌方估计位置)，先直飞该点把视野覆盖到目标，再在战区巡逻——
    // 比"飞战区中心+随机巡逻"更快找到敌人(战区≈480px ≫ 侦察视野≈95px，随机巡逻常错过)。
    if (config.seekPoint && Number.isFinite(config.seekPoint.x) && Number.isFinite(config.seekPoint.y)) {
      this.command.x = config.seekPoint.x;
      this.command.y = config.seekPoint.y;
    }

    this.patrolTimer = rngFor(this.team.match).range(1.0, 2.4);
  }

  assignMission(zone, options = {}) {
    const seekPoint = options.seekPoint && Number.isFinite(options.seekPoint.x) && Number.isFinite(options.seekPoint.y)
      ? options.seekPoint
      : { x: zone.x + zone.width * 0.5, y: zone.y + zone.height * 0.5 };
    this.zone = zone;
    this.pattern = "zone";
    this.mission = options.mission || this.mission || "patrol";
    this.patrolCenter = options.patrolCenter && Number.isFinite(options.patrolCenter.x) && Number.isFinite(options.patrolCenter.y)
      ? { x: options.patrolCenter.x, y: options.patrolCenter.y }
      : { x: seekPoint.x, y: seekPoint.y };
    this.patrolRadius = Number.isFinite(options.patrolRadius) ? Math.max(24, options.patrolRadius) : this.patrolRadius;
    this.command = { x: seekPoint.x, y: seekPoint.y };
    this.mode = "transit";
    this.patrolTimer = rngFor(this.team.match).range(1, 2.1);
  }

  transferToTeam(destination, commandZone) {
    this.team.removeScout(this);
    this.team = destination;
    destination.addScout(this);
    // 永久策反保留既有巡逻区域，只将下一目标指向策反战区中心。
    this.command = { x: commandZone.x + commandZone.width * 0.5, y: commandZone.y + commandZone.height * 0.5 };
  }

  randomPatrolPoint() {
    if (!this.zone) {
      return;
    }
    const margin = 18;
    const zoneMinX = this.zone.x + margin;
    const zoneMaxX = this.zone.x + this.zone.width - margin;
    const zoneMinY = this.zone.y + margin;
    const zoneMaxY = this.zone.y + this.zone.height - margin;
    const minX = this.patrolCenter && this.patrolRadius
      ? Math.max(zoneMinX, this.patrolCenter.x - this.patrolRadius)
      : zoneMinX;
    const maxX = this.patrolCenter && this.patrolRadius
      ? Math.min(zoneMaxX, this.patrolCenter.x + this.patrolRadius)
      : zoneMaxX;
    const minY = this.patrolCenter && this.patrolRadius
      ? Math.max(zoneMinY, this.patrolCenter.y - this.patrolRadius)
      : zoneMinY;
    const maxY = this.patrolCenter && this.patrolRadius
      ? Math.min(zoneMaxY, this.patrolCenter.y + this.patrolRadius)
      : zoneMaxY;
    this.command = {
      x: rngFor(this.team.match).range(Math.min(minX, maxX), Math.max(minX, maxX)),
      y: rngFor(this.team.match).range(Math.min(minY, maxY), Math.max(minY, maxY)),
    };
  }

  burstOrbitPoint() {
    return {
      x: this.anchor.x + Math.cos(this.orbitAngle) * this.anchorRadius,
      y: this.anchor.y + Math.sin(this.orbitAngle) * this.anchorRadius,
    };
  }

  updateBurstOrbit(dt) {
    if (!this.anchor) {
      return;
    }
    const previousX = this.x;
    const previousY = this.y;
    this.orbitAngle = normalizeAngle(this.orbitAngle + this.orbitSpeed * dt);
    const next = this.burstOrbitPoint();
    this.x = next.x;
    this.y = next.y;
    this.command = next;
    this.angle = Math.atan2(this.y - previousY, this.x - previousX);
  }

  update(dt) {
    if (!this.alive) {
      return;
    }
    this.life -= dt;
    if (this.combatCapable) {
      this.cooldown = Math.max(0, this.cooldown - dt);
    }
    if (this.life <= 0) {
      this.alive = false;
      return;
    }

    if (this.pattern === "burst" && this.mode === "orbit") {
      this.updateBurstOrbit(dt);
      return;
    }

    const dx = this.command.x - this.x;
    const dy = this.command.y - this.y;
    const d = Math.hypot(dx, dy);
    const step = Math.min(d, this.speed * dt);
    if (d > 1e-6 && step > 0) {
      this.x += (dx / d) * step;
      this.y += (dy / d) * step;
      this.angle = Math.atan2(dy, dx);
    }
    const remaining = Math.max(0, d - step);

    if (this.pattern === "zone") {
      if (this.mode === "transit" && remaining < 12) {
        this.mode = "patrol";
        this.randomPatrolPoint();
      } else if (this.mode === "patrol") {
        this.patrolTimer -= dt;
        if (remaining < 12 || this.patrolTimer <= 0) {
          this.patrolTimer = rngFor(this.team.match).range(1.0, 2.6);
          this.randomPatrolPoint();
        }
      }
      return;
    }

    if (remaining <= 1e-6) {
      this.mode = "orbit";
    }
  }

  effectiveDamage() {
    return this.damage * (this.team.statMult || 1);
  }

  effectiveFireRate() {
    return this.fireRate;
  }

  tryAttack(match, enemyTeam) {
    if (!this.combatCapable || !this.alive || this.cooldown > 0) {
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
    match.projectiles.push(
      new Projectile({
        team: this.team,
        source: this,
        x: this.x,
        y: this.y,
        targetX: match.clampX(predictedX + rngFor(this.team.match).range(-spread, spread), 0),
        targetY: match.clampY(predictedY + rngFor(this.team.match).range(-spread, spread), 0),
        damage: this.effectiveDamage(),
        speed: 240,
        hitRadius: 8,
        color: this.team.projectileColor,
      }),
    );
    match.recordAttack(this.team.seat, "projectile");
    this.cooldown = 1 / Math.max(0.01, this.effectiveFireRate());
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
