import assert from "node:assert/strict";
import { decodeDeterministicPolicyActions } from "../shared/training/policy-action.js";
import { RlBatchEnvironment } from "../shared/training/environment.js";
import { encodeRlFrames } from "../shared/training/tensors.js";

function floatTensor(dims, fill = 0) {
  return { dims, data: new Float32Array(dims.reduce((a, b) => a * b, 1)).fill(fill) };
}

const environment = new RlBatchEnvironment({ count: 1, baseSeed: 55001 });
const result = environment.reset()[0];
const tensors = encodeRlFrames([result.seats.A]);
const shipCapacity = tensors.own_ships.dims[1];
const outputs = {
  ship_navigation_logits: floatTensor([1, shipCapacity, 3]),
  ship_set_gear_logits: floatTensor([1, shipCapacity, 2]),
  ship_gear_logits: floatTensor([1, shipCapacity, 5]),
  ship_brake_logits: floatTensor([1, shipCapacity, 2]),
  ship_subskill_logits: floatTensor([1, shipCapacity, 2]),
  ship_subzone_logits: floatTensor([1, shipCapacity, 9]),
  ship_continuous_mean: floatTensor([1, shipCapacity, 6], 0.5),
  split_logits: floatTensor([1, 3]),
  scout_launch_logits: floatTensor([1, 2]),
  scout_source_logits: floatTensor([1, shipCapacity]),
  scout_zone_logits: floatTensor([1, 9]),
  flagship_logits: floatTensor([1, 2]),
  flagship_zone_logits: floatTensor([1, 9]),
  flagship_continuous_mean: floatTensor([1, 2], -0.5),
};

// 故意让一个非法的分舰等级分数最高，验证掩码不会被输出绕过。
outputs.split_logits.data.set([0, 2, 9]);
const [action] = decodeDeterministicPolicyActions(outputs, tensors);
assert.equal(action.ships.length, 3);
assert.equal(action.split, 1);
assert.equal(action.ships[0].navigation, 0);
assert.equal(action.ships[1].navigation, 0);
assert.equal(action.ships[0].end.x, Math.fround(Math.tanh(0.5)));
assert.equal(action.flagshipSkill.target.x, Math.fround(Math.tanh(-0.5)));

console.log("浏览器强化学习策略解码校验通过：动作头、合法掩码与连续参数均正常。");
