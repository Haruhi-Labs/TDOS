export const FUTURE_1096_FORMS = Object.freeze({
  A: Object.freeze({ damageTaken: 2, speed: 1.5, fireRate: 2 }),
  B: Object.freeze({ damageTaken: 0.5, speed: 0.5, fireRate: 0.5 }),
});
export const FUTURE_1096_BASE_FORM = Object.freeze({ damageTaken: 1, speed: 1, fireRate: 1 });

export function futureFormDefinition(form) {
  return FUTURE_1096_FORMS[form] || FUTURE_1096_BASE_FORM;
}

// 形态是角色私有状态；转换先提交形态，再让舰体按新旧倍率调整运动。
export class FutureFlagshipForm {
  #form = null;
  #port;

  constructor(port) {
    this.#port = Object.freeze({ ...port });
  }

  get current() { return this.#form; }

  statMultiplier(key) {
    if (!this.#port.enabled()) return 1;
    const form = futureFormDefinition(this.#form);
    if (key === "speed") return form.speed;
    if (key === "fireRate") return form.fireRate;
    return 1;
  }

  damageTakenMultiplier() {
    return this.#port.enabled() ? futureFormDefinition(this.#form).damageTaken : 1;
  }

  switch() {
    if (!this.#port.enabled()) return false;
    const previous = futureFormDefinition(this.#form);
    this.#form = this.#form === "A" ? "B" : "A";
    const next = futureFormDefinition(this.#form);
    this.#port.transition(Object.freeze({
      form: this.#form, speedRatio: next.speed / previous.speed, cooldownRatio: previous.fireRate / next.fireRate,
    }));
    return true;
  }
}
