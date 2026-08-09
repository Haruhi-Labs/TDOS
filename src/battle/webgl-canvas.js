// 对战大地图的可见画布只持有 WebGL 上下文：优先 WebGL2，设备不支持时退回 WebGL1。
//
// 现有战场表现包含文字排版、渐变、虚线、阴影和角色立绘。为保证迁移前后逐像素一致，
// 这些共享绘制命令先落到一个不挂进 DOM 的 2D 合成面，再由 WebGL 全屏纹理提交到
// #gameCanvas。这样单人、联机、观战和移动端仍共用 src/battle/render.js，同时可见画布
// 已完全由 WebGL 驱动，不会触碰战场以外的 DOM。

const CONTEXT_ATTRIBUTES = Object.freeze({
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
  powerPreference: "high-performance",
});

const VERTEX_SHADER_WEBGL2 = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}`;

const RADAR_FRAGMENT_BODY = `
uniform sampler2D u_frame;
uniform vec2 u_resolution;
uniform float u_radarEnabled;
uniform vec2 u_radarSource;
uniform vec2 u_radarDirection;
uniform float u_radarLength;
uniform float u_radarTime;
uniform float u_radarAngularVelocity;
uniform float u_radarScale;

float radarHash(vec2 point) {
  vec3 seed = fract(vec3(point.xyx) * 0.1031);
  seed += dot(seed, seed.yzx + 33.33);
  return fract((seed.x + seed.y) * seed.z);
}

float radarLine(float distanceToLine, float width) {
  return exp(-distanceToLine / max(0.001, width));
}

