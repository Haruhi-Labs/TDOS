// ═══════════════════════════════════════════════════════════════
// 主菜单 / 标题画面（路由 /）
// 左：标题 + 竖排菜单；右：随阵营着色的关键立绘；底：动态星尘背景。
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

const HERO_CHAR = "haruhi";

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

  // 关键立绘：用 canvas 绘制（drawImage 走预乘 alpha，透明区不会产生白边/暗边）
  const heroCanvas = root.querySelector(".ts-hero-img");
  const heroImg = new Image();
  heroImg.onload = drawHero;
  heroImg.onerror = () => {
    const hero = root.querySelector(".ts-hero");
    if (hero) hero.style.display = "none";
  };
  heroImg.src = `/assets/portraits/${faction}/${HERO_CHAR}.png?v=5`;

  function drawHero() {
    if (!heroCanvas || !heroImg.naturalWidth) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = heroCanvas.clientWidth;
    const ch = heroCanvas.clientHeight;
    if (!cw || !ch) return;
    heroCanvas.width = Math.round(cw * dpr);
    heroCanvas.height = Math.round(ch * dpr);
    const c = heroCanvas.getContext("2d");
    c.clearRect(0, 0, heroCanvas.width, heroCanvas.height);
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = "high";
    // contain，贴右下
    const scale = Math.min(heroCanvas.width / heroImg.naturalWidth, heroCanvas.height / heroImg.naturalHeight);
    const w = heroImg.naturalWidth * scale;
    const h = heroImg.naturalHeight * scale;
    c.drawImage(heroImg, heroCanvas.width - w, heroCanvas.height - h, w, h);
  }
  window.addEventListener("resize", drawHero, { signal });
  requestAnimationFrame(drawHero); // 等布局完成后再画一次，避免首帧 clientWidth 为 0

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
