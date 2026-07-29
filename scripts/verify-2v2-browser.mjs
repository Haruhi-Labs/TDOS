import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const WS_PORT = 27000 + Math.floor(Math.random() * 1000);
const VITE_PORT = 28000 + Math.floor(Math.random() * 1000);
const SERVER_BASE = `http://127.0.0.1:${WS_PORT}`;
const APP_BASE = `http://127.0.0.1:${VITE_PORT}`;
const APP_URL = `${APP_BASE}/online`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function eventually(fn, timeoutMs = 8000, intervalMs = 50) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await fn();
      if (value) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await wait(intervalMs);
  }
  if (lastError) {
    throw lastError;
  }
  throw new Error("Timed out waiting for condition");
}

function startProcess(command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += String(chunk);
  });
  child.output = () => output;
  return child;
}

async function waitForHttp(url) {
  await eventually(async () => {
    const response = await fetch(url, { method: "GET" }).catch(() => null);
    return Boolean(response && response.ok);
  }, 12000);
}

async function sampleDisabledState(page, selector, samples = 80, intervalMs = 20) {
  return page.evaluate(
    async ({ selector: targetSelector, samples: totalSamples, intervalMs: delayMs }) => {
      const element = document.querySelector(targetSelector);
      const states = [];
      for (let i = 0; i < totalSamples; i += 1) {
        states.push(Boolean(element?.disabled));
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      return states;
    },
    { selector, samples, intervalMs },
  );
}

async function register(serverBase, username) {
  const response = await fetch(`${serverBase}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: `browser-test-password-${username}` }),
  });
  assert(response.status === 201, `${username} registration must succeed`);
  const rawCookie = response.headers.get("set-cookie")?.split(";", 1)[0] || "";
  const separator = rawCookie.indexOf("=");
  assert(separator > 0, `${username} registration must issue a session cookie`);
  return { name: rawCookie.slice(0, separator), value: rawCookie.slice(separator + 1) };
}

async function installBattleControlTracking(page) {
  await page.addInitScript(() => {
    window.__battleDisabledWrites = [];
    const patchDisabled = (proto) => {
      const descriptor = Object.getOwnPropertyDescriptor(proto, "disabled");
      if (!descriptor || typeof descriptor.get !== "function" || typeof descriptor.set !== "function") return;
      Object.defineProperty(proto, "disabled", {
        configurable: true,
        get() {
          return descriptor.get.call(this);
        },
        set(value) {
          if (this && typeof this.closest === "function" && this.closest("#battleControls")) {
            window.__battleDisabledWrites.push({
              id: this.id || this.getAttribute("data-ship") || this.tagName,
              value: Boolean(value),
              at: performance.now(),
            });
          }
          descriptor.set.call(this, value);
        },
      });
    };
    patchDisabled(HTMLButtonElement.prototype);
    patchDisabled(HTMLInputElement.prototype);
    patchDisabled(HTMLSelectElement.prototype);
  });
}

async function openOnlinePage(browser, viewport, session) {
  const page = await browser.newPage({ viewport });
  await page.context().addCookies([{ ...session, url: APP_BASE }]);
  await installBattleControlTracking(page);
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#disconnectBtn");
  await page.waitForFunction(() => document.querySelector("#disconnectBtn")?.disabled === false, null, { timeout: 8000 });
  return page;
}

async function assertNoVisiblePanelOverlap(page, label) {
  const overlap = await page.evaluate(() => {
    const panel = document.querySelector(".battle-panel");
    if (!panel) {
      return null;
    }
    const panelRect = panel.getBoundingClientRect();
    if (panelRect.width <= 1 || panelRect.height <= 1) {
      return null;
    }
    const nodes = Array.from(
      panel.querySelectorAll("button, input, select, .fleet-row, .team-comm-panel, .team-comm-feed"),
    ).filter((node) => {
      if (node.hidden) {
        return false;
      }
      const style = window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
      const rect = node.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1;
    });
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        if (a.contains(b) || b.contains(a)) {
          continue;
        }
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        const x = Math.max(0, Math.min(ar.right, br.right) - Math.max(ar.left, br.left));
        const y = Math.max(0, Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top));
        if (x * y > 1) {
          return {
            a: a.id || a.className || a.tagName,
            b: b.id || b.className || b.tagName,
            area: x * y,
          };
        }
      }
    }
    return null;
  });
  assert(!overlap, `${label} visible battle panel controls should not overlap: ${JSON.stringify(overlap)}`);
}

function rectsOverlap(a, b) {
  const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return x * y > 0.5;
}

async function assertResultLayout(page, label) {
  const report = await page.evaluate(() => {
    const card = document.querySelector("#resultCard");
    const versus = document.querySelector("#resultVersus");
    if (!card || !versus) {
      return { error: "missing result card" };
    }
    // 入场动画的 transform 会干扰 getBoundingClientRect，测量前强制静态布局。
    card.classList.remove("result-in");
    card.style.animation = "none";
    card.style.transform = "none";
    versus.querySelectorAll(".rl-card").forEach((node) => {
      node.style.animation = "none";
      node.style.transform = "none";
    });
    void card.offsetWidth;

    const relativeBox = (node) => {
      const nodeRect = node.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      return {
        left: nodeRect.left - cardRect.left + card.scrollLeft,
        right: nodeRect.right - cardRect.left + card.scrollLeft,
        top: nodeRect.top - cardRect.top + card.scrollTop,
        bottom: nodeRect.bottom - cardRect.top + card.scrollTop,
        width: nodeRect.width,
        height: nodeRect.height,
      };
    };

    const contentWidth = card.clientWidth;
    const cards = Array.from(versus.querySelectorAll(".rl-card")).map((node, index) => {
      const box = relativeBox(node);
      const parentSide = node.closest(".result-side");
      const parentBox = parentSide ? relativeBox(parentSide) : null;
      return { index, ...box, parentBox };
    });
    const sides = Array.from(versus.querySelectorAll(".result-alliance-players .result-side")).map((node, index) => ({
      index,
      ...relativeBox(node),
    }));
    const docEl = document.documentElement;
    const body = document.body;
    const farthestBottom = cards.reduce((max, item) => Math.max(max, item.bottom), 0);
    return {
      contentWidth,
      scrollHeight: card.scrollHeight,
      clientHeight: card.clientHeight,
      farthestBottom,
      cards,
      sides,
      playerCount: sides.length,
      cardCount: cards.length,
      hasHorizontalScroll:
        docEl.scrollWidth > docEl.clientWidth + 1 ||
        body.scrollWidth > body.clientWidth + 1 ||
        card.scrollWidth > card.clientWidth + 1,
      is2v2: card.classList.contains("result-card-2v2") && versus.classList.contains("result-versus-2v2"),
    };
  });

  assert(!report.error, `${label}: ${report.error}`);
  assert(report.is2v2, `${label}: result card should use 2v2 layout classes`);
  assert(report.playerCount === 4, `${label}: expected 4 player panels, got ${report.playerCount}`);
  assert(report.cardCount === 12, `${label}: expected 12 role cards, got ${report.cardCount}`);
  assert(!report.hasHorizontalScroll, `${label}: page/card must not scroll horizontally`);
  // 允许纵向滚动，但可滚动高度必须覆盖最底部角色卡。
  assert(
    report.scrollHeight + 1 >= report.farthestBottom,
    `${label}: result card scrollHeight ${report.scrollHeight} must cover content bottom ${report.farthestBottom.toFixed(1)}`,
  );

  for (let i = 0; i < report.cards.length; i += 1) {
    const roleCard = report.cards[i];
    assert(roleCard.width > 24 && roleCard.height > 24, `${label}: role card ${i} too small`);
    assert(
      roleCard.left >= -1 && roleCard.right <= report.contentWidth + 1,
      `${label}: role card ${i} must stay within result card width ` +
        `(l=${roleCard.left.toFixed(1)} r=${roleCard.right.toFixed(1)} cw=${report.contentWidth})`,
    );
    if (roleCard.parentBox) {
      assert(
        roleCard.left >= roleCard.parentBox.left - 1 &&
          roleCard.right <= roleCard.parentBox.right + 1 &&
          roleCard.top >= roleCard.parentBox.top - 1 &&
          roleCard.bottom <= roleCard.parentBox.bottom + 1,
        `${label}: role card ${i} must stay inside its player panel`,
      );
    }
    for (let j = i + 1; j < report.cards.length; j += 1) {
      assert(!rectsOverlap(roleCard, report.cards[j]), `${label}: role cards ${i}/${j} overlap`);
    }
  }

  for (let i = 0; i < report.sides.length; i += 1) {
    for (let j = i + 1; j < report.sides.length; j += 1) {
      assert(!rectsOverlap(report.sides[i], report.sides[j]), `${label}: player panels ${i}/${j} overlap`);
    }
  }
}

async function mountSyntheticTwoVsTwoResult(page) {
  await page.evaluate(() => {
    const battleView = document.querySelector("#battleView");
    const lobbyView = document.querySelector("#lobbyView");
    const overlay = document.querySelector("#overlay");
    const card = document.querySelector("#resultCard");
    const versus = document.querySelector("#resultVersus");
    const title = document.querySelector("#overlayTitle");
    const eyebrow = document.querySelector("#resultEyebrow");
    const sub = document.querySelector("#resultSub");
    if (!overlay || !card || !versus) {
      throw new Error("result overlay DOM missing");
    }
    if (battleView) battleView.hidden = false;
    if (lobbyView) lobbyView.hidden = true;
    overlay.classList.remove("hidden");
    card.classList.remove("result-win", "result-lose", "result-draw");
    card.classList.add("result-win", "result-card-2v2", "result-in");
    if (eyebrow) eyebrow.textContent = "VICTORY";
    if (title) title.textContent = "胜利";
    if (sub) sub.textContent = "敌方舰队已被击溃";
    versus.classList.add("result-versus-2v2");

    const mkCards = (prefix) =>
      ["main", "sub1", "sub2"]
        .map(
          (slot, i) =>
            `<div class="rl-card${slot === "main" ? " rl-main" : ""}" style="--i:${i}">` +
            `<span class="rl-portrait"><img alt="" width="64" height="64" src="data:image/svg+xml,${encodeURIComponent(
              `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><rect width='64' height='64' fill='%23${prefix === "A" ? "345" : "633"}'/><text x='8' y='36' fill='white' font-size='12'>${prefix}${i + 1}</text></svg>`,
            )}"></span>` +
            `<span class="rl-role">${slot}</span>` +
            `<span class="rl-name">角色${i + 1}</span>` +
            `</div>`,
        )
        .join("");

    const mkPlayer = (seat, name, sideClass) =>
      `<div class="result-side ${sideClass}">` +
      `<div class="result-side-label">${seat} · ${name}</div>` +
      `<div class="result-side-id">ID：${seat}-id-long-name</div>` +
      `<div class="rl-cards">${mkCards(seat[0])}</div>` +
      `</div>`;

    const mkAlliance = (allianceId, sideClass, rows) =>
      `<div class="result-side result-alliance ${sideClass}">` +
      `<div class="result-side-label">${allianceId}阵营</div>` +
      `<div class="result-alliance-players">${rows}</div>` +
      `</div>`;

    versus.innerHTML =
      mkAlliance(
        "A",
        "result-side-player",
        mkPlayer("A1", "超长昵称测试玩家甲", "result-side-player") +
          mkPlayer("A2", "超长昵称测试玩家乙", "result-side-player"),
      ) +
      `<div class="result-vs"><span>VS</span></div>` +
      mkAlliance(
        "B",
        "result-side-enemy",
        mkPlayer("B1", "超长昵称测试玩家丙", "result-side-player") +
          mkPlayer("B2", "超长昵称测试玩家丁", "result-side-player"),
      );
  });
}

