// 共享战场相机:缩放/夹取/坐标换算/跟随/画布 backing store 管理。
// 单人(solo.js)与在线(online.js)共用;两种模式的真实差异全部经构造回调注入:
//   isMobile()          → 是否移动端战斗布局(决定基础放大与跟随策略)
//   mobileZoomEnabled() → 移动端基础放大是否生效(在线观战要看全场,关闭)
//   overviewWhenIdle()  → 未手动放大时是否固定全图中心(在线观战开启)
//   getTrackedShip()    → 相机跟随目标(单人=本地选中舰,在线=快照中的选中舰)
//   onZoomChanged()     → 缩放变化后的 HUD 同步(单人=updateUi,在线=updateBattleStatus)
import { DEFAULT_WORLD_SIZE, clamp } from "../../shared/game-core.js";

const SCREEN_LOGICAL = DEFAULT_WORLD_SIZE;

export const CAMERA_ZOOM_MIN = 1;
export const CAMERA_ZOOM_MAX = 2.6;
export const CAMERA_ZOOM_STEP = 0.2;
export const MOBILE_ZOOM = 1.78;

export function prefersMobileBattleMode() {
  return window.matchMedia("(max-width: 980px)").matches || window.matchMedia("(pointer: coarse)").matches;
}

export function createBattleCamera({
  canvas,
  isMobile,
  showMinimap = isMobile,
  worldSize = { width: DEFAULT_WORLD_SIZE, height: DEFAULT_WORLD_SIZE },
  mobileZoomEnabled = () => true,
  overviewWhenIdle = () => false,
  getTrackedShip = () => null,
  onZoomChanged = () => {},
}) {
  function normalizeWorldDimension(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0
      ? Math.max(SCREEN_LOGICAL, numeric)
      : DEFAULT_WORLD_SIZE;
  }

  let worldWidth = normalizeWorldDimension(worldSize?.width);
  let worldHeight = normalizeWorldDimension(worldSize?.height);
  let centerX = worldWidth * 0.5;
  let centerY = worldHeight * 0.5;
  let zoomRatio = 1;
  let manualUntil = 0;

  function effectiveViewZoom(ratio = zoomRatio) {
    const baseZoom = isMobile() && mobileZoomEnabled() ? MOBILE_ZOOM : 1;
    return baseZoom * clamp(ratio, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX);
  }

  function clampCameraCenter(cx, cy, zoom = effectiveViewZoom()) {
    const width = SCREEN_LOGICAL / zoom;
    const height = SCREEN_LOGICAL / zoom;
    const halfW = width * 0.5;
    const halfH = height * 0.5;
    return {
      x: clamp(cx, halfW, worldWidth - halfW),
      y: clamp(cy, halfH, worldHeight - halfH),
      width,
      height,
      zoom,
    };
  }

  function setWorldSize(width, height = width) {
    worldWidth = normalizeWorldDimension(width);
    worldHeight = normalizeWorldDimension(height);
    const centered = clampCameraCenter(centerX, centerY);
    centerX = centered.x;
    centerY = centered.y;
  }

  function currentViewState() {
    const zoom = effectiveViewZoom();
    const centered = clampCameraCenter(centerX, centerY, zoom);
    return {
      zoom: centered.zoom,
      left: centered.x - centered.width * 0.5,
      top: centered.y - centered.height * 0.5,
      width: centered.width,
      height: centered.height,
    };
  }

  function screenPointFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * (SCREEN_LOGICAL / rect.width);
    const y = (event.clientY - rect.top) * (SCREEN_LOGICAL / rect.height);
    return {
      x: clamp(x, 0, SCREEN_LOGICAL),
      y: clamp(y, 0, SCREEN_LOGICAL),
    };
  }

  function worldPointFromScreenPoint(x, y) {
    const view = currentViewState();
    return {
      x: clamp(view.left + x / view.zoom, 0, worldWidth),
      y: clamp(view.top + y / view.zoom, 0, worldHeight),
    };
  }

  function pointerFromEvent(event) {
    const screen = screenPointFromEvent(event);
    return worldPointFromScreenPoint(screen.x, screen.y);
  }

  function minimapRect() {
    const visible = typeof showMinimap === "function" ? showMinimap() : Boolean(showMinimap);
    if (!visible) {
      return null;
    }
    const size = clamp(SCREEN_LOGICAL * 0.145, 180, 230);
    return {
      x: SCREEN_LOGICAL - size - 18,
      y: SCREEN_LOGICAL - size - 18,
      width: size,
      height: size,
    };
  }

  function minimapWorldPointFromScreenPoint(screenX, screenY) {
    const rect = minimapRect();
    if (!rect) {
      return null;
    }
    if (screenX < rect.x || screenX > rect.x + rect.width || screenY < rect.y || screenY > rect.y + rect.height) {
      return null;
    }
    return {
      x: clamp(((screenX - rect.x) / rect.width) * worldWidth, 0, worldWidth),
      y: clamp(((screenY - rect.y) / rect.height) * worldHeight, 0, worldHeight),
    };
  }

  function centerCameraOn(x, y, manual = true) {
    const centered = clampCameraCenter(x, y);
    centerX = centered.x;
    centerY = centered.y;
    if (manual) {
      manualUntil = performance.now() + 2600;
    }
  }

  function setCameraZoom(nextZoom, focusScreen = null) {
    const nextRatio = clamp(nextZoom, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX);
    if (Math.abs(nextRatio - zoomRatio) < 1e-3) {
      return false;
    }

    const prevView = currentViewState();
    let cx = prevView.left + prevView.width * 0.5;
    let cy = prevView.top + prevView.height * 0.5;

    if (focusScreen) {
      const worldX = clamp(prevView.left + focusScreen.x / prevView.zoom, 0, worldWidth);
      const worldY = clamp(prevView.top + focusScreen.y / prevView.zoom, 0, worldHeight);
      const zoom = effectiveViewZoom(nextRatio);
      const width = SCREEN_LOGICAL / zoom;
      const height = SCREEN_LOGICAL / zoom;
      cx = worldX - focusScreen.x / zoom + width * 0.5;
      cy = worldY - focusScreen.y / zoom + height * 0.5;
    }

    zoomRatio = nextRatio;
    if (!isMobile() && nextRatio <= CAMERA_ZOOM_MIN + 1e-3) {
      centerX = worldWidth * 0.5;
      centerY = worldHeight * 0.5;
      manualUntil = 0;
    } else {
      centerCameraOn(cx, cy, Boolean(focusScreen));
    }
    onZoomChanged();
    return true;
  }

  function adjustCameraZoom(direction, focusScreen = null) {
    const step = direction > 0 ? CAMERA_ZOOM_STEP : -CAMERA_ZOOM_STEP;
    return setCameraZoom(zoomRatio + step, focusScreen);
  }

  function updateCamera() {
    const zoomedIn = zoomRatio > CAMERA_ZOOM_MIN + 1e-3;
    // 观战全景:未手动放大时固定看全图,不跟随任何舰
    if (overviewWhenIdle() && !zoomedIn) {
      centerX = worldWidth * 0.5;
      centerY = worldHeight * 0.5;
      return;
    }
    const shouldTrack = isMobile() || zoomedIn;
    if (!shouldTrack) {
      centerX = worldWidth * 0.5;
      centerY = worldHeight * 0.5;
      return;
    }
    const ship = getTrackedShip();
    if (!ship || !ship.alive) {
      return;
    }
    if (performance.now() < manualUntil) {
      return;
    }
    // 朝航向方向前引一点,让玩家看到"要去哪"而不是"在哪"
    const lead = clamp((ship.speed || 0) * 3.2, 34, 92);
    const targetX = ship.x + Math.cos(ship.angle || 0) * lead;
    const targetY = ship.y + Math.sin(ship.angle || 0) * lead;
    centerX = clamp(centerX + (targetX - centerX) * 0.14, 0, worldWidth);
    centerY = clamp(centerY + (targetY - centerY) * 0.14, 0, worldHeight);
  }

  // 把 backing store(画布物理像素)对齐到显示区域的设备像素,告别固定缓冲被放大产生的模糊。
  function resizeCanvas() {
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const cssW = rect.width || canvas.clientWidth || SCREEN_LOGICAL;
    // 画布 CSS 强制 1:1 方形,故宽高同值即可。按设备像素铺满,夹在 [SCREEN_LOGICAL, 2880]:
    // 不低于原始逻辑尺寸(绝不劣化),不超 2880(控住超大屏/高 DPR 的内存与填充开销)。
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const backing = Math.max(SCREEN_LOGICAL, Math.min(Math.round(cssW * dpr), 2880));
    if (canvas.width !== backing) {
      canvas.width = backing;
      canvas.height = backing;
    }
  }

  function reset({ x, y, zoom = 1 } = {}) {
    zoomRatio = clamp(Number(zoom) || 1, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX);
    manualUntil = 0;
    const centered = clampCameraCenter(Number.isFinite(x) ? x : worldWidth * 0.5, Number.isFinite(y) ? y : worldHeight * 0.5);
    centerX = centered.x;
    centerY = centered.y;
  }

  return {
    get zoom() {
      return zoomRatio;
    },
    setWorldSize,
    getWorldSize: () => ({ width: worldWidth, height: worldHeight }),
    effectiveViewZoom,
    currentViewState,
    screenPointFromEvent,
    worldPointFromScreenPoint,
    pointerFromEvent,
    minimapRect,
    minimapWorldPointFromScreenPoint,
    centerCameraOn,
    setCameraZoom,
    adjustCameraZoom,
    updateCamera,
    resizeCanvas,
    reset,
    // 切回桌面布局时解除"手动镜头保持",恢复自动跟随/居中
    releaseManual() {
      manualUntil = 0;
    },
  };
}
