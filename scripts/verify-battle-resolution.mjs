import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "vite";
import { MatchSimulation } from "../shared/game-core.js";
import { RULESET_VERSION } from "../shared/protocol/ruleset-version.js";
import { canvasBackingSize } from "../src/battle/canvas-resolution.js";
import { sampleEllipse, sampleQuadratic } from "../src/battle/webgl/geometry.js";

assert.equal(canvasBackingSize(1600, 2), 3200, "高分辨率不应再被限制为2880像素");
assert.equal(canvasBackingSize(1600, 3.5), 5600, "屏幕密度不能再被限制为2.5倍");
assert.equal(canvasBackingSize(4200, 2), 8400, "大屏应使用实际设备像素");
assert.equal(canvasBackingSize(4200, 2, 8192), 8192, "缓冲不能超过后端硬件上限");
const circle = sampleEllipse({ cx: 0, cy: 0, rx: 400, ry: 400, transform: (x, y) => ({ x: x * 10, y: y * 10 }) }).points;
for (let i = 1; i < circle.length; i++) {
  const midpoint = { x: (circle[i].x + circle[i - 1].x) / 2, y: (circle[i].y + circle[i - 1].y) / 2 };
  assert.ok(4000 - Math.hypot(midpoint.x, midpoint.y) <= .35, "高倍圆弧的弦线误差应低于一个物理像素");
}
const curve = [{ x: 0, y: 0 }, ...sampleQuadratic({ x: 0, y: 0 }, { x: 2000, y: 3000 }, { x: 4000, y: 0 })];
for (let i = 1; i < curve.length; i++) {
  const t = (i - .5) / (curve.length - 1);
  assert.ok(Math.abs(6000 * t * (1 - t) - (curve[i - 1].y + curve[i].y) / 2) <= .35, "高倍曲线应按物理像素取样");
}

