const CONTEXT_ATTRIBUTES = Object.freeze({
  alpha: false,
  antialias: true,
  depth: false,
  stencil: false,
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
  powerPreference: "high-performance",
});

const COLOR_VERTEX_WEBGL2 = `#version 300 es
in vec2 a_position;
in vec4 a_color;
uniform vec2 u_resolution;
out vec4 v_color;
void main() {
  vec2 clip = a_position / u_resolution * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_color = a_color;
}`;

const COLOR_FRAGMENT_WEBGL2 = `#version 300 es
precision mediump float;
in vec4 v_color;
out vec4 outColor;
void main() {
  outColor = vec4(v_color.rgb * v_color.a, v_color.a);
}`;

const COLOR_VERTEX_WEBGL1 = `
attribute vec2 a_position;
attribute vec4 a_color;
uniform vec2 u_resolution;
varying vec4 v_color;
void main() {
  vec2 clip = a_position / u_resolution * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_color = a_color;
}`;

const COLOR_FRAGMENT_WEBGL1 = `
precision mediump float;
varying vec4 v_color;
void main() {
  gl_FragColor = vec4(v_color.rgb * v_color.a, v_color.a);
}`;

const TEXTURE_VERTEX_WEBGL2 = `#version 300 es
in vec2 a_position;
in vec2 a_uv;
in vec4 a_color;
uniform vec2 u_resolution;
out vec2 v_uv;
out vec4 v_color;
void main() {
  vec2 clip = a_position / u_resolution * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_uv = a_uv;
  v_color = a_color;
}`;

const TEXTURE_FRAGMENT_WEBGL2 = `#version 300 es
precision mediump float;
uniform sampler2D u_texture;
in vec2 v_uv;
in vec4 v_color;
out vec4 outColor;
void main() {
  vec4 sampleColor = texture(u_texture, v_uv) * v_color;
  outColor = vec4(sampleColor.rgb * sampleColor.a, sampleColor.a);
}`;

const TEXTURE_VERTEX_WEBGL1 = `
attribute vec2 a_position;
attribute vec2 a_uv;
attribute vec4 a_color;
uniform vec2 u_resolution;
varying vec2 v_uv;
varying vec4 v_color;
void main() {
  vec2 clip = a_position / u_resolution * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_uv = a_uv;
  v_color = a_color;
}`;

const TEXTURE_FRAGMENT_WEBGL1 = `
precision mediump float;
uniform sampler2D u_texture;
varying vec2 v_uv;
varying vec4 v_color;
void main() {
  vec4 sampleColor = texture2D(u_texture, v_uv) * v_color;
  gl_FragColor = vec4(sampleColor.rgb * sampleColor.a, sampleColor.a);
}`;

// 雷达主扫线是全图高速旋转的长线。这里让片元着色器直接生成中央亮线，整条扫线
// 始终只提交一个四边形；校准节点和数据包仍走共享矢量绘制，避免恢复 CPU 路径开销。
const RADAR_VERTEX_WEBGL2 = `#version 300 es
in vec2 a_position;
in vec2 a_radarCoord;
uniform vec2 u_resolution;
out vec2 v_radarCoord;
void main() {
  vec2 clip = a_position / u_resolution * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_radarCoord = a_radarCoord;
}`;

const RADAR_FRAGMENT_WEBGL2 = `#version 300 es
precision mediump float;
uniform float u_length;
uniform float u_alpha;
in vec2 v_radarCoord;
out vec4 outColor;

float band(float distanceToCenter, float halfWidth) {
  return 1.0 - smoothstep(halfWidth, halfWidth + 0.72, distanceToCenter);
}

void main() {
  float along = v_radarCoord.x;
  float across = v_radarCoord.y;
  float progress = clamp(along / max(1.0, u_length), 0.0, 1.0);
  vec3 rayColor = progress < 0.5
    ? mix(vec3(0.863, 1.0, 0.973), vec3(0.494, 0.929, 0.878), progress * 2.0)
    : mix(vec3(0.494, 0.929, 0.878), vec3(0.239, 0.667, 0.745), (progress - 0.5) * 2.0);
  float rayFade = progress < 0.5 ? mix(0.82, 0.62, progress * 2.0) : mix(0.62, 0.08, (progress - 0.5) * 2.0);

  float alpha = band(abs(across), 0.41) * 0.92 * rayFade * u_alpha;
  outColor = vec4(rayColor * alpha, alpha);
}`;

const RADAR_VERTEX_WEBGL1 = `
attribute vec2 a_position;
attribute vec2 a_radarCoord;
uniform vec2 u_resolution;
varying vec2 v_radarCoord;
void main() {
  vec2 clip = a_position / u_resolution * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_radarCoord = a_radarCoord;
}`;

