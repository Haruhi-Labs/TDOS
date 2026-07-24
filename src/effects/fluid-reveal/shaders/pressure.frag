precision highp float;

uniform sampler2D tPressure;
uniform sampler2D tDivergence;
uniform vec2 texelSize;

varying vec2 vUv;

float pressureAt(vec2 uv) {
  return texture2D(tPressure, uv).r;
}

void main() {
  float left = pressureAt(vUv - vec2(texelSize.x, 0.0));
  float right = pressureAt(vUv + vec2(texelSize.x, 0.0));
  float bottom = pressureAt(vUv - vec2(0.0, texelSize.y));
  float top = pressureAt(vUv + vec2(0.0, texelSize.y));
  float divergence = texture2D(tDivergence, vUv).r - 0.5;
  float pressure = (left + right + bottom + top - divergence) * 0.25;
  gl_FragColor = vec4(pressure, pressure, pressure, 1.0);
}
