// ═══════════════════════════════════════════════════════════════
// 共享星光背景：首页与各二级页面（大厅 / 档案 / 玩法）统一使用，
// 营造连续的「星历之海」氛围。在给定 canvas 上绘制飘动星尘。
// 传入 AbortSignal，abort 时自动停止 rAF 并移除 resize 监听。
// ═══════════════════════════════════════════════════════════════

export function startStarfield(canvas, signal, options = {}) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const density = options.density || 26000; // 数值越小星越密
  let raf = 0;
  let w = 0;
  let h = 0;
  let stars = [];

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    w = canvas.width = Math.max(1, canvas.clientWidth * dpr);
    h = canvas.height = Math.max(1, canvas.clientHeight * dpr);
    const count = Math.round((w * h) / density);
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 1.5 + 0.3,
      drift: Math.random() * 0.18 + 0.02,
      tw: Math.random() * Math.PI * 2,
      gold: Math.random() < 0.32,
    }));
  }
  resize();
  window.addEventListener("resize", resize, { signal });

  let t = 0;
  function frame() {
    const dpr = window.devicePixelRatio || 1;
    t += 0.016;
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      s.y += s.drift;
      if (s.y > h + 2) {
        s.y = -2;
        s.x = Math.random() * w;
      }
      const a = 0.35 + Math.sin(t * 1.6 + s.tw) * 0.3;
      ctx.globalAlpha = Math.max(0.05, a);
      ctx.fillStyle = s.gold ? "#f0d488" : "#d8e4ff";
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  if (signal) signal.addEventListener("abort", () => cancelAnimationFrame(raf));
}
