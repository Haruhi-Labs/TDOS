import {
  createBunnyStageExposure,
  resolveBunnyStageExposure,
  selectBunnyStageSource,
  leaveBunnyStage,
  cleanseBunnyStageControl,
  bunnyStageHealAmount,
  isBunnyControlLocked,
} from "./rules.js";

function freezeStageSnapshot(stage) {
  if (!stage) return null;
  return Object.freeze({
    sourceShipId: stage.sourceShipId,
    ...(stage.seat !== undefined ? { seat: stage.seat } : {}),
    x: stage.x,
    y: stage.y,
    radius: stage.radius,
  });
}

function normalizeStageSample(entry) {
  const receiverSeat = entry.receiverSeat ?? entry.seat;
  const rawOwn = Object.hasOwn(entry, "ownStage") ? entry.ownStage : entry.own;
  const ownStage = rawOwn === undefined ? undefined : freezeStageSnapshot(rawOwn);
  const rawHostile = Array.isArray(entry.hostileStages)
    ? entry.hostileStages
    : (entry.enemy ? [entry.enemy] : []);
  const hostileStages = Object.freeze(rawHostile.filter(Boolean).map(freezeStageSnapshot));
  return { receiverSeat, ownStage, hostileStages };
}

// 舞台独占区域样本、接收者状态和持续结算游标；只认识编号与受限能力，不持有世界或实体。
export class BunnyStageRuntime {
  #port;
  #seats;
  #sustainAt;
  #stages = new Map();
  #exposures = new Map();
  constructor(port) {
    this.#port = port;
    this.#seats = Object.freeze([...port.seats]);
    this.#sustainAt = port.now();
  }
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
    // 全部来源必须先采样，之后的治疗和禁控才允许改变实体。
    const samples = this.#port.sampleStages().map(normalizeStageSample);
    for (const { receiverSeat, ownStage } of samples) {
      if (ownStage !== undefined) this.#stages.set(receiverSeat, ownStage);
    }
    for (const { receiverSeat, hostileStages } of samples) {
      for (const target of this.#port.receivers(receiverSeat)) {
        const old = this.exposure(target.id);
        const validHostileStages = target.alive
          ? hostileStages.filter((stage) => this.#port.sourceValid(stage.sourceShipId, target.id))
          : [];
        const selected = selectBunnyStageSource(target, validHostileStages, old);
        const inside = Boolean(selected);
        if (!inside && !old) continue;
        const result = resolveBunnyStageExposure(old || createBunnyStageExposure(), {
          inside, sourceShipId: selected?.sourceShipId, now: this.#port.now(), tick: this.#port.tick(),
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
      for (const seat of this.#seats) {
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
    for (const seat of this.#seats) {
      for (const target of this.#port.receivers(seat)) {
        this.#port.cleanupForm(target.id);
        const state = this.exposure(target.id);
        if (state?.inside && !this.enabled(target.id)) this.#commit(target.id, leaveBunnyStage(state));
      }
      if (this.stage(seat) && !this.#port.stageActive(seat)) this.#stages.set(seat, null);
    }
  }
}
