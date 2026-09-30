import { clamp, DEFAULT_WORLD_SIZE } from "../../shared/game-core.js";

export const DIRECTOR_ZOOM_MAX = 4;

// 插值视野宽度而非倍率，让缩放和圆心采用同一阻尼时，鼠标下的世界点保持稳定。
// 所有状态仅用于绘制；不读写权威战斗状态，也不自动跟随任何舰船。
export function createDirectorCamera({ size = DEFAULT_WORLD_SIZE, reducedMotion = () => false } = {}) {
  let current = { x: size / 2, y: size / 2, extent: size };
  let target = { ...current };
  let dragging = false;
  let lastTime = null;

  function bounded(x, y, extent) {
    const half = extent / 2;
    return { x: clamp(x, half, size - half), y: clamp(y, half, size - half), extent };
  }

  function view() {
    return { zoom: size / current.extent, left: current.x - current.extent / 2, top: current.y - current.extent / 2, width: current.extent, height: current.extent };
  }

  function setZoom(ratio, focus = { x: size / 2, y: size / 2 }) {
    const extent = size / clamp(ratio, 1, DIRECTOR_ZOOM_MAX);
    if (Math.abs(extent - target.extent) < 1e-7) return false;
    const u = clamp(focus.x / size, 0, 1) - 0.5;
    const v = clamp(focus.y / size, 0, 1) - 0.5;
    target = bounded(target.x + u * (target.extent - extent), target.y + v * (target.extent - extent), extent);
    return true;
  }

  function update(now) {
    const dt = lastTime === null ? 0 : clamp((now - lastTime) / 1000, 0, 0.05);
    lastTime = now;
    const alpha = reducedMotion() ? 1 : -Math.expm1(-dt / (dragging ? 0.045 : 0.11));
    for (const key of ["x", "y", "extent"]) {
      current[key] += (target[key] - current[key]) * alpha;
      if (Math.abs(target[key] - current[key]) < 1e-5) current[key] = target[key];
    }
    // 可行视野是凸集，同步阻尼不会越界；最后一次夹取消除浮点误差。
    current = bounded(current.x, current.y, current.extent);
  }

  return {
    view,
    update,
    setZoom,
    get zoom() { return size / current.extent; },
    get targetZoom() { return size / target.extent; },
    get dragging() { return dragging; },
    centerOn(x, y) { target = bounded(x, y, target.extent); },
    beginPan() {
      // 接管当前构图，避免未完成的缩放或上一次移动继续拖走鼠标抓住的画面。
      target = { ...current };
      dragging = true;
    },
    panBy(dx, dy) {
      if (!dragging) return;
      target = bounded(target.x - dx * current.extent / size, target.y - dy * current.extent / size, target.extent);
    },
    endPan() { dragging = false; },
    reset() {
      current = { x: size / 2, y: size / 2, extent: size };
      target = { ...current };
      dragging = false;
      lastTime = null;
    },
  };
}

export function bindDirectorCameraInput(canvas, camera, { enabled, signal }) {
  let pointer = null;
  const options = { signal };
  function cancel() {
    const id = pointer?.id;
    pointer = null;
    camera.endPan();
    canvas.classList.remove("is-camera-dragging");
    if (id !== undefined && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  }
  canvas.addEventListener("pointerdown", (event) => {
    if (!enabled() || pointer || !event.isPrimary || ![0, 1].includes(event.button) || camera.zoom <= 1.001) return;
    camera.beginPan();
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add("is-camera-dragging");
    event.preventDefault();
  }, options);
  canvas.addEventListener("pointermove", (event) => {
    if (pointer?.id !== event.pointerId) return;
    if (!enabled()) { cancel(); return; }
    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      camera.panBy((event.clientX - pointer.x) * DEFAULT_WORLD_SIZE / rect.width, (event.clientY - pointer.y) * DEFAULT_WORLD_SIZE / rect.height);
    }
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    event.preventDefault();
  }, options);
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    canvas.addEventListener(type, (event) => { if (pointer?.id === event.pointerId) cancel(); }, options);
  }
  window.addEventListener("blur", cancel, options);
  document.addEventListener("visibilitychange", () => { if (document.hidden) cancel(); }, options);
  signal.addEventListener("abort", cancel, { once: true });
  return { cancel };
}
