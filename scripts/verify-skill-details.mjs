import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import { CHARACTER_ORDER, MatchSimulation, skillMetaForCharacter } from "../shared/game-core.js";
import { setLocale } from "../src/i18n.js";
import { skillDetailRows, skillOverview } from "../src/character-select/skill-presentation.js";

// 校验简介与参数分层，并用真实规则对象核对展示层未公开常量的关键数值。
for (const locale of ["zh", "en", "ja"]) {
  setLocale(locale, { notify: false });
  for (const character of CHARACTER_ORDER) for (const mode of ["flagship", "sub"]) {
    assert.ok(skillOverview(character, mode), `${locale} ${character} ${mode} 缺少简介`);
    assert.doesNotMatch(skillOverview(character, mode), /\d|%|×/, "简介不可夹带数值");
    const rows = skillDetailRows(character, mode);
    assert.ok(rows.length >= 4 && rows.every((row) => row.label && row.value), "详细参数应有完整的逐项标签和值");
    assert.equal(new Set(rows.map((row) => row.label)).size, rows.length, "同一技能不应重复参数项目");
    if (locale === "en") assert.equal(rows.some((row) => /[\u4e00-\u9fff]/u.test(row.label)), false, "英文参数不应回退为中文标签");
  }
}
setLocale("zh", { notify: false });
const value = (id, mode, label) => skillDetailRows(id, mode).find((row) => row.label === label)?.value;
for (const id of CHARACTER_ORDER) for (const mode of ["flagship", "sub"]) {
  const meta = skillMetaForCharacter(id, mode);
  if (meta.type === "active") {
    assert.equal(value(id, mode, "技能冷却"), `${meta.cooldown}秒`);
    assert.equal(value(id, mode, "能量消耗"), `${meta.cost || 0}能量`);
  }
}
assert.equal(value("koizumi", "flagship", "拦截次数"), "15次");
assert.equal(value("koizumi", "flagship", "修复等待"), "5秒");
assert.equal(value("asakura", "sub", "最低航速"), "3档满能量航速（技能强化后）");
assert.equal(value("asakura", "sub", "接触伤害"), "目标最大舰体的15%");
assert.equal(value("asakura", "sub", "结算间隔"), "1秒");
for (const id of ["kyon", "asakura"]) {
  const team = new MatchSimulation({ teamLoadouts: { A: { main: "yuki", sub1: id, sub2: "haruhi" } } }).teamA;
  team.splitLevel = 2;
  assert.equal(team.castSubSkill("sub1"), true);
  const ship = team.ships.sub1;
  for (const [label, stat] of [["转向倍率", "turnRate"], ["加速倍率", "accel"], ["航速倍率", "speed"], ...(id === "kyon" ? [["伤害倍率", "damage"]] : [])]) {
    const actual = ship.statWithBuffs(stat, 1);
    assert.equal(value(id, "sub", label), `×${Math.round(actual * 1000) / 1000}`, "显示倍率必须与实际技能一致");
  }
}
const scoutTeam = new MatchSimulation({ teamLoadouts: { A: { main: "koizumi", sub1: "yuki", sub2: "haruhi" } } }).teamA;
scoutTeam.splitLevel = 2;
assert.equal(scoutTeam.castSubSkill("sub1"), true);
assert.equal(value("yuki", "sub", "侦察机总数"), `${scoutTeam.scouts.length}架`);
assert.equal(value("yuki", "sub", "侦察机航速"), String(scoutTeam.scouts[0].speed));
assert.equal(value("yuki", "sub", "侦察机视野"), String(scoutTeam.scouts[0].vision));
assert.equal(value("yuki", "sub", "侦察机寿命"), `${scoutTeam.scouts[0].life}秒`);
const formTeam = new MatchSimulation({ teamLoadouts: { A: { main: "future1096", sub1: "yuki", sub2: "haruhi" } } }).teamA;
for (const form of ["A", "B"]) {
  formTeam.switchFuture1096Form();
  for (const [label, stat] of [["航速", "speed"], ["射速", "fireRate"]]) assert.equal(value("future1096", "flagship", `${form}形态${label}`), `×${formTeam.future1096StatMultiplier(stat)}`);
  assert.equal(value("future1096", "flagship", `${form}形态承伤`), `×${formTeam.future1096DamageTakenMultiplier()}`);
}

