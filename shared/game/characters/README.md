# 角色实现导航

每个角色的 `extension.js` 声明主动技能、规则能力、实体钩子、队级/对局工厂和投影。角色实现与声明放在同一目录，AI 对该角色的使用策略另在 [`../ai/policy/characters/`](../ai/policy/characters/)，客户端美术与绘制在 `src/`。

| 目录或文件 | 内容 |
| --- | --- |
| [`catalog.js`](catalog.js) | 共享只读角色数值、技能元数据、阵容配置 |
| [`assembly/`](assembly/) | `registry.js` 保持构造顺序；`extension-contract.js` 编译钩子、阶段和技能并拒绝冲突；`character-assembly.js` 统一装配 |
| [`abilities/`](abilities/) | 跨角色能力组合、实体事实采样、纯属性/控制/承伤求值；采样与求值分别放在 `attribute-facts.js` 和 `attribute-evaluation.js` |
| [`interactions/`](interactions/) | 跨角色接触、航空生成、策反、弹体拦截和死亡事务；保留同步副作用顺序 |
| [`haruhi/`](haruhi/) | 强化状态、支援调度、勇者之力；兔女郎复用这里的支援调度能力 |
| [`bunny-haruhi/`](bunny-haruhi/) | 独立配置、纯规则、形态/舞台状态机及对应端口、伴随舰、支援、投影 |
| [`koizumi/`](koizumi/) | 能量圈、光球、撞击波及扩展声明 |
| [`shamisen/`](shamisen/) | 猎杀、抓痕及扩展声明 |
| [`asakura/`](asakura/) | 视野波、净化阶段适配及扩展声明 |
| [`future1096/`](future1096/) | 形态状态机、实体端口及扩展声明 |
| [`tsuruya/`](tsuruya/) | 赞助状态机、实体端口及扩展声明；战区策反事务在 `interactions/` |
| [`yuki/`](yuki/) | `radar-runtime.js` 持有雷达状态并消费值样本；`radar-port.js` 映射实体与识别结果，`extension.js` 接入生命周期和公私投影 |
| [`kyon/`](kyon/) | 现有能力的角色声明；没有独立实现时不增加空壳模块 |

新增角色通常增加角色目录并登记 `assembly/registry.js`，同时补齐角色数值、表现、AI 档案和行为测试。需要已有通用能力时消费现有端口；确实增加通用机制才扩展 `systems/` 和对应适配器，不能在 `Ship` 或 `Team` 增加角色专属字段与分支。

这里只统一文件归属，不宣称所有角色实现都是纯函数。角色端口与交互事务需要实体引用；纯状态机及事实求值器通过明确输入运行。`rules/` 中仅放跨角色通用规则，角色特有规则留在所属角色目录。

## 效果的接入与消费

普通定时增益在声明中填写 `positiveTimedEffects: ["效果截止时间字段"]`，施放时调用现有 `activateEffect`；通用净化组会调用 ShipStatus 的清理操作，并保留同帧保护。复合形态、叠层、来源关系和跨实体事务仍使用专属状态所有者，不强行塞入定时键值表。新字段可以按首次激活创建；ShipStatus 的旧默认键用于保留既有初始读模型，不需要为新效果扩充该默认表。

普通定时属性用 `timedAttributes: [[顺序, { until: "截止字段", multipliers: { damage: 1.25 } }]]` 声明。装配只编译数值表，纯求值器在原定时增益阶段依序消费，再计算形态及队级强化；不加入任意回调链。时间状态仍由 ShipStatus 持有，净化使用 `positiveTimedEffects`，不复制截止时刻。新计算类型仍需明确扩展纯求值契约。

`statusEffects: [[顺序, (ship, { add, timed }) => { … }]]` 只读取权威状态：`add` 描述常驻或明确截止的状态，`timed` 保留既有持续时间算法。元数据在 `projection/status-effect-definitions.js`，翻译与图标属于表现接入。公共投影器不再增加角色判断；复杂投影放在角色已有的 `projection.js`，简单的直接写在声明中。顺序沿用原状态卡排列，新声明不能占用相同顺序。

| 钩子语义 | 消费方式 | 示例 |
| --- | --- | --- |
| 广播生命周期 | 每个处理者都执行；需要返回是否发生变更时，执行完再合并 | 初始化、控制/负面/正面清理、命中通知 |
| 资格查询 | 任意命中即可结束，无副作用 | `hasNegative` |
| 独占处理 | 首个非 null/undefined 结果结束；false 表示已处理但失败，不表示继续找下一个 | `castExclusiveSubSkill`、`advanceMovement` |
| 顺序计算 | 上一结果传给下一处理者 | `prepareShotDamage` |

不要用“第一个成功就停”的消费方式执行净化广播，也不要为了统一接口让查询带上提交状态的能力。现有插入点不够时先明确领域语义，再增加窄契约；无需为每个角色建立空的状态机、端口和投影文件。
