# AI 代码导航

AI 读取观测和记忆，通过动作端口提交意图。角色规则实现位于 [`../characters/`](../characters/)，这里的角色档案只决定 AI 如何使用能力。

| 位置 | 职责 | 常见修改 |
| --- | --- | --- |
| [`bridge/`](bridge/) | 权威实体转观测、动作校验适配、每席启动 | 新增可观测事实或合法动作 |
| [`params/`](params/) | 参数、难度、预设及覆盖校验 | 调整决策参数 |
| [`policy/rule-policy.js`](policy/rule-policy.js) | 固定决策顺序，提交模式和计划 | 调整阶段协调、动作后重读 |
| [`policy/policy-program.js`](policy/policy-program.js)、[`policy/policy-inputs.js`](policy/policy-inputs.js) | 逐方法依赖与执行权限装配 | 为算法增加所需事实或命令 |
| [`policy/fact-calculations.js`](policy/fact-calculations.js) | 按需采样事实，再调用独立计算 | 新算法的输入组装 |
| [`policy/algorithms/`](policy/algorithms/) | 几何、估值、模式候选 | 用普通数据测试和修改算法 |
| [`policy/state/`](policy/state/) | 情报、概率、搜索意图、技能时钟及历史 | 调整记忆推进与消费规则 |
| [`policy/heuristics/`](policy/heuristics/) | 战术上下文、能量、分离、目标、移动、侦察、技能 | 修改某一决策阶段 |
| [`policy/characters/`](policy/characters/) | 每角色的 AI 使用档案与施放判断 | 新角色或技能时机 |
| [`policy/tactics/`](policy/tactics/) | 角色对抗、舞台、猎杀及侦察条令 | 跨阶段协同战术 |
| [`policy/commands.js`](policy/commands.js) | 把执行请求提交动作端口 | 调整 AI 命令适配 |
| [`policy/observation-view.js`](policy/observation-view.js)、[`policy/view.js`](policy/view.js)、[`policy/debug-state.js`](policy/debug-state.js) | 只读索引、基础查询及调试投影 | 观测检索或诊断输出 |
| [`bot-controller.js`](bot-controller.js) | 对外受校验门面 | 外部调试调用；不能开放实体输入 |

启发式不等于纯函数：部分入口持有明确的命令能力并执行动作；权限由 `policy-inputs.js` 和 `policy-program.js` 限定。`algorithms/` 才是独立事实计算，它不得导入状态组件、协调器、启发式或桥接层。侦察条令虽位于 `tactics/`，仍由其自身持有部署时钟与缓存，不由其他模块代写。

新增查询先确定观测是否有权提供该信息，再按需声明输入；新增执行阶段保持“判断 → 提交 → 新观测”的原顺序。不要把即时消费改成统一帧末批处理。数值检索可运行 `node scripts/ai/list-literals.mjs`，它会递归扫描各子目录。
