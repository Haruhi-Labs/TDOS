import { createBunnyStageExposure, resolveBunnyStageExposure, leaveBunnyStage, cleanseBunnyStageControl, bunnyStageHealAmount, isBunnyControlLocked } from "./rules.js";

// 舞台独占区域样本、接收者状态和持续结算游标；只认识编号与受限能力，不持有世界或实体。
export class BunnyStageRuntime {
  #port;
  #sustainAt;
  #stages = new Map();
  #exposures = new Map();
  constructor(port) { this.#port = port; this.#sustainAt = port.now(); }
  stage(seat) { return this.#stages.get(seat) ?? null; }
  exposure(id) { return this.#exposures.get(id); }
  #commit(id, state) { this.#exposures.set(id, Object.freeze(state)); }
  enabled(id) {
    const state = this.exposure(id);
    return Boolean(state?.inside && this.#port.sourceValid(state.sourceShipId, id));
  }
  cleanse(id) {
    const state = this.exposure(id);
    if (state) this.#commit(id, cleanseBunnyStageControl(state));
  }
  resolve() {
    // 双方区域必须先采样，之后的治疗和禁控才允许改变实体。
    const samples = this.#port.sampleStages();
    for (const { seat, own, enemy } of samples) {
      if (own !== undefined) this.#stages.set(seat, own);
      for (const target of this.#port.receivers(seat)) {
        const inside = Boolean(enemy && target.alive && (target.x - enemy.x) ** 2 + (target.y - enemy.y) ** 2 <= enemy.radius ** 2 + 1e-9);
        const old = this.exposure(target.id);
        if (!inside && !old) continue;
        const result = resolveBunnyStageExposure(old || createBunnyStageExposure(), {
          inside, sourceShipId: enemy?.sourceShipId, now: this.#port.now(), tick: this.#port.tick(),
        });
        this.#commit(target.id, result.state);
        if (result.healRatio && target.alive) this.#port.heal(target.id, target.maxHp * result.healRatio);
        if (isBunnyControlLocked(result.state, this.#port.now())) this.#port.stopIfVulnerable(target.id);
      }
    }
  }
  advance() {
    const from = this.#sustainAt;
    const to = this.#port.now();
    if (to > from) {
      for (const seat of this.#port.seats) {
        for (const target of this.#port.receivers(seat)) {
          if (!target.alive) continue;
          this.#port.sustainForm(target.id, from, to);
          const state = this.exposure(target.id);
          if (state) {
            const current = this.#port.resources(target.id);
            this.#port.heal(target.id, bunnyStageHealAmount(state, { from, to, ...current, enabled: this.enabled(target.id) }));
          }
        }
      }
      this.#sustainAt = to;
    }
    this.cleanup();
    this.resolve();
  }
  cleanup() {
    for (const seat of this.#port.seats) {
      for (const target of this.#port.receivers(seat)) {
        this.#port.cleanupForm(target.id);
        const state = this.exposure(target.id);
        if (state?.inside && !this.enabled(target.id)) this.#commit(target.id, leaveBunnyStage(state));
      }
      if (this.stage(seat) && !this.#port.stageActive(seat)) this.#stages.set(seat, null);
    }
  }
}
