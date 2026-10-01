export function identityMatrix() {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

export function copyMatrix(matrix) {
  return { ...matrix };
}

export function multiplyMatrix(left, right) {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

export function transformPoint(matrix, x, y) {
  return {
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f,
  };
}

export function matrixScale(matrix) {
  return Math.max(
    1e-6,
    (Math.hypot(matrix.a, matrix.b) + Math.hypot(matrix.c, matrix.d)) * 0.5,
  );
}

// 最大伸缩率也覆盖旋转与非等比缩放，字形不能沿较长的一轴欠采样。
export function matrixMaxScale({ a, b, c, d }) {
  const x = a * a + b * b;
  const y = c * c + d * d;
  const cross = a * c + b * d;
  return Math.sqrt(Math.max(0, (x + y + Math.hypot(x - y, 2 * cross)) * 0.5));
}
