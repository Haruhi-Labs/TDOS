import {
  CHARACTER_ORDER,
  CHARACTER_DEFS,
  cloneLoadout,
  DEFAULT_TEAM_LOADOUT,
} from "../shared/game-core.js";

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

// 立绘按阵营分蓝/红两套：/assets/portraits/{color}/{charId}.png
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
    img.src = `/assets/portraits/${color}/${charId}.png`;
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
  ctx.fillText("PORTRAIT TBA", w * 0.5, tbaY + tbaH / 2);
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
      <span>第 ${ROMAN[idx + 1]} 卷</span>
      <span class="cs-page-num-folio">Folio № ${pad2(idx + 1)} / ${pad2(CHARACTER_ORDER.length)}</span>
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
    ? `已编入<br>${assignedSlot.label}<small>ASSIGNED</small>`
    : `候补<small>RESERVE</small>`;
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
    promptHTML = `本舰已编入 <strong>${mySlot.label}</strong>`;
    ctaLabel = `已选为 ${mySlot.label}`;
    ctaState = "chosen";
  } else if (target) {
    promptHTML = `请选择第 <strong>${step + 1}</strong> 位 · <strong>${target.label}</strong>`;
    ctaLabel = `选为 ${target.label}`;
    ctaState = "select";
  } else {
    promptHTML = `舰队已就绪 · 可出击或退回修改`;
    ctaLabel = `舰队已就绪`;
    ctaState = "ready";
  }
  const canBack = filledCount > 0;
  const backLabel = canBack ? `‹ 退回 · 重选 ${SLOT_INFO[filledCount - 1].label}` : `‹ 退回`;

  return `
    <div class="cs-page-chapter">
      <span>Chapter ${ROMAN[idx + 1]} · Service Record</span>
      <span class="cs-page-chapter-zh">履历 № ${pad2(idx + 1)}</span>
    </div>
    <p class="cs-page-flavor">${def.flavor}</p>
    <div class="cs-page-section-title">
      <span>Ship Particulars</span>
      <span class="cs-page-section-title-zh">舰艇参数</span>
    </div>
    <div class="cs-page-stats">${statsHTML}</div>
    <div class="cs-page-section-title">
      <span>Special Faculties</span>
      <span class="cs-page-section-title-zh">特殊技能</span>
    </div>
    <div class="cs-page-skills">
      <div class="cs-page-skill">
        <div class="cs-page-skill-header">
          <span class="cs-page-skill-type">旗舰技</span>
          <span class="cs-page-skill-name">${def.flagshipSkill.name}</span>
        </div>
        <p class="cs-page-skill-desc">${def.flagshipSkill.description}</p>
      </div>
      <div class="cs-page-skill">
        <div class="cs-page-skill-header">
          <span class="cs-page-skill-type">分舰技</span>
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
    <div class="cs-page-foot">SOS 团战术档案 · <span>仅供出击参考</span></div>
    <div class="cs-flip-shade"></div>
  `;
}

