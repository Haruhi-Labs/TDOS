// 赞助的寿命、同帧保护与派生效果由同一状态所有者解释。
export class SponsorEffect {
  #expiresAt = 0;
  #startedTick = null;
  #port;

  constructor(port) { this.#port = Object.freeze({ ...port }); }
  get expiresAt() { return this.#expiresAt; }
  active() { return this.#expiresAt > this.#port.now(); }
  cooldownStep(dt) { return dt * (this.active() ? 2 : 1); }

  activate(duration) {
    this.#expiresAt = this.#port.now() + duration;
    this.#startedTick = this.#port.tick();
    this.#port.activated();
  }

  regenerate(dt) {
    if (this.active()) this.#port.restoreHullFraction(0.01, dt);
  }

  clear({ preserveCurrentTick = true } = {}) {
    if (preserveCurrentTick && this.#startedTick === this.#port.tick()) return false;
    const cleared = this.active();
    this.#expiresAt = 0;
    this.#startedTick = null;
    return cleared;
  }
}
