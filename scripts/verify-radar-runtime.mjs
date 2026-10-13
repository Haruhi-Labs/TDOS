import assert from "node:assert/strict";
import { RadarRuntime } from "../shared/game/characters/yuki/radar-runtime.js";
import { freezePlainData } from "../shared/data/plain-data.js";

// 不构造实体、舰队或对局，直接验证扫描输入输出与状态生命周期。
const source = { x: 200, y: 400 };
const hidden = { id: 11, x: 500, y: 400, angle: 0.5, characterId: "kyon", alive: true, visible: false };
const visible = { ...hidden, id: 12, visible: true };
const sample = freezePlainData({ source, targets: [visible, hidden], now: 2.2, tick: 66, worldSize: 1440 });
const runtime = new RadarRuntime(0);
const revealed = runtime.advance(sample, 2.2);
assert.deepEqual(revealed, [12], "运行时只输出被扫过且真正可见的目标编号");
const history = runtime.snapshot(1, 2.2);
assert.deepEqual(history.contacts.map((contact) => contact.targetId), [11]);
assert.equal(history.contacts[0].kind, "afterimage");
assert.equal(history.contacts[0].characterId, "kyon");
assert.equal(Object.hasOwn(runtime.sweep(1, 2.2), "contacts"), false, "公开扫线不得携带私有回波");
assert.equal(runtime.snapshot(null, 2.2), null, "无有效来源时不发布雷达");
assert.deepEqual(runtime.snapshot(1, 2.2), history, "查询不得推进扫描或清理回波");

const withoutVisible = new RadarRuntime(0);
withoutVisible.advance({ ...sample, targets: [hidden] }, 2.2);
assert.deepEqual(withoutVisible.snapshot(1, 2.2).contacts, history.contacts, "可见目标不得消耗隐藏回波的噪声序号");
revealed.push(11);
const modified = runtime.snapshot(1, 2.2);
modified.contacts[0].x = -1;
modified.contacts.length = 0;
assert.deepEqual(runtime.snapshot(1, 2.2), history, "输出结果和快照不得成为内部状态的写入口");

const input = structuredClone(sample);
const isolated = new RadarRuntime(0);
isolated.advance(input, 2.2);
input.targets[1].x = -100;
input.source.x = -100;
input.targets.length = 0;
assert.deepEqual(isolated.snapshot(1, 2.2), history, "扫描完成后不保留输入对象的可变引用");

// 目标即便未被当前扫线再次扫过，也要按真实可见性、死亡或退出成员集合清理旧回波。
for (const targets of [[{ ...hidden, visible: true }], [{ ...hidden, alive: false }], []]) {
  const radar = new RadarRuntime(0);
  radar.advance({ ...sample, targets: [hidden] }, 2.2);
  radar.advance({ ...sample, targets, now: 2.3, tick: 69 }, 0);
  assert.deepEqual(radar.snapshot(1, 2.3).contacts, []);
}
const expiresAt = history.contacts[0].expiresAt;
runtime.advance({ ...sample, now: expiresAt, tick: 180 }, 0);
assert.deepEqual(runtime.snapshot(1, expiresAt).contacts, [], "回波在到期边界清理");
assert.equal(history.contacts.length, 1, "历史快照不跟随清理变化");

const stopped = new RadarRuntime(0);
stopped.advance(sample, 2.2);
const oldAngle = stopped.sweep(1, 2.2).angle;
assert.deepEqual(stopped.advance({ ...sample, source: null, now: 3 }, 0.8), []);
assert.deepEqual(stopped.snapshot(1, 3).contacts, []);
assert.equal(stopped.sweep(1, 3).angle, oldAngle, "无来源时只清回波，不重置扫描相位");
stopped.advance({ ...sample, now: 4.4, tick: 132 }, 2.2);
const continuous = new RadarRuntime(0);
continuous.advance(sample, 2.2);
continuous.advance({ ...sample, now: 4.4, tick: 132 }, 2.2);
assert.deepEqual(stopped.snapshot(1, 4.4), continuous.snapshot(1, 4.4), "停用不能重置隐藏扫描序号");

console.log("雷达运行时校验通过：纯数据输入、编号输出、噪声序号、过期清理与输入输出引用隔离。");
