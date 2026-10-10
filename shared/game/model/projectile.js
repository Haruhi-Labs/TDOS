// 战斗实体的状态与生命周期。
import { clamp, distance, shortestAngleDelta } from "../math.js";
import { rngFor } from "../rng.js";
import { DAMAGE_KIND } from "../damage.js";

import { DEG_TO_RAD, REAR_STRIKE_MIN_DEG, REAR_STRIKE_MULT, SMALL_TARGET_REF_RADIUS, SMALL_TARGET_MAX_MISS, nextEntityId } from "../model/model-support.js";

export class Projectile {
  constructor({
    team,
    source,
    x,
    y,
    targetX,
    targetY,
    damage,
    speed = 240,
    hitRadius = 8,
    color,
    visualKind = "shell",
    claw = null,
  }) {
    this.id = nextEntityId(team.match);
    this.kind = "projectile";
    this.team = team;
    this.source = source || null;
    this.sourceId = source ? source.id : null;
    this.x = x;
    this.y = y;
    this.targetX = targetX;
    this.targetY = targetY;
    this.damage = damage;
    this.speed = speed;
    this.hitRadius = hitRadius;
    this.color = color || team.projectileColor;
    this.visualKind = visualKind;
    this.claw = claw ? { ...claw } : null;
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
      if (!this.team.match.rules.canDamage(this.source, entity)) continue;
      if (!entity.alive || (typeof entity.isTargetableByFire === "function" && !entity.isTargetableByFire())) {
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
    if (evade > 0 && rngFor(match).next() < evade) {
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
    const damageImmune = typeof hitTarget.isDamageImmune === "function" && hitTarget.isDamageImmune();
    const damageContext = { kind: DAMAGE_KIND.PROJECTILE };
    const displayedDamage = damage * this.team.match.rules.attackDamageMultiplier(
      this.source,
      hitTarget,
      damageContext.kind,
    );
    hitTarget.takeDamage(damage, this.source, match, damageContext);
    match.recordAttack(this.team.seat, "projectile_hit");
    if (damageImmune) {
      match.spawnFloatingTextKey(hitTarget.x + 8, hitTarget.y - 8, "免疫", {}, "#ffc5cf");
    } else {
      match.spawnFloatingText(hitTarget.x + 8, hitTarget.y - 8, `-${Math.round(displayedDamage)}`, rear ? "#ffb066" : "#ffd178");
    }
    if (rear && !damageImmune) {
      match.spawnFloatingTextKey(hitTarget.x + 12, hitTarget.y - 22, "尾击", {}, "#ff9d5a");
    }
    if (this.claw && hitTarget.kind === "ship" && hitTarget.alive) {
      hitTarget.registerClawHit({
        ...this.claw,
        sourceSeat: this.team.seat,
        color: this.color,
      }, match, this.source);
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
      visualKind: this.visualKind,
    };
  }
}
