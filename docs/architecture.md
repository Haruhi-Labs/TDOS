# 项目架构与模块边界

本文是修改代码时的定位入口。目标是让规则、表现、联机传输和页面编排各自只承担一种职责，并在不破坏旧导入路径的前提下逐步缩小修改范围。

模块级图、真实状态所有者、单帧顺序与残留边界见 [详细架构地图](architecture-map.md)；静态文件定位见 [模块索引](architecture-module-index.md)。地图注明源码基线，不把静态导入图等同于运行期耦合。

## 总体依赖方向

```text
页面编排（solo.js / online.js / server.js）
  ├─ 领域入口（game-core.js / i18n.js / character-select.js / battle/render.js）
  │    └─ 单一职责模块（shared/game/*、src/i18n/*、src/character-select/*、src/battle/render/*、src/battle/webgl/*）
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

- 角色数值、技能、AI、视野、碰撞、推进和能量规则只定义在 `shared/game/`；`shared/game-core.js` 仅保留稳定兼容导出。
- 两条执行链都调用 `shared/game/action-dispatcher.js`，动作名称与载荷来自 `shared/protocol/match-actions.js`。
- 单人和服务端共用 `shared/game/fixed-step-clock.js`，以固定 30Hz 推进逻辑；联机客户端不自行推进权威战斗状态。
- `src/battle/state-interpolation.js` 只在相邻权威状态之间生成显示副本；单人教程、技能、AI 与联机输入确认均不读取或写回这个显示副本。
- `scripts/verify-authority-parity.mjs` 会把同一组动作分别经本地直连和服务端输入队列回放，并逐 tick 比较序列化状态。

因此，规则或角色行为通常只修改一次；需要分别维护的是本地/远程传输和联机显示策略，而不是两套战斗权威。

## 状态所有权与消费时机

实体负责资源、位移、推进、控制及退场操作；角色组件负责自己的形态、支援和资格记录。跨域效果通过实体操作提交，伴随舰转移同时更新原舰队和目标舰队，弹体来源清理交给对局集合所有者。专属状态机不需要改造成统一配置引擎。

舰船导航由 `ShipNavigation` 持有目标点、航线与击退状态，完成曲率约束、普通推进和编队跟随。导航端口只提供只读运动参数与转向飞行、编队靠拢、击退采样操作，不开放位置、航向、速度或油门的属性写权限。导航计算意图，Ship 统一提交物理积分、边界约束及击退完成后的碰撞减速清理；不暴露舰队、对局或生命资源。实体保留导航命令门面，路线与击退读数是独立只读数据；替换输入必须复制，不能通过持有旧路线引用修改当前导航。

射击周期由 `WeaponCycle` 持有，瞄准仅消费目标读数、随机流和发射端口。承伤由 `resolveHullDamage` 编排增幅、份额投递、自身扣血和死亡步骤；份额目标只有投递权限，不能改目标资源。Ship 只提交自身生命与退场状态。分摊副作用仍即时影响后续承伤，瞄准随机数仍先于射界拒绝消费。

编队由 `FleetFormation` 持有分离层级，负责成员归属、共享速度/能量、比例扣费及死亡后的分离顺序。成员句柄仅开放读取、扣能与设置航线；编队组件不能取得完整实体。普通动作走 `split`，训练与场景装配通过 `configureFormation` 显式配置层级，读出的 `splitLevel` 不可覆写。

兔女郎舞台样本及持续结算游标由 `bunny-haruhi-runtime.js` 私有持有。对局初始化角色运行时并编排既有阶段，舰队只读取不可变舞台样本；双方圆先采样再提交成员状态。重复初始化不重置游标，重复采样和投影不重复结算持续资源，死亡清理不修改已发布的历史样本。

支援调度按显式来源身份持有私有存储；`readSupportState` 只发布不可变历史快照，不能将快照或普通计划对象作为写入入口。角色变身先在事务私有来源上完成解锁，再与形态一起提交，保持随机消费和发布顺序。追帧发射回调期间读取的快照也不追随同帧后续推进。

伴随舰工厂在 Ship 装配角色能力时注入运行时，生成事务直接发布成员及母舰关系，不经 Team 回调角色运行时。鹤屋战区策反由 `rules/support-conversion.js` 编排侦察机、僚机和伴随舰的转移及视野刷新，Team 仅提供成员归属操作；原角色事务门面及无人调用的闪现/效果转发入口已移除。

角色目录与定义是共享只读配置。舰队创建时取得独立且不可替换的阵容；舰船身份固定，基础机体通过只读视图消费，自定义机体入参必须复制。训练装配由舰体操作替换自己的基础配置，不修改共享角色定义或历史配置。换队、槽位和战斗形态属于运行状态，不能通过改角色身份或阵容字段实现。

界面语言由 `src/character-presentation.js` 投影为只读角色文案和技能元数据，选角、编队、战场技能按钮及观战消费该投影。语言切换只更新界面语言与通知，不再调用原 `applyCoreLocale` 改写共享角色定义；这个旧写入接口已删除。规则数值继续来自共享定义，三种语言下的权威快照应一致。

`rules/character-rules.js` 解释角色状态并提供碰撞资格、承伤、控制、属性、目标偏好和广播能力；通用算法通过注入的契约读取能力，不枚举角色字段。`contact-geometry.js` 只提供共享几何，表现层不导入接触结算实现。

AI 动作端口不暴露真实舰队，也没有接收实体后隐式补算战术的兼容入口。外部策略调用拒绝领域实例，仅读取观测及策略数据；战术描述在观测桥中一次投影。测试的战场布置与观测投影留在测试夹具中，不能让生产策略为了旧测试重新接收实体。

AI 内部的 `IntelTracker` 独占已确认接触和反应延迟队列，入队时复制数据，对外发布不可变记录；`SearchBelief` 独占概率网格，每次显式消费观测和记忆。搜索区域是策略的导航意图，不再混在情报仓库里供不同模块互改。`ScoutDoctrine` 独占部署游标、承诺窗口、重编组时钟和计划缓存，通过动作结果记录成功部署；策略与调试消费者只能读取其快照。`SkillDecisionCycle` 独占技能检查时钟和历史决策；角色档案只接收复制并冻结的事实与战术输入，档案注册表也不可变。技能施放后读取最新冷却，破盾成功返回重规划结果，由策略协调层在同帧重置移动计划；技能组件不能写移动时钟。场景装配通过显式检查计划命令设置下一次检查时间，不恢复计时字段写入口。其余启发式阶段仍共同构成一个决策策略，不能直接访问这些组件的存储。

胜负、战局生命比例、舰损与猎杀候选统一消费 `countsForVictory`；额外舰船的编队归属消费独立的 `isFleetParticipant`。舰队和猎杀模块不直接识别伴随角色。当前规则仍只排除专属伴随舰，旧额外舰船资格不变；参与编队与参与胜负不是同一个概念。

查询与序列化不负责推进：例如抓痕过期在实体更新或下一次命中时提交，界面重复查询只得到已过期的读数。`serializeState()`、AI 观察、房间与结果输出不携带权威状态的可写引用；`shared/data/plain-data.js` 只复制/冻结纯数据，不能用于实体、Map 或循环对象图。

`FleetPerception` 独占可见集合并发布只读采样，历史样本不跟随新帧改变。`targeting-system.js` 的 `FleetFireControl` 持有本轮集火分配，仅消费候选 DTO 并返回目标 ID；`rules/fire-control.js` 负责从领域对象收集资格与映射目标，`Team.stepCombat()` 负责按舰船、僚机、侦察机顺序立即执行攻击。碰撞通过 `rules/collision-port.js` 的只读船体句柄读取实时几何，只能提交位移和碰撞减速；接触历史归对局所有。`rules/active-skills.js` 声明角色效果的操作顺序，舰队装配公共权限和统计端口，编队组件管理资源分摊，施放组件管理冷却和成功事务，角色声明不持有舰队或对局对象。公共和专属副舰技能的成功提交都在 `SkillCycle` 内部完成，角色不能调用 Team 伪造完成；兔女郎返回冷却及视野刷新需求，组件先提交冷却、统计和显形，再刷新视野。

弹体创建由 `MatchSimulation.spawnProjectile` 发布，攻击者负责射击资格与冷却。`systems/projectile-system.js` 只规定拦截先于移动和活集合筛选，`rules/projectile-phase.js` 适配护盾与支援防御；清理死亡弹体并发布集合后才收尾修复护盾。勇者之力由 `rules/hero-power-runtime.js` 持有战斗事件生命周期；`rules/match-feedback.js` 只持有护盾/猎杀表现记录及限频，不能负责伤害、控制或目标重选。死亡规则在 `rules/ship-destruction.js` 同步完成，表现消费不回写规则。

`src/solo/session.js` 独立持有本地模拟、固定步时钟与前后权威帧。单人页面通过标准动作写入、通过冻结快照和即时控制投影读取；每次推进、输入尝试和教程阶段转换使投影失效，未变化的显示帧复用快照。不能只按动作返回成功与否失效，因为失败施放也可能经过扣费与退款。插值输出仍只供显示消费。

服务端输入队列和快照流分别用私有会话保存待处理动作、确认序号、差量基线和拥塞档位。房间生命周期通过重置操作通知它们，连接记录不再携带这些可写字段。快照流消费后冻结共享帧，补帧、协议升级和确认通过显式方法提交；大厅和结算视图只读取独立上下文，结算显示去重由视图持有，胜者变化通过事件回调通知页面。

“分层消费”不意味着统一延迟到帧末。输入校验后立即提交，AI 每次动作后刷新观测，属性变化即时影响后续计算；需要同时采样的双方舞台在固定阶段统一采样后提交。伤害分摊、死亡、支援、碰撞及广播仍保持原顺序。显示只消费快照，统计在完成状态已提交后消费结算。完整范围与验收见[架构重构记录](architecture-refactor.md)。

## 协议版本约定

网络链路有两个不同层次的版本：

- `NETWORK_PROTOCOL_VERSION` 位于 `server/config.js`，描述快照确认、差量等网络能力。
- `RULESET_VERSION` 位于 `shared/protocol/ruleset-version.js`，描述会影响对局结果的规则语义。

客户端收到 `connected` 后会回送 `protocol_hello`。双方显式声明的规则版本不一致时，服务端阻止开房、加入、观战和战斗输入，客户端同步禁用相关控件。当前仍允许未声明规则版本的旧端进入兼容模式，用于滚动迁移；兼容模式不是版本相同的证明。

修改角色数值、技能效果、碰撞、能量、AI 权威行为或其他会改变结算结果的规则时，应同步递增 `RULESET_VERSION` 并运行 `npm run test:ruleset`。仅修改视觉、文案或不改变规则语义的网络优化时不需要递增。

## 模块职责

### 观战界面

- `src/online/spectator-view.js` 与 `spectator.css` 提供独立的观战展板：桌面左右双方舰队夹中央战场，竖屏使用地图下方的双栏舰队。
- 桌面观战以动态视口高度和地图容器尺寸分配一屏空间，矮屏并排显示舰体与能量，收紧卡片间距并保留固定 buff 栏；完整六舰不依赖展板滚动或裁剪。
- 移动观战以动态视口高度分配一屏空间：紧凑六舰行保留角色名、舰位、舰体/能量、技能状态与冷却，形态及异常状态与技能读数合并展示，buff 不显示；双方展板不依赖内部滚动或裁剪。地图以所在网格的容器尺寸取最大正方形，技能详情仍通过顶层点按浮层阅读，粗指针平板也使用紧凑布局。
- 进入房间即从 `room.players` 展示双方昵称与完整阵容；舰体、共享编队能量、角色冷却及异常状态只读取服务端快照。冷却结束不等于可释放，仍需区分未分离、能量不足、封印和沉默；被动技能单独标示。
- 大厅 `combatants` 只包含双方席位、公开昵称和 AI 标记，不携带身份与统计字段；旧服务端未下发时仍可进入观战。
- 双方技能名悬浮、键盘聚焦或点按显示对应主舰/副舰技能效果，复用本地化技能文案；说明浮层进入顶层避开滚动展板裁剪，冷却更新不重置说明，退出或卸载时关闭。
- 观战隐藏射界倍率圈，保留双方视野圈、完整航线与公开长门扫线，隐藏航线终点和曲度拖拽手柄；`radarSweep` 只含扫线几何与采样时刻，私有 `radar.contacts` 仍只发给施放方。短特效在插值区间按显示寿命自然结束，不因后一快照已清理而提前丢失；不保留已命中的弹体，不写回模拟。
- 观战隐藏对战操作台与地图立绘，保留共享战场表现、全图/缩放、放大后的镜头拖动和退出；镜头不跟随房主，Tab 使用原生焦点导航，不发送战斗指令、不更改规则版本。

观战镜头由 `src/battle/director-camera.js` 维护独立的显示中心、目标中心与视野宽度，通过 `src/battle/camera.js` 的观战模式注入共享渲染链。滚轮围绕鼠标锚点连续缩放（1至4倍），拖拽使用指针捕获和阻尼平移，刷新率不同仍按时间响应；相同阻尼同步推进视野宽度与中心，避免缩放锚点漂移和战场越界。退出、失焦和指针取消释放拖拽；减少动态效果偏好使用即时取景。镜头不写入战斗状态，不发送玩家输入，不自动跟随房主舰船。

### 比赛房间

比赛房使用 `mode: "pvp"` 和 `kind: "tournament"`，普通房使用 `kind: "standard"`。创建者是独立主持席，登记在观战集合，不占 A/B 选手席位；房间的 `ownerId` 只在服务端用于权限校验，客户端接收公开 `hostName` 和自身 `self.isHost`。`connected` / `protocol_hello` 通过可选 `roomKinds` 协商能力，未声明比赛能力的旧客户端仍可使用普通房，但不能创建、加入或观战比赛房，避免旧界面缺失就绪和开赛操作。

- 比赛 `waiting` 阶段不建立战斗模拟、不发送快照；选手、主持与观众在游戏页共用双侧阵容展板，中央准备台由 `src/online/tournament-view.js` 和 `tournament.css` 提供。公开比赛从空房开始即可观战，倒计时也允许观众加入。
- 两名选手都加入后仍停留在准备阶段。`set_ready` 只允许本人设置布尔就绪状态，`set_loadout` 的实际阵容变化取消本人就绪；撤回就绪同样阻止开赛。双方状态通过 `room.players[].ready` 广播，客户端不能自行决定开赛。
- 只有 `ownerId` 对应的主持可以 `start_match`，服务端再次检查双方在席且就绪，以及活跃房间和流容量。开赛容量包含两名选手、主持与所有观众；赛前观众不占实时快照流容量。通过后复用现有 3 秒静止倒计时和权威对战入口，倒计时及交战期间锁定选手阵容。
- 等待时选手离开保留另一方原席位，并取消双方就绪，空位可以补人；观众离开不影响房间。主持离开或断连会关闭比赛房并通知所有成员，倒计时或交战中选手离开沿用普通房的解散规则，结算沿用现有自动回收。
- 比赛准备与观战仅展示公开阵容及权威状态，不发送战斗输入。正式开赛后选手切回对战操作台，主持与观众继续导演视角。此功能不改变战斗模拟或结算规则，不递增规则版本。

### 共享战斗内核

急刹功能已移除：不提供按钮、B 键或动作构造器，旧 `emergency_brake` 请求由共享协议拒绝；模拟与快照不再持有对应减速、冷却及制动字段。P 档、正常换挡、转弯与碰撞减速仍沿用推进规则。

选舰属于客户端操作焦点，动作权限由权威舰船的 `canControl` 决定。`src/battle/ship-selection.js` 区分两者：眩晕与冲击波短时禁控时保留当前选舰、镜头跟随和技能上下文，也允许主动选择该舰；移动、换挡、侦察和技能仍按权威状态禁止。联机发送动作前读取最新权威快照，插值中的旧可操作状态不得放行禁控指令或航线预测。击沉、未分离和光球自动归航继续沿用原来的选舰失效处理，单人、联机及双端操作台共用判断。

朝仓副舰「刀锋女王」的倍率、最低档位、接触伤害和结算间隔统一由 `characters.js` 技能元数据提供。航速下限取技能强化后三档满能量航速，忽略低档、能量耗尽、转弯和负面减速；禁控仍拒绝操作与转向，但沿当前朝向继续飞行，刀锋期间击退不替换前飞位移。接触伤害固定为目标最大生命的15%，首次接触立即结算，持续重叠每秒一次；穿舰、刀锋半径扩大25%与破古泉屏障保留。到期或被涤除后恢复普通推进与控制效果，地图边界仍正常约束位置。

古泉副舰的光球在主动飞行及自动归航期间统一免疫控制：眩晕、沉默、击退和勇者震慑不写入控制状态，也不停止飞行。开启形态清除既有控制，保留猫爪与猎杀等非控制标记；归航的输入限制属于自动导航。正常8秒到期进入免伤免控归航，敌方净化则直接解除光球形态并恢复普通推进，不瞬移到中心。

古泉主舰的次数盾在 `shared/game/koizumi-barrier.js` 统一结算：15次拦截（每颗圈外敌弹、每次独立射线各扣1次，第15次仍阻挡），原有特殊冲撞可直接破盾。破盾后只监测敌方子弹穿越原边界，内外双向、高速贯穿和边界随旗舰移动都重新开始5秒计时；己方子弹和未穿越的圈内飞行不延迟修复。权威帧在本帧穿越结算后修复为15次，几何查询与序列化不写回规则状态。剩余次数与修复倒计时进入共享快照，次数采用最新权威值而不做小数插值。

- `shared/game-core.js`：仅提供稳定 API 的兼容导出，不持有或推进状态。
- `shared/game/runtime/match-simulation.js`：权威对局装配、固定阶段推进与结算。
- `shared/game/model/`：舰队和实体的装配、资源、位姿与生命周期入口；通过组件完成导航、编队、施放和航空作业，不得反向导入对局编排。
- `shared/game/systems/`：通用算法及独立组件；只消费基础数据或受限能力端口，不导入实体、角色实现或对局。
- `shared/game/rules/`：角色能力解释和权威适配；真实实体映射留在适配闭包，按权限向组件发布读数和提交操作。
- `shared/game/constants.js`：世界尺寸、逻辑帧率和快照频率等跨端基础常量。
- `shared/game/fixed-step-clock.js`：单人和服务端共用的固定逻辑步长、暂停与追帧上限。
- `shared/game/throttle.js`：推进档位、档位归一化以及推进与能量收支的关系。
- `shared/game/combat-rules.js`：火力方向、侦察消耗和雷达转速等独立规则。
- `shared/game/characters.js`：角色静态数据、默认阵容和技能元数据。
- `shared/game/bunny-haruhi-config.js`、`bunny-haruhi.js`、`bunny-haruhi-companion.js`：独立配置与纯规则；`bunny-haruhi-runtime.js` 协调舞台、变身、资源与公开摘要，`bunny-companion-runtime.js` 通过实体装配时注入的 Ship 工厂接入阿虚实体、独立编队、自动技能、临时策反与来源清理。阿虚排除胜负/玩家舰损/猎杀资格，旧额外舰船资格不变；跨队归还在两队更新前处理。兔女郎春日已进入公开选角目录，旧随机 AI 阵容池仍排除该角色。接口与阶段边界见[兔女郎春日规则](bunny-haruhi-rules.md)。
- `shared/game/haruhi-support.js`：支援状态、有限池抽取、节拍与来源几何；旧 `haruhi-flagship.js` 保持兼容包装。`bunny-haruhi-support.js` 提供显式副舰来源适配，新来源的调度、碰撞、破盾与吸弹只在包含新角色的模拟中执行，不改变旧旗舰身份与停用策略。
- `shared/game/bunny-haruhi-view-params.js` 仅派生展示数值；`src/battle/bunny-haruhi-view.js`、`render/bunny-haruhi.js` 让单人、联机和观战共用权威舰况、技能展示元数据和基础图元。状态/锁档/施放资格采用当前权威帧，显示插值不产生规则事件。原皮占位在图片资源层映射，展示层不注册角色或复制战斗规则。
- `shared/game/math.js`：无业务状态的几何与数值工具。
- `shared/game/rng.js`：对局级随机源。`MatchSimulation` 传入整数 `seed` 时规则与各席 AI 使用互不干扰的种子随机流，实体 ID 也改为对局内计数，整局可复现；未传时每次取值读取调用时刻的 `Math.random`，取值顺序不变。对局内规则与 AI 不直接调用 `Math.random`；种子不进入快照。
- `shared/game/ai/bridge/observation.js`：规则层到 AI 的唯一读取出口。`buildObservation(match, seat)` 把实时对局翻译成该席位有权知道的纯数据（己方完整状态、视野内敌方实体及其公开技能状态、长门雷达接触、猫爪标记、可感知弹体与公开波纹）；现状中未经迷雾过滤的四项读取集中在 `privileged`。时间字段保留绝对时间戳，观测可 JSON 往返。
- `shared/game/ai/actions.js`：AI 的动作词表。标准动作复用 `shared/protocol/match-actions.js`；带寻的点的侦察机发射与侦察机重编组是 AI 扩展动作，不进入对局动作协议，网络输入校验会拒绝它们。
- `shared/game/ai/bridge/action-port.js`：AI 与对局之间的端口，实时舰队只保留在桥接闭包内。`observe()` 返回观测，`submit(action)` 立即执行并返回是否被接受，提交后观测失效重建。标准动作始终经 `applyMatchAction` 执行，AI 与玩家受同样的操作权限约束；旧 `direct` 执行路径及模式切换已经删除。
- `shared/game/ai/bridge/runner.js`：为每个 AI 席位创建端口与策略，并在每个逻辑帧驱动一次。
- `shared/game/ai/params/`：AI 参数层。`default.js` 是默认参数（等于极限难度的行为），按决策阶段分节；`difficulty.js` 把单人难度拆成决策参数的覆盖层和规则层的让分表（数值缩放、集火残血），让分由 `MatchSimulation` 写入 AI 所控舰队；`presets.js` 提供 `legacy` 旧版对照预设；`index.js` 的 `resolveAiParams({ difficulty, preset, overrides })` 按「默认、难度、预设、覆盖」的顺序合并并深冻结，未知键或类型不符直接报错。`MatchSimulation` 的 `aiParams` 选项可按席位指定预设与覆盖。走位候选点几何与三个策略模块里的数值尚未外提，用 `node scripts/ai/list-literals.mjs` 查看剩余的内联数值。
- `shared/game/ai/policy/`：AI 的决策代码，只消费观测、参数与随机流，经端口提交动作；`check:modules` 禁止它导入运行时规则模块、观测桥或战斗内核。`rule-policy.js` 负责状态初始化与每帧的阶段编排，各阶段的方法按职责分在同目录模块里并安装到 `RulePolicy` 原型上：`intel-tracker.js`（情报记忆与外推）、`belief.js`（占据图）、`evaluation.js`（战力估值与态势）、`context.js`（焦点与战术上下文）、`energy.js`、`split.js`、`mode.js`、`targets.js`（主舰目标点）、`detached.js`（分离舰角色与站位）、`movement.js`（改航编排）、`scout.js`、`skills.js`、`view.js`、`commands.js`、`geometry.js`、`debug-state.js`。
- `shared/game/ai/policy/characters/`：每个角色一个 AI 档案，声明分离与前探偏置、默认分离角色、技能增益是否怕净化，以及技能的施放条件与瞄准。新增角色的 AI 在这里加档案并在 `index.js` 注册。
- `shared/game/ai/policy/tactics/`：跨多个决策阶段的战术。`character-counterplay.js` 负责威胁优先级、古泉能量圈攻防、现有阵容破盾手选择、无破盾阵容的多路突入与定向技能预判，不得读取未进入 AI 情报记忆的隐藏角色状态，也不得为对局补配克制角色；`shamisen-hunt.js` 负责“猫爪印记”的攻守编队，猎杀标记不会在此被提升为真实视野；`yuki-scout.js` 是纯计算的侦察条令；`bunny-stage.js` 负责兔女郎春日的变身时机与舞台走位。
- `shared/game/bot-controller.js`：`RulePolicy` 的对外门面，供对局循环、调试页和测试使用：外部方法入口拒绝实体、循环对象与能力回调，刷新观测后只消费数据。入口守卫缓存保留在闭包中，不公开可绕过校验的执行函数。
- `shared/game/visibility-radar.js`：统一汇总常规探测、视野波覆盖与长门雷达信息，并负责长门回波生成和私有序列化。
- `shared/game/vision-wave.js`：朝仓主舰视野波的发射节拍、共用扩散波环带覆盖判定、失效清理与公共状态序列化。
- `shared/game/koizumi-orb.js`：古泉分舰光球运动、撞击击退与沉默、撞击能量波传播及1秒眩晕。
- `shared/game/koizumi-barrier.js`：古泉主舰能量圈的弹体/射线截断、三类冲撞破盾、5 秒失效与公共状态序列化。
- `shared/game/targeting-system.js`：开火候选、最近目标和极限难度集火分配。
- `shared/game/action-dispatcher.js`：将客户端或 AI 的标准动作映射到舰队领域方法；AI 经动作端口进入同一条执行链。
- `shared/game/collision-system.js`：通用舰体碰撞与侦察机相撞；通过能力契约决定参与资格，通过实体方法提交位移与减速。
- `shared/game/character-contacts.js`：春日支援、兔女郎支援、刀锋女王的专属接触结算。
- `shared/game/rules/character-rules.js`：只读角色能力适配，负责控制、免疫、属性、伤害修正、目标资格和视野广播。由对局装配后供通用机制消费。
- `shared/game/systems/visibility.js`：不依赖角色的纯视野集合计算；舰队负责提交结果。
- `shared/game/match-telemetry.js`：对局内常数级动作、攻击、伤害和损失计数；只由结算摘要读取，不进入显示状态或网络快照。

需要协调多种规则的对局逻辑位于 `runtime/match-simulation.js`；实体内部状态修改由 `model/` 负责。新增纯数据、纯计算或 AI 策略时，应直接放入对应叶模块，再由兼容入口按需导出。

### 战斗界面

角色卡状态由共享状态目录、权威序列化与通用 UI 组件组成，旧 `buffs` 名称也从结构化状态生成，不再维护另一套名称判断。单人、联机与观战共用正负图标、时间环、叠层和顶层说明，显示插值不写回规则。新增状态入口与当前正负状态列表见[角色卡状态](status-effects.md)。

- `src/battle/camera.js`、`input.js`、`throttle.js`、`hud.js`、`template.js`：分别负责相机、命中与航线输入、推进控件、战斗 HUD 和公共 DOM 骨架。
- `src/battle/canvas-resolution.js`：画布以内容区域的实际设备像素分配缓冲，保留原逻辑尺寸的最低采样，不截断 DPR 或固定为 2880；WebGL 仅按后端的渲染缓冲/视口上限约束。尺寸观察与 DPR 媒体查询覆盖布局变化、显示/隐藏和跨屏，卸载相机时一并解除，分辨率变化不改变逻辑世界或取景。
- `src/battle/render.js`：单人、联机和观战共用的战场绘制语义入口；只描述绘制顺序和视觉参数，不管理 GPU 生命周期。
- `src/battle/native-webgl-renderer.js`：生产战场渲染后端入口，优先创建原生 WebGL2，失败时使用同一套几何与批处理实现回退到原生 WebGL1；只有两者都不可用才启用 Canvas 2D 可用性兜底。禁止把完整 2D 战场逐帧上传为纹理。
- `src/battle/webgl/driver.js`：WebGL1/2 着色器、动态缓冲、纹理、混合、裁剪、上下文释放与 GPU 绘制提交。
- `src/battle/webgl/native-context.js`：把共享绘制语义转换为原生三角形、弹体批次和字形/立绘纹理命令；文字允许离屏生成小型字形纹理，但最终战场合成始终由 WebGL 完成。
- `src/battle/webgl/geometry.js`、`matrix.js`、`color.js`：无 DOM 的路径三角化、虚线/曲线采样、二维矩阵和颜色/渐变计算；圆弧和曲线按物理像素误差取样，大实心圆直接绘制矢量几何，避免放大小圆盘纹理。`projectile-batch.js` 负责将普通弹体与猫爪弹合并为固定数量的 GPU 批次。
- `src/battle/webgl/text-cache.js`：字形按最终变换的最大伸缩率分档采样，最低两倍，并沿用页面字体语言环境；320 条/32 MiB 缓存预算在提交后回收，不能删除本帧尚待提交的字形，避免战斗文字逐帧上传。字形测量保留合法的零边距，仅缺失度量时按 px 字号兜底，前置字重不参与边距计算。
- `src/battle/state-interpolation.js`：单人逻辑帧与联机快照共用的纯显示插值，统一处理舰船、侦察机、僚机、弹体、光束和视觉效果。
- `src/battle/render/radar.js`：长门雷达的扫线、远近回波和移动端小地图雷达表现。
- `src/battle/render/vision-wave.js`：朝仓视野波与古泉撞击能量波在主战场和小地图上的共用波带表现；双方都能看到波纹，只有朝仓视野波提供真实视野。
- `src/battle/render/koizumi-barrier.js`：古泉能量圈、局部受击弧光与三类冲撞对应的破盾动画。
- `src/solo.js`、`src/online.js`：只编排各模式生命周期、输入和数据来源，不复制公共战场表现。

### 联机链路

- `src/online/state-sync.js`：通过只读时间轴采样、有限外推、本地航线查询和显示稳定；平滑缓存与显示时间由自身持有，通过 `reset()` 清理。历史裁剪交给传输端口，具体插值复用战斗界面的纯模块，不读 DOM，也不管理 WebSocket。
- `src/online/snapshot-transport.js`：独立持有延迟、时钟、差量基线、确认、排序和历史队列。页面只读 `state`；收包、规则冲突和重置通过明确方法提交，解码后的快照深冻结，插值不能修改差量基线。
- `src/online/connection-target.js`：同源代理、直连和本地备用 WebSocket 地址策略。
- `src/online/lobby-view.js`、`profile-controller.js`、`result-view.js`：大厅、玩家档案和结算界面职责。
- `shared/network-patch.js`：服务端与客户端共用的快照差量格式。
- `shared/protocol/match-actions.js`：单人和多人共用的战斗动作名称、构造器与静态载荷校验。
- `shared/protocol/ruleset-version.js`：客户端与服务端共享的规则版本、握手兼容判定与对局门禁依据。
- `src/battle/action-transport.js`：同一动作协议的本地权威与远程权威传输适配器。
- `server/config.js`：环境变量、容量和拥塞阈值。
- `server/protocol.js`：控制消息类型与错误码归类。
- `server/snapshot-stream.js`：快照发送、关键帧/差量选择、缓冲保护和单连接流控。
- `server/room-registry.js`：玩家与房间注册表、A/B 席位、观战集合和大厅/房间状态序列化。查询只过滤失效连接，不修改集合；生命周期显式整理。阵容及结算输出与内部记录断开可写引用。
- `server/room-lifecycle.js`：创建、加入、离开、关闭房间及比赛就绪/主持开赛的生命周期与容量门禁。
- `server/input-queue.js`：客户端输入顺序、连续操作合并、队列上限和逐帧消费。
- `server/room-state.js`：统一提交开局、倒计时结束与结算转换，保证结果构建时房间已进入完成状态。
- `server/match-runtime.js`：驱动房间阶段操作、权威逻辑帧、快照节拍、结算通知、结算后 10 秒强制回收房间和追帧保护。
- `server/server.js`：WebSocket 连接、消息路由和权威模拟进程编排。
- `server/statistics-records.js`：把服务端权威对局或客户端单人结算归一为同一份对局档案，负责匿名玩家字段与终局摘要组装。
- `server/statistics-store.js`：按月追加 JSONL、对局 ID 去重、私有玩家聚合和按公开版本划分的阵容榜缓存。磁盘写入只在结算发生，服务端比赛循环不等待写盘。
- `src/statistics-client.js`：单人结算的一次性上报与榜单页按所选版本查询；独立短连接不会加入房间或订阅快照。
- `src/statistics.js`：仅展示单人/多人阵容的出场场次与胜率，客户端排序不重复请求服务端，切换版本按需读取并缓存。

### 统计数据边界

统计分组规则由 `shared/statistics-version.js` 提供：无版本记录与 v0.3 及更早版本合并显示为“v0.3及之前的版本”，日志保留原始版本。新版本另建分组，热更新沿用公开版本；跨版本总场数只累计各组一次，当前版本场数独立于用户选择的历史组。

- `shared/release.json` 是公开版本来源，与规则兼容版本、构建 SHA 分离；热更新保留公开版本。多人结算取服务端版本，单人上报保留客户端版本。未知新版本上报被拒绝，缺少版本的旧记录与 v0.3 及更早记录共同进入历史组。
- 存储 schema 2 增加 `gameVersion` 与 `buildId`，原 JSONL 不覆盖；启动时兼容没有这些字段的旧数据。查询默认当前版本，可选择历史版本；所选版本组为空时返回空榜单，绝不回落到全量数据。

- 多人对局由服务端权威结算直接归档；单人对局在浏览器结算后上报，并明确记录为未验证来源。
- 原始客户端标识在落盘前做 SHA-256 截断哈希；不持久化 IP、完整 User-Agent 等直接网络身份信息。
- 私有档案包含规则版本、模式、难度、时长、胜负、双方编队、终局舰体/能量状态、匿名玩家档案字段和战斗汇总计数，供后续平衡与留存分析。
- 公开接口只返回 `solo`、`multiplayer` 两个榜单的有序阵容、出场场次、胜率，以及按模式划分的所选版本、全部版本和当前版本对局数，不返回玩家信息或完整对局记录。
- `MatchSimulation.serializeState()` 不包含统计字段，常规 15Hz 快照大小和广播次数不因统计功能增加。

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
| 技能实际生效过程 | `shared/game/model/team.js`、对应角色运行时 | `shared/game/model/ship.js`、`shared/game/rules/character-rules.js`、核心测试 |
| 朝仓主舰视野波规则 | `shared/game/vision-wave.js` | `shared/game/visibility-radar.js`、`shared/game/runtime/match-simulation.js`、核心测试 |
| 古泉主舰能量圈规则 | `shared/game/koizumi-barrier.js` | `shared/game/model/team.js`、碰撞/射线规则、核心测试 |
| AI 决策和能量策略 | `shared/game/ai/policy/` 下对应阶段的模块 | `shared/game/ai/params/`、核心 AI 测试 |
| 某个角色的 AI（技能时机、偏置） | `shared/game/ai/policy/characters/<角色>.js` | `shared/game/ai/params/default.js`、`test:core:ai-policy` |
| AI 能读到什么、能做什么 | `shared/game/ai/bridge/observation.js`、`shared/game/ai/actions.js` | `test:core:ai-observation`、`test:core:ai-actions` |
| AI 的权重、阈值、计时区间与难度 | `shared/game/ai/params/` | `shared/game/ai/policy/`、`test:core:ai-params`；改默认值属于规则变更 |
| AI 角色识别与针对性反制 | `shared/game/ai/policy/tactics/character-counterplay.js` | `shared/game/ai/policy/context.js`、`shared/game/ai/bridge/observation.js`、核心 AI 测试 |
| 三味线猎杀攻守编队 | `shared/game/ai/policy/tactics/shamisen-hunt.js` | `shared/game/ai/policy/movement.js`、`shared/game/shamisen-hunt.js`、核心 AI 测试 |
| 侦察战区规划与长门僚机编组 | `shared/game/ai/policy/tactics/yuki-scout.js` | `shared/game/ai/policy/scout.js`、`shared/game/model/team.js` |
| 通用战场视觉 | `src/battle/render.js` | 单人、联机、观战界面回归 |
| WebGL 图元、批处理与着色器 | `src/battle/webgl/*` | `src/battle/native-webgl-renderer.js`、`npm run test:ui:webgl` |
| 长门雷达视觉 | `src/battle/render/radar.js` | 雷达状态生成逻辑 |
| 朝仓视野波视觉 | `src/battle/render/vision-wave.js` | 视野波规则与单人/联机/观战回归 |
| 古泉能量圈视觉 | `src/battle/render/koizumi-barrier.js` | 弹体、射线、冲撞事件与单人/联机/观战回归 |
| 单人/联机画面抖动与状态插值 | `src/battle/state-interpolation.js` | `src/solo.js`、`src/online/state-sync.js`、`scripts/verify-online-state-sync.mjs` |
| 联机快照时间轴、外推和预测 | `src/online/state-sync.js` | `src/online/snapshot-transport.js`、`scripts/verify-online-state-sync.mjs` |
| 新增或修改战斗动作 | `shared/protocol/match-actions.js` | `shared/game/action-dispatcher.js`、本地/远程传输测试 |
| 规则版本与兼容门禁 | `shared/protocol/ruleset-version.js` | `src/online/snapshot-transport.js`、`server/server.js` |
| 房间模型与席位 | `server/room-registry.js` | `scripts/verify-server-rooms.mjs` |
| 入房、退房和容量门禁 | `server/room-lifecycle.js` | 协议与网络保护测试 |
| 输入积压、合并与确认 | `server/input-queue.js` | `scripts/verify-server-runtime.mjs` |
| 服务端逻辑帧与快照节拍 | `server/match-runtime.js` | 运行时与网络保护测试 |
| 快照带宽和拥塞保护 | `server/snapshot-stream.js`、`server/config.js` | `shared/network-patch.js` |
| 对局统计字段与公开榜单 | `server/statistics-store.js`、`statistics-records.js` | `shared/game/match-telemetry.js`、`src/statistics*.js`、统计测试 |
| 日英翻译文本 | `src/i18n/messages-ja.js`、`messages-en.js` | `src/i18n/catalog.js` |
| 版本号与公共更新日志 | `src/changelog/meta.js`、`entries.js` | `src/changelog.js`、`src/menu.js`、`scripts/verify-changelog.mjs` |
| 角色立绘与阵营颜色 | `src/character-select/portraits.js` | 角色选择与地图侧边立绘 |

## 验证入口

按改动选择的测试矩阵、完整候选门禁和证据限制统一维护在[测试与验收](testing.md)。架构描述不要求纯文档或局部文案修改运行全部游戏检查。

模块依赖由 `check:modules` 检查已声明的边界；战场表现副本由 `check:static` 中的漂移守卫检查。它们是有限的静态检查，不能证明所有运行时依赖、显示隔离或游戏语义正确；对应行为仍需领域测试和实际场景验收。

## 状态所有权

通用算法不直接解释角色字段。能力查询不写入状态，新增复杂形态仍由专属状态机维护。实体的位移、碰撞减速、击退、资源恢复与档位修改通过领域方法提交；角色组件内部状态由其生命周期模块维护。对局和舰队分别持有接触集合、可见集合和集火分配，计算模块返回结果，由所有者提交。攻击来源修正保持在编队分摊之前，分摊份额不重复放大。

春日旗舰的强化寿命、同帧净化保护与激活事务由 `HaruhiFlagshipRuntime` 持有，舰队的旧字段仅保留只读查询；续期不重复换算，净化不撤销常驻支援。朝仓净化阶段只消费独立只读目标句柄与效果端口，实体映射留在适配器内部，单舰净化由舰队校验归属；双方四组命中先全部采样，随后保持友军负面、敌军正面的即时结算顺序；对局只调用该阶段。

重构范围与全系统数据消费路径见[架构重构](architecture-refactor.md)。


基础算法通过显式数据复用：`systems/expanding-wave.js` 接收世界尺寸、时间、来源坐标和编号，不读取舰队或技能状态；视野波与古泉冲击波各自持有生命周期。舰船自身负责油门存储和可选实时约束装配，角色运行时提供约束函数，不重定义舰船属性；读取约束不能修改存储，写入须保存最终受约束值。

技能公共施放事务由 `SkillCycle` 持有冷却槽位，依次消费资格、能量、效果执行和成功记录；失败退款仍由具体效果负责。冷却快照不可写，外部只能提交 `startCooldown`。角色适配器提供有限施放能力，不向周期组件传入 Team 或 Ship。

`ShipStatus` 同时持有限时效果、充能倍率和技能生效帧。生效与净化通过操作提交，同帧保护不能被修改效果字典绕过；外部查询得到不可写的历史值，不公开生效帧存储。

`AircraftOperations` 拥有侦察机/僚机集合与自动任务，负责资格检查、生产扣费、任务派发、推进和退场回收。Team 只装配生产端口并安排阶段；生产输入是来源读数，集合只能通过增删操作移交，退场回收仍在光线推进之后。

护盾耐久与恢复、猎杀目标与轮次、震慑时间、光球运动与命中历史由各角色模块私有持有；实体只提供只读历史投影。测试通过命中、破盾、目标选择、震慑、运动采样和净化布置场景，不能直接覆写组件字段。光球命中历史不进入查询视图。

雷达回波 Map 与扫描游标只归雷达模块所有，AI 桥接消费雷达投影；波纹模块独占发射游标和波列表，光球撞击波的命中去重集合也不外泄。权威实体上的波纹查询深只读，显示快照仍是可独立消费的数据副本。

舰队主副舰槽位在创建后固定；额外舰船集合由 Team 私有持有，通过增加、移除和实体换队事务维护。查询数组不能增删成员，实体的生命、能量与位姿仍由实体操作提交；只读集合并不把实体本身变成显示快照。
