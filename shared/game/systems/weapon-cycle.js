import { clamp, distance, shortestAngleDelta } from "../math.js";

// 武器拥有开火周期；瞄准算法只消费目标数据和发射能力。
export class WeaponCycle {
  #cooldown;
  constructor(cooldown) { this.#cooldown = cooldown; }
  get remaining() { return this.#cooldown; }
  reset(value) { this.#cooldown = value; }
  advance(dt) { this.#cooldown = Math.max(0, this.#cooldown - dt); }
  fire(port) {
    if (!port.alive() || this.#cooldown > 0 || !port.available() || port.controlLocked()) return;
    const target = port.target();
    if (!target) return;
    const origin = port.origin();
    const targetDistance = distance(origin.x, origin.y, target.x, target.y);
    const predictedX = target.x + (target.speed || 0) * Math.cos(target.angle || 0) * (targetDistance / 300);
    const predictedY = target.y + (target.speed || 0) * Math.sin(target.angle || 0) * (targetDistance / 300);
    const spread = clamp(targetDistance / 18, 4, 26);
    const aimX = predictedX + port.random(-spread, spread);
    const aimY = predictedY + port.random(-spread, spread);
    const bearing = Math.atan2(target.y - origin.y, target.x - origin.x);
    const fireDensity = port.arcDensity(Math.abs(shortestAngleDelta(origin.angle, bearing)));
    if (fireDensity <= 0) return;
    const damage = port.prepareDamage();
    const profile = port.projectileProfile();
    port.launch({ targetX: port.clampX(aimX), targetY: port.clampY(aimY), damage, speed: 240, hitRadius: 8, ...profile });
    port.recordAttack();
    this.#cooldown = 1 / Math.max(0.01, port.fireRate() * fireDensity);
  }
}
