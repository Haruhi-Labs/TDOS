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
assert.equal(EN_MESSAGES[CURRENT_VERSION_LABEL], "Public beta v0.2", "英文首页版本号未同步");
assert.equal(JA_MESSAGES[CURRENT_VERSION_LABEL], "公開テスト版 v0.2", "日文首页版本号未同步");

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
      assert.ok(group.title && group.items.length > 0, `${locale}/${release.id}/${group.id} 内容不完整`);
      const zhGroup = zhRelease.groups.find((item) => item.id === group.id);
      assert.deepEqual(
        group.items.map((item) => item.id),
        zhGroup.items.map((item) => item.id),
        `${locale}/${release.id}/${group.id} 条目与中文不一致`,
      );
      for (const item of group.items) {
        assert.ok(item.title && item.body, `${locale}/${release.id}/${group.id}/${item.id} 文案为空`);
      }
    }
  }
}

assert.ok(Object.isFrozen(CHANGELOG_BY_LOCALE), "更新日志数据必须只读");
assert.ok(Object.isFrozen(CHANGELOG_BY_LOCALE.zh[0].groups[0].items), "更新日志嵌套数据必须只读");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const menuSource = readFileSync(resolve(root, "src/menu.js"), "utf8");
const mainSource = readFileSync(resolve(root, "src/main.js"), "utf8");
assert.doesNotMatch(menuSource, /\{\s*href:\s*"\/changelog"/, "更新日志不应占用独立主菜单项");
assert.match(menuSource, /href="\/changelog"/, "首页版本号没有链接到更新日志");
assert.match(mainSource, /"\/changelog"/, "路由没有注册更新日志页面");

console.log(`更新日志校验通过：${locales.length} 种语言、${referenceIds.length} 个版本，首页入口与当前版本一致。`);
