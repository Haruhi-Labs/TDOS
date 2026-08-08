# 项目架构与模块边界

本文是修改代码时的定位入口。目标是让规则、表现、联机传输和页面编排各自只承担一种职责，并在不破坏旧导入路径的前提下逐步缩小修改范围。

## 总体依赖方向

```text
页面编排（solo.js / online.js / server.js）
  ├─ 领域入口（game-core.js / i18n.js / character-select.js / battle/render.js）
  │    └─ 单一职责模块（shared/game/*、src/i18n/*、src/character-select/*、src/battle/render/*）
  └─ 基础设施（shared/protocol/*、battle/action-transport.js、online/*、network-patch.js、server/*）
```

依赖只能从上向下。单一职责模块不得反向导入总入口或页面编排器；`npm run check:modules` 会检查相对导入断链、已拆边界的反向依赖和源码循环依赖。

## 权威模型与跨模式同步

项目只维护一套战斗领域规则，但单人和多人把权威模拟放在不同进程：

```text
单人输入 ─→ 标准动作 ─→ 本地传输适配器 ─→ MatchSimulation（浏览器权威）─→ 30Hz 逻辑帧 ─┐
多人输入 ─→ 标准动作 ─→ WebSocket ─→ 输入队列 ─→ MatchSimulation（服务端权威）
                                                    │
                                                    └─ 15Hz 快照 ─────────────┴─→ 共享插值显示
```

- 角色数值、技能、AI、视野、碰撞、推进和能量规则只定义在 `shared/game/` 与 `shared/game-core.js`。
- 两条执行链都调用 `shared/game/action-dispatcher.js`，动作名称与载荷来自 `shared/protocol/match-actions.js`。
- 单人和服务端共用 `shared/game/fixed-step-clock.js`，以固定 30Hz 推进逻辑；联机客户端不自行推进权威战斗状态。
- `src/battle/state-interpolation.js` 只在相邻权威状态之间生成显示副本；单人教程、技能、AI 与联机输入确认均不读取或写回这个显示副本。
- `scripts/verify-authority-parity.mjs` 会把同一组动作分别经本地直连和服务端输入队列回放，并逐 tick 比较序列化状态。

因此，规则或角色行为通常只修改一次；需要分别维护的是本地/远程传输和联机显示策略，而不是两套战斗权威。

## 协议版本约定

网络链路有两个不同层次的版本：

- `NETWORK_PROTOCOL_VERSION` 位于 `server/config.js`，描述快照确认、差量等网络能力。
- `RULESET_VERSION` 位于 `shared/protocol/ruleset-version.js`，描述会影响对局结果的规则语义。

客户端收到 `connected` 后会回送 `protocol_hello`。双方显式声明的规则版本不一致时，服务端阻止开房、加入、观战和战斗输入，客户端同步禁用相关控件。当前仍允许未声明规则版本的旧端进入兼容模式，用于滚动迁移；兼容模式不是版本相同的证明。

修改角色数值、技能效果、碰撞、能量、AI 权威行为或其他会改变结算结果的规则时，应同步递增 `RULESET_VERSION` 并运行 `npm run test:ruleset`。仅修改视觉、文案或不改变规则语义的网络优化时不需要递增。

## 模块职责

### 共享战斗内核

- `shared/game-core.js`：兼容入口与战斗模拟编排。旧调用方可以继续从这里导入稳定 API。
- `shared/game/constants.js`：世界尺寸、逻辑帧率和快照频率等跨端基础常量。
- `shared/game/fixed-step-clock.js`：单人和服务端共用的固定逻辑步长、暂停与追帧上限。
- `shared/game/throttle.js`：推进档位、档位归一化以及推进与能量收支的关系。
- `shared/game/combat-rules.js`：火力方向、侦察消耗、急刹消耗和雷达转速等独立规则。
- `shared/game/characters.js`：角色静态数据、默认阵容和技能元数据。
- `shared/game/math.js`：无业务状态的几何与数值工具。
- `shared/game/bot-controller.js`：AI 决策、能量管理和各难度行为参数。
- `shared/game/visibility-radar.js`：统一汇总常规探测、视野波覆盖与长门雷达信息，并负责长门回波生成和私有序列化。
- `shared/game/vision-wave.js`：朝仓主舰视野波的发射节拍、环带覆盖判定、失效清理与公共状态序列化。
- `shared/game/targeting-system.js`：开火候选、最近目标和极限难度集火分配。
- `shared/game/action-dispatcher.js`：将客户端或 AI 的标准动作映射到舰队领域方法。
- `shared/game/collision-system.js`：舰船碰撞、侦察机相撞和刀锋女王接触结算。