const RADAR_FRAGMENT_WEBGL1 = `
precision mediump float;
uniform float u_length;
uniform float u_alpha;
varying vec2 v_radarCoord;

float band(float distanceToCenter, float halfWidth) {
  return 1.0 - smoothstep(halfWidth, halfWidth + 0.72, distanceToCenter);
}

void main() {
  float along = v_radarCoord.x;
  float across = v_radarCoord.y;
  float progress = clamp(along / max(1.0, u_length), 0.0, 1.0);
  vec3 rayColor = progress < 0.5
    ? mix(vec3(0.863, 1.0, 0.973), vec3(0.494, 0.929, 0.878), progress * 2.0)
    : mix(vec3(0.494, 0.929, 0.878), vec3(0.239, 0.667, 0.745), (progress - 0.5) * 2.0);
  float rayFade = progress < 0.5 ? mix(0.82, 0.62, progress * 2.0) : mix(0.62, 0.08, (progress - 0.5) * 2.0);

  float alpha = band(abs(across), 0.41) * 0.92 * rayFade * u_alpha;
  gl_FragColor = vec4(rayColor * alpha, alpha);
}`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("无法创建原生战场着色器");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || "未知编译错误";
    gl.deleteShader(shader);
    throw new Error(`原生战场着色器编译失败：${message}`);
  }
  return shader;
}

function createProgram(gl, vertexSource, fragmentSource) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || "未知链接错误";
    gl.deleteProgram(program);
    throw new Error(`原生战场着色器链接失败：${message}`);
  }
  return program;
}

function sameClip(left, right) {
  if (!left && !right) return true;
  return Boolean(left && right
    && left.left === right.left
    && left.top === right.top
    && left.right === right.right
    && left.bottom === right.bottom);
}

export function appendColorCommand(commands, vertices, blend, clip) {
  if (!vertices.length) return;
  const previous = commands.at(-1);
  if (previous?.kind === "color" && previous.blend === blend && sameClip(previous.clip, clip)) {
    previous.vertices.push(...vertices);
    return;
  }
  commands.push({ kind: "color", vertices: [...vertices], blend, clip: clip ? { ...clip } : null });
}

export function appendTextureCommand(commands, texture, vertices, blend, clip) {
  if (!texture || !vertices.length) return;
  const previous = commands.at(-1);
  if (
    previous?.kind === "texture"
    && previous.texture === texture
    && previous.blend === blend
    && sameClip(previous.clip, clip)
  ) {
    previous.vertices.push(...vertices);
    return;
  }
  commands.push({ kind: "texture", texture, vertices: [...vertices], blend, clip: clip ? { ...clip } : null });
}

export function appendRadarCommand(commands, vertices, options) {
  if (!vertices.length) return;
  commands.push({
    kind: "radar",
    vertices: [...vertices],
    blend: options.blend,
    clip: options.clip ? { ...options.clip } : null,
    length: options.length,
    alpha: options.alpha,
  });
}

export function acquireBattleGl(canvas, { preferWebGL1 = false } = {}) {
  let gl = null;
  if (!preferWebGL1) {
    gl = canvas.getContext("webgl2", CONTEXT_ATTRIBUTES);
    if (gl) return { gl, mode: "webgl2", webgl2: true };
  }
  gl = canvas.getContext("webgl", CONTEXT_ATTRIBUTES);
  return gl ? { gl, mode: "webgl1", webgl2: false } : null;
}

export class NativeWebGLDriver {
  constructor(gl, canvas, webgl2) {
    this.gl = gl;
    this.canvas = canvas;
    this.webgl2 = webgl2;
    this.resources = null;
    this.stats = { drawCalls: 0, triangles: 0, textureUploads: 0 };
    this.buildResources();
  }

  buildResources() {
    const gl = this.gl;
    const colorProgram = createProgram(
      gl,
      this.webgl2 ? COLOR_VERTEX_WEBGL2 : COLOR_VERTEX_WEBGL1,
      this.webgl2 ? COLOR_FRAGMENT_WEBGL2 : COLOR_FRAGMENT_WEBGL1,
    );
    const textureProgram = createProgram(
      gl,
      this.webgl2 ? TEXTURE_VERTEX_WEBGL2 : TEXTURE_VERTEX_WEBGL1,
      this.webgl2 ? TEXTURE_FRAGMENT_WEBGL2 : TEXTURE_FRAGMENT_WEBGL1,
    );
    const radarProgram = createProgram(
      gl,
      this.webgl2 ? RADAR_VERTEX_WEBGL2 : RADAR_VERTEX_WEBGL1,
      this.webgl2 ? RADAR_FRAGMENT_WEBGL2 : RADAR_FRAGMENT_WEBGL1,
    );
    this.resources = {
      colorProgram,
      textureProgram,
      radarProgram,
      colorBuffer: gl.createBuffer(),
      textureBuffer: gl.createBuffer(),
      radarBuffer: gl.createBuffer(),
      color: {
        position: gl.getAttribLocation(colorProgram, "a_position"),
        color: gl.getAttribLocation(colorProgram, "a_color"),
        resolution: gl.getUniformLocation(colorProgram, "u_resolution"),
      },
      texture: {
        position: gl.getAttribLocation(textureProgram, "a_position"),
        uv: gl.getAttribLocation(textureProgram, "a_uv"),
        color: gl.getAttribLocation(textureProgram, "a_color"),
        resolution: gl.getUniformLocation(textureProgram, "u_resolution"),
        sampler: gl.getUniformLocation(textureProgram, "u_texture"),
      },
      radar: {
        position: gl.getAttribLocation(radarProgram, "a_position"),
        coordinate: gl.getAttribLocation(radarProgram, "a_radarCoord"),
        resolution: gl.getUniformLocation(radarProgram, "u_resolution"),
        length: gl.getUniformLocation(radarProgram, "u_length"),
        alpha: gl.getUniformLocation(radarProgram, "u_alpha"),
      },
    };
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
  }

