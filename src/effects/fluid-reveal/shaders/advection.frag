precision highp float;

uniform sampler2D tInput;
uniform sampler2D tVelocity;
uniform vec2 texelSize;
uniform float dt;
uniform float dissipation;
uniform int mode;

varying vec2 vUv;

vec2 decodeVelocity(vec4 value) {
  return value.xy * 2.0 - 1.0;
}

vec4 encodeVelocity(vec2 velocity) {
  vec2 v = clamp(velocity, -1.0, 1.0) * 0.5 + 0.5;
  return vec4(v, 0.5, 1.0);
}

void main() {
  vec2 velocity = decodeVelocity(texture2D(tVelocity, vUv));
  vec2 backUv = vUv - velocity * dt * vec2(0.45, 0.45);
  backUv = clamp(backUv, texelSize, 1.0 - texelSize);
  vec4 advected = texture2D(tInput, backUv);

  if (mode == 0) {
    vec2 v = decodeVelocity(advected) * dissipation;
    gl_FragColor = encodeVelocity(v);
  } else {
    gl_FragColor = vec4(advected.rgb * dissipation, advected.a);
  }
}
