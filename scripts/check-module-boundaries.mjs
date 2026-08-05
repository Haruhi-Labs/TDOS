import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_ROOTS = ["shared", "src", "server"];
const LOCAL_REFERENCE_FILES = new Set([
  "shared/game-core.baseline.js",
  "shared/game-core.fair0.js",
]);

function walk(relativeDir) {
  const absoluteDir = resolve(ROOT, relativeDir);
  return readdirSync(absoluteDir, { withFileTypes: true }).flatMap((entry) => {
    const child = join(absoluteDir, entry.name);
    if (entry.isDirectory()) {
      return walk(relative(ROOT, child));
    }
    const relativeFile = relative(ROOT, child).split(sep).join("/");
    return extname(entry.name) === ".js" && !LOCAL_REFERENCE_FILES.has(relativeFile) ? [child] : [];
  });
}

function importSpecifiers(file) {
  const source = readFileSync(file, "utf8");
  const patterns = [
    /(?:from\s+|^\s*import\s*|import\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/gm,
  ];
  return patterns.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1]));
}

function resolveImport(file, specifier) {
  const target = resolve(dirname(file), specifier);
  if (existsSync(target)) return target;
  if (existsSync(`${target}.js`)) return `${target}.js`;
  if (existsSync(join(target, "index.js"))) return join(target, "index.js");
  return target;
}

function display(file) {
  return relative(ROOT, file).split(sep).join("/");
}

const failures = [];
const files = SOURCE_ROOTS.flatMap(walk);
const graph = new Map(files.map((file) => [file, []]));

for (const file of files) {
  for (const specifier of importSpecifiers(file)) {
    const target = resolveImport(file, specifier);
    if (!existsSync(target)) {
      failures.push(`${display(file)} 引用了不存在的模块 ${specifier}`);
      continue;
    }
    if (graph.has(target)) {
      graph.get(file).push(target);
    }
  }
}

const leafBoundaries = [
  {
    dir: "shared/game",
    allowedRoots: ["shared/game", "shared/protocol"],
    reason: "共享规则叶模块不得反向依赖总入口、界面或服务端",
  },
  {
    dir: "shared/protocol",
    allowedRoots: ["shared/protocol"],
    reason: "共享协议定义不得依赖战斗实现、界面或服务端",
  },
  {
    dir: "src/online",
    allowedRoot: null,
    forbiddenTarget: "src/online.js",
    reason: "联机状态同步不得反向依赖联机页面编排器",
  },
  {
    dir: "src/i18n",
    allowedRoot: "src/i18n",
    reason: "语言词典不得依赖运行时翻译入口或业务界面",
  },
  {
    dir: "src/character-select",
    allowedRoot: null,
    forbiddenTarget: "src/character-select.js",
    reason: "立绘模块不得反向依赖角色选择编排器",
  },
  {
    dir: "src/battle/render",
    allowedRoot: null,
    forbiddenTarget: "src/battle/render.js",
    reason: "专项渲染模块不得反向依赖通用渲染入口",
  },
  {
    dir: "server",
    allowedRoot: null,
    forbiddenTarget: "server/server.js",
    reason: "服务端领域模块不得反向依赖进程入口",
  },
];

for (const boundary of leafBoundaries) {
  const boundaryDir = resolve(ROOT, boundary.dir);
  const allowedRoots = (boundary.allowedRoots || (boundary.allowedRoot ? [boundary.allowedRoot] : []))
    .map((root) => resolve(ROOT, root));
  const forbiddenTarget = boundary.forbiddenTarget ? resolve(ROOT, boundary.forbiddenTarget) : null;
  for (const file of walk(boundary.dir)) {
    for (const specifier of importSpecifiers(file)) {
      const target = resolveImport(file, specifier);
      const leavesAllowedRoots = allowedRoots.length > 0 && !allowedRoots.some(
        (allowedRoot) => target === allowedRoot || target.startsWith(`${allowedRoot}${sep}`),
      );
      if (leavesAllowedRoots || (forbiddenTarget && target === forbiddenTarget)) {
        failures.push(`${display(file)} → ${display(target)}：${boundary.reason}`);
      }
    }
  }
}

