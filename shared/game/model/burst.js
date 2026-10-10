// 战斗实体的状态与生命周期。
import { nextEntityId } from "../model/model-support.js";

export class Burst {
  constructor(x, y, color = "#ffdb9b", radius = 7, match = null) {
    this.id = nextEntityId(match);
    this.kind = "burst";
    this.x = x;
    this.y = y;
    this.color = color;
    this.radius = radius;
    this.life = 0.35;
  }

  update(dt) {
    this.life -= dt;
    this.radius += 60 * dt;
  }

  serialize() {
    return {
      id: this.id,
      kind: this.kind,
      x: this.x,
      y: this.y,
      color: this.color,
      radius: this.radius,
      life: this.life,
    };
  }
}
