# 发布、环境与回滚

## 分支与授权

开发人员从 `dev` 创建功能分支，提交 PR 到 `dev`。通过检查与评审后 squash 合并，让一个开发 PR 对应一个可择取提交。`dev` 的每次合并通过完整校验后自动部署测试服。

提交、PR 标题和最终 squash / merge 消息均遵循[提交规范](development.md#提交规范)。普通 PR 保持单一工作项；晋级 PR 可组合多个已评估工作项。合并者需将 GitHub 默认的英文 merge 标题改成规范中文消息，例如 `chore(release): 合并已评估的热更新候选`；格式不符会阻断推送后的候选校验与测试服部署。

`main` 是正式候选线。只有经过评估、获得明确合并指令的 `release/*` 或 `hotfix/*` PR 才进入 `main`；保留候选中的择取提交，使用 **merge commit**，不要 squash 或 rebase 晋级 PR，否则会丢失 `-x` 来源凭证。合入 `main` 不自动部署正式服；维护者再执行“正式发布（明确指令）”工作流，填写完整 main SHA、类型和发布指令，由 production 环境审批。

| 类型 | 公开版本 | 游戏内日志 | 胜率统计 | 构建与规则版本 |
| --- | --- | --- | --- | --- |
| 发版 `release` | 必须递增 | 必须更新并展示对应版本 | 新版本独立统计 | 构建以 Git SHA 标识；规则语义变化更新规则版本 |
| 热更新 `hotfix` | 保持不变 | 不新增或改写公开发布日志 | 继续归入同一公开版本 | 每次构建有独立 SHA；紧急平衡调整仍需更新规则版本 |

公开版本与三语展示标签由 [shared/release.json](../shared/release.json) 提供，`previousVersions` 保留已发布历史以接收旧端结算；`package.json` 的工具包版本不是游戏版本。更新日志正文在 [src/changelog/entries.js](../src/changelog/entries.js)，沿用当前维护者确认正文的方式。

## 选择性晋级

不直接把整个 `dev` 合入 `main`。从最新 main 创建候选，按依赖顺序选择已经进入 dev 的普通提交：

```bash
npm run release:prepare -- hotfix hotfix/fix-input full '测试服评估记录或链接' <提交SHA1> <提交SHA2>
# 发版改用 release release/v0.4，并填写新版本、三语标签、历史版本清单和游戏内日志。
```

脚本要求工作区干净，拉取 main/dev，执行 `cherry-pick -x` 并生成 `deploy/promotion.json`。清单记录类型、main 基线、dev 快照、选择的提交、范围和评估依据。遇到冲突保留现场；先检查是否遗漏依赖，必要时回到 dev 修正并重新评估。不要随意在候选中加入尚未通过 dev 的业务代码。

清单完成后提交、运行相关测试与完整候选门禁，创建目标为 main 的 PR。可以先用 `git cherry origin/main origin/dev` 排除已晋级的等价补丁。候选检查比较来源补丁与实际候选，允许额外提交晋级清单及发版元数据；冲突解决改变了业务补丁时，应先把修正进入 dev 并重新择取。

清单提交可用 `chore(release): 记录热更新择取来源与评估`。择取后的原规范标题保持不变；旧格式来源需要编辑新提交标题时，必须保留 `(cherry picked from commit ...)`，不得改写来源分支历史。

main 前进后重新基于最新 main 准备候选并更新评估。发布后把 main 的发版元数据通过同步 PR 合回 dev；同步 PR 使用 merge commit 保留历史，不再次择取已发布补丁。所有后续业务 PR 仍 squash 合并。

`scope=web` 只更新前端。服务端、共享规则/版本或依赖变化强制 `scope=full`，同时部署前端与对应联机服务；完整发布可能中断正在进行的对局，评估记录应说明重启窗口。

## 目标环境

| 环境 | 页面 | 联机代理 | 进程与默认端口 |
| --- | --- | --- | --- |
| dev 测试 | `https://haruyuki.cn/test-game/` | `/test-game/ws/` | `haruhi-dev-web:21255`、`haruhi-dev-ws:21256` |
| main 正式 | `https://star.haruyuki.cn/play` | `/ws/` | `haruhi-star-web:21250`、`haruhi-ws:21246` |

测试构建使用 `/test-game/` 基路径、`staging` 通道、独立浏览器存储键、游客模式和专属 WS 代理。身份刷新、登录、回调、退出与票据请求均不接触主站身份接口。测试联机进程不加载身份公钥，统计目录与盐独立。测试连接失败不会回落到正式端口或接受 `?ws=` 改向。

同源路径并不是浏览器安全沙箱：`/test-game/` 的代码具有主站同源能力，只应部署已经评审、可信的代码，不能作为任意外部 PR 的预览地址。命名空间和禁用身份用于防止正常代码意外串用数据，不声称能隔离恶意脚本。

2026-09-29 的只读检查发现旧 `/test-game/ws/` 仍代理 21246，旧前端在 21245。本表是新流程目标，必须完成下面的初始化并验证后，才能宣称已隔离。旧 `test.haruyuki.cn/game/` 不是新的交付入口；旧进程不随本次代码修改自动删除。

## 一次性初始化

仓库中的工作流不会替管理员自动创建保护规则、审批人、凭据或修改 Nginx。初始化完成前，部署任务因缺少配置失败是未启用，而不是部署成功。

1. 建立 `dev`，从当前正式 main 起步；将本流程作为普通 PR 合入 dev。设置默认 PR 目标为 dev。
2. 为 dev/main 禁止强推和删除，要求 PR、至少一名评审及状态检查 `完整候选校验`，要求分支基于最新基线。main 的发布相关文件由 CODEOWNERS 审阅，明确合并指令写在评审中；不得将工作流成功等同授权。
3. 建立 GitHub `staging` 环境（仅 dev），以及 `production` 环境（仅 dev/main 可发起手动工作流，但部署代码始终取精确 main SHA）。production 设置维护者审批并禁止自行审批；在默认分支运行手动工作流，不能从任意功能分支运行带生产凭据的作业。
4. 两个环境分别设置 `DEPLOY_HOST`、`DEPLOY_USER`、`DEPLOY_SSH_KEY`、`DEPLOY_KNOWN_HOSTS`。公钥校验使用预先核实的 known_hosts，不在 CI 临时信任扫描结果。测试部署账号应无权读取或修改生产目录、凭据和进程，禁止把生产 root SSH 密钥提供给 dev 工作流。
5. 在发布主机安装受控入口 [deploy.sh](../scripts/release/deploy.sh) 到 `/srv/tdos/bin/deploy.sh`；部署用户需有 Node、npm、PM2、tar 和 flock。按环境复制 [staging.env.sample](../deploy/staging.env.sample) 与 [production.env.sample](../deploy/production.env.sample) 到 `/srv/tdos/config/`，权限 600，保持生产原有统计目录、盐与公钥。测试默认端口必须空闲。
6. 首次接管生产进程前，将旧版本和可恢复的 `ecosystem.config.json` 登记为 `production/current-web`、`production/current-server`。脚本会拒绝接管有进程却没有回滚配置的环境。
7. 安装 [test-game.nginx.conf](../deploy/test-game.nginx.conf) 到主站现有 HTTPS server，替换旧测试 location；`nginx -t` 通过后重载。确认 `/test-game/ws/` 只到 21256，不改变正式代理。
8. 合并一个 dev PR，核对 Actions 记录、公开 `build-info.json`、静态资源与真实双客户端。正式环境的首次接管和发布另需明确指令。

GitHub 的环境保护和分支保护原理分别见[部署环境](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments)和[分支保护](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)。平台设置与仓库文件共同构成门禁，只有 YAML 不等于已启用保护。

## 每次部署的证据

[项目校验工作流](../.github/workflows/ci.yml)检查 dev/main PR，执行完整测试和两个基路径构建；dev 合并后打包并部署。旧 dev SHA 已被新提交取代时停止旧候选部署。同一环境的部署串行，不中途取消正在切换的作业。

[正式发布工作流](../.github/workflows/production.yml)只接受明确手动指令，重新核对 main、晋级清单和类型，运行完整门禁，打包精确提交。打包器拒绝未提交改动；产物包含公开版本、通道、基路径、SHA 的 `build-info.json`。

发布目录为 `/srv/tdos/<环境>/releases/<SHA>`，不覆盖已存在版本。服务端安装锁文件依赖，只更新指定环境和范围；本地 HTTP 与 WS 身份检查失败时恢复已登记的上一进程配置。CI 再验证公开地址。外网验证失败仍需维护者排查代理并决定回滚，不把本地握手成功当作完整上线证据。

验证至少记录候选 SHA、公开版本、类型、选择来源、评估记录、构建/测试结果、实际部署范围及公开验证结果。确认深链、资源哈希、缓存策略，必要时验证真实对局与统计追加。

## 回滚与持久数据

`current-web` 和 `current-server` 分别记录最近成功激活的目录，静态热更新不改 server 指针。旧发布目录和统计目录均保留。需要回滚到更早版本时，根据部署记录选择对应的两个目录，使用其 `ecosystem.config.json` 只恢复目标进程，再核对公开构建与联机握手，并更新相应指针。

回滚不删除 JSONL、匿名盐或身份数据；没有可靠版本信息的旧对局保留在“历史数据（未标记版本）”，不猜测归入当前版本。旧代码可能不支持分版本查询，回滚时应同步选择兼容的前后端。

[scripts/update-haruhi-game.sh](../scripts/update-haruhi-game.sh) 是旧的覆盖更新脚本，会混合重启测试与正式联机服务，禁止作为新流程入口。
