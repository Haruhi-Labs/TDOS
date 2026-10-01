const MAX_TEXT_TEXTURES = 320;
const MAX_TEXT_BYTES = 32 * 1024 * 1024;

function createCanvas(width = 1, height = 1) {
  // 页面字形沿用文档的语言与字体环境；无 DOM 的渲染环境再使用 OffscreenCanvas。
  if (typeof document === "undefined") return new OffscreenCanvas(width, height);
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
  constructor(driver, { maxBytes = MAX_TEXT_BYTES } = {}) {
    this.driver = driver;
    this.measureCanvas = createCanvas();
    this.measureContext = this.measureCanvas.getContext("2d");
    this.entries = new Map();
    this.maxBytes = maxBytes;
    this.bytes = 0;
    this.inFrame = false;
    this.used = new Set();
  }

  measure(text, font, letterSpacing = "0px") {
    const source = String(text ?? "");
    const spacing = parseLetterSpacing(letterSpacing);
    this.measureContext.font = font;
    const metrics = this.measureContext.measureText(source);
    // 零边距是合法测量值；仅缺少字形度量时兜底，并从 px 字号取值，避免把字重当字号。
    const fontSize = Number(this.measureContext.font.match(/(?:^|\s)(\d+(?:\.\d+)?)px(?:\s|\/|$)/)?.[1]) || 12;
    return {
      width: metrics.width + Math.max(0, source.length - 1) * spacing,
      ascent: Number.isFinite(metrics.actualBoundingBoxAscent) ? metrics.actualBoundingBoxAscent : Math.max(8, fontSize * 0.82),
      descent: Number.isFinite(metrics.actualBoundingBoxDescent) ? metrics.actualBoundingBoxDescent : Math.max(2, fontSize * 0.22),
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
      options.textureScale,
    ].join("\u001f");
  }

  get(options) {
    // 整数密度档位避免平滑缩放每帧上传；既有的两倍采样作为最低精度保留。
    options = { ...options, textureScale: Math.max(2, Math.ceil(Number(options.scale) || 1)) };
    const key = this.keyFor(options);
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      if (this.inFrame) this.used.add(key);
      return cached;
    }
    const metrics = this.measure(options.text, options.font, options.letterSpacing);
    const padding = Math.ceil(Math.max(3, options.shadowBlur * 1.5 + options.lineWidth + 2));
    const logicalWidth = Math.max(1, Math.ceil(metrics.width + padding * 2));
    const logicalHeight = Math.max(1, Math.ceil(metrics.ascent + metrics.descent + padding * 2));
    const textureScale = Math.min(options.textureScale, (this.driver.maxTextureSize || 8192) / Math.max(logicalWidth, logicalHeight));
    const surface = createCanvas(
      Math.ceil(logicalWidth * textureScale),
      Math.ceil(logicalHeight * textureScale),
    );
    const ctx = surface.getContext("2d");
    ctx.scale(textureScale, textureScale);
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
      textureScale,
      bytes: surface.width * surface.height * 4,
    };
    this.entries.set(key, entry);
    this.bytes += entry.bytes;
    if (this.inFrame) this.used.add(key);
    this.prune();
    return entry;
  }

  beginFrame() { this.inFrame = true; this.used.clear(); }
  endFrame() { this.inFrame = false; this.used.clear(); this.prune(); }

  prune() {
    for (const [oldestKey, oldest] of this.entries) {
      if (this.entries.size <= MAX_TEXT_TEXTURES && this.bytes <= this.maxBytes) break;
      // GPU 尚未提交的本帧字形不能提前删除；提交后再完成预算回收。
      if (this.used.has(oldestKey)) continue;
      this.driver.deleteTexture(oldest.texture);
      this.entries.delete(oldestKey);
      this.bytes -= oldest.bytes;
    }
  }

  clear({ deleteTextures = true } = {}) {
    if (deleteTextures) {
      for (const entry of this.entries.values()) this.driver.deleteTexture(entry.texture);
    }
    this.entries.clear();
    this.used.clear();
    this.bytes = 0;
  }
}
