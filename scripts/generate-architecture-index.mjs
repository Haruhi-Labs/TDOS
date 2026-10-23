// 只生成文件定位索引；静态入出边不等同于运行调用或状态所有权。
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve, relative, basename } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
function modules(directory) {
  return readdirSync(resolve(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? modules(path) : path.endsWith('.js') ? [path] : [];
  });
}
const files = [...new Set(['shared/game', 'shared/protocol', 'shared/data', 'server', 'src'].flatMap(modules)
  .concat(['shared/game-core.js', 'shared/network-patch.js']))].sort((a, b) => dirname(a).localeCompare(dirname(b)) || a.localeCompare(b));
const edges = new Map();
const sources = new Map(files.map((file) => [file, readFileSync(resolve(root, file), 'utf8')]));
for (const [file, source] of sources) {
  const references = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*)["'](\.[^"']+)["']/g)].map((match) => relative(root, resolve(root, dirname(file), match[1])));
  edges.set(file, new Set(references.filter((reference) => reference.endsWith('.js') && existsSync(resolve(root, reference)))));
}
const revision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
let output = `# 架构模块索引\n\n源码基线 \`${revision}\`（生成时工作树）。共 ${files.length} 个 JavaScript 模块，范围为 \`shared/game\`、\`shared/protocol\`、\`shared/data\`、\`server\`、\`src\`，另含稳定导出和快照差量。样式、素材、测试、发布脚本不在此索引中。\n\n运行 \`node scripts/generate-architecture-index.mjs\` 更新。本表按相对静态 import/export 引用生成；出边为不同本地 JS 模块，入边仅统计本表范围。行数与引用数量不衡量架构质量，状态持有和实际消费见 [架构地图](architecture-map.md)。\n`;
let group;
for (const file of files) {
  if (dirname(file) !== group) {
    group = dirname(file);
    output += `\n## \`${group}\`\n\n| 模块 | 行数 | 静态出边 | 范围内入边 |\n| --- | ---: | ---: | ---: |\n`;
  }
  const incoming = [...edges.values()].filter((set) => set.has(file)).length;
  output += `| [${basename(file)}](../${file}) | ${sources.get(file).trimEnd().split('\n').length} | ${edges.get(file).size} | ${incoming} |\n`;
}
writeFileSync(resolve(root, 'docs/architecture-module-index.md'), output);
console.log(`架构模块索引已更新：${files.length} 个模块。`);
