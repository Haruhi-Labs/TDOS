import { distance } from "../../foundation/math.js";
import { consumeKoizumiBarrierHit, koizumiBarrierGeometry, koizumiBarrierProjectileImpact,
  trackKoizumiBarrierProjectileCrossing, updateKoizumiBarrierRecovery } from "../koizumi/barrier.js";
import { haruhiEsperOrb, projectileAbsorptionPoint } from "../haruhi/flagship.js";
import { bunnyTeamSupportSources } from "../bunny-haruhi/support.js";
import { supportOrbGeometry } from "../haruhi/support.js";

export function createProjectilePhase(match) {
  // 护盾按阶段采样几何，剩余次数仍即时消费；支援几何按每颗弹体实时查询。
  const barrierGeometryBySeat = {
    A: koizumiBarrierGeometry(match.teamA),
    B: koizumiBarrierGeometry(match.teamB),
  };
  return {
    intercept(projectile, dt) {
      const defendingTeam = match.enemyTeamBySeat(projectile.team.seat);
      const barrier = barrierGeometryBySeat[defendingTeam.seat];
      trackKoizumiBarrierProjectileCrossing(projectile, dt, defendingTeam, barrier);
      const barrierImpact = koizumiBarrierProjectileImpact(projectile, dt, defendingTeam, barrier);
      if (barrierImpact) {
        consumeKoizumiBarrierHit(defendingTeam, barrierImpact, projectile.team.seat);
        projectile.discard();
        match.spawnKoizumiBarrierImpact({ ...barrierImpact, teamSeat: defendingTeam.seat,
          sourceSeat: projectile.team.seat, kind: "projectile" });
        return true;
      }
      const absorbedAt = projectileAbsorptionPoint(projectile, dt, haruhiEsperOrb(defendingTeam));
      if (absorbedAt) {
        projectile.discard();
        match.spawnBurst(absorbedAt.x, absorbedAt.y, "#ff526f", 6);
        return true;
      }
      if (match.bunnyHaruhiActive) {
        const hit = bunnyTeamSupportSources(defendingTeam)
          .map((source) => projectileAbsorptionPoint(projectile, dt, supportOrbGeometry(source)))
          .filter(Boolean)
          .sort((a, b) => distance(projectile.x, projectile.y, a.x, a.y) - distance(projectile.x, projectile.y, b.x, b.y))[0];
        if (hit) {
          projectile.discard();
          match.spawnBurst(hit.x, hit.y, "#ff526f", 6);
          return true;
        }
      }
      return false;
    },
    advance: (projectile, dt) => projectile.update(dt, match),
    finish() {
      // 所有弹体穿越均先重置静默计时，再判定修复；不能逐弹修复。
      updateKoizumiBarrierRecovery(match.teamA);
      updateKoizumiBarrierRecovery(match.teamB);
    },
  };
}
