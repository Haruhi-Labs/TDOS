// ═══════════════════════════════════════════════════════════════
// 移动端判定 + 视口监听
// 不再用「桌面缩小版」的媒体查询硬塞；而是据此切到各页「专属移动布局」。
// 判定按「较短边」：手机无论竖横，短边都很小；平板/桌面短边大，走桌面版。
// 窄宽度（竖屏平板 / 窄窗）也按移动端处理。
// ═══════════════════════════════════════════════════════════════

const NARROW_MAX_WIDTH = 820; // 宽度 ≤ 此值（竖屏手机 / 竖屏平板 / 窄窗）→ 移动端
const PHONE_MAX_SHORT_EDGE = 560; // 较短边 ≤ 此值（横屏手机也命中）→ 移动端

export function isMobile() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  return w <= NARROW_MAX_WIDTH || Math.min(w, h) <= PHONE_MAX_SHORT_EDGE;
}

// 仅当「跨越」移动/桌面边界时回调一次（避免每次 resize 都重建）。返回取消函数。
export function watchViewport(onCross) {
  let last = isMobile();
  const handler = () => {
    const now = isMobile();
    if (now !== last) {
      last = now;
      onCross(now);
    }
  };
  window.addEventListener("resize", handler);
  window.addEventListener("orientationchange", handler);
  return () => {
    window.removeEventListener("resize", handler);
    window.removeEventListener("orientationchange", handler);
  };
}
