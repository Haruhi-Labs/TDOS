# 测试与验收

测试用于证明改动满足行为契约。先运行能够暴露本次问题的检查，再按受影响边界扩展；发布候选另有完整门禁。命令定义以 [package.json](../package.json) 为准。

## 可执行分层

| 命令 | 覆盖 | 不代表什么 |
| --- | --- | --- |
| `npm run check:static` | 相对导入、已声明的依赖边界、循环依赖、单人/联机绘制副本守卫 | 不证明运行时行为或完整架构正确 |
| `npm run test:logic` | 规则/AI/教程、协议、权威回放、插值、房间/运行时模块、统计存储、票据验签和表现辅助函数 | 不运行浏览器或真实远程服务 |
| `npm run test:browser` | Chromium 中的更新日志、统计、身份、交互、WebGL 和测试服隔离场景 | 不证明真实账号登录、物理移动设备或生产可用 |
| `npm run test:integration` | 本地真实 WebSocket 服务的协议、容量门禁、版本和公开字段隔离 | 不证明生产容量或部署成功 |
| `npm run test:ai:simulation` | 16 局固定种子的 AI 对抗回归 | 不证明所有阵容平衡 |
| `npm run test:all` | 以上各层的完整回归 | 不包含生产构建、独立容量压测或人工验收 |
| `npm run build` | 模块/表现守卫与 Vite 生产构建 | 不替代行为测试或浏览器验收 |

既有细分命令保留。`test:ui:cooldown`、`test:ui:koizumi` 和 `test:mobile:scout` 实际是 Node 逻辑/绘制调用检查，归入 `test:logic`，不能因名称含 UI/mobile 就算浏览器或真机证据。

`test:camera` 在 Node 中验证导演镜头的鼠标锚点、反向接管、阻尼平移、30/60/144Hz响应一致性、边界、复位及减少动态效果偏好；同时检查玩家模式仍使用原即时缩放。它不代表实际浏览器手感或物理设备验收。

`test:ui:resolution` 验证单人、联机和观战的高 DPR 与 4K/5K 视口：实际 GPU 缓冲匹配设备像素，布局变化和跨屏密度变化会重分配，取景不变且卸载停止观察。另对 WebGL1/2 八倍文字与 Canvas 原生文字逐像素比较，并验证字形预热复用、缓存预算、提交前保护与曲线误差。它自建回环前端，联机 WebSocket、身份和统计均使用夹具，不连接已有服务；可用 `RESOLUTION_SCREENSHOT_DIR` 保存字形像素图。软件 GPU 和模拟屏幕不能替代物理高分辨率屏幕的画质及帧率验收。

`test:ui:spectator` 自建回环 WebSocket 服务与临时统计目录，以两位玩家和 Chromium 观众验证进入前双方昵称、首快照前阵容、实时冷却、六个技能名的悬浮/键盘/点按说明与视口边界、九种视口、逐帧平滑滚轮、拖拽取消、退出、玩家模式恢复及新版联机舰况入口的分离/切舰；身份接口使用游客夹具。移动端检查页面与展板均不滚动、六舰姓名完整及地图利用剩余空间，另用粗指针手机/平板验证触屏说明与退出不发送战斗指令。异常技能状态与零能量另用构造数据验证。可设置 `SPECTATOR_SCREENSHOT_DIR` 保存画面、`SPECTATOR_VIDEO_DIR` 保存交互录像，仍不代表远程多端或物理设备验收。

`test:ui:command` 启动回环前端并夹具化身份/统计接口，验证真实单人对战的分离、切舰、换挡、键盘帮助和五种视口；另用权威快照夹具覆盖技能冷却、沉默、瞄准、被动技能及编队零能量。可设置 `COMMAND_SCREENSHOT_DIR` 保存画面，不代表联机延迟或物理触屏验收。

