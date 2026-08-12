import { NativeGradient, parseColor, styleColorAt } from "./color.js";
import {
  boundsForSubpaths,
  radialRingTriangles,
  sampleEllipse,
  sampleQuadratic,
  triangulatePolygon,
  triangulateStroke,
} from "./geometry.js";
import {
  copyMatrix,
  identityMatrix,
  matrixScale,
  multiplyMatrix,
  transformPoint,
} from "./matrix.js";
import { appendColorCommand, appendRadarCommand, appendTextureCommand } from "./driver.js";
import { NativeTextCache } from "./text-cache.js";
import { drawNativeProjectileBatch } from "./projectile-batch.js";

const TAU = Math.PI * 2;

function defaultState() {
  return {
    transform: identityMatrix(),
    clip: null,
    fillStyle: "#000000",
    strokeStyle: "#000000",
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    lineDash: [],
    lineDashOffset: 0,
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
    letterSpacing: "0px",
    shadowColor: "transparent",
    shadowBlur: 0,
  };
}

function cloneState(state) {
  return {
    ...state,
    transform: copyMatrix(state.transform),
    clip: state.clip ? { ...state.clip } : null,
    lineDash: [...state.lineDash],
  };
}

function intersectBounds(left, right) {
  if (!left) return right ? { ...right } : null;
  if (!right) return { ...left };
  return {
    left: Math.max(left.left, right.left),
    top: Math.max(left.top, right.top),
    right: Math.min(left.right, right.right),
    bottom: Math.min(left.bottom, right.bottom),
  };
}

function styleAsCss(style) {
  return typeof style === "string" ? style : "#ffffff";
}

function appendVertex(target, point, color) {
  target.push(point.x, point.y, color[0], color[1], color[2], color[3]);
}

function appendTexturedVertex(target, point, u, v, colorOrAlpha) {
  const color = Array.isArray(colorOrAlpha) ? colorOrAlpha : [1, 1, 1, colorOrAlpha];
  target.push(point.x, point.y, u, v, color[0], color[1], color[2], color[3]);
}

function polygonCenter(points) {
  const center = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  center.x /= Math.max(1, points.length);
  center.y /= Math.max(1, points.length);
  return center;
}

function scaledTriangles(triangles, center, ratio) {
  return triangles.map((triangle) => triangle.map((point) => ({
    x: center.x + (point.x - center.x) * ratio,
    y: center.y + (point.y - center.y) * ratio,
  })));
}

function createSoftDiscImage(size = 64) {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = ((x + 0.5) / size) * 2 - 1;
      const ny = ((y + 0.5) / size) * 2 - 1;
      const distance = Math.hypot(nx, ny);
      const alpha = Math.max(0, Math.min(1, (1.02 - distance) * size * 0.5));
      const offset = (y * size + x) * 4;
      pixels[offset] = 255;
      pixels[offset + 1] = 255;
      pixels[offset + 2] = 255;
      pixels[offset + 3] = Math.round(alpha * 255);
    }
  }
  return new ImageData(pixels, size, size);
}

export class NativeBattleContext {
  constructor(canvas, driver) {
    this.canvas = canvas;
    this.driver = driver;
    this.nativeWebGL = true;
    this.state = defaultState();
    this.stack = [];
    this.commands = [];
    this.path = [];
    this.currentSubpath = null;
    this.textCache = new NativeTextCache(driver);
    this.imageTextures = new WeakMap();
    this.liveImageTextures = new Set();
    this.discTexture = driver.createTexture(createSoftDiscImage(), { flipY: false });
    this.frameStats = driver.stats;
  }