// 回环前端；联机仅消费本脚本的公开快照，身份与统计接口使用夹具。
const vite = await createServer({ root: resolve(import.meta.dirname, ".."), logLevel: "silent", server: { host: "127.0.0.1", port: 0 }, plugins: [{
  name: "battle-resolution-fixture",
  transform(code, id) {
    if (id.endsWith("/src/solo.js") || id.endsWith("/src/online.js")) return `${code}\nglobalThis.resolutionFixture = { get renderer() { return battleRenderer; }, get camera() { return camera; }, stop() { running = false; cancelAnimationFrame(rafId); camera.destroy(); } };`;
    return null;
  },
}] });
await vite.listen();
const base = vite.resolvedUrls.local[0];
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const fixturePage = await browser.newPage();
  await fixturePage.goto(`${base}webgl-fixture.html`, { waitUntil: "networkidle" });
  const screenshotDir = process.env.RESOLUTION_SCREENSHOT_DIR;
  const pixels = await fixturePage.evaluate(async (capture) => {
    const { createNativeBattleRenderer } = await import("/src/battle/native-webgl-renderer.js");
    const { NativeTextCache } = await import("/src/battle/webgl/text-cache.js");
    function draw(mode, lowResolution = false) {
      const canvas = document.createElement("canvas");
      canvas.width = 1024; canvas.height = 256;
      const renderer = createNativeBattleRenderer(canvas, { forceMode: mode });
      if (lowResolution) {
        const get = renderer.ctx.textCache.get.bind(renderer.ctx.textCache);
        renderer.ctx.textCache.get = (options) => get({ ...options, scale: 1 });
      }
      function frame() {
        renderer.beginFrame();
        const ctx = renderer.ctx;
        ctx.fillStyle = "rgb(5,13,23)"; ctx.fillRect(0, 0, 1024, 256);
        ctx.setTransform(8, 0, 0, 8, 0, 0);
        ctx.font = "16px serif"; ctx.fillStyle = "white";
        ctx.fillText("舰船 A/B 123", 4, 22);
        renderer.present();
      }
      frame(); frame();
      const warmUploads = renderer.getStats().textureUploads;
      const textScale = mode === "canvas2d" ? 8 : [...renderer.ctx.textCache.entries.values()][0].textureScale;
      let data;
      if (mode === "canvas2d") data = renderer.ctx.getImageData(0, 0, 1024, 256).data;
      else {
        const gl = canvas.getContext(mode === "webgl2" ? "webgl2" : "webgl");
        const raw = new Uint8Array(1024 * 256 * 4);
        gl.readPixels(0, 0, 1024, 256, gl.RGBA, gl.UNSIGNED_BYTE, raw);
        data = new Uint8Array(raw.length);
        for (let y = 0; y < 256; y++) data.set(raw.subarray(y * 4096, (y + 1) * 4096), (255 - y) * 4096);
      }
      renderer.destroy();
      return { data, warmUploads, textScale };
    }
    const reference = draw("canvas2d");
    const result = {};
    function capturePixels(data) {
      const canvas = document.createElement("canvas"); canvas.width = 1024; canvas.height = 256;
      canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(data), 1024, 256), 0, 0);
      return canvas.toDataURL();
    }
    if (capture) result.images = { reference: capturePixels(reference.data) };
    const difference = (data) => data.reduce((sum, value, index) => sum + (index % 4 === 3 ? 0 : Math.abs(value - reference.data[index])), 0) / (1024 * 256 * 3);
    for (const mode of ["webgl2", "webgl1"]) {
      const native = draw(mode);
      if (capture) result.images[mode] = capturePixels(native.data);
      result[mode] = { error: difference(native.data), oldError: difference(draw(mode, true).data), textScale: native.textScale, warmUploads: native.warmUploads };
    }
    const deleted = [];
    const cache = new NativeTextCache({ maxTextureSize: 4096, createTexture: (source) => ({ width: source.width, height: source.height }), deleteTexture: (texture) => deleted.push(texture) }, { maxBytes: 1000 });
    cache.beginFrame();
    const options = { text: "字形", font: "16px serif", kind: "fill", style: "white", lineWidth: 1, shadowBlur: 0, scale: 8.2 };
    const first = cache.get(options);
    const same = cache.get({ ...options, scale: 8.8 });
    cache.get({ ...options, text: "其它" });
    result.cache = { stableBucket: first === same, protectedDuringFrame: deleted.length === 0 };
    cache.endFrame();
    result.cache.boundedAfterFrame = cache.bytes <= 1000;
    // 零度量必须保留；旧浏览器缺少度量时按字号回退，不能读取前置字重。
    const nativeMeasure = cache.measureContext.measureText.bind(cache.measureContext);
    cache.measureContext.measureText = () => ({ width: 12, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0 });
    const zeroMetrics = cache.measure(" ", "700 76px sans-serif");
    cache.measureContext.measureText = () => ({ width: 12 });
    const missingMetrics = cache.measure("1", "700 76px sans-serif");
    cache.measureContext.measureText = nativeMeasure;
    result.metrics = { zeroMetrics, missingMetrics };
    cache.clear();
    // 用实际像素复现无下伸部数字上移，逐帧切换三拍倒计时并核对视觉中心。
    const { drawBattleCountdown } = await import("/src/battle/render.js");
    const { DEFAULT_WORLD_SIZE } = await import("/shared/game-core.js");
    result.countdown = {};
    for (const mode of ["webgl2", "webgl1", "canvas2d"]) {
      const size = 720;
      const canvas = document.createElement("canvas"); canvas.width = size; canvas.height = size;
      const renderer = createNativeBattleRenderer(canvas, { forceMode: mode });
      const bounds = [];
      for (const remaining of [3000, 2000, 1000]) {
        renderer.beginFrame();
        renderer.ctx.setTransform(size / DEFAULT_WORLD_SIZE, 0, 0, size / DEFAULT_WORLD_SIZE, 0, 0);
        drawBattleCountdown(renderer.ctx, remaining);
        renderer.present();
        let data;
        if (mode === "canvas2d") data = renderer.ctx.getImageData(0, 0, size, size).data;
        else {
          const gl = canvas.getContext(mode === "webgl2" ? "webgl2" : "webgl");
          const raw = new Uint8Array(size * size * 4);
          gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, raw);
          data = new Uint8Array(raw.length);
          for (let y = 0; y < size; y++) data.set(raw.subarray(y * size * 4, (y + 1) * size * 4), (size - y - 1) * size * 4);
        }
        let top = size, bottom = -1;
        for (let y = size / 2 - 100; y < size / 2 + 70; y++) for (let x = size / 2 - 50; x < size / 2 + 50; x++) {
          const i = (y * size + x) * 4;
          if (data[i] > 230 && data[i + 1] > 235 && data[i + 2] > 240) {
            top = Math.min(top, y); bottom = Math.max(bottom, y);
          }
        }
        bounds.push({ count: remaining / 1000, top, bottom, center: (top + bottom) / 2 });
        if (capture) {
          const image = document.createElement("canvas"); image.width = size; image.height = size;
          image.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(data), size, size), 0, 0);
          result.images[`countdown-${mode}-${remaining / 1000}`] = image.toDataURL();
        }
      }
      result.countdown[mode] = bounds;
      renderer.destroy();
    }
    return result;
  }, Boolean(screenshotDir));
  if (pixels.images) {
    await mkdir(screenshotDir, { recursive: true });
    for (const [name, url] of Object.entries(pixels.images)) await writeFile(join(screenshotDir, `text-${name}.png`), Buffer.from(url.split(",")[1], "base64"));
    delete pixels.images;
  }
  for (const mode of ["webgl2", "webgl1"]) {
    assert.equal(pixels[mode].textScale, 8, `${mode}文字需要匹配最终像素倍率`);
    assert.equal(pixels[mode].warmUploads, 0, `${mode}静态文字预热后不能逐帧上传`);
    assert.ok(pixels[mode].error < 2 && pixels[mode].error < pixels[mode].oldError * .6, `${mode}高倍文字必须明显接近直接原生绘制：${JSON.stringify(pixels[mode])}`);
  }
  assert.deepEqual(pixels.cache, { stableBucket: true, protectedDuringFrame: true, boundedAfterFrame: true });
  assert.deepEqual(pixels.metrics.zeroMetrics, { width: 12, ascent: 0, descent: 0 }, "正常零字形边距不能被兜底替换");
  assert.equal(pixels.metrics.missingMetrics.ascent, 76 * .82, "缺少度量时按76px字号回退");
  assert.equal(pixels.metrics.missingMetrics.descent, 76 * .22, "兜底边距不能读取前置700字重");
  console.log("字形与倒计时像素：", JSON.stringify(pixels));
  for (const [mode, bounds] of Object.entries(pixels.countdown)) {
    assert.ok(bounds.every((digit) => digit.bottom >= digit.top), `${mode} 的三个倒计时数字均须实际绘出`);
    const centers = bounds.map((digit) => digit.center);
    assert.ok(Math.max(...centers) - Math.min(...centers) <= 1, `${mode} 的 3、2、1 视觉中心不能跳动：${JSON.stringify(bounds)}`);
  }
  await fixturePage.close();

  const loadout = { main: "haruhi", sub1: "kyon", sub2: "koizumi" };
  const snapshot = new MatchSimulation({ mode: "pvp", teamLoadouts: { A: loadout, B: loadout } }).serializeState();
  const reports = [];
  for (const [mode, width, height, dpr] of [["solo", 1920, 1080, 3], ["online", 3840, 2160, 2], ["spectator", 3840, 2160, 3], ["solo", 5120, 2880, 2]]) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, locale: "zh-CN" });
    await context.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: '{"authenticated":false,"items":[]}' }));
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    if (mode === "solo") await page.goto(`${base}play/tutorial`, { waitUntil: "networkidle" });
    else {
      const wsUrl = "ws://127.0.0.1:65530/resolution-fixture";
      let socket;
      await page.routeWebSocket(wsUrl, (ws) => { socket = ws; ws.onMessage(() => {}); });
      await page.goto(`${base}online?ws=${encodeURIComponent(wsUrl)}`, { waitUntil: "networkidle" });
      socket.send(JSON.stringify({ type: "connected", playerId: "resolution-test", rulesetVersion: RULESET_VERSION, tickRate: 30, snapshotRate: 15, protocolVersion: 2 }));
      socket.send(JSON.stringify({ type: "room_state", room: { roomId: "resolution-room", status: "running", mode: "pvp", players: [{ seat: "A", name: "清晰度验收", loadout }, { seat: "B", name: "对手", loadout }] }, self: mode === "spectator" ? { spectating: true } : { seat: "A", loadout } }));
      socket.send(JSON.stringify({ type: "snapshot", roomId: "resolution-room", snapshotSeq: 1, tick: 1, state: snapshot }));
    }
    await page.locator("#battleView").waitFor({ state: "visible" });
    const measure = () => page.evaluate(() => {
      const canvas = document.querySelector("#gameCanvas");
      const style = getComputedStyle(canvas);
      const cssSize = canvas.getBoundingClientRect().width - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth);
      const gl = canvas.getContext("webgl2");
      return { cssSize, backing: canvas.width, buffer: gl.drawingBufferWidth, expected: Math.min(Math.max(1440, Math.ceil(cssSize * devicePixelRatio)), window.resolutionFixture.renderer.maxCanvasDimension) };
    });
    await page.waitForFunction(() => {
      const canvas = document.querySelector("#gameCanvas");
      const style = getComputedStyle(canvas);
      const size = canvas.getBoundingClientRect().width - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth);
      return canvas.width === Math.min(Math.max(1440, Math.ceil(size * devicePixelRatio)), window.resolutionFixture.renderer.maxCanvasDimension);
    });
    const report = await measure();
    assert.equal(report.backing, report.expected, `${mode}应匹配完整设备像素`);
    assert.equal(report.buffer, report.backing, `${mode}GPU绘制缓冲不能低于画布尺寸`);
    reports.push({ mode, width, height, dpr, ...report });
    // 不触发窗口 resize，仅改变布局，尺寸观察器仍需更新实际像素。
    await page.evaluate(() => { const canvas = document.querySelector("#gameCanvas"); canvas.style.width = "480px"; canvas.style.maxWidth = "none"; canvas.style.maxHeight = "none"; });
    await page.waitForFunction(() => document.querySelector("#gameCanvas").width === 1440);
    // 模拟跨屏密度变化，逻辑视野与选舰坐标保持原样。
    const view = await page.evaluate(() => window.resolutionFixture.camera.currentViewState());
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 4, mobile: false });
    await page.waitForFunction(() => document.querySelector("#gameCanvas").width === 1904);
    assert.deepEqual(await page.evaluate(() => window.resolutionFixture.camera.currentViewState()), view, "分辨率变化不得改变镜头取景");
    await page.evaluate(() => window.resolutionFixture.stop());
    const stopped = (await measure()).backing;
    await page.evaluate(() => { document.querySelector("#gameCanvas").style.width = "800px"; });
    await page.waitForTimeout(80);
    assert.equal((await measure()).backing, stopped, "卸载后尺寸观察器必须停止分配缓冲");
    await context.close();
  }
  console.log("真实页面分辨率：", JSON.stringify(reports));
  assert.deepEqual(errors, [], "高清渲染不能产生浏览器异常");
  console.log("战场清晰度检查通过：单人/联机/观战、高DPR与4K/5K、布局和换屏同步、字形精度与缓存预算、曲线误差及卸载。");
} finally { await browser.close(); await vite.close(); }
