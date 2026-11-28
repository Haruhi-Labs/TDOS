// 观测访问助手：己方舰船索引、编队能量池、多来源敌对只读查询与世界边界钳制。
// 每个算法显式声明事实和查询输入；执行算法按需重读动作后的事实。
import { clamp } from "../../foundation/math.js";

const EMPTY_LIST = Object.freeze([]);
const EMPTY_HOSTILE_EFFECTS = Object.freeze({
  visibleTeamBuffs: EMPTY_LIST,
  visionWaves: EMPTY_LIST,
  huntedBy: EMPTY_LIST,
  huntMarks: EMPTY_LIST,
  radarContacts: EMPTY_LIST,
  projectiles: EMPTY_LIST,
});

export const viewMethods = {
  ownShip({ obs: policyObs, ownShips: capOwnShips, ownShipById: capOwnShipById }, shipOrKey) {
    if (typeof shipOrKey === "string") {
      return policyObs.self.ships[shipOrKey] || capOwnShips().find((ship) => ship.key === shipOrKey) || null;
    }
    return shipOrKey ? capOwnShipById(shipOrKey.id) : null;
  },

  fleetMembers({ ownShip: capOwnShip, ownShipById: capOwnShipById }, shipOrKey) {
    const ship = capOwnShip(shipOrKey);
    return ship ? ship.fleet.memberIds.map((id) => capOwnShipById(id)).filter(Boolean) : [];
  },

  fleetEnergy({ ownShip: capOwnShip }, shipOrKey) {
    const ship = capOwnShip(shipOrKey);
    return ship ? { current: ship.fleet.energy, max: ship.fleet.maxEnergy } : { current: 0, max: 0 };
  },

  visibleHostiles({ obs: policyObs }) {
    if (Array.isArray(policyObs?.visibleHostiles)) {
      return policyObs.visibleHostiles;
    }
    return Array.isArray(policyObs?.enemy?.visible) ? policyObs.enemy.visible : EMPTY_LIST;
  },

  visibleHostilesBySeat({ obs: policyObs }, sourceSeat) {
    if (typeof sourceSeat !== "string" || sourceSeat.length === 0) {
      return EMPTY_LIST;
    }
    const list = Array.isArray(policyObs?.visibleHostiles)
      ? policyObs.visibleHostiles
      : Array.isArray(policyObs?.enemy?.visible) ? policyObs.enemy.visible : EMPTY_LIST;
    return Object.freeze(list.filter((entity) => entity?.sourceSeat === sourceSeat));
  },

  hostileEffects({ obs: policyObs }) {
    if (policyObs?.hostileEffects && typeof policyObs.hostileEffects === "object") {
      return policyObs.hostileEffects;
    }
    const enemy = policyObs?.enemy;
    if (!enemy || typeof enemy !== "object") {
      return EMPTY_HOSTILE_EFFECTS;
    }
    return Object.freeze({
      visibleTeamBuffs: enemy.visibleTeamBuffs ? Object.freeze([enemy.visibleTeamBuffs]) : EMPTY_LIST,
      visionWaves: enemy.visionWave ? Object.freeze([enemy.visionWave]) : EMPTY_LIST,
      huntedBy: policyObs.self?.hunted ? Object.freeze([policyObs.self.hunted]) : EMPTY_LIST,
      huntMarks: policyObs.self?.hunt ? Object.freeze([policyObs.self.hunt]) : EMPTY_LIST,
      radarContacts: Array.isArray(policyObs.self?.radar?.contacts) ? policyObs.self.radar.contacts : EMPTY_LIST,
      projectiles: Array.isArray(enemy.projectiles) ? enemy.projectiles : EMPTY_LIST,
    });
  },

  hasEffect({ obs: policyObs }, ship, effectKey) {
    return Number(ship?.effects?.[effectKey] || 0) > policyObs.time;
  },

  clampX({ obs: policyObs }, x, padding = 0) {
    return clamp(x, padding, policyObs.world.size - padding);
  },

  clampY({ obs: policyObs }, y, padding = 0) {
    return clamp(y, padding, policyObs.world.size - padding);
  },

  zoneById({ obs: policyObs }, zoneId) {
    const safeId = clamp(Number(zoneId) || 5, 1, 9);
    return policyObs.world.zones.find((zone) => zone.id === safeId) || policyObs.world.zones[4];
  },
};
