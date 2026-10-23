import { readonlyIdSet } from "../../../data/readonly-id-set.js";

// 索引仅由本对象持有；消费者不能修改缓存，也不能取得内部 Map。
export class ObservationView {
  #observation;
  #ships;
  #byId;
  #visible;

  #refresh(observation) {
    if (this.#observation === observation) return;
    const self = observation.self;
    this.#ships = Object.freeze([self.ships.main, self.ships.sub1, self.ships.sub2, ...self.extraShips]);
    this.#byId = new Map(this.#ships.map((ship) => [ship.id, ship]));
    this.#visible = readonlyIdSet(observation.enemy.visible.map((entity) => entity.id));
    this.#observation = observation;
  }

  ships(observation) { this.#refresh(observation); return this.#ships; }
  ship(observation, id) { this.#refresh(observation); return this.#byId.get(id) || null; }
  visible(observation) { this.#refresh(observation); return this.#visible; }
}
