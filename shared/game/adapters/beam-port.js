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

const BEAM_BARRIER_TIE_EPSILON = 1e-9;

export function createTeamBeamPort(team) {
  const { match } = team;
  return {
    nextId: () => nextEntityId(match),
    clampX: (x) => match.clampX(x, 0),
    clampY: (y) => match.clampY(y, 0),
    caster: (key) => beamCasterState(team.shipByKey(key)),
    barrierImpact: (beam) => {
      // 多个敌对护盾存在交点时，沿射线最先命中优先；等距保持开局注册席位顺序。
      let best = null;
      for (const defendingTeam of match.enemyTeamsOf(team.seat)) {
        const impact = koizumiBarrierBeamImpact(beam, defendingTeam);
        if (!impact) continue;
        if (!best || impact.t < best.impact.t - BEAM_BARRIER_TIE_EPSILON) {
          best = { defendingTeam, impact };
        }
      }
      if (!best) return null;
      const { defendingTeam, impact } = best;
      return {
        x: impact.x, y: impact.y, seat: defendingTeam.seat,
        consume: () => consumeKoizumiBarrierHit(defendingTeam, impact, team.seat),
        present: () => match.spawnKoizumiBarrierImpact({ ...impact, teamSeat: defendingTeam.seat, sourceSeat: team.seat, kind: "beam" }),
      };
    },
    targets: (casterKey, enemyTeam) => {
      const source = team.shipByKey(casterKey);
      const seenIds = new Set();
      const targets = [];
      for (const target of enemyTeam.getAllShips()) {
        if (!target.alive || seenIds.has(target.id)) continue;
        seenIds.add(target.id);
        if (!target.isTargetableByFire() || !match.rules.canDamage(source, target)) continue;
        targets.push(Object.freeze({
          id: target.id,
          x: target.x,
          y: target.y,
          radius: target.radius,
          hit: (ratio) => {
            const damage = target.maxHp * ratio;
            const damageImmune = target.isDamageImmune();
            target.takeDamage(damage, source, match, { kind: DAMAGE_KIND.SKILL });
            if (damageImmune) match.spawnFloatingTextKey(target.x + 8, target.y - 10, "免疫", {}, "#ffc5cf");
            else match.spawnFloatingText(target.x + 8, target.y - 10, `-${Math.round(damage)}`, "#ffb7a8");
            spawnBeamHitParticles(match, target.x, target.y);
          },
        }));
      }
      return targets;
    },
    recordAttack: (count) => match.recordAttack(team.seat, "beam", count),
    miss: (x, y) => match.spawnBurst(x, y, "#78dfff", 9),
  };
}
