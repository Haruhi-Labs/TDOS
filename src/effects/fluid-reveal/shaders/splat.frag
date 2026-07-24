precision highp float;

uniform sampler2D tInput;
uniform vec2 point;
uniform vec2 delta;
uniform float radius;
uniform float force;
uniform float aspect;
uniform float curlStrength;
uniform float time;
uniform int mode;

varying vec2 vUv;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

vec2 decodeVelocity(vec4 value) {
  return value.xy * 2.0 - 1.0;
}

vec4 encodeVelocity(vec2 velocity) {
  vec2 v = clamp(velocity, -1.0, 1.0) * 0.5 + 0.5;
  return vec4(v, 0.5, 1.0);
}

void main() {
  vec4 base = texture2D(tInput, vUv);
  vec2 p = vUv - point;
  p.x *= aspect;
  float d = length(p);
  float angle = atan(p.y, p.x);
  vec2 dir = normalize(delta + vec2(0.0001, 0.0));
  vec2 normal = vec2(-dir.y, dir.x);
  float along = dot(p, dir);
  float across = dot(p, normal);
  float tail = max(0.0, -along);
  float directionalWake =
    exp(-(across * across) / max(0.00006, radius * radius * 0.12)) *
    smoothstep(radius * 5.4, 0.0, tail) *
    exp(-max(0.0, along) / max(0.0001, radius * 0.42));
  float turbulence = 0.74
    + 0.18 * sin(angle * 5.0 + time * 3.1)
    + 0.14 * hash(floor((vUv + time * 0.013) * 42.0));
  float blob = exp(-(d * d) / max(0.00008, radius * radius));
  float wake = max(blob * 0.72, directionalWake * 1.45) * turbulence;
  vec2 swirl = vec2(-p.y, p.x) * curlStrength * wake;

  if (mode == 0) {
    vec2 current = decodeVelocity(base);
    vec2 push = delta * force * 0.035 + swirl * force * 0.42;
    gl_FragColor = encodeVelocity(current + push * wake);
  } else {
    float existing = base.r;
    float impulse = wake * force;
    if (mode == 1) {
      impulse *= 0.24;
    } else {
      impulse *= 0.32;
    }
    float value = clamp(existing + impulse, 0.0, 1.0);
    gl_FragColor = vec4(value, value * wake, wake, 1.0);
  }
}