  get fillStyle() { return this.state.fillStyle; }
  set fillStyle(value) { this.state.fillStyle = value; }
  get strokeStyle() { return this.state.strokeStyle; }
  set strokeStyle(value) { this.state.strokeStyle = value; }
  get globalAlpha() { return this.state.globalAlpha; }
  set globalAlpha(value) { this.state.globalAlpha = Math.max(0, Math.min(1, Number(value) || 0)); }
  get globalCompositeOperation() { return this.state.globalCompositeOperation; }
  set globalCompositeOperation(value) { this.state.globalCompositeOperation = value || "source-over"; }
  get lineWidth() { return this.state.lineWidth; }
  set lineWidth(value) { this.state.lineWidth = Math.max(0, Number(value) || 0); }
  get lineCap() { return this.state.lineCap; }
  set lineCap(value) { this.state.lineCap = value || "butt"; }
  get lineJoin() { return this.state.lineJoin; }
  set lineJoin(value) { this.state.lineJoin = value || "miter"; }
  get lineDashOffset() { return this.state.lineDashOffset; }
  set lineDashOffset(value) { this.state.lineDashOffset = Number(value) || 0; }
  get font() { return this.state.font; }
  set font(value) { this.state.font = String(value || "10px sans-serif"); }
  get textAlign() { return this.state.textAlign; }
  set textAlign(value) { this.state.textAlign = value || "start"; }
  get textBaseline() { return this.state.textBaseline; }
  set textBaseline(value) { this.state.textBaseline = value || "alphabetic"; }
  get letterSpacing() { return this.state.letterSpacing; }
  set letterSpacing(value) { this.state.letterSpacing = String(value || "0px"); }
  get shadowColor() { return this.state.shadowColor; }
  set shadowColor(value) { this.state.shadowColor = value || "transparent"; }
  get shadowBlur() { return this.state.shadowBlur; }
  set shadowBlur(value) { this.state.shadowBlur = Math.max(0, Number(value) || 0); }

  beginFrame({ skipDriver = false } = {}) {
    this.commands.length = 0;
    this.path.length = 0;
    this.currentSubpath = null;
    this.stack.length = 0;
    this.state = defaultState();
    if (!skipDriver) this.driver.beginFrame();
  }

  present() {
    this.driver.present(this.commands);
    this.frameStats = { ...this.driver.stats };
  }

  save() {
    this.stack.push(cloneState(this.state));
  }

  restore() {
    if (this.stack.length) this.state = this.stack.pop();
  }

  setTransform(a, b, c, d, e, f) {
    if (typeof a === "object" && a) {
      this.state.transform = {
        a: Number(a.a) || 0,
        b: Number(a.b) || 0,
        c: Number(a.c) || 0,
        d: Number(a.d) || 0,
        e: Number(a.e) || 0,
        f: Number(a.f) || 0,
      };
      return;
    }
    this.state.transform = {
      a: Number(a) || 0,
      b: Number(b) || 0,
      c: Number(c) || 0,
      d: Number(d) || 0,
      e: Number(e) || 0,
      f: Number(f) || 0,
    };
  }

  resetTransform() {
    this.state.transform = identityMatrix();
  }

  getTransform() {
    return copyMatrix(this.state.transform);
  }

  transform(a, b, c, d, e, f) {
    this.state.transform = multiplyMatrix(this.state.transform, { a, b, c, d, e, f });
  }

  translate(x, y) {
    this.state.transform = multiplyMatrix(this.state.transform, {
      a: 1, b: 0, c: 0, d: 1, e: Number(x) || 0, f: Number(y) || 0,
    });
  }

  rotate(angle) {
    const cosine = Math.cos(Number(angle) || 0);
    const sine = Math.sin(Number(angle) || 0);
    this.state.transform = multiplyMatrix(this.state.transform, {
      a: cosine, b: sine, c: -sine, d: cosine, e: 0, f: 0,
    });
  }

  scale(x, y = x) {
    this.state.transform = multiplyMatrix(this.state.transform, {
      a: Number(x) || 0, b: 0, c: 0, d: Number(y) || 0, e: 0, f: 0,
    });
  }

  point(x, y) {
    return transformPoint(this.state.transform, Number(x) || 0, Number(y) || 0);
  }

