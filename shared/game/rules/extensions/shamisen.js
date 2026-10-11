import { shamisenHuntDamageMultiplier } from "../../shamisen-hunt.js";
import { initializeClawMarks, clearClawMarks, activeClawMarks, expireClawMarks, registerClawHit } from "../../shamisen-claw.js";
import { initializeShamisenHunt, ensureShamisenHuntTarget, serializeShamisenHunt } from "../../shamisen-hunt.js";
import { rngFor } from "../../rng.js";
export default {
  queries: {
    fireRate: [[10, (value, ship) => ship.characterId === "shamisen" && ship.hasEffect("catPawUntil") ? value * Math.max(0.01, Number(ship.character.subSkill.fireRateMultiplier) || 1) : value]],
  },
  rules: {
    activeClawMarks,
    projectileProfile(ship) {
      const meta = ship.characterId === "shamisen" && ship.hasEffect("catPawUntil") ? ship.character.subSkill : null;
      return {
        color: meta ? (ship.team.seat === "A" ? "#8fe8ff" : "#ff9eb8") : ship.team.projectileColor,
        visualKind: meta ? "cat_paw" : "shell",
        claw: meta ? { triggerHits: meta.triggerHits || 4, burstDamage: meta.burstDamage || 0, markDuration: meta.markDuration || 8 } : null,
      };
    },
    preferredTargetId(team) {
      return team.shamisenHunt?.targetId;
    },
    // 攻击来源修正先于编队分摊；分摊投递不得再次调用。
    attackDamageMultiplier: shamisenHuntDamageMultiplier,
  },
  id: "shamisen",
  ship: { hooks: {
    initialize: [[30, initializeClawMarks]], clearNegative: [[10, clearClawMarks]], expireMarks: [[10, expireClawMarks]], registerClawHit: [[10, registerClawHit]],
    hasNegative: [[30, (ship) => activeClawMarks(ship).stacks > 0]],
    onProjectileHit: [[10, (projectile, target, match) => {
      if (projectile.claw && target.kind === "ship" && target.alive) registerClawHit(target, { ...projectile.claw, sourceSeat: projectile.team.seat, color: projectile.color }, match, projectile.source);
    }]],
  } },
  createTeam(team) { initializeShamisenHunt(team); return {}; },
  createBattle(match) {
    const hunt = () => {
      ensureShamisenHuntTarget(match.teamA, match.teamB, rngFor(match).next);
      ensureShamisenHuntTarget(match.teamB, match.teamA, rngFor(match).next);
    };
    return { initialize: [[20, hunt]], operations: { hunts: { phases: { beforeAi: 30 }, run: hunt } } };
  },
  projectShip(ship) {
    const marks = ship.activeClawMarks();
    return { catPawVolley: ship.hasEffect("catPawUntil"), clawMarks: { sourceSeat: marks.sourceSeat, stacks: marks.stacks, required: marks.required, expiresIn: Math.max(0, marks.expiresAt - ship.team.match.elapsed), color: marks.color } };
  },
  projectTeam: (team) => ({ shamisenHunt: serializeShamisenHunt(team) }),
};
