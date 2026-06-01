// ═══════════════════════════════════════════════════════════════
// 主菜单 / 标题画面（路由 /）
// 左：标题 + 竖排菜单；右：七人群像（前后拥簇，随阵营着色）；底：动态星尘背景。
// 键盘 ↑↓ 选择、Enter 进入。出战编队不在此处选，进入对战时再挑。
// ═══════════════════════════════════════════════════════════════

import { getFaction } from "./profile.js";
import { startStarfield } from "./starfield.js";

const ITEMS = [
  { href: "/play", no: "I", label: "单人实战", sub: "挑选舰队，迎击 AI 舰群" },
  { href: "/online", no: "II", label: "在线对战", sub: "大厅匹配，与真人同步交战" },
  { href: "/debug", no: "III", label: "AI 推演", sub: "双方 AI 接管，观战与变速" },
  { href: "/profile", no: "IV", label: "指挥官档案", sub: "呼号与阵营" },
  { href: "/guide", no: "V", label: "玩法说明", sub: "操作与机制速览" },
];

// ── 群像编排 ──────────────────────────────────────────────────
// 每张立绘的非透明「内容紧致框」[L,R,T,B,headCx]（占整图比例），用于裁掉透明边、按头部对齐
const GROUP_BBOX = {
  haruhi: [0.08, 0.813, 0.14, 0.902, 0.522],
  koizumi: [0.327, 0.683, 0.08, 0.94, 0.443],
  yuki: [0.24, 0.79, 0.152, 0.932, 0.5],
  future1096: [0.257, 0.78, 0.145, 0.905, 0.44],
  kyon: [0.257, 0.63, 0.06, 0.932, 0.482],
  tsuruya: [0.207, 0.767, 0.105, 0.905, 0.475],
  asakura: [0.167, 0.687, 0.133, 0.885, 0.432],
};
// 数组顺序 = 由后到前叠放。hx 头部横向落点、by 脚底纵向落点、h 身高(占基准画布高)、flip 水平翻转使其面向内
// 春日居中最高压阵（披风向左铺成背景），其余按各自 pose 错落环绕，头部高低交错确保每人都露脸。
const GROUP_LAYOUT = [
  { id: "haruhi", hx: 0.52, by: 1.0, h: 1.0, flip: false },
  { id: "koizumi", hx: 0.72, by: 1.0, h: 0.85, flip: true },
  { id: "kyon", hx: 0.33, by: 1.0, h: 0.85, flip: false },
  { id: "asakura", hx: 0.2, by: 0.99, h: 0.77, flip: true },
  { id: "tsuruya", hx: 0.86, by: 0.99, h: 0.8, flip: true },
  { id: "future1096", hx: 0.62, by: 1.0, h: 0.73, flip: false },
  { id: "yuki", hx: 0.43, by: 1.0, h: 0.71, flip: false },
];
// 编排基准画布的宽高比（定死构图，再 contain 适配各种屏幕比例）
const GROUP_VW = 820;
const GROUP_VH = 940;

function template(faction) {
  const items = ITEMS.map(
    (it, i) => `
    <a class="ts-item" href="${it.href}" data-index="${i}">
      <span class="ts-item-no">${it.no}</span>
      <span class="ts-item-body">
        <span class="ts-item-label">${it.label}</span>
        <span class="ts-item-sub">${it.sub}</span>
      </span>
      <span class="ts-item-cue">▸</span>
    </a>`,
  ).join("");

  return `
    <section class="ts-stage ts-faction-${faction}">
      <canvas class="ts-bg" aria-hidden="true"></canvas>
      <div class="ts-vignette" aria-hidden="true"></div>

      <div class="ts-hero" aria-hidden="true">
        <canvas class="ts-hero-img"></canvas>
      </div>

      <div class="ts-content">
        <header class="ts-head">
          <div class="ts-seal">SOS</div>
          <h1 class="ts-title">射手座之日</h1>
          <p class="ts-subtitle">Star-Calendar Fleet Operations</p>
          <div class="ts-rule"></div>
        </header>

        <nav class="ts-menu" aria-label="主菜单">
          ${items}
        </nav>

        <footer class="ts-foot">
          <span class="ts-ver">原型版 v1.0</span>
          <span class="ts-hint">↑ ↓ 选择　Enter 进入</span>
        </footer>
      </div>
    </section>
  `;
}

