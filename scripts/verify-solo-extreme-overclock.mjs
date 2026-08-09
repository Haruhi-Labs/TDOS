import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sourcePath(...parts) {
  return resolve(process.cwd(), ...parts);
}

function occurrences(source, text) {
  return source.split(text).length - 1;
}

const [soloSource, characterSelectSource, i18nSource, stylesSource] = await Promise.all([
  readFile(sourcePath("src", "solo.js"), "utf8"),
  readFile(sourcePath("src", "character-select.js"), "utf8"),
  readFile(sourcePath("src", "i18n.js"), "utf8"),
  readFile(sourcePath("styles.css"), "utf8"),
]);

assert(
  characterSelectSource.includes("技能冷却 ×1.30") && characterSelectSource.includes("能量回复 ×1.25"),
  "极限难度的角色选择说明必须披露技能冷却与能量回复倍率",
);
assert(
  /const difficulty = getDifficulty\(\);[\s\S]*aiDifficulty: difficulty,[\s\S]*aiOverclockBySeat: difficulty === "master"/.test(soloSource),
  "单人模拟必须仅在 master 难度显式传入超频配置",
);
assert(
  /aiOverclockBySeat:[\s\S]*B:\s*\{\s*cooldownMultiplier:\s*1\.3,\s*energyRegenMultiplier:\s*1\.25/.test(soloSource),
  "单人 master 超频必须只配置 B 席的冷却 ×1.30 与能量回复 ×1.25",
);
assert(
  soloSource.includes("solo-extreme-overclock") && soloSource.includes("panelFooterHTML") && soloSource.includes("mobileExtraHTML"),
  "单人战斗模板必须为桌面和移动端注入极限协议徽章",
);
assert(
  /function syncExtremeOverclockBadges\(\)\s*\{[\s\S]*getDifficulty\(\) === "master"[\s\S]*soloExtremeOverclockDesktop[\s\S]*soloExtremeOverclockMobile/.test(soloSource),
  "发射前必须按最新难度同步桌面和移动端极限协议徽章",
);
assert(
  /function launchWithLoadout\([\s\S]*syncExtremeOverclockBadges\(\);[\s\S]*resetMatch\(true\);/.test(soloSource),
  "角色选择完成后必须在创建对局前刷新极限协议徽章",
);
assert(
  stylesSource.includes(".solo-extreme-overclock") && stylesSource.includes(".mobile-extreme-overclock"),
  "极限协议徽章必须具有桌面和移动端样式钩子",
);

for (const text of ["极限协议", "技能冷却 ×1.30", "能量回复 ×1.25"]) {
  assert(occurrences(i18nSource, `"${text}"`) >= 2, `缺少“${text}”的日语和英语本地化词条`);
}

console.log("Solo extreme overclock verification passed");
