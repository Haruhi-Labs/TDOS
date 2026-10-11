import { readonlyIdSet } from "../../data/readonly-id-set.js";
import { createBunnyHaruhiState, planBunnyTransform, purgeBunnyForm, clearBunnyFormWindows, bunnySelfDrainAmount, resolveBunnyThrottle } from "../bunny-haruhi.js";

// 形态持有自己的历史和发布视图；资源、伴随、支援与运动通过事务能力同步提交。
export class BunnyFormRuntime {
  #port;
  #state;
  #view;
  constructor(port) { this.#port = port; this.#commit(createBunnyHaruhiState()); }
  get state() {
    const support = this.#port.support();
    if (!this.#view || this.#view.support !== support) this.#view = Object.freeze({ ...this.#state, support });
    return this.#view;
  }
  #commit(state) {
    this.#port.replaceSupport(state.support);
    this.#state = Object.freeze({ ...state, visitedForms: readonlyIdSet(state.visitedForms) });
    this.#view = undefined;
  }
  spawnCompanion() {
    if (!this.#port.canSpawn() || this.state.form !== "encore" || this.state.companionId !== null) return null;
    const id = this.#port.spawnCompanion();
    this.#commit({ ...this.state, companionId: id, companionSpawned: true });
    return id;
  }
  purge(tick) {
    const old = this.state;
    const next = purgeBunnyForm(old, tick);
    this.#commit(next);
    return next.positiveSuppressed !== old.positiveSuppressed || next.immunityUntil !== old.immunityUntil;
  }
  transform() {
    if (this.#port.blockReason()) return false;
    const result = planBunnyTransform(this.state, this.#port.resources(), this.#port.now(), this.#port.tick());
    if (!result.ok) return false;
    const motion = this.#port.captureMotion();
    const support = this.#port.prepareSupport(result.state.support, result.unlockSupport);
    this.#commit({ ...result.state, support });
    this.#port.grantResources(result.resources);
    this.#port.restoreMotion(motion, (throttle) => resolveBunnyThrottle(result.state, throttle, true, this.#port.now()));
    if (result.spawnCompanion) this.spawnCompanion();
    return { cooldown: result.cooldownSeconds, refreshVisibility: true };
  }
  sustain(from, to) {
    this.#port.drainHull(bunnySelfDrainAmount(this.state, { from, to, ...this.#port.resources(), enabled: this.#port.enabled() }));
  }
  cleanup() {
    if (!this.#port.alive()) {
      this.#commit(clearBunnyFormWindows(this.state));
      this.#port.clearSupport();
    }
  }
}
