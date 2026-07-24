import {
  CHARACTER_ORDER,
  CHARACTER_DEFS,
  cloneLoadout,
  DEFAULT_TEAM_LOADOUT,
} from "../shared/game-core.js";
import { isMobile } from "./mobile.js";
import { getDifficulty, setDifficulty } from "./profile.js";
import { t } from "./i18n.js";
import { mountRouteFluidBackdrop } from "./effects/fluid-reveal/routeBackdrop.js";

// 单人难度档(仅在 solo 的选角页显示)。四档同时影响:敌方数值(血量+伤害)缩放 + AI反应快慢,
// 极限额外开启"智能集火残血"(优先收掉你打残的舰)。tip 文案会作为按钮 title 提示。
const DIFFICULTY_LEVELS = [
  { key: "easy", label: "简单", tip: "敌方数值 ×0.8,反应迟钝" },
  { key: "normal", label: "普通", tip: "敌方数值 ×1.0,反应一般" },
  { key: "hard", label: "困难", tip: "敌方数值 ×1.2,反应敏捷(更肉更痛)" },
  { key: "master", label: "极限", tip: "敌方数值 ×1.2,反应最快,且会智能集火收掉你的残血舰" },
];

// 构建难度选择器(prefix: "cs" 桌面 / "csm" 移动),自动读写本地存储并高亮当前档
function buildDifficultyEl(prefix) {
  const wrap = document.createElement("div");
  wrap.className = `${prefix}-difficulty`;
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", t("选择难度"));
  wrap.innerHTML =
    `<span class="${prefix}-faction-label">${t("难度")}</span>` +
    DIFFICULTY_LEVELS.map(
      (d) => `<button type="button" class="${prefix}-diff-btn" data-diff="${d.key}" title="${t(d.tip)}">${t(d.label)}</button>`,
    ).join("");
  const btns = Array.from(wrap.querySelectorAll(`.${prefix}-diff-btn`));
  const sync = () => {
    const cur = getDifficulty();
    for (const b of btns) b.classList.toggle("active", b.dataset.diff === cur);
  };
  for (const b of btns) {
    b.addEventListener("click", () => {
      setDifficulty(b.dataset.diff);
      sync();
    });
  }
  sync();
  return wrap;
}

// ═══════════════════════════════════════════════════
// 角色主题色 — 取自立绘的复古太空军装
// 共用骨架：深海军蓝底 + 金穗描边；primary 是该角色的标志色
// ═══════════════════════════════════════════════════
export const CHARACTER_THEMES = {
  haruhi: {
    // 凉宫春日：朱红披风 + 金穗
    primary: "#d44a45",
    secondary: "#f0d488",
    dark: "#4d0a0c",
    bgCenter: "#1a1638",
    bgMid: "#0c1228",
    bgOuter: "#050912",
    glow: "#d44a45",
    accent: "#f0d488",
  },
  koizumi: {
    // 古泉一树：朱红绶带 + 金扣
    primary: "#b8232a",
    secondary: "#f0d488",
    dark: "#4d0a0c",
    bgCenter: "#1a1438",
    bgMid: "#0a1024",
    bgOuter: "#050912",
    glow: "#d44a45",
    accent: "#f0d488",
  },
  yuki: {
    // 长门有希：薰衣草披风 + 银金
    primary: "#9d8ec8",
    secondary: "#d8c990",
    dark: "#2a1f4e",
    bgCenter: "#1a1438",
    bgMid: "#0a0a24",
    bgOuter: "#050912",
    glow: "#b8a9f0",
    accent: "#d8c990",
  },
  future1096: {
    // 朝比奈：橙红头发 + 蓝制服
    primary: "#e08a3a",
    secondary: "#f0d488",
    dark: "#4d2a0a",
    bgCenter: "#1a1438",
    bgMid: "#0a0e24",
    bgOuter: "#050912",
    glow: "#f0a060",
    accent: "#f0d488",
  },
  kyon: {
    // 阿虚：金穗肩章 + 制服蓝
    primary: "#c8a050",
    secondary: "#f0d488",
    dark: "#3a2a08",
    bgCenter: "#14245a",
    bgMid: "#0c1838",
    bgOuter: "#050912",
    glow: "#f0d488",
    accent: "#f0d488",
  },
  tsuruya: {
    // 鹤屋（暂无立绘）：墨绿 + 金
    primary: "#2e9a6c",
    secondary: "#a0d8b0",
    dark: "#0a2818",
    bgCenter: "#0e2c1c",
    bgMid: "#08180e",
    bgOuter: "#050912",
    glow: "#48b888",
    accent: "#c0e8c8",
  },
  asakura: {
    // 朝仓凉子（暂无立绘）：暗红 + 金
    primary: "#c83c3c",
    secondary: "#f0a890",
    dark: "#4a1010",
    bgCenter: "#280c0c",
    bgMid: "#180606",
    bgOuter: "#050912",
    glow: "#e85050",
    accent: "#f0c0b0",
  },
};

// ═══════════════════════════════════════════════════
// 立绘合成（真实图片 + 复古占位）
// ═══════════════════════════════════════════════════
const portraitCache = new Map();
const imageCache = new Map();

// 同步加载状态：成功时缓存 Image，失败时缓存 null
const imageSyncMap = new Map();

// 立绘按阵营分蓝/红两套：/assets/portraits/{color}/{charId}.webp
export const TEAM_COLORS = ["blue", "red"];
function pkey(charId, color) {
  return `${color}/${charId}`;
}

export function loadPortraitImage(charId, color = "blue") {
  const key = pkey(charId, color);
  if (imageCache.has(key)) {
    return imageCache.get(key);
  }
  const promise = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      imageSyncMap.set(key, img);
      invalidatePortrait(charId, color);
      resolve(img);
    };
    img.onerror = () => {
      imageSyncMap.set(key, null);
      resolve(null);
    };
    img.src = `${import.meta.env.BASE_URL}assets/portraits/${color}/${charId}.webp`;
  });
  imageCache.set(key, promise);
  return promise;
}

// 同步获取已加载的立绘 Image，未加载或失败时返回 null
export function getLoadedPortraitImage(charId, color = "blue") {
  const key = pkey(charId, color);
  return imageSyncMap.has(key) ? imageSyncMap.get(key) : null;
}

export function getPortrait(charId, width = 400, height = 700, color = "blue") {
  const key = `${color}/${charId}-${width}x${height}`;
  if (portraitCache.has(key)) {
    return portraitCache.get(key);
  }
  const canvas = generatePortrait(charId, width, height, color);
  portraitCache.set(key, canvas);
  return canvas;
}

// 强制刷新缓存（在真实图片加载完成后调用）
export function invalidatePortrait(charId, color = "blue") {
  const prefix = `${color}/${charId}-`;
  for (const key of [...portraitCache.keys()]) {
    if (key.startsWith(prefix)) {
      portraitCache.delete(key);
    }
  }
}

