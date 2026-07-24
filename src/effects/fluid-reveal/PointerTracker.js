import { resolvePointerSplatRadius } from "./pointerRadius.js";

export class PointerTracker {
  constructor(target, options = {}) {
    this.target = target;
    this.getOptions = options.getOptions || (() => ({}));
    this.trail = [];
    this.last = null;
    this.active = false;
    this.velocity = { x: 0, y: 0 };
    this.speed = 0;
    this.ac = new AbortController();

    const signal = this.ac.signal;
    target.addEventListener("pointerenter", this.handlePointerEnter, { signal });
    target.addEventListener("pointermove", this.handlePointerMove, { signal });
    target.addEventListener("pointerdown", this.handlePointerDown, { signal });
    target.addEventListener("pointerleave", this.handlePointerLeave, { signal });
    target.addEventListener("pointercancel", this.handlePointerLeave, { signal });
  }

  handlePointerEnter = (event) => {
    this.active = true;
    this.last = this.eventToPoint(event);
  };

  handlePointerLeave = () => {
    this.active = false;
    this.last = null;
    this.velocity = { x: 0, y: 0 };
    this.speed = 0;
  };

  handlePointerMove = (event) => {
    const point = this.eventToPoint(event);
    if (!point) return;

    const opts = this.getOptions();
    const radius = resolvePointerSplatRadius(opts.pointerRadius);
    const force = Number(opts.splatForce || 1);

    if (!this.last) {
      this.last = point;
      this.enqueue(point, { x: 0, y: 0 }, 0, radius, force);
      return;
    }

    const dt = Math.max(8, point.time - this.last.time) / 1000;
    const dx = point.x - this.last.x;
    const dy = point.y - this.last.y;
    const dist = Math.hypot(dx, dy);
    const speed = dist / dt;
    this.velocity = { x: dx / dt, y: dy / dt };
    this.speed = speed;

    const localRadiusPx = Math.max(12, radius * Math.min(point.width, point.height));
    const pixelDist = dist * Math.min(point.width, point.height);
    const steps = Math.max(1, Math.min(26, Math.ceil(pixelDist / (localRadiusPx * 0.42))));
    const fastBoost = Math.min(2.6, 0.75 + speed * 0.8);

    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const x = this.last.x + dx * t;
      const y = this.last.y + dy * t;
      this.enqueue(
        { ...point, x, y },
        {
          x: this.velocity.x,
          y: this.velocity.y,
        },
        speed,
        radius * (1 + Math.min(0.9, speed * 0.32)),
        force * fastBoost,
      );
    }

    this.last = point;
  };

  handlePointerDown = (event) => {
    this.handlePointerMove(event);

    const point = this.eventToPoint(event);
    if (!point) return;

    const opts = this.getOptions();
    const radius =
      resolvePointerSplatRadius(opts.pointerRadius) * Number(opts.clickRadiusMultiplier || 1.08);
    const force = Number(opts.splatForce || 1) * Number(opts.clickSplatForce || 1.7);
    this.enqueue(point, this.velocity, Math.max(0.55, this.speed), radius, force);
  };

  eventToPoint(event) {
    const rect = this.target.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = (event.clientX - rect.left) / rect.width;
    const y = 1 - (event.clientY - rect.top) / rect.height;
    return {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
      width: rect.width,
      height: rect.height,
      time: performance.now(),
    };
  }

  enqueue(point, velocity, speed, radius, force) {
    this.trail.push({
      x: point.x,
      y: point.y,
      dx: velocity.x,
      dy: velocity.y,
      speed,
      radius,
      force,
    });
    if (this.trail.length > 96) {
      this.trail.splice(0, this.trail.length - 96);
    }
  }

  consumeSplats(limit = 44) {
    if (this.trail.length <= limit) {
      return this.trail.splice(0);
    }
    return this.trail.splice(0, limit);
  }

  destroy() {
    this.ac.abort();
    this.trail.length = 0;
    this.last = null;
  }
}
