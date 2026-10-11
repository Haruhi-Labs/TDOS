import { HARUHI_BOOST_MULTIPLIER } from "./haruhi-flagship.js";

// 旗舰强化拥有寿命、净化保护和激活事务；支援集合仍由支援模块独占写入。
export class HaruhiFlagshipRuntime {
  #expiresAt = 0;
  #startedTick = null;
  #port;

  constructor(port) { this.#port = Object.freeze({ ...port }); }
  get expiresAt() { return this.#expiresAt; }
  active() { return this.#port.enabled() && this.#expiresAt > this.#port.now(); }

  activate(duration, random = this.#port.random) {
    if (!this.#port.enabled()) return null;
    const now = this.#port.now();
    this.#expiresAt = now + Math.max(0, Number(duration) || 0);
    this.#startedTick = this.#port.tick();
    return this.#port.unlockSupport(now, random);
  }

  cast(duration) {
    if (!this.#port.enabled()) return false;
    const wasActive = this.active();
    const supporter = this.activate(duration, this.#port.random);
    // 先提交强化与支援，再换算既有航速和开火冷却；续期不重复乘倍率。
    if (!wasActive) this.#port.boostTempo(HARUHI_BOOST_MULTIPLIER);
    this.#port.announce(supporter);
    return true;
  }

  clear({ preserveCurrentTick = true } = {}) {
    if (preserveCurrentTick && this.#startedTick === this.#port.tick()) return false;
    const cleared = this.#expiresAt > this.#port.now();
    this.#expiresAt = 0;
    this.#startedTick = null;
    return cleared;
  }
}
