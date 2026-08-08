import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import { getChangelogEntries } from "../src/changelog/entries.js";
import { CURRENT_RELEASE_ID } from "../src/changelog/meta.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({
  root,
  logLevel: "silent",
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
const baseUrl = server.resolvedUrls.local[0].replace(/\/$/, "");
const browser = await chromium.launch({ headless: true });

try {
  for (const locale of ["zh", "ja", "en"]) {
    const releases = getChangelogEntries(locale);
    const expectedGroups = releases.reduce((total, release) => total + release.groups.length, 0);
    const expectedItems = releases.reduce(
      (total, release) => total + release.groups.reduce((sum, group) => sum + group.items.length, 0),
      0,
    );
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript((value) => localStorage.setItem("haruhi-locale-v1", value), locale);
    const page = await context.newPage();
    await page.goto(`${baseUrl}/changelog`, { waitUntil: "networkidle" });
    await page.locator(`.cl-release[data-release-id="${CURRENT_RELEASE_ID}"]`).waitFor();
    assert.equal(await page.locator(".cl-group").count(), expectedGroups, `${locale} 更新分组数量错误`);
    assert.equal(await page.locator(".cl-item").count(), expectedItems, `${locale} 更新条目数量错误`);
    assert.equal(
      await page.evaluate(() => {
        const ids = [...document.querySelectorAll("[id]")].map((element) => element.id);
        return ids.length === new Set(ids).size;
      }),
      true,
      `${locale} 更新日志存在重复 DOM id`,
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      `${locale} 桌面更新日志出现横向溢出`,
    );
    await context.close();
  }

  const mobile = await browser.newContext({
    viewport: { width: 375, height: 667 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await mobile.newPage();
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  assert.equal(await page.locator(".ts-item").count(), 6, "移动首页应显示六个主菜单入口");
  const menuGeometry = await page.evaluate(() => ({
    lastBottom: document.querySelector(".ts-item:last-child")?.getBoundingClientRect().bottom || Infinity,
    footerBottom: document.querySelector(".mmenu-foot")?.getBoundingClientRect().bottom || Infinity,
    viewportHeight: innerHeight,
  }));
  assert.ok(menuGeometry.lastBottom <= menuGeometry.viewportHeight, "短屏手机的最后一个菜单项超出视口");
  assert.ok(menuGeometry.footerBottom <= menuGeometry.viewportHeight, "短屏手机的首页页脚超出视口");

  await page.locator(".ts-ver-link").click();
  await page.locator(`.cl-release[data-release-id="${CURRENT_RELEASE_ID}"]`).waitFor();
  assert.ok(page.url().endsWith("/changelog"), "首页版本号没有进入更新日志");
  const beforeScroll = await page.locator(".mpage-top").boundingBox();
  await page.locator(".mpage-body").evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const afterScroll = await page.locator(".mpage-top").boundingBox();
  assert.ok(beforeScroll && afterScroll, "移动更新日志顶栏不可见");
  assert.ok(Math.abs(beforeScroll.y - afterScroll.y) < 0.5, "移动更新日志滚动后顶栏没有保持固定");
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    "移动更新日志出现横向溢出",
  );
  await mobile.close();

  console.log("更新日志界面校验通过：三语桌面页、短屏主菜单与移动滚动布局均正常。");
} finally {
  await browser.close();
  await server.close();
}
