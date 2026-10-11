import { SHAMISEN_HUNT_KILL_EFFECT_SECONDS } from "../shamisen-hunt.js";
import { KOIZUMI_BARRIER_PROJECTILE_IMPACT_INTERVAL } from "../model/model-support.js";

function advanceEffects(effects, dt) {
  for (const effect of effects) effect.life -= dt;
  return effects.filter((effect) => effect.life > 0);
}

const inspect = (effects) => Object.freeze(effects.map((effect) => Object.freeze({ ...effect })));
const serialize = (effects) => effects.map((effect) => ({ ...effect }));

// 这里只拥有表现记录和限频时钟，不扣护盾次数、不选择猎杀目标，也不推进战斗规则。
export function createMatchFeedback(port) {
  const { now, nextId } = port;
  let huntKills = [];
  let barrierImpacts = [];
  const barrierNextAt = { A: 0, B: 0 };
  return Object.freeze({
    huntKill(hunterSeat, target) {
      const id = nextId();
      huntKills.push({
        id, hunterSeat, targetId: target.id, x: target.x, y: target.y,
        radius: Math.max(10, Number(target.radius) || 10), seed: id * 0.61803398875,
        life: SHAMISEN_HUNT_KILL_EFFECT_SECONDS, maxLife: SHAMISEN_HUNT_KILL_EFFECT_SECONDS,
      });
    },
    barrierImpact(options = {}) {
      const kind = options.kind || "projectile";
      const teamSeat = options.teamSeat || null;
      if (kind === "projectile" && teamSeat) {
        const nextAt = Number(barrierNextAt[teamSeat]) || 0;
        if (now() + 1e-9 < nextAt) return false;
        barrierNextAt[teamSeat] = now() + KOIZUMI_BARRIER_PROJECTILE_IMPACT_INTERVAL;
      }
      const maxLife = kind === "ram" || kind === "break" ? 1.35 : kind === "beam" ? 0.9 : 0.62;
      barrierImpacts.push({
        id: nextId(), kind, ramKind: options.ramKind || null, teamSeat, sourceSeat: options.sourceSeat || null,
        x: Number(options.x) || 0, y: Number(options.y) || 0,
        centerX: Number(options.centerX) || 0, centerY: Number(options.centerY) || 0,
        radius: Math.max(1, Number(options.radius) || 1), angle: Number(options.angle) || 0,
        normalX: Number(options.normalX) || 0, normalY: Number(options.normalY) || 0,
        life: maxLife, maxLife,
      });
      return true;
    },
    advance(dt) {
      huntKills = advanceEffects(huntKills, dt);
      barrierImpacts = advanceEffects(barrierImpacts, dt);
    },
    inspectHuntKills: () => inspect(huntKills),
    inspectBarrierImpacts: () => inspect(barrierImpacts),
    serializeHuntKills: () => serialize(huntKills),
    serializeBarrierImpacts: () => serialize(barrierImpacts),
  });
}
