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

// 战斗根目录只提供导航；新增模块必须选择明确的职责目录。
for (const file of files) {
  if (dirname(file) === resolve(ROOT, "shared/game")) {
    failures.push(`${display(file)} 应按职责放入战斗子目录，不能恢复根目录散放`);
  }
}


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
    allowedRoots: ["shared/game", "shared/protocol", "shared/data"],
    reason: "共享规则叶模块不得反向依赖总入口、界面或服务端",
  },
  {
    dir: "shared/game/foundation",
    allowedRoots: ["shared/game/foundation", "shared/data"],
    reason: "基础工具不得依赖游戏规则、角色、实体或编排",
  },
  {
    dir: "shared/game/rules",
    allowedRoots: ["shared/game/rules", "shared/game/foundation", "shared/data"],
    reason: "通用规则不得依赖具体角色、状态所有者或适配器",
  },
  {
    dir: "shared/game/ai/policy",
    allowedRoots: [
      "shared/game/ai/policy",
      "shared/game/ai/params",
      "shared/game/ai/actions.js",
      "shared/data",
      "shared/game/foundation/math.js",
      "shared/game/characters/catalog.js",
      "shared/game/rules/throttle.js",
      "shared/game/rules/combat-rules.js",
      "shared/game/foundation/constants.js",
      "shared/game/characters/bunny-haruhi/config.js",
      "shared/protocol",
    ],
    reason: "AI 策略只消费观测数据，不得导入运行时规则模块、观测桥或战斗内核",
  },
  {
    dir: "shared/game/ai/policy/algorithms",
    allowedRoots: ["shared/game/ai/policy/algorithms", "shared/game/foundation", "shared/game/rules", "shared/game/characters/catalog.js", "shared/data"],
    reason: "AI 事实算法不得导入策略协调器、状态组件、启发式或动作桥",
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
    dir: "src/battle/webgl",
    allowedRoot: null,
    forbiddenTarget: "src/battle/render.js",
    reason: "底层 WebGL 图元与驱动不得反向依赖战场绘制编排入口",
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

for (const file of walk("shared/game/model")) {
  for (const specifier of importSpecifiers(file)) {
    if (display(resolveImport(file, specifier)).startsWith("shared/game/runtime/")) {
      failures.push(`${display(file)} 不得反向导入对局编排层`);
    }
  }
}

// 舰船推进只消费装配时注入的能力、效果与投影，不再导入具体角色实现。
for (const fileName of ["shared/game/model/ship.js", "shared/game/model/projectile.js", "shared/game/model/scout.js", "shared/game/model/wingman.js"]) {
  const allowed = new Set([
    "shared/game/rules/throttle.js", "shared/game/rules/combat-rules.js", "shared/game/characters/catalog.js",
    "shared/game/foundation/math.js", "shared/game/foundation/rng.js", "shared/game/rules/damage.js", "shared/game/systems/collision-system.js",
    "shared/game/model/model-support.js",
    "shared/data/plain-data.js",
    "shared/game/systems/ship-navigation.js", "shared/game/adapters/navigation-port.js",
    "shared/game/systems/ship-status.js", "shared/game/systems/weapon-cycle.js", "shared/game/systems/hull-damage.js", "shared/game/adapters/ship-combat-port.js",
  ]);
  for (const specifier of importSpecifiers(resolve(ROOT, fileName))) {
    const target = display(resolveImport(resolve(ROOT, fileName), specifier));
    if (!allowed.has(target)) failures.push(`${fileName} 不得直接解释角色组件或角色投影 ${target}`);
  }
}

// 编队和胜负资格由能力层解释，舰队与猎杀不能自行绑定某个伴随角色。
for (const fileName of ["shared/game/model/team.js", "shared/game/characters/shamisen/hunt.js"]) {
  const file = resolve(ROOT, fileName);
  if (importSpecifiers(file).some((specifier) => display(resolveImport(file, specifier)) === "shared/game/characters/bunny-haruhi/companion-rules.js")) {
    failures.push(`${fileName} 应通过能力契约读取参与资格，不得直接导入伴随角色规则`);
  }
}

// 通用算法只允许基础工具；角色能力由调用方注入。
for (const fileName of walk("shared/game/systems").map(display)) {
  const file = resolve(ROOT, fileName);
  for (const specifier of importSpecifiers(file)) {
    const target = display(resolveImport(file, specifier));
    if (!["shared/game/foundation/math.js", "shared/game/rules/damage.js", "shared/game/rules/throttle.js", "shared/data/plain-data.js"].includes(target)) {
      failures.push(`${fileName} 不得导入角色实现或状态所有者 ${target}`);
    }
  }
}

// 雷达状态机消费值样本；实体映射和识别提交只能留在角色端口。
for (const specifier of importSpecifiers(resolve(ROOT, "shared/game/characters/yuki/radar-runtime.js"))) {
  const target = display(resolveImport(resolve(ROOT, "shared/game/characters/yuki/radar-runtime.js"), specifier));
  if (!["shared/game/foundation/math.js", "shared/game/rules/combat-rules.js"].includes(target)) {
    failures.push(`长门雷达运行时不得导入实体、装配器或角色端口 ${target}`);
  }
}

// 页面装配可创建对局，表现与联机消费模块只使用静态定义、纯算法及读模型。
for (const [file, targets] of graph) {
  if (targets.some((target) => display(target) === "shared/game/runtime/battle-runtime.js")
    && display(file) !== "shared/game/runtime/match-simulation.js") {
    failures.push(`${display(file)} 不得绕过权威模拟直接装配带外部时间源的战斗世界`);
  }
}

const simulationEntrypoints = new Set(["src/solo/session.js", "src/debug.js", "src/battle/native-webgl-visual-fixture.js"]);
for (const file of walk("src")) {
  for (const specifier of importSpecifiers(file)) {
    const target = display(resolveImport(file, specifier));
    if ((target === "shared/game-core.js" || target.startsWith("shared/game/model/") || target.startsWith("shared/game/runtime/"))
      && !simulationEntrypoints.has(display(file))) {
      failures.push(`${display(file)} 不得依赖权威实体或模拟入口 ${target}`);
    }
  }
}

const requiredLinks = [
  ["shared/game/runtime/match-simulation.js", "./battle-runtime.js"],
  ["shared/game/runtime/match-simulation.js", "./simulation-time.js"],
  ["shared/game-core.js", "./game/ai/bot-controller.js"],
  ["shared/game-core.js", "./game/characters/catalog.js"],
  ["shared/game-core.js", "./game/rules/combat-rules.js"],
  ["shared/game-core.js", "./game/foundation/math.js"],
  ["shared/game-core.js", "./game/rules/throttle.js"],
  ["shared/game-core.js", "./game/runtime/match-simulation.js"],
  ["shared/game/runtime/battle-runtime.js", "../model/team.js"],
  ["shared/game/runtime/battle-runtime.js", "../ai/bridge/runner.js"],
  ["shared/game/runtime/battle-runtime.js", "./action-dispatcher.js"],
  ["shared/game/model/team.js", "../model/ship.js"],
  ["shared/game/model/team.js", "../systems/targeting-system.js"],
  ["shared/game/model/team.js", "../adapters/visibility-port.js"],
  ["shared/game/ai/bot-controller.js", "./policy/rule-policy.js"],
  ["shared/game/ai/bridge/runner.js", "./action-port.js"],
  ["shared/game/ai/bridge/action-port.js", "../../runtime/action-dispatcher.js"],
  ["shared/game/ai/bridge/action-port.js", "./observation.js"],
  ["shared/game/ai/policy/rule-policy.js", "../params/index.js"],
  ["shared/game/ai/policy/heuristics/context.js", "../tactics/character-counterplay.js"],
  ["shared/game/ai/policy/heuristics/context.js", "../tactics/shamisen-hunt.js"],
  ["server/match-runtime.js", "../shared/game/runtime/fixed-step-clock.js"],
  ["server/server.js", "../shared/protocol/ruleset-version.js"],
  ["shared/game/runtime/action-dispatcher.js", "../../protocol/match-actions.js"],
  ["src/solo.js", "../shared/protocol/match-actions.js"],
  ["src/solo.js", "./battle/action-transport.js"],
  ["src/solo.js", "./battle/scout-joystick.js"],
  ["src/solo/session.js", "../battle/state-interpolation.js"],
  ["src/solo.js", "./battle/native-webgl-renderer.js"],
  ["src/solo/session.js", "../../shared/game/runtime/fixed-step-clock.js"],
  ["src/online.js", "../shared/protocol/match-actions.js"],
  ["src/online.js", "./battle/action-transport.js"],
  ["src/online.js", "./battle/scout-joystick.js"],
  ["src/online.js", "./online/state-sync.js"],
  ["src/online.js", "./online/connection-target.js"],
  ["src/online.js", "./online/profile-controller.js"],
  ["src/online.js", "./online/result-view.js"],
  ["src/online.js", "./online/lobby-view.js"],
  ["src/online.js", "./online/snapshot-transport.js"],
  ["src/online.js", "./battle/native-webgl-renderer.js"],
  ["src/online/state-sync.js", "../battle/state-interpolation.js"],
  ["src/battle/hud.js", "./cooldown-progress.js"],
  ["src/online/snapshot-transport.js", "../../shared/protocol/ruleset-version.js"],
  ["src/i18n.js", "./i18n/catalog.js"],
  ["src/character-select.js", "./character-select/portraits.js"],
  ["src/battle/render.js", "./render/radar.js"],
  ["src/battle/render.js", "./render/vision-wave.js"],
  ["src/battle/render.js", "./render/koizumi-barrier.js"],
  ["src/battle/render.js", "./render/shamisen-hunt.js"],
  ["src/battle/render.js", "./render/haruhi-hero-power.js"],
  ["src/battle/native-webgl-renderer.js", "./webgl/driver.js"],
  ["src/battle/native-webgl-renderer.js", "./webgl/native-context.js"],
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