  beginPath() {
    this.path = [];
    this.currentSubpath = null;
  }

  moveTo(x, y) {
    const point = this.point(x, y);
    const subpath = { points: [point], closed: false };
    this.path.push(subpath);
    this.currentSubpath = subpath;
  }

  lineTo(x, y) {
    const point = this.point(x, y);
    if (!this.currentSubpath) {
      this.moveTo(x, y);
      return;
    }
    this.currentSubpath.points.push(point);
  }

  quadraticCurveTo(controlX, controlY, x, y) {
    if (!this.currentSubpath?.points?.length) {
      this.moveTo(controlX, controlY);
    }
    const start = this.currentSubpath.points.at(-1);
    const control = this.point(controlX, controlY);
    const end = this.point(x, y);
    this.currentSubpath.points.push(...sampleQuadratic(start, control, end));
  }

  ellipse(cx, cy, rx, ry, rotation, start, end, anticlockwise = false) {
    const sampled = sampleEllipse({
      cx: Number(cx) || 0,
      cy: Number(cy) || 0,
      rx: Math.max(0, Number(rx) || 0),
      ry: Math.max(0, Number(ry) || 0),
      rotation: Number(rotation) || 0,
      start: Number(start) || 0,
      end: Number(end) || 0,
      anticlockwise: Boolean(anticlockwise),
      transform: (x, y) => this.point(x, y),
    });
    const first = sampled.points[0];
    if (!this.currentSubpath) {
      const center = this.point(cx, cy);
      const cosRotation = Math.cos(Number(rotation) || 0);
      const sinRotation = Math.sin(Number(rotation) || 0);
      const axisX = this.point(
        cx + cosRotation * rx,
        cy + sinRotation * rx,
      );
      const axisY = this.point(
        cx - sinRotation * ry,
        cy + cosRotation * ry,
      );
      const vectorX = { x: axisX.x - center.x, y: axisX.y - center.y };
      const vectorY = { x: axisY.x - center.x, y: axisY.y - center.y };
      const subpath = {
        points: [],
        closed: sampled.full,
        ellipse: sampled.full,
        ellipseQuad: sampled.full ? [
          { x: center.x - vectorX.x - vectorY.x, y: center.y - vectorX.y - vectorY.y },
          { x: center.x + vectorX.x - vectorY.x, y: center.y + vectorX.y - vectorY.y },
          { x: center.x + vectorX.x + vectorY.x, y: center.y + vectorX.y + vectorY.y },
          { x: center.x - vectorX.x + vectorY.x, y: center.y - vectorX.y + vectorY.y },
        ] : null,
      };
      this.path.push(subpath);
      this.currentSubpath = subpath;
    } else if (this.currentSubpath.points.length && first) {
      const latest = this.currentSubpath.points.at(-1);
      if (Math.hypot(latest.x - first.x, latest.y - first.y) > 1e-5) this.currentSubpath.points.push(first);
    }
    const startIndex = this.currentSubpath.points.length && first === this.currentSubpath.points.at(-1) ? 1 : 0;
    this.currentSubpath.points.push(...sampled.points.slice(startIndex));
    if (sampled.full) {
      this.currentSubpath.closed = true;
      this.currentSubpath.ellipse = true;
    }
  }

  arc(cx, cy, radius, start, end, anticlockwise = false) {
    this.ellipse(cx, cy, radius, radius, 0, start, end, anticlockwise);
  }

  rect(x, y, width, height) {
    const subpath = {
      points: [
        this.point(x, y),
        this.point(x + width, y),
        this.point(x + width, y + height),
        this.point(x, y + height),
      ],
      closed: true,
    };
    this.path.push(subpath);
    this.currentSubpath = subpath;
  }

