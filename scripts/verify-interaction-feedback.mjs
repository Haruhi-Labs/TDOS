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

async function menuVisualState(locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    const labelStyle = getComputedStyle(element.querySelector(".ts-item-label"));
    const subStyle = getComputedStyle(element.querySelector(".ts-item-sub"));
    const cueStyle = getComputedStyle(element.querySelector(".ts-item-cue"));
    const backgroundColor = /,\s*0\)$/.test(style.backgroundColor)
      ? "transparent"
      : style.backgroundColor;
    return {
      padding: style.padding,
      gap: style.gap,
      borderWidth: style.borderWidth,
      borderColor: style.borderColor,
      borderRadius: style.borderRadius,
      backgroundColor,
      backgroundImage: style.backgroundImage,
      boxShadow: style.boxShadow,
      color: style.color,
      transform: style.transform,
      labelColor: labelStyle.color,
      labelFontSize: labelStyle.fontSize,
      labelTextShadow: labelStyle.textShadow,
      subDisplay: subStyle.display,
      cueOpacity: cueStyle.opacity,
      cueTransform: cueStyle.transform,
    };
  });
}

async function waitForMenuVisualSettle(locator) {
  await locator.evaluate(async (element) => {
    await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
    const animations = element.getAnimations({ subtree: true });
    await Promise.all(animations.map((animation) => animation.finished.catch(() => {})));
  });
}

async function menuPressVisualState(locator) {
  await locator.evaluate((element) => element.classList.add("is-pressing"));
  await waitForMenuVisualSettle(locator);
  const state = await menuVisualState(locator);
  await locator.evaluate((element) => element.classList.remove("is-pressing"));
  await waitForMenuVisualSettle(locator);
  return state;
}

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
  const homeItem = page.locator(".ts-item").first();
  const homeBaseStyle = await menuVisualState(homeItem);
  const homePressStyle = await menuPressVisualState(homeItem);
  let homeHoverStyle = null;
  if (!hasTouch) {
    await homeItem.hover();
    await waitForMenuVisualSettle(homeItem);
    homeHoverStyle = await menuVisualState(homeItem);
    await page.mouse.move(viewport.width - 1, viewport.height - 1);
  }
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
  assert.deepEqual(
    await menuVisualState(campaignItem),
    homeBaseStyle,
    `${name}战役按钮基础样式应与首页菜单一致`,
  );
  assert.deepEqual(
    await menuPressVisualState(campaignItem),
    homePressStyle,
    `${name}战役按钮按压样式应与首页菜单一致`,
  );
  if (!hasTouch) {
    await campaignItem.hover();
    await waitForMenuVisualSettle(campaignItem);
    assert.deepEqual(
      await menuVisualState(campaignItem),
      homeHoverStyle,
      `${name}战役按钮悬停样式应与首页菜单一致`,
    );
    await page.mouse.move(viewport.width - 1, viewport.height - 1);
  }
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

  await normalDifficultyItem.click();
  const pageArrow = page.locator(isMobile ? ".csm-next" : ".cs-nav-next");
  await pageArrow.waitFor({ state: "visible" });
  const arrowBoxBefore = await pageArrow.boundingBox();
  assert.ok(arrowBoxBefore, `${name}翻页按钮应当可见`);
  const arrowCenterBefore = arrowBoxBefore.y + arrowBoxBefore.height / 2;
  await page.mouse.move(
    arrowBoxBefore.x + arrowBoxBefore.width / 2,
    arrowCenterBefore,
  );
  await page.mouse.down();
  const arrowBoxPressed = await pageArrow.boundingBox();
  assert.ok(arrowBoxPressed, `${name}按下翻页按钮时应当保持可见`);
  const arrowCenterPressed = arrowBoxPressed.y + arrowBoxPressed.height / 2;
  assert.equal(
    await pageArrow.evaluate((element) => element.classList.contains("is-pressing")),
    true,
    `${name}翻页按钮按下期间应当显示瞬时反馈`,
  );
  assert.ok(
    Math.abs(arrowCenterPressed - arrowCenterBefore) < 0.75,
    `${name}翻页按钮按下时不得丢失纵向居中位移`,
  );
  await page.mouse.up();

  await context.close();
}

async function elementScale(locator) {
  return locator.evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return matrix.a;
  });
}

async function verifyDesktopPageFlipFit() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 600 } });
  await context.addInitScript(() => localStorage.setItem("haruhi-locale-v1", "en"));
  const page = await context.newPage();
  await page.goto(`${baseUrl}/play`, { waitUntil: "networkidle" });
  await page.locator('.solo-flow-item[data-action="standard"]').click();
  await page.locator('.solo-flow-item[data-action="difficulty:normal"]').click();

  const baseRightFit = page.locator(".cs-book > .cs-page-right > .cs-page-fit");
  await baseRightFit.waitFor({ state: "visible" });
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
    await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
  });
  const firstPageScale = await elementScale(baseRightFit);
  assert.ok(firstPageScale < 0.99, "高内容桌面场景应触发右页自适应缩放，确保覆盖翻页边界条件");

  await page.locator(".cs-nav-next").click();
  const nextFlipper = page.locator(".cs-page-flipper.next");
  await nextFlipper.waitFor({ state: "visible" });
  const outgoingScale = await elementScale(nextFlipper.locator(".cs-flip-front .cs-page-fit"));
  assert.ok(
    Math.abs(outgoingScale - firstPageScale) < 0.001,
    `向后翻页开始时，翻起页与底页必须保持相同缩放比例（${outgoingScale} / ${firstPageScale}）`,
  );
  await nextFlipper.waitFor({ state: "detached", timeout: 2500 });

  await page.locator(".cs-nav-prev").click();
  const previousFlipper = page.locator(".cs-page-flipper.prev");
  await previousFlipper.waitFor({ state: "visible" });
  const incomingScale = await elementScale(previousFlipper.locator(".cs-flip-back .cs-page-fit"));
  assert.ok(
    Math.abs(incomingScale - firstPageScale) < 0.001,
    `向前翻页结束时，落下页与目标底页必须保持相同缩放比例（${incomingScale} / ${firstPageScale}）`,
  );

  await context.close();
}

