const TEXTURE_SCALE = 2;
const MAX_TEXT_TEXTURES = 320;

function createCanvas(width = 1, height = 1) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function parseLetterSpacing(value) {
  const parsed = Number.parseFloat(String(value || "0"));
  return Number.isFinite(parsed) ? parsed : 0;
}

function drawSpacedText(ctx, text, x, y, spacing, method) {
  if (!spacing || text.length < 2) {
    ctx[method](text, x, y);
    return;
  }
  let cursor = x;
  for (const character of text) {
    ctx[method](character, cursor, y);
    cursor += ctx.measureText(character).width + spacing;
  }
}

export class NativeTextCache {
  constructor(driver) {
    this.driver = driver;
    this.measureCanvas = createCanvas();
    this.measureContext = this.measureCanvas.getContext("2d");
    this.entries = new Map();
  }

  measure(text, font, letterSpacing = "0px") {
    const source = String(text ?? "");
    const spacing = parseLetterSpacing(letterSpacing);
    this.measureContext.font = font;
    const metrics = this.measureContext.measureText(source);
    return {
      width: metrics.width + Math.max(0, source.length - 1) * spacing,
      ascent: metrics.actualBoundingBoxAscent || Math.max(8, Number.parseFloat(font) * 0.82 || 10),
      descent: metrics.actualBoundingBoxDescent || Math.max(2, Number.parseFloat(font) * 0.22 || 3),
    };
  }

  keyFor(options) {
    return [
      options.kind,
      options.text,
      options.font,
      options.style,
      options.lineWidth,
      options.letterSpacing,
      options.shadowColor,
      options.shadowBlur,
    ].join("\u001f");
  }

  get(options) {
    const key = this.keyFor(options);
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached;
    }
    const metrics = this.measure(options.text, options.font, options.letterSpacing);
    const padding = Math.ceil(Math.max(3, options.shadowBlur * 1.5 + options.lineWidth + 2));
    const logicalWidth = Math.max(1, Math.ceil(metrics.width + padding * 2));
    const logicalHeight = Math.max(1, Math.ceil(metrics.ascent + metrics.descent + padding * 2));
    const surface = createCanvas(
      Math.ceil(logicalWidth * TEXTURE_SCALE),
      Math.ceil(logicalHeight * TEXTURE_SCALE),
    );
    const ctx = surface.getContext("2d");
    ctx.scale(TEXTURE_SCALE, TEXTURE_SCALE);
    ctx.font = options.font;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.shadowColor = options.shadowColor || "transparent";
    ctx.shadowBlur = Math.max(0, options.shadowBlur || 0);
    const spacing = parseLetterSpacing(options.letterSpacing);
    const baseline = padding + metrics.ascent;
    if (options.kind === "stroke") {
      ctx.strokeStyle = options.style;
      ctx.lineWidth = Math.max(0.1, options.lineWidth || 1);
      drawSpacedText(ctx, options.text, padding, baseline, spacing, "strokeText");
    } else {
      ctx.fillStyle = options.style;
      drawSpacedText(ctx, options.text, padding, baseline, spacing, "fillText");
    }
    const entry = {
      texture: this.driver.createTexture(surface),
      width: logicalWidth,
      height: logicalHeight,
      contentWidth: metrics.width,
      ascent: metrics.ascent,
      descent: metrics.descent,
      padding,
    };
    this.entries.set(key, entry);
    while (this.entries.size > MAX_TEXT_TEXTURES) {
      const oldestKey = this.entries.keys().next().value;
      const oldest = this.entries.get(oldestKey);
      this.driver.deleteTexture(oldest.texture);
      this.entries.delete(oldestKey);
    }
    return entry;
  }

  clear({ deleteTextures = true } = {}) {
    if (deleteTextures) {
      for (const entry of this.entries.values()) this.driver.deleteTexture(entry.texture);
    }
    this.entries.clear();
  }
}
