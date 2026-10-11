import { createHaruhiHeroPowerEvent, updateHaruhiHeroPowerEvent, serializeHaruhiHeroPowerEvent } from "../haruhi-hero-power.js";
import { nextEntityId } from "../model/model-support.js";

// 角色运行时持有权威事件，编排层只触发阶段和读取独立投影。
export function createHeroPowerRuntime(match) {
  let events = [];
  return Object.freeze({
    enqueue(ship, meta) {
      events.push(createHaruhiHeroPowerEvent({
        id: nextEntityId(match), ship, now: match.elapsed, worldSize: match.worldSize, meta,
      }));
    },
    advance() {
      for (const event of events) event.alive = updateHaruhiHeroPowerEvent(match, event);
      events = events.filter((event) => event.alive);
    },
    inspect() {
      return Object.freeze(events.map((event) => Object.freeze({ ...event,
        hitShipIds: Object.freeze([...event.hitShipIds]),
        destroyedAircraftIds: Object.freeze([...event.destroyedAircraftIds]),
      })));
    },
    serialize: () => events.map(serializeHaruhiHeroPowerEvent),
  });
}
