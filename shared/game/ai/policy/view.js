// 观测访问助手：己方舰船索引、编队能量池、可见敌方编号与世界边界钳制。
// 每个算法显式声明事实和查询输入；执行算法按需重读动作后的事实。
import { clamp } from "../../math.js";

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
