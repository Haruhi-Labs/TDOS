const DEFAULT_RANDOM_SOURCE = () => Math.random();

let activeRandomSource = DEFAULT_RANDOM_SOURCE;

export function gameRandom() {
  return activeRandomSource();
}

export function withGameRandom(randomSource, callback) {
  const previous = activeRandomSource;
  activeRandomSource = typeof randomSource === "function" ? randomSource : DEFAULT_RANDOM_SOURCE;
  try {
    return callback();
  } finally {
    activeRandomSource = previous;
  }
}

export function createSeededRandom(seed = 1) {
  let state = Number(seed) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function resolveGameRandom({ random, randomSeed } = {}) {
  if (typeof random === "function") {
    return random;
  }
  if (randomSeed !== undefined && randomSeed !== null && Number.isFinite(Number(randomSeed))) {
    return createSeededRandom(Number(randomSeed));
  }
  return DEFAULT_RANDOM_SOURCE;
}