void main() {
  vec4 base = SAMPLE_FRAME(u_frame, v_texCoord);
  vec3 radarLight = vec3(0.0);

  if (u_radarEnabled > 0.5) {
    // gl_FragCoord 原点在左下，转成与游戏世界一致的左上原点像素坐标。
    vec2 point = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);
    vec2 delta = point - u_radarSource;
    float radius = length(delta);
    float along = dot(delta, u_radarDirection);
    float across = abs(delta.x * u_radarDirection.y - delta.y * u_radarDirection.x);
    float scale = max(0.75, u_radarScale);
    float forward = smoothstep(-2.0 * scale, 1.5 * scale, along)
      * (1.0 - smoothstep(u_radarLength * 0.82, u_radarLength, along));

    // 现实雷达的扫描线：窄冰白亮芯、磷光主线和低亮宽域辉光。
    float wideGlow = radarLine(across, 9.5 * scale) * 0.16;
    float phosphorLine = radarLine(across, 2.2 * scale) * 0.5;
    float whiteCore = radarLine(across, 0.58 * scale) * 0.92;
    float radialFalloff = 1.0 - smoothstep(u_radarLength * 0.28, u_radarLength, along);
    radarLight += vec3(0.13, 0.86, 0.72) * (wideGlow + phosphorLine) * forward;
    radarLight += vec3(0.78, 1.0, 0.96) * whiteCore * forward * (0.72 + radialFalloff * 0.28);

    // 扫描头经过后的荧光余辉。旋转方向由权威雷达角速度决定，余辉永远拖在扫线之后。
    float directionAngle = atan(u_radarDirection.y, u_radarDirection.x);
    float pointAngle = atan(delta.y, delta.x);
    float signedAngle = atan(sin(pointAngle - directionAngle), cos(pointAngle - directionAngle));
    float spinDirection = u_radarAngularVelocity >= 0.0 ? 1.0 : -1.0;
    float trailAngle = signedAngle * -spinDirection;
    float trailWindow = step(0.0, trailAngle) * (1.0 - smoothstep(0.0, 0.31, trailAngle));
    float persistence = exp(-trailAngle * 8.5) * trailWindow;
    float trailRadius = smoothstep(8.0 * scale, 34.0 * scale, radius)
      * (1.0 - smoothstep(u_radarLength * 0.88, u_radarLength * 1.08, radius));

    // 同心测距环只在余辉区域短暂显影，避免与战区九宫格争抢层级。
    float ringSpacing = 168.0 * scale;
    float ringDistance = abs(fract(radius / ringSpacing + 0.5) - 0.5) * ringSpacing;
    float rangeRing = radarLine(ringDistance, 1.05 * scale);
    float sweepGrain = radarHash(floor(point / max(1.0, 3.0 * scale)) + floor(u_radarTime * 9.0));
    float phosphorNoise = mix(0.72, 1.18, sweepGrain);
    radarLight += vec3(0.08, 0.62, 0.49)
      * persistence * trailRadius * phosphorNoise * (0.085 + rangeRing * 0.15);

    // 两侧数据轨与三枚高速数据包，让扫线像舰载传感器而不是普通渐变线。
    float rail = radarLine(abs(across - 5.2 * scale), 0.7 * scale);
    float railPattern = step(0.42, fract(max(0.0, along) / (24.0 * scale) - u_radarTime * 1.8));
    radarLight += vec3(0.38, 1.0, 0.84) * rail * railPattern * forward * 0.23;

    for (int packetIndex = 0; packetIndex < 3; packetIndex += 1) {
      float phase = fract(u_radarTime * 0.29 + float(packetIndex) * 0.327);
      float packetCenter = u_radarLength * mix(0.06, 0.9, phase);
      float packetAlong = radarLine(abs(along - packetCenter), 2.0 * scale);
      float packetAcross = radarLine(across, 6.5 * scale);
      radarLight += vec3(0.7, 1.0, 0.93) * packetAlong * packetAcross * forward * 0.66;
    }

    // 舰体附近的同步脉冲，模拟天线每圈扫描时的发射/接收门控。
    float sourcePulse = 0.72 + sin(u_radarTime * 5.4) * 0.28;
    float sourceRingDistance = abs(radius - (13.0 + sourcePulse * 4.0) * scale);
    radarLight += vec3(0.46, 1.0, 0.88)
      * radarLine(sourceRingDistance, 0.85 * scale)
      * (1.0 - smoothstep(0.0, 32.0 * scale, radius)) * 0.42;
  }

  // screen 混合保留暗部细节，同时让亮芯在星空上呈现真实荧光响应。
  vec3 composed = 1.0 - (1.0 - base.rgb) * (1.0 - clamp(radarLight, 0.0, 0.94));
  OUTPUT_COLOR = vec4(composed, base.a);
}`;

const FRAGMENT_SHADER_WEBGL2 = `#version 300 es
precision highp float;
in vec2 v_texCoord;
out vec4 outColor;
#define SAMPLE_FRAME texture
#define OUTPUT_COLOR outColor
${RADAR_FRAGMENT_BODY}`;

const VERTEX_SHADER_WEBGL1 = `
attribute vec2 a_position;
attribute vec2 a_texCoord;
varying vec2 v_texCoord;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}`;

const FRAGMENT_SHADER_WEBGL1 = `
precision mediump float;
varying vec2 v_texCoord;
#define SAMPLE_FRAME texture2D
#define OUTPUT_COLOR gl_FragColor
${RADAR_FRAGMENT_BODY}`;

// 两个三角形覆盖整个裁剪空间；纹理坐标配合 UNPACK_FLIP_Y_WEBGL 保持 Canvas 朝向。
const FULLSCREEN_QUAD = new Float32Array([
  -1, -1, 0, 0,
   1, -1, 1, 0,
  -1,  1, 0, 1,
  -1,  1, 0, 1,
   1, -1, 1, 0,
   1,  1, 1, 1,
]);

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("无法创建对战地图 WebGL 着色器");
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || "未知着色器编译错误";
    gl.deleteShader(shader);
    throw new Error(`对战地图 WebGL 着色器编译失败：${message}`);
  }
  return shader;
}

function createProgram(gl, webgl2) {
  const vertexShader = compileShader(
    gl,
    gl.VERTEX_SHADER,
    webgl2 ? VERTEX_SHADER_WEBGL2 : VERTEX_SHADER_WEBGL1,
  );
  const fragmentShader = compileShader(
    gl,
    gl.FRAGMENT_SHADER,
    webgl2 ? FRAGMENT_SHADER_WEBGL2 : FRAGMENT_SHADER_WEBGL1,
  );
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    throw new Error("无法创建对战地图 WebGL 程序");
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || "未知程序链接错误";
    gl.deleteProgram(program);
    throw new Error(`对战地图 WebGL 程序链接失败：${message}`);
  }
  return program;
}

function createGpuResources(gl, webgl2) {
  const program = createProgram(gl, webgl2);
  const buffer = gl.createBuffer();
  const texture = gl.createTexture();
  if (!buffer || !texture) {
    if (buffer) gl.deleteBuffer(buffer);
    if (texture) gl.deleteTexture(texture);
    gl.deleteProgram(program);
    throw new Error("无法分配对战地图 WebGL 资源");
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, FULLSCREEN_QUAD, gl.STATIC_DRAW);

  const stride = 4 * Float32Array.BYTES_PER_ELEMENT;
  const position = gl.getAttribLocation(program, "a_position");
  const texCoord = gl.getAttribLocation(program, "a_texCoord");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(texCoord);
  gl.vertexAttribPointer(
    texCoord,
    2,
    gl.FLOAT,
    false,
    stride,
    2 * Float32Array.BYTES_PER_ELEMENT,
  );

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.useProgram(program);
  const uniforms = {
    frame: gl.getUniformLocation(program, "u_frame"),
    resolution: gl.getUniformLocation(program, "u_resolution"),
    radarEnabled: gl.getUniformLocation(program, "u_radarEnabled"),
    radarSource: gl.getUniformLocation(program, "u_radarSource"),
    radarDirection: gl.getUniformLocation(program, "u_radarDirection"),
    radarLength: gl.getUniformLocation(program, "u_radarLength"),
    radarTime: gl.getUniformLocation(program, "u_radarTime"),
    radarAngularVelocity: gl.getUniformLocation(program, "u_radarAngularVelocity"),
    radarScale: gl.getUniformLocation(program, "u_radarScale"),
  };
  gl.uniform1i(uniforms.frame, 0);
  gl.disable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);

  return {
    program,
    buffer,
    texture,
    uniforms,
    uploadedWidth: 0,
    uploadedHeight: 0,
  };
}

function deleteGpuResources(gl, resources) {
  if (!resources) return;
  if (resources.texture) gl.deleteTexture(resources.texture);
  if (resources.buffer) gl.deleteBuffer(resources.buffer);
  if (resources.program) gl.deleteProgram(resources.program);
}

function defaultSurfaceFactory() {
  return document.createElement("canvas");
}

/**
 * 创建对战地图画布渲染器。
 *
 * ctx 是现有共享表现层使用的 2D 合成上下文；beginFrame() 在绘制前同步物理尺寸，
 * present() 在绘制后把完整画面交给可见 WebGL 画布。仅在 WebGL 完全不可用时保留
 * 直接 2D 应急路径，避免极端环境中整张战场消失。
 */
export function createBattleCanvasRenderer(canvas, {
  createSurface = defaultSurfaceFactory,
} = {}) {
  if (!canvas) {
    throw new Error("缺少对战地图画布");
  }

  let gl = canvas.getContext("webgl2", CONTEXT_ATTRIBUTES);
  const webgl2 = Boolean(gl);
  if (!gl) {
    gl = canvas.getContext("webgl", CONTEXT_ATTRIBUTES);
  }

  if (!gl) {
    const fallbackContext = canvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
    });
    if (!fallbackContext) {
      throw new Error("当前浏览器无法创建对战地图 WebGL 或 Canvas 2D 上下文");
    }
    if (canvas.dataset) canvas.dataset.battleRenderer = "canvas2d";
    return {
      ctx: fallbackContext,
      mode: "canvas2d",
      supportsRadarEffect: false,
      beginFrame() {},
      setRadarEffect() {},
      present() {},
      destroy() {
        if (canvas.dataset) delete canvas.dataset.battleRenderer;
      },
    };
  }

  const surface = createSurface();
  const ctx = surface.getContext("2d", {
    alpha: false,
    desynchronized: true,
  });
  if (!ctx) {
    throw new Error("无法创建对战地图离屏合成面");
  }

  let resources = createGpuResources(gl, webgl2);
  let contextLost = false;
  let destroyed = false;
  let radarEffect = null;
  if (canvas.dataset) canvas.dataset.battleRenderer = webgl2 ? "webgl2" : "webgl1";

  function beginFrame() {
    radarEffect = null;
    if (surface.width !== canvas.width || surface.height !== canvas.height) {
      surface.width = canvas.width;
      surface.height = canvas.height;
    }
  }

  function present() {
    if (destroyed || contextLost || !resources) return;

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(resources.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, resources.buffer);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, resources.texture);
    gl.uniform2f(resources.uniforms.resolution, canvas.width, canvas.height);
    gl.uniform1f(resources.uniforms.radarEnabled, radarEffect ? 1 : 0);
    if (radarEffect) {
      gl.uniform2f(resources.uniforms.radarSource, radarEffect.sourceX, radarEffect.sourceY);
      gl.uniform2f(
        resources.uniforms.radarDirection,
        Math.cos(radarEffect.angle),
        Math.sin(radarEffect.angle),
      );
      gl.uniform1f(resources.uniforms.radarLength, radarEffect.length);
      gl.uniform1f(resources.uniforms.radarTime, radarEffect.elapsed);
      gl.uniform1f(resources.uniforms.radarAngularVelocity, radarEffect.angularVelocity);
      gl.uniform1f(resources.uniforms.radarScale, radarEffect.scale);
    }

    if (
      resources.uploadedWidth !== surface.width ||
      resources.uploadedHeight !== surface.height
    ) {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        surface,
      );
      resources.uploadedWidth = surface.width;
      resources.uploadedHeight = surface.height;
    } else {
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        surface,
      );
    }

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function handleContextLost(event) {
    event.preventDefault();
    contextLost = true;
    resources = null;
  }

  function handleContextRestored() {
    if (destroyed) return;
    resources = createGpuResources(gl, webgl2);
    contextLost = false;
  }

  canvas.addEventListener("webglcontextlost", handleContextLost, false);
  canvas.addEventListener("webglcontextrestored", handleContextRestored, false);

  return {
    ctx,
    mode: webgl2 ? "webgl2" : "webgl1",
    supportsRadarEffect: true,
    beginFrame,
    setRadarEffect(effect) {
      radarEffect = effect || null;
    },
    present,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      canvas.removeEventListener("webglcontextlost", handleContextLost, false);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored, false);
      if (!contextLost) {
        deleteGpuResources(gl, resources);
      }
      resources = null;
      if (canvas.dataset) delete canvas.dataset.battleRenderer;
    },
  };
}
