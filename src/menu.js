// ═══════════════════════════════════════════════════════════════
// 主菜单 / 标题画面（路由 /）
// 左：标题 + 竖排菜单；右：七人群像（前后拥簇，随阵营着色）；底：动态星尘背景。
// 键盘 ↑↓ 选择、Enter 进入。出战编队不在此处选，进入对战时再挑。
// ═══════════════════════════════════════════════════════════════

import { getFaction } from "./profile.js";
import { startStarfield } from "./starfield.js";
import { isMobile } from "./mobile.js";
import { bindLanguageSelector, languageSelectorHTML, t } from "./i18n.js";

const ITEMS = [
  { href: "/play", no: "I", label: "单人实战", sub: "挑选舰队，迎击 AI 舰群" },
  { href: "/online", no: "II", label: "在线对战", sub: "大厅匹配，与真人同步交战" },
  { href: "/profile", no: "III", label: "指挥官档案", sub: "呼号与阵营" },
  { href: "/guide", no: "IV", label: "玩法说明", sub: "操作与机制速览" },
  { href: "/credits", no: "V", label: "制作人员", sub: "画师 · 设计开发 · 出品" },
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
  { id: "tsuruya", hx: 0.86, by: 0.99, h: 0.72, flip: true },
  { id: "future1096", hx: 0.62, by: 1.0, h: 0.73, flip: false },
  { id: "yuki", hx: 0.43, by: 1.0, h: 0.71, flip: false },
];
// 编排基准画布的宽高比（定死构图，再 contain 适配各种屏幕比例）
const GROUP_VW = 820;
const GROUP_VH = 940;
// 移动端 hero：在 contain 基础上轻微放大并居中；幅度小以免裁到头部，下半身没入菜单羽化
const MOBILE_HERO_ZOOM = 1.06;

const GITHUB_URL = "https://github.com/Haruhi-Labs/TDOS";
const GROUP_URL = "https://qm.qq.com/q/zg5Bl5Ugwg";
const VERSION_LABEL = "公测版 v0.1";

// 首页 GitHub 链接(内嵌 Octocat 标记,fill 跟随 currentColor 以适配主题色)
function githubLinkHTML() {
  return `<a class="ts-github" href="${GITHUB_URL}" target="_blank" rel="noopener noreferrer" aria-label="${t("GitHub 源码仓库")}" title="GitHub · TDOS">` +
    `<svg viewBox="0 0 16 16" width="17" height="17" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>` +
    `</a>`;
}

// 首页加群链接(内嵌群组标记,fill 跟随 currentColor 以适配主题色)
function groupLinkHTML() {
  const label = t("加入游戏交流群");
  return `<a class="ts-github ts-group" href="${GROUP_URL}" target="_blank" rel="noopener noreferrer" aria-label="${label}" title="${label}">` +
    `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M16 18a4 4 0 0 0-8 0"/><circle cx="12" cy="9" r="3"/>` +
    `<path d="M5.5 17a3 3 0 0 1 3-3.5M18.5 17a3 3 0 0 0-3-3.5"/>` +
    `<circle cx="5.5" cy="10.5" r="2"/><circle cx="18.5" cy="10.5" r="2"/></svg>` +
    `</a>`;
}

function menuItemsHTML() {
  return ITEMS.map(
    (it, i) => `
    <a class="ts-item" href="${it.href}" data-index="${i}">
      <span class="ts-item-no">${it.no}</span>
      <span class="ts-item-body">
        <span class="ts-item-label">${t(it.label)}</span>
        <span class="ts-item-sub">${t(it.sub)}</span>
      </span>
      <span class="ts-item-cue">▸</span>
    </a>`,
  ).join("");
}

// 移动端专属：纵向堆叠 —— 标题 / 清晰群像 hero / 大触控菜单行
// （复用 .ts-bg/.ts-hero-img/.ts-item 钩子，逻辑共享；群像在流内，不再压成满屏毛玻璃背景）
function mobileTemplate(faction) {
  return `
    <section class="ts-stage mmenu ts-faction-${faction}">
      <canvas class="ts-bg" aria-hidden="true"></canvas>
      <div class="mmenu-shell">
        <header class="mmenu-head">
          <div class="ts-seal" role="img" aria-label="${t("SOS团")}"></div>
          <h1 class="ts-title">${t("射手座之日")}</h1>
        </header>
        <div class="ts-hero mmenu-hero" aria-hidden="true"><canvas class="ts-hero-img"></canvas></div>
        <nav class="ts-menu mmenu-list" aria-label="${t("主菜单")}">${menuItemsHTML()}</nav>
        <footer class="mmenu-foot"><span class="ts-ver">${t(VERSION_LABEL)}</span>${githubLinkHTML()}${groupLinkHTML()}${languageSelectorHTML("ts-language")}</footer>
      </div>
    </section>
  `;
}

