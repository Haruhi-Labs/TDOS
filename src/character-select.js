import {
  CHARACTER_ORDER,
  CHARACTER_DEFS,
  cloneLoadout,
  DEFAULT_TEAM_LOADOUT,
} from "../shared/game-core.js";

// ═══════════════════════════════════════════════════
// Character Visual Themes
// ═══════════════════════════════════════════════════
export const CHARACTER_THEMES = {
  haruhi: {
    primary: "#FFA500",
    secondary: "#FFD700",
    dark: "#4A2800",
    bgCenter: "#3D2200",
    bgMid: "#1A0E00",
    bgOuter: "#0A0500",
    glow: "#FFA500",
    accent: "#FFE066",
  },
  koizumi: {
    primary: "#DC3545",
    secondary: "#FF6B6B",
    dark: "#4A0010",
    bgCenter: "#3D000D",
    bgMid: "#1A0006",
    bgOuter: "#0A0003",
    glow: "#FF4444",
    accent: "#FF9999",
  },
  yuki: {
    primary: "#7B68EE",
    secondary: "#B8A9FF",
    dark: "#2A1F5E",
    bgCenter: "#231A50",
    bgMid: "#0F0B28",
    bgOuter: "#060414",
    glow: "#9370DB",
    accent: "#D4CCFF",
  },
  future1096: {
    primary: "#FF69B4",
    secondary: "#FFB6D9",
    dark: "#5E1A3D",
    bgCenter: "#4A1530",
    bgMid: "#200A16",
    bgOuter: "#10050B",
    glow: "#FF1493",
    accent: "#FFD0E8",
  },
  kyon: {
    primary: "#4A90D9",
    secondary: "#87CEEB",
    dark: "#1A3A5F",
    bgCenter: "#15304D",
    bgMid: "#0A1828",
    bgOuter: "#050C14",
    glow: "#5BA0E0",
    accent: "#B8DEFF",
  },
  tsuruya: {
    primary: "#2ECC71",
    secondary: "#7DEFA0",
    dark: "#145A32",
    bgCenter: "#104828",
    bgMid: "#082414",
    bgOuter: "#04120A",
    glow: "#27AE60",
    accent: "#A8F0C8",
  },
  asakura: {
    primary: "#E74C3C",
    secondary: "#F1948A",
    dark: "#641E16",
    bgCenter: "#501810",
    bgMid: "#280C08",
    bgOuter: "#140604",
    glow: "#C0392B",
    accent: "#FADBD8",
  },
};

// ═══════════════════════════════════════════════════
// Portrait Generation (Canvas Placeholders)
// ═══════════════════════════════════════════════════
const portraitCache = new Map();

export function getPortrait(charId, width = 400, height = 700) {
  const key = `${charId}-${width}x${height}`;
  if (portraitCache.has(key)) {
    return portraitCache.get(key);
  }
  const canvas = generatePortrait(charId, width, height);
  portraitCache.set(key, canvas);
  return canvas;
}

