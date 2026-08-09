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

const FRAME_VERTEX_SHADER_WEBGL2 = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}`;

const FRAME_FRAGMENT_SHADER_WEBGL2 = `#version 300 es
precision mediump float;
uniform sampler2D u_frame;
in vec2 v_texCoord;
out vec4 outColor;

void main() {
  outColor = texture(u_frame, v_texCoord);
}`;

const FRAME_VERTEX_SHADER_WEBGL1 = `
attribute vec2 a_position;
attribute vec2 a_texCoord;
varying vec2 v_texCoord;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}`;

const FRAME_FRAGMENT_SHADER_WEBGL1 = `
precision mediump float;
uniform sampler2D u_frame;
varying vec2 v_texCoord;

void main() {
  gl_FragColor = texture2D(u_frame, v_texCoord);
}`;

const RADAR_VERTEX_SHADER_WEBGL2 = `#version 300 es
in vec2 a_radarPosition;
in vec2 a_radarCoord;
uniform vec2 u_resolution;
out vec2 v_radarCoord;

void main() {
  vec2 clip = a_radarPosition / u_resolution * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_radarCoord = a_radarCoord;
}`;

const RADAR_FRAGMENT_BODY = `
uniform float u_radarTime;

void main() {
  float along = v_radarCoord.x;
  float across = abs(v_radarCoord.y);
  float endFade = smoothstep(0.0, 0.025, along)
    * (1.0 - smoothstep(0.82, 1.0, along));

  // 全部计算都限制在扫线窄四边形内：柔光、磷光束、冰白亮芯。
  float halo = (1.0 - smoothstep(0.12, 1.0, across)) * 0.12;
  float beam = (1.0 - smoothstep(0.04, 0.31, across)) * 0.42;
  float core = (1.0 - smoothstep(0.0, 0.075, across)) * 0.84;

  // 两条分段数据轨和八个测距刻度，沿扫描方向快速更新但不保留历史帧。
  float railDistance = abs(across - 0.46);
  float railDash = step(0.48, fract(along * 34.0 - u_radarTime * 1.7));
  float rails = (1.0 - smoothstep(0.0, 0.055, railDistance)) * railDash * 0.32;
  float tickDistance = abs(fract(along * 8.0 + 0.5) - 0.5);
  float ticks = (1.0 - smoothstep(0.0, 0.018, tickDistance))
    * (1.0 - smoothstep(0.58, 0.88, across)) * 0.3;

  // 三枚脉冲只向前流动，不产生余辉或跨帧累积。
  float packets = 0.0;
  for (int packetIndex = 0; packetIndex < 3; packetIndex += 1) {
    float center = fract(u_radarTime * 0.31 + float(packetIndex) * 0.327);
    packets += (1.0 - smoothstep(0.0, 0.018, abs(along - center)))
      * (1.0 - smoothstep(0.18, 0.72, across)) * 0.68;
  }

  vec3 phosphor = vec3(0.1, 0.76, 0.62) * (halo + beam + rails);
  vec3 iceCore = vec3(0.76, 1.0, 0.94) * (core + ticks + packets);
  vec3 light = clamp((phosphor + iceCore) * endFade, 0.0, 0.92);
  RADAR_OUTPUT = vec4(light, 1.0);
}`;

const RADAR_FRAGMENT_SHADER_WEBGL2 = `#version 300 es
precision mediump float;
in vec2 v_radarCoord;
out vec4 outColor;
#define RADAR_OUTPUT outColor
${RADAR_FRAGMENT_BODY}`;

const RADAR_VERTEX_SHADER_WEBGL1 = `
attribute vec2 a_radarPosition;
attribute vec2 a_radarCoord;
uniform vec2 u_resolution;
varying vec2 v_radarCoord;

void main() {
  vec2 clip = a_radarPosition / u_resolution * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_radarCoord = a_radarCoord;
}`;

const RADAR_FRAGMENT_SHADER_WEBGL1 = `
precision mediump float;
varying vec2 v_radarCoord;
#define RADAR_OUTPUT gl_FragColor
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

