import assert from "node:assert/strict";
import { HullCollisionSystem } from "../shared/game/systems/collision-system.js";
import { MatchSimulation } from "../shared/game-core.js";

function hull(id, x) {
  return { id, x, y: 0, radius: 10, seat: id, participates: true, attached: false, slows: [],
    displaceTo(x, y) { this.x = x; this.y = y; },
    applyCollisionSlow(until, floor) { this.slows.push([until, floor]); },
  };
}
const system = new HullCollisionSystem();
const a = hull(1, 0), b = hull(2, 10);
const resolve = (elapsed) => system.resolve({ ships: [a, b], elapsed });
resolve(1);
assert.deepEqual(a.slows, [[4, 0.5]]);
assert.equal(b.x - a.x, 20);
b.x = a.x + 10;
resolve(2);
assert.equal(a.slows.length, 1, "持续重叠不得每帧续上减速");
b.x = a.x + 49;
resolve(3);
b.x = a.x + 10;
resolve(4);
assert.equal(a.slows.length, 1, "分开但未越过释放余量时保留历史");
b.x = a.x + 50;
resolve(5);
b.x = a.x + 10;
resolve(6);
assert.deepEqual(a.slows, [[4, 0.5], [9, 0.5]], "越过释放边界后重新碰撞才施加减速");
system.resolve({ ships: [a], elapsed: 7 });
b.x = a.x + 10;
resolve(8);
assert.equal(a.slows.length, 3, "目标退出后清理历史，不遗留编号占用");
const other = new HullCollisionSystem();
b.x = a.x + 10;
other.resolve({ ships: [a, b], elapsed: 9 });
assert.equal(a.slows.length, 4, "不同对局的历史不得串用");
assert.equal(system.contacts, undefined);
assert.equal(new MatchSimulation({ seed: 3 })._contactPairs, undefined);
console.log("碰撞历史校验通过：持续接触、释放迟滞、离场清理和对局隔离。");