function generatePortrait(charId, width, height) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d");
  const theme = CHARACTER_THEMES[charId];
  const def = CHARACTER_DEFS[charId];

  // Background radial gradient
  const bgGrad = ctx.createRadialGradient(width * 0.5, height * 0.32, 0, width * 0.5, height * 0.32, height * 0.75);
  bgGrad.addColorStop(0, theme.bgCenter);
  bgGrad.addColorStop(0.5, theme.bgMid);
  bgGrad.addColorStop(1, theme.bgOuter);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // Central glow orb
  const glowGrad = ctx.createRadialGradient(width * 0.5, height * 0.28, 0, width * 0.5, height * 0.28, width * 0.7);
  glowGrad.addColorStop(0, theme.glow + "40");
  glowGrad.addColorStop(0.4, theme.glow + "18");
  glowGrad.addColorStop(1, "transparent");
  ctx.fillStyle = glowGrad;
  ctx.fillRect(0, 0, width, height);

  // Energy lines (vertical)
  ctx.save();
  ctx.globalAlpha = 0.08;
  ctx.strokeStyle = theme.primary;
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 12; i++) {
    const x = width * (0.08 + 0.076 * i);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + 10, height * 0.3, x - 10, height * 0.6, x + 5, height);
    ctx.stroke();
  }
  ctx.restore();

  // Horizontal energy bands
  ctx.save();
  ctx.globalAlpha = 0.05;
  for (let i = 0; i < 5; i++) {
    const y = height * (0.15 + i * 0.16);
    const bandGrad = ctx.createLinearGradient(0, y - 2, 0, y + 4);
    bandGrad.addColorStop(0, "transparent");
    bandGrad.addColorStop(0.5, theme.primary);
    bandGrad.addColorStop(1, "transparent");
    ctx.fillStyle = bandGrad;
    ctx.fillRect(0, y - 2, width, 6);
  }
  ctx.restore();

  // Abstract geometric decoration
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.strokeStyle = theme.secondary;
  ctx.lineWidth = 2;
  // Diamond shape
  ctx.beginPath();
  ctx.moveTo(width * 0.5, height * 0.08);
  ctx.lineTo(width * 0.85, height * 0.35);
  ctx.lineTo(width * 0.5, height * 0.62);
  ctx.lineTo(width * 0.15, height * 0.35);
  ctx.closePath();
  ctx.stroke();
  // Inner diamond
  ctx.beginPath();
  ctx.moveTo(width * 0.5, height * 0.18);
  ctx.lineTo(width * 0.72, height * 0.35);
  ctx.lineTo(width * 0.5, height * 0.52);
  ctx.lineTo(width * 0.28, height * 0.35);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();

  // Silhouette placeholder shape (abstract figure)
  drawSilhouette(ctx, width, height, theme);

  // Large background kanji (very subtle)
  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = theme.primary;
  ctx.font = `bold ${Math.floor(height * 0.28)}px "Noto Sans SC", "PingFang SC", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(def.shortName, width * 0.5, height * 0.36);
  ctx.restore();

  // Character name
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = theme.glow;
  ctx.shadowBlur = 25;
  ctx.font = `bold ${Math.floor(height * 0.052)}px "Noto Sans SC", "PingFang SC", sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(def.name, width * 0.5, height * 0.8);
  ctx.restore();

  // Title
  ctx.save();
  ctx.fillStyle = theme.accent;
  ctx.globalAlpha = 0.85;
  ctx.font = `${Math.floor(height * 0.026)}px "Noto Sans SC", "PingFang SC", sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(def.title, width * 0.5, height * 0.855);
  ctx.restore();

  // Bottom vignette
  const vigGrad = ctx.createLinearGradient(0, height * 0.7, 0, height);
  vigGrad.addColorStop(0, "transparent");
  vigGrad.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = vigGrad;
  ctx.fillRect(0, height * 0.7, width, height * 0.3);

  // Top vignette
  const topVig = ctx.createLinearGradient(0, 0, 0, height * 0.15);
  topVig.addColorStop(0, "rgba(0,0,0,0.4)");
  topVig.addColorStop(1, "transparent");
  ctx.fillStyle = topVig;
  ctx.fillRect(0, 0, width, height * 0.15);

  // Edge glow lines
  ctx.save();
  ctx.globalAlpha = 0.15;
  const edgeGrad = ctx.createLinearGradient(0, 0, 0, height);
  edgeGrad.addColorStop(0, "transparent");
  edgeGrad.addColorStop(0.3, theme.primary);
  edgeGrad.addColorStop(0.7, theme.primary);
  edgeGrad.addColorStop(1, "transparent");
  ctx.strokeStyle = edgeGrad;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(1, 0);
  ctx.lineTo(1, height);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(width - 1, 0);
  ctx.lineTo(width - 1, height);
  ctx.stroke();
  ctx.restore();

  return c;
}

function drawSilhouette(ctx, w, h, theme) {
  ctx.save();
  ctx.globalAlpha = 0.12;

  // Head
  ctx.fillStyle = theme.primary;
  ctx.beginPath();
  ctx.ellipse(w * 0.5, h * 0.16, w * 0.1, w * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();

  // Neck
  ctx.fillRect(w * 0.45, h * 0.21, w * 0.1, h * 0.04);

  // Torso
  ctx.beginPath();
  ctx.moveTo(w * 0.3, h * 0.25);
  ctx.lineTo(w * 0.7, h * 0.25);
  ctx.lineTo(w * 0.72, h * 0.52);
  ctx.lineTo(w * 0.28, h * 0.52);
  ctx.closePath();
  ctx.fill();

  // Arms
  ctx.beginPath();
  ctx.moveTo(w * 0.3, h * 0.26);
  ctx.quadraticCurveTo(w * 0.12, h * 0.38, w * 0.18, h * 0.52);
  ctx.lineTo(w * 0.25, h * 0.5);
  ctx.quadraticCurveTo(w * 0.2, h * 0.38, w * 0.32, h * 0.28);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(w * 0.7, h * 0.26);
  ctx.quadraticCurveTo(w * 0.88, h * 0.38, w * 0.82, h * 0.52);
  ctx.lineTo(w * 0.75, h * 0.5);
  ctx.quadraticCurveTo(w * 0.8, h * 0.38, w * 0.68, h * 0.28);
  ctx.closePath();
  ctx.fill();

  // Lower body
  ctx.beginPath();
  ctx.moveTo(w * 0.28, h * 0.52);
  ctx.lineTo(w * 0.72, h * 0.52);
  ctx.lineTo(w * 0.78, h * 0.95);
  ctx.lineTo(w * 0.22, h * 0.95);
  ctx.closePath();
  ctx.fill();

  // Glow around the figure
  const figGlow = ctx.createRadialGradient(w * 0.5, h * 0.4, w * 0.05, w * 0.5, h * 0.4, w * 0.45);
  figGlow.addColorStop(0, theme.glow + "30");
  figGlow.addColorStop(1, "transparent");
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = figGlow;
  ctx.fillRect(0, 0, w, h);

  ctx.restore();
}

// Try to load actual portrait image, fall back to canvas
const imageCache = new Map();

export function loadPortraitImage(charId) {
  if (imageCache.has(charId)) {
    return imageCache.get(charId);
  }
  const promise = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = `./assets/portraits/${charId}.png`;
  });
  imageCache.set(charId, promise);
  return promise;
}

// ═══════════════════════════════════════════════════
// Character Select Screen
// ═══════════════════════════════════════════════════

export function createCharacterSelect(onLaunch) {
  const state = {
    activeSlot: "main",
    loadout: { main: null, sub1: null, sub2: null },
    hoveredChar: CHARACTER_ORDER[0],
    portraitImages: {},
  };

  // Pre-load portrait images
  for (const charId of CHARACTER_ORDER) {
    loadPortraitImage(charId).then((img) => {
      state.portraitImages[charId] = img;
    });
  }

  // ── Build DOM ──
  const screen = document.createElement("div");
  screen.className = "cs-screen";

  // Background canvas for particles
  const bgCanvas = document.createElement("canvas");
  bgCanvas.className = "cs-bg-canvas";
  bgCanvas.width = 1920;
  bgCanvas.height = 1080;
  screen.appendChild(bgCanvas);

  // Content wrapper
  const content = document.createElement("div");
  content.className = "cs-content";
  screen.appendChild(content);

  // Header
  const header = document.createElement("div");
  header.className = "cs-header";
  header.innerHTML = `
    <div class="cs-sos-badge">SOS</div>
    <h1 class="cs-title">射手座之日</h1>
    <p class="cs-subtitle">SELECT YOUR FLEET</p>
  `;
  content.appendChild(header);

  // Roster
  const roster = document.createElement("div");
  roster.className = "cs-roster";
  content.appendChild(roster);

  const panels = {};
  for (let i = 0; i < CHARACTER_ORDER.length; i++) {
    const charId = CHARACTER_ORDER[i];
    const def = CHARACTER_DEFS[charId];
    const theme = CHARACTER_THEMES[charId];

    const panel = document.createElement("div");
    panel.className = "cs-panel";
    panel.dataset.char = charId;
    panel.style.setProperty("--char-color", theme.primary);
    panel.style.setProperty("--char-glow", theme.glow);
    panel.style.setProperty("--char-dark", theme.dark);

    // Portrait background
    const panelBg = document.createElement("div");
    panelBg.className = "cs-panel-bg";
    const portrait = getPortrait(charId, 300, 520);
    panelBg.style.backgroundImage = `url(${portrait.toDataURL()})`;
    panel.appendChild(panelBg);

    // Glow overlay
    const glowOverlay = document.createElement("div");
    glowOverlay.className = "cs-panel-glow";
    panel.appendChild(glowOverlay);

    // Flash streak (hover effect)
    const flash = document.createElement("div");
    flash.className = "cs-panel-flash";
    panel.appendChild(flash);

    // Name label
    const nameLabel = document.createElement("div");
    nameLabel.className = "cs-panel-name";
    nameLabel.innerHTML = `<span class="cs-panel-name-main">${def.shortName}</span>`;
    panel.appendChild(nameLabel);

    // Selection indicator
    const selectIndicator = document.createElement("div");
    selectIndicator.className = "cs-panel-select-indicator";
    panel.appendChild(selectIndicator);

    panels[charId] = panel;
    roster.appendChild(panel);

    // Events
    panel.addEventListener("mouseenter", () => {
      state.hoveredChar = charId;
      updateDetail();
    });
    panel.addEventListener("click", () => {
      assignCharacter(charId);
    });
  }

  // Bottom section
  const bottom = document.createElement("div");
  bottom.className = "cs-bottom";
  content.appendChild(bottom);

  // Detail panel
  const detail = document.createElement("div");
  detail.className = "cs-detail";
  bottom.appendChild(detail);

  const detailPortrait = document.createElement("div");
  detailPortrait.className = "cs-detail-portrait";
  detail.appendChild(detailPortrait);

  const detailPortraitCanvas = document.createElement("canvas");
  detailPortraitCanvas.className = "cs-detail-portrait-canvas";
  detailPortraitCanvas.width = 300;
  detailPortraitCanvas.height = 520;
  detailPortrait.appendChild(detailPortraitCanvas);

  const detailInfo = document.createElement("div");
  detailInfo.className = "cs-detail-info";
  detail.appendChild(detailInfo);

  // Fleet slots
  const fleetArea = document.createElement("div");
  fleetArea.className = "cs-fleet-area";
  bottom.appendChild(fleetArea);

  const fleetLabel = document.createElement("div");
  fleetLabel.className = "cs-fleet-label";
  fleetLabel.textContent = "YOUR FLEET";
  fleetArea.appendChild(fleetLabel);

  const fleet = document.createElement("div");
  fleet.className = "cs-fleet";
  fleetArea.appendChild(fleet);

  const slotElements = {};
  for (const [slotKey, slotName] of [
    ["main", "主舰"],
    ["sub1", "副舰一"],
    ["sub2", "副舰二"],
  ]) {
    const slot = document.createElement("div");
    slot.className = `cs-slot${slotKey === state.activeSlot ? " active" : ""}`;
    slot.dataset.slot = slotKey;

    const slotIcon = document.createElement("div");
    slotIcon.className = "cs-slot-icon";
    slot.appendChild(slotIcon);

    const slotLabel = document.createElement("div");
    slotLabel.className = "cs-slot-label";
    slotLabel.textContent = slotName;
    slot.appendChild(slotLabel);

    const slotChar = document.createElement("div");
    slotChar.className = "cs-slot-char";
    slotChar.textContent = "----";
    slot.appendChild(slotChar);

    slotElements[slotKey] = { el: slot, icon: slotIcon, charLabel: slotChar };
    fleet.appendChild(slot);

    slot.addEventListener("click", () => {
      state.activeSlot = slotKey;
      updateSlots();
    });
  }

  // Launch button
  const launchBtn = document.createElement("button");
  launchBtn.className = "cs-launch";
  launchBtn.disabled = true;
  launchBtn.innerHTML = '<span class="cs-launch-text">出 击</span><span class="cs-launch-glow"></span>';
  fleetArea.appendChild(launchBtn);

  launchBtn.addEventListener("click", () => {
    if (state.loadout.main && state.loadout.sub1 && state.loadout.sub2) {
      hide(() => {
        onLaunch(cloneLoadout(state.loadout));
      });
    }
  });

  // Mode links
  const modeLinks = document.createElement("div");
  modeLinks.className = "cs-mode-links";
  modeLinks.innerHTML = `
    <a href="./debug.html" class="cs-mode-link">AI vs AI</a>
    <a href="./online.html" class="cs-mode-link">ONLINE</a>
  `;
  fleetArea.appendChild(modeLinks);

  // ── Update Functions ──
  function updateDetail() {
    const charId = state.hoveredChar;
    const def = CHARACTER_DEFS[charId];
    const theme = CHARACTER_THEMES[charId];
    const stats = def.stats;

    // Update portrait canvas
    const src = getPortrait(charId, 300, 520);
    const dCtx = detailPortraitCanvas.getContext("2d");
    dCtx.clearRect(0, 0, 300, 520);
    dCtx.drawImage(src, 0, 0, 300, 520);

    // Update portrait border color
    detailPortrait.style.setProperty("--char-color", theme.primary);

    // Update info
    detailInfo.innerHTML = `
      <div class="cs-detail-name" style="color: ${theme.accent}">${def.name}</div>
      <div class="cs-detail-title">${def.title}</div>
      <div class="cs-detail-flavor">${def.flavor}</div>
      <div class="cs-detail-stats">
        <div class="cs-stat"><span class="cs-stat-label">HP</span><span class="cs-stat-val">${stats.hp}</span></div>
        <div class="cs-stat"><span class="cs-stat-label">EN</span><span class="cs-stat-val">${stats.energy}</span></div>
        <div class="cs-stat"><span class="cs-stat-label">SPD</span><span class="cs-stat-val">${stats.speed}</span></div>
        <div class="cs-stat"><span class="cs-stat-label">TRN</span><span class="cs-stat-val">${stats.turnRate.toFixed(2)}</span></div>
        <div class="cs-stat"><span class="cs-stat-label">VIS</span><span class="cs-stat-val">${stats.vision}</span></div>
        <div class="cs-stat"><span class="cs-stat-label">RNG</span><span class="cs-stat-val">${stats.range}</span></div>
        <div class="cs-stat"><span class="cs-stat-label">DMG</span><span class="cs-stat-val">${stats.damage}</span></div>
        <div class="cs-stat"><span class="cs-stat-label">ROF</span><span class="cs-stat-val">${stats.fireRate.toFixed(2)}</span></div>
      </div>
      <div class="cs-detail-skills">
        <div class="cs-skill">
          <div class="cs-skill-header">
            <span class="cs-skill-type">旗舰技能</span>
            <span class="cs-skill-name" style="color: ${theme.accent}">${def.flagshipSkill.name}</span>
          </div>
          <p class="cs-skill-desc">${def.flagshipSkill.description}</p>
        </div>
        <div class="cs-skill">
          <div class="cs-skill-header">
            <span class="cs-skill-type">分舰技能</span>
            <span class="cs-skill-name" style="color: ${theme.accent}">${def.subSkill.name}</span>
          </div>
          <p class="cs-skill-desc">${def.subSkill.description}</p>
        </div>
      </div>
    `;
  }

  function assignCharacter(charId) {
    // Remove from other slot if already assigned
    for (const key of ["main", "sub1", "sub2"]) {
      if (state.loadout[key] === charId) {
        state.loadout[key] = null;
      }
    }
    state.loadout[state.activeSlot] = charId;

    // Auto-advance to next empty slot
    const slots = ["main", "sub1", "sub2"];
    const nextEmpty = slots.find((s) => !state.loadout[s]);
    if (nextEmpty) {
      state.activeSlot = nextEmpty;
    }

    updateSlots();
    updatePanelStates();
    updateLaunchButton();
  }

  function updateSlots() {
    for (const [slotKey, els] of Object.entries(slotElements)) {
      const isActive = slotKey === state.activeSlot;
      els.el.classList.toggle("active", isActive);

      const charId = state.loadout[slotKey];
      if (charId) {
        const def = CHARACTER_DEFS[charId];
        const theme = CHARACTER_THEMES[charId];
        els.charLabel.textContent = def.shortName;
        els.charLabel.style.color = theme.accent;
        els.icon.style.background = `radial-gradient(circle, ${theme.primary}40, ${theme.dark})`;
        els.icon.style.borderColor = theme.primary;

        // Mini portrait in icon
        const mini = getPortrait(charId, 60, 60);
        els.icon.style.backgroundImage = `url(${mini.toDataURL()})`;
        els.icon.style.backgroundSize = "cover";
      } else {
        els.charLabel.textContent = "----";
        els.charLabel.style.color = "";
        els.icon.style.background = "";
        els.icon.style.borderColor = "";
        els.icon.style.backgroundImage = "";
      }
    }
  }

  function updatePanelStates() {
    for (const charId of CHARACTER_ORDER) {
      const panel = panels[charId];
      const slotKey = Object.keys(state.loadout).find((k) => state.loadout[k] === charId);
      panel.classList.toggle("assigned", Boolean(slotKey));
      const indicator = panel.querySelector(".cs-panel-select-indicator");
      if (slotKey) {
        const labels = { main: "主舰", sub1: "副一", sub2: "副二" };
        indicator.textContent = labels[slotKey];
        indicator.style.display = "";
      } else {
        indicator.style.display = "none";
      }
    }
  }

  function updateLaunchButton() {
    const allFilled = state.loadout.main && state.loadout.sub1 && state.loadout.sub2;
    launchBtn.disabled = !allFilled;
    launchBtn.classList.toggle("ready", Boolean(allFilled));
  }

  // ── Background Particles ──
  const particles = [];
  for (let i = 0; i < 80; i++) {
    particles.push({
      x: Math.random() * 1920,
      y: Math.random() * 1080,
      vx: (Math.random() - 0.5) * 0.4,
      vy: -Math.random() * 0.6 - 0.2,
      r: Math.random() * 2 + 0.5,
      alpha: Math.random() * 0.5 + 0.2,
      phase: Math.random() * Math.PI * 2,
    });
  }

  let bgAnimId = null;
  function animateBg(time) {
    const bCtx = bgCanvas.getContext("2d");
    const w = bgCanvas.width;
    const h = bgCanvas.height;

    // Background gradient
    const grad = bCtx.createRadialGradient(w * 0.5, h * 0.4, 0, w * 0.5, h * 0.5, w * 0.8);
    grad.addColorStop(0, "#0a1628");
    grad.addColorStop(0.5, "#060e1a");
    grad.addColorStop(1, "#030810");
    bCtx.fillStyle = grad;
    bCtx.fillRect(0, 0, w, h);

    // Nebula-like color wash
    const t = time * 0.001;
    bCtx.save();
    bCtx.globalAlpha = 0.08;
    const nebula = bCtx.createRadialGradient(
      w * (0.3 + Math.sin(t * 0.2) * 0.1),
      h * (0.3 + Math.cos(t * 0.15) * 0.1),
      0,
      w * 0.5,
      h * 0.5,
      w * 0.6,
    );
    nebula.addColorStop(0, "#FFA500");
    nebula.addColorStop(0.5, "#FF6B0050");
    nebula.addColorStop(1, "transparent");
    bCtx.fillStyle = nebula;
    bCtx.fillRect(0, 0, w, h);
    bCtx.restore();

    // Particles
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.y < -10) {
        p.y = h + 10;
        p.x = Math.random() * w;
      }
      if (p.x < -10) p.x = w + 10;
      if (p.x > w + 10) p.x = -10;

      const flicker = 0.5 + Math.sin(t * 2 + p.phase) * 0.3;
      bCtx.globalAlpha = p.alpha * flicker;
      bCtx.fillStyle = "#b8d8ff";
      bCtx.beginPath();
      bCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      bCtx.fill();
    }
    bCtx.globalAlpha = 1;

    bgAnimId = requestAnimationFrame(animateBg);
  }

  // ── Show / Hide ──
  function show() {
    document.body.appendChild(screen);
    // Set defaults from stored loadout
    const stored = readStoredLoadoutForSelect();
    if (stored) {
      state.loadout.main = stored.main;
      state.loadout.sub1 = stored.sub1;
      state.loadout.sub2 = stored.sub2;
      state.activeSlot = "main";
      updateSlots();
      updatePanelStates();
      updateLaunchButton();
    }
    updateDetail();
    requestAnimationFrame(() => {
      screen.classList.add("visible");
    });
    bgAnimId = requestAnimationFrame(animateBg);
  }

  function hide(callback) {
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
    }, 600);
  }

  function readStoredLoadoutForSelect() {
    try {
      const raw = window.localStorage.getItem("haruhi-player-loadout-v2");
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed.main && parsed.sub1 && parsed.sub2) {
        // Validate all are valid character IDs
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

  // Fade mask from left
  const fadeW = drawW * 0.4;
  const maskGrad = ctx.createLinearGradient(x, 0, x + fadeW, 0);
  maskGrad.addColorStop(0, "rgba(0,0,0,0)");
  maskGrad.addColorStop(1, "rgba(0,0,0,1)");

  // We can't use true masking easily, so just draw with reduced opacity
  ctx.drawImage(portrait, x, y, drawW, drawH);
  ctx.restore();

  // Fade edges with background-colored gradients
  ctx.save();
  const leftFade = ctx.createLinearGradient(x - 5, 0, x + drawW * 0.3, 0);
  leftFade.addColorStop(0, "#040d18");
  leftFade.addColorStop(1, "rgba(4,13,24,0)");
  ctx.fillStyle = leftFade;
  ctx.fillRect(x - 5, y, drawW * 0.35, drawH);

  const bottomFade = ctx.createLinearGradient(0, canvasHeight - 30, 0, canvasHeight);
  bottomFade.addColorStop(0, "rgba(4,13,24,0)");
  bottomFade.addColorStop(1, "#040d18");
  ctx.fillStyle = bottomFade;
  ctx.fillRect(x, canvasHeight - 30, drawW, 30);
  ctx.restore();
}
