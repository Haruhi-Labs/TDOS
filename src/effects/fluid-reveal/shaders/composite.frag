precision highp float;

uniform sampler2D tMain;
uniform sampler2D tReveal;
uniform sampler2D tVelocity;
uniform sampler2D tDensity;
uniform sampler2D tMask;
uniform sampler2D tPressure;
uniform vec2 resolution;
uniform float time;
uniform float mainAspect;
uniform float revealAspect;
uniform float distortionStrength;
uniform float revealStrength;
uniform float backgroundDarkness;
uniform float particleOpacity;
uniform float particleCount;
uniform float enabled;

varying vec2 vUv;

float hash(vec2 p) {
  p = fract(p * vec2(443.8975, 397.2973));
  p += dot(p, p.yx + 19.19);
  return fract(p.x * p.y);
}

vec2 coverUv(vec2 uv, float mediaAspect, float screenAspect) {
  vec2 scale = vec2(1.0);
  if (mediaAspect > screenAspect) {
    scale.x = screenAspect / mediaAspect;
  } else {
    scale.y = mediaAspect / screenAspect;
  }
  return (uv - 0.5) * scale + 0.5;
}

float starField(vec2 uv, float density) {
  vec2 grid = uv * mix(70.0, 170.0, clamp(density / 360.0, 0.0, 1.0));
  vec2 id = floor(grid);
  vec2 gv = fract(grid) - 0.5;
  float rnd = hash(id);
  float keep = step(0.965 - clamp(density / 700.0, 0.0, 0.13), rnd);
  float glow = smoothstep(0.045, 0.0, length(gv + vec2(hash(id + 7.1), hash(id + 2.6)) * 0.34 - 0.17));
  float twinkle = 0.45 + 0.55 * sin(time * (0.8 + rnd * 1.7) + rnd * 16.0);
  return keep * glow * twinkle;
}

void main() {
  float screenAspect = resolution.x / max(1.0, resolution.y);
  vec2 velocity = texture2D(tVelocity, vUv).xy * 2.0 - 1.0;
  float density = texture2D(tDensity, vUv).r;
  float mask = texture2D(tMask, vUv).r;
  float pressure = texture2D(tPressure, vUv).r - 0.5;

  vec2 flow = velocity * distortionStrength + vec2(pressure * 0.045, -pressure * 0.035);
  vec2 mainUv = coverUv(vUv + flow * enabled, mainAspect, screenAspect);
  vec2 revealUv = coverUv(vUv - flow * 1.65 * enabled, revealAspect, screenAspect);

  vec3 mainColor = texture2D(tMain, mainUv).rgb;
  float gray = dot(mainColor, vec3(0.299, 0.587, 0.114));
  mainColor = mix(vec3(gray), mainColor, 0.42) * (1.0 - backgroundDarkness);

  vec3 revealColor = texture2D(tReveal, revealUv).rgb;
  float fluidEdge = smoothstep(0.03, 0.82, mask * revealStrength + density * 0.52);
  float ragged = 0.78 + 0.22 * sin((vUv.x + vUv.y) * 45.0 + time * 2.0);
  fluidEdge *= ragged;

  vec3 color = mix(mainColor, revealColor, clamp(fluidEdge * enabled, 0.0, 1.0));
  float stars = starField(vUv + velocity * 0.016, particleCount);
  color += vec3(0.58, 0.75, 1.0) * stars * particleOpacity;
  color += vec3(0.08, 0.16, 0.34) * density * 0.16;
  color *= 1.0 - smoothstep(0.52, 1.18, length(vUv - 0.5)) * 0.52;

  gl_FragColor = vec4(color, 1.0);
}
