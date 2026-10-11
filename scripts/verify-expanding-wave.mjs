import assert from "node:assert/strict";
import { createExpandingWave, expandingWaveCoversEntity } from "../shared/game/systems/expanding-wave.js";
import { createExpandingWave as createVisionWave } from "../shared/game/vision-wave.js";

const source = Object.freeze({ id: 17, x: 300, y: 400 });
const wave = createExpandingWave({ worldSize: 1000, now: 2, source, id: 3 });
assert.deepEqual(wave, {
  id: 3, sourceShipId: 17, x: 300, y: 400, emittedAt: 2,
  speed: 480, width: 115.19999999999999,
  edgeRadius: Math.hypot(700, 600), maxRadius: Math.hypot(700, 600) + 57.599999999999994,
  expiresAt: 2 + (Math.hypot(700, 600) + 57.599999999999994) / 480,
});
assert.deepEqual(createVisionWave({ match: { worldSize: 1000, elapsed: 2 } }, source, 3), wave,
  "原视野波入口与独立几何必须保持相同载荷");
assert.equal(createExpandingWave({ worldSize: 100, now: 0, source, id: 1 }).width, 26);
assert.equal(createExpandingWave({ worldSize: 2000, now: 0, source, id: 1 }).width, 220);

// 简单整数波带验证接触边界，避免用与实现相同的公式掩盖误差。
const probe = Object.freeze({ x: 0, y: 0, emittedAt: 1, expiresAt: 5, speed: 10, width: 4 });
assert.equal(expandingWaveCoversEntity(probe, { x: 0, y: 0 }, 0.99), false);
assert.equal(expandingWaveCoversEntity(probe, { x: 12, y: 0, radius: 0 }, 2), true);
assert.equal(expandingWaveCoversEntity(probe, { x: 12.01, y: 0, radius: 0 }, 2), false);
assert.equal(expandingWaveCoversEntity(probe, { x: 13, y: 0, radius: 1 }, 2), true);
assert.equal(expandingWaveCoversEntity(probe, { x: 7, y: 0, radius: 1 }, 2), true);
assert.equal(expandingWaveCoversEntity(probe, { x: 6.99, y: 0, radius: 1 }, 2), false);
assert.equal(expandingWaveCoversEntity(probe, { x: 12.01, y: 0, radius: -1 }, 2), false);
assert.equal(expandingWaveCoversEntity(probe, { x: 40, y: 0, radius: 100 }, 5), false);
console.log("扩散波几何校验通过：独立数据输入、载荷兼容、宽度上下限、接触与到期边界。");