只有需要协调多种规则、修改实时战斗状态的逻辑才留在 `game-core.js`。新增纯数据、纯计算或 AI 策略时，应直接放入对应叶模块，再由兼容入口按需导出。

### 战斗界面

- `src/battle/camera.js`、`input.js`、`throttle.js`、`hud.js`、`template.js`：分别负责相机、命中与航线输入、推进控件、战斗 HUD 和公共 DOM 骨架。
- `src/battle/render.js`：单人、联机和观战共用的 Canvas 战场渲染入口。
- `src/battle/state-interpolation.js`：单人逻辑帧与联机快照共用的纯显示插值，统一处理舰船、侦察机、僚机、弹体、光束和视觉效果。
- `src/battle/render/radar.js`：长门雷达的扫线、远近回波和移动端小地图雷达表现。
- `src/battle/render/vision-wave.js`：朝仓视野波在主战场与小地图上的轻量波带表现；双方都能看到波纹，但只有施放方获得波带覆盖区域的真实视野。
- `src/solo.js`、`src/online.js`：只编排各模式生命周期、输入和数据来源，不复制公共战场表现。

### 联机链路

- `src/online/state-sync.js`：客户端快照时间轴采样、有限外推、本地航线覆盖和显示稳定；具体状态插值复用战斗界面的纯插值模块，不读 DOM，也不管理 WebSocket。
- `src/online/snapshot-transport.js`：延迟与时钟估计、快照差量解码、确认、排序和历史队列。
- `src/online/connection-target.js`：同源代理、直连和本地备用 WebSocket 地址策略。
- `src/online/lobby-view.js`、`profile-controller.js`、`result-view.js`：大厅、玩家档案和结算界面职责。
- `shared/network-patch.js`：服务端与客户端共用的快照差量格式。
- `shared/protocol/match-actions.js`：单人和多人共用的战斗动作名称、构造器与静态载荷校验。
- `shared/protocol/ruleset-version.js`：客户端与服务端共享的规则版本、握手兼容判定与对局门禁依据。
- `src/battle/action-transport.js`：同一动作协议的本地权威与远程权威传输适配器。
- `server/config.js`：环境变量、容量和拥塞阈值。
- `server/protocol.js`：控制消息类型与错误码归类。
- `server/snapshot-stream.js`：快照发送、关键帧/差量选择、缓冲保护和单连接流控。
- `server/room-registry.js`：玩家与房间注册表、A/B 席位、观战集合和大厅/房间状态序列化。
- `server/room-lifecycle.js`：创建、加入、离开、关闭房间的生命周期与容量门禁。
- `server/input-queue.js`：客户端输入顺序、连续操作合并、队列上限和逐帧消费。
- `server/match-runtime.js`：倒计时切换、权威逻辑帧、快照节拍、结算、结算后 10 秒强制回收房间和追帧保护。
- `server/server.js`：WebSocket 连接、消息路由和权威模拟进程编排。

### 内容与素材

- `src/i18n.js`：语言状态、格式化和运行时翻译 API。
- `src/i18n/catalog.js`、`character-text.js`、`messages-ja.js`、`messages-en.js`：只存放并汇总翻译数据。
- `src/changelog.js`：公共更新日志页面编排，只负责按当前语言渲染版本数据。
- `src/changelog/meta.js`：首页与日志页共用的轻量当前版本元数据，避免首页提前载入完整更新正文。
- `src/changelog/entries.js`：更新日志的版本、分组和三语内容；新增版本时不修改页面结构。
- `src/character-select.js`：角色选择交互与页面编排。
- `src/character-select/portraits.js`：立绘加载、缓存、阵营着色和占位绘制。

## 修改定位表