function createProgram(gl, vertexSource, fragmentSource) {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
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
  const frameProgram = createProgram(
    gl,
    webgl2 ? FRAME_VERTEX_SHADER_WEBGL2 : FRAME_VERTEX_SHADER_WEBGL1,
    webgl2 ? FRAME_FRAGMENT_SHADER_WEBGL2 : FRAME_FRAGMENT_SHADER_WEBGL1,
  );
  const radarProgram = createProgram(
    gl,
    webgl2 ? RADAR_VERTEX_SHADER_WEBGL2 : RADAR_VERTEX_SHADER_WEBGL1,
    webgl2 ? RADAR_FRAGMENT_SHADER_WEBGL2 : RADAR_FRAGMENT_SHADER_WEBGL1,
  );
  const frameBuffer = gl.createBuffer();
  const radarBuffer = gl.createBuffer();
  const texture = gl.createTexture();
  if (!frameBuffer || !radarBuffer || !texture) {
    if (frameBuffer) gl.deleteBuffer(frameBuffer);
    if (radarBuffer) gl.deleteBuffer(radarBuffer);
    if (texture) gl.deleteTexture(texture);
    gl.deleteProgram(frameProgram);
    gl.deleteProgram(radarProgram);
    throw new Error("无法分配对战地图 WebGL 资源");
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, frameBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, FULLSCREEN_QUAD, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, radarBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, 6 * 4 * Float32Array.BYTES_PER_ELEMENT, gl.DYNAMIC_DRAW);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  const frame = {
    program: frameProgram,
    buffer: frameBuffer,
    position: gl.getAttribLocation(frameProgram, "a_position"),
    texCoord: gl.getAttribLocation(frameProgram, "a_texCoord"),
    textureUniform: gl.getUniformLocation(frameProgram, "u_frame"),
  };
  const radar = {
    program: radarProgram,
    buffer: radarBuffer,
    position: gl.getAttribLocation(radarProgram, "a_radarPosition"),
    coord: gl.getAttribLocation(radarProgram, "a_radarCoord"),
    resolutionUniform: gl.getUniformLocation(radarProgram, "u_resolution"),
    timeUniform: gl.getUniformLocation(radarProgram, "u_radarTime"),
  };
  gl.useProgram(frameProgram);
  gl.uniform1i(frame.textureUniform, 0);
  gl.disable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);

  return {
    frame,
    radar,
    texture,
    uploadedWidth: 0,
    uploadedHeight: 0,
  };
}

function deleteGpuResources(gl, resources) {
  if (!resources) return;
  if (resources.texture) gl.deleteTexture(resources.texture);
  if (resources.frame?.buffer) gl.deleteBuffer(resources.frame.buffer);
  if (resources.radar?.buffer) gl.deleteBuffer(resources.radar.buffer);
  if (resources.frame?.program) gl.deleteProgram(resources.frame.program);
  if (resources.radar?.program) gl.deleteProgram(resources.radar.program);
}

function writeRadarVertex(target, index, x, y, along, across) {
  const offset = index * 4;
  target[offset] = x;
  target[offset + 1] = y;
  target[offset + 2] = along;
  target[offset + 3] = across;
}

function fillRadarQuad(target, effect) {
  const dx = Math.cos(effect.angle);
  const dy = Math.sin(effect.angle);
  const nx = -dy;
  const ny = dx;
  const halfWidth = Math.max(6, Math.min(12 * effect.scale, 18));
  const sx = effect.sourceX;
  const sy = effect.sourceY;
  const ex = sx + dx * effect.length;
  const ey = sy + dy * effect.length;
  const sxLeft = sx - nx * halfWidth;
  const syLeft = sy - ny * halfWidth;
  const sxRight = sx + nx * halfWidth;
  const syRight = sy + ny * halfWidth;
  const exLeft = ex - nx * halfWidth;
  const eyLeft = ey - ny * halfWidth;
  const exRight = ex + nx * halfWidth;
  const eyRight = ey + ny * halfWidth;

  writeRadarVertex(target, 0, sxLeft, syLeft, 0, -1);
  writeRadarVertex(target, 1, exLeft, eyLeft, 1, -1);
  writeRadarVertex(target, 2, sxRight, syRight, 0, 1);
  writeRadarVertex(target, 3, sxRight, syRight, 0, 1);
  writeRadarVertex(target, 4, exLeft, eyLeft, 1, -1);
  writeRadarVertex(target, 5, exRight, eyRight, 1, 1);
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
  const radarQuad = new Float32Array(6 * 4);
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
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, resources.texture);

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

    const frameStride = 4 * Float32Array.BYTES_PER_ELEMENT;
    gl.useProgram(resources.frame.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, resources.frame.buffer);
    gl.enableVertexAttribArray(resources.frame.position);
    gl.vertexAttribPointer(resources.frame.position, 2, gl.FLOAT, false, frameStride, 0);
    gl.enableVertexAttribArray(resources.frame.texCoord);
    gl.vertexAttribPointer(
      resources.frame.texCoord,
      2,
      gl.FLOAT,
      false,
      frameStride,
      2 * Float32Array.BYTES_PER_ELEMENT,
    );
    gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    if (radarEffect) {
      fillRadarQuad(radarQuad, radarEffect);
      const radarStride = 4 * Float32Array.BYTES_PER_ELEMENT;
      gl.useProgram(resources.radar.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, resources.radar.buffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, radarQuad);
      gl.enableVertexAttribArray(resources.radar.position);
      gl.vertexAttribPointer(resources.radar.position, 2, gl.FLOAT, false, radarStride, 0);
      gl.enableVertexAttribArray(resources.radar.coord);
      gl.vertexAttribPointer(
        resources.radar.coord,
        2,
        gl.FLOAT,
        false,
        radarStride,
        2 * Float32Array.BYTES_PER_ELEMENT,
      );
      gl.uniform2f(resources.radar.resolutionUniform, canvas.width, canvas.height);
      gl.uniform1f(resources.radar.timeUniform, radarEffect.elapsed);
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.disable(gl.BLEND);
    }
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
