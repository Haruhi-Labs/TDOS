import { copyPlainData } from "../../data/plain-data.js";
// 战斗实体的状态与生命周期。
import { nextEntityId } from "../model/model-support.js";

export class FloatingText {
  constructor(x, y, text, color = "#ffd178", meta = {}, match = null) {
    const payload = text && typeof text === "object" ? text : null;
    const textKey = meta.textKey || payload?.textKey || payload?.key || null;
    const textArgs = meta.textArgs || payload?.textArgs || payload?.args || null;
    const fallback = payload ? payload.text || payload.fallback || textKey : text;
    this.id = nextEntityId(match);
    this.kind = "floating_text";
    this.x = x;
    this.y = y;
    this.text = String(fallback || "");
    this.textKey = textKey ? String(textKey) : null;
    this.textArgs = textArgs && typeof textArgs === "object" ? { ...textArgs } : null;
    this.color = payload?.color || color;
    this.emphasis = meta.emphasis || payload?.emphasis || "normal";
    this.maxLife = Math.max(0.1, Number(meta.life || payload?.life) || 0.8);
    this.life = this.maxLife;
    this.riseSpeed = Number.isFinite(Number(meta.riseSpeed ?? payload?.riseSpeed))
      ? Number(meta.riseSpeed ?? payload?.riseSpeed)
      : 18;
  }

  update(dt) {
    this.life -= dt;
    this.y -= this.riseSpeed * dt;
  }

  serialize() {
    return {
      id: this.id,
      kind: this.kind,
      x: this.x,
      y: this.y,
      text: this.text,
      textKey: this.textKey,
      textArgs: copyPlainData(this.textArgs),
      color: this.color,
      life: this.life,
      maxLife: this.maxLife,
      emphasis: this.emphasis,
    };
  }
}