  arcTo(x1, y1, x2, y2, radius) {
    if (!this.currentSubpath?.points?.length) {
      this.moveTo(x1, y1);
      return;
    }
    const current = this.currentSubpath.points.at(-1);
    const corner = this.point(x1, y1);
    const next = this.point(x2, y2);
    const safeRadius = Math.max(0, Number(radius) || 0) * matrixScale(this.state.transform);
    const firstLength = Math.hypot(current.x - corner.x, current.y - corner.y);
    const secondLength = Math.hypot(next.x - corner.x, next.y - corner.y);
    if (safeRadius <= 0 || firstLength < 1e-6 || secondLength < 1e-6) {
      this.currentSubpath.points.push(corner);
      return;
    }
    const first = { x: (current.x - corner.x) / firstLength, y: (current.y - corner.y) / firstLength };
    const second = { x: (next.x - corner.x) / secondLength, y: (next.y - corner.y) / secondLength };
    const angle = Math.acos(Math.max(-1, Math.min(1, first.x * second.x + first.y * second.y)));
    const tangentLength = Math.min(firstLength, secondLength, safeRadius / Math.max(1e-5, Math.tan(angle * 0.5)));
    const tangentA = { x: corner.x + first.x * tangentLength, y: corner.y + first.y * tangentLength };
    const tangentB = { x: corner.x + second.x * tangentLength, y: corner.y + second.y * tangentLength };
    this.currentSubpath.points.push(tangentA);
    const steps = 5;
    for (let index = 1; index <= steps; index += 1) {
      const t = index / steps;
      const rest = 1 - t;
      this.currentSubpath.points.push({
        x: rest * rest * tangentA.x + 2 * rest * t * corner.x + t * t * tangentB.x,
        y: rest * rest * tangentA.y + 2 * rest * t * corner.y + t * t * tangentB.y,
      });
    }
  }

  closePath() {
    if (this.currentSubpath) this.currentSubpath.closed = true;
  }

  setLineDash(values) {
    this.state.lineDash = Array.from(values || [], (value) => Math.max(0, Number(value) || 0));
  }

  getLineDash() {
    return [...this.state.lineDash];
  }

  createLinearGradient(x0, y0, x1, y1) {
    const start = this.point(x0, y0);
    const end = this.point(x1, y1);
    return new NativeGradient("linear", { x0: start.x, y0: start.y, x1: end.x, y1: end.y });
  }

  createRadialGradient(x0, y0, r0, x1, y1, r1) {
    const start = this.point(x0, y0);
    const end = this.point(x1, y1);
    const scale = matrixScale(this.state.transform);
    return new NativeGradient("radial", {
      x0: start.x,
      y0: start.y,
      r0: Math.max(0, Number(r0) || 0) * scale,
      x1: end.x,
      y1: end.y,
      r1: Math.max(0, Number(r1) || 0) * scale,
    });
  }

  pushTriangles(triangles, style, alpha = this.state.globalAlpha) {
    const vertices = [];
    for (const triangle of triangles) {
      for (const point of triangle) appendVertex(vertices, point, styleColorAt(style, point.x, point.y, alpha));
    }
    appendColorCommand(
      this.commands,
      vertices,
      this.state.globalCompositeOperation,
      this.state.clip,
    );
  }

  pushTexturedQuad(texture, corners, color, uv = [0, 0, 1, 1]) {
    const [u0, v0, u1, v1] = uv;
    const [topLeft, topRight, bottomRight, bottomLeft] = corners;
    const vertices = [];
    appendTexturedVertex(vertices, topLeft, u0, v1, color);
    appendTexturedVertex(vertices, bottomLeft, u0, v0, color);
    appendTexturedVertex(vertices, bottomRight, u1, v0, color);
    appendTexturedVertex(vertices, topLeft, u0, v1, color);
    appendTexturedVertex(vertices, bottomRight, u1, v0, color);
    appendTexturedVertex(vertices, topRight, u1, v1, color);
    appendTextureCommand(
      this.commands,
      texture,
      vertices,
      this.state.globalCompositeOperation,
      this.state.clip,
    );
  }

