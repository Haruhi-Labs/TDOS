import assert from "node:assert/strict";
import { RlBatchEnvironment } from "../shared/training/environment.js";
import {
  encodeRlFrames,
  RL_ENCODED_MODEL_INPUT_NAMES,
  RL_MODEL_INPUT_NAMES,
  rlToken,
} from "../shared/training/tensors.js";

const environment = new RlBatchEnvironment({ count: 2, baseSeed: 44001 });
const frames = environment.reset().flatMap((result) => [result.seats.A, result.seats.B]);
const tensors = encodeRlFrames(frames);

assert.deepEqual(tensors.global.dims, [4, 19]);
assert.deepEqual(tensors.own_ships.dims, [4, 16, 45]);
assert.deepEqual(tensors.own_ship_tokens.dims, [4, 16, 3]);
assert.deepEqual(tensors.action_navigation_mask.dims, [4, 16, 3]);
assert.equal(tensors.global.type, "float32");
assert.equal(tensors.own_ship_tokens.type, "int64");
assert.equal(tensors.own_ships_mask.type, "bool");
assert.equal(
  tensors.own_ships_mask.data.reduce((sum, value) => sum + value, 0),
  12,
);
assert.equal(rlToken("haruhi"), 106);
for (const name of RL_ENCODED_MODEL_INPUT_NAMES) {
  assert.ok(tensors[name], `缺少 ONNX 输入张量：${name}`);
}
assert.deepEqual(RL_MODEL_INPUT_NAMES.slice(-2), ["hidden", "episode_start"]);

console.log("浏览器强化学习张量编码器校验通过：TypedArray、容量、掩码与模型输入均完整。");
