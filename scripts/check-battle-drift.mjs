// 防表现层再漂移检查:单人(solo.js)与在线(online.js)曾各自复制整套战场绘制代码,
// 导致两种模式画面长期不对齐;现已收敛到共享层 src/battle/。本脚本在 CI/构建前把关:
//  1. solo.js / online.js 不允许再定义任何 draw* 顶层函数(战场绘制一律进 src/battle/render.js);
//     例外见 ALLOW —— 仅限确无另一模式对应物的模式专属示意(如新手教程画板)。
//  2. solo.js / online.js 不允许定义与 src/battle/ 模块同名的顶层函数(本地副本会遮蔽共享实现)。
// 违规即退出码 1。用法: node scripts/check-battle-drift.mjs
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 模式专属、且确认没有另一侧对应物的例外(新增前先想清楚它为何不该进共享层)
const ALLOW = new Set(["drawTutorialIllustration"]);

function topLevelFunctions(file) {
  const source = readFileSync(path.join(root, file), "utf8");
  const names = new Set();
  for (const match of source.matchAll(/^(?:export )?(?:async )?function ([A-Za-z0-9_$]+)\s*\(/gm)) {
    names.add(match[1]);
  }
  return names;
}

const solo = topLevelFunctions("src/solo.js");
const online = topLevelFunctions("src/online.js");
const battleShared = new Set(
  readdirSync(path.join(root, "src/battle"))
    .filter((name) => name.endsWith(".js"))
    .flatMap((name) => [...topLevelFunctions(`src/battle/${name}`)]),
);

const problems = [];

for (const [label, names] of [["src/solo.js", solo], ["src/online.js", online]]) {
  for (const name of names) {
    if (ALLOW.has(name)) {
      continue;
    }
    if (name.startsWith("draw")) {
      problems.push(`${label} 定义了绘制函数 ${name}() —— 战场绘制必须放进 src/battle/render.js`);
    } else if (battleShared.has(name)) {
      problems.push(`${label} 定义了与共享层同名的 ${name}() —— 会遮蔽 src/battle/ 的实现,请改为引用共享版`);
    }
  }
}

if (problems.length > 0) {
  console.error("战场表现层漂移检查未通过:\n" + problems.map((p) => `  - ${p}`).join("\n"));
  process.exit(1);
}
console.log("战场表现层漂移检查通过:solo/online 未发现本地绘制副本。");