// 回环前端；身份与统计接口夹具化，选角验收不接触现有服务及持久数据。
const vite = await createServer({ root: resolve(import.meta.dirname, ".."), logLevel: "silent", server: { host: "127.0.0.1", port: 0 } });
await vite.listen();
const base = vite.resolvedUrls.local[0];
const browser = await chromium.launch({ headless: true });
const screenshotDir = process.env.SKILL_DETAILS_SCREENSHOT_DIR;
const errors = [];
try {
  if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
  async function enter(viewport, mobile, locale) {
    const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, locale });
    await context.route("**/api/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"authenticated":false,"items":[]}' }));
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${base}play`, { waitUntil: "networkidle" });
    await page.locator('.solo-flow-item[data-action="standard"]').click();
    await page.locator('.solo-flow-item[data-action="difficulty:normal"]').click();
    await page.locator(mobile ? ".csm.visible" : ".cs-screen.visible").waitFor();
    return { context, page };
  }
  async function verifyGeometry(page, viewport) {
    const geometry = await page.locator(".cs-skill-dialog").evaluate((element) => {
      const r = element.getBoundingClientRect();
      const list = element.querySelector("dl");
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, scrollWidth: element.scrollWidth, width: element.clientWidth, listScroll: list.scrollHeight, listHeight: list.clientHeight };
    });
    assert.ok(geometry.x >= 0 && geometry.y >= 0 && geometry.right <= viewport.width + 1 && geometry.bottom <= viewport.height + 1, "技能浮窗必须留在视口内");
    assert.ok(geometry.scrollWidth <= geometry.width, "参数浮窗不可横向溢出");
    assert.ok(await page.locator(".cs-skill-close").isVisible(), "关闭按钮必须始终可见");
    return geometry;
  }
  for (const mobile of [false, true]) {
    const viewport = mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 };
    const { context, page } = await enter(viewport, mobile, "zh-CN");
    const prefix = mobile ? ".csm .cs-skill-trigger" : ".cs-book > .cs-page-right .cs-skill-trigger";
    for (let i = 0; i < CHARACTER_ORDER.length; i++) {
      if (i > 0) {
        await page.locator(mobile ? ".csm-dot" : ".cs-tab").nth(i).click();
        if (!mobile) await page.locator(".cs-page-flipper").waitFor({ state: "detached" });
      }
      await page.waitForFunction(({ prefix, id }) => document.querySelector(prefix)?.dataset.character === id, { prefix, id: CHARACTER_ORDER[i] });
      assert.equal(await page.locator(prefix).count(), 2);
      for (let skill = 0; skill < 2; skill++) {
        const button = page.locator(prefix).nth(skill);
        const mode = skill ? "sub" : "flagship";
        const overview = await button.locator(mobile ? ".csm-skill-desc" : ".cs-page-skill-desc").textContent();
        assert.doesNotMatch(overview, /\d|%|×/);
        await button.click();
        await page.locator(".cs-skill-dialog[open]").waitFor();
        assert.equal(await page.locator(".cs-skill-detail-row").count(), skillDetailRows(CHARACTER_ORDER[i], mode).length, "浮窗应展示全部结构化参数");
        await verifyGeometry(page, viewport);
        await page.keyboard.press("ArrowRight");
        assert.equal(await button.getAttribute("data-character"), CHARACTER_ORDER[i], "阅读浮窗时不可翻到另一角色");
        if (screenshotDir && i < 2 && skill === 0) await page.screenshot({ path: join(screenshotDir, `${mobile ? "mobile" : "desktop"}-${CHARACTER_ORDER[i]}.png`) });
        await page.keyboard.press("Escape");
        await page.locator(".cs-skill-dialog").waitFor({ state: "detached" });
        await page.waitForFunction((element) => element === document.activeElement, await button.elementHandle());
        const focusAfterClose = await button.evaluate((element) => ({ restored: element === document.activeElement, active: document.activeElement.outerHTML.slice(0, 200) }));
        assert.equal(focusAfterClose.restored, true, `关闭浮窗后焦点应回到原技能入口：${mobile ? "触屏" : "桌面"} ${CHARACTER_ORDER[i]} ${mode} ${focusAfterClose.active}`);
      }
    }
    // 键盘激活技能入口不能被选角的 Enter 快捷键抢去编队。
    const prompt = mobile ? ".csm-cta" : ".cs-enlist-prompt";
    const before = await page.locator(prompt).textContent();
    await page.locator(prefix).first().focus();
    await page.keyboard.press("Enter");
    await page.locator(".cs-skill-dialog[open]").waitFor();
    assert.equal(await page.locator(prompt).textContent(), before);
    for (let tab = 0; tab < 4; tab++) await page.keyboard.press("Tab");
    const focusedElement = await page.evaluate(() => ({ inside: Boolean(document.activeElement.closest(".cs-skill-dialog")), element: document.activeElement.outerHTML.slice(0, 160) }));
    assert.equal(focusedElement.inside, true, `模态窗口需约束键盘焦点：${focusedElement.element}`);
    await page.keyboard.press("Shift+Tab");
    assert.equal(await page.locator(".cs-skill-detail-list").evaluate((element) => element === document.activeElement), true, "反向 Tab 应能到达参数列表，以键盘滚动阅读");
    await page.mouse.click(4, 4);
    await page.locator(".cs-skill-dialog").waitFor({ state: "detached" });
    await page.locator(prefix).first().click();
    // 同一选角实例退出时应清除顶层窗口。
    await page.evaluate(async () => { history.pushState(null, "", "/"); window.dispatchEvent(new PopStateEvent("popstate")); });
    await page.locator(".cs-skill-dialog").waitFor({ state: "detached" });
    await context.close();
  }
  for (const [viewport, mobile, locale, index] of [
    [{ width: 1280, height: 600 }, false, "en-US", 4],
    [{ width: 390, height: 540 }, true, "zh-CN", 0],
    [{ width: 844, height: 390 }, true, "ja-JP", 6],
  ]) {
    const { context, page } = await enter(viewport, mobile, locale);
    await page.locator(mobile ? ".csm-dot" : ".cs-tab").nth(index).click();
    if (!mobile) await page.locator(".cs-page-flipper").waitFor({ state: "detached" });
    await page.locator(mobile ? ".csm .cs-skill-trigger" : ".cs-book > .cs-page-right .cs-skill-trigger").first().click();
    await page.locator(".cs-skill-dialog[open]").waitFor();
    const geometry = await verifyGeometry(page, viewport);
    if (viewport.height === 540) {
      assert.ok(geometry.listScroll > geometry.listHeight, "长参数列表应内部滚动，保持标题与关闭按钮固定");
      await page.locator(".cs-skill-detail-list").focus();
      await page.keyboard.press("End");
      await page.waitForFunction(() => document.querySelector(".cs-skill-detail-list").scrollTop > 0);
      const afterScroll = await verifyGeometry(page, viewport);
      assert.equal(afterScroll.y, geometry.y, "滚动参数时标题位置不可移动");
      await page.locator(".cs-skill-detail-list").evaluate((element) => { element.scrollTop = 0; });
    }
    if (locale === "en-US") assert.doesNotMatch(await page.locator(".cs-skill-detail-list").textContent(), /[\u4e00-\u9fff]/u, "英文详细信息不应夹带中文");
    if (screenshotDir) await page.screenshot({ path: join(screenshotDir, `details-${viewport.width}x${viewport.height}.png`) });
    await page.locator(".cs-skill-close").click();
    await page.locator(".cs-skill-dialog").waitFor({ state: "detached" });
    await context.close();
  }
  assert.deepEqual(errors, [], "技能详情与选角交互不应产生浏览器异常");
  console.log("技能分层介绍检查通过：八角色十六技能、三语言、规则数值核对、桌面/触屏、键盘/遮罩关闭、焦点约束、卸载及矮屏滚动。");
} finally { await browser.close(); await vite.close(); }
