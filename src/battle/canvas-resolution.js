import { DEFAULT_WORLD_SIZE } from "../../shared/game-core.js";

// 显示分辨率与逻辑世界分离；仅受实际渲染后端的硬件尺寸上限约束。
export function canvasBackingSize(cssSize, pixelRatio, maxDimension = Infinity) {
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  return Math.max(1, Math.min(Math.max(DEFAULT_WORLD_SIZE, Math.ceil(cssSize * ratio)), maxDimension));
}

export function observeCanvasResolution(canvas, { maxDimension = Infinity } = {}) {
  let destroyed = false;
  let densityQuery = null;
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => sync());
  function sync() {
    if (destroyed || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    // 隐藏期间不重新分配缓冲；显示后由尺寸观察器校准。
    if (!rect.width || !rect.height) return;
    const style = typeof getComputedStyle === "function" ? getComputedStyle(canvas) : null;
    const size = rect.width - ["borderLeftWidth", "borderRightWidth", "paddingLeft", "paddingRight"]
      .reduce((sum, key) => sum + (Number.parseFloat(style?.[key]) || 0), 0);
    const backing = canvasBackingSize(size, window.devicePixelRatio, maxDimension);
    if (canvas.width !== backing) canvas.width = backing;
    if (canvas.height !== backing) canvas.height = backing;
  }
  function watchDensity() {
    densityQuery?.removeEventListener?.("change", densityChanged);
    densityQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    densityQuery.addEventListener?.("change", densityChanged);
  }
  function densityChanged() { watchDensity(); sync(); }
  // 设备像素观察可覆盖换屏；旧浏览器退回内容尺寸和 DPR 媒体查询。
  try { observer?.observe(canvas, { box: "device-pixel-content-box" }); }
  catch (_error) { observer?.observe(canvas); }
  watchDensity();
  return {
    sync,
    destroy() {
      destroyed = true;
      observer?.disconnect();
      densityQuery?.removeEventListener?.("change", densityChanged);
    },
  };
}
