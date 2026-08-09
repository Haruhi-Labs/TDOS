import assert from "node:assert/strict";

import { createBattleCanvasRenderer } from "../src/battle/webgl-canvas.js";

class FakeGl {
  constructor() {
    Object.assign(this, {
      VERTEX_SHADER: 1,
      FRAGMENT_SHADER: 2,
      COMPILE_STATUS: 3,
      LINK_STATUS: 4,
      ARRAY_BUFFER: 5,
      STATIC_DRAW: 6,
      FLOAT: 7,
      TEXTURE0: 8,
      TEXTURE_2D: 9,
      TEXTURE_MIN_FILTER: 10,
      TEXTURE_MAG_FILTER: 11,
      TEXTURE_WRAP_S: 12,
      TEXTURE_WRAP_T: 13,
      LINEAR: 14,
      CLAMP_TO_EDGE: 15,
      UNPACK_FLIP_Y_WEBGL: 16,
      BLEND: 17,
      DEPTH_TEST: 18,
      CULL_FACE: 19,
      RGBA: 20,
      UNSIGNED_BYTE: 21,
      TRIANGLES: 22,
    });
    this.calls = [];
  }

  record(name, ...args) { this.calls.push([name, ...args]); }
  createShader(type) { return { type }; }
  shaderSource(shader, source) { this.record("shaderSource", shader.type, source); }
  compileShader(shader) { this.record("compileShader", shader.type); }
  getShaderParameter() { return true; }
  getShaderInfoLog() { return ""; }
  deleteShader(shader) { this.record("deleteShader", shader.type); }
  createProgram() { return {}; }
  attachShader() {}
  linkProgram() {}
  getProgramParameter() { return true; }
  getProgramInfoLog() { return ""; }
  deleteProgram() { this.record("deleteProgram"); }
  createBuffer() { return {}; }
  deleteBuffer() { this.record("deleteBuffer"); }
  bindBuffer() {}
  bufferData() {}
  createTexture() { return {}; }
  deleteTexture() { this.record("deleteTexture"); }
  getAttribLocation(_program, name) { return name === "a_position" ? 0 : 1; }
  enableVertexAttribArray() {}
  vertexAttribPointer() {}
  activeTexture() {}
  bindTexture() {}
  texParameteri() {}
  pixelStorei() {}
  useProgram() {}
  getUniformLocation() { return {}; }
  uniform1i() {}
  disable() {}
  viewport(_x, _y, width, height) { this.record("viewport", width, height); }
  texImage2D(...args) { this.record("texImage2D", ...args); }
  texSubImage2D(...args) { this.record("texSubImage2D", ...args); }
  drawArrays(mode, first, count) { this.record("drawArrays", mode, first, count); }
}

function fakeCanvas({ webgl2 = null, webgl1 = null, context2d = null } = {}) {
  const listeners = new Map();
  const requests = [];
  const canvas = {
    width: 1440,
    height: 1440,
    dataset: {},
    getContext(type) {
      requests.push(type);
      if (type === "webgl2") return webgl2;
      if (type === "webgl") return webgl1;
      if (type === "2d") return context2d;
      return null;
    },
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    },
  };
  return { canvas, listeners, requests };
}

function fakeSurface() {
  const ctx = {};
  return {
    width: 300,
    height: 150,
    getContext(type) { return type === "2d" ? ctx : null; },
    ctx,
  };
}

{
  const gl = new FakeGl();
  const target = fakeCanvas({ webgl2: gl });
  const surface = fakeSurface();
  const renderer = createBattleCanvasRenderer(target.canvas, { createSurface: () => surface });

  assert.equal(renderer.mode, "webgl2");
  assert.deepEqual(target.requests, ["webgl2"]);
  assert.equal(target.canvas.dataset.battleRenderer, "webgl2");

  renderer.beginFrame();
  assert.equal(surface.width, 1440);
  assert.equal(surface.height, 1440);
  renderer.present();
  renderer.present();
  assert.equal(gl.calls.filter(([name]) => name === "texImage2D").length, 1);
  assert.equal(gl.calls.filter(([name]) => name === "texSubImage2D").length, 1);
  assert.equal(gl.calls.filter(([name]) => name === "drawArrays").length, 2);

  let prevented = false;
  target.listeners.get("webglcontextlost")({ preventDefault() { prevented = true; } });
  renderer.present();
  assert.equal(prevented, true);
  assert.equal(gl.calls.filter(([name]) => name === "drawArrays").length, 2);
  target.listeners.get("webglcontextrestored")();
  renderer.present();
  assert.equal(gl.calls.filter(([name]) => name === "drawArrays").length, 3);

  renderer.destroy();
  assert.equal(target.canvas.dataset.battleRenderer, undefined);
  assert.equal(target.listeners.size, 0);
}

{
  const gl = new FakeGl();
  const target = fakeCanvas({ webgl1: gl });
  const surface = fakeSurface();
  const renderer = createBattleCanvasRenderer(target.canvas, { createSurface: () => surface });

  assert.equal(renderer.mode, "webgl1");
  assert.deepEqual(target.requests, ["webgl2", "webgl"]);
  assert.equal(target.canvas.dataset.battleRenderer, "webgl1");
  renderer.beginFrame();
  renderer.present();
  assert.equal(gl.calls.filter(([name]) => name === "drawArrays").length, 1);
  renderer.destroy();
}

{
  const context2d = {};
  const target = fakeCanvas({ context2d });
  const renderer = createBattleCanvasRenderer(target.canvas);

  assert.equal(renderer.mode, "canvas2d");
  assert.equal(renderer.ctx, context2d);
  assert.deepEqual(target.requests, ["webgl2", "webgl", "2d"]);
  renderer.destroy();
  assert.equal(target.canvas.dataset.battleRenderer, undefined);
}

console.log("对战地图 WebGL 渲染器验证通过：WebGL2、WebGL1 回退、上下文恢复与 2D 应急路径均正常。");
