# 战斗代码导航

这里是浏览器单人和服务端联机共用的权威战斗实现。公共兼容导出在 [`../game-core.js`](../game-core.js)；内部直接导入负责该能力的模块，不通过总入口绕行。网络协议在 [`../protocol/`](../protocol/)，显示与交互在 [`../../src/battle/`](../../src/battle/)。

## 按职责找目录

| 目录 | 职责与入口 | 不应放入 |
| --- | --- | --- |
| [`foundation/`](foundation/) | 数学、随机源、时钟常量 | 角色判断、领域事务 |
| [`rules/`](rules/) | 通用战斗数值、伤害分类、油门与接触几何 | 实体读写、具体角色生命周期 |
| [`systems/`](systems/) | 导航、武器、编队、感知等通用算法及私有状态组件 | 角色装配、具体角色判断 |
| [`model/`](model/) | `Ship`、`Team`、弹体、飞行器等实体，资源与归属操作 | 专属角色状态存储 |
| [`characters/`](characters/) | 按角色聚合技能、状态机、适配器与扩展声明；跨角色能力和事务另分目录 | 通用组件实现、AI 决策 |
| [`adapters/`](adapters/) | 实体到通用组件的事实与命令端口；选敌及视野输入适配 | 第二份权威状态、纯规则公式 |
| [`runtime/`](runtime/) | `match-simulation.js` 独占逻辑时钟；`battle-runtime.js` 消费时间并推进世界，`battle-mode.js` 选择配置与胜负规则，另含追帧、动作、计数与反馈 | 具体角色公式、客户端绘制 |
| [`projection/`](projection/) | 舰船、舰队、状态效果的只读输出 | 推进、扣费或伤害结算 |
| [`ai/`](ai/) | 观测桥、动作端口、参数与策略 | 权威角色状态的所有权 |

目录表示职责分区，不表示所有调用都沿一条继承式层级。`Team` 负责装配组件和协调领域操作，角色端口可以持实体引用；通用组件通过注入端口消费。`check:modules` 约束基础工具、通用规则、组件及 AI 的依赖边界，并拒绝把新模块散放回战斗根目录。

## 按任务找入口

- **新增角色**：先看 [`characters/README.md`](characters/README.md)，从相近角色的 `extension.js` 及实现开始；数值目录为 `characters/catalog.js`。
- **修改移动、开火、编队或伤害**：先找 `systems/` 对应能力，再沿 `adapters/` 看事实来源和提交出口；资源落值在 `model/ship.js`。
- **修改同帧顺序**：从 `runtime/match-simulation.js` 看取时入口、`runtime/battle-runtime.js` 看通用阶段，再看 `characters/assembly/extension-contract.js` 与各角色声明；跨角色事务在 `characters/interactions/`。
- **修改 AI**：先看 [AI 代码导航](ai/README.md)，从 `ai/bridge/observation.js` 看输入，从 `ai/policy/rule-policy.js` 看调度，从 `ai/bridge/action-port.js` 看命令消费。
- **修改快照或状态栏**：从 `projection/` 进入；显示层在 `src/battle/`，不得回写权威状态。

文件名中的 `*-runtime.js` 表示生命周期/私有状态，`*-port.js` 表示实体适配，`extension.js` 表示装配声明；模块实际依赖仍以源码为准。不要为旧内部路径增加逐文件转发壳。移动文件时同步源码、测试、动态加载路径和当前文档；读取旧 Git 版本的离线脚本保留明确的历史路径处理。

调用关系、状态所有者和同帧顺序见[架构地图](../../docs/architecture-map.md)，全部模块见[自动生成的索引](../../docs/architecture-module-index.md)，验收选择见[测试文档](../../docs/testing.md)。
