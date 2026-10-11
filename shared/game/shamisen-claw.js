import { DAMAGE_KIND } from "./damage.js";

// 猫爪印记的写入、过期与爆发均由此模块掌管，承伤仍提交到目标实体。
export function expireClawMarks(ship) {
  if (ship.clawMarks.stacks > 0 && ship.clawMarks.expiresAt <= ship.team.match.elapsed) {
    ship.clawMarks.sourceSeat = null;
    ship.clawMarks.stacks = 0;
    ship.clawMarks.expiresAt = 0;
  }
}

export function activeClawMarks(ship) {
  if (ship.clawMarks.stacks > 0 && ship.clawMarks.expiresAt <= ship.team.match.elapsed) {
    return { ...ship.clawMarks, sourceSeat: null, stacks: 0, expiresAt: 0 };
  }
  return { ...ship.clawMarks };
}

export function registerClawHit(ship, claw, match, source = null) {
  if (!ship.alive || !claw || !ship.team.match.rules.canDamage(source, ship)) {
    return false;
  }
  expireClawMarks(ship);
  const marks = ship.clawMarks;
  const sourceSeat = claw.sourceSeat || null;
  if (marks.stacks > 0 && marks.sourceSeat !== sourceSeat) {
    marks.stacks = 0;
  }
  marks.sourceSeat = sourceSeat;
  marks.required = Math.max(1, Math.round(Number(claw.triggerHits) || 4));
  marks.stacks += 1;
  marks.expiresAt = ship.team.match.elapsed + Math.max(0.5, Number(claw.markDuration) || 8);
  marks.color = claw.color || marks.color;

  if (marks.stacks < marks.required) {
    return false;
  }

  marks.stacks = 0;
  marks.expiresAt = 0;
  const burstDamage = Math.max(0, Number(claw.burstDamage) || 0);
  if (burstDamage > 0) {
    const damageImmune = ship.isDamageImmune();
    const damageContext = { kind: DAMAGE_KIND.ATTACK_EFFECT };
    const displayedDamage = burstDamage * ship.team.match.rules.attackDamageMultiplier(
      source,
      ship,
      damageContext.kind,
    );
    ship.takeDamage(burstDamage, source, match, damageContext);
    match.spawnFloatingTextKey(ship.x + 10, ship.y - 20, "猫爪爆发", {}, "#ffd0e4");
    if (damageImmune) {
      match.spawnFloatingTextKey(ship.x + 8, ship.y - 8, "免疫", {}, "#ffc5cf");
    } else {
      match.spawnFloatingText(ship.x + 8, ship.y - 8, `-${Math.round(displayedDamage)}`, "#ff8fbd");
    }
    match.spawnBurst(ship.x, ship.y, "#ff8fbd", 12);
  }
  return true;
}

export function initializeClawMarks(ship) {
  ship.clawMarks = { sourceSeat: null, stacks: 0, required: 4, expiresAt: 0, color: "#ffc0bd" };
}

export function clearClawMarks(ship) {
  ship.clawMarks.sourceSeat = null;
  ship.clawMarks.stacks = 0;
  ship.clawMarks.expiresAt = 0;
}
