import { chromium } from "playwright";

const url = process.argv[2] || "http://localhost:4173/";
const out = process.argv[3] || "/tmp/shot_home.png";

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 2,
});
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(1800); // 等 hero canvas + 星空绘制
await page.screenshot({ path: out });
console.log("saved", out);
await browser.close();
