// 观测访问助手：己方舰船索引、编队能量池、可见敌方编号与世界边界钳制。
// 这些方法安装在 RulePolicy 的原型上，经 this 访问观测、参数、随机流与策略状态。
import { clamp } from "../../math.js";

export const viewMethods = {
  indexObservation() {
    const obs = this.obs;
    if (this.indexedObservation !== obs) {
      this.indexedObservation = obs;
      const self = obs.self;
      const ships = [self.ships.main, self.ships.sub1, self.ships.sub2, ...self.extraShips];
      this.observationIndex = {
        ships,
        shipById: new Map(ships.map((ship) => [ship.id, ship])),
        visibleIds: new Set(obs.enemy.visible.map((entity) => entity.id)),
      };
    }
    return this.observationIndex;
  },

  ownShips() {
    return this.indexObservation().ships;
  },

  ownShipById(id) {
    return this.indexObservation().shipById.get(id) || null;
  },

  get visibleIds() {
    return this.indexObservation().visibleIds;
  },

  ownShip(shipOrKey) {
    if (typeof shipOrKey === "string") {
      return this.obs.self.ships[shipOrKey] || this.ownShips().find((ship) => ship.key === shipOrKey) || null;
    }
    return shipOrKey ? this.ownShipById(shipOrKey.id) : null;
  },

  fleetMembers(shipOrKey) {
    const ship = this.ownShip(shipOrKey);
    return ship ? ship.fleet.memberIds.map((id) => this.ownShipById(id)).filter(Boolean) : [];
  },

  fleetEnergy(shipOrKey) {
    const ship = this.ownShip(shipOrKey);
    return ship ? { current: ship.fleet.energy, max: ship.fleet.maxEnergy } : { current: 0, max: 0 };
  },

  hasEffect(ship, effectKey) {
    return Number(ship?.effects?.[effectKey] || 0) > this.obs.time;
  },

  clampX(x, padding = 0) {
    return clamp(x, padding, this.obs.world.size - padding);
  },

  clampY(y, padding = 0) {
    return clamp(y, padding, this.obs.world.size - padding);
  },

  zoneById(zoneId) {
    const safeId = clamp(Number(zoneId) || 5, 1, 9);
    return this.obs.world.zones.find((zone) => zone.id === safeId) || this.obs.world.zones[4];
  },
};
