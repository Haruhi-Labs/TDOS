import { consumeKoizumiBarrierHit, koizumiBarrierBeamImpact } from "../characters/koizumi/barrier.js";
import { DAMAGE_KIND } from "../rules/damage.js";
import { rngFor } from "../foundation/rng.js";
import { nextEntityId, TAU } from "../model/model-support.js";

export function beamCasterState(ship) {
  return ship ? { key: ship.key, alive: ship.alive, attached: ship.isAttached(), controlLocked: ship.isControlLocked(), x: ship.x, y: ship.y } : null;
}

function spawnBeamHitParticles(match, x, y) {
  match.spawnBurst(x, y, "#8ef8ff", 11);
  for (let i = 0; i < 7; i += 1) {
    const angle = rngFor(match).range(0, TAU);
    const offset = rngFor(match).range(4, 28);
    const px = match.clampX(x + Math.cos(angle) * offset, 0);
    const py = match.clampY(y + Math.sin(angle) * offset, 0);
    match.spawnBurst(px, py, i % 2 === 0 ? "#bdf7ff" : "#9ef2ff", rngFor(match).range(3.5, 7.5));
  }
}

export function createTeamBeamPort(team) {
  const { match } = team;
  return {
    nextId: () => nextEntityId(match),
    clampX: (x) => match.clampX(x, 0),
    clampY: (y) => match.clampY(y, 0),
    caster: (key) => beamCasterState(team.shipByKey(key)),
    barrierImpact: (beam, enemyTeam) => {
      const impact = koizumiBarrierBeamImpact(beam, enemyTeam);
      return impact ? {
        x: impact.x, y: impact.y, seat: enemyTeam.seat,
        consume: () => consumeKoizumiBarrierHit(enemyTeam, impact, team.seat),
        present: () => match.spawnKoizumiBarrierImpact({ ...impact, teamSeat: enemyTeam.seat, sourceSeat: team.seat, kind: "beam" }),
      } : null;
    },
    targets: (casterKey, enemyTeam) => {
      const source = team.shipByKey(casterKey);
      return enemyTeam.getAllShips()
        .filter((target) => target.alive && target.isTargetableByFire() && match.rules.canDamage(source, target))
        .map((target) => ({
          x: target.x, y: target.y, radius: target.radius,
          hit: (ratio) => {
            const damage = target.maxHp * ratio;
            const damageImmune = target.isDamageImmune();
            target.takeDamage(damage, source, match, { kind: DAMAGE_KIND.SKILL });
            if (damageImmune) match.spawnFloatingTextKey(target.x + 8, target.y - 10, "免疫", {}, "#ffc5cf");
            else match.spawnFloatingText(target.x + 8, target.y - 10, `-${Math.round(damage)}`, "#ffb7a8");
            spawnBeamHitParticles(match, target.x, target.y);
          },
        }));
    },
    recordAttack: (count) => match.recordAttack(team.seat, "beam", count),
    miss: (x, y) => match.spawnBurst(x, y, "#78dfff", 9),
  };
}
