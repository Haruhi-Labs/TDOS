import { cleanupBunnyCompanions } from "../bunny-companion-runtime.js";
import { resolveShamisenHuntKill } from "../shamisen-hunt.js";

// 死亡扩展在当前承伤调用内完成，不能延后到表现消费或下一逻辑帧。
export function resolveShipDestruction(match, ship, feedback) {
  if (!ship) return;
  if (match.bunnyHaruhiActive) cleanupBunnyCompanions(match);
  for (const [hunter, huntedTeam] of [[match.teamA, match.teamB], [match.teamB, match.teamA]]) {
    if (hunter.shamisenHunt?.targetId !== ship.id) continue;
    feedback.huntKill(hunter.seat, ship);
    resolveShamisenHuntKill(hunter, huntedTeam, ship, match.rng.next);
  }
}