  drawProjectileBatch(projectiles, ownSeat) {
    drawNativeProjectileBatch(this, projectiles, ownSeat);
  }

  drawRadarSweep(sourceX, sourceY, edgeX, edgeY) {
    const source = this.point(sourceX, sourceY);
    const edge = this.point(edgeX, edgeY);
    const dx = edge.x - source.x;
    const dy = edge.y - source.y;
    const screenLength = Math.max(1e-6, Math.hypot(dx, dy));
    const logicalLength = Math.max(1e-6, Math.hypot(edgeX - sourceX, edgeY - sourceY));
    const nx = -dy / screenLength;
    const ny = dx / screenLength;
    const halfWidth = 1.2 * matrixScale(this.state.transform);
    const corners = [
      { x: source.x - nx * halfWidth, y: source.y - ny * halfWidth, along: 0, across: -1.2 },
      { x: source.x + nx * halfWidth, y: source.y + ny * halfWidth, along: 0, across: 1.2 },
      { x: edge.x + nx * halfWidth, y: edge.y + ny * halfWidth, along: logicalLength, across: 1.2 },
      { x: edge.x - nx * halfWidth, y: edge.y - ny * halfWidth, along: logicalLength, across: -1.2 },
    ];
    const vertices = [];
    for (const index of [0, 1, 2, 0, 2, 3]) {
      const point = corners[index];
      vertices.push(point.x, point.y, point.along, point.across);
    }
    appendRadarCommand(this.commands, vertices, {
      blend: this.state.globalCompositeOperation,
      clip: this.state.clip,
      length: logicalLength,
      alpha: this.state.globalAlpha,
    });
  }

  shadowTriangles(triangles) {
    const shadow = parseColor(this.state.shadowColor);
    if (this.state.shadowBlur <= 0 || shadow[3] <= 0 || !triangles.length) return;
    const allPoints = triangles.flat();
    const center = polygonCenter(allPoints);
    const extent = Math.max(1, ...allPoints.map((point) => Math.hypot(point.x - center.x, point.y - center.y)));
    const scale = 1 + (this.state.shadowBlur * matrixScale(this.state.transform) * 0.6) / extent;
    this.pushTriangles(
      scaledTriangles(triangles, center, scale),
      this.state.shadowColor,
      this.state.globalAlpha * 0.22,
    );
  }

  fill() {
    if (
      this.path.length === 1
      && this.path[0]?.ellipseQuad
      && !this.state.fillStyle?.nativeGradient
    ) {
      const color = styleColorAt(this.state.fillStyle, 0, 0, this.state.globalAlpha);
      if (this.state.shadowBlur > 0 && parseColor(this.state.shadowColor)[3] > 0) {
        const corners = this.path[0].ellipseQuad;
        const center = polygonCenter(corners);
        const extent = Math.max(1, ...corners.map((point) => Math.hypot(point.x - center.x, point.y - center.y)));
        const ratio = 1 + (this.state.shadowBlur * matrixScale(this.state.transform) * 0.65) / extent;
        const shadowCorners = corners.map((point) => ({
          x: center.x + (point.x - center.x) * ratio,
          y: center.y + (point.y - center.y) * ratio,
        }));
        this.pushTexturedQuad(
          this.discTexture,
          shadowCorners,
          styleColorAt(this.state.shadowColor, 0, 0, this.state.globalAlpha * 0.22),
        );
      }
      this.pushTexturedQuad(this.discTexture, this.path[0].ellipseQuad, color);
      return;
    }
    const triangles = [];
    for (const subpath of this.path) {
      if (!subpath?.points || subpath.points.length < 3) continue;
      if (this.state.fillStyle?.nativeGradient && this.state.fillStyle.type === "radial" && subpath.ellipse) {
        const ratios = this.state.fillStyle.stops.map((stop) => stop.offset);
        triangles.push(...radialRingTriangles(subpath.points, ratios));
      } else {
        triangles.push(...triangulatePolygon(subpath.points));
      }
    }
    this.shadowTriangles(triangles);
    this.pushTriangles(triangles, this.state.fillStyle);
  }

