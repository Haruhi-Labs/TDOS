import { spawn } from "node:child_process";
import { chromium } from "playwright";

const WS_PORT = 27000 + Math.floor(Math.random() * 1000);
const VITE_PORT = 28000 + Math.floor(Math.random() * 1000);
const WS_URL = `ws://127.0.0.1:${WS_PORT}/`;
const APP_URL = `http://127.0.0.1:${VITE_PORT}/online?ws=${encodeURIComponent(WS_URL)}`;

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

async function openOnlinePage(browser, viewport) {
  const page = await browser.newPage({ viewport });
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

async function runFourClientTwoVsTwoSmoke(browser) {
  const viewports = [
    { width: 1280, height: 720 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 440, height: 900 },
  ];
  const pages = [];
  try {
    for (const viewport of viewports) {
      pages.push(await openOnlinePage(browser, viewport));
    }

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
      await pages[i].click("#readyRoomBtn");
    }

    for (const page of pages) {
      await page.waitForSelector("#battleView:not([hidden])", { timeout: 10000 });
    }

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
  const wsServer = startProcess(process.execPath, ["server/server.js"], {
    HOST: "127.0.0.1",
    PORT: String(WS_PORT),
  });
  const vite = startProcess(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(VITE_PORT)]);
  let browser = null;

  try {
    await waitForHttp(`http://127.0.0.1:${VITE_PORT}/online`);

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.addInitScript(() => {
      window.__battleDisabledWrites = [];
      const patchDisabled = (proto) => {
        const descriptor = Object.getOwnPropertyDescriptor(proto, "disabled");
        if (!descriptor || typeof descriptor.get !== "function" || typeof descriptor.set !== "function") {
          return;
        }
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

    await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#createAiRoomBtn");
    await page.waitForTimeout(900);
    await page.click("#createAiRoomBtn");
    await page.waitForSelector("#battleView:not([hidden])", { timeout: 8000 });
    await page.waitForSelector("#subSkillBtn");
    await page.evaluate(() => {
      window.__battleWriteMarker = performance.now();
    });

    const states = await sampleDisabledState(page, "#subSkillBtn");
    const falseWrites = await page.evaluate(() =>
      (window.__battleDisabledWrites || []).filter(
        (item) => item.id === "subSkillBtn" && item.value === false && item.at >= (window.__battleWriteMarker || 0),
      ),
    );

    assert(states.every(Boolean), `subSkillBtn should stay disabled while the main ship is selected; samples=${states.join("")}`);
    assert(
      falseWrites.length === 0,
      `snapshot/control gate must not re-enable subSkillBtn; false writes=${JSON.stringify(falseWrites.slice(0, 5))}`,
    );

    await page.close();
    await runFourClientTwoVsTwoSmoke(browser);
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
  }

  console.log("2v2 browser behavior verification passed");
}

main();
