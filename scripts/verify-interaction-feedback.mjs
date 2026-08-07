import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let server = null;
let baseUrl = process.env.HARUHI_PREVIEW_URL;
if (!baseUrl) {
  server = await createServer({
    root,
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  baseUrl = server.resolvedUrls.local[0].replace(/\/$/, "");
}
const browser = await chromium.launch({ headless: true });

async function verifyPointerFeedback({ name, viewport, isMobile = false, hasTouch = false }) {
  const context = await browser.newContext({ viewport, isMobile, hasTouch });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/profile`, { waitUntil: "networkidle" });
  const button = page.locator(".pv-faction-btn.red");

  if (hasTouch) {
    const box = await button.boundingBox();
    assert.ok(box, `${name}阵营按钮应当可见`);
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.touchscreen.tap(x, y);
  } else {
    const box = await button.boundingBox();
    assert.ok(box, `${name}阵营按钮应当可见`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    assert.equal(
      await button.evaluate((element) => element.classList.contains("is-pressing")),
      true,
      `${name}按下期间应当显示瞬时反馈`,
    );
    await page.mouse.up();
  }
  // 松手后按钮会按基础样式执行最长 160ms 的回弹过渡；等待视觉状态真正稳定，
  // 避免只等一帧时偶发读到接近 1、但尚未结束的缩放矩阵。
  await page.waitForFunction(() => {
    const element = document.querySelector(".pv-faction-btn.red");
    return element
      && !element.classList.contains("is-pressing")
      && document.activeElement !== element
      && getComputedStyle(element).transform === "none";
  }, null, { timeout: 1000 });

  const state = await button.evaluate((element) => ({
    pressing: element.classList.contains("is-pressing"),
    focused: document.activeElement === element,
    selected: element.classList.contains("active"),
    transform: getComputedStyle(element).transform,
  }));
  assert.equal(state.pressing, false, `${name}松手后必须清除瞬时按压态`);
  assert.equal(state.focused, false, `${name}指针点击后不得保留焦点选中态`);
  assert.equal(state.selected, true, `${name}仍须保留真实的阵营选择状态`);
  assert.equal(state.transform, "none", `${name}松手后不得残留按压缩放`);

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForTimeout(80);
  assert.equal(
    await page.locator(".ts-item:focus-visible").count(),
    0,
    `${name}主菜单初始不应自行选中首项`,
  );
  await page.keyboard.press("ArrowDown");
  assert.equal(
    await page.locator(".ts-item:focus-visible").count(),
    1,
    `${name}键盘导航仍应显示明确焦点`,
  );

  await page.goto(`${baseUrl}/play`, { waitUntil: "networkidle" });
  const campaignItem = page.locator('.solo-flow-item[data-action="standard"]');
  await campaignItem.waitFor({ state: "visible" });
  assert.equal(
    await page.locator(".solo-flow-item:focus-visible").count(),
    0,
    `${name}战役菜单初始不应自行选中首项`,
  );
  await page.keyboard.press("ArrowDown");
  assert.equal(
    await campaignItem.evaluate((element) => element.matches(":focus-visible")),
    true,
    `${name}战役菜单仍应支持键盘选择`,
  );
  await campaignItem.click();
  const normalDifficultyItem = page.locator('.solo-flow-item[data-action="difficulty:normal"]');
  await normalDifficultyItem.waitFor({ state: "visible" });
  assert.equal(
    await page.locator(".solo-flow-item.active").count(),
    0,
    `${name}难度菜单不得把上次选择保留为粘滞高亮`,
  );
  assert.equal(
    await normalDifficultyItem.evaluate((element) => element.classList.contains("active")),
    false,
    `${name}普通难度不得默认显示长期选中态`,
  );

  await context.close();
}

try {
  await verifyPointerFeedback({
    name: "桌面端",
    viewport: { width: 1280, height: 800 },
  });
  await verifyPointerFeedback({
    name: "移动端",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  console.log("双端按钮按压与焦点状态检查通过");
} finally {
  await browser.close();
  await server?.close();
}
