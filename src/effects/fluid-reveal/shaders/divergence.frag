precision highp float;

uniform sampler2D tVelocity;
uniform vec2 texelSize;

varying vec2 vUv;

vec2 velocityAt(vec2 uv) {
  return texture2D(tVelocity, uv).xy * 2.0 - 1.0;
}

void main() {
  float left = velocityAt(vUv - vec2(texelSize.x, 0.0)).x;
  float right = velocityAt(vUv + vec2(texelSize.x, 0.0)).x;
  float bottom = velocityAt(vUv - vec2(0.0, texelSize.y)).y;
  float top = velocityAt(vUv + vec2(0.0, texelSize.y)).y;
  float divergence = 0.5 * (right - left + top - bottom);
  gl_FragColor = vec4(divergence * 0.5 + 0.5, 0.0, 0.0, 1.0);
}
