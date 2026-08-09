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

const FRAGMENT_SHADER_WEBGL2 = `#version 300 es
precision mediump float;
uniform sampler2D u_frame;
in vec2 v_texCoord;
out vec4 outColor;

void main() {
  outColor = texture(u_frame, v_texCoord);
}`;

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
uniform sampler2D u_frame;
varying vec2 v_texCoord;

void main() {
  gl_FragColor = texture2D(u_frame, v_texCoord);
}`;

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
  gl.uniform1i(gl.getUniformLocation(program, "u_frame"), 0);
  gl.disable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);

  return {
    program,
    buffer,
    texture,
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
      beginFrame() {},
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
  if (canvas.dataset) canvas.dataset.battleRenderer = webgl2 ? "webgl2" : "webgl1";

  function beginFrame() {
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
    beginFrame,
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