async function runResultLayoutSweep(browser, session) {
  const viewports = [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 1280, height: 720 },
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
    { width: 440, height: 900 },
    { width: 390, height: 844 },
  ];
  for (const viewport of viewports) {
      const page = await openOnlinePage(browser, viewport, session);
    try {
      await mountSyntheticTwoVsTwoResult(page);
      await assertResultLayout(page, `${viewport.width}x${viewport.height}`);
    } finally {
      await page.close().catch(() => {});
    }
  }
}

async function runFourClientTwoVsTwoSmoke(browser, sessions) {
  const viewports = [
    { width: 1280, height: 720 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 440, height: 900 },
  ];
  const pages = [];
  try {
    for (let i = 0; i < viewports.length; i += 1) {
      pages.push(await openOnlinePage(browser, viewports[i], sessions[i]));
    }

    assert(await pages[0].locator("#createAiRoomBtn").count() === 0, "standard lobby must not render the AI training room entry");
    await pages[0].click("#create2v2Btn");
    for (let i = 1; i < pages.length; i += 1) {
      await pages[i].waitForSelector(".room-item-actions button", { timeout: 8000 });
      await pages[i].locator(".room-item-actions button").first().click();
    }

    const expectedSeats = ["A1", "A2", "B1", "B2"];
    for (let i = 0; i < pages.length; i += 1) {
      await pages[i].waitForFunction(
        (seat) => document.querySelector("#seatValue")?.textContent?.includes(seat),
        expectedSeats[i],
        { timeout: 8000 },
      );
      await pages[i].waitForSelector("#readyRoomBtn:not([hidden])", { timeout: 8000 });
    }

    // Three ready first; fourth opens fleet select and must not enter battle.
    for (let i = 0; i < 3; i += 1) {
      await pages[i].click("#readyRoomBtn");
    }
    await pages[3].waitForSelector("#openFleetSelectBtn:not([disabled])", { timeout: 8000 });
    await pages[3].click("#openFleetSelectBtn");
    await pages[3].waitForSelector(".cs-screen", { timeout: 8000 });
    await pages[3].waitForTimeout(300);
    for (const page of pages) {
      const battleHidden = await page.evaluate(() => document.querySelector("#battleView")?.hidden !== false);
      assert(battleHidden, "battle view must stay hidden while a player is still selecting a fleet");
    }
    const charSelectVisible = await pages[3].evaluate(() => {
      const screen = document.querySelector(".cs-screen");
      if (!screen) return false;
      const style = window.getComputedStyle(screen);
      return style.display !== "none" && style.visibility !== "hidden";
    });
    assert(charSelectVisible, "character select should remain usable for the unready player");
    await pages[3].keyboard.press("Escape").catch(() => {});
    await pages[3].evaluate(() => {
      document.querySelector(".cs-close, .cs-back, .csm-close")?.click();
    }).catch(() => {});
    // Force-close via hide button if present; otherwise remove overlay for continue path.
    await pages[3].evaluate(() => {
      const screen = document.querySelector(".cs-screen");
      if (screen) screen.remove();
    });

    await pages[3].click("#readyRoomBtn");
    for (const page of pages) {
      await page.waitForSelector("#battleView:not([hidden])", { timeout: 10000 });
    }
    for (const page of pages) {
      const stacked = await page.evaluate(() => {
        const battle = document.querySelector("#battleView");
        const select = document.querySelector(".cs-screen");
        if (!battle || battle.hidden) return false;
        if (!select) return false;
        const style = window.getComputedStyle(select);
        return style.display !== "none" && style.visibility !== "hidden";
      });
      assert(!stacked, "character select must not remain visible over battle view");
    }

    const controlPage = pages[0];
    await controlPage.waitForSelector("#subSkillBtn");
    await controlPage.evaluate(() => {
      window.__battleWriteMarker = performance.now();
    });
    const states = await sampleDisabledState(controlPage, "#subSkillBtn");
    const falseWrites = await controlPage.evaluate(() =>
      (window.__battleDisabledWrites || []).filter(
        (item) => item.id === "subSkillBtn" && item.value === false && item.at >= (window.__battleWriteMarker || 0),
      ),
    );
    assert(states.every(Boolean), `subSkillBtn should stay disabled while the main ship is selected; samples=${states.join("")}`);
    assert(falseWrites.length === 0, `snapshot/control gate must not re-enable subSkillBtn; false writes=${JSON.stringify(falseWrites.slice(0, 5))}`);

    for (let i = 0; i < pages.length; i += 1) {
      await assertNoVisiblePanelOverlap(pages[i], `${expectedSeats[i]} ${viewports[i].width}x${viewports[i].height}`);
    }
  } finally {
    for (const page of pages) {
      await page.close().catch(() => {});
    }
  }
}

