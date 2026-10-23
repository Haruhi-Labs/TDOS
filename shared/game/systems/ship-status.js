// 效果值与生效帧必须由同一所有者提交，避免净化绕过同帧保护。
export class ShipStatus {
  #effects = Object.freeze({ reliableUntil: 0, bladeQueenUntil: 0, catPawUntil: 0,
    silencedUntil: 0, stunnedUntil: 0, nextShotDamageMultiplier: 1 });
  #startedTicks = new Map();
  get effects() { return this.#effects; }
  #write(key, value) { this.#effects = Object.freeze({ ...this.#effects, [key]: value }); }
  mark(key, tick) { this.#startedTicks.set(key, tick); }
  forget(key) { this.#startedTicks.delete(key); }
  activate(key, until, tick) { this.#write(key, until); this.mark(key, tick); }
  extend(key, until) { this.#write(key, Math.max(this.#effects[key] || 0, until)); }
  canClear(key, preserve, tick) { return !preserve || this.#startedTicks.get(key) !== tick; }
  clear(key, preserve, tick, now) {
    if (!this.canClear(key, preserve, tick)) return false;
    const active = Number(this.#effects[key] || 0) > now;
    this.#write(key, 0);
    this.forget(key);
    return active;
  }
  clearControl() {
    this.#effects = Object.freeze({ ...this.#effects, silencedUntil: 0, stunnedUntil: 0 });
  }
  charge(multiplier, tick) { this.#write("nextShotDamageMultiplier", multiplier); this.mark("nextShotDamageMultiplier", tick); }
  consumeCharge() {
    const multiplier = this.#effects.nextShotDamageMultiplier;
    this.#write("nextShotDamageMultiplier", 1);
    this.forget("nextShotDamageMultiplier");
    return multiplier;
  }
}
