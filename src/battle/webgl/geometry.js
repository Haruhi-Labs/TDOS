const TAU = Math.PI * 2;

function samePoint(a, b) {
  return Math.abs(a.x - b.x) < 1e-5 && Math.abs(a.y - b.y) < 1e-5;
}

function cross(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function polygonArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area * 0.5;
}

function pointInTriangle(point, a, b, c) {
  const ab = cross(a, b, point);
  const bc = cross(b, c, point);
  const ca = cross(c, a, point);
  const hasNegative = ab < -1e-6 || bc < -1e-6 || ca < -1e-6;
  const hasPositive = ab > 1e-6 || bc > 1e-6 || ca > 1e-6;
  return !(hasNegative && hasPositive);
}

function cleanPolygon(source) {
  const points = [];
  for (const point of source || []) {
    if (!points.length || !samePoint(points.at(-1), point)) points.push(point);
  }
  if (points.length > 2 && samePoint(points[0], points.at(-1))) points.pop();
  let changed = true;
  while (changed && points.length > 3) {
    changed = false;
    for (let index = 0; index < points.length; index += 1) {
      const previous = points[(index - 1 + points.length) % points.length];
      const current = points[index];
      const next = points[(index + 1) % points.length];
      if (Math.abs(cross(previous, current, next)) < 1e-6) {
        points.splice(index, 1);
        changed = true;
        break;
      }
    }
  }
  return points;
}

