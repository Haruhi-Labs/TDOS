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
  const page = await browser.newPage({ viewport: { width: 720, height: 720 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseUrl}/webgl-fixture.html?renderer=webgl2`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => globalThis.__HARUHI_FIXTURE_READY__ === true);

  const report = await page.evaluate(async () => {
    const [
      { createNativeBattleRenderer },
      { createNativeBattleVisualFixture },
      { drawBattleWorld },
      { radarAngleAt },
      { shamisenHuntMarkersForFrame },
    ] = await Promise.all([
      import("/src/battle/native-webgl-renderer.js"),
      import("/src/battle/native-webgl-visual-fixture.js"),
      import("/src/battle/render.js"),
      import("/src/battle/render/radar.js"),
      import("/src/battle/render/shamisen-hunt.js"),
    ]);
    const width = 720;
    const height = 720;

    function readPixels(canvas, mode) {
      if (mode === "canvas2d") {
        return canvas.getContext("2d").getImageData(0, 0, width, height).data;
      }
      const gl = canvas.getContext(mode === "webgl2" ? "webgl2" : "webgl");
      const source = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, source);
      const flipped = new Uint8Array(source.length);
      const stride = width * 4;
      for (let y = 0; y < height; y += 1) {
        flipped.set(source.subarray(y * stride, (y + 1) * stride), (height - y - 1) * stride);
      }
      return flipped;
    }

    function renderOnce(mode) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const renderer = createNativeBattleRenderer(canvas, { forceMode: mode });
      renderer.beginFrame();
      renderer.ctx.setTransform(width / 1440, 0, 0, height / 1440, 0, 0);
      const fixture = createNativeBattleVisualFixture();
      // 基础像素一致性不包含 WebGL2 专属着色器；专属效果在下方单独验证调用路径。
      fixture.state.shamisenHuntKillEffects = [];
      fixture.state.haruhiHeroPowerEffects = [];
      fixture.state.teams.B.ships.sub1.heroPowerShock = { active: false };
      drawBattleWorld(renderer.ctx, fixture.frame);
      renderer.present();
      const pixels = readPixels(canvas, renderer.mode);
      const result = {
        mode: renderer.mode,
        marker: canvas.dataset.battleRenderer,
        pixels,
        stats: renderer.getStats(),
      };
      renderer.destroy();
      return result;
    }

    function comparePixels(left, right) {
      let total = 0;
      let changed = 0;
      let maximum = 0;
      const channels = (left.length / 4) * 3;
      for (let index = 0; index < left.length; index += 4) {
        let pixelDifference = 0;
        for (let channel = 0; channel < 3; channel += 1) {
          const difference = Math.abs(left[index + channel] - right[index + channel]);
          total += difference;
          pixelDifference += difference;
          maximum = Math.max(maximum, difference);
        }
        if (pixelDifference > 18) changed += 1;
      }
      return {
        meanAbsoluteError: total / channels,
        changedPixelRatio: changed / (left.length / 4),
        maximum,
      };
    }

    function addProjectilePressure(fixture, count = 600) {
      for (let index = 0; index < count; index += 1) {
        fixture.state.projectiles.push({
          id: 3000 + index,
          alive: true,
          teamSeat: index % 2 ? "A" : "B",
          x: (index * 47) % 1400 + 20,
          y: (index * 83) % 1400 + 20,
          targetX: 720,
          targetY: 720,
          speed: 280,
          radius: 2.5,
        });
      }
    }

    function benchmark(mode) {
      const canvas = document.createElement("canvas");
      // 生产相机的 backing store 下限就是 1440；使用真实最低物理分辨率，
      // 避免以页面内缩略图的 720 像素填充开销得出无效结论。
      canvas.width = 1440;
      canvas.height = 1440;
      const renderer = createNativeBattleRenderer(canvas, { forceMode: mode });
      const fixture = createNativeBattleVisualFixture();
      addProjectilePressure(fixture);
      const renderFrame = () => {
        renderer.beginFrame();
        renderer.ctx.setTransform(1, 0, 0, 1, 0, 0);
        drawBattleWorld(renderer.ctx, fixture.frame);
        renderer.present();
      };
      for (let index = 0; index < 8; index += 1) renderFrame();
      const startedAt = performance.now();
      for (let index = 0; index < 45; index += 1) renderFrame();
      const elapsedMs = performance.now() - startedAt;
      const result = {
        mode: renderer.mode,
        elapsedMs,
        millisecondsPerFrame: elapsedMs / 45,
        stats: renderer.getStats(),
      };
      renderer.destroy();
      return result;
    }

    function renderStatsWithoutRadar(mode) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const renderer = createNativeBattleRenderer(canvas, { forceMode: mode });
      const fixture = createNativeBattleVisualFixture();
      fixture.frame.radar = null;
      renderer.beginFrame();
      renderer.ctx.setTransform(width / 1440, 0, 0, height / 1440, 0, 0);
      drawBattleWorld(renderer.ctx, fixture.frame);
      renderer.present();
      const stats = renderer.getStats();
      renderer.destroy();
      return stats;
    }

    function renderHuntEffectStats(mode) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const renderer = createNativeBattleRenderer(canvas, { forceMode: mode });
      const fixture = createNativeBattleVisualFixture();
      renderer.beginFrame();
      renderer.ctx.setTransform(width / 1440, 0, 0, height / 1440, 0, 0);
      drawBattleWorld(renderer.ctx, fixture.frame);
      renderer.present();
      const stats = renderer.getStats();
      renderer.destroy();
      return stats;
    }

    function renderHeroPowerStats(mode) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const renderer = createNativeBattleRenderer(canvas, { forceMode: mode });
      const fixture = createNativeBattleVisualFixture();
      fixture.state.shamisenHuntKillEffects = [];
      renderer.beginFrame();
      renderer.ctx.setTransform(width / 1440, 0, 0, height / 1440, 0, 0);
      drawBattleWorld(renderer.ctx, fixture.frame);
      renderer.present();
      const stats = renderer.getStats();
      renderer.destroy();
      return stats;
    }

    const canvas2d = renderOnce("canvas2d");
    const webgl2 = renderOnce("webgl2");
    const webgl1 = renderOnce("webgl1");
    const comparisons = {
      webglParity: comparePixels(webgl2.pixels, webgl1.pixels),
      canvasParity: comparePixels(canvas2d.pixels, webgl2.pixels),
    };
    const benchmarkResults = {
      canvas2d: benchmark("canvas2d"),
      webgl2: benchmark("webgl2"),
      webgl1: benchmark("webgl1"),
    };
    const radarSample = { angle: 1, sampledAt: 10, angularVelocity: -2 };
    const radarSubframeAngles = [9.9, 9.91, 9.92].map((elapsed) => radarAngleAt(radarSample, elapsed));
    const hiddenHuntFixture = createNativeBattleVisualFixture();
    hiddenHuntFixture.frame.visibleEnemyIds = new Set();
    const hiddenHuntMarkers = shamisenHuntMarkersForFrame(hiddenHuntFixture.frame);
    const enemyPerspectiveFrame = {
      ...hiddenHuntFixture.frame,
      ownTeam: hiddenHuntFixture.state.teams.B,
      enemyTeam: hiddenHuntFixture.state.teams.A,
      spectating: false,
    };
    return {
      renderers: {
        canvas2d: { mode: canvas2d.mode, marker: canvas2d.marker },
        webgl2: { mode: webgl2.mode, marker: webgl2.marker, stats: webgl2.stats },
        webgl1: { mode: webgl1.mode, marker: webgl1.marker, stats: webgl1.stats },
      },
      comparisons,
      benchmark: benchmarkResults,
      radar: {
        subframeAngles: radarSubframeAngles,
        webgl2TrianglesWithoutRadar: renderStatsWithoutRadar("webgl2").triangles,
      },
      hunt: {
        hiddenMarkerCount: hiddenHuntMarkers.length,
        hiddenMarkerTargetId: hiddenHuntMarkers[0]?.target?.id || null,
        enemyPerspectiveMarkerCount: shamisenHuntMarkersForFrame(enemyPerspectiveFrame).length,
        enemyPerspectiveMarkerTargetId: shamisenHuntMarkersForFrame(enemyPerspectiveFrame)[0]?.target?.id || null,
        webgl2Stats: renderHuntEffectStats("webgl2"),
        webgl1Stats: renderHuntEffectStats("webgl1"),
      },
      heroPower: {
        webgl2Stats: renderHeroPowerStats("webgl2"),
        webgl1Stats: renderHeroPowerStats("webgl1"),
      },
    };
  });

  assert.deepEqual(errors, [], `原生战场页面出现运行错误：${errors.join("；")}`);
  assert.equal(report.renderers.webgl2.mode, "webgl2", "支持 WebGL2 时没有启用 WebGL2 原生后端");
  assert.equal(report.renderers.webgl2.marker, "webgl2-native", "WebGL2 后端没有标记为原生渲染");
  assert.equal(report.renderers.webgl1.mode, "webgl1", "WebGL1 回退没有启用原生后端");
  assert.equal(report.renderers.webgl1.marker, "webgl1-native", "WebGL1 回退没有标记为原生渲染");
  assert.equal(report.renderers.canvas2d.mode, "canvas2d", "无 WebGL 应急路径没有退回 Canvas 2D");
  assert.ok(
    report.comparisons.webglParity.meanAbsoluteError < 0.35,
    `WebGL2/WebGL1 输出不一致：MAE ${report.comparisons.webglParity.meanAbsoluteError.toFixed(3)}`,
  );
  assert.ok(report.hunt.webgl2Stats.huntShaderEffects > 0, "三味线猎杀击杀特效没有走 WebGL2 着色器");
  assert.equal(report.hunt.webgl1Stats.huntShaderEffects, 0, "WebGL1 回退错误调用了 WebGL2 猎杀着色器");
  assert.equal(report.hunt.hiddenMarkerCount, 1, "三味线一方在无真实视野时看不到猎杀标记");
  assert.ok(Number.isFinite(report.hunt.hiddenMarkerTargetId), "迷雾猎杀标记没有跟随权威目标");
  assert.equal(report.hunt.enemyPerspectiveMarkerCount, 1, "被猎杀方看不到落在己方舰船上的猫爪印记");
  assert.equal(
    report.hunt.enemyPerspectiveMarkerTargetId,
    report.hunt.hiddenMarkerTargetId,
    "猎杀方与被猎杀方看到的标记没有指向同一艘权威目标舰",
  );
  assert.ok(
    report.comparisons.canvasParity.meanAbsoluteError < 6,
    `原生 WebGL 与既有 Canvas 视觉偏差过大：MAE ${report.comparisons.canvasParity.meanAbsoluteError.toFixed(3)}`,
  );
  assert.ok(
    report.comparisons.canvasParity.changedPixelRatio < 0.16,
    `原生 WebGL 与既有 Canvas 的明显差异区域过大：${(report.comparisons.canvasParity.changedPixelRatio * 100).toFixed(2)}%`,
  );
  assert.ok(report.renderers.webgl2.stats.triangles < 6500, "WebGL2 基准场景生成了过多三角形");
  assert.ok(report.renderers.webgl2.stats.drawCalls < 90, "WebGL2 基准场景产生了过多绘制调用");
  assert.ok(
    report.heroPower.webgl2Stats.triangles - report.renderers.webgl2.stats.triangles < 900,
    `勇者之力战场特效生成了过多额外三角形：${report.heroPower.webgl2Stats.triangles - report.renderers.webgl2.stats.triangles}`,
  );
  assert.ok(report.heroPower.webgl2Stats.drawCalls < 110, `勇者之力战场特效产生了过多绘制调用：${report.heroPower.webgl2Stats.drawCalls}`);
  assert.ok(report.heroPower.webgl1Stats.drawCalls < 110, `勇者之力 WebGL1 回退产生了过多绘制调用：${report.heroPower.webgl1Stats.drawCalls}`);
  assert.ok(
    report.radar.subframeAngles[0] > report.radar.subframeAngles[1]
      && report.radar.subframeAngles[1] > report.radar.subframeAngles[2],
    "雷达扫线仍被离散权威帧锁住，没有按显示子帧连续旋转",
  );
  assert.ok(
    report.renderers.webgl2.stats.triangles - report.radar.webgl2TrianglesWithoutRadar < 800,
    "雷达扫线退化为逐虚线 CPU 三角化",
  );
  assert.ok(report.benchmark.webgl2.stats.drawCalls < 90, "WebGL2 弹幕批处理退化为逐弹绘制调用");
  assert.equal(report.benchmark.webgl2.stats.textureUploads, 0, "WebGL2 预热后仍在逐帧上传纹理");
  assert.equal(report.benchmark.webgl1.stats.textureUploads, 0, "WebGL1 预热后仍在逐帧上传纹理");
  assert.ok(
    report.benchmark.webgl2.elapsedMs <= report.benchmark.canvas2d.elapsedMs * 1.05,
    `WebGL2 炮弹压力场景比 Canvas 更慢：${report.benchmark.webgl2.elapsedMs.toFixed(1)} / ${report.benchmark.canvas2d.elapsedMs.toFixed(1)}ms`,
  );
  assert.ok(
    report.benchmark.webgl1.elapsedMs <= report.benchmark.canvas2d.elapsedMs * 1.05,
    `WebGL1 炮弹压力场景比 Canvas 更慢：${report.benchmark.webgl1.elapsedMs.toFixed(1)} / ${report.benchmark.canvas2d.elapsedMs.toFixed(1)}ms`,
  );

  // 真实画布触发上下文丢失/恢复：恢复后必须能重建着色器、字形和程序化圆点纹理。
  const restored = await page.evaluate(async () => {
    const canvas = document.querySelector("#fixtureCanvas");
    const gl = canvas.getContext("webgl2");
    const extension = gl.getExtension("WEBGL_lose_context");
    if (!extension) return { supported: false };
    extension.loseContext();
    await new Promise((resolveWait) => setTimeout(resolveWait, 60));
    extension.restoreContext();
    await new Promise((resolveWait) => setTimeout(resolveWait, 120));
    window.__HARUHI_RENDER_FIXTURE__();
    const pixel = new Uint8Array(4);
    gl.readPixels(360, 360, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return { supported: true, alpha: pixel[3], error: gl.getError() };
  });
  if (restored.supported) {
    assert.equal(restored.error, 0, "WebGL2 上下文恢复后产生 GPU 错误");
    assert.equal(restored.alpha, 255, "WebGL2 上下文恢复后没有重新绘制战场");
  }

  const mobile = await browser.newContext({
    viewport: { width: 360, height: 640 },
    isMobile: true,
    hasTouch: true,
  });
  const mobilePage = await mobile.newPage();
  const mobileErrors = [];
  mobilePage.on("pageerror", (error) => mobileErrors.push(error.message));
  await mobilePage.goto(`${baseUrl}/play/tutorial`, { waitUntil: "networkidle" });
  await mobilePage.locator('#gameCanvas[data-battle-renderer="webgl2-native"]').waitFor();
  await mobilePage.waitForTimeout(400);
  assert.deepEqual(mobileErrors, [], `移动端原生战场出现运行错误：${mobileErrors.join("；")}`);
  await mobile.close();

  const webgl1Context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await webgl1Context.addInitScript(() => {
    globalThis.__HARUHI_BATTLE_RENDERER__ = "webgl1";
  });
  const webgl1Page = await webgl1Context.newPage();
  const webgl1Errors = [];
  webgl1Page.on("pageerror", (error) => webgl1Errors.push(error.message));
  await webgl1Page.goto(`${baseUrl}/play/tutorial`, { waitUntil: "networkidle" });
  await webgl1Page.locator('#gameCanvas[data-battle-renderer="webgl1-native"]').waitFor();
  await webgl1Page.waitForTimeout(300);
  assert.deepEqual(webgl1Errors, [], `WebGL1 实战回退出现运行错误：${webgl1Errors.join("；")}`);
  await webgl1Context.close();

  // WebGL2 上下文能够创建、但着色器初始化失败时，必须换用一张干净画布降到 WebGL1。
  const initFailureContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await initFailureContext.addInitScript(() => {
    const original = WebGL2RenderingContext.prototype.getShaderParameter;
    WebGL2RenderingContext.prototype.getShaderParameter = function getShaderParameter(shader, parameter) {
      if (parameter === this.COMPILE_STATUS) return false;
      return original.call(this, shader, parameter);
    };
  });
  const initFailurePage = await initFailureContext.newPage();
  const initFailureErrors = [];
  initFailurePage.on("pageerror", (error) => initFailureErrors.push(error.message));
  await initFailurePage.goto(`${baseUrl}/play/tutorial`, { waitUntil: "networkidle" });
  await initFailurePage.locator('#gameCanvas[data-battle-renderer="webgl1-native"]').waitFor();
  assert.deepEqual(initFailureErrors, [], `WebGL2 初始化失败时没有安全降级：${initFailureErrors.join("；")}`);
  assert.equal(
    await initFailurePage.evaluate(() => sessionStorage.getItem("haruhi-battle-renderer-fallback-v1")),
    "webgl1",
    "WebGL2 初始化失败后没有在当前标签页记住 WebGL1 回退",
  );
  await initFailureContext.close();

  // 运行时 GPU 绘制抛错不能逃逸到页面；应自动重载并在当前标签页降到 WebGL1。
  const renderFailureContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await renderFailureContext.addInitScript(() => {
    WebGL2RenderingContext.prototype.drawArrays = function drawArrays(...args) {
      throw new Error("注入的 WebGL2 绘制故障");
    };
  });
  const renderFailurePage = await renderFailureContext.newPage();
  const renderFailureErrors = [];
  renderFailurePage.on("pageerror", (error) => renderFailureErrors.push(error.message));
  await renderFailurePage.goto(`${baseUrl}/play/tutorial`, { waitUntil: "domcontentloaded" });
  await renderFailurePage.locator('#gameCanvas[data-battle-renderer="webgl1-native"]').waitFor({ timeout: 10_000 });
  assert.deepEqual(renderFailureErrors, [], `WebGL2 运行时绘制故障没有安全降级：${renderFailureErrors.join("；")}`);
  await renderFailureContext.close();

  // 永久丢失的上下文必须在恢复期限后降级，不能让战场一直停在黑屏状态。
  const permanentLossContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await permanentLossContext.addInitScript(() => {
    globalThis.__HARUHI_CONTEXT_LOSS_TIMEOUT_MS__ = 80;
  });
  const permanentLossPage = await permanentLossContext.newPage();
  const permanentLossErrors = [];
  permanentLossPage.on("pageerror", (error) => permanentLossErrors.push(error.message));
  await permanentLossPage.goto(`${baseUrl}/play/tutorial`, { waitUntil: "networkidle" });
  await permanentLossPage.locator('#gameCanvas[data-battle-renderer="webgl2-native"]').waitFor();
  const canLoseContext = await permanentLossPage.evaluate(() => {
    const canvas = document.querySelector("#gameCanvas");
    const extension = canvas.getContext("webgl2")?.getExtension("WEBGL_lose_context");
    if (!extension) return false;
    extension.loseContext();
    return true;
  });
  if (canLoseContext) {
    await permanentLossPage.locator('#gameCanvas[data-battle-renderer="webgl1-native"]').waitFor({ timeout: 10_000 });
    assert.deepEqual(permanentLossErrors, [], `WebGL2 上下文永久丢失后没有安全降级：${permanentLossErrors.join("；")}`);
  }
  await permanentLossContext.close();

  // 两级 WebGL 都不可用时仍要有可绘制的 Canvas2D 战场，而不是只有空白画布。
  const noWebGlContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await noWebGlContext.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(type, ...args) {
      if (type === "webgl" || type === "webgl2") return null;
      return original.call(this, type, ...args);
    };
  });
  const noWebGlPage = await noWebGlContext.newPage();
  const noWebGlErrors = [];
  noWebGlPage.on("pageerror", (error) => noWebGlErrors.push(error.message));
  await noWebGlPage.goto(`${baseUrl}/play/tutorial`, { waitUntil: "networkidle" });
  await noWebGlPage.locator('#gameCanvas[data-battle-renderer="canvas2d"]').waitFor();
  await noWebGlPage.waitForTimeout(200);
  const fallbackPixel = await noWebGlPage.evaluate(() => {
    const canvas = document.querySelector("#gameCanvas");
    return Array.from(canvas.getContext("2d").getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data);
  });
  assert.equal(fallbackPixel[3], 255, "Canvas2D 回退画布没有有效像素");
  assert.ok(fallbackPixel[0] + fallbackPixel[1] + fallbackPixel[2] > 0, "Canvas2D 回退没有实际绘制战场");
  assert.deepEqual(noWebGlErrors, [], `完全不支持 WebGL 时 Canvas2D 回退异常：${noWebGlErrors.join("；")}`);
  await noWebGlContext.close();

  const onlineContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const onlinePage = await onlineContext.newPage();
  const onlineErrors = [];
  onlinePage.on("pageerror", (error) => onlineErrors.push(error.message));
  await onlinePage.goto(`${baseUrl}/online`, { waitUntil: "networkidle" });
  await onlinePage.locator('#gameCanvas[data-battle-renderer="webgl2-native"]').waitFor({ state: "attached" });
  await onlinePage.waitForTimeout(300);
  assert.deepEqual(onlineErrors, [], `多人战场原生后端出现运行错误：${onlineErrors.join("；")}`);
  await onlineContext.close();

  console.log(JSON.stringify(report, null, 2));
  console.log("原生战场渲染检查通过：WebGL2、WebGL1 回退、视觉一致性与压力性能均正常。");
} finally {
  await browser.close();
  await server.close();
}
