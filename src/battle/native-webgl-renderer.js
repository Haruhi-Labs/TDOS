import { acquireBattleGl, NativeWebGLDriver } from "./webgl/driver.js";
import { NativeBattleContext } from "./webgl/native-context.js";

const RENDERER_SESSION_KEY = "haruhi-battle-renderer-fallback-v1";
const DEFAULT_CONTEXT_LOSS_TIMEOUT_MS = 2500;

function storedRendererMode() {
  try {
    const mode = sessionStorage.getItem(RENDERER_SESSION_KEY);
    return ["webgl1", "canvas2d"].includes(mode) ? mode : null;
  } catch (_error) {
    return null;
  }
}

function rememberRendererMode(mode) {
  if (!["webgl1", "canvas2d"].includes(mode)) return;
  try {
    sessionStorage.setItem(RENDERER_SESSION_KEY, mode);
  } catch (_error) {
    // 禁用存储时仍可完成本次回退，只是不跨重载记忆。
  }
}

function freshCanvas(previous) {
  const replacement = previous.cloneNode(false);
  replacement.width = previous.width;
  replacement.height = previous.height;
  previous.replaceWith(replacement);
  return replacement;
}

function releaseFailedContext(gl) {
  try {
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch (_error) {
    // 部分故障驱动连扩展调用也可能抛错，后续仍使用新画布隔离该上下文。
  }
}

function modeCandidates(requestedMode) {
  if (requestedMode === "canvas2d") return ["canvas2d"];
  if (requestedMode === "webgl1") return ["webgl1", "canvas2d"];
  return ["webgl2", "webgl1", "canvas2d"];
}

function nextFallbackMode(mode) {
  return mode === "webgl2" ? "webgl1" : "canvas2d";
}

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
  const requestedMode = forceMode || storedRendererMode() || "webgl2";
  let activeCanvas = canvas;
  let acquired = null;
  let driver = null;

  for (const candidate of modeCandidates(requestedMode)) {
    if (candidate === "canvas2d") {
      const fallback = activeCanvas.getContext("2d", { alpha: false, desynchronized: true });
      if (!fallback) break;
      if (candidate !== requestedMode) rememberRendererMode("canvas2d");
      if (activeCanvas.dataset) activeCanvas.dataset.battleRenderer = "canvas2d";
      return {
        canvas: activeCanvas,
        ctx: fallback,
        mode: "canvas2d",
        native: false,
        beginFrame() {},
        present() {},
        recoverFromFailure() { return false; },
        getStats: () => ({ drawCalls: 0, triangles: 0, textureUploads: 0 }),
        destroy() {
          if (activeCanvas.dataset) delete activeCanvas.dataset.battleRenderer;
        },
      };
    }

    acquired = acquireBattleGl(activeCanvas, { mode: candidate });
    if (!acquired) continue;
    try {
      driver = new NativeWebGLDriver(acquired.gl, activeCanvas, acquired.webgl2);
      if (candidate !== requestedMode) rememberRendererMode(candidate);
      break;
    } catch (error) {
      console.warn(`战场${candidate.toUpperCase()}初始化失败，正在尝试兼容后端`, error);
      releaseFailedContext(acquired.gl);
      activeCanvas = freshCanvas(activeCanvas);
      acquired = null;
      driver = null;
    }
  }

  if (!acquired || !driver) throw new Error("当前设备无法创建 WebGL 或 Canvas 2D 战场上下文");

  const { gl, mode, webgl2 } = acquired;
  const ctx = new NativeBattleContext(activeCanvas, driver);
  let contextLost = false;
  let destroyed = false;
  let fallbackScheduled = false;
  let contextLossTimer = 0;
  if (activeCanvas.dataset) activeCanvas.dataset.battleRenderer = `${mode}-native`;

  function contextLossTimeoutMs() {
    const configured = Number(globalThis.__HARUHI_CONTEXT_LOSS_TIMEOUT_MS__);
    return Number.isFinite(configured) && configured >= 50
      ? configured
      : DEFAULT_CONTEXT_LOSS_TIMEOUT_MS;
  }

  function clearContextLossTimer() {
    if (!contextLossTimer) return;
    clearTimeout(contextLossTimer);
    contextLossTimer = 0;
  }

  function scheduleFallback(reason, error = null) {
    if (destroyed || fallbackScheduled) return true;
    fallbackScheduled = true;
    contextLost = true;
    clearContextLossTimer();
    const fallbackMode = nextFallbackMode(mode);
    rememberRendererMode(fallbackMode);
    if (activeCanvas.dataset) activeCanvas.dataset.battleRendererState = "fallback-pending";
    console.warn(`战场${mode.toUpperCase()}异常，正在切换至${fallbackMode.toUpperCase()}`, reason, error || "");
    setTimeout(() => {
      if (typeof location !== "undefined" && typeof location.reload === "function") {
        location.reload();
      }
    }, 80);
    return true;
  }

  function handleContextLost(event) {
    event.preventDefault();
    contextLost = true;
    if (activeCanvas.dataset) activeCanvas.dataset.battleRendererState = "context-lost";
    clearContextLossTimer();
    contextLossTimer = setTimeout(() => {
      scheduleFallback("context_restore_timeout");
    }, contextLossTimeoutMs());
  }

  function handleContextRestored() {
    if (destroyed) return;
    clearContextLossTimer();
    try {
      driver.buildResources();
      ctx.handleContextRestored();
      contextLost = false;
      if (activeCanvas.dataset) delete activeCanvas.dataset.battleRendererState;
    } catch (error) {
      scheduleFallback("context_restore_failed", error);
    }
  }

  activeCanvas.addEventListener("webglcontextlost", handleContextLost, false);
  activeCanvas.addEventListener("webglcontextrestored", handleContextRestored, false);

  return {
    canvas: activeCanvas,
    ctx,
    mode,
    native: true,
    beginFrame() {
      ctx.beginFrame({ skipDriver: contextLost });
    },
    present() {
      if (!contextLost) ctx.present();
    },
    recoverFromFailure(error) {
      return scheduleFallback("render_failed", error);
    },
    getStats: () => ({ ...ctx.frameStats }),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearContextLossTimer();
      activeCanvas.removeEventListener("webglcontextlost", handleContextLost, false);
      activeCanvas.removeEventListener("webglcontextrestored", handleContextRestored, false);
      if (!contextLost) {
        ctx.destroy();
        driver.destroy();
      }
      if (activeCanvas.dataset) {
        delete activeCanvas.dataset.battleRenderer;
        delete activeCanvas.dataset.battleRendererState;
      }
    },
  };
}