  stroke() {
    const scale = matrixScale(this.state.transform);
    const options = {
      width: Math.max(0.01, this.state.lineWidth * scale),
      dash: this.state.lineDash.map((value) => value * scale),
      dashOffset: this.state.lineDashOffset * scale,
      lineCap: this.state.lineCap,
      lineJoin: this.state.lineJoin,
    };
    if (this.state.shadowBlur > 0 && parseColor(this.state.shadowColor)[3] > 0) {
      const glow = [];
      for (const subpath of this.path) {
        glow.push(...triangulateStroke(subpath.points, {
          ...options,
          closed: subpath.closed,
          fastRing: subpath.ellipse,
          width: options.width + this.state.shadowBlur * scale * 0.7,
          lineCap: "round",
          lineJoin: "round",
        }));
      }
      this.pushTriangles(glow, this.state.shadowColor, this.state.globalAlpha * 0.2);
    }
    const triangles = [];
    for (const subpath of this.path) {
      triangles.push(...triangulateStroke(subpath.points, {
        ...options,
        closed: subpath.closed,
        fastRing: subpath.ellipse,
      }));
    }
    this.pushTriangles(triangles, this.state.strokeStyle);
  }

  fillRect(x, y, width, height) {
    const points = [
      this.point(x, y),
      this.point(x + width, y),
      this.point(x + width, y + height),
      this.point(x, y + height),
    ];
    const triangles = [[points[0], points[1], points[2]], [points[0], points[2], points[3]]];
    this.shadowTriangles(triangles);
    this.pushTriangles(triangles, this.state.fillStyle);
  }

  strokeRect(x, y, width, height) {
    const previousPath = this.path;
    const previousSubpath = this.currentSubpath;
    this.path = [{
      points: [
        this.point(x, y),
        this.point(x + width, y),
        this.point(x + width, y + height),
        this.point(x, y + height),
      ],
      closed: true,
    }];
    this.currentSubpath = this.path[0];
    this.stroke();
    this.path = previousPath;
    this.currentSubpath = previousSubpath;
  }

  clearRect() {
    // 战场每帧由 beginFrame 清空；保留接口以兼容诊断代码。
  }

  clip() {
    const bounds = boundsForSubpaths(this.path);
    if (bounds) this.state.clip = intersectBounds(this.state.clip, bounds);
  }

  measureText(text) {
    const metrics = this.textCache.measure(String(text ?? ""), this.state.font, this.state.letterSpacing);
    return {
      width: metrics.width,
      actualBoundingBoxAscent: metrics.ascent,
      actualBoundingBoxDescent: metrics.descent,
    };
  }

  textTopLeft(entry, x, y) {
    const align = this.state.textAlign;
    let left = Number(x) || 0;
    if (align === "center") left -= entry.contentWidth * 0.5;
    else if (align === "right" || align === "end") left -= entry.contentWidth;
    left -= entry.padding;
    let top = Number(y) || 0;
    const contentHeight = entry.ascent + entry.descent;
    if (this.state.textBaseline === "top" || this.state.textBaseline === "hanging") {
      top -= entry.padding;
    } else if (this.state.textBaseline === "middle") {
      top -= contentHeight * 0.5 + entry.padding;
    } else if (this.state.textBaseline === "bottom" || this.state.textBaseline === "ideographic") {
      top -= contentHeight + entry.padding;
    } else {
      top -= entry.ascent + entry.padding;
    }
    return { left, top };
  }