function template(faction) {
  const items = menuItemsHTML();

  return `
    <section class="ts-stage ts-faction-${faction}">
      <canvas class="ts-bg" aria-hidden="true"></canvas>
      <div class="ts-vignette" aria-hidden="true"></div>

      <div class="ts-hero" aria-hidden="true">
        <canvas class="ts-hero-img"></canvas>
      </div>

      <div class="ts-content">
        <header class="ts-head">
          <div class="ts-seal" role="img" aria-label="${t("SOS团")}"></div>
          <h1 class="ts-title">${t("射手座之日")}</h1>
          <p class="ts-subtitle">The Day of Sagittarius</p>
          <div class="ts-rule"></div>
        </header>

        <nav class="ts-menu" aria-label="${t("主菜单")}">
          ${items}
        </nav>

        <footer class="ts-foot">
          <span class="ts-foot-meta"><span class="ts-ver">${t(VERSION_LABEL)}</span>${githubLinkHTML()}${groupLinkHTML()}${languageSelectorHTML("ts-language")}</span>
          <span class="ts-hint">${t("↑ ↓ 选择　Enter 进入")}</span>
        </footer>
      </div>
    </section>
  `;
}

export function mount(root, ctx) {
  const faction = getFaction();
  const mobile = isMobile();
  root.innerHTML = (mobile ? mobileTemplate : template)(faction);
  bindLanguageSelector(root);

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
    im.src = `${import.meta.env.BASE_URL}assets/portraits/${faction}/${g.id}.webp`;
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
    // 把基准构图（GROUP_VW×GROUP_VH）适配画布：桌面 contain 底部居中；
    // 移动端 hero 较窄，放大并居中、脚底略压出框，使核心人物醒目而非七人挤成一排
    const fit = Math.min(CW / GROUP_VW, CH / GROUP_VH);
    const scale = mobile ? fit * MOBILE_HERO_ZOOM : fit;
    const vw = GROUP_VW * scale;
    const vh = GROUP_VH * scale;
    const offX = (CW - vw) / 2;
    // 移动端：锚定让头部完整留在框内（仅留极小顶边距），下半身自然没入菜单区羽化；
    // 桌面：脚底贴画布底
    const offY = mobile ? Math.max(CH - vh, CH * 0.03) : CH - vh;
    const U = vh; // 后处理尺度基准

    // ① 落地阴影池：把群像“踩”在地上
    c.save();
    c.translate(offX + vw * 0.52, offY + vh * 0.985);
    c.scale(1, 0.16);
    const pool = c.createRadialGradient(0, 0, 0, 0, 0, vw * 0.46);
    pool.addColorStop(0, "rgba(0,0,0,0.7)");
    pool.addColorStop(0.6, "rgba(2,4,12,0.4)");
    pool.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = pool;
    c.beginPath();
    c.arc(0, 0, vw * 0.46, 0, Math.PI * 2);
    c.fill();
    c.restore();

    // ② 立绘 + 相互分离投影（由后到前，叠压处产生接触阴影，读出前后层次）
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
      c.save();
      c.shadowColor = "rgba(3,6,16,0.6)";
      c.shadowBlur = U * 0.05;
      c.shadowOffsetY = U * 0.022;
      if (g.flip) {
        const dx = offX + g.hx * vw - (1 - headFrac) * dW;
        c.shadowOffsetX = U * 0.012;
        c.translate(CW, 0);
        c.scale(-1, 1);
        c.drawImage(im, sx, sy, sw, sh, CW - (dx + dW), dy, dW, dH);
      } else {
        const dx = offX + g.hx * vw - headFrac * dW;
        c.shadowOffsetX = -U * 0.012;
        c.drawImage(im, sx, sy, sw, sh, dx, dy, dW, dH);
      }
      c.restore();
    }

    // 复用一块离屏画布做柔光与提色（ctx.filter 不支持时自动降级为普通拷贝，构图照样成立）
    const fxCanvas = document.createElement("canvas");
    fxCanvas.width = CW;
    fxCanvas.height = CH;
    const fc = fxCanvas.getContext("2d");

    // ③ 柔光 Bloom：模糊副本以 screen 叠加，给立绘通透高光
    fc.filter = `blur(${U * 0.012}px)`;
    fc.drawImage(heroCanvas, 0, 0);
    c.save();
    c.globalCompositeOperation = "screen";
    c.globalAlpha = 0.18;
    c.drawImage(fxCanvas, 0, 0);
    c.restore();

    // ④ 调色：仅作用于立绘像素 —— 顶部暖光、底部冷暗、左右冷暖侧光，聚焦面部
    c.save();
    c.globalCompositeOperation = "source-atop";
    const vert = c.createLinearGradient(0, offY, 0, offY + vh);
    vert.addColorStop(0, "rgba(255,226,170,0.12)");
    vert.addColorStop(0.42, "rgba(255,238,210,0)");
    vert.addColorStop(0.72, "rgba(12,22,52,0)");
    vert.addColorStop(1, "rgba(8,16,42,0.5)");
    c.fillStyle = vert;
    c.fillRect(0, offY, CW, vh);
    const side = c.createLinearGradient(offX, 0, offX + vw, 0);
    side.addColorStop(0, "rgba(80,120,210,0.10)");
    side.addColorStop(0.6, "rgba(0,0,0,0)");
    side.addColorStop(1, "rgba(255,214,150,0.12)");
    c.fillStyle = side;
    c.fillRect(0, offY, CW, vh);
    c.restore();

    // ⑤ 全局微提饱和与对比，让立绘更通透
    fc.filter = "none";
    fc.clearRect(0, 0, CW, CH);
    fc.drawImage(heroCanvas, 0, 0);
    c.clearRect(0, 0, CW, CH);
    c.save();
    c.filter = "saturate(1.12) contrast(1.05)";
    c.drawImage(fxCanvas, 0, 0);
    c.restore();
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
