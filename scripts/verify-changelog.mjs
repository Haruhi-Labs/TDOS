import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHANGELOG_BY_LOCALE,
} from "../src/changelog/entries.js";
import { CURRENT_RELEASE_ID, CURRENT_VERSION_LABEL } from "../src/changelog/meta.js";
import { EN_MESSAGES } from "../src/i18n/messages-en.js";
import { JA_MESSAGES } from "../src/i18n/messages-ja.js";

const locales = ["zh", "ja", "en"];
const referenceIds = CHANGELOG_BY_LOCALE.zh.map((release) => release.id);

assert.ok(referenceIds.includes(CURRENT_RELEASE_ID), "当前版本必须存在于更新日志中");
assert.equal(CHANGELOG_BY_LOCALE.zh[0].id, CURRENT_RELEASE_ID, "当前版本必须位于更新日志首位");
assert.equal(CHANGELOG_BY_LOCALE.zh[0].title, CURRENT_VERSION_LABEL, "首页版本号与中文日志标题未同步");
assert.equal(EN_MESSAGES[CURRENT_VERSION_LABEL], "Public beta v0.3", "英文首页版本号未同步");
assert.equal(JA_MESSAGES[CURRENT_VERSION_LABEL], "公開テスト版 v0.3", "日文首页版本号未同步");

for (const locale of locales) {
  const releases = CHANGELOG_BY_LOCALE[locale];
  assert.deepEqual(releases.map((release) => release.id), referenceIds, `${locale} 版本列表与中文不一致`);
  for (const release of releases) {
    assert.match(release.date, /^\d{4}-\d{2}-\d{2}$/, `${locale}/${release.id} 日期格式错误`);
    assert.ok(release.version && release.title, `${locale}/${release.id} 缺少版本元数据`);
    assert.ok(release.groups.length > 0, `${locale}/${release.id} 没有更新分组`);
    const zhRelease = CHANGELOG_BY_LOCALE.zh.find((item) => item.id === release.id);
    assert.deepEqual(
      release.groups.map((group) => group.id),
      zhRelease.groups.map((group) => group.id),
      `${locale}/${release.id} 分组与中文不一致`,
    );
    for (const group of release.groups) {
      assert.ok(group.items.length > 0, `${locale}/${release.id}/${group.id} 内容不完整`);
      const zhGroup = zhRelease.groups.find((item) => item.id === group.id);
      assert.deepEqual(
        group.items.map((item) => item.id),
        zhGroup.items.map((item) => item.id),
        `${locale}/${release.id}/${group.id} 条目与中文不一致`,
      );
      for (const item of group.items) {
        assert.ok(item.text || (item.title && item.body), `${locale}/${release.id}/${group.id}/${item.id} 文案为空`);
      }
    }
  }
}

assert.ok(Object.isFrozen(CHANGELOG_BY_LOCALE), "更新日志数据必须只读");
assert.ok(Object.isFrozen(CHANGELOG_BY_LOCALE.zh[0].groups[0].items), "更新日志嵌套数据必须只读");
const v03Items = CHANGELOG_BY_LOCALE.zh[0].groups.flatMap((group) => group.items);
assert.deepEqual(
  v03Items.map((item) => item.id),
  [
    "haruhi-flagship", "koizumi-sub", "koizumi-flagship", "shamisen-flagship", "haruhi-sub",
    "yuki-flagship", "future1096-sub", "asakura-sub", "character-ai", "winrate-statistics", "webgl2",
  ],
  "v0.3 更新项目不完整或顺序异常",
);
assert.deepEqual(
  v03Items.map((item) => item.text),
  [
    "重做角色「凉宫春日」的主舰技能“我在这里”，开启后向所有敌人昭示己方舰队位置，给予己方舰队整体数值提升，并从宇宙人、未来人、异世界人、超能力者中随机找到一位，给予常驻的正面增强。",
    "重做角色「古泉一树」的分舰技能“超能力粒子”，开启后使古泉化作一颗速度和机动大幅增强的光球，无法射击也不会受到伤害，碰撞敌方可造成击退以及5秒钟的沉默，技能结束后回归战场中央。",
    "重做角色「古泉一树」的主舰技能“超能力屏障”，被动在自己的视野边界创造屏障，可拦截屏障外射来的子弹或光线，但会被舰体冲击类技能打破。",
    "新增角色「三味线」的主舰技能“猫爪印记”，开局时随机标记出一位敌人，己方舰队对其造成的子弹伤害翻倍，击破标记目标时将转移标记至敌方另一位随机角色。",
    "重做角色「凉宫春日」的分舰技能“勇者之力”，短暂蓄力后向附近释放冲击，对被冲击到的敌人先后造成眩晕与减速，在整个负面效果持续期间为敌方施加易伤。",
    "将「长门有希」主舰每次释放的战斗僚机改为两艘，并大幅增加其雷达扫描速度。",
    "将「朝比奈实玖瑠」的分舰技能命中多个敌人时造成的伤害适当下调。",
    "将「朝仓凉子」的分舰技能的伤害与范围适当上调。",
    "优化了AI对于一些角色的操控和应对。",
    "接入阵容胜率统计系统。",
    "将首选渲染路径切换至WebGL2以提升性能。",
  ],
  "v0.3 中文正文没有逐字采用用户提供的文案",
);
for (const locale of locales) {
  const localizedItems = CHANGELOG_BY_LOCALE[locale][0].groups.flatMap((group) => group.items);
  assert.deepEqual(
    localizedItems.map((item) => item.text),
    v03Items.map((item) => item.text),
    `${locale}/v0.3 出现未经用户提供的改写或翻译`,
  );
}

const v02Shamisen = CHANGELOG_BY_LOCALE.zh
  .find((release) => release.id === "v0.2")
  ?.groups.flatMap((group) => group.items)
  .find((item) => item.id === "shamisen");
assert.equal(
  v02Shamisen?.text,
  "新增角色「三味线」，分舰技能“猫爪乱舞”，开启后自身子弹变为猫爪，命中同一敌舰数次后引爆抓痕，造成额外伤害。主舰技能仍在设计中。",
  "v0.2 三味线错误包含尚未推出的主舰技能",
);
for (const locale of locales) {
  const localizedShamisen = CHANGELOG_BY_LOCALE[locale]
    .find((release) => release.id === "v0.2")
    ?.groups.flatMap((group) => group.items)
    .find((item) => item.id === "shamisen");
  assert.equal(localizedShamisen?.text, v02Shamisen.text, `${locale}/v0.2 三味线正文出现未经提供的改写`);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const menuSource = readFileSync(resolve(root, "src/menu.js"), "utf8");
const mainSource = readFileSync(resolve(root, "src/main.js"), "utf8");
assert.doesNotMatch(menuSource, /\{\s*href:\s*"\/changelog"/, "更新日志不应占用独立主菜单项");
assert.match(menuSource, /href="\/changelog"/, "首页版本号没有链接到更新日志");
assert.match(mainSource, /"\/changelog"/, "路由没有注册更新日志页面");

console.log(`更新日志校验通过：${locales.length} 种语言、${referenceIds.length} 个版本，首页入口与当前版本一致。`);
