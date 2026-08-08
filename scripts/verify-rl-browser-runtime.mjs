import assert from "node:assert/strict";
import { BrowserRlPolicy, validateRlModelMetadata } from "../shared/training/browser-policy.js";
import { RlBatchEnvironment } from "../shared/training/environment.js";
import { RL_MODEL_INPUT_NAMES, RL_MODEL_OUTPUT_NAMES } from "../shared/training/tensors.js";

function floatTensor(dims, fill = 0) {
  return { dims, data: new Float32Array(dims.reduce((a, b) => a * b, 1)).fill(fill) };
}

const metadata = {
  observation_schema_version: 1,
  action_schema_version: 2,
  tensor_schema_version: 1,
  inputs: [...RL_MODEL_INPUT_NAMES],
  outputs: [...RL_MODEL_OUTPUT_NAMES],
  model_config: { recurrent_dim: 8 },
  tensor_limits: {
    own_ships: 4,
    own_auxiliaries: 8,
    opponents: 8,
    projectiles: 16,
    beams: 4,
    vision_waves: 4,
    radar_contacts: 4,
    supporters: 4,
  },
};

const environment = new RlBatchEnvironment({ count: 1, baseSeed: 66001 });
const frame = environment.reset()[0].seats.A;
const seenFeeds = [];
const session = {
  async run(feeds) {
    seenFeeds.push(feeds);
    const ships = feeds.own_ships.dims[1];
    return {
      next_hidden: floatTensor([1, 8], seenFeeds.length * 0.25),
      value: floatTensor([1]),
      ship_navigation_logits: floatTensor([1, ships, 3]),
      ship_set_gear_logits: floatTensor([1, ships, 2]),
      ship_gear_logits: floatTensor([1, ships, 5]),
      ship_brake_logits: floatTensor([1, ships, 2]),
      ship_subskill_logits: floatTensor([1, ships, 2]),
      ship_subzone_logits: floatTensor([1, ships, 9]),
      ship_continuous_mean: floatTensor([1, ships, 6]),
      ship_continuous_log_std: floatTensor([1, ships, 6]),
      split_logits: floatTensor([1, 3]),
      scout_launch_logits: floatTensor([1, 2]),
      scout_source_logits: floatTensor([1, ships]),
      scout_zone_logits: floatTensor([1, 9]),
      flagship_logits: floatTensor([1, 2]),
      flagship_zone_logits: floatTensor([1, 9]),
      flagship_continuous_mean: floatTensor([1, 2]),
      flagship_continuous_log_std: floatTensor([1, 2]),
    };
  },
};

const policy = new BrowserRlPolicy({ session, metadata });
const first = await policy.act(frame);
assert.equal(first.ships.length, 3);
assert.equal(seenFeeds[0].episode_start.data[0], 1);
assert.ok(seenFeeds[0].hidden.data.every((value) => value === 0));
await policy.act(frame);
assert.equal(seenFeeds[1].episode_start.data[0], 0);
assert.ok(seenFeeds[1].hidden.data.every((value) => value === 0.25));
policy.reset();
await policy.act(frame);
assert.equal(seenFeeds[2].episode_start.data[0], 1);
assert.ok(seenFeeds[2].hidden.data.every((value) => value === 0));

assert.throws(
  () => validateRlModelMetadata({ ...metadata, tensor_schema_version: 99 }),
  /张量契约版本不兼容/,
);

let releaseGate;
const gate = new Promise((resolve) => { releaseGate = resolve; });
const guardedPolicy = new BrowserRlPolicy({
  metadata,
  session: {
    async run(feeds) {
      await gate;
      return session.run(feeds);
    },
  },
});
const pending = guardedPolicy.act(frame);
await assert.rejects(guardedPolicy.act(frame), /已有一次推理正在进行/);
guardedPolicy.reset();
releaseGate();
await assert.rejects(pending, /推理期间已重置/);

console.log("浏览器强化学习候选运行时校验通过：契约、隐状态和回合重置均正常。");
