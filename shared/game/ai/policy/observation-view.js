import { readonlyIdSet } from "../../../data/readonly-id-set.js";

const EMPTY_LIST = Object.freeze([]);
const EMPTY_HOSTILE_EFFECTS = Object.freeze({
  visibleTeamBuffs: EMPTY_LIST,
  visionWaves: EMPTY_LIST,
  huntedBy: EMPTY_LIST,
  huntMarks: EMPTY_LIST,
  radarContacts: EMPTY_LIST,
  projectiles: EMPTY_LIST,
});

function extractVisibleHostiles(observation) {
  if (Array.isArray(observation?.visibleHostiles)) {
    return observation.visibleHostiles;
  }
  return Array.isArray(observation?.enemy?.visible) ? observation.enemy.visible : EMPTY_LIST;
}

function extractHostileEffects(observation) {
  if (observation?.hostileEffects && typeof observation.hostileEffects === "object") {
    return observation.hostileEffects;
  }
  const enemy = observation?.enemy;
  if (!enemy || typeof enemy !== "object") {
    return EMPTY_HOSTILE_EFFECTS;
  }
  return Object.freeze({
    visibleTeamBuffs: enemy.visibleTeamBuffs ? Object.freeze([enemy.visibleTeamBuffs]) : EMPTY_LIST,
    visionWaves: enemy.visionWave ? Object.freeze([enemy.visionWave]) : EMPTY_LIST,
    huntedBy: observation.self?.hunted ? Object.freeze([observation.self.hunted]) : EMPTY_LIST,
    huntMarks: observation.self?.hunt ? Object.freeze([observation.self.hunt]) : EMPTY_LIST,
    radarContacts: Array.isArray(observation.self?.radar?.contacts) ? observation.self.radar.contacts : EMPTY_LIST,
    projectiles: Array.isArray(enemy.projectiles) ? enemy.projectiles : EMPTY_LIST,
  });
}

// 索引仅由本对象持有；消费者不能修改缓存，也不能取得内部 Map。
export class ObservationView {
  #observation;
  #ships;
  #byId;
  #visible;
  #visibleHostiles;
  #visibleBySourceSeat;
  #hostileSourceSeats;
  #hostileEffects;

  #refresh(observation) {
    if (this.#observation === observation) return;
    const self = observation.self;
    this.#ships = Object.freeze([self.ships.main, self.ships.sub1, self.ships.sub2, ...(self.extraShips || EMPTY_LIST)]);
    this.#byId = new Map(this.#ships.map((ship) => [ship.id, ship]));

    const visibleEntities = extractVisibleHostiles(observation);
    this.#visible = readonlyIdSet(visibleEntities.map((entity) => entity.id));
    this.#visibleHostiles = Object.freeze([...visibleEntities]);

    const grouped = new Map();
    const sourceOrder = [];
    const seenSources = new Set();
    const recordSource = (seat) => {
      if (typeof seat !== "string" || seat.length === 0 || seenSources.has(seat)) return;
      seenSources.add(seat);
      sourceOrder.push(seat);
    };

    for (const entity of visibleEntities) {
      if (typeof entity?.sourceSeat !== "string" || entity.sourceSeat.length === 0) continue;
      recordSource(entity.sourceSeat);
      let bucket = grouped.get(entity.sourceSeat);
      if (!bucket) {
        bucket = [];
        grouped.set(entity.sourceSeat, bucket);
      }
      bucket.push(entity);
    }

    const effects = extractHostileEffects(observation);
    this.#hostileEffects = effects;
    for (const list of [
      effects.visibleTeamBuffs,
      effects.visionWaves,
      effects.huntedBy,
      effects.projectiles,
    ]) {
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        recordSource(item?.sourceSeat);
      }
    }

    const frozenBySourceSeat = new Map();
    for (const [seat, bucket] of grouped.entries()) {
      frozenBySourceSeat.set(seat, Object.freeze(bucket));
    }
    this.#visibleBySourceSeat = frozenBySourceSeat;
    this.#hostileSourceSeats = Object.freeze(sourceOrder);
    this.#observation = observation;
  }

  ships(observation) { this.#refresh(observation); return this.#ships; }
  ship(observation, id) { this.#refresh(observation); return this.#byId.get(id) || null; }
  visible(observation) { this.#refresh(observation); return this.#visible; }
  visibleHostiles(observation) { this.#refresh(observation); return this.#visibleHostiles; }
  visibleHostilesBySeat(observation, sourceSeat) {
    this.#refresh(observation);
    if (typeof sourceSeat !== "string" || !this.#visibleBySourceSeat.has(sourceSeat)) {
      return EMPTY_LIST;
    }
    return this.#visibleBySourceSeat.get(sourceSeat);
  }
  hostileSourceSeats(observation) { this.#refresh(observation); return this.#hostileSourceSeats; }
  hostileEffects(observation) { this.#refresh(observation); return this.#hostileEffects; }
}
