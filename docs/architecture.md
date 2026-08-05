# 项目架构与模块边界

本文是修改代码时的定位入口。目标是让规则、表现、联机传输和页面编排各自只承担一种职责，并在不破坏旧导入路径的前提下逐步缩小修改范围。

## 总体依赖方向

```text
页面编排（solo.js / online.js / server.js）
  ├─ 领域入口（game-core.js / i18n.js / character-select.js / battle/render.js）
  │    └─ 单一职责模块（shared/game/*、src/i18n/*、src/character-select/*、src/battle/render/*）
  └─ 基础设施（online/state-sync.js、network-patch.js、server/config|protocol|snapshot-stream.js）
```

依赖只能从上向下。单一职责模块不得反向导入总入口或页面编排器；`npm run check:modules` 会检查相对导入断链、已拆边界的反向依赖和源码循环依赖。

## 模块职责

### 共享战斗内核

- `shared/game-core.js`：兼容入口与战斗模拟编排。旧调用方可以继续从这里导入稳定 API。
- `shared/game/constants.js`：世界尺寸、逻辑帧率和快照频率等跨端基础常量。
- `shared/game/throttle.js`：推进档位、档位归一化以及推进与能量收支的关系。
- `shared/game/combat-rules.js`：火力方向、侦察消耗、急刹消耗和雷达转速等独立规则。
- `shared/game/characters.js`：角色静态数据、默认阵容和技能元数据。
- `shared/game/math.js`：无业务状态的几何与数值工具。
- `shared/game/bot-controller.js`：AI 决策、能量管理和各难度行为参数。
- `shared/game/visibility-radar.js`：真实视野、长门雷达扫描、回波生成与私有序列化。
- `shared/game/targeting-system.js`：开火候选、最近目标和极限难度集火分配。
- `shared/game/action-dispatcher.js`：将客户端或 AI 的标准动作映射到舰队领域方法。
- `shared/game/collision-system.js`：舰船碰撞、侦察机相撞和刀锋女王接触结算。

只有需要协调多种规则、修改实时战斗状态的逻辑才留在 `game-core.js`。新增纯数据、纯计算或 AI 策略时，应直接放入对应叶模块，再由兼容入口按需导出。

### 战斗界面

- `src/battle/camera.js`、`input.js`、`throttle.js`、`hud.js`、`template.js`：分别负责相机、命中与航线输入、推进控件、战斗 HUD 和公共 DOM 骨架。
- `src/battle/render.js`：单人、联机和观战共用的 Canvas 战场渲染入口。
- `src/battle/render/radar.js`：长门雷达的扫线、远近回波和移动端小地图雷达表现。
- `src/solo.js`、`src/online.js`：只编排各模式生命周期、输入和数据来源，不复制公共战场表现。

### 联机链路

- `src/online/state-sync.js`：客户端快照插值、有限外推、本地航线覆盖和额外舰船同步；不读 DOM，也不管理 WebSocket。
- `src/online/snapshot-transport.js`：延迟与时钟估计、快照差量解码、确认、排序和历史队列。
- `src/online/connection-target.js`：同源代理、直连和本地备用 WebSocket 地址策略。
- `src/online/lobby-view.js`、`profile-controller.js`、`result-view.js`：大厅、玩家档案和结算界面职责。
- `shared/network-patch.js`：服务端与客户端共用的快照差量格式。
- `shared/protocol/match-actions.js`：单人和多人共用的战斗动作名称、构造器与静态载荷校验。
- `src/battle/action-transport.js`：同一动作协议的本地权威与远程权威传输适配器。
- `server/config.js`：环境变量、容量和拥塞阈值。
- `server/protocol.js`：控制消息类型与错误码归类。
- `server/snapshot-stream.js`：快照发送、关键帧/差量选择、缓冲保护和单连接流控。
- `server/room-registry.js`：玩家与房间注册表、A/B 席位、观战集合和大厅/房间状态序列化。
- `server/room-lifecycle.js`：创建、加入、离开、关闭房间的生命周期与容量门禁。
- `server/input-queue.js`：客户端输入顺序、连续操作合并、队列上限和逐帧消费。
- `server/match-runtime.js`：倒计时切换、权威逻辑帧、快照节拍、结算和追帧保护。
- `server/server.js`：WebSocket 连接、消息路由和权威模拟进程编排。

### 内容与素材

- `src/i18n.js`：语言状态、格式化和运行时翻译 API。
- `src/i18n/catalog.js`、`character-text.js`、`messages-ja.js`、`messages-en.js`：只存放并汇总翻译数据。
- `src/character-select.js`：角色选择交互与页面编排。
- `src/character-select/portraits.js`：立绘加载、缓存、阵营着色和占位绘制。

## 修改定位表

| 要修改的内容 | 首选文件 | 通常需要联查 |
| --- | --- | --- |
| 推进档位、速度与能量 | `shared/game/throttle.js` | `src/battle/throttle.js`、核心测试 |
| 角色数值或技能描述元数据 | `shared/game/characters.js` | `src/i18n/character-text.js` |
| 技能实际生效过程 | `shared/game-core.js` | `shared/game/combat-rules.js`、核心测试 |
| AI 决策和能量策略 | `shared/game/bot-controller.js` | `shared/game/characters.js` |
| 通用战场视觉 | `src/battle/render.js` | 单人、联机、观战界面回归 |
| 长门雷达视觉 | `src/battle/render/radar.js` | 雷达状态生成逻辑 |
| 联机画面抖动、插值和预测 | `src/online/state-sync.js` | `scripts/verify-online-state-sync.mjs` |
| 房间模型与席位 | `server/room-registry.js` | `scripts/verify-server-rooms.mjs` |
| 入房、退房和容量门禁 | `server/room-lifecycle.js` | 协议与网络保护测试 |
| 输入积压、合并与确认 | `server/input-queue.js` | `scripts/verify-server-runtime.mjs` |
| 服务端逻辑帧与快照节拍 | `server/match-runtime.js` | 运行时与网络保护测试 |
| 快照带宽和拥塞保护 | `server/snapshot-stream.js`、`server/config.js` | `shared/network-patch.js` |
| 日英翻译文本 | `src/i18n/messages-ja.js`、`messages-en.js` | `src/i18n/catalog.js` |
| 角色立绘与阵营颜色 | `src/character-select/portraits.js` | 角色选择与地图侧边立绘 |

## 改动前后的最低验证

1. 运行 `npm run check:modules`，避免边界回退和循环依赖。
2. 运行 `npm run test:api`，避免稳定入口在拆分中意外丢失导出。
3. 规则或 AI 改动运行 `npm run test:core`。
4. 联机显示改动运行 `npm run test:online:state` 与 `npm run test:online:components`。
5. 协议、服务端或快照改动运行 `npm run test:network` 与 `npm run test:network:guards`。
6. 所有改动最终运行 `npm run build`，并对受影响的路由做浏览器回归。

`npm run test:all` 汇总了以上自动化检查；发布前优先执行它。

核心测试已按领域拆到 `scripts/core-tests/`。推进、技能和战斗规则可单独运行
`npm run test:core:rules`，AI 可运行 `npm run test:core:ai`，教程可运行
`npm run test:core:tutorial`；`npm run test:core` 仍按原顺序聚合全部领域。