for (const fileName of ["server/config.js", "server/protocol.js", "server/snapshot-stream.js"]) {
  const file = resolve(ROOT, fileName);
  for (const specifier of importSpecifiers(file)) {
    if (resolveImport(file, specifier) === resolve(ROOT, "server/server.js")) {
      failures.push(`${fileName} 不得反向依赖 server/server.js`);
    }
  }
}

const requiredLinks = [
  ["shared/game-core.js", "./game/bot-controller.js"],
  ["shared/game-core.js", "./game/characters.js"],
  ["shared/game-core.js", "./game/combat-rules.js"],
  ["shared/game-core.js", "./game/math.js"],
  ["shared/game-core.js", "./game/throttle.js"],
  ["shared/game-core.js", "./game/visibility-radar.js"],
  ["shared/game-core.js", "./game/vision-wave.js"],
  ["shared/game-core.js", "./game/targeting-system.js"],
  ["shared/game-core.js", "./game/action-dispatcher.js"],
  ["shared/game-core.js", "./game/collision-system.js"],
  ["server/match-runtime.js", "../shared/game/fixed-step-clock.js"],
  ["server/server.js", "../shared/protocol/ruleset-version.js"],
  ["shared/game/action-dispatcher.js", "../protocol/match-actions.js"],
  ["src/solo.js", "../shared/protocol/match-actions.js"],
  ["src/solo.js", "./battle/action-transport.js"],
  ["src/solo.js", "./battle/scout-joystick.js"],
  ["src/solo.js", "../shared/game/fixed-step-clock.js"],
  ["src/online.js", "../shared/protocol/match-actions.js"],
  ["src/online.js", "./battle/action-transport.js"],
  ["src/online.js", "./battle/scout-joystick.js"],
  ["src/online.js", "./online/state-sync.js"],
  ["src/online.js", "./online/connection-target.js"],
  ["src/online.js", "./online/profile-controller.js"],
  ["src/online.js", "./online/result-view.js"],
  ["src/online.js", "./online/lobby-view.js"],
  ["src/online.js", "./online/snapshot-transport.js"],
  ["src/battle/hud.js", "./cooldown-progress.js"],
  ["src/online/snapshot-transport.js", "../../shared/protocol/ruleset-version.js"],
  ["src/i18n.js", "./i18n/catalog.js"],
  ["src/character-select.js", "./character-select/portraits.js"],
  ["src/battle/render.js", "./render/radar.js"],
  ["src/battle/render.js", "./render/vision-wave.js"],
  ["server/server.js", "./config.js"],
  ["server/server.js", "./protocol.js"],
  ["server/server.js", "./snapshot-stream.js"],
  ["server/server.js", "./room-registry.js"],
  ["server/server.js", "./room-lifecycle.js"],
  ["server/server.js", "./input-queue.js"],
  ["server/server.js", "./match-runtime.js"],
];

for (const [fileName, specifier] of requiredLinks) {
  const file = resolve(ROOT, fileName);
  if (!importSpecifiers(file).includes(specifier)) {
    failures.push(`${fileName} 必须通过 ${specifier} 维持既定模块边界`);
  }
}

const visiting = new Set();
const visited = new Set();
const stack = [];

function detectCycle(file) {
  if (visiting.has(file)) {
    const cycleStart = stack.indexOf(file);
    failures.push(`发现循环依赖：${[...stack.slice(cycleStart), file].map(display).join(" → ")}`);
    return;
  }
  if (visited.has(file)) return;
  visiting.add(file);
  stack.push(file);
  for (const target of graph.get(file) || []) detectCycle(target);
  stack.pop();
  visiting.delete(file);
  visited.add(file);
}

for (const file of files) detectCycle(file);

if (failures.length > 0) {
  console.error("模块边界检查失败：");
  for (const failure of [...new Set(failures)]) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`模块边界检查通过：${files.length} 个源码模块无断链、反向依赖或循环依赖。`);