  beginFrame() {
    const gl = this.gl;
    this.stats = { drawCalls: 0, triangles: 0, textureUploads: 0 };
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0.02, 0.05, 0.09, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  applyBlend(mode) {
    const gl = this.gl;
    if (mode === "lighter") {
      gl.blendFunc(gl.ONE, gl.ONE);
    } else if (mode === "screen") {
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
    } else {
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
  }

  applyClip(clip) {
    const gl = this.gl;
    if (!clip) {
      gl.disable(gl.SCISSOR_TEST);
      return;
    }
    const left = Math.max(0, Math.floor(clip.left));
    const top = Math.max(0, Math.floor(clip.top));
    const right = Math.min(this.canvas.width, Math.ceil(clip.right));
    const bottom = Math.min(this.canvas.height, Math.ceil(clip.bottom));
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(left, Math.max(0, this.canvas.height - bottom), Math.max(0, right - left), Math.max(0, bottom - top));
  }

  drawColor(vertices) {
    const gl = this.gl;
    const { colorProgram, colorBuffer, color } = this.resources;
    const data = new Float32Array(vertices);
    gl.useProgram(colorProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(color.position);
    gl.vertexAttribPointer(color.position, 2, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(color.color);
    gl.vertexAttribPointer(color.color, 4, gl.FLOAT, false, 24, 8);
    gl.uniform2f(color.resolution, this.canvas.width, this.canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, data.length / 6);
    this.stats.drawCalls += 1;
    this.stats.triangles += data.length / 18;
  }

  drawTexture(texture, vertices) {
    const gl = this.gl;
    const { textureProgram, textureBuffer, texture: locations } = this.resources;
    const data = new Float32Array(vertices);
    gl.useProgram(textureProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, textureBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(locations.position);
    gl.vertexAttribPointer(locations.position, 2, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(locations.uv);
    gl.vertexAttribPointer(locations.uv, 2, gl.FLOAT, false, 32, 8);
    gl.enableVertexAttribArray(locations.color);
    gl.vertexAttribPointer(locations.color, 4, gl.FLOAT, false, 32, 16);
    gl.uniform2f(locations.resolution, this.canvas.width, this.canvas.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(locations.sampler, 0);
    gl.drawArrays(gl.TRIANGLES, 0, data.length / 8);
    this.stats.drawCalls += 1;
    this.stats.triangles += data.length / 24;
  }

  drawRadar(command) {
    const gl = this.gl;
    const { radarProgram, radarBuffer, radar } = this.resources;
    const data = new Float32Array(command.vertices);
    gl.useProgram(radarProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, radarBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(radar.position);
    gl.vertexAttribPointer(radar.position, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(radar.coordinate);
    gl.vertexAttribPointer(radar.coordinate, 2, gl.FLOAT, false, 16, 8);
    gl.uniform2f(radar.resolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(radar.length, Math.max(1, Number(command.length) || 1));
    gl.uniform1f(radar.alpha, Math.max(0, Math.min(1, Number(command.alpha) || 0)));
    gl.drawArrays(gl.TRIANGLES, 0, data.length / 4);
    this.stats.drawCalls += 1;
    this.stats.triangles += data.length / 12;
  }

  present(commands) {
    for (const command of commands) {
      this.applyBlend(command.blend);
      this.applyClip(command.clip);
      if (command.kind === "texture") this.drawTexture(command.texture, command.vertices);
      else if (command.kind === "radar") this.drawRadar(command);
      else this.drawColor(command.vertices);
    }
    this.gl.disable(this.gl.SCISSOR_TEST);
  }

  createTexture(source, { flipY = true } = {}) {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    this.stats.textureUploads += 1;
    return texture;
  }

  deleteTexture(texture) {
    if (texture) this.gl.deleteTexture(texture);
  }

  rebuild() {
    this.destroyResources();
    this.buildResources();
  }

  destroyResources() {
    if (!this.resources) return;
    const gl = this.gl;
    gl.deleteBuffer(this.resources.colorBuffer);
    gl.deleteBuffer(this.resources.textureBuffer);
    gl.deleteBuffer(this.resources.radarBuffer);
    gl.deleteProgram(this.resources.colorProgram);
    gl.deleteProgram(this.resources.textureProgram);
    gl.deleteProgram(this.resources.radarProgram);
    this.resources = null;
  }

  destroy() {
    this.destroyResources();
    // SPA 切页或测试切换后主动归还上下文，避免浏览器保留多套战场 GPU 状态，
    // 达到上下文上限后偷偷驱逐仍在使用的 WebGL 场景。
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
