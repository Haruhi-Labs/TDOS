// 战斗实体的状态与生命周期。
import { rngFor } from "../rng.js";
import { nextEntityId } from "../model/model-support.js";

export class Wingman {
  #team;
  get team() { return this.#team; }
  #zone;
  get zone() { return this.#zone; }
  #mode;
  get mode() { return this.#mode; }
  #x;
  get x() { return this.#x; }
  #y;
  get y() { return this.#y; }
  #angle;
  get angle() { return this.#angle; }
  #speed;
  get speed() { return this.#speed; }
  #radius;
  get radius() { return this.#radius; }
  #maxHp;
  get maxHp() { return this.#maxHp; }
  #hp;
  get hp() { return this.#hp; }
  #vision;
  get vision() { return this.#vision; }
  #attackRange;
  get attackRange() { return this.#attackRange; }
  #damage;
  get damage() { return this.#damage; }
  #cooldown;
  get cooldown() { return this.#cooldown; }
  #life;
  get life() { return this.#life; }
  #alive;
  get alive() { return this.#alive; }
  #command;
  get command() { return this.#command && Object.freeze({ ...this.#command }); }
  #patrolTimer;
  get patrolTimer() { return this.#patrolTimer; }

  constructor(team, x, y, zone) {
    Object.defineProperties(this, {
      id: { enumerable: true, value: nextEntityId(team.match) },
      kind: { enumerable: true, value: "wingman" },
    });
    this.#team = team;
    this.#zone = Object.freeze({ ...zone });
    this.#mode = "transit";
    this.#x = x;
    this.#y = y;
    this.#angle = 0;
    this.#speed = 72;
    this.#radius = 5.2;
    this.#maxHp = 132;
    this.#hp = this.#maxHp;
    this.#vision = 100;
    this.#attackRange = 280;
    this.#damage = 11.5;
    this.#cooldown = rngFor(this.#team.match).range(0.8, 1.4);
    this.#life = 48;
    this.#alive = true;
    this.#command = {
      x: zone.x + zone.width * 0.5,
      y: zone.y + zone.height * 0.5,
    };
    this.#patrolTimer = rngFor(this.#team.match).range(1.0, 2.5);
  }

  displaceTo(x, y) {
    this.#x = this.#team.match.clampX(x, 0);
    this.#y = this.#team.match.clampY(y, 0);
  }

  guideTo(point) { this.#command = { x: point.x, y: point.y }; }
  setFlightSpeed(speed) { this.#speed = speed; }
  resetAttackCycle(delay = 0) { this.#cooldown = delay; }

  randomPatrolPoint() {
    const margin = 26;
    this.#command = {
      x: rngFor(this.#team.match).range(this.#zone.x + margin, this.#zone.x + this.#zone.width - margin),
      y: rngFor(this.#team.match).range(this.#zone.y + margin, this.#zone.y + this.#zone.height - margin),
    };
  }

  transferToTeam(destination, zone) {
    if (destination === this.#team || destination.match !== this.#team.match
      || !this.#team.wingmen.includes(this) || !destination.canAcceptWingman(this)) return false;
    this.#team.removeWingman(this);
    this.#team = destination;
    this.#zone = Object.freeze({ ...zone });
    this.#command = { x: zone.x + zone.width * 0.5, y: zone.y + zone.height * 0.5 };
    destination.addWingman(this);
    return true;
  }

  update(dt) {
    if (!this.#alive) {
      return;
    }
    this.#life -= dt;
    this.#cooldown = Math.max(0, this.#cooldown - dt);
    if (this.#life <= 0) {
      this.#alive = false;
      return;
    }

    const dx = this.#command.x - this.#x;
    const dy = this.#command.y - this.#y;
    const d = Math.hypot(dx, dy);
    if (d > 1) {
      this.#x += (dx / d) * this.#speed * dt;
      this.#y += (dy / d) * this.#speed * dt;
      this.#angle = Math.atan2(dy, dx);
    }

    if (this.#mode === "transit" && d < 12) {
      this.#mode = "patrol";
      this.randomPatrolPoint();
    } else if (this.#mode === "patrol") {
      this.#patrolTimer -= dt;
      if (d < 12 || this.#patrolTimer <= 0) {
        this.#patrolTimer = rngFor(this.#team.match).range(1.0, 2.8);
        this.randomPatrolPoint();
      }
    }
  }

  tryAttack(match, enemyTeam) {
    if (!this.#alive || this.#cooldown > 0) {
      return;
    }
    const target = this.#team.pickTargetFor(this, enemyTeam);
    if (!target) {
      return;
    }

    const spread = rngFor(this.#team.match).range(-7, 7);
    const angle = Math.atan2(target.y - this.#y, target.x - this.#x);
    const targetX = target.x + Math.cos(angle + Math.PI * 0.5) * spread;
    const targetY = target.y + Math.sin(angle + Math.PI * 0.5) * spread;

    match.spawnProjectile({
      team: this.#team,
      source: this,
      x: this.#x,
      y: this.#y,
      targetX: match.clampX(targetX, 0),
      targetY: match.clampY(targetY, 0),
      damage: this.#damage,
      speed: 260,
      hitRadius: 7,
      color: this.#team.projectileColor,
    });
    match.recordAttack(this.#team.seat, "projectile");
    this.#cooldown = 1.4;
  }

  takeDamage(amount, _source = null, match = null) {
    if (!this.#alive) {
      return;
    }
    this.#hp = Math.max(0, this.#hp - amount);
    if (this.#hp <= 0) {
      this.#alive = false;
      if (match) {
        match.spawnBurst(this.#x, this.#y, "#ffd18a", 7);
      }
    }
  }

  serialize() {
    return {
      id: this.id,
      kind: this.kind,
      x: this.#x,
      y: this.#y,
      angle: this.#angle,
      alive: this.#alive,
      radius: this.#radius,
      hp: this.#hp,
      maxHp: this.#maxHp,
      vision: this.#vision,
      life: this.#life,
    };
  }
}
