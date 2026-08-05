import assert from "node:assert/strict";
import { scoutZoneFromVector } from "../src/battle/scout-joystick.js";

const directions = [
  [0, 0, 5, "轻点选择中央战区"],
  [13, 0, 5, "中心死区避免轻微滑动误选"],
  [0, -40, 2, "向上选择2号战区"],
  [40, -40, 3, "向右上选择3号战区"],
  [40, 0, 6, "向右选择6号战区"],
  [40, 40, 9, "向右下选择9号战区"],
  [0, 40, 8, "向下选择8号战区"],
  [-40, 40, 7, "向左下选择7号战区"],
  [-40, 0, 4, "向左选择4号战区"],
  [-40, -40, 1, "向左上选择1号战区"],
];

for (const [dx, dy, expected, label] of directions) {
  assert.equal(scoutZoneFromVector(dx, dy), expected, label);
}

assert.equal(scoutZoneFromVector(Number.NaN, 30), 5, "异常坐标回退到中央战区");
assert.equal(scoutZoneFromVector(30, Number.POSITIVE_INFINITY), 5, "无限坐标回退到中央战区");
assert.equal(scoutZoneFromVector(2, 0, -1), 6, "非法负死区按0处理");

console.log("移动端侦察机八向手柄映射检查通过");
