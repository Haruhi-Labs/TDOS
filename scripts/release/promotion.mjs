import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function git(...args) { return execFileSync("git", args, { encoding: "utf8" }).trim(); }
export function validatePromotion(plan, previous, current) {
  if (!["release", "hotfix"].includes(plan.kind)) throw new Error("晋级类型必须为 release 或 hotfix");
  for (const key of ["baseMain", "sourceDev"]) {
    if (!/^[a-f0-9]{40}$/.test(plan[key] || "")) throw new Error(`晋级清单缺少精确提交：${key}`);
  }
  if (!Array.isArray(plan.commits) || !plan.commits.length || new Set(plan.commits).size !== plan.commits.length
      || plan.commits.some(sha => !/^[a-f0-9]{40}$/.test(sha))) throw new Error("择取清单必须为不重复的完整提交号");
  if (typeof plan.evaluation !== "string" || plan.evaluation.trim().length < 8) throw new Error("必须记录测试评估依据");
  if (!["web", "full"].includes(plan.scope)) throw new Error("部署范围必须为 web 或 full");
  const pattern = /^v\d+\.\d+(?:\.\d+)?$/;
  if (!pattern.test(current.version)) throw new Error("公开版本格式应为 v主版本.次版本[.补丁版本]");
  if (plan.kind === "hotfix" && current.version !== previous.version) throw new Error("热更新必须保留公开版本号");
  if (plan.kind === "release") {
    const parts = value => value.slice(1).split(".").map(Number).concat([0]).slice(0, 3);
    const a = parts(current.version), b = parts(previous.version);
    const first = a.findIndex((n, i) => n !== b[i]);
    if (first < 0 || a[first] < b[first]) throw new Error("正式发版必须递增公开版本号");
    if (["zh", "ja", "en"].some(locale => !current.labels?.[locale]?.includes(current.version))) throw new Error("版本展示标签必须包含新版本号");
  }
}

export function checkPromotion(base, head = "HEAD", expectedKind) {
  const show = file => git("show", `${head}:${file}`);
  const plan = JSON.parse(show("deploy/promotion.json"));
  let previous;
  try { git("cat-file", "-e", `${base}:shared/release.json`); previous = JSON.parse(git("show", `${base}:shared/release.json`)); }
  catch {
    // 一次性兼容尚未引入共享公开版本文件的旧 main；不猜测历史统计版本。
    const version = git("show", `${base}:src/changelog/meta.js`).match(/CURRENT_RELEASE_ID = "(v[0-9.]+)"/)?.[1];
    if (!version) throw new Error("无法识别 main 的公开版本基线");
    previous = { version };
  }
  const current = JSON.parse(show("shared/release.json"));
  validatePromotion(plan, previous, current);
  if (expectedKind && plan.kind !== expectedKind) throw new Error("发布指令与晋级类型不一致");
  if (git("rev-parse", base) !== plan.baseMain) throw new Error("main 已变化，请重新基于最新 main 评估候选");
  git("merge-base", "--is-ancestor", plan.sourceDev, "origin/dev");
  for (const sha of plan.commits) {
    git("merge-base", "--is-ancestor", sha, plan.sourceDev);
    if (git("rev-list", "--parents", "-n", "1", sha).split(" ").length !== 2) throw new Error("择取对象必须是普通提交；功能 PR 请 squash 合并到 dev");
  }
  const messages = git("log", "--format=%B", `${base}..${head}`);
  for (const sha of plan.commits) if (!messages.includes(`(cherry picked from commit ${sha})`)) throw new Error(`缺少择取来源凭证：${sha}`);
  const patchId = sha => execFileSync("git", ["patch-id", "--stable"], {
    input: execFileSync("git", ["show", "--format=", "--binary", sha], { maxBuffer: 64 * 1024 * 1024 }), encoding: "utf8",
  }).trim().split(" ")[0];
  const sourcePatches = new Set(plan.commits.map(patchId));
  const metadata = new Set(["deploy/promotion.json", ...(plan.kind === "release"
    ? ["shared/release.json", "src/changelog/entries.js", "src/i18n/messages-en.js", "src/i18n/messages-ja.js"] : [])]);
  for (const sha of git("rev-list", "--no-merges", `${base}..${head}`).split("\n").filter(Boolean)) {
    if (sourcePatches.has(patchId(sha))) continue;
    const files = git("diff-tree", "--no-commit-id", "--name-only", "-r", sha).split("\n");
    if (files.some(file => !metadata.has(file))) throw new Error(`候选包含未经 dev 验证的额外改动：${sha}`);
  }
  const changed = git("diff", "--name-only", base, head).split("\n");
  if (plan.scope === "web" && changed.some(file => /^(server\/|shared\/|package(-lock)?\.json)/.test(file))) throw new Error("共享规则、版本或服务端变化需要 full 部署");
  if (plan.kind === "release" && !changed.includes("src/changelog/entries.js")) throw new Error("正式发版必须提供游戏内更新日志");
  if (plan.kind === "hotfix" && changed.includes("src/changelog/entries.js")) throw new Error("热更新不修改公开更新日志；需要新日志时使用发版流程");
  return plan;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...args] = process.argv.slice(2);
  if (command === "check") {
    const plan = checkPromotion(args[0], args[1] || "HEAD", args[2]);
    console.log(`晋级检查通过：${plan.kind}，${plan.commits.length} 个来源提交，范围 ${plan.scope}`);
  } else if (command === "prepare") {
    const [kind, branch, scope, evaluation, ...commits] = args;
    if (!["release", "hotfix"].includes(kind) || !branch?.startsWith(`${kind}/`)) throw new Error("候选分支应以 release/ 或 hotfix/ 开头");
    if (git("status", "--porcelain")) throw new Error("请先处理工作区已有改动");
    git("fetch", "origin", "main", "dev");
    const baseMain = git("rev-parse", "origin/main"), sourceDev = git("rev-parse", "origin/dev");
    const resolved = commits.map(sha => {
      if (!/^[a-f0-9]{7,40}$/.test(sha)) throw new Error("只接受明确的提交号");
      return git("rev-parse", `${sha}^{commit}`);
    });
    // 发版的新版本随后由维护者填写；此处先检查清单与来源。
    validatePromotion({ kind: "hotfix", baseMain, sourceDev, commits: resolved, evaluation, scope }, { version: "v0.3" }, { version: "v0.3" });
    for (const sha of resolved) {
      git("merge-base", "--is-ancestor", sha, sourceDev);
      if (git("rev-list", "--parents", "-n", "1", sha).split(" ").length !== 2) throw new Error("请选择 squash 后的普通提交，不选择 merge commit");
    }
    git("switch", "-c", branch, baseMain);
    // 冲突时保留现场，人工解决后继续；不自动覆盖或撤销已有修改。
    git("cherry-pick", "-x", ...resolved);
    writeFileSync("deploy/promotion.json", JSON.stringify({ kind, baseMain, sourceDev, commits: resolved, scope, evaluation }, null, 2) + "\n");
    console.log("候选已创建；检查依赖、填写发版版本与日志（热更新跳过），提交清单，完成验收后创建目标为 main 的 PR。尚未合并或部署。");
  } else {
    throw new Error("用法：promotion.mjs prepare <release|hotfix> <分支> <web|full> <评估依据> <提交号...>，或 check <main基线> [候选] [类型]");
  }
}
