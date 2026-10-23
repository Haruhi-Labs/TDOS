// 施放组件独占冷却与公共施放事务；角色效果只通过已装配的执行能力生效。
export class SkillCycle {
  #port;
  #cooldowns = Object.freeze({ scout: 0, flagship: 0, sub1: 0, sub2: 0 });
  constructor(port) { this.#port = port; }
  get cooldowns() { return this.#cooldowns; }
  startCooldown(key, duration) {
    if (!Object.hasOwn(this.#cooldowns, key) || !Number.isFinite(duration) || duration < 0) {
      throw new RangeError("技能冷却要求已知槽位和非负有限时长");
    }
    this.#cooldowns = Object.freeze({ ...this.#cooldowns, [key]: duration });
  }
  advance(step) {
    this.#cooldowns = Object.freeze(Object.fromEntries(Object.entries(this.#cooldowns)
      .map(([key, value]) => [key, Math.max(0, value - step)])));
  }
  castFlagship() {
    if (!this.#port.flagshipAvailable()) return false;
    const meta = this.#port.metadata("main", "flagship");
    if (!meta || meta.type !== "active") return false;
    const caster = this.#port.caster("main");
    if (!caster.alive || !caster.canControl() || caster.isSilenced() || this.#port.disabled()
      || this.#cooldowns.flagship > 0) return false;
    if (!this.#port.executeFlagship(meta)) return false;
    this.startCooldown("flagship", meta.cooldown || 0);
    this.#port.record("flagship_skill");
    this.#port.reveal("main");
    return true;
  }
  castSub(key, options) {
    const exclusive = this.#port.exclusive(key);
    if (exclusive !== null) {
      if (!exclusive) return false;
      this.#completeSub(key, exclusive.cooldown);
      if (exclusive.refreshVisibility) this.#port.refreshVisibility();
      return true;
    }
    const caster = this.#port.caster(key);
    if (!caster || !caster.alive || caster.isAttached() || !caster.canControl()
      || caster.isSilenced() || caster.exclusiveMovement() || this.#port.disabled()) return false;
    const meta = this.#port.metadata(key, "sub");
    if (!meta || meta.type !== "active" || (this.#cooldowns[key] || 0) > 0) return false;
    if (!this.#port.spendEnergy(key, meta.cost || 0)) return false;
    // 失败退款属于具体效果；公共事务不能再次退款或提前提交成功。
    if (!this.#port.executeSub(key, options, meta)) return false;
    this.#completeSub(key, meta.cooldown || 0);
    return true;
  }
  #completeSub(key, cooldown) {
    this.startCooldown(key, cooldown);
    this.#port.record("sub_skill");
    this.#port.reveal(key);
  }
}