`test:ui:skills` 是选角技能分层介绍的专项检查：简介不含数值，详细参数逐项核对技能元数据和关键运行时倍率；Chromium 覆盖八角色十六技能、桌面与触屏布局、中英日内容、键盘激活与焦点循环、遮罩/Esc 关闭、退出清理及矮屏滚动。它自建回环前端，身份和统计接口使用夹具，可设置 `SKILL_DETAILS_SCREENSHOT_DIR` 保存画面；物理触屏仍需人工验收。

`test:ui:selection` 检查眩晕和冲击禁控期间的选舰保持、操作无效、解除后的原舰恢复与击沉切舰。Node 直接核对共享模拟拒绝禁控动作；Chromium 覆盖单人/联机、桌面/触屏和主副舰。它自建回环前端，身份与统计使用夹具，单人模拟仅通过测试插件注入状态，联机 WebSocket 完全由快照夹具接管；不连接现有联机服务，不代表真实网络延迟与物理设备验收。

`test:ui:status` 是角色卡状态专项：Node 验证完整目录、权威寿命、净化/涤除、续期、叠层、死亡及显示不写回；Chromium 用权威模拟快照验证桌面对战/观战一致、绿红边框、时间环、禁用选舰仍可查看效果、悬停/键盘/点击、移动端隐藏、五种视口及卸载。自建回环前端，身份与统计使用夹具，可设置 `STATUS_EFFECT_SCREENSHOT_DIR` 保存画面。真实单人技能由 `test:ui:command` 补充，本地 WebSocket 收发由 `test:ui:spectator` 补充；不代表物理设备或远程网络验收。

`test:all` 按静态、逻辑、AI 模拟、浏览器、网络集成顺序执行，首个失败即停止。后续未执行项目应明确标注；修复后先重跑失败及受影响检查，发布前补齐完整候选结果。

## 按改动选择

下表是最低相关证据的选择入口，不要求每次把所有行执行一遍。跨边界改动取相关项并集；缺陷复现还应增加针对性断言。

| 改动 | 相关检查 | 额外验收 |
| --- | --- | --- |
| 纯开发文档 | `git diff --check`，核对本地链接、路径、npm 命令 | 不要求游戏构建或浏览器；修改测试编排需展开核对成员并实际运行 |
| 提交规范或 CI 门禁 | `test:commits`、`check:commits -- --range <基线> HEAD`；工作流改动检查 YAML/Actions 语法 | 验证拒绝不合规标题、中间提交及合并消息；格式校验不能证明工作项划分正确 |
| 模块拆分、导入或稳定导出 | `check:static`、`test:api`、受影响模块测试、构建 | 跨页面生命周期改动检查挂载与卸载 |
| 规则、角色数值、AI、教程 | 对应 `test:core:rules` / `test:core:ai` / `test:core:tutorial`；权威行为加 `test:authority`、`test:ruleset`，AI 加 `test:ai:simulation`；构建 | 规则语义变化更新版本；检查受影响技能和模式，模拟统计不替代平衡判断 |
| 动作、固定时钟、服务端执行链 | `test:actions`、`test:authority`、`test:server:runtime`，协议变化加 `test:ruleset`、`test:network:guards`；构建 | 真实多客户端输入、倒计时、结算及退出 |
| 快照、房间、网络协议 | `test:network`、`test:online:components`、`test:server:rooms`、`test:server:runtime`、`test:network:guards`；构建 | 断连、观战、乱序/恢复；容量参数变化另做隔离压测 |
| 插值或联机显示 | `test:online:state`、`test:online:components`；构建 | 延迟下的移动、换挡与航线确认，显示不得写回模拟 |
| 战场视觉或 WebGL | `check:static`、`test:ui:webgl`，古泉效果加 `test:ui:koizumi`；构建 | 单人/联机/观战受影响画面、WebGL1/2 及失效回退 |
| 普通页面、移动交互 | 对应 `test:ui:interaction` / `test:ui:command` / `test:ui:skills` / `test:mobile:scout` / `test:ui:cooldown`；构建 | 受影响桌面/窄屏路径；无现成测试时直接验证实际页面 |
| 更新日志或多语言内容 | `test:changelog`、`test:ui:changelog`；构建 | 非日志页面翻译另查实际页面，日志测试不覆盖全部词典 |
| 身份链路 | `test:identity`、`test:ui:identity`，服务端接入变化加 `test:network:guards`；构建 | 修改 SSO 流程时使用隔离身份环境走真实登录及游客降级 |
| 统计采集、存储或榜单 | `test:statistics`、`test:network:guards`，页面变化加 `test:ui:statistics`；构建 | 去重、跨版本隔离、热更新同桶、旧记录恢复、公开字段及一次性上报 |
| 发布流程与版本 | `test:release`、`test:changelog`；涉及测试隔离加 `test:ui:staging`、`test:online:components` | 检查择取来源、额外改动拒绝、发版/热更新差异；CI 与服务器配置需另行实际验证 |
| 发布候选 | `test:all`、目标基路径构建、受影响页面回归 | [运维门禁](operations.md)及上线后实测 |