async function verifyMobileTutorialDock(viewport, name, layout = "standardPortrait") {
  const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/play/tutorial`, { waitUntil: "networkidle" });
  const card = page.locator(".tut-card.ready");
  await card.waitFor({ state: "visible" });
  await page.waitForTimeout(400);

  async function geometry() {
    return page.evaluate(() => {
      const cardElement = document.querySelector(".tut-card");
      const cardRect = cardElement.getBoundingClientRect();
      const canvasRect = document.querySelector("#gameCanvas").getBoundingClientRect();
      const hudRect = document.querySelector("#mobileBattleHud").getBoundingClientRect();
      const buttonRects = [...document.querySelectorAll(".mobile-action-grid > button")]
        .map((element) => element.getBoundingClientRect());
      const rowTops = [...new Set(buttonRects.map((rect) => Math.round(rect.top)))].sort((a, b) => a - b);
      const secondLastTop = rowTops.at(-2);
      const secondLastBottom = Math.max(
        ...buttonRects.filter((rect) => Math.abs(rect.top - secondLastTop) <= 2).map((rect) => rect.bottom),
      );
      const overlapsCanvas = !(
        cardRect.right <= canvasRect.left
        || cardRect.left >= canvasRect.right
        || cardRect.bottom <= canvasRect.top
        || cardRect.top >= canvasRect.bottom
      );
      return {
        cardTop: cardRect.top,
        cardBottom: cardRect.bottom,
        canvasWidth: canvasRect.width,
        canvasBottom: canvasRect.bottom,
        hudTop: hudRect.top,
        hudBottom: hudRect.bottom,
        gameWrapDisplay: getComputedStyle(document.querySelector(".game-wrap")).display,
        actionButtonMinHeight: parseFloat(getComputedStyle(document.querySelector(".mobile-action-grid > button")).minHeight),
        secondLastBottom,
        overlapsCanvas,
        scrollHeight: cardElement.scrollHeight,
        clientHeight: cardElement.clientHeight,
      };
    });
  }

  const initial = await geometry();
  assert.ok(initial.cardTop >= initial.secondLastBottom - 0.75, `${name}教程说明越过倒数第二排按钮上界`);
  assert.ok(initial.cardBottom <= viewport.height - 7, `${name}教程说明越出底部安全区`);
  assert.equal(initial.overlapsCanvas, false, `${name}教程说明仍遮挡战场`);

  if (layout === "extremePortrait") {
    assert.equal(initial.gameWrapDisplay, "flex", `${name}被错误套用了横屏双栏布局`);
    assert.ok(initial.canvasWidth >= viewport.width * 0.45, `${name}战场被挤压得过小`);
    assert.ok(initial.canvasBottom <= initial.hudTop, `${name}战场与操作台发生重叠`);
    assert.ok(initial.hudBottom <= viewport.height + 0.75, `${name}操作台超出可用视口`);
    assert.equal(initial.actionButtonMinHeight, 36, `${name}没有启用极小屏紧凑触控尺寸`);
  } else if (layout === "landscape") {
    assert.equal(initial.gameWrapDisplay, "grid", `${name}没有保持横屏双栏布局`);
    assert.equal(initial.actionButtonMinHeight, 40, `${name}受到极小竖屏样式影响`);
  } else {
    assert.equal(initial.gameWrapDisplay, "flex", `${name}没有保持常规竖屏布局`);
    assert.equal(initial.actionButtonMinHeight, 40, `${name}受到极小竖屏样式影响`);
  }

  await card.locator(".tut-body").evaluate((element) => {
    element.textContent = "用于验证移动端长篇教程说明始终收纳在底部说明坞内。".repeat(12);
  });
  const longCopy = await geometry();
  assert.ok(longCopy.cardTop >= longCopy.secondLastBottom - 0.75, `${name}长篇教程说明越过倒数第二排按钮上界`);
  assert.ok(longCopy.cardBottom <= viewport.height - 7, `${name}长篇教程说明越出底部安全区`);
  assert.ok(longCopy.scrollHeight > longCopy.clientHeight, `${name}长篇教程说明没有在限定区域内滚动`);
  assert.equal(longCopy.overlapsCanvas, false, `${name}长篇教程说明仍遮挡战场`);

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
  await verifyDesktopPageFlipFit();
  await verifyMobileTutorialDock({ width: 339, height: 514 }, "极小竖屏", "extremePortrait");
  await verifyMobileTutorialDock({ width: 375, height: 667 }, "竖屏短屏");
  await verifyMobileTutorialDock({ width: 844, height: 390 }, "移动端横屏", "landscape");
  console.log("双端按钮状态、桌面翻页与移动教程说明坞检查通过");
} finally {
  await browser.close();
  await server?.close();
}
