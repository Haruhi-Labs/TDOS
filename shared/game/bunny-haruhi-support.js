import { BUNNY_HARUHI_CONFIG } from "./bunny-haruhi-config.js";
import { HARUHI_TIME_TRAVELER_INTERVAL, tickSupportSource, unlockSupport } from "./haruhi-support.js";

/**
 * 显式副舰来源适配。拒绝主舰、普通春日、额外实体和未初始化状态。
 * enabled由权威调用者传入（通常为!team.areSkillsDisabled()）；沉默不停止常驻支援。
 * 描述符可每阶段重建；封印历史保存在新角色独占的support.suspended中。
 */
export function bunnyHaruhiSupportSource(ship, enabled) {
  if (ship?.characterId !== BUNNY_HARUHI_CONFIG.characterId
    || !["sub1", "sub2"].includes(ship.slotKey)
    || ship.team?.ships?.[ship.slotKey] !== ship
    || !ship.bunnyHaruhi?.support) return null;
  return { sourceShip: ship, state: ship.bunnyHaruhi.support, enabled: Boolean(enabled) };
}

/** 仅新角色对局调用；固定ID次序使多来源消耗与几何判定可回放。 */
export function bunnyTeamSupportSources(team) {
  return [team.ships.sub1, team.ships.sub2]
    .map((ship) => bunnyHaruhiSupportSource(ship, !team.areSkillsDisabled()))
    .filter(Boolean).sort((a, b) => a.sourceShip.id - b.sourceShip.id);
}

/** 只由成功形态事务调用；穷尽三项池后不再消费随机数。 */
export function unlockBunnyHaruhiSupport(source, now, random) {
  if (!source?.enabled || !source.sourceShip?.alive) return null;
  return unlockSupport(source.state, BUNNY_HARUHI_CONFIG.supportIds, now, random);
}

/** 由Team.update显式传入副舰来源，不改变旧旗舰的支援调度。 */
export function updateBunnyHaruhiSupport(source, now, dt, hooks = {}) {
  if (!source) return;
  const { state } = source;
  if (!source.enabled || !source.sourceShip?.alive) {
    state.suspended = true;
    tickSupportSource(source, now, dt, hooks);
    return;
  }
  if (state.suspended) {
    // 只重排定期发射，不返还碰撞冷却，不补发封印期间的光线。
    state.timeTravelerNextAt = state.supporters.has("time_traveler")
      ? now + HARUHI_TIME_TRAVELER_INTERVAL : 0;
    state.queuedBeamAt.length = 0;
    delete state.suspended;
  }
  tickSupportSource(source, now, dt, hooks);
}
