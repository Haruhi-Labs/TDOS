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
