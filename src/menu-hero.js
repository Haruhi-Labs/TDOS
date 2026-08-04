// 主菜单与子菜单共用的七人群像合成器。
// 统一使用同一套立绘、构图、调色和响应式规则，避免页面切换时背景风格跳变。

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
const GROUP_LAYOUT = [
  { id: "haruhi", hx: 0.52, by: 1.0, h: 1.0, flip: false },
  { id: "koizumi", hx: 0.72, by: 1.0, h: 0.85, flip: true },
  { id: "kyon", hx: 0.33, by: 1.0, h: 0.85, flip: false },
  { id: "asakura", hx: 0.2, by: 0.99, h: 0.77, flip: true },
  { id: "tsuruya", hx: 0.86, by: 0.99, h: 0.72, flip: true },
  { id: "future1096", hx: 0.62, by: 1.0, h: 0.73, flip: false },
  { id: "yuki", hx: 0.43, by: 1.0, h: 0.71, flip: false },
];

const GROUP_VW = 820;
const GROUP_VH = 940;
const MOBILE_HERO_ZOOM = 1.06;

// 路由切换前后复用同一批已解码立绘。首页完成加载后，单人子菜单首帧即可直接
// 合成完整群像与柔光，不再从空画布逐张浮现。
const HERO_IMAGE_CACHE = new Map();
const HERO_IMAGE_LOADS = new Map();

function heroImageKey(faction, id) {
  return `${faction}/${id}`;
}

function loadHeroImage(faction, id) {
  const key = heroImageKey(faction, id);
  if (HERO_IMAGE_CACHE.has(key)) return Promise.resolve(HERO_IMAGE_CACHE.get(key));
  if (HERO_IMAGE_LOADS.has(key)) return HERO_IMAGE_LOADS.get(key);

  const promise = new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      HERO_IMAGE_CACHE.set(key, image);
      HERO_IMAGE_LOADS.delete(key);
      resolve(image);
    };
    image.onerror = () => {
      HERO_IMAGE_LOADS.delete(key);
      resolve(null);
    };
    image.src = `${import.meta.env.BASE_URL}assets/portraits/${key}.webp`;
  });
  HERO_IMAGE_LOADS.set(key, promise);
  return promise;
}

export function startMenuHero(heroCanvas, { faction, signal, mobile = false }) {
  if (!heroCanvas) return;

  const heroImgs = {};

  function drawGroup() {
    if (signal?.aborted) return;
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

    const fit = Math.min(CW / GROUP_VW, CH / GROUP_VH);
    const scale = mobile ? fit * MOBILE_HERO_ZOOM : fit;
    const vw = GROUP_VW * scale;
    const vh = GROUP_VH * scale;
    const offX = (CW - vw) / 2;
    const offY = mobile ? Math.max(CH - vh, CH * 0.03) : CH - vh;
    const U = vh;

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
      const headFrac = (hcx - L) / (R - L);
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

    const fxCanvas = document.createElement("canvas");
    fxCanvas.width = CW;
    fxCanvas.height = CH;
    const fc = fxCanvas.getContext("2d");

    fc.filter = `blur(${U * 0.012}px)`;
    fc.drawImage(heroCanvas, 0, 0);
    c.save();
    c.globalCompositeOperation = "screen";
    c.globalAlpha = 0.18;
    c.drawImage(fxCanvas, 0, 0);
    c.restore();

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

    fc.filter = "none";
    fc.clearRect(0, 0, CW, CH);
    fc.drawImage(heroCanvas, 0, 0);
    c.clearRect(0, 0, CW, CH);
    c.save();
    c.filter = "saturate(1.12) contrast(1.05)";
    c.drawImage(fxCanvas, 0, 0);
    c.restore();
  }

  for (const g of GROUP_LAYOUT) {
    const key = heroImageKey(faction, g.id);
    if (HERO_IMAGE_CACHE.has(key)) {
      const image = HERO_IMAGE_CACHE.get(key);
      if (image) heroImgs[g.id] = image;
      continue;
    }
    loadHeroImage(faction, g.id).then((image) => {
      if (!image || signal?.aborted) return;
      heroImgs[g.id] = image;
      drawGroup();
    });
  }

  window.addEventListener("resize", drawGroup, { signal });
  requestAnimationFrame(drawGroup);
}
