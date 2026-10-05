// 列出 AI 决策源码里仍然内联的数值字面量，用于跟踪参数外提进度和发现新增的内联数值。
// 这是清单工具而非门禁：数学常量、容差和语义性钳制留在代码里是合理的。
//
//   node scripts/ai/list-literals.mjs            按文件与方法汇总数量
//   node scripts/ai/list-literals.mjs --lines    逐行列出
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const POLICY_DIR = "shared/game/ai/policy";
function walk(dir) {
  return readdirSync(resolve(ROOT, dir), { withFileTypes: true }).flatMap((entry) => (
    entry.isDirectory() ? walk(`${dir}/${entry.name}`) : entry.name.endsWith(".js") ? [`${dir}/${entry.name}`] : []
  ));
}
const FILES = walk(POLICY_DIR).sort();
// 不视为可调参数的数值：零和单位量、取半、平方与防除零、浮点容差。
const ALLOWED = new Set(["0", "1", "2", "0.5", "1e-9", "1e-6"]);
const showLines = process.argv.includes("--lines");

function stripNonCode(line) {
  return line
    .replace(/\/\/.*$/, "")
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
}

let total = 0;
for (const file of FILES) {
  const lines = readFileSync(resolve(ROOT, file), "utf8").split(/\r?\n/);
  const perMethod = new Map();
  let method = "(模块顶层)";
  let fileTotal = 0;
  lines.forEach((raw, index) => {
    const declaration = raw.match(/^(?:  |export function |function )([A-Za-z_][\w]*)\(.*\) \{$/)
      || raw.match(/^(?:export )?function ([A-Za-z_][\w]*)\(/);
    if (declaration) method = declaration[1];
    const literals = (stripNonCode(raw).match(/(?<![\w.$\]])\d+(?:\.\d+)?(?:e-?\d+)?(?![\w])/g) || [])
      .filter((literal) => !ALLOWED.has(literal));
    if (literals.length === 0) return;
    fileTotal += literals.length;
    perMethod.set(method, (perMethod.get(method) || 0) + literals.length);
    if (showLines) console.log(`${file}:${index + 1}: ${literals.join(" ")}`);
  });
  total += fileTotal;
  if (!showLines) {
    if (fileTotal === 0) continue;
    console.log(`\n${file}：${fileTotal}`);
    for (const [name, count] of [...perMethod].sort((left, right) => right[1] - left[1])) {
      console.log(`  ${String(count).padStart(4)}  ${name}`);
    }
  }
}
console.log(`\n内联数值字面量合计：${total}`);
