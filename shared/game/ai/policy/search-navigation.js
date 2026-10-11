import { distance } from "../../foundation/math.js";
import { freezePlainData } from "../../../data/plain-data.js";

const ORDER = Object.freeze([5, 2, 8, 4, 6, 1, 7, 3, 9]);

// 查询只生成候选；游标推进由显式消费完成，其他策略没有字段写权限。
export class SearchNavigation {
  #state;
  #revision = 0;
  #proposals = new WeakMap();
  constructor(zoneId, now) {
    this.#state = Object.freeze({ zoneId, cursor: 0, sweepSign: 1, advancedAt: now });
  }
  get state() { return this.#state; }
  contact(zoneId) {
    this.#state = Object.freeze({ ...this.#state, zoneId });
    this.#revision += 1;
  }
  #proposal(state, point, zoneId = point.zoneId) {
    const proposal = freezePlainData({ point: { ...point }, zoneId });
    this.#proposals.set(proposal, { state: Object.freeze(state), revision: this.#revision });
    return proposal;
  }
  #center(input) {
    const state = { ...this.#state };
    const { focus, peak, peakZoneId, zones, main, now, arrivalRadius, advanceWindow } = input;
    const center = (id) => {
      const zone = zones.find((item) => item.id === id) || zones[4];
      return { zoneId: zone.id, x: zone.x + zone.width * 0.5, y: zone.y + zone.height * 0.5 };
    };
    if (focus?.visible && focus.zoneId) {
      state.zoneId = focus.zoneId;
      return { state, point: center(focus.zoneId) };
    }
    if (peak) {
      if (peakZoneId) state.zoneId = peakZoneId;
      return { state, point: { zoneId: state.zoneId || 5, x: peak.x, y: peak.y } };
    }
    const advance = () => {
      state.zoneId = ORDER[state.cursor % ORDER.length];
      state.cursor = (state.cursor + 1) % ORDER.length;
    };
    if (!state.zoneId) advance();
    const current = center(state.zoneId);
    if (distance(main.x, main.y, current.x, current.y) <= arrivalRadius || now - state.advancedAt > advanceWindow) {
      advance();
      state.sweepSign *= -1;
      state.advancedAt = now;
    }
    return { state, point: center(state.zoneId) };
  }
  planCenter(input) {
    const { state, point } = this.#center(input);
    return this.#proposal(state, point);
  }
  planScout(input) {
    const { focus, probeZoneId, visibleNoise, recentNoise } = input;
    if (focus?.zoneId && (focus.visible || focus.age <= 12)) {
      const zoneId = focus.visible
        ? (visibleNoise < 0.72 && probeZoneId ? probeZoneId : focus.zoneId)
        : (probeZoneId && recentNoise < 0.92 ? probeZoneId : focus.zoneId);
      const state = { ...this.#state, zoneId: focus.visible ? focus.zoneId : probeZoneId || focus.zoneId };
      return this.#proposal(state, { zoneId }, zoneId);
    }
    return this.planCenter(input);
  }
  consume(proposal) {
    const pending = this.#proposals.get(proposal);
    if (!pending || pending.revision !== this.#revision) throw new Error("搜索候选已失效或不属于本组件");
    this.#proposals.delete(proposal);
    this.#state = pending.state;
    this.#revision += 1;
    return proposal;
  }
}
