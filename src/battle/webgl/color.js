const NAMED_COLORS = Object.freeze({
  transparent: [0, 0, 0, 0],
  black: [0, 0, 0, 1],
  white: [1, 1, 1, 1],
  red: [1, 0, 0, 1],
});

function byte(value) {
  return Math.max(0, Math.min(255, Number(value) || 0)) / 255;
}

export function parseColor(value) {
  if (Array.isArray(value)) {
    return [value[0] || 0, value[1] || 0, value[2] || 0, value[3] ?? 1];
  }
  const source = String(value || "transparent").trim().toLowerCase();
  if (NAMED_COLORS[source]) return [...NAMED_COLORS[source]];
  if (source.startsWith("#")) {
    const hex = source.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      return [
        parseInt(hex[0] + hex[0], 16) / 255,
        parseInt(hex[1] + hex[1], 16) / 255,
        parseInt(hex[2] + hex[2], 16) / 255,
        hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : 1,
      ];
    }
    if (hex.length === 6 || hex.length === 8) {
      return [
        parseInt(hex.slice(0, 2), 16) / 255,
        parseInt(hex.slice(2, 4), 16) / 255,
        parseInt(hex.slice(4, 6), 16) / 255,
        hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
      ];
    }
  }
  const rgb = source.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const values = rgb[1].split(",").map((part) => part.trim());
    return [
      byte(values[0]),
      byte(values[1]),
      byte(values[2]),
      values[3] === undefined ? 1 : Math.max(0, Math.min(1, Number(values[3]) || 0)),
    ];
  }
  return [1, 1, 1, 1];
}

function mixColor(left, right, ratio) {
  const t = Math.max(0, Math.min(1, ratio));
  return [
    left[0] + (right[0] - left[0]) * t,
    left[1] + (right[1] - left[1]) * t,
    left[2] + (right[2] - left[2]) * t,
    left[3] + (right[3] - left[3]) * t,
  ];
}

export class NativeGradient {
  constructor(type, geometry) {
    this.nativeGradient = true;
    this.type = type;
    this.geometry = geometry;
    this.stops = [];
  }

  addColorStop(offset, color) {
    const stop = Math.max(0, Math.min(1, Number(offset) || 0));
    this.stops.push({ offset: stop, color: parseColor(color) });
    this.stops.sort((a, b) => a.offset - b.offset);
  }

  ratioAt(x, y) {
    if (this.type === "linear") {
      const { x0, y0, x1, y1 } = this.geometry;
      const dx = x1 - x0;
      const dy = y1 - y0;
      const lengthSquared = dx * dx + dy * dy;
      return lengthSquared > 1e-9 ? ((x - x0) * dx + (y - y0) * dy) / lengthSquared : 0;
    }
    const { x1, y1, r0, r1 } = this.geometry;
    const span = Math.max(1e-6, r1 - r0);
    return (Math.hypot(x - x1, y - y1) - r0) / span;
  }

  colorAt(x, y) {
    if (this.stops.length === 0) return [0, 0, 0, 0];
    const ratio = Math.max(0, Math.min(1, this.ratioAt(x, y)));
    if (ratio <= this.stops[0].offset) return [...this.stops[0].color];
    const last = this.stops.at(-1);
    if (ratio >= last.offset) return [...last.color];
    for (let index = 1; index < this.stops.length; index += 1) {
      const right = this.stops[index];
      if (ratio > right.offset) continue;
      const left = this.stops[index - 1];
      const span = Math.max(1e-6, right.offset - left.offset);
      return mixColor(left.color, right.color, (ratio - left.offset) / span);
    }
    return [...last.color];
  }
}

export function styleColorAt(style, x, y, alpha = 1) {
  const color = style?.nativeGradient ? style.colorAt(x, y) : parseColor(style);
  return [color[0], color[1], color[2], color[3] * alpha];
}
