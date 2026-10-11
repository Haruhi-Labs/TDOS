import { clamp, linePointDistance } from "../foundation/math.js";

// 光线只拥有自身队列；角色、护盾、伤害和表现由装配端口提交。
export class BeamSystem {
  #port;
  #config;
  #beams = [];

  constructor(port, config) {
    this.#port = Object.freeze({ ...port });
    this.#config = Object.freeze({ ...config });
  }

  enqueue(caster, dirX, dirY) {
    if (!caster?.alive || caster.attached) return false;
    const length = Math.hypot(dirX, dirY);
    if (!Number.isFinite(length) || length < 1e-4) return false;
    const unitX = dirX / length;
    const unitY = dirY / length;
    const range = this.#config.range;
    this.#beams.push({
      id: this.#port.nextId(), shipKey: caster.key, phase: "charge",
      x1: caster.x, y1: caster.y,
      x2: this.#port.clampX(caster.x + unitX * range),
      y2: this.#port.clampY(caster.y + unitY * range),
      dirX: unitX, dirY: unitY, range, color: "#8ef8ff",
      life: this.#config.chargeDuration, maxLife: this.#config.chargeDuration,
      progress: 0, fired: false,
    });
    return true;
  }

  #cancel(beam) {
    beam.fired = true;
    beam.phase = "cancel";
    beam.life = 0;
  }

  #followCaster(beam, caster) {
    beam.x1 = caster.x;
    beam.y1 = caster.y;
    beam.x2 = this.#port.clampX(caster.x + beam.dirX * beam.range);
    beam.y2 = this.#port.clampY(caster.y + beam.dirY * beam.range);
  }

  advance(dt) {
    for (const beam of this.#beams) {
      if (beam.phase === "charge") {
        const caster = this.#port.caster(beam.shipKey);
        if (!caster?.alive || caster.attached) {
          this.#cancel(beam);
          continue;
        }
        this.#followCaster(beam, caster);
        // 进度先采样旧剩余时间，再扣本帧时间，保持旧权威和显示节奏。
        beam.progress = clamp(1 - beam.life / Math.max(beam.maxLife, 0.001), 0, 1);
        if (caster.controlLocked) continue;
      }
      beam.life -= dt;
    }
    this.#beams = this.#beams.filter((beam) => beam.life > 0 || (beam.phase === "charge" && !beam.fired));
  }

  resolve(targetSide) {
    for (const beam of this.#beams) {
      if (beam.phase !== "charge" || beam.life > 0 || beam.fired) continue;
      const caster = this.#port.caster(beam.shipKey);
      if (!caster?.alive || caster.attached) {
        this.#cancel(beam);
        continue;
      }
      beam.fired = true;
      beam.phase = "fire";
      beam.life = this.#config.visualDuration;
      beam.maxLife = this.#config.visualDuration;
      beam.progress = 1;
      this.#followCaster(beam, caster);

      const barrier = this.#port.barrierImpact(Object.freeze({ x1: beam.x1, y1: beam.y1, x2: beam.x2, y2: beam.y2 }), targetSide);
      if (barrier) {
        barrier.consume();
        beam.x2 = barrier.x;
        beam.y2 = barrier.y;
        beam.blockedByBarrier = true;
        beam.barrierTeamSeat = barrier.seat;
        barrier.present();
      }
      // 先固定完整命中集合，再按统一倍率立即投递；后续命中可以观察前次伤害副作用。
      const targets = this.#port.targets(beam.shipKey, targetSide).filter((target) => {
        const probe = linePointDistance(beam.x1, beam.y1, beam.x2, beam.y2, target.x, target.y);
        return probe.dist <= target.radius + this.#config.hitRadius && probe.t >= 0 && probe.t <= 1;
      });
      const damageRatio = this.#config.damageRatio(targets.length);
      this.#port.recordAttack(targets.length);
      for (const target of targets) target.hit(damageRatio);
      if (!targets.length) this.#port.miss(beam.x2, beam.y2);
    }
  }

  inspect() {
    return Object.freeze(this.#beams.map((beam) => Object.freeze({ ...beam })));
  }

  serialize() {
    return this.#beams.map((beam) => ({
      id: beam.id,
      shipKey: beam.shipKey,
      phase: beam.phase || "fire",
      x1: beam.x1,
      y1: beam.y1,
      x2: beam.x2,
      y2: beam.y2,
      progress: Number.isFinite(beam.progress) ? beam.progress : 1,
      color: beam.color,
      life: beam.life,
      maxLife: beam.maxLife || beam.life,
      blockedByBarrier: Boolean(beam.blockedByBarrier),
      barrierTeamSeat: beam.barrierTeamSeat || null,
    }));
  }
}
