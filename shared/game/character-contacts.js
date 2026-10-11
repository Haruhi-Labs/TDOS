import { haruhiOtherworlderAuraContact } from "./contact-geometry.js";
import { distance } from "./math.js";
import { rngFor } from "./rng.js";
import { supportOtherworlderReady, triggerSupportOtherworlder } from "./haruhi-support.js";
import { bunnyTeamSupportSources } from "./bunny-haruhi-support.js";
import { bunnyOwnerDamageBlocked } from "./bunny-haruhi-companion.js";
import { HARUHI_OTHERWORLDER_DAMAGE_RATIO, HARUHI_OTHERWORLDER_KNOCKBACK_DURATION, haruhiOtherworlderReady, triggerHaruhiOtherworlder } from "./haruhi-flagship.js";
import { DAMAGE_KIND } from "./damage.js";
import { CHARACTER_DEFS } from "./characters.js";

// 刀锋接触历史属于该效果，不能向普通舰船挂载外部可改写的临时字段。
const bladeHitHistory = new WeakMap();

const TAU = Math.PI * 2;
const BLADE_QUEEN_SKILL = CHARACTER_DEFS.asakura.subSkill;
export const BLADE_QUEEN_RANGE_MULTIPLIER = BLADE_QUEEN_SKILL.rangeMultiplier;

function applyForcedKnockback(match, source, contactTarget, contact = null) {
  if (bunnyOwnerDamageBlocked(source, contactTarget)) return;
  const targetTeam = contactTarget.team;
  const fleetKey = targetTeam.fleetKeyForShip(contactTarget);
  const fleet = targetTeam.fleetMembersByKey(fleetKey);
  const deltaX = contactTarget.x - source.x;
  const deltaY = contactTarget.y - source.y;
  const length = Math.hypot(deltaX, deltaY);
  const directionX = Number.isFinite(contact?.directionX)
    ? contact.directionX
    : length > 1e-6 ? deltaX / length : Math.cos(source.angle);
  const directionY = Number.isFinite(contact?.directionY)
    ? contact.directionY
    : length > 1e-6 ? deltaY / length : Math.sin(source.angle);
  const knockbackDistance = Math.max(1, source.effectiveVision());
  const startedAt = match.elapsed;
  const endsAt = startedAt + HARUHI_OTHERWORLDER_KNOCKBACK_DURATION;

  for (const ship of fleet) {
    if (ship.isControlImmune() || ship.minimumFlightSpeed() > 0) continue;
    const padding = Math.max(8, ship.radius + 2);
    ship.beginForcedKnockback({
      startedAt,
      endsAt,
      fromX: ship.x,
      fromY: ship.y,
      toX: match.clampX(ship.x + directionX * knockbackDistance, padding),
      toY: match.clampY(ship.y + directionY * knockbackDistance, padding),
    });
  }

  contactTarget.takeDamage(
    contactTarget.maxHp * HARUHI_OTHERWORLDER_DAMAGE_RATIO,
    source,
    match,
    { kind: DAMAGE_KIND.COLLISION },
  );
  match.spawnFloatingTextKey(contactTarget.x + 10, contactTarget.y - 16, "异世界冲击", {}, "#ffcf8e");
  match.spawnBurst(contactTarget.x, contactTarget.y, "#ffcf8e", 14);
}

export function resolveHaruhiOtherworlderContacts(match) {
  const pairs = [[match.teamA, match.teamB], [match.teamB, match.teamA]];
  for (const [team, enemyTeam] of pairs) {
    const source = team.ships.main;
    if (!source?.alive || !haruhiOtherworlderReady(team)) continue;
    let hit = null;
    for (const target of enemyTeam.getAllShips()) {
      if (!target.alive || target.forcedKnockback) continue;
      const contact = haruhiOtherworlderAuraContact(source, target);
      if (contact && (!hit || contact.localX < hit.contact.localX)) {
        hit = { target, contact };
      }
    }
    if (!hit || !triggerHaruhiOtherworlder(team)) continue;
    applyForcedKnockback(match, source, hit.target, hit.contact);
  }
}

/** 在旧春日冲撞后单独处理新来源，共用命中几何、伤害及击退公式。 */
export function resolveBunnyOtherworlderContacts(match) {
  for (const team of [match.teamA, match.teamB]) {
    const enemy = match.enemyTeamBySeat(team.seat);
    for (const support of bunnyTeamSupportSources(team)) {
      if (!supportOtherworlderReady(support, match.elapsed)) continue;
      const source = support.sourceShip;
      let hit = null;
      for (const target of enemy.getAllShips()) {
        if (!target.alive || target.forcedKnockback || bunnyOwnerDamageBlocked(source, target)) continue;
        const contact = haruhiOtherworlderAuraContact(source, target);
        if (contact && (!hit || contact.localX < hit.contact.localX)) hit = { target, contact };
      }
      if (hit && triggerSupportOtherworlder(support, match.elapsed)) applyForcedKnockback(match, source, hit.target, hit.contact);
    }
  }
}

export function resolveBladeQueenContacts(match) {
  const pairs = [[match.teamA, match.teamB], [match.teamB, match.teamA]];
  for (const [team, enemyTeam] of pairs) {
    for (const ship of team.getAllShips()) {
      if (!ship.alive || !ship.hasEffect("bladeQueenUntil")) continue;
      let hitLog = bladeHitHistory.get(ship);
      if (!hitLog) {
        hitLog = new Map();
        bladeHitHistory.set(ship, hitLog);
      }
      for (const target of enemyTeam.getAllShips()) {
        if (!target.alive) continue;
        const hitRadius = (ship.radius + 4) * BLADE_QUEEN_RANGE_MULTIPLIER + target.radius;
        if (distance(ship.x, ship.y, target.x, target.y) > hitRadius) continue;
        const lastHitAt = hitLog.get(target.id);
        if (lastHitAt !== undefined && match.elapsed - lastHitAt < BLADE_QUEEN_SKILL.hitInterval) continue;
        hitLog.set(target.id, match.elapsed);
        target.takeDamage(
          target.maxHp * BLADE_QUEEN_SKILL.damageRatio,
          ship,
          match,
          { kind: DAMAGE_KIND.SKILL },
        );
        for (let spark = 0; spark < 3; spark += 1) {
          const offset = rngFor(match).range(0, target.radius + 6);
          const angle = rngFor(match).range(0, TAU);
          match.spawnBurst(
            match.clampX(target.x + Math.cos(angle) * offset, 0),
            match.clampY(target.y + Math.sin(angle) * offset, 0),
            spark % 2 === 0 ? "#ff2d55" : "#ff8aa0",
            rngFor(match).range(7, 12),
          );
        }
      }
    }
  }
}