表中缩写均使用 `npm run <命令>`。日常通过针对性验证即可交付；共享入口大改、影响范围无法可靠界定时扩大到 `test:all`。

## 测试环境与运行边界

- 从仓库根目录运行，依赖安装见[开发约定](development.md)。浏览器层需要 Playwright Chromium；缺少时运行 `npx playwright install chromium`。仅运行逻辑层无需安装浏览器。
- 浏览器脚本通常自建回环地址 Vite 服务，并对部分接口使用夹具。Vite 仍含本地 API/WS 代理，所以不要把整套测试描述为完全离线或绝无外部访问。
- `test:ui:interaction` 读取 `HARUHI_PREVIEW_URL`，会操作目标页面。普通本地回归保持该变量未设置；只有测试目标明确且已授权时才覆盖。
- `test:network:guards` 自启本地服务并使用临时统计目录；`test:statistics` 使用临时存储和构造记录。它们不会证明真实身份数据库迁移或线上持久目录权限正确。
- 本地服务测试继承部分进程环境，不要从加载生产凭据的 shell 启动测试。清理仅限本次启动的进程和临时目录。
- `test:online:state` 包含7.5Hz观战短特效删除补帧与寿命边界；`test:ui:webgl` 按效果关闭前后的像素差检查观战双方扫线、非选中舰航线和共享技能表现，覆盖 WebGL2、WebGL1 与 Canvas2D。
- WebGL 用像素、绘制调用、回退和帧耗时检查；记录运行环境，不把某台机器上的相对性能通过当作所有 GPU 的帧率保证。

独立容量测试默认自启本地服务：

```bash
env -u NETWORK_WS_URL npm run test:network:load
```

可用 `NETWORK_ROOMS`、`NETWORK_SPECTATORS_PER_ROOM`、`NETWORK_DURATION_SECONDS` 调整负载；`NETWORK_WS_URL` 会把流量送到指定服务，只有在目标及压测影响已经授权时使用。容量压测和 `test:ai:shamisen` 专项平衡模拟均不在 `test:all` 中。

## 测试质量与失败处理

- 断言可观察行为和边界：例如同动作逐 tick 一致、非法输入被拒绝、统计不进入快照、游客失败回退可用。避免只断言源码含某段实现文字；现有源码守卫只证明它明确检查的结构。
- 修复缺陷时保留最小复现；新增逻辑覆盖正常与关键失败/边界输入。固定种子和临时夹具使失败可复现，避免仅用等待时长猜测页面就绪。
- 区分代码回归、原有失败与环境缺失。保存失败命令和首个有用错误；修复本次问题后重跑相关项，不无限重试掩盖不稳定性。
- 业务契约确实改变时同步更新实现与预期并解释原因；不能只删断言、提高超时、放宽性能阈值或重刷基准使测试变绿。
- 浏览器自动化、人工视觉检查、真实多客户端/账号及上线验收分别记录。夹具通过不代替真实链路证据。

交付记录通常只需“检查命令与结果、额外场景、未覆盖项及原因”。发布或性能问题再附提交、基路径、环境和产物证据，无需为每次小改动创建永久报告文件。
