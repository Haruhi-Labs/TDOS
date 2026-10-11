import assert from "node:assert/strict";
import { BunnyStageRuntime } from "../shared/game/characters/bunny-haruhi/stage-runtime.js";
let now = 0, valid = true;
const calls = [];
const runtime = new BunnyStageRuntime({
  seats: ["A", "B"], now: () => now, tick: () => now * 30,
  sampleStages: () => { calls.push("双方采样"); return [{ seat: "A", own: undefined, enemy: { sourceShipId: 2, x: 0, y: 0, radius: 10 } }, { seat: "B", own: null, enemy: null }]; },
  receivers: (seat) => seat === "A" ? [{ id: 1, alive: true, x: 0, y: 0, maxHp: 100 }] : [],
  sourceValid: () => valid, stageActive: () => false,
  resources: () => ({ hp: 50, maxHp: 100 }),
  heal: (id, amount) => calls.push(["治疗", id, amount]),
  stopIfVulnerable: (id) => calls.push(["停船", id]),
  sustainForm: (id, from, to) => calls.push(["形态区间", id, from, to]),
  cleanupForm: () => {},
});
runtime.resolve();
assert.equal(calls[0], "双方采样");
const history = runtime.exposure(1);
assert.ok(Object.isFrozen(history));
assert.equal(history.inside, true);
now = 1;
runtime.advance();
runtime.advance();
assert.equal(calls.filter((x) => x[0] === "形态区间").length, 1);
valid = false;
runtime.cleanup();
assert.equal(runtime.exposure(1).inside, false);
assert.equal(history.inside, true);
console.log("舞台运行时通过：无实体输入、受限命令、区间一次消费与历史隔离");

const { BunnyFormRuntime } = await import("../shared/game/characters/bunny-haruhi/form-runtime.js");
const steps = [];
let support;
const form = new BunnyFormRuntime({
  now: () => 10, tick: () => 300, alive: () => true, enabled: () => true,
  resources: () => ({ hp: 880, maxHp: 880, energy: 0, maxEnergy: 130 }),
  blockReason: () => null,
  support: () => support, replaceSupport: (state) => { support = state; steps.push("发布"); },
  prepareSupport: (state) => { steps.push("解锁"); return state; },
  captureMotion: () => { steps.push("采样运动"); return "局部运动凭证"; },
  grantResources: (effect) => { assert.equal(form.state.form, "bless"); assert.equal(effect.hullCostRatio, 0.15); steps.push("资源"); },
  restoreMotion: (motion) => { assert.equal(motion, "局部运动凭证"); steps.push("换算运动"); },
});
steps.length = 0;
const neutral = form.state;
assert.deepEqual(form.transform(), { cooldown: 30, refreshVisibility: true });
assert.deepEqual(steps, ["采样运动", "解锁", "发布", "资源", "换算运动"]);
assert.equal(neutral.form, "neutral");
console.log("形态运行时通过：无实体输入、发布与资源/运动事务顺序");
