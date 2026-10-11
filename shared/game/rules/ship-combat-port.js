import { clamp } from "../math.js";
import { fireArcDensityMultiplier } from "../combat-rules.js";
import { FORMATION_DAMAGE_SHARE } from "../model/model-support.js";
import { rngFor } from "../rng.js";

export function createWeaponPort(ship, match, enemyTeam) {
  return Object.freeze({
    alive: () => ship.alive,
    available: () => ship.team.match.rules.weaponAvailable(ship),
    controlLocked: () => ship.isControlLocked(),
    target: () => {
      const target = ship.team.pickTargetFor(ship, enemyTeam);
      return target && { x: target.x, y: target.y, angle: target.angle, speed: target.speed };
    },
    origin: () => ({ x: ship.x, y: ship.y, angle: ship.angle }),
    random: (min, max) => rngFor(ship.team.match).range(min, max),
    arcDensity: (angle) => fireArcDensityMultiplier(angle, ship.team.match.rules.improvedFireArcs(ship.team)),
    prepareDamage: () => ship.team.match.shipEffects.prepareShotDamage(ship, ship.effectiveDamage(), match),
    projectileProfile: () => ship.team.match.rules.projectileProfile(ship),
    clampX: (x) => match.clampX(x, 0),
    clampY: (y) => match.clampY(y, 0),
    launch: (shot) => match.spawnProjectile({ team: ship.team, source: ship, x: ship.x, y: ship.y, ...shot }),
    recordAttack: () => match.recordAttack(ship.team.seat, "projectile"),
    fireRate: () => ship.effectiveFireRate(),
  });
}

export function createDamagePort(ship, source, match) {
  return Object.freeze({
    canDamage: () => ship.team.match.rules.canDamage(source, ship),
    alive: () => ship.alive,
    immune: () => ship.isDamageImmune(),
    attackMultiplier: (kind) => ship.team.match.rules.attackDamageMultiplier(source, ship, kind),
    shareRatio: FORMATION_DAMAGE_SHARE,
    shareTargets: () => ship.team.fleetMembersForShip(ship).filter((member) => member !== ship && member.alive)
      .map((member) => Object.freeze({ hit: (amount, context) => member.takeDamage(amount, source, match, context) })),
    damageMultiplier: () => ship.damageTakenMultiplier(),
    applyDamage: (amount) => ship.applyHullDamage(amount, ship.maxHp * clamp(Number(ship.team.damageFloorRatio) || 0, 0, 1)),
    recordDamage: (loss, kind) => { if (match) match.recordDamage(source, ship, loss, kind); },
    hp: () => ship.hp,
    retire: () => ship.retireAfterDamage(),
    resolveFormation: () => ship.team.resolvePostCasualtyState(match),
    finishDeath: () => {
      if (!match) return;
      if (ship.team.match.rules.countsForVictory(ship)) match.recordShipLoss(ship.team.seat);
      match.spawnBurst(ship.x, ship.y, "#ff9d7d", 10);
      match.onShipDestroyed(ship, source);
    },
  });
}
