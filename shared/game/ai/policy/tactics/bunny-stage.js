import { BUNNY_HARUHI_CONFIG as C } from "./bunny-haruhi-config.js";
import { observeOwnShip } from "./ai/bridge/observation.js";
import { distance } from "./math.js";

// 兼容直接传入实时舰船的调用方：先换成观测数据，决策只读取观测。
function observed(ship) {
  return typeof ship?.isAttached === "function" ? observeOwnShip(ship) : ship;
}

// 只消费本舰的观测状态和 Bot 已取得的情报；不查询敌方实体或额外抽取随机数。
export function shouldTransformBunny(liveOrObservedShip, estimate, context = {}) {
  const ship = observed(liveOrObservedShip);
  const state = ship.bunny;
  if (!state || state.transformBlocked) return false;
  const hp = ship.hp / ship.maxHp;
  const energy = ship.energy / ship.maxEnergy;
  const contact = estimate && estimate.source !== "spawn"
    && (estimate.visible || estimate.age <= 3);
  const fighting = contact && distance(ship.x, ship.y, estimate.x, estimate.y) <= ship.stats.range * 1.25;
  const threatened = contact && distance(ship.x, ship.y, estimate.x, estimate.y) <= ship.stats.vision * 1.4;
  const next = state.nextForm;
  if (next === "encore") return Boolean(fighting || hp < 0.8 || !state.companionSpawned);
  if (next === "bless") {
    // 支付后还要有撤退余量；保留健康的激奏与伴随舰，避免为微小收益重付生命。
    if (state.form === "encore" && state.companionAlive && hp >= 0.55 && energy >= 0.25) return false;
    return Boolean(hp > C.bless.hpCostRatio + 0.2 && (fighting || (state.form === "knows" && energy < 0.3)));
  }
  // 低血/低能量时用短暂免伤争取撤退；健康时为首次激奏推进，但击杀窗口保留攻击形态。
  return Boolean(fighting && (
    (threatened && (hp < 0.48 || energy < 0.2))
    || (!state.companionSpawned && hp >= 0.6 && !context?.killWindow)
    || state.positiveSuppressed
  ));
}

export function bunnyStageRoute(liveOrObservedShip, target, estimate, now) {
  const ship = observed(liveOrObservedShip);
  const ownStage = ship.key === "main" && ship.characterId === C.characterId && !ship.teamSkillsDisabled;
  const known = estimate && estimate.source !== "spawn" && (estimate.visible || estimate.age <= 3);
  if (!known) return target;
  const hp = ship.hp / ship.maxHp;
  const dx = ship.x - estimate.x;
  const dy = ship.y - estimate.y;
  const length = Math.hypot(dx, dy);
  const ux = length > 0 ? dx / length : 1;
  const uy = length > 0 ? dy / length : 0;
  if (estimate.bunnyStageRadius > 0) {
    const exposure = ship.stageExposure;
    const staying = exposure?.inside && hp >= 0.65
      && (exposure.phase === "entranced" || now - exposure.enteredAt >= C.stage.entranceSeconds - 3);
    const radius = estimate.bunnyStageRadius + ship.radius + 32;
    if (!staying && distance(target.x, target.y, estimate.x, estimate.y) < radius) {
      return { x: estimate.x + ux * radius, y: estimate.y + uy * radius };
    }
  }
  if (ownStage && hp >= 0.55 && length <= ship.stats.vision * 1.7) {
    // 仅在敌舰已经接近时迎击；不为制造舞台接触而全图追逐、持续暴露己方编队。
    // 可见目标已入迷时主动拉开，停止给敌方持续增益；离开视野后不追读其状态。
    const range = ship.stats.vision * (estimate.bunnyStagePhase === "entranced" ? 1.25 : 0.8);
    return { x: estimate.x + ux * range, y: estimate.y + uy * range };
  }
  return target;
}
