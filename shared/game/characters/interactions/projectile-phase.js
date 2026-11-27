import { distance } from "../../foundation/math.js";
import { consumeKoizumiBarrierHit, koizumiBarrierGeometry, koizumiBarrierProjectileImpact,
  trackKoizumiBarrierProjectileCrossing, updateKoizumiBarrierRecovery } from "../koizumi/barrier.js";
import { haruhiEsperOrb, projectileAbsorptionPoint } from "../haruhi/flagship.js";
import { bunnyTeamSupportSources } from "../bunny-haruhi/support.js";
import { supportOrbGeometry } from "../haruhi/support.js";

const INTERCEPT_TIE_EPSILON = 1e-9;

export function createProjectilePhase(match) {
  // 护盾按阶段采样几何，剩余次数仍即时消费；支援几何按每颗弹体实时查询。
  const teams = match.allTeams();
  const barrierGeometryBySeat = new Map(
    teams.map((team) => [team.seat, koizumiBarrierGeometry(team)]),
  );
  return {
    intercept(projectile, dt) {
      const sourceSeat = projectile?.team?.seat;
      const defendingTeams = sourceSeat ? match.enemyTeamsOf(sourceSeat) : [];
      if (!defendingTeams.length) return false;

      // 保持“护盾先于支援吸收”的既有类型优先级；同类型按沿弹道最早交点选择，等距沿用注册席位顺序。
      let bestBarrier = null;
      for (const defendingTeam of defendingTeams) {
        const barrier = barrierGeometryBySeat.get(defendingTeam.seat);
        const barrierImpact = koizumiBarrierProjectileImpact(projectile, dt, defendingTeam, barrier);
        if (!barrierImpact) continue;
        if (!bestBarrier || barrierImpact.t < bestBarrier.impact.t - INTERCEPT_TIE_EPSILON) {
          bestBarrier = { defendingTeam, impact: barrierImpact };
        }
      }
      const crossingDt = bestBarrier ? dt * bestBarrier.impact.t : dt;
      for (const defendingTeam of defendingTeams) {
        const barrier = barrierGeometryBySeat.get(defendingTeam.seat);
        trackKoizumiBarrierProjectileCrossing(projectile, crossingDt, defendingTeam, barrier);
      }
      if (bestBarrier) {
        const { defendingTeam, impact } = bestBarrier;
        consumeKoizumiBarrierHit(defendingTeam, impact, sourceSeat);
        projectile.discard();
        match.spawnKoizumiBarrierImpact({
          ...impact,
          teamSeat: defendingTeam.seat,
          sourceSeat,
          kind: "projectile",
        });
        return true;
      }

      let bestEsperHit = null;
      let bestEsperDist = Infinity;
      for (const defendingTeam of defendingTeams) {
        const absorbedAt = projectileAbsorptionPoint(projectile, dt, haruhiEsperOrb(defendingTeam));
        if (!absorbedAt) continue;
        const dist = distance(projectile.x, projectile.y, absorbedAt.x, absorbedAt.y);
        if (dist < bestEsperDist - INTERCEPT_TIE_EPSILON) {
          bestEsperDist = dist;
          bestEsperHit = absorbedAt;
        }
      }
      if (bestEsperHit) {
        projectile.discard();
        match.spawnBurst(bestEsperHit.x, bestEsperHit.y, "#ff526f", 6);
        return true;
      }

      if (match.bunnyHaruhiActive) {
        let bestBunnyHit = null;
        let bestBunnyDist = Infinity;
        for (const defendingTeam of defendingTeams) {
          for (const source of bunnyTeamSupportSources(defendingTeam)) {
            const absorbedAt = projectileAbsorptionPoint(projectile, dt, supportOrbGeometry(source));
            if (!absorbedAt) continue;
            const dist = distance(projectile.x, projectile.y, absorbedAt.x, absorbedAt.y);
            if (dist < bestBunnyDist - INTERCEPT_TIE_EPSILON) {
              bestBunnyDist = dist;
              bestBunnyHit = absorbedAt;
            }
          }
        }
        if (bestBunnyHit) {
          projectile.discard();
          match.spawnBurst(bestBunnyHit.x, bestBunnyHit.y, "#ff526f", 6);
          return true;
        }
      }
      return false;
    },
    advance: (projectile, dt) => projectile.update(dt, match),
    finish() {
      // 所有弹体穿越均先重置静默计时，再判定修复；不能逐弹修复。
      for (const team of teams) {
        updateKoizumiBarrierRecovery(team);
      }
    },
  };
}
