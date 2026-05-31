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

export function loadPortraitImage(charId) {
  if (imageCache.has(charId)) {
    return imageCache.get(charId);
  }
  const promise = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      imageSyncMap.set(charId, img);
      invalidatePortrait(charId);
      resolve(img);
    };
    img.onerror = () => {
      imageSyncMap.set(charId, null);
      resolve(null);
    };
    img.src = `./assets/portraits/${charId}.png`;
  });
  imageCache.set(charId, promise);
  return promise;
}

// 同步获取已加载的立绘 Image，未加载或失败时返回 null
export function getLoadedPortraitImage(charId) {
  return imageSyncMap.has(charId) ? imageSyncMap.get(charId) : null;
}

export function getPortrait(charId, width = 400, height = 700) {
  const key = `${charId}-${width}x${height}`;
  if (portraitCache.has(key)) {
    return portraitCache.get(key);
  }
  const canvas = generatePortrait(charId, width, height);
  portraitCache.set(key, canvas);
  return canvas;
}

// 强制刷新缓存（在真实图片加载完成后调用）
export function invalidatePortrait(charId) {
  for (const key of [...portraitCache.keys()]) {
    if (key.startsWith(charId + "-")) {
      portraitCache.delete(key);
    }
  }
}

function generatePortrait(charId, width, height) {
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
  const realImg = getLoadedPortraitImage(charId);
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
const HAS_PORTRAIT = new Set(["haruhi", "koizumi", "yuki", "future1096", "kyon"]);

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

  const assignBtnsHTML = SLOT_INFO.map((slot) => {
    const occupant = loadout[slot.key];
    const isCurrent = occupant === charId;
    const occupied = isCurrent
      ? "✓ 已编入"
      : occupant
        ? `${CHARACTER_DEFS[occupant].shortName} · 替换`
        : "空缺";
    return `
      <button type="button" class="cs-assign-btn${isCurrent ? " current" : ""}" data-slot="${slot.key}">
        <span class="cs-assign-btn-slot">${slot.label}</span>
        <span class="cs-assign-btn-occupied">${occupied}</span>
      </button>
    `;
  }).join("");

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
    <div class="cs-page-assign">
      <span class="cs-assign-label">编 入 我 方 舰 队</span>
      <div class="cs-assign-row">${assignBtnsHTML}</div>
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
    portraitImages: {},
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
    </div>
    <div class="cs-folio right">For SOS Brigade Eyes Only</div>
  `;
  content.appendChild(header);

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

  navPrev.addEventListener("click", () => step(-1));
  navNext.addEventListener("click", () => step(1));

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
    <a href="./debug.html" class="cs-mode-link">AI vs AI</a>
    <a href="./online.html" class="cs-mode-link">ONLINE</a>
  `;
  content.appendChild(modeLinks);

  // ── 预加载立绘 ──
  for (const charId of CHARACTER_ORDER) {
    loadPortraitImage(charId).then((img) => {
      state.portraitImages[charId] = img;
      if (state.currentChar === charId && !state.flipping) {
        applyPortrait(pageLeft, charId);
      }
      for (const slot of SLOT_INFO) {
        if (state.loadout[slot.key] === charId) updateFleetSlot(slot.key);
      }
    });
  }

  // ── 立绘填充（真实图片优先，否则用生成占位 canvas） ──
  function portraitUrl(charId) {
    if (HAS_PORTRAIT.has(charId) && state.portraitImages[charId]) {
      return `url('./assets/portraits/${charId}.png')`;
    }
    const canvas = getPortrait(charId, 520, 760);
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
    el.querySelectorAll(".cs-assign-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        assignToSlot(btn.dataset.slot);
      });
    });
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

  // ── 切换 + 翻页 ──
  function switchTo(charId) {
    if (state.flipping) return;
    if (!CHARACTER_DEFS[charId]) return;
    if (charId === state.currentChar) return;
    const fromIdx = getCharIndex(state.currentChar);
    const toIdx = getCharIndex(charId);
    const direction = toIdx > fromIdx ? "next" : "prev";
    flipTo(charId, direction);
  }

  function step(delta) {
    const idx = getCharIndex(state.currentChar);
    const nextIdx = (idx + delta + CHARACTER_ORDER.length) % CHARACTER_ORDER.length;
    switchTo(CHARACTER_ORDER[nextIdx]);
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

  // ── 编入 ──
  function assignToSlot(slotKey) {
    const charId = state.currentChar;
    const currentSlot = findAssignedSlot(charId);
    if (currentSlot === slotKey) {
      state.loadout[slotKey] = null;
    } else {
      if (currentSlot) state.loadout[currentSlot] = null;
      // 若目标槽已被别人占用，先腾出
      state.loadout[slotKey] = charId;
    }
    if (!state.flipping) renderBase();
    for (const slot of SLOT_INFO) updateFleetSlot(slot.key);
    updateLaunch();

    // 自动翻到下一位未编入成员（编队未满时）
    if (!state.loadout.main || !state.loadout.sub1 || !state.loadout.sub2) {
      const nextChar = CHARACTER_ORDER.find(
        (c) => !findAssignedSlot(c) && c !== charId,
      );
      if (nextChar) {
        setTimeout(() => switchTo(nextChar), 360);
      }
    }
  }

  function updateFleetSlot(slotKey) {
    const charId = state.loadout[slotKey];
    const els = fleetSlots[slotKey];
    if (charId) {
      const def = CHARACTER_DEFS[charId];
      els.el.classList.add("filled");
      els.name.textContent = def.shortName;
      if (HAS_PORTRAIT.has(charId) && state.portraitImages[charId]) {
        els.icon.style.backgroundImage = `url(./assets/portraits/${charId}.png)`;
        els.icon.style.backgroundPosition = "center 20%";
      } else {
        const mini = getPortrait(charId, 120, 120);
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
      hide(() => onLaunch(cloneLoadout(state.loadout)));
    }
  }

  function onKey(e) {
    if (!screen.isConnected) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      step(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      step(1);
    } else if (e.key === "1") {
      assignToSlot("main");
    } else if (e.key === "2") {
      assignToSlot("sub1");
    } else if (e.key === "3") {
      assignToSlot("sub2");
    } else if (e.key === "Enter" && !launchBtn.disabled) {
      launch();
    }
  }

  // ── 背景动画（烛光书桌 + 浮金尘） ──
  const particles = [];
  for (let i = 0; i < 70; i++) {
    particles.push({
      x: Math.random() * 1920,
      y: Math.random() * 1080,
      vx: (Math.random() - 0.5) * 0.3,
      vy: -Math.random() * 0.4 - 0.1,
      r: Math.random() * 1.7 + 0.4,
      alpha: Math.random() * 0.4 + 0.15,
      phase: Math.random() * Math.PI * 2,
    });
  }

  let bgAnimId = null;
  function animateBg(time) {
    const bCtx = bgCanvas.getContext("2d");
    const w = bgCanvas.width;
    const h = bgCanvas.height;

    const grad = bCtx.createRadialGradient(w * 0.5, h * 0.4, 0, w * 0.5, h * 0.5, w * 0.85);
    grad.addColorStop(0, "#3a2310");
    grad.addColorStop(0.5, "#1c1006");
    grad.addColorStop(1, "#070401");
    bCtx.fillStyle = grad;
    bCtx.fillRect(0, 0, w, h);

    const t = time * 0.001;
    // 烛光呼吸
    bCtx.save();
    const breathe = 0.06 + Math.sin(t * 1.3) * 0.015;
    bCtx.globalAlpha = breathe;
    const candle = bCtx.createRadialGradient(w * 0.5, h * 0.46, 0, w * 0.5, h * 0.5, w * 0.55);
    candle.addColorStop(0, "#d8a24e");
    candle.addColorStop(0.5, "#6b452040");
    candle.addColorStop(1, "transparent");
    bCtx.fillStyle = candle;
    bCtx.fillRect(0, 0, w, h);
    bCtx.restore();

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
    const stored = readStoredLoadoutForSelect();
    if (stored) {
      state.loadout.main = stored.main;
      state.loadout.sub1 = stored.sub1;
      state.loadout.sub2 = stored.sub2;
      state.currentChar = stored.main || CHARACTER_ORDER[0];
    }
    renderBase();
    for (const slot of SLOT_INFO) updateFleetSlot(slot.key);
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

  function readStoredLoadoutForSelect() {
    try {
      const raw = window.localStorage.getItem("haruhi-player-loadout-v2");
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed.main && parsed.sub1 && parsed.sub2) {
        for (const key of ["main", "sub1", "sub2"]) {
          if (!CHARACTER_DEFS[parsed[key]]) return null;
        }
        return parsed;
      }
    } catch (_e) {
      // ignore
    }
    return null;
  }

  return { show, hide, screen };
}

// ═══════════════════════════════════════════════════
// In-game Portrait Drawing Utility
// ═══════════════════════════════════════════════════
export function drawInGamePortrait(ctx, charId, canvasWidth, canvasHeight, alpha = 0.18) {
  if (!charId || !CHARACTER_THEMES[charId]) return;

  const portrait = getPortrait(charId, 300, 520);
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
