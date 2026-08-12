import { acquireBattleGl, NativeWebGLDriver } from "./webgl/driver.js";
import { NativeBattleContext } from "./webgl/native-context.js";

/**
 * 创建战场原生渲染后端。
 *
 * WebGL2 与 WebGL1 共用相同的矢量几何、纹理缓存和批处理命令，仅着色器语法不同；
 * 两者都直接生成最终战场像素，不存在离屏整帧 Canvas 或逐帧纹理上传。
 * Canvas 2D 只在设备完全没有 WebGL 时作为可用性兜底。
 */
export function createNativeBattleRenderer(canvas, {
  forceMode = typeof globalThis !== "undefined" ? globalThis.__HARUHI_BATTLE_RENDERER__ : null,
} = {}) {
  if (!canvas) throw new Error("缺少战场画布");
  const acquired = forceMode === "canvas2d"
    ? null
    : acquireBattleGl(canvas, { preferWebGL1: forceMode === "webgl1" });
  if (!acquired) {
    const fallback = canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!fallback) throw new Error("当前设备无法创建 WebGL 或 Canvas 2D 战场上下文");
    if (canvas.dataset) canvas.dataset.battleRenderer = "canvas2d";
    return {
      ctx: fallback,
      mode: "canvas2d",
      native: false,
      beginFrame() {},
      present() {},
      getStats: () => ({ drawCalls: 0, triangles: 0, textureUploads: 0 }),
      destroy() {
        if (canvas.dataset) delete canvas.dataset.battleRenderer;
      },
    };
  }

  const { gl, mode, webgl2 } = acquired;
  const driver = new NativeWebGLDriver(gl, canvas, webgl2);
  const ctx = new NativeBattleContext(canvas, driver);
  let contextLost = false;
  let destroyed = false;
  if (canvas.dataset) canvas.dataset.battleRenderer = `${mode}-native`;

  function handleContextLost(event) {
    event.preventDefault();
    contextLost = true;
  }

  function handleContextRestored() {
    if (destroyed) return;
    driver.buildResources();
    ctx.handleContextRestored();
    contextLost = false;
  }

  canvas.addEventListener("webglcontextlost", handleContextLost, false);
  canvas.addEventListener("webglcontextrestored", handleContextRestored, false);

  return {
    ctx,
    mode,
    native: true,
    beginFrame() {
      ctx.beginFrame({ skipDriver: contextLost });
    },
    present() {
      if (!contextLost) ctx.present();
    },
    getStats: () => ({ ...ctx.frameStats }),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      canvas.removeEventListener("webglcontextlost", handleContextLost, false);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored, false);
      if (!contextLost) {
        ctx.destroy();
        driver.destroy();
      }
      if (canvas.dataset) delete canvas.dataset.battleRenderer;
    },
  };
}