export function triangulatePolygon(source) {
  const points = cleanPolygon(source);
  if (points.length < 3) return [];
  const ccw = polygonArea(points) > 0;
  const indices = points.map((_, index) => index);
  const triangles = [];
  let guard = points.length * points.length;
  while (indices.length > 3 && guard > 0) {
    guard -= 1;
    let clipped = false;
    for (let cursor = 0; cursor < indices.length; cursor += 1) {
      const previousIndex = indices[(cursor - 1 + indices.length) % indices.length];
      const currentIndex = indices[cursor];
      const nextIndex = indices[(cursor + 1) % indices.length];
      const a = points[previousIndex];
      const b = points[currentIndex];
      const c = points[nextIndex];
      const convex = ccw ? cross(a, b, c) > 1e-7 : cross(a, b, c) < -1e-7;
      if (!convex) continue;
      let containsPoint = false;
      for (const candidateIndex of indices) {
        if (candidateIndex === previousIndex || candidateIndex === currentIndex || candidateIndex === nextIndex) continue;
        if (pointInTriangle(points[candidateIndex], a, b, c)) {
          containsPoint = true;
          break;
        }
      }
      if (containsPoint) continue;
      triangles.push([a, b, c]);
      indices.splice(cursor, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (indices.length === 3) {
    triangles.push(indices.map((index) => points[index]));
  }
  if (triangles.length === 0) {
    for (let index = 1; index < points.length - 1; index += 1) {
      triangles.push([points[0], points[index], points[index + 1]]);
    }
  }
  return triangles;
}

export function sampleQuadratic(start, control, end) {
  const approximateLength = Math.hypot(control.x - start.x, control.y - start.y)
    + Math.hypot(end.x - control.x, end.y - control.y);
  const segments = Math.max(4, Math.min(48, Math.ceil(approximateLength / 10)));
  const points = [];
  for (let index = 1; index <= segments; index += 1) {
    const t = index / segments;
    const rest = 1 - t;
    points.push({
      x: rest * rest * start.x + 2 * rest * t * control.x + t * t * end.x,
      y: rest * rest * start.y + 2 * rest * t * control.y + t * t * end.y,
    });
  }
  return points;
}

function normalizedSweep(start, end, anticlockwise) {
  let sweep = end - start;
  if (!anticlockwise) {
    while (sweep < 0) sweep += TAU;
    if (sweep > TAU) sweep = TAU;
  } else {
    while (sweep > 0) sweep -= TAU;
    if (sweep < -TAU) sweep = -TAU;
  }
  if (Math.abs(end - start) >= TAU - 1e-6) return anticlockwise ? -TAU : TAU;
  return sweep;
}

export function sampleEllipse({
  cx,
  cy,
  rx,
  ry,
  rotation = 0,
  start = 0,
  end = TAU,
  anticlockwise = false,
  transform,
}) {
  const sweep = normalizedSweep(start, end, anticlockwise);
  const radius = Math.max(Math.abs(rx), Math.abs(ry));
  const segments = Math.max(8, Math.min(96, Math.ceil(Math.abs(sweep) * Math.max(2, radius / 7))));
  const cosRotation = Math.cos(rotation);
  const sinRotation = Math.sin(rotation);
  const points = [];
  for (let index = 0; index <= segments; index += 1) {
    const angle = start + sweep * (index / segments);
    const localX = Math.cos(angle) * rx;
    const localY = Math.sin(angle) * ry;
    const x = cx + localX * cosRotation - localY * sinRotation;
    const y = cy + localX * sinRotation + localY * cosRotation;
    points.push(transform(x, y));
  }
  return { points, full: Math.abs(sweep) >= TAU - 1e-4 };
}

function normalizeDash(pattern) {
  const safe = (pattern || []).map((value) => Math.max(0, Number(value) || 0)).filter((value) => value > 1e-6);
  if (safe.length % 2 === 1) return [...safe, ...safe];
  return safe;
}

function dashedSegments(points, closed, pattern, offset) {
  const source = closed ? [...points, points[0]] : points;
  const dash = normalizeDash(pattern);
  if (dash.length === 0) {
    const result = [];
    for (let index = 1; index < source.length; index += 1) result.push([source[index - 1], source[index]]);
    return result;
  }
  const period = dash.reduce((sum, value) => sum + value, 0);
  let cursor = ((Number(offset) || 0) % period + period) % period;
  let dashIndex = 0;
  while (cursor >= dash[dashIndex] && dash[dashIndex] > 0) {
    cursor -= dash[dashIndex];
    dashIndex = (dashIndex + 1) % dash.length;
  }
  let remaining = dash[dashIndex] - cursor;
  let drawing = dashIndex % 2 === 0;
  const result = [];
  for (let segmentIndex = 1; segmentIndex < source.length; segmentIndex += 1) {
    const start = source[segmentIndex - 1];
    const end = source[segmentIndex];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) continue;
    let traveled = 0;
    while (traveled < length - 1e-6) {
      const step = Math.min(remaining, length - traveled);
      if (drawing && step > 1e-6) {
        const fromRatio = traveled / length;
        const toRatio = (traveled + step) / length;
        result.push([
          { x: start.x + dx * fromRatio, y: start.y + dy * fromRatio },
          { x: start.x + dx * toRatio, y: start.y + dy * toRatio },
        ]);
      }
      traveled += step;
      remaining -= step;
      if (remaining <= 1e-6) {
        dashIndex = (dashIndex + 1) % dash.length;
        remaining = dash[dashIndex];
        drawing = dashIndex % 2 === 0;
      }
    }
  }
  return result;
}

function segmentQuad(start, end, halfWidth) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.max(1e-6, Math.hypot(dx, dy));
  const nx = (-dy / length) * halfWidth;
  const ny = (dx / length) * halfWidth;
  return [
    { x: start.x + nx, y: start.y + ny },
    { x: start.x - nx, y: start.y - ny },
    { x: end.x - nx, y: end.y - ny },
    { x: end.x + nx, y: end.y + ny },
  ];
}

function circleTriangles(center, radius, segments = 6) {
  const triangles = [];
  for (let index = 0; index < segments; index += 1) {
    const first = (index / segments) * TAU;
    const second = ((index + 1) / segments) * TAU;
    triangles.push([
      center,
      { x: center.x + Math.cos(first) * radius, y: center.y + Math.sin(first) * radius },
      { x: center.x + Math.cos(second) * radius, y: center.y + Math.sin(second) * radius },
    ]);
  }
  return triangles;
}

export function triangulateStroke(points, {
  closed = false,
  width = 1,
  dash = [],
  dashOffset = 0,
  lineCap = "butt",
  lineJoin = "miter",
  fastRing = false,
} = {}) {
  if (!points || points.length < 2 || width <= 0) return [];
  const halfWidth = width * 0.5;
  // 完整圆环和封闭多边形直接生成内外两圈，每段只需两个三角形；
  // 避免把 Canvas 的 round join 朴素展开成上千个重复圆帽。
  if (closed && fastRing && (!dash || dash.length === 0)) {
    const center = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
    center.x /= points.length;
    center.y /= points.length;
    const outer = [];
    const inner = [];
    for (const point of points) {
      const dx = point.x - center.x;
      const dy = point.y - center.y;
      const length = Math.max(1e-6, Math.hypot(dx, dy));
      outer.push({ x: point.x + (dx / length) * halfWidth, y: point.y + (dy / length) * halfWidth });
      inner.push({ x: point.x - (dx / length) * halfWidth, y: point.y - (dy / length) * halfWidth });
    }
    const triangles = [];
    for (let index = 0; index < points.length; index += 1) {
      const next = (index + 1) % points.length;
      triangles.push(
        [outer[index], inner[index], inner[next]],
        [outer[index], inner[next], outer[next]],
      );
    }
    return triangles;
  }
  const segments = dashedSegments(points, closed, dash, dashOffset);
  const triangles = [];
  for (const [start, end] of segments) {
    const quad = segmentQuad(start, end, halfWidth);
    triangles.push([quad[0], quad[1], quad[2]], [quad[0], quad[2], quad[3]]);
  }
  // 相邻粗线四边形天然重叠，逐节点追加圆形 join 会把雷达长虚线膨胀为数万三角形。
  // 只给完整连续线保留两个端帽；虚线的短矩形在战场尺度下视觉差异不可感知。
  if (dash.length === 0 && lineCap === "round" && !closed) {
    triangles.push(...circleTriangles(points[0], halfWidth), ...circleTriangles(points.at(-1), halfWidth));
  }
  return triangles;
}

export function boundsForSubpaths(subpaths) {
  const points = subpaths.flatMap((subpath) => subpath.points || []);
  if (points.length === 0) return null;
  return points.reduce((bounds, point) => ({
    left: Math.min(bounds.left, point.x),
    top: Math.min(bounds.top, point.y),
    right: Math.max(bounds.right, point.x),
    bottom: Math.max(bounds.bottom, point.y),
  }), {
    left: Infinity,
    top: Infinity,
    right: -Infinity,
    bottom: -Infinity,
  });
}

export function radialRingTriangles(points, ratios) {
  const polygon = cleanPolygon(points);
  if (polygon.length < 3) return [];
  const center = polygon.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  center.x /= polygon.length;
  center.y /= polygon.length;
  const levels = [...new Set([0, ...ratios, 1].map((ratio) => Math.max(0, Math.min(1, ratio))))].sort((a, b) => a - b);
  const triangles = [];
  let previous = polygon.map(() => center);
  for (let levelIndex = 1; levelIndex < levels.length; levelIndex += 1) {
    const ratio = levels[levelIndex];
    const current = polygon.map((point) => ({
      x: center.x + (point.x - center.x) * ratio,
      y: center.y + (point.y - center.y) * ratio,
    }));
    for (let index = 0; index < polygon.length; index += 1) {
      const next = (index + 1) % polygon.length;
      triangles.push(
        [previous[index], current[index], current[next]],
        [previous[index], current[next], previous[next]],
      );
    }
    previous = current;
  }
  return triangles;
}