// ═══════════════════════════════════════════════════
// 创建角色选择屏（皮装名鉴 + 3D 翻页）
// ═══════════════════════════════════════════════════
export function createCharacterSelect(onLaunch) {
  const FLIP_MS = 840;

  const state = {
    currentChar: CHARACTER_ORDER[0],
    loadout: { main: null, sub1: null, sub2: null },
    flipping: false,
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
    <div class="cs-folio left">SOS 团 · 机密名鉴 · 卷一</div>
    <div class="cs-header-center">
      <div class="cs-sos-badge">SOS</div>
      <h1 class="cs-title">射手座之日</h1>
      <p class="cs-subtitle">Star-Calendar Roster · Confidential</p>
      <div class="cs-faction" role="group" aria-label="选择阵营">
        <span class="cs-faction-label">阵营</span>
        <button type="button" class="cs-faction-btn blue active" data-color="blue">蓝队</button>
        <button type="button" class="cs-faction-btn red" data-color="red">红队</button>
      </div>
    </div>
    <div class="cs-folio right">For SOS Brigade Eyes Only</div>
  `;
  content.appendChild(header);

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
  navPrev.setAttribute("aria-label", "上一位成员");
  navPrev.textContent = "‹";
  stage.appendChild(navPrev);

  const navNext = document.createElement("button");
  navNext.type = "button";
  navNext.className = "cs-nav-btn cs-nav-next";
  navNext.setAttribute("aria-label", "下一位成员");
  navNext.textContent = "›";
  stage.appendChild(navNext);

  navPrev.addEventListener("click", () => stepArrow(-1, "next")); // ‹ 往左翻
  navNext.addEventListener("click", () => stepArrow(1, "prev")); // › 往右翻

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
        <span class="cs-fleet-slot-label">${slot.label}</span>
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
  launchBtn.innerHTML = `<span class="cs-launch-text">出 击</span><span class="cs-launch-glow"></span>`;
  launchBtn.addEventListener("click", launch);
  fleetBar.appendChild(launchBtn);

  const modeLinks = document.createElement("div");
  modeLinks.className = "cs-mode-links";
  modeLinks.innerHTML = `
    <a href="/" class="cs-mode-link">主菜单</a>
    <a href="/debug" class="cs-mode-link">AI vs AI</a>
    <a href="/online" class="cs-mode-link">ONLINE</a>
  `;
  content.appendChild(modeLinks);

  // ── 预加载某阵营的全部立绘 ──
  function preloadColor(color) {
    for (const charId of CHARACTER_ORDER) {
      loadPortraitImage(charId, color).then(() => {
        if (state.color !== color) return; // 加载完成时已切换阵营，忽略
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
  function portraitUrl(charId) {
    if (HAS_PORTRAIT.has(charId) && getLoadedPortraitImage(charId, state.color)) {
      return `url('/assets/portraits/${state.color}/${charId}.png')`;
    }
    const canvas = getPortrait(charId, 520, 760, state.color);
    return `url(${canvas.toDataURL()})`;
  }

  function applyPortrait(pageEl, charId) {
    const portraitEl = pageEl.querySelector(".cs-portrait");
    if (portraitEl) portraitEl.style.backgroundImage = portraitUrl(charId);
  }

  // ── 渲染 ──
  function renderLeftInto(el, charId) {
    el.innerHTML = renderLeftPageHTML(charId, state.loadout);
    applyPortrait(el, charId);
  }

  function renderRightInto(el, charId) {
    el.innerHTML = renderRightPageHTML(charId, state.loadout);
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
    // 不循环：到首/末页时禁用对应箭头，使“到头了”一目了然
    const idx = getCharIndex(state.currentChar);
    navPrev.disabled = idx <= 0;
    navNext.disabled = idx >= CHARACTER_ORDER.length - 1;
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

  // ── 标签切换：翻页方向朝“被点标签所在的一侧”（右侧标签→往右，左侧标签→往左） ──
  // 视觉：往右翻 = "prev" 动画；往左翻 = "next" 动画
  function switchTo(charId) {
    if (state.flipping) return;
    if (!CHARACTER_DEFS[charId]) return;
    if (charId === state.currentChar) return;
    const fromIdx = getCharIndex(state.currentChar);
    const toIdx = getCharIndex(charId);
    const direction = toIdx > fromIdx ? "prev" : "next";
    flipTo(charId, direction);
  }

  // ── 箭头翻页：永远按箭头朝向翻（› 往右 = "prev"；‹ 往左 = "next"）──
  // 不循环回绕：到首/末页就停。否则回绕时「翻页方向」与「新角色出现的一侧」相反，
  // 会出现“有时候反”的观感。两端到头后用箭头方向到另一端请用角色标签跳转。
  function stepArrow(delta, direction) {
    if (state.flipping) return;
    const idx = getCharIndex(state.currentChar);
    const nextIdx = idx + delta;
    if (nextIdx < 0 || nextIdx >= CHARACTER_ORDER.length) return; // 到头不回绕
    const nextChar = CHARACTER_ORDER[nextIdx];
    if (nextChar === state.currentChar) return;
    flipTo(nextChar, direction);
  }

  function flipTo(nextChar, direction) {
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

    setTimeout(() => {
      state.currentChar = nextChar;
      if (direction === "next") {
        renderLeftInto(pageLeft, nextChar);
      } else {
        renderRightInto(pageRight, nextChar);
      }
      flipper.remove();
      refreshTabs();
      state.flipping = false;
    }, FLIP_MS);
  }

  // ── 顺序编入向导 ──
  // 当前步 = 第一个空舰位的序号（0=主舰,1=副一,2=副二）；返回 3 表示编队已满
  function getStep() {
    const i = SLOT_INFO.findIndex((s) => !state.loadout[s.key]);
    return i === -1 ? SLOT_INFO.length : i;
  }

  // 把当前查看的角色选入当前这一步对应的舰位
  function selectCurrent() {
    if (state.flipping) return;
    const curStep = getStep();
    if (curStep >= SLOT_INFO.length) return;   // 编队已满
    const charId = state.currentChar;
    if (findAssignedSlot(charId)) return;      // 已编入，不能重复选
    state.loadout[SLOT_INFO[curStep].key] = charId;
    afterLoadoutChange();
  }

  // 退回上一步：清掉最近编入的舰位，重新选它
  function stepBack() {
    if (state.flipping) return;
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

  // 高亮底部舰队栏中“当前正在选择”的舰位
  function refreshFleetTarget() {
    const curStep = getStep();
    SLOT_INFO.forEach((s, i) => {
      const targeting = i === curStep;
      fleetSlots[s.key].el.classList.toggle("targeting", targeting);
      if (targeting && !state.loadout[s.key]) {
        fleetSlots[s.key].name.textContent = "选择中";
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
      if (HAS_PORTRAIT.has(charId) && getLoadedPortraitImage(charId, state.color)) {
        els.icon.style.backgroundImage = `url(/assets/portraits/${state.color}/${charId}.png)`;
        els.icon.style.backgroundPosition = "center 20%";
      } else {
        const mini = getPortrait(charId, 120, 120, state.color);
        els.icon.style.backgroundImage = `url(${mini.toDataURL()})`;
      }
    } else {
      els.el.classList.remove("filled");
      els.name.textContent = "— —";
      els.icon.style.backgroundImage = "";
    }
  }

  function updateLaunch() {
    const ready = state.loadout.main && state.loadout.sub1 && state.loadout.sub2;
    launchBtn.disabled = !ready;
    launchBtn.classList.toggle("ready", Boolean(ready));
  }

  function launch() {
    if (state.loadout.main && state.loadout.sub1 && state.loadout.sub2) {
      const color = state.color;
      hide(() => onLaunch(cloneLoadout(state.loadout), color));
    }
  }

  function onKey(e) {
    if (!screen.isConnected) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      stepArrow(-1, "next");
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      stepArrow(1, "prev");
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
    requestAnimationFrame(() => screen.classList.add("visible"));
    bgAnimId = requestAnimationFrame(animateBg);
    document.addEventListener("keydown", onKey);
  }

  function hide(callback) {
    document.removeEventListener("keydown", onKey);
    screen.classList.add("leaving");
    screen.classList.remove("visible");
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
// In-game Portrait Drawing Utility
// ═══════════════════════════════════════════════════
export function drawInGamePortrait(ctx, charId, canvasWidth, canvasHeight, alpha = 0.18, color = "blue") {
  if (!charId || !CHARACTER_THEMES[charId]) return;

  const portrait = getPortrait(charId, 300, 520, color);
  const drawH = canvasHeight * 0.55;
  const drawW = drawH * (300 / 520);
  const x = canvasWidth - drawW - 10;
  const y = canvasHeight - drawH + 20;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(portrait, x, y, drawW, drawH);
  ctx.restore();

  // 边缘羽化（与画布背景色一致）
  ctx.save();
  const leftFade = ctx.createLinearGradient(x - 5, 0, x + drawW * 0.3, 0);
  leftFade.addColorStop(0, "#03050c");
  leftFade.addColorStop(1, "rgba(3,5,12,0)");
  ctx.fillStyle = leftFade;
  ctx.fillRect(x - 5, y, drawW * 0.35, drawH);

  const bottomFade = ctx.createLinearGradient(0, canvasHeight - 30, 0, canvasHeight);
  bottomFade.addColorStop(0, "rgba(3,5,12,0)");
  bottomFade.addColorStop(1, "#03050c");
  ctx.fillStyle = bottomFade;
  ctx.fillRect(x, canvasHeight - 30, drawW, 30);
  ctx.restore();
}
