import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

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
  const guest = await browser.newContext({ viewport: { width: 390, height: 700 } });
  const guestPage = await guest.newPage();
  await guestPage.route("**/api/game/session", (route) =>
    route.fulfill({ status: 401, contentType: "application/json", body: '{"error":"未授权"}' }),
  );
  await guestPage.goto(`${baseUrl}/profile`, { waitUntil: "networkidle" });
  await guestPage.locator("#pvIdentityLogin").waitFor();
  assert.equal(await guestPage.locator("#pvNickname").isEnabled(), true, "游客应能编辑本地呼号");
  assert.equal(
    await guestPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    "游客档案移动端不应横向溢出",
  );
  await guest.close();

  const account = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const accountPage = await account.newPage();
  await accountPage.route("**/api/game/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: "u42",
          nickname: "这是一个完整的三十二字以内统一身份昵称",
          avatar: "/uploads/avatars/u42-test.webp",
        },
      }),
    }),
  );
  await accountPage.route("**/uploads/avatars/**", (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  await accountPage.goto(`${baseUrl}/profile`, { waitUntil: "networkidle" });
  await accountPage.locator("#pvIdentityLogout").waitFor();
  assert.equal(await accountPage.locator("#pvNickname").isDisabled(), true, "登录昵称应由统一身份锁定");
  assert.equal(await accountPage.locator("#pvNickname").inputValue(), "这是一个完整的三十二字以内统一身份昵称");
  assert.equal(await accountPage.locator(".pv-account-copy").getAttribute("title"), null);
  await account.close();

  console.log("统一身份界面校验通过：游客可编辑、登录昵称锁定、移动布局与 32 字昵称均正常。");
} finally {
  await browser.close();
  await server.close();
}
