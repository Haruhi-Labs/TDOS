// 对局级随机源。传入种子时整局可复现；未传种子时退回环境模式，
// 每次取值都读取调用时刻的 Math.random，取值顺序与改造前完全一致。

function mixSeed(seed, label) {
  let hash = (seed ^ 0x9e3779b9) >>> 0;
  for (let index = 0; index < label.length; index += 1) {
    hash = Math.imul(hash ^ label.charCodeAt(index), 0x01000193) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) >>> 0;
}

function withRange(rng) {
  // 算式与 math.js 的 randomInRange 相同（先乘后加），保证同一底层序列下逐位一致。
  rng.range = (min, max) => rng.next() * (max - min) + min;
  return rng;
}

export function createSeededRng(seed) {
  const origin = Number(seed) >>> 0;
  let state = origin;
  return withRange({
    seed: origin,
    next() {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    },
    // 子流种子只由初始种子和标签决定，不消耗本流，也不受本流已取次数影响。
    fork(label) {
      return createSeededRng(mixSeed(origin, String(label)));
    },
  });
}

export function createAmbientRng() {
  const rng = withRange({
    seed: null,
    next: () => Math.random(),
    // 环境模式只有一条全局序列；派生独立子流会打乱既有取值顺序。
    fork: () => rng,
  });
  return rng;
}

const AMBIENT_RNG = createAmbientRng();

export function rngFor(match) {
  return match?.rng || AMBIENT_RNG;
}