| 要修改的内容 | 首选文件 | 通常需要联查 |
| --- | --- | --- |
| 推进档位、速度与能量 | `shared/game/throttle.js` | `src/battle/throttle.js`、核心测试 |
| 角色数值或技能描述元数据 | `shared/game/characters.js` | `src/i18n/character-text.js` |
| 技能实际生效过程 | `shared/game-core.js` | 对应 `shared/game/*` 叶模块、核心测试 |
| 朝仓主舰视野波规则 | `shared/game/vision-wave.js` | `shared/game/visibility-radar.js`、`shared/game-core.js`、核心测试 |
| AI 决策和能量策略 | `shared/game/bot-controller.js` | `shared/game/characters.js` |
| 通用战场视觉 | `src/battle/render.js` | 单人、联机、观战界面回归 |
| 长门雷达视觉 | `src/battle/render/radar.js` | 雷达状态生成逻辑 |
| 朝仓视野波视觉 | `src/battle/render/vision-wave.js` | 视野波规则与单人/联机/观战回归 |
| 单人/联机画面抖动与状态插值 | `src/battle/state-interpolation.js` | `src/solo.js`、`src/online/state-sync.js`、`scripts/verify-online-state-sync.mjs` |
| 联机快照时间轴、外推和预测 | `src/online/state-sync.js` | `src/online/snapshot-transport.js`、`scripts/verify-online-state-sync.mjs` |
| 新增或修改战斗动作 | `shared/protocol/match-actions.js` | `shared/game/action-dispatcher.js`、本地/远程传输测试 |
| 规则版本与兼容门禁 | `shared/protocol/ruleset-version.js` | `src/online/snapshot-transport.js`、`server/server.js` |
| 房间模型与席位 | `server/room-registry.js` | `scripts/verify-server-rooms.mjs` |
| 入房、退房和容量门禁 | `server/room-lifecycle.js` | 协议与网络保护测试 |
| 输入积压、合并与确认 | `server/input-queue.js` | `scripts/verify-server-runtime.mjs` |
| 服务端逻辑帧与快照节拍 | `server/match-runtime.js` | 运行时与网络保护测试 |
| 快照带宽和拥塞保护 | `server/snapshot-stream.js`、`server/config.js` | `shared/network-patch.js` |
| 日英翻译文本 | `src/i18n/messages-ja.js`、`messages-en.js` | `src/i18n/catalog.js` |
| 版本号与公共更新日志 | `src/changelog/meta.js`、`entries.js` | `src/changelog.js`、`src/menu.js`、`scripts/verify-changelog.mjs` |
| 角色立绘与阵营颜色 | `src/character-select/portraits.js` | 角色选择与地图侧边立绘 |

## 改动前后的最低验证

1. 运行 `npm run check:modules`，避免边界回退和循环依赖。
2. 运行 `npm run test:api`，避免稳定入口在拆分中意外丢失导出。
3. 新增或修改动作时运行 `npm run test:actions`。
4. 改动权威规则并递增规则版本时运行 `npm run test:ruleset`。
5. 规则或 AI 改动运行 `npm run test:core`。
6. 涉及动作、时钟或服务端执行链时运行 `npm run test:authority`，验证相同动作回放逐 tick 一致。
7. 联机显示改动运行 `npm run test:online:state` 与 `npm run test:online:components`。
8. 协议、服务端或快照改动运行 `npm run test:network`、`npm run test:server:rooms`、`npm run test:server:runtime` 与 `npm run test:network:guards`。
9. 所有改动最终运行 `npm run build`，并对受影响的路由做浏览器回归。

`npm run test:all` 汇总了以上自动化检查；发布前优先执行它。

核心测试已按领域拆到 `scripts/core-tests/`。推进、技能和战斗规则可单独运行
`npm run test:core:rules`，AI 可运行 `npm run test:core:ai`，教程可运行
`npm run test:core:tutorial`；`npm run test:core` 仍按原顺序聚合全部领域。

`npm run test:network:load` 是独立容量压测，不包含在 `test:all` 中。涉及快照频率、拥塞降档、连接或房间容量时，应在隔离环境另行运行，避免把压测流量施加到正式服务。