function generatePortrait(charId, width, height, color = "blue") {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d");
  const theme = CHARACTER_THEMES[charId];
  const def = CHARACTER_DEFS[charId];

  // 复古星空底色（统一海军蓝调）
  const bgGrad = ctx.createRadialGradient(
    width * 0.5, height * 0.32, 0,
    width * 0.5, height * 0.5, height * 0.85,
  );
  bgGrad.addColorStop(0, "#14245a");
  bgGrad.addColorStop(0.55, "#0a1430");
  bgGrad.addColorStop(1, "#03050c");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // 中心微光（角色色调）
  const glowGrad = ctx.createRadialGradient(
    width * 0.5, height * 0.4, 0,
    width * 0.5, height * 0.4, width * 0.65,
  );
  glowGrad.addColorStop(0, theme.glow + "30");
  glowGrad.addColorStop(0.5, theme.primary + "15");
  glowGrad.addColorStop(1, "transparent");
  ctx.fillStyle = glowGrad;
  ctx.fillRect(0, 0, width, height);

  // 真实立绘（如果已加载）
  const realImg = getLoadedPortraitImage(charId, color);
  if (realImg) {
    drawPortraitImage(ctx, realImg, width, height);
  } else {
    // 优雅占位：徽章 + 名字
    drawElegantPlaceholder(ctx, width, height, theme, def);
  }

  // 复古印刷网点纹（轻微）
  ctx.save();
  ctx.globalAlpha = 0.04;
  ctx.fillStyle = "#f3ead2";
  for (let y = 0; y < height; y += 3) {
    for (let x = 0; x < width; x += 3) {
      if ((x + y) % 6 === 0) {
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  ctx.restore();

  // 上下暗角
  const topVig = ctx.createLinearGradient(0, 0, 0, height * 0.18);
  topVig.addColorStop(0, "rgba(3,5,12,0.7)");
  topVig.addColorStop(1, "transparent");
  ctx.fillStyle = topVig;
  ctx.fillRect(0, 0, width, height * 0.18);

  const botVig = ctx.createLinearGradient(0, height * 0.7, 0, height);
  botVig.addColorStop(0, "transparent");
  botVig.addColorStop(1, "rgba(3,5,12,0.85)");
  ctx.fillStyle = botVig;
  ctx.fillRect(0, height * 0.7, width, height * 0.3);

  // 金线边框
  ctx.save();
  ctx.strokeStyle = theme.accent;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1;
  ctx.strokeRect(2, 2, width - 4, height - 4);
  ctx.restore();

  return c;
}

// 立绘图片绘制：保持比例，居中对齐到面板上半部分
function drawPortraitImage(ctx, img, width, height) {
  const imgRatio = img.width / img.height;
  const targetH = height * 1.05;
  const targetW = targetH * imgRatio;
  const dx = (width - targetW) / 2;
  const dy = -height * 0.02;

  ctx.save();
  // 轻微阴影
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;
  ctx.drawImage(img, dx, dy, targetW, targetH);
  ctx.restore();
}

// 优雅占位：仿勋章/纹章设计（无立绘时使用）
function drawElegantPlaceholder(ctx, w, h, theme, def) {
  const cx = w * 0.5;
  const cy = h * 0.4;
  const r = Math.min(w, h) * 0.26;

  // 外层装饰圆环（虚线）
  ctx.save();
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.4;
  ctx.setLineDash([4, 5]);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.15, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // 八角星徽章
  ctx.save();
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.58;
    const x = cx + Math.cos(angle) * rr;
    const y = cy + Math.sin(angle) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();

  // 内圆
  ctx.save();
  ctx.strokeStyle = theme.accent;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.72, 0, Math.PI * 2);
  ctx.stroke();
  // 内层填色
  ctx.fillStyle = theme.primary + "1a";
  ctx.fill();
  ctx.restore();

  // 中心姓（描边 + 填充）
  ctx.save();
  ctx.font = `700 ${Math.floor(h * 0.16)}px "Noto Serif SC", "Songti SC", serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 2;
  ctx.strokeStyle = theme.dark;
  ctx.strokeText(def.shortName.charAt(0), cx, cy);
  ctx.fillStyle = theme.accent;
  ctx.globalAlpha = 0.95;
  ctx.fillText(def.shortName.charAt(0), cx, cy);
  ctx.restore();

  // 装饰横线
  ctx.save();
  ctx.strokeStyle = theme.accent;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(w * 0.2, h * 0.72);
  ctx.lineTo(w * 0.8, h * 0.72);
  ctx.stroke();
  // 中心菱形
  ctx.beginPath();
  ctx.moveTo(w * 0.5, h * 0.72 - 4);
  ctx.lineTo(w * 0.5 + 4, h * 0.72);
  ctx.lineTo(w * 0.5, h * 0.72 + 4);
  ctx.lineTo(w * 0.5 - 4, h * 0.72);
  ctx.closePath();
  ctx.fillStyle = theme.accent;
  ctx.fill();
  ctx.restore();

  // 全名
  ctx.save();
  ctx.fillStyle = "#f3ead2";
  ctx.font = `700 ${Math.floor(h * 0.052)}px "Noto Serif SC", "Songti SC", serif`;
  ctx.textAlign = "center";
  ctx.fillText(def.name, w * 0.5, h * 0.78);
  ctx.restore();

  // 标题
  ctx.save();
  ctx.fillStyle = theme.accent;
  ctx.globalAlpha = 0.8;
  ctx.font = `italic ${Math.floor(h * 0.028)}px "Cormorant Garamond", "Noto Serif SC", serif`;
  ctx.textAlign = "center";
  ctx.fillText(def.title, w * 0.5, h * 0.83);
  ctx.restore();

  // "TBA"标记
  ctx.save();
  ctx.fillStyle = theme.dark;
  ctx.strokeStyle = theme.accent;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 1;
  const tbaW = w * 0.24;
  const tbaH = h * 0.04;
  const tbaX = (w - tbaW) / 2;
  const tbaY = h * 0.87;
  ctx.fillRect(tbaX, tbaY, tbaW, tbaH);
  ctx.strokeRect(tbaX, tbaY, tbaW, tbaH);
  ctx.fillStyle = theme.accent;
  ctx.globalAlpha = 0.9;
  ctx.font = `600 ${Math.floor(h * 0.022)}px "Cinzel", "Noto Serif SC", serif`;
  ctx.textBaseline = "middle";
  ctx.fillText(t("立绘待补"), w * 0.5, tbaY + tbaH / 2);
  ctx.restore();
}

// ═══════════════════════════════════════════════════
// 角色选择 — 「翻开古书 · 皮装星历名鉴」
// ═══════════════════════════════════════════════════

const SLOT_INFO = [
  { key: "main", label: "主舰", short: "主" },
  { key: "sub1", label: "副舰一", short: "副一" },
  { key: "sub2", label: "副舰二", short: "副二" },
];

function pad2(n) {
  return String(n).padStart(2, "0");
}

// 罗马数字 1..10
const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

// 立绘是否真实存在（CHARACTER_THEMES 里 tsuruya/asakura 暂无图）
const HAS_PORTRAIT = new Set([
  "haruhi", "koizumi", "yuki", "future1096", "kyon", "tsuruya", "asakura",
]);

// 把单页内容渲染为 HTML 字符串（base 与 flipper 共享同一份模板）
function renderLeftPageHTML(charId, loadout) {
  const def = CHARACTER_DEFS[charId];
  const idx = CHARACTER_ORDER.indexOf(charId);

  return `
    <div class="cs-page-num">
      <span>${t("第 {chapter} 卷", { chapter: ROMAN[idx + 1] })}</span>
      <span class="cs-page-num-folio">${t("Folio № {current} / {total}", { current: pad2(idx + 1), total: pad2(CHARACTER_ORDER.length) })}</span>
    </div>
    <div class="cs-portrait-frame">
      <div class="cs-portrait-glow"></div>
      <div class="cs-portrait"></div>
      <span class="cs-photo-corner tl"></span>
      <span class="cs-photo-corner tr"></span>
      <span class="cs-photo-corner bl"></span>
      <span class="cs-photo-corner br"></span>
    </div>
    <div class="cs-page-name-block">
      <div class="cs-page-fullname">${def.name}</div>
      <div class="cs-page-roman">${def.title}</div>
    </div>
    ${renderSealHTML(charId, loadout)}
    <div class="cs-flip-shade"></div>
  `;
}

// 火漆封印：编入时盖在立绘插画板上
function renderSealHTML(charId, loadout) {
  const assignedSlot = SLOT_INFO.find((s) => loadout[s.key] === charId);
  const sealClass = assignedSlot ? "cs-page-seal shown" : "cs-page-seal";
  const sealHTML = assignedSlot
    ? `${t("已编入")}<br>${t(assignedSlot.label)}<small>${t("ASSIGNED")}</small>`
    : `${t("候补")}<small>${t("RESERVE")}</small>`;
  return `<div class="${sealClass}">${sealHTML}</div>`;
}

function renderRightPageHTML(charId, loadout) {
  const def = CHARACTER_DEFS[charId];
  const idx = CHARACTER_ORDER.indexOf(charId);
  const stats = def.stats;

  const statRows = [
    ["HP", stats.hp],
    ["EN", stats.energy],
    ["SPD", stats.speed],
    ["TRN", stats.turnRate.toFixed(2)],
    ["VIS", stats.vision],
    ["RNG", stats.range],
    ["DMG", stats.damage],
    ["ROF", stats.fireRate.toFixed(2)],
  ];
  const statsHTML = statRows
    .map(
      ([label, val]) => `
      <div class="cs-page-stat">
        <span class="cs-page-stat-label">${label}</span>
        <span class="cs-page-stat-val">${val}</span>
      </div>`,
    )
    .join("");

  // 顺序编入向导：第一个空位即当前步；本舰可能已被编入某舰位
  const step = SLOT_INFO.findIndex((s) => !loadout[s.key]); // -1 表示已满
  const done = step === -1;
  const mySlot = SLOT_INFO.find((s) => loadout[s.key] === charId) || null;
  const target = done ? null : SLOT_INFO[step];
  const filledCount = done ? SLOT_INFO.length : step;

  let promptHTML, ctaLabel, ctaState;
  if (mySlot) {
    promptHTML = t("本舰已编入 {slot}", { slot: `<strong>${t(mySlot.label)}</strong>` });
    ctaLabel = t("已选为 {slot}", { slot: t(mySlot.label) });
    ctaState = "chosen";
  } else if (target) {
    promptHTML = t("请选择第 {step} 位 · {slot}", { step: `<strong>${step + 1}</strong>`, slot: `<strong>${t(target.label)}</strong>` });
    ctaLabel = t("选为 {slot}", { slot: t(target.label) });
    ctaState = "select";
  } else {
    promptHTML = t("舰队已就绪 · 可出击或退回修改");
    ctaLabel = t("舰队已就绪");
    ctaState = "ready";
  }
  const canBack = filledCount > 0;
  const backLabel = canBack ? t("‹ 退回 · 重选 {slot}", { slot: t(SLOT_INFO[filledCount - 1].label) }) : t("‹ 退回");

  return `
    <div class="cs-page-fit">
    <div class="cs-page-chapter">
      <span>${t("Chapter {chapter} · Service Record", { chapter: ROMAN[idx + 1] })}</span>
      <span class="cs-page-chapter-zh">${t("履历 № {num}", { num: pad2(idx + 1) })}</span>
    </div>
    <p class="cs-page-flavor">${def.flavor}</p>
    <div class="cs-page-section-title">
      <span>${t("Ship Particulars")}</span>
      <span class="cs-page-section-title-zh">${t("舰艇参数")}</span>
    </div>
    <div class="cs-page-stats">${statsHTML}</div>
    <div class="cs-page-section-title">
      <span>${t("Special Faculties")}</span>
      <span class="cs-page-section-title-zh">${t("特殊技能")}</span>
    </div>
    <div class="cs-page-skills">
      <div class="cs-page-skill">
        <div class="cs-page-skill-header">
          <span class="cs-page-skill-type">${t("旗舰技")}</span>
          <span class="cs-page-skill-name">${def.flagshipSkill.name}</span>
        </div>
        <p class="cs-page-skill-desc">${def.flagshipSkill.description}</p>
      </div>
      <div class="cs-page-skill">
        <div class="cs-page-skill-header">
          <span class="cs-page-skill-type">${t("分舰技")}</span>
          <span class="cs-page-skill-name">${def.subSkill.name}</span>
        </div>
        <p class="cs-page-skill-desc">${def.subSkill.description}</p>
      </div>
    </div>
    <div class="cs-page-enlist">
      <div class="cs-enlist-prompt">${promptHTML}</div>
      <div class="cs-enlist-actions">
        <button type="button" class="cs-enlist-back" data-action="back"${canBack ? "" : " disabled"}>${backLabel}</button>
        <button type="button" class="cs-enlist-cta cs-enlist-${ctaState}" data-action="select"${ctaState === "select" ? "" : " disabled"}>${ctaLabel}</button>
      </div>
    </div>
    <div class="cs-page-foot">${t("SOS 团战术档案 ·")} <span>${t("仅供出击参考")}</span></div>
    </div>
    <div class="cs-flip-shade"></div>
  `;
}

// ═══════════════════════════════════════════════════
// 创建角色选择屏（皮装名鉴 + 3D 翻页）
// ═══════════════════════════════════════════════════
// 桌面版：皮装对开书 + 3D 翻页（保持原样，仅在非移动端使用）
function createDesktopCharacterSelect(onLaunch, opts = {}) {
  const FLIP_MS = 840;

  const state = {
    currentChar: CHARACTER_ORDER[0],
    loadout: { main: null, sub1: null, sub2: null },
    flipping: false,
    flipTimer: null, // 翻页收尾定时器
    flipComplete: null, // 翻页收尾函数（可被提前调用 —— 翻页途中点击即生效）
    color: "blue", // 阵营立绘：左蓝右红，默认蓝队
  };

  // ── DOM 顶层 ──
  const screen = document.createElement("div");
  screen.className = "cs-screen";

  const bgCanvas = document.createElement("canvas");
  bgCanvas.className = "cs-bg-canvas";
  bgCanvas.width = 1920;
  bgCanvas.height = 1080;
  screen.appendChild(bgCanvas);

  const content = document.createElement("div");
  content.className = "cs-content";
  screen.appendChild(content);

  // ── 顶栏 ──
  const header = document.createElement("header");
  header.className = "cs-header";
  header.innerHTML = `
    <div class="cs-folio left">${t("SOS团 舰员档案")}</div>
    <div class="cs-header-center">
      <div class="cs-sos-badge" role="img" aria-label="${t("SOS团")}"></div>
      <h1 class="cs-title">${t("射手座之日")}</h1>
      <p class="cs-subtitle">The Day of Sagittarius</p>
      <div class="cs-faction" role="group" aria-label="${t("选择阵营")}">
        <span class="cs-faction-label">${t("阵营")}</span>
        <button type="button" class="cs-faction-btn blue active" data-color="blue">${t("蓝队")}</button>
        <button type="button" class="cs-faction-btn red" data-color="red">${t("红队")}</button>
      </div>
    </div>
    <div class="cs-folio right"></div>
  `;
  content.appendChild(header);
  if (opts.showDifficulty) {
    const center = header.querySelector(".cs-header-center");
    const faction = center?.querySelector(".cs-faction");
    if (center && faction) {
      const row = document.createElement("div");
      row.className = "cs-setup-row";
      center.insertBefore(row, faction); // 阵营与难度并排成一行
      row.appendChild(faction);
      row.appendChild(buildDifficultyEl("cs"));
    }
  }

  const factionBtns = {
    blue: header.querySelector('.cs-faction-btn.blue'),
    red: header.querySelector('.cs-faction-btn.red'),
  };
  factionBtns.blue.addEventListener("click", () => setColor("blue"));
  factionBtns.red.addEventListener("click", () => setColor("red"));

  // ── 书本主体 ──
  const stage = document.createElement("section");
  stage.className = "cs-book-stage";
  content.appendChild(stage);

  const book = document.createElement("div");
  book.className = "cs-book";
  stage.appendChild(book);

  // 左/右半页（base）
  const pageLeft = document.createElement("div");
  pageLeft.className = "cs-page-half cs-page-left";
  book.appendChild(pageLeft);

  const pageRight = document.createElement("div");
  pageRight.className = "cs-page-half cs-page-right";
  book.appendChild(pageRight);

  // 装订线（独立平面图层，覆盖在书本之上；翻页书页从其下穿过）
  const gutter = document.createElement("div");
  gutter.className = "cs-gutter";
  gutter.innerHTML = `<span class="cs-gutter-deco top"></span><span class="cs-gutter-deco bot"></span>`;
  stage.appendChild(gutter);

  // 翻页箭头
  const navPrev = document.createElement("button");
  navPrev.type = "button";
  navPrev.className = "cs-nav-btn cs-nav-prev";
  navPrev.setAttribute("aria-label", t("上一位成员"));
  navPrev.textContent = "‹";
  stage.appendChild(navPrev);

  const navNext = document.createElement("button");
  navNext.type = "button";
  navNext.className = "cs-nav-btn cs-nav-next";
  navNext.setAttribute("aria-label", t("下一位成员"));
  navNext.textContent = "›";
  stage.appendChild(navNext);

  navPrev.addEventListener("click", () => stepArrow(-1)); // ‹ 上一位（翻页方向按目标相对位置）
  navNext.addEventListener("click", () => stepArrow(1)); // › 下一位（翻页方向按目标相对位置）

  // ── 底栏 ──
  const footer = document.createElement("footer");
  footer.className = "cs-footer";
  content.appendChild(footer);

  const tabsEl = document.createElement("div");
  tabsEl.className = "cs-tabs";
  footer.appendChild(tabsEl);

  const tabBtns = {};
  CHARACTER_ORDER.forEach((charId, idx) => {
    const def = CHARACTER_DEFS[charId];
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "cs-tab";
    tab.dataset.char = charId;
    tab.innerHTML = `
      <span class="cs-tab-no">No.${pad2(idx + 1)}</span>
      <span class="cs-tab-name">${def.shortName}</span>
    `;
    tab.addEventListener("click", () => switchTo(charId));
    tabsEl.appendChild(tab);
    tabBtns[charId] = tab;
  });

  const fleetBar = document.createElement("div");
  fleetBar.className = "cs-fleet-bar";
  footer.appendChild(fleetBar);

  const fleetSlots = {};
  for (const slot of SLOT_INFO) {
    const slotEl = document.createElement("div");
    slotEl.className = "cs-fleet-slot";
    slotEl.dataset.slot = slot.key;
    slotEl.innerHTML = `
      <span class="cs-fleet-slot-icon"></span>
      <span class="cs-fleet-slot-meta">
        <span class="cs-fleet-slot-label">${t(slot.label)}</span>
        <span class="cs-fleet-slot-name">— —</span>
      </span>
    `;
    fleetBar.appendChild(slotEl);
    fleetSlots[slot.key] = {
      el: slotEl,
      icon: slotEl.querySelector(".cs-fleet-slot-icon"),
      name: slotEl.querySelector(".cs-fleet-slot-name"),
    };
  }

  const launchBtn = document.createElement("button");
  launchBtn.type = "button";
  launchBtn.className = "cs-launch";
  launchBtn.disabled = true;
  launchBtn.innerHTML = `<span class="cs-launch-text">${t("出 击")}</span><span class="cs-launch-glow"></span>`;
  launchBtn.addEventListener("click", launch);
  fleetBar.appendChild(launchBtn);

  const modeLinks = document.createElement("div");
  modeLinks.className = "cs-mode-links";
  modeLinks.innerHTML = `
    <button type="button" class="cs-mode-link" data-action="random">${t("随机编队")}</button>
    <a href="/" class="cs-mode-link">${t("主菜单")}</a>
  `;
  modeLinks.querySelector('[data-action="random"]').addEventListener("click", randomFill);
  content.appendChild(modeLinks);

  // ── 预加载某阵营的全部立绘 ──
  function preloadColor(color) {
    for (const charId of CHARACTER_ORDER) {
      loadPortraitImage(charId, color).then(() => {
        if (state.color !== color) return; // 加载完成时已切换阵营，忽略
        buildSmallUrl(charId, color); // 预生成降采样图，翻页时直接用，避免翻页途中才 toDataURL 卡顿
        if (state.currentChar === charId && !state.flipping) {
          applyPortrait(pageLeft, charId);
        }
        const slot = findAssignedSlot(charId);
        if (slot) updateFleetSlot(slot);
      });
    }
  }

  // ── 切换阵营（整体红/蓝立绘） ──
  function setColor(color) {
    if (color === state.color || !TEAM_COLORS.includes(color)) return;
    state.color = color;
    factionBtns.blue.classList.toggle("active", color === "blue");
    factionBtns.red.classList.toggle("active", color === "red");
    screen.classList.toggle("faction-red", color === "red");
    preloadColor(color);
    if (!state.flipping) renderBase();
    for (const slot of SLOT_INFO) updateFleetSlot(slot.key);
  }

  // ── 立绘填充（真实图片优先，否则用生成占位 canvas） ──
  // 页面立绘降采样缓存：原图 3000×4000，页面只显示约 380px。
  // 直接拿原图当背景，翻页 3D 旋转时浏览器要逐帧把超大纹理重采样 → 掉帧（尤其翻到中段背面首绘）。
  // 预先把它降到 ~760 宽缓存起来，翻页时纹理小一个量级，旋转顺滑很多。
  const pagePortraitCache = {};
  function buildSmallUrl(charId, color) {
    const key = `${color}/${charId}`;
    if (pagePortraitCache[key]) return pagePortraitCache[key];
    const img = HAS_PORTRAIT.has(charId) ? getLoadedPortraitImage(charId, color) : null;
    if (!img || !img.naturalWidth) return null;
    const w = 860; // 页面立绘框约 413px，dpr2 需 ~826px；860 足够清晰且比原图 3000 轻 ~12×
    const h = Math.round((w * img.naturalHeight) / img.naturalWidth);
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const cx = cv.getContext("2d");
    cx.imageSmoothingEnabled = true;
    cx.imageSmoothingQuality = "high";
    cx.drawImage(img, 0, 0, w, h);
    const url = `url(${cv.toDataURL("image/png")})`;
    pagePortraitCache[key] = url;
    return url;
  }

  function portraitUrl(charId) {
    const small = buildSmallUrl(charId, state.color);
    if (small) return small;
    // 真图未就绪：先用生成占位，加载完成后 preloadColor 会替换为降采样图
    const canvas = getPortrait(charId, 520, 760, state.color);
    return `url(${canvas.toDataURL()})`;
  }

  function applyPortrait(pageEl, charId) {
    const portraitEl = pageEl.querySelector(".cs-portrait");
    if (portraitEl) portraitEl.style.backgroundImage = portraitUrl(charId);
  }

  // ── 渲染 ──
  // 矮视口自适应:把右页档案(.cs-page-fit)整体等比缩放到正好铺满书页,内容免滚完整显示;
  // 内容本就放得下(正常/高视口)时不缩放(transform 清空),显示与原来完全一致。
  let _fitRaf = 0;
  function fitRight(el) {
    const fit = el && el.querySelector(".cs-page-fit");
    if (!fit) return;
    fit.style.transform = "";
    const cs = getComputedStyle(el);
    const avail = el.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
    const natural = fit.scrollHeight;
    if (avail > 40 && natural > avail + 1) {
      fit.style.transform = `scale(${Math.max(0.5, avail / natural)})`;
    }
  }
  function scheduleFit() {
    if (_fitRaf) cancelAnimationFrame(_fitRaf);
    _fitRaf = requestAnimationFrame(() => fitRight(pageRight));
  }

  function renderLeftInto(el, charId) {
    el.innerHTML = renderLeftPageHTML(charId, state.loadout);
    applyPortrait(el, charId);
  }

  function renderRightInto(el, charId) {
    el.innerHTML = renderRightPageHTML(charId, state.loadout);
    fitRight(el);
    const selectBtn = el.querySelector(".cs-enlist-cta[data-action='select']");
    if (selectBtn) {
      selectBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        selectCurrent();
      });
    }
    const backBtn = el.querySelector(".cs-enlist-back[data-action='back']");
    if (backBtn) {
      backBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        stepBack();
      });
    }
  }

  function renderBase() {
    renderLeftInto(pageLeft, state.currentChar);
    renderRightInto(pageRight, state.currentChar);
    refreshTabs();
  }

  function refreshTabs() {
    for (const c of CHARACTER_ORDER) {
      const t = tabBtns[c];
      t.classList.toggle("current", c === state.currentChar);
      t.classList.toggle("assigned", Boolean(findAssignedSlot(c)));
    }
  }

  function findAssignedSlot(charId) {
    return SLOT_INFO.find((s) => state.loadout[s.key] === charId)?.key || null;
  }

  function getCharIndex(charId) {
    return CHARACTER_ORDER.indexOf(charId);
  }

  function isNarrow() {
    return window.matchMedia("(max-width: 980px)").matches;
  }

  // ── 标签切换：按「书页」逻辑——翻到右边(后面)的角色，页从右往左翻(= "next"/往左)；
  //    翻到左边(前面)的角色，页从左往右翻(= "prev"/往右)。 ──
  // 视觉：往右翻 = "prev" 动画；往左翻 = "next" 动画
  function switchTo(charId) {
    finishFlip(); // 翻页途中点别的角色：先把当前页收尾，再从落定的当前角色翻过去
    if (!CHARACTER_DEFS[charId]) return;
    if (charId === state.currentChar) return;
    const fromIdx = getCharIndex(state.currentChar);
    const toIdx = getCharIndex(charId);
    const direction = toIdx > fromIdx ? "next" : "prev";
    flipTo(charId, direction);
  }

  // ── 箭头翻页：书页逻辑，但方向按「移动方向」而非目标位置，使连续翻动方向一致。
  //    前进(›,delta>0)恒从右往左翻(next)；后退(‹,delta<0)恒从左往右翻(prev)。
  //    首/末页循环回绕时，会刻意保持同向（与目标相对位置相反一次），避免动画方向突变。
  function stepArrow(delta) {
    finishFlip(); // 连续翻页更跟手：先收尾再从落定角色继续翻
    const fromIdx = getCharIndex(state.currentChar);
    const toIdx = (fromIdx + delta + CHARACTER_ORDER.length) % CHARACTER_ORDER.length;
    if (toIdx === fromIdx) return;
    const nextChar = CHARACTER_ORDER[toIdx];
    const direction = delta > 0 ? "next" : "prev";
    flipTo(nextChar, direction);
  }

  // 立即收尾当前翻页：把逻辑状态与底页落到目标、移除动画层。
  // 用于「翻页途中点击即生效」—— 任何交互先收尾再执行，结果落在目标角色上。
  function finishFlip() {
    if (state.flipComplete) state.flipComplete();
  }

  function flipTo(nextChar, direction) {
    finishFlip(); // 上一次翻页若未结束，先瞬间收尾，避免叠加
    // 窄屏（上下堆叠）：跳过 3D 翻页，直接换页
    if (isNarrow()) {
      state.currentChar = nextChar;
      renderBase();
      return;
    }

    state.flipping = true;
    const oldChar = state.currentChar;

    const flipper = document.createElement("div");
    flipper.className = `cs-page-flipper ${direction}`;

    const front = document.createElement("div");
    front.className = "cs-flip-side cs-flip-front cs-page-half";
    const back = document.createElement("div");
    back.className = "cs-flip-side cs-flip-back cs-page-half";

    if (direction === "next") {
      // 翻起的是「当前右页」，向左翻
      front.classList.add("cs-page-right");
      back.classList.add("cs-page-left");
      renderRightInto(front, oldChar);
      renderLeftInto(back, nextChar);
    } else {
      // 翻起的是「当前左页」，向右翻
      front.classList.add("cs-page-left");
      back.classList.add("cs-page-right");
      renderLeftInto(front, oldChar);
      renderRightInto(back, nextChar);
    }

    flipper.appendChild(front);
    flipper.appendChild(back);
    book.appendChild(flipper);

    // 立刻更新被遮挡的另一半（翻页过程中露出新内容）
    if (direction === "next") {
      renderRightInto(pageRight, nextChar);
    } else {
      renderLeftInto(pageLeft, nextChar);
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => flipper.classList.add("flipping"));
    });

    // 收尾抽成可提前调用的函数：到点自动收尾，或被 finishFlip() 立即收尾
    const complete = () => {
      if (state.flipComplete !== complete) return; // 已收尾，避免重复
      state.flipComplete = null;
      if (state.flipTimer) {
        clearTimeout(state.flipTimer);
        state.flipTimer = null;
      }
      state.currentChar = nextChar;
      if (direction === "next") {
        renderLeftInto(pageLeft, nextChar);
      } else {
        renderRightInto(pageRight, nextChar);
      }
      flipper.remove();
      refreshTabs();
      state.flipping = false;
    };
    state.flipComplete = complete;
    // 收尾绑在真实的 transitionend 上：动画若因主线程忙而延后起步，也能完整转完再收尾，
    // 不会被固定定时器提前掐断（之前那种「翻一半就跳完」的卡顿主因之一）。
    flipper.addEventListener("transitionend", (e) => {
      if (e.propertyName === "transform") complete();
    });
    state.flipTimer = setTimeout(complete, FLIP_MS + 1200); // 兜底：transitionend 没来时（极少数情况）
  }

  // ── 顺序编入向导 ──
  // 当前步 = 第一个空舰位的序号（0=主舰,1=副一,2=副二）；返回 3 表示编队已满
  function getStep() {
    const i = SLOT_INFO.findIndex((s) => !state.loadout[s.key]);
    return i === -1 ? SLOT_INFO.length : i;
  }

  // 把当前查看的角色选入当前这一步对应的舰位
  function selectCurrent() {
    finishFlip(); // 翻页途中点「出战/编入」即生效：先把页落定到目标角色，再编入
    const curStep = getStep();
    if (curStep >= SLOT_INFO.length) return;   // 编队已满
    const charId = state.currentChar;
    if (findAssignedSlot(charId)) return;      // 已编入，不能重复选
    state.loadout[SLOT_INFO[curStep].key] = charId;
    afterLoadoutChange();
  }

  // 退回上一步：清掉最近编入的舰位，重新选它
  function stepBack() {
    finishFlip();
    const curStep = getStep();
    if (curStep <= 0) return;
    state.loadout[SLOT_INFO[curStep - 1].key] = null;
    afterLoadoutChange();
  }

  function afterLoadoutChange() {
    if (!state.flipping) renderBase();
    for (const slot of SLOT_INFO) updateFleetSlot(slot.key);
    refreshFleetTarget();
    updateLaunch();
  }

  // 随机编队：从 7 人里抽 3 名不重复，填满 主/副一/副二，书页翻到主舰；可反复点重抽
  function randomFill() {
    finishFlip();
    const pool = CHARACTER_ORDER.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    state.loadout.main = pool[0];
    state.loadout.sub1 = pool[1];
    state.loadout.sub2 = pool[2];
    state.currentChar = pool[0];
    afterLoadoutChange();
  }

  // 高亮底部舰队栏中“当前正在选择”的舰位
  function refreshFleetTarget() {
    const curStep = getStep();
    SLOT_INFO.forEach((s, i) => {
      const targeting = i === curStep;
      fleetSlots[s.key].el.classList.toggle("targeting", targeting);
      if (targeting && !state.loadout[s.key]) {
        fleetSlots[s.key].name.textContent = t("选择中");
      }
    });
  }

  function updateFleetSlot(slotKey) {
    const charId = state.loadout[slotKey];
    const els = fleetSlots[slotKey];
    if (charId) {
      const def = CHARACTER_DEFS[charId];
      els.el.classList.add("filled");
      els.name.textContent = def.shortName;
      els.icon.style.backgroundSize = "cover";
      els.icon.style.backgroundPosition = "center 20%";
      if (HAS_PORTRAIT.has(charId) && getLoadedPortraitImage(charId, state.color)) {
        els.icon.style.backgroundImage = `url(${import.meta.env.BASE_URL}assets/portraits/${state.color}/${charId}.webp)`;
      } else {
        const mini = getPortrait(charId, 120, 120, state.color);
        els.icon.style.backgroundImage = `url(${mini.toDataURL()})`;
      }
    } else {
      els.el.classList.remove("filled");
      els.name.textContent = "— —";
      // 未选：用 SOS团 徽记占位
      els.icon.style.backgroundImage = `url(${import.meta.env.BASE_URL}assets/brand/sos-gold.png)`;
      els.icon.style.backgroundSize = "76%";
      els.icon.style.backgroundPosition = "center";
    }
  }

  function updateLaunch() {
    const ready = state.loadout.main && state.loadout.sub1 && state.loadout.sub2;
    launchBtn.disabled = !ready;
    launchBtn.classList.toggle("ready", Boolean(ready));
  }

  function launch() {
    finishFlip();
    if (state.loadout.main && state.loadout.sub1 && state.loadout.sub2) {
      const color = state.color;
      hide(() => onLaunch(cloneLoadout(state.loadout), color));
    }
  }

  function onKey(e) {
    if (!screen.isConnected) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      stepArrow(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      stepArrow(1);
    } else if (e.key === "Backspace" || e.key === "Escape") {
      e.preventDefault();
      stepBack();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!launchBtn.disabled) launch();
      else selectCurrent();
    }
  }

  // ── 背景动画（烛光书桌浮于星历之海：星空 + 星云 + 流星 + 烛火金尘） ──
  const STAR_CX = 0.5, STAR_CY = 0.46;
  // 星点：外围更亮，让空旷处布满星光；书本所在的中心偏暗不抢戏
  const stars = [];
  for (let i = 0; i < 240; i++) {
    const x = Math.random();
    const y = Math.random();
    const dist = Math.min(1, Math.hypot(x - STAR_CX, y - STAR_CY) / 0.62); // 0=中心 1=边缘
    const big = Math.random() < 0.14;
    stars.push({
      x, y,
      r: big ? Math.random() * 1.5 + 1.4 : Math.random() * 1.2 + 0.4,
      base: (0.32 + Math.random() * 0.55) * (0.42 + 0.58 * dist),
      tw: 0.6 + Math.random() * 1.8,
      phase: Math.random() * Math.PI * 2,
      spike: big && Math.random() < 0.55,
      hue: Math.random(),
    });
  }

  // 静态星云团：给黑处补冷色
  const nebulae = [
    { x: 0.15, y: 0.24, r: 0.44, c: "#3a2e8a" }, // 紫
    { x: 0.87, y: 0.70, r: 0.46, c: "#1f5a7a" }, // 青蓝
    { x: 0.80, y: 0.16, r: 0.34, c: "#5a2a6a" }, // 品红
    { x: 0.10, y: 0.82, r: 0.40, c: "#234a9a" }, // 靛蓝
  ];

  // 流星
  const shooting = [];
  let nextShoot = 1.4;

  // 烛火金尘
  const particles = [];
  for (let i = 0; i < 56; i++) {
    particles.push({
      x: Math.random() * 1920,
      y: Math.random() * 1080,
      vx: (Math.random() - 0.5) * 0.3,
      vy: -Math.random() * 0.4 - 0.1,
      r: Math.random() * 1.6 + 0.4,
      alpha: Math.random() * 0.4 + 0.15,
      phase: Math.random() * Math.PI * 2,
    });
  }

  function starColor(hue) {
    if (hue < 0.55) return "207,224,255"; // 冷白
    if (hue < 0.85) return "255,247,214"; // 暖白/淡金
    return "170,196,255";                  // 蓝
  }

  let bgAnimId = null;
  let fluidBackdrop = null;
  function animateBg(time) {
    const bCtx = bgCanvas.getContext("2d");
    const w = bgCanvas.width;
    const h = bgCanvas.height;
    const t = time * 0.001;

    // 深空底：暖光中心 → 深蓝星夜边缘
    const grad = bCtx.createRadialGradient(w * STAR_CX, h * STAR_CY, 0, w * 0.5, h * 0.5, w * 0.9);
    grad.addColorStop(0, "#2a1d12");
    grad.addColorStop(0.44, "#13142c");
    grad.addColorStop(1, "#070c20");
    bCtx.fillStyle = grad;
    bCtx.fillRect(0, 0, w, h);

    // 星云
    bCtx.save();
    bCtx.globalCompositeOperation = "lighter";
    for (const n of nebulae) {
      const drift = Math.sin(t * 0.12 + n.x * 6) * 0.01;
      const g = bCtx.createRadialGradient(w * n.x, h * (n.y + drift), 0, w * n.x, h * (n.y + drift), w * n.r);
      g.addColorStop(0, n.c + "2e");
      g.addColorStop(0.5, n.c + "12");
      g.addColorStop(1, "transparent");
      bCtx.fillStyle = g;
      bCtx.fillRect(0, 0, w, h);
    }
    bCtx.restore();

    // 星点（闪烁）
    bCtx.save();
    for (const s of stars) {
      const tw = 0.45 + 0.55 * Math.sin(t * s.tw + s.phase);
      const a = s.base * tw;
      if (a <= 0.012) continue;
      const col = starColor(s.hue);
      const px = s.x * w, py = s.y * h;
      bCtx.globalAlpha = a;
      bCtx.fillStyle = `rgb(${col})`;
      bCtx.beginPath();
      bCtx.arc(px, py, s.r, 0, Math.PI * 2);
      bCtx.fill();
      if (s.spike) {
        bCtx.globalAlpha = a * 0.5;
        bCtx.strokeStyle = `rgb(${col})`;
        bCtx.lineWidth = 0.7;
        const L = s.r * 4.6;
        bCtx.beginPath();
        bCtx.moveTo(px - L, py); bCtx.lineTo(px + L, py);
        bCtx.moveTo(px, py - L); bCtx.lineTo(px, py + L);
        bCtx.stroke();
      }
    }
    bCtx.restore();

    // 流星
    if (t > nextShoot) {
      const fromLeft = Math.random() < 0.5;
      shooting.push({
        x: (fromLeft ? Math.random() * 0.3 : 0.7 + Math.random() * 0.3) * w,
        y: Math.random() * 0.42 * h,
        vx: (fromLeft ? 1 : -1) * (5 + Math.random() * 3),
        vy: 2.3 + Math.random() * 1.6,
        life: 0,
        max: 58 + Math.random() * 34,
      });
      nextShoot = t + 2.8 + Math.random() * 3.6;
    }
    bCtx.save();
    bCtx.globalCompositeOperation = "lighter";
    for (let i = shooting.length - 1; i >= 0; i--) {
      const m = shooting[i];
      m.life++;
      m.x += m.vx;
      m.y += m.vy;
      if (m.life > m.max) { shooting.splice(i, 1); continue; }
      const fade = Math.sin((m.life / m.max) * Math.PI); // 0→1→0
      const tailX = m.x - m.vx * 7, tailY = m.y - m.vy * 7;
      const lg = bCtx.createLinearGradient(tailX, tailY, m.x, m.y);
      lg.addColorStop(0, "transparent");
      lg.addColorStop(1, `rgba(240,228,200,${0.7 * fade})`);
      bCtx.strokeStyle = lg;
      bCtx.lineWidth = 1.6;
      bCtx.beginPath();
      bCtx.moveTo(tailX, tailY); bCtx.lineTo(m.x, m.y);
      bCtx.stroke();
      bCtx.globalAlpha = 0.9 * fade;
      bCtx.fillStyle = "#fff6dc";
      bCtx.beginPath(); bCtx.arc(m.x, m.y, 1.5, 0, Math.PI * 2); bCtx.fill();
      bCtx.globalAlpha = 1;
    }
    bCtx.restore();

    // 烛光呼吸（暖光落在书上）
    bCtx.save();
    const breathe = 0.07 + Math.sin(t * 1.3) * 0.018;
    bCtx.globalAlpha = breathe;
    const candle = bCtx.createRadialGradient(w * 0.5, h * 0.46, 0, w * 0.5, h * 0.5, w * 0.5);
    candle.addColorStop(0, "#e0a64e");
    candle.addColorStop(0.5, "#6b452040");
    candle.addColorStop(1, "transparent");
    bCtx.fillStyle = candle;
    bCtx.fillRect(0, 0, w, h);
    bCtx.restore();

    // 金尘（烛火余烬）
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.y < -10) {
        p.y = h + 10;
        p.x = Math.random() * w;
      }
      if (p.x < -10) p.x = w + 10;
      if (p.x > w + 10) p.x = -10;
      const flicker = 0.6 + Math.sin(t * 1.5 + p.phase) * 0.3;
      bCtx.globalAlpha = p.alpha * flicker * 0.7;
      bCtx.fillStyle = p.r > 1.2 ? "#e8c878" : "#c8a96a";
      bCtx.beginPath();
      bCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      bCtx.fill();
    }
    bCtx.globalAlpha = 1;

    bgAnimId = requestAnimationFrame(animateBg);
  }

  // ── 显示 / 隐藏 ──
  function show() {
    document.body.appendChild(screen);
    fluidBackdrop = mountRouteFluidBackdrop(screen, {
      logLabel: "Character select fluid backdrop",
      onReady: () => {
        if (bgAnimId) {
          cancelAnimationFrame(bgAnimId);
          bgAnimId = null;
        }
      },
    });
    // 不预填默认编队：每次都从第一步（选主舰）开始，由玩家自己选
    state.loadout.main = null;
    state.loadout.sub1 = null;
    state.loadout.sub2 = null;
    state.currentChar = CHARACTER_ORDER[0];
    preloadColor(state.color);
    renderBase();
    for (const slot of SLOT_INFO) updateFleetSlot(slot.key);
    refreshFleetTarget();
    updateLaunch();
    bgAnimId = requestAnimationFrame(animateBg);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", scheduleFit);
    // 字体加载完成后行高变化会改变内容高度,需重新测量缩放
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleFit);
    scheduleFit();
    // 等当前角色立绘解码就绪再淡入，避免直接进入时闪现占位图（最多等 300ms 兜底）
    let shown = false;
    const reveal = () => {
      if (shown) return;
      shown = true;
      applyPortrait(pageLeft, state.currentChar);
      requestAnimationFrame(() => screen.classList.add("visible"));
    };
    loadPortraitImage(state.currentChar, state.color).then((img) => {
      // 真图就绪：即便已被 300ms 兜底先行展示占位，也在此刻重绘为真图
      if (img && shown) applyPortrait(pageLeft, state.currentChar);
      reveal();
    });
    setTimeout(reveal, 300);
  }

  function hide(callback) {
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", scheduleFit);
    if (state.flipTimer) {
      clearTimeout(state.flipTimer);
      state.flipTimer = null;
    }
    state.flipComplete = null;
    screen.classList.add("leaving");
    screen.classList.remove("visible");
    fluidBackdrop?.destroy();
    fluidBackdrop = null;
    if (bgAnimId) {
      cancelAnimationFrame(bgAnimId);
      bgAnimId = null;
    }
    setTimeout(() => {
      screen.remove();
      screen.classList.remove("leaving");
      if (callback) callback();
    }, 640);
  }

  return { show, hide, screen };
}

// ═══════════════════════════════════════════════════
// 移动端专属选人（触摸优先）
// 抛弃「对开书 / 3D 翻页」桌面隐喻：整屏大立绘 + 左右滑动/点按切角色 +
// 数据 chip + 底部常驻「编队槽 + 单一主操作（编入/出击）」。与桌面版共享角色数据与编队语义。
// ═══════════════════════════════════════════════════
const MOBILE_STATS = [
  ["舰体", "hp"],
  ["能量", "energy"],
  ["航速", "speed"],
  ["机动", "turnRate"],
  ["射程", "range"],
  ["视野", "vision"],
  ["伤害", "damage"],
  ["射速", "fireRate"],
];

function createMobileCharacterSelect(onLaunch, opts = {}) {
  const state = {
    idx: 0,
    loadout: { main: null, sub1: null, sub2: null },
    color: "blue",
  };

  const screen = document.createElement("div");
  screen.className = "cs-screen csm";
  screen.innerHTML = `
    <div class="csm-top">
      <a class="csm-back" href="/">${t("‹ 主菜单")}</a>
      <button type="button" class="csm-random" data-action="random">${t("随机编队")}</button>
      <div class="csm-faction" role="group" aria-label="${t("选择阵营")}">
        <button type="button" class="csm-faction-btn blue active" data-color="blue">${t("蓝队")}</button>
        <button type="button" class="csm-faction-btn red" data-color="red">${t("红队")}</button>
      </div>
    </div>
    <div class="csm-stage">
      <div class="csm-track"></div>
      <button type="button" class="csm-arrow csm-prev" aria-label="${t("上一位")}">‹</button>
      <button type="button" class="csm-arrow csm-next" aria-label="${t("下一位")}">›</button>
    </div>
    <div class="csm-info">
      <div class="csm-dots"></div>
      <div class="csm-flavor"></div>
      <div class="csm-stats"></div>
      <div class="csm-skills"></div>
    </div>
    <div class="csm-bar">
      <div class="csm-fleet"></div>
      <button type="button" class="csm-cta" disabled></button>
    </div>
  `;
  let fluidBackdrop = null;
  if (opts.showDifficulty) {
    const top = screen.querySelector(".csm-top");
    const faction = top?.querySelector(".csm-faction");
    if (top && faction) {
      const row = document.createElement("div");
      row.className = "csm-setup-row";
      top.insertAdjacentElement("afterend", row); // 顶栏下方整行,阵营与难度并排
      row.appendChild(faction);
      row.appendChild(buildDifficultyEl("csm"));
    }
  }

  const els = {
    stage: screen.querySelector(".csm-stage"),
    track: screen.querySelector(".csm-track"),
    dots: screen.querySelector(".csm-dots"),
    flavor: screen.querySelector(".csm-flavor"),
    stats: screen.querySelector(".csm-stats"),
    skills: screen.querySelector(".csm-skills"),
    fleet: screen.querySelector(".csm-fleet"),
    cta: screen.querySelector(".csm-cta"),
    prev: screen.querySelector(".csm-prev"),
    next: screen.querySelector(".csm-next"),
    random: screen.querySelector(".csm-random"),
    factionBlue: screen.querySelector(".csm-faction-btn.blue"),
    factionRed: screen.querySelector(".csm-faction-btn.red"),
  };

  // 立绘轮播：每位一张幻灯（立绘 + 名牌）。首尾各放一张克隆实现无缝循环：
  // 轨道顺序 = [末位克隆, 0, 1, …, N-1, 首位克隆]，真实第 idx 张在 DOM 第 idx+1 位。
  const N = CHARACTER_ORDER.length;
  function makeSlide(charId, labelIdx) {
    const def = CHARACTER_DEFS[charId];
    const slide = document.createElement("div");
    slide.className = "csm-slide";
    slide.innerHTML = `
      <div class="csm-portrait"></div>
      <div class="csm-caption">
        <div class="csm-idx">${pad2(labelIdx + 1)} / ${pad2(N)}</div>
        <div class="csm-name">${def.name}</div>
        <div class="csm-title">${def.title}</div>
      </div>`;
    return slide;
  }
  const cloneLast = makeSlide(CHARACTER_ORDER[N - 1], N - 1);
  els.track.appendChild(cloneLast);
  const slideEls = [];
  const slidePortraits = [];
  CHARACTER_ORDER.forEach((id, i) => {
    const slide = makeSlide(id, i);
    els.track.appendChild(slide);
    slideEls.push(slide);
    slidePortraits.push(slide.querySelector(".csm-portrait"));
  });
  const cloneFirst = makeSlide(CHARACTER_ORDER[0], 0);
  els.track.appendChild(cloneFirst);
  const cloneFirstPortrait = cloneFirst.querySelector(".csm-portrait");
  const cloneLastPortrait = cloneLast.querySelector(".csm-portrait");

  // 索引点
  CHARACTER_ORDER.forEach((id, i) => {
    const d = document.createElement("button");
    d.type = "button";
    d.className = "csm-dot";
    d.dataset.idx = String(i);
    d.setAttribute("aria-label", CHARACTER_DEFS[id].shortName);
    d.addEventListener("click", () => go(i));
    els.dots.appendChild(d);
  });

  // 编队槽
  const fleetSlots = {};
  for (const slot of SLOT_INFO) {
    const s = document.createElement("button");
    s.type = "button";
    s.className = "csm-slot";
    s.dataset.slot = slot.key;
    s.innerHTML = `<span class="csm-slot-icon"></span><span class="csm-slot-label">${t(slot.short)}</span>`;
    s.addEventListener("click", () => {
      if (state.loadout[slot.key]) {
        state.loadout[slot.key] = null; // 点已填舰位 = 移出，便于重选
        renderAll();
      }
    });
    els.fleet.appendChild(s);
    fleetSlots[slot.key] = { el: s, icon: s.querySelector(".csm-slot-icon") };
  }

  const curId = () => CHARACTER_ORDER[state.idx];
  const assignedSlot = (charId) => SLOT_INFO.find((s) => state.loadout[s.key] === charId)?.key || null;
  const nextStep = () => {
    const i = SLOT_INFO.findIndex((s) => !state.loadout[s.key]);
    return i === -1 ? SLOT_INFO.length : i;
  };
  const isReady = () => Boolean(state.loadout.main && state.loadout.sub1 && state.loadout.sub2);
  const slideW = () => els.stage.clientWidth || window.innerWidth;

  // 轨道定位：移到 DOM 第 pos 位（含首尾克隆），pos = idx + 1
  function trackTo(pos, animate) {
    els.track.classList.remove("csm-dragging");
    if (!animate) {
      els.track.style.transition = "none";
      els.track.style.transform = `translateX(${-pos * slideW()}px)`;
      void els.track.offsetWidth; // 强制回流，使后续变化才有过渡
      els.track.style.transition = "";
    } else {
      els.track.style.transform = `translateX(${-pos * slideW()}px)`;
    }
  }
  function snapToIdx(animate = true) { trackTo(state.idx + 1, animate); }

  // 循环切换：越过末位→滑到尾部「首位克隆」，越过首位→滑到头部「末位克隆」；
  // 动画结束后瞬移到对应真实幻灯（克隆与真实外观一致，看不出跳变）。
  let wrapResetPos = null;
  function go(i) {
    if (i >= N) {
      state.idx = 0; renderInfo();
      wrapResetPos = 1; trackTo(N + 1, true);
    } else if (i < 0) {
      state.idx = N - 1; renderInfo();
      wrapResetPos = N; trackTo(0, true);
    } else {
      state.idx = i; renderInfo();
      wrapResetPos = null; // 普通移动：清掉可能挂起的循环归位，避免动画被打断时错位
      snapToIdx(true);
    }
  }
  els.track.addEventListener("transitionend", (e) => {
    if (e.propertyName === "transform" && wrapResetPos != null) {
      trackTo(wrapResetPos, false);
      wrapResetPos = null;
    }
  });

  function ctaAction() {
    if (isReady()) {
      launch();
      return;
    }
    const id = curId();
    const slot = assignedSlot(id);
    if (slot) {
      state.loadout[slot] = null; // 当前舰已编入 → 移出
      renderAll();
      return;
    }
    const step = nextStep();
    if (step < SLOT_INFO.length) {
      state.loadout[SLOT_INFO[step].key] = id;
      // 编入后自动跳到下一个未编入的角色，连选更顺
      const taken = new Set(SLOT_INFO.map((s) => state.loadout[s.key]).filter(Boolean));
      if (!isReady()) {
        for (let k = 1; k <= CHARACTER_ORDER.length; k++) {
          const ni = (state.idx + k) % CHARACTER_ORDER.length;
          if (!taken.has(CHARACTER_ORDER[ni])) { state.idx = ni; break; }
        }
      }
      renderAll();
      snapToIdx(true); // 滑到自动跳转后的新角色
    }
  }

  // 随机编队：抽 3 名不重复填满，滑到主舰；可反复点重抽
  function randomFill() {
    const pool = CHARACTER_ORDER.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    state.loadout.main = pool[0];
    state.loadout.sub1 = pool[1];
    state.loadout.sub2 = pool[2];
    state.idx = CHARACTER_ORDER.indexOf(pool[0]);
    renderAll();
    snapToIdx(false);
  }

  function launch() {
    if (!isReady()) return;
    hide(() => onLaunch(cloneLoadout(state.loadout), state.color));
  }

  function setColor(color) {
    if (color === state.color || !TEAM_COLORS.includes(color)) return;
    state.color = color;
    els.factionBlue.classList.toggle("active", color === "blue");
    els.factionRed.classList.toggle("active", color === "red");
    screen.classList.toggle("faction-red", color === "red");
    applyAllSlides();
    preload(color);
    renderAll();
  }

  function preload(color) {
    for (let i = 0; i < CHARACTER_ORDER.length; i++) {
      const id = CHARACTER_ORDER[i];
      loadPortraitImage(id, color).then(() => {
        if (state.color !== color) return;
        applySlide(i);
        if (assignedSlot(id)) renderSlot(assignedSlot(id));
      });
    }
  }

  function portraitUrl(charId) {
    if (HAS_PORTRAIT.has(charId) && getLoadedPortraitImage(charId, state.color)) {
      return `url(${import.meta.env.BASE_URL}assets/portraits/${state.color}/${charId}.webp)`;
    }
    return `url(${getPortrait(charId, 520, 760, state.color).toDataURL()})`;
  }
  function applySlide(i) {
    const url = portraitUrl(CHARACTER_ORDER[i]);
    slidePortraits[i].style.backgroundImage = url;
    if (i === 0) cloneFirstPortrait.style.backgroundImage = url; // 首位克隆同步
    if (i === N - 1) cloneLastPortrait.style.backgroundImage = url; // 末位克隆同步
  }
  function applyAllSlides() {
    for (let i = 0; i < CHARACTER_ORDER.length; i++) applySlide(i);
  }

  function renderSlot(key) {
    const charId = state.loadout[key];
    const s = fleetSlots[key];
    s.el.classList.toggle("filled", Boolean(charId));
    if (charId) {
      s.icon.style.backgroundSize = "cover";
      s.icon.style.backgroundPosition = "center 16%";
      if (HAS_PORTRAIT.has(charId) && getLoadedPortraitImage(charId, state.color)) {
        s.icon.style.backgroundImage = `url(${import.meta.env.BASE_URL}assets/portraits/${state.color}/${charId}.webp)`;
      } else {
        s.icon.style.backgroundImage = `url(${getPortrait(charId, 120, 120, state.color).toDataURL()})`;
      }
    } else {
      // 未选：用 SOS团 徽记占位
      s.icon.style.backgroundImage = `url(${import.meta.env.BASE_URL}assets/brand/sos-gold.png)`;
      s.icon.style.backgroundSize = "72%";
      s.icon.style.backgroundPosition = "center";
    }
  }

  function renderCta() {
    const id = curId();
    if (isReady()) {
      els.cta.textContent = t("出 击");
      els.cta.className = "csm-cta ready";
      els.cta.disabled = false;
      return;
    }
    if (assignedSlot(id)) {
      els.cta.textContent = t("移出编队");
      els.cta.className = "csm-cta remove";
      els.cta.disabled = false;
      return;
    }
    els.cta.textContent = t("编入 · {slot}", { slot: t(SLOT_INFO[nextStep()].label) });
    els.cta.className = "csm-cta select";
    els.cta.disabled = false;
  }

  function renderInfo() {
    const def = CHARACTER_DEFS[curId()];
    if (els.flavor) els.flavor.textContent = def.flavor;
    els.stats.innerHTML = MOBILE_STATS.map(([label, key]) => {
      let v = def.stats[key];
      if (key === "turnRate" || key === "fireRate") v = Number(v).toFixed(2);
      return `<div class="csm-chip"><span>${t(label)}</span><strong>${v}</strong></div>`;
    }).join("");
    els.skills.innerHTML = `
      <div class="csm-skill"><div class="csm-skill-head"><span class="csm-skill-tag">${t("旗舰技")}</span><span class="csm-skill-name">${def.flagshipSkill.name}</span></div><p class="csm-skill-desc">${def.flagshipSkill.description}</p></div>
      <div class="csm-skill"><div class="csm-skill-head"><span class="csm-skill-tag">${t("分舰技")}</span><span class="csm-skill-name">${def.subSkill.name}</span></div><p class="csm-skill-desc">${def.subSkill.description}</p></div>`;
    for (const d of els.dots.children) d.classList.toggle("active", Number(d.dataset.idx) === state.idx);
    renderCta();
  }

  function renderAll() {
    const step = nextStep();
    for (const s of SLOT_INFO) {
      renderSlot(s.key);
      fleetSlots[s.key].el.classList.toggle("targeting", SLOT_INFO.indexOf(s) === step && !isReady());
    }
    slideEls.forEach((sl, i) => sl.classList.toggle("is-assigned", Boolean(assignedSlot(CHARACTER_ORDER[i]))));
    renderInfo();
  }

  // ── 交互 ──
  els.prev.addEventListener("click", () => go(state.idx - 1));
  els.next.addEventListener("click", () => go(state.idx + 1));
  els.cta.addEventListener("click", ctaAction);
  els.random?.addEventListener("click", randomFill);
  els.factionBlue.addEventListener("click", () => setColor("blue"));
  els.factionRed.addEventListener("click", () => setColor("red"));

  // 立绘区：手指拖动跟手平滑滑动；松手按位移决定切换或回弹
  let dragX0 = null, dragY0 = null, dragging = false, dragBase = 0;
  els.stage.addEventListener("touchstart", (e) => {
    const t = e.changedTouches[0];
    dragX0 = t.clientX; dragY0 = t.clientY; dragging = false;
    dragBase = -(state.idx + 1) * slideW(); // 真实槽位偏移（首位克隆占 DOM 0）
  }, { passive: true });
  els.stage.addEventListener("touchmove", (e) => {
    if (dragX0 == null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - dragX0, dy = t.clientY - dragY0;
    if (!dragging) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
        dragging = true;
        els.track.classList.add("csm-dragging");
      } else if (Math.abs(dy) > 12) {
        dragX0 = null; // 纵向意图，交给页面
        return;
      } else {
        return;
      }
    }
    const W = slideW();
    let x = dragBase + dx;
    // 允许拖进首尾克隆（DOM 0 / N+1）以便循环；再往外才阻尼回弹
    if (x > 0) x *= 0.35;
    else if (x < -(N + 1) * W) x = -(N + 1) * W + (x + (N + 1) * W) * 0.35;
    els.track.style.transform = `translateX(${x}px)`;
  }, { passive: true });
  els.stage.addEventListener("touchend", (e) => {
    if (dragX0 == null) { dragging = false; return; }
    const dx = e.changedTouches[0].clientX - dragX0;
    if (dragging) {
      if (Math.abs(dx) > slideW() * 0.16) go(state.idx + (dx < 0 ? 1 : -1));
      else snapToIdx(true);
    }
    dragX0 = dragY0 = null; dragging = false;
  }, { passive: true });

  function onResize() { snapToIdx(false); }

  function onKey(e) {
    if (!screen.isConnected) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); go(state.idx - 1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); go(state.idx + 1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ctaAction(); }
  }

  function show() {
    document.body.appendChild(screen);
    fluidBackdrop = mountRouteFluidBackdrop(screen, {
      logLabel: "Character select fluid backdrop",
    });
    state.loadout = { main: null, sub1: null, sub2: null };
    state.idx = 0;
    screen.classList.toggle("faction-red", state.color === "red");
    els.factionBlue.classList.toggle("active", state.color === "blue");
    els.factionRed.classList.toggle("active", state.color === "red");
    applyAllSlides();
    preload(state.color);
    renderAll();
    snapToIdx(false);
    window.addEventListener("resize", onResize);
    document.addEventListener("keydown", onKey);
    // 等当前角色立绘解码就绪再淡入，避免直接进入时闪现占位图（最多等 300ms 兜底）
    let shown = false;
    const reveal = () => {
      if (shown) return;
      shown = true;
      applyAllSlides();
      requestAnimationFrame(() => {
        screen.classList.add("visible");
        snapToIdx(false);
      });
    };
    loadPortraitImage(CHARACTER_ORDER[state.idx], state.color).then((img) => {
      // 真图就绪：即便已被 300ms 兜底先行展示占位，也在此刻重绘为真图
      if (img && shown) applyAllSlides();
      reveal();
    });
    setTimeout(reveal, 300);
  }

  function hide(callback) {
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", onResize);
    screen.classList.add("leaving");
    screen.classList.remove("visible");
    fluidBackdrop?.destroy();
    fluidBackdrop = null;
    setTimeout(() => {
      screen.remove();
      screen.classList.remove("leaving");
      if (callback) callback();
    }, 480);
  }

  return { show, hide, screen };
}

// 对外入口：按视口在「桌面对开书」与「移动专属布局」之间选择（show 时判定，跨档自动重建）
export function createCharacterSelect(onLaunch, opts = {}) {
  let impl = null;
  let builtMobile = null;
  function ensure() {
    const m = isMobile();
    if (impl && builtMobile === m) return impl;
    impl = m ? createMobileCharacterSelect(onLaunch, opts) : createDesktopCharacterSelect(onLaunch, opts);
    builtMobile = m;
    return impl;
  }
  return {
    show() { ensure().show(); },
    hide(cb) { if (impl) impl.hide(cb); else if (cb) cb(); },
    get screen() { return impl ? impl.screen : null; },
  };
}

// ═══════════════════════════════════════════════════
// In-game Portrait Drawing Utility
// ═══════════════════════════════════════════════════
export function drawInGamePortrait(ctx, charId, canvasWidth, canvasHeight, alpha = 0.18, color = "blue", side = "right") {
  if (!charId || !CHARACTER_THEMES[charId]) return;

  // 只画原始立绘（带真实透明通道），不再合成底图、也不画边缘羽化矩形，
  // 保证透明区完全透明、不会给背景蒙上一层。
  const img = getLoadedPortraitImage(charId, color);
  if (!img) {
    loadPortraitImage(charId, color); // 触发异步加载，加载完成后续帧自然画出
    return;
  }

  const drawH = canvasHeight * 0.55;
  const drawW = drawH * (img.width / img.height);
  const x = side === "left" ? 10 : canvasWidth - drawW - 10;
  const y = canvasHeight - drawH + 20;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, x, y, drawW, drawH);
  ctx.restore();
}