  drawText(kind, text, x, y) {
    const style = kind === "stroke" ? this.state.strokeStyle : this.state.fillStyle;
    const entry = this.textCache.get({
      kind,
      text: String(text ?? ""),
      font: this.state.font,
      style: styleAsCss(style),
      lineWidth: this.state.lineWidth,
      letterSpacing: this.state.letterSpacing,
      shadowColor: this.state.shadowColor,
      shadowBlur: this.state.shadowBlur,
    });
    const { left, top } = this.textTopLeft(entry, x, y);
    const topLeft = this.point(left, top);
    const topRight = this.point(left + entry.width, top);
    const bottomRight = this.point(left + entry.width, top + entry.height);
    const bottomLeft = this.point(left, top + entry.height);
    const vertices = [];
    appendTexturedVertex(vertices, topLeft, 0, 1, this.state.globalAlpha);
    appendTexturedVertex(vertices, bottomLeft, 0, 0, this.state.globalAlpha);
    appendTexturedVertex(vertices, bottomRight, 1, 0, this.state.globalAlpha);
    appendTexturedVertex(vertices, topLeft, 0, 1, this.state.globalAlpha);
    appendTexturedVertex(vertices, bottomRight, 1, 0, this.state.globalAlpha);
    appendTexturedVertex(vertices, topRight, 1, 1, this.state.globalAlpha);
    appendTextureCommand(
      this.commands,
      entry.texture,
      vertices,
      this.state.globalCompositeOperation,
      this.state.clip,
    );
  }

  fillText(text, x, y) {
    this.drawText("fill", text, x, y);
  }

  strokeText(text, x, y) {
    this.drawText("stroke", text, x, y);
  }

  textureForImage(image) {
    let texture = this.imageTextures.get(image);
    if (texture) return texture;
    if (!image || !image.width || !image.height) return null;
    texture = this.driver.createTexture(image);
    this.imageTextures.set(image, texture);
    this.liveImageTextures.add(texture);
    return texture;
  }

  drawImage(image, ...args) {
    const texture = this.textureForImage(image);
    if (!texture) return;
    let sx = 0;
    let sy = 0;
    let sw = image.width;
    let sh = image.height;
    let dx;
    let dy;
    let dw;
    let dh;
    if (args.length === 2) {
      [dx, dy] = args;
      dw = image.width;
      dh = image.height;
    } else if (args.length === 4) {
      [dx, dy, dw, dh] = args;
    } else {
      [sx, sy, sw, sh, dx, dy, dw, dh] = args;
    }
    const u0 = sx / image.width;
    const v0 = 1 - sy / image.height;
    const u1 = (sx + sw) / image.width;
    const v1 = 1 - (sy + sh) / image.height;
    const topLeft = this.point(dx, dy);
    const topRight = this.point(dx + dw, dy);
    const bottomRight = this.point(dx + dw, dy + dh);
    const bottomLeft = this.point(dx, dy + dh);
    const vertices = [];
    appendTexturedVertex(vertices, topLeft, u0, v0, this.state.globalAlpha);
    appendTexturedVertex(vertices, bottomLeft, u0, v1, this.state.globalAlpha);
    appendTexturedVertex(vertices, bottomRight, u1, v1, this.state.globalAlpha);
    appendTexturedVertex(vertices, topLeft, u0, v0, this.state.globalAlpha);
    appendTexturedVertex(vertices, bottomRight, u1, v1, this.state.globalAlpha);
    appendTexturedVertex(vertices, topRight, u1, v0, this.state.globalAlpha);
    appendTextureCommand(
      this.commands,
      texture,
      vertices,
      this.state.globalCompositeOperation,
      this.state.clip,
    );
  }

  handleContextRestored() {
    this.textCache.clear({ deleteTextures: false });
    this.imageTextures = new WeakMap();
    this.liveImageTextures.clear();
    this.discTexture = this.driver.createTexture(createSoftDiscImage(), { flipY: false });
  }

  destroy() {
    this.textCache.clear();
    for (const texture of this.liveImageTextures) this.driver.deleteTexture(texture);
    this.liveImageTextures.clear();
    this.driver.deleteTexture(this.discTexture);
    this.discTexture = null;
  }
}
