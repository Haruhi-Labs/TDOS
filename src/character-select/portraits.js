import { CHARACTER_DEFS } from "../../shared/game-core.js";
import { t } from "../i18n.js";

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
  shamisen: {
    // 三味线：三花暖橙 + 舰队蓝 + 金色项圈
    primary: "#d88745",
    secondary: "#f0d488",
    dark: "#352214",
    bgCenter: "#182647",
    bgMid: "#0b142a",
    bgOuter: "#050912",
    glow: "#e3a064",
    accent: "#f0d488",
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

// 公共目录中的立绘没有构建哈希；资源内容发生替换时改用新文件名，避免线上长期缓存继续命中旧图。
export function getPortraitAssetUrl(charId, color = "blue") {
  const fileName = charId === "shamisen" ? "shamisen-paw" : charId;
  return `${import.meta.env.BASE_URL}assets/portraits/${color}/${fileName}.webp`;
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
    img.src = getPortraitAssetUrl(charId, color);
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
