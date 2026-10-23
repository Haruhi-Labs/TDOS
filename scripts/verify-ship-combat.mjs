import assert from "node:assert/strict";
import { resolveHullDamage } from "../shared/game/systems/hull-damage.js";
import { WeaponCycle } from "../shared/game/systems/weapon-cycle.js";

let hp = 10, multiplier = 1;
const order = [];
resolveHullDamage({
  canDamage: () => true, alive: () => true, immune: () => false,
  attackMultiplier: () => 2, shareRatio: 0.5,
  shareTargets: () => [{ hit(amount, context) {
    assert.equal(amount, 10); assert.equal(context.share, false);
    order.push("分摊"); multiplier = 3;
  } }],
  damageMultiplier: () => multiplier,
  applyDamage: (amount) => { order.push("扣血"); const before = hp; hp = Math.max(0, hp - amount); return before - hp; },
  recordDamage: (loss) => { assert.equal(loss, 10); order.push("记录"); },
  hp: () => hp, retire: () => order.push("退场"),
  resolveFormation: () => order.push("编队"), finishDeath: () => order.push("死亡扩展"),
}, 10);
assert.deepEqual(order, ["分摊", "扣血", "记录", "退场", "编队", "死亡扩展"],
  "分摊副作用应即时影响后续承伤，死亡步骤不得延迟到帧末");

let rolls = 0, launches = 0;
const weapon = new WeaponCycle(1);
const port = {
  alive: () => true, available: () => true, controlLocked: () => false,
  target: () => ({ x: 100, y: 0, angle: 0, speed: 0 }),
  origin: () => ({ x: 0, y: 0, angle: 0 }),
  random: () => { rolls += 1; return 0; }, arcDensity: () => 0,
  prepareDamage: () => 10, projectileProfile: () => ({ color: "#fff" }),
  clampX: (x) => x, clampY: (y) => y,
  launch: () => { launches += 1; }, recordAttack: () => {}, fireRate: () => 2,
};
weapon.fire(port);
assert.equal(rolls, 0, "冷却中不能提前消费瞄准随机数");
weapon.advance(1);
weapon.fire(port);
assert.equal(rolls, 2, "射界拒绝仍保持原先先计算瞄准的随机顺序");
assert.equal(launches, 0);
weapon.fire({ ...port, arcDensity: () => 1 });
assert.equal(launches, 1);
assert.equal(weapon.remaining, 0.5);
assert.throws(() => { weapon.remaining = 0; }, TypeError);
console.log("舰船战斗职责校验通过：独立武器周期、随机消费顺序、受限承伤端口及同步死亡事务。");