async function main() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "tdos-2v2-browser-"));
  const wsServer = startProcess(process.execPath, ["server/server.js"], {
    HOST: "127.0.0.1",
    PORT: String(WS_PORT),
    USER_DB_PATH: path.join(tempDir, "accounts.sqlite"),
    USER_AVATAR_DIR: path.join(tempDir, "avatars"),
    SESSION_SECRET: "2v2-browser-test-session-secret-that-is-long-enough",
  });
  const vite = startProcess(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(VITE_PORT)], {
    VITE_BACKEND_ORIGIN: SERVER_BASE,
  });
  let browser = null;

  try {
    await waitForHttp(`http://127.0.0.1:${VITE_PORT}/online`);

    browser = await chromium.launch();
    const sessions = await Promise.all(Array.from({ length: 4 }, (_value, index) => register(SERVER_BASE, `TwoVsTwo${index + 1}`)));
    await runResultLayoutSweep(browser, sessions[0]);
    await runFourClientTwoVsTwoSmoke(browser, sessions);
  } finally {
    if (browser) {
      await browser.close();
    }
    for (const child of [vite, wsServer]) {
      if (child && child.exitCode === null) {
        child.kill();
      }
    }
    await wait(100);
    for (const child of [vite, wsServer]) {
      if (child && child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }
    await rm(tempDir, { recursive: true, force: true });
  }

  console.log("2v2 browser behavior verification passed");
}

main();
