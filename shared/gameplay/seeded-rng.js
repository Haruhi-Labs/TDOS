const UINT32_MAX_PLUS_ONE = 0x100000000;

function hashString(input) {
  let hash = 2166136261;
  const text = String(input);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeSeed(seed) {
  if (typeof seed === "number" && Number.isFinite(seed)) return seed >>> 0;
  if (typeof seed === "string" && seed.trim()) {
    const numeric = Number(seed);
    return Number.isFinite(numeric) ? numeric >>> 0 : hashString(seed);
  }
  return 0;
}

function createMulberry32(seed) {
  let state = normalizeSeed(seed);
  return function nextUint32() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  };
}

export function createSeededRng(seed = 0) {
  const rootSeed = normalizeSeed(seed);
  const nextUint32 = createMulberry32(rootSeed);

  const api = {
    seed: rootSeed,

    next() {
      return nextUint32() / UINT32_MAX_PLUS_ONE;
    },

    nextInt(min, max) {
      const lo = Math.ceil(Number(min));
      const hi = Math.floor(Number(max));
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) {
        throw new Error(`Invalid rng integer range: ${min}..${max}`);
      }
      return lo + Math.floor(api.next() * (hi - lo + 1));
    },

    pick(array) {
      if (!Array.isArray(array) || array.length === 0) {
        throw new Error("rng.pick requires a non-empty array");
      }
      return array[api.nextInt(0, array.length - 1)];
    },

    shuffle(array) {
      if (!Array.isArray(array)) {
        throw new Error("rng.shuffle requires an array");
      }
      const copy = array.slice();
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = api.nextInt(0, i);
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    },

    fork(label) {
      return createSeededRng(hashString(`${rootSeed}:${String(label)}`));
    },
  };

  return api;
}
