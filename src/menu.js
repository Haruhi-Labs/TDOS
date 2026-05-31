// ═══════════════════════════════════════════════════════════════
// 主菜单 / 标题画面（路由 /）
// 左：标题 + 竖排菜单；右：随阵营着色的关键立绘；底：动态星尘背景。
// 键盘 ↑↓ 选择、Enter 进入。出战编队不在此处选，进入对战时再挑。
// ═══════════════════════════════════════════════════════════════

import { getFaction } from "./profile.js";

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
        <img class="ts-hero-img" src="/assets/portraits/${faction}/${HERO_CHAR}.png" alt="" />
        <div class="ts-hero-fade"></div>
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

// 星尘背景动画
function startBackground(canvas, signal) {
  const ctx = canvas.getContext("2d");
  let raf = 0;
  let w = 0;
  let h = 0;
  let stars = [];

  function resize() {
    w = canvas.width = canvas.clientWidth * (window.devicePixelRatio || 1);
    h = canvas.height = canvas.clientHeight * (window.devicePixelRatio || 1);
    const count = Math.round((w * h) / 26000);
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
      ctx.arc(s.x, s.y, s.r * (window.devicePixelRatio || 1), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  signal.addEventListener("abort", () => cancelAnimationFrame(raf));
}

export function mount(root, ctx) {
  const faction = getFaction();
  root.innerHTML = template(faction);

  const ac = new AbortController();
  const { signal } = ac;

  const stage = root.querySelector(".ts-stage");
  const bg = root.querySelector(".ts-bg");
  startBackground(bg, signal);

  // 立绘加载失败则隐藏（鹤屋/朝仓暂无立绘）
  const heroImg = root.querySelector(".ts-hero-img");
  heroImg.addEventListener("error", () => {
    const hero = root.querySelector(".ts-hero");
    if (hero) hero.style.display = "none";
  }, { signal });

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