export function mount(root, ctx) {
  const faction = getFaction();
  root.innerHTML = template(faction);

  const ac = new AbortController();
  const { signal } = ac;

  const stage = root.querySelector(".ts-stage");
  const bg = root.querySelector(".ts-bg");
  startStarfield(bg, signal);

  // 七人群像：canvas 合成（drawImage 走预乘 alpha，透明区不会产生白边/暗边）
  // 立绘较大，逐张加载、每到一张就按 z 序重绘 —— 菜单本身始终可用，画面渐次浮现。
  const heroCanvas = root.querySelector(".ts-hero-img");
  const heroImgs = {};
  for (const g of GROUP_LAYOUT) {
    const im = new Image();
    im.onload = () => {
      heroImgs[g.id] = im;
      drawGroup();
    };
    im.onerror = () => {}; // 单张缺失就跳过，不影响其余
    im.src = `/assets/portraits/${faction}/${g.id}.png?v=5`;
  }

  function drawGroup() {
    if (!heroCanvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = heroCanvas.clientWidth;
    const ch = heroCanvas.clientHeight;
    if (!cw || !ch) return;
    heroCanvas.width = Math.round(cw * dpr);
    heroCanvas.height = Math.round(ch * dpr);
    const CW = heroCanvas.width;
    const CH = heroCanvas.height;
    const c = heroCanvas.getContext("2d");
    c.clearRect(0, 0, CW, CH);
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = "high";
    // 把基准构图（GROUP_VW×GROUP_VH）按 contain 适配画布，并底部居中
    const scale = Math.min(CW / GROUP_VW, CH / GROUP_VH);
    const vw = GROUP_VW * scale;
    const vh = GROUP_VH * scale;
    const offX = (CW - vw) / 2;
    const offY = CH - vh; // 脚底贴画布底
    for (const g of GROUP_LAYOUT) {
      const im = heroImgs[g.id];
      if (!im || !im.naturalWidth) continue;
      const [L, R, T, B, hcx] = GROUP_BBOX[g.id];
      const sx = L * im.naturalWidth;
      const sy = T * im.naturalHeight;
      const sw = (R - L) * im.naturalWidth;
      const sh = (B - T) * im.naturalHeight;
      const dH = g.h * vh;
      const dW = dH * (sw / sh);
      const headFrac = (hcx - L) / (R - L); // 头部在裁剪框内的横向比例
      const dy = offY + g.by * vh - dH;
      if (g.flip) {
        const dx = offX + g.hx * vw - (1 - headFrac) * dW;
        c.save();
        c.translate(CW, 0);
        c.scale(-1, 1);
        c.drawImage(im, sx, sy, sw, sh, CW - (dx + dW), dy, dW, dH);
        c.restore();
      } else {
        const dx = offX + g.hx * vw - headFrac * dW;
        c.drawImage(im, sx, sy, sw, sh, dx, dy, dW, dH);
      }
    }
  }
  window.addEventListener("resize", drawGroup, { signal });
  requestAnimationFrame(drawGroup); // 等布局完成后再画一次，避免首帧 clientWidth 为 0

  const items = Array.from(root.querySelectorAll(".ts-item"));

  // 键盘导航
  function focusItem(idx) {
    const n = items.length;
    items[((idx % n) + n) % n].focus();
  }
  function currentIndex() {
    return items.indexOf(document.activeElement);
  }
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusItem((currentIndex() < 0 ? -1 : currentIndex()) + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        focusItem((currentIndex() < 0 ? 0 : currentIndex()) - 1);
      } else if (event.key === "Enter") {
        const idx = currentIndex();
        if (idx >= 0) {
          event.preventDefault();
          items[idx].click();
        }
      }
    },
    { signal },
  );

  // 入场后聚焦首项（仅当无键盘焦点环，避免突兀）
  requestAnimationFrame(() => {
    if (stage && document.activeElement === document.body) items[0]?.focus({ preventScroll: true });
  });

  return () => ac.abort();
}
