# 游戏模块架构图与状态所有权

源码基线：`221c077`，F1～F6 重构后，2026-10-11。原始问题及探针保留在 Git 提交 `c30d1a2`；本图展示落实后的结构，实施和验收见 [重构记录](architecture-refactor.md)。

这是一张分成八个视图的架构地图。图中的箭头按标签表示调用、数据流或状态持有，不等同于 import；模块名省略共同目录时在图前注明。`F1`～`F6` 对应后面的完成对照。静态模块全量索引见 [模块索引](architecture-module-index.md)。

核心写权限已由对应所有者收回：实体和组件发布只读状态，AI 只消费冻结观测与候选，角色求值消费事实，角色装配与固定阶段归角色层，房间聚合独占成员和生命周期。图中仍保留必要的跨所有者命令与适配关系；它们必须通过领域操作同步完成，不能退回共享字段赋值。

## 图一：权威、输入、传输与表现

```mermaid
flowchart TB
  subgraph client[浏览器入口与交互]
    menu["src/main.js / router.js / menu.js"]
    select["character-select.js<br/>character-presentation.js / i18n.js"]
    solo["src/solo.js<br/>单人页面编排"]
    online["src/online.js<br/>玩家与观战页面编排"]
    input["battle/input.js / scout-joystick.js<br/>ship-selection.js / throttle.js"]
    actions["shared/protocol/match-actions.js<br/>标准动作数据"]
    local["battle/action-transport.js<br/>createLocalBattleActionTransport"]
    remote["battle/action-transport.js<br/>createRemoteBattleActionTransport"]
    session["solo/session.js<br/>私有模拟、时钟、前后权威帧"]
    transport["online/snapshot-transport.js<br/>差量基线、收包历史、时钟偏移"]
    sync["online/state-sync.js<br/>online/throttle-command-state.js"]
  end
  subgraph authority[同一套权威规则，两个运行位置]
    localMatch["浏览器 MatchSimulation"]
    serverMatch["服务端 MatchSimulation"]
    core["shared/game-core.js<br/>兼容导出，不承载规则实现"]
    clock["shared/game/fixed-step-clock.js<br/>固定 30Hz 步进"]
    dispatch["shared/game/action-dispatcher.js<br/>动作与领域资格校验"]
  end
  subgraph server[回环或远程服务]
    ws["server/server.js / protocol.js<br/>连接、握手、消息分发"]
    queue["server/input-queue.js<br/>每连接私有动作队列与确认序号"]
    runtime["server/match-runtime.js<br/>房间固定步、结算编排"]
    stream["server/snapshot-stream.js<br/>私有差量基线、拥塞、ACK"]
    patch["shared/network-patch.js<br/>量化、差量、恢复"]
  end
  subgraph presentation[共用显示消费，不能写回模拟]
    interpolation["battle/state-interpolation.js<br/>显示副本"]
    hud["battle/hud.js / command-panel.js<br/>status-effects.js / cooldown-progress.js"]
    render["battle/render.js + render/*<br/>角色图层、场景绘制"]
    gpu["native-webgl-renderer.js<br/>webgl/* / Canvas 回退"]
    camera["camera.js / director-camera.js<br/>canvas-resolution.js"]
    views["online/lobby-view.js / spectator-view.js<br/>tournament-view.js / result-view.js"]
  end
  menu --> select
  select --> solo & online
  solo & online --> input
  input --> actions
  actions --> local & remote
  local --> session
  session ==>|持有| localMatch
  session --> clock
  remote -->|WebSocket 输入| ws
  ws --> queue
  runtime --> queue
  runtime --> clock
  queue --> dispatch
  session --> dispatch
  dispatch -->|立即提交| localMatch & serverMatch
  runtime -->|推进| serverMatch
  core -.->|导出| localMatch & serverMatch
  localMatch -->|冻结快照| session
  serverMatch -->|权威快照| ws
  ws --> stream
  stream --> patch
  stream -->|全量或差量包| transport
  transport --> sync
  sync --> interpolation
  session --> interpolation
  interpolation --> render & hud & camera
  render --> gpu
  online --> views
```

关键边界：单人会话与联机传输已经隔离权威和显示。AI 不从显示插值取数据。服务端公开快照与每席雷达分开装配；不能把“所有 UI 都读同一份世界快照”误解为所有玩家都获得相同的私有雷达。

## 图二：Ship 内部职责与写权限

下列相对路径均位于 `shared/game/`。

```mermaid
flowchart LR
  S["model/ship.js · Ship<br/>实体身份、生命周期、领域操作"]
  subgraph owned[真正独立的私有组件]
    N["systems/ship-navigation.js<br/>ShipNavigation<br/>目标、航线、击退、路径推进"]
    W["systems/weapon-cycle.js<br/>WeaponCycle<br/>射击冷却、瞄准、开火周期"]
    ST["systems/ship-status.js<br/>ShipStatus<br/>定时效果、生效帧、下发充能"]
  end
  subgraph ports[受限能力适配]
    NP["rules/navigation-port.js<br/>只读运动参数与飞行提交操作"]
    CP["rules/ship-combat-port.js<br/>武器端口与承伤端口"]
    COL["rules/collision-port.js<br/>实时只读几何与位移操作"]
  end
  subgraph rules[规则与角色扩展]
    HD["systems/hull-damage.js<br/>攻击增幅、分摊、扣血、死亡顺序"]
    CR["rules/character-rules.js<br/>属性、资格、伤害、控制、广播"]
    SE["rules/ship-effects.js<br/>初始化、净化、专属移动、命中扩展"]
    DEST["rules/ship-destruction.js<br/>伴随清理、猎杀后继效果"]
    ROLE["角色运行时<br/>光球、震慑、抓痕、形态、可靠效果"]
  end
  PUB["F2 · Ship 私有基础状态<br/>资源、运动、归属、存活、偏移<br/>getter 发布，领域操作提交"]
  PROJ["rules/ship-projection.js<br/>status-effects.js<br/>独立协议数据"]
  TEAM["Team / MatchSimulation<br/>成员、世界、生成与退场"]
  S ==>|独占实例| N & W & ST
  N --> NP
  NP -->|有限飞行操作| S
  W --> CP
  S -->|takeDamage| HD
  HD --> CP
  CP -->|领域提交| S
  COL -->|领域提交| S
  S ==>|独占存储| PUB
  S -->|能力求值| CR
  S -->|阶段扩展| SE
  SE --> ROLE
  CR -.->|读角色状态| ROLE
  CR -->|F4：即时采样，求值器不接收实体| FACTS["rules/attribute-facts.js<br/>rules/attribute-evaluation.js"]
  ROLE -->|调用领域操作| S
  HD -->|死亡端口| DEST
  DEST --> TEAM
  S --> PROJ
  PROJ -.->|读数，不推进| ROLE
```

导航、武器、效果分别持有自己的状态，Ship 持有基础机体与生命周期。生命、能量、坐标、存活和归属不能直接赋值；角色效果只能提交位移、资源计划、伤害等领域操作。Scout/Wingman 同样私有持有运动、任务、武器和寿命，任务输入隔离引用，成员发布和转移校验归属与唯一性。

## 图三：Team 的组件与角色装配边界

```mermaid
flowchart LR
  T["model/team.js · Team<br/>通用编队、资源、成员协调与领域门面"]
  MEM["F2 · systems/fleet-roster.js<br/>私有成员与不可变发布<br/>唯一性、归属、转移预检"]
  subgraph generic[私有通用组件]
    F["systems/fleet-formation.js<br/>FleetFormation<br/>分离层级、编队规则、资源分摊"]
    SK["systems/skill-cycle.js<br/>SkillCycle<br/>冷却与成功事务"]
    AC["systems/aircraft-operations.js<br/>AircraftOperations<br/>侦察机、僚机集合与生产周期"]
    BM["systems/beam-system.js<br/>BeamSystem<br/>蓄力光线与命中生命周期"]
    V["systems/visibility.js<br/>FleetPerception<br/>可见集合的不可变采样"]
    FC["targeting-system.js<br/>FleetFireControl<br/>当轮集火分配"]
  end
  subgraph adapters[各组件能力端口]
    FP["rules/formation-port.js"]
    SP["rules/team-skill-port.js<br/>rules/active-skills.js"]
    AP["rules/aircraft-port.js"]
    BP["rules/beam-port.js"]
    VP["visibility-radar.js<br/>visibilityInputs / 雷达状态"]
    FCP["rules/fire-control.js<br/>候选 DTO 与实体映射"]
  end
  subgraph specific[队级角色组件与运行时]
    HF["rules/haruhi-flagship-port.js<br/>haruhi-flagship-runtime.js<br/>haruhi-flagship.js / haruhi-support.js"]
    SF["rules/sponsor-port.js<br/>sponsor-effect.js"]
    FF["rules/future-form-port.js<br/>future-flagship-form.js"]
    VW["vision-wave.js<br/>波纹持有与发波周期"]
    KB["koizumi-barrier.js / koizumi-orb.js<br/>护盾与冲击波队级状态"]
    SH["shamisen-hunt.js<br/>猎杀目标与后继选择"]
    BH["bunny-haruhi-runtime.js<br/>队伍支援阶段"]
  end
  M["runtime/match-simulation.js"]
  S["Ship / Scout / Wingman<br/>各自提交实体状态"]
  T ==>|成员关系| MEM
  T ==>|私有实例| F & SK & AC & BM & V & FC
  F --> FP
  SK --> SP
  AC --> AP
  BM --> BP
  V -->|消费采样输入| VP
  FC -->|消费候选数据| FCP
  FP & SP & AP & BP & FCP -->|提交领域操作| S
  ASSEMBLY["rules/character-assembly.js<br/>rules/character-team.js<br/>持有队级角色组件及阶段顺序"]
  T -->|装配与领域操作| ASSEMBLY
  ASSEMBLY ==>|角色组件| HF & SF & FF
  ASSEMBLY -->|初始化及固定推进| VW & KB & SH & BH
  M -->|A 后 B 固定顺序| T
  T -->|逐实体推进、立即开火| S
  TP["rules/team-projection.js<br/>角色与通用状态的协议投影"]
  T -->|只读序列化| TP
  TP -.->|消费状态| VW & KB & SH & HF
```

角色效果要生成实体或转移阵营时，会调用集合所有者的领域操作；这种跨所有者命令本身是合理的。集合所有者现在统一验证唯一性和归属，实体转移先验证后修改双方成员。伴随转换先预检，再同步清理可靠效果和弹体、提交角色状态；失败不产生部分副作用。

## 图四：九角色的运行时与消费关系

```mermaid
flowchart LR
  DEF["characters.js<br/>冻结角色定义、技能元数据"]
  AS["rules/active-skills.js<br/>普通主动技能声明"]
  SE["rules/ship-effects.js<br/>专属技能、净化和命中挂接"]
  CR["rules/character-rules.js<br/>跨角色属性及资格组合"]
  PROJ["rules/ship-projection.js / status-effects.js<br/>AI bridge/observation.js<br/>分别生成表现与策略读模型"]
  PH["F5 · rules/character-assembly.js<br/>character-team.js / character-battle.js<br/>初始化、能力、投影与固定角色阶段"]
  subgraph haruhi[普通春日]
    H["haruhi-flagship-runtime.js<br/>强化到期与同帧保护"]
    HS["haruhi-support.js<br/>来源私有调度、支援池、冲撞冷却"]
    HP["haruhi-hero-power.js<br/>rules/hero-power-runtime.js<br/>勇者之力事件、震慑"]
  end
  subgraph bunny[兔女郎春日与伴随阿虚]
    BC["bunny-haruhi-config.js"]
    BP["bunny-haruhi.js<br/>纯形态、舞台、资源计划"]
    BR["bunny-haruhi-runtime.js<br/>形态、曝光、舞台采样、持续结算"]
    BS["bunny-haruhi-support.js<br/>显式副舰支援来源"]
    BCP["bunny-haruhi-companion.js<br/>纯伴随与策反计划、资格"]
    BCR["bunny-companion-runtime.js<br/>伴随关系、可靠效果、归还与跟随"]
  end
  subgraph other[其他角色]
    K["阿虚：character-rules.js<br/>ShipStatus / FleetFormation<br/>被动编队倍率、可靠增益"]
    Y["长门：visibility-radar.js<br/>AircraftOperations + Scout<br/>雷达、战斗侦察与爆发侦察"]
    KO["古泉：koizumi-barrier.js<br/>koizumi-orb.js<br/>护盾、光球、接触与冲击波"]
    FU["未来1096：future-flagship-form.js<br/>BeamSystem<br/>队级形态与副舰蓄力光线"]
    TS["鹤屋：sponsor-effect.js<br/>rules/support-conversion.js<br/>赞助与战区策反事务"]
    A["朝仓：vision-wave.js<br/>vision-wave-purge.js<br/>ShipStatus / character-contacts.js"]
    SH["三味线：shamisen-hunt.js<br/>shamisen-claw.js<br/>猎杀、抓痕、猫爪弹体"]
  end
  EX["systems/expanding-wave.js<br/>通用波前命中与历史"]
  CONTACT["character-contacts.js<br/>contact-geometry.js<br/>角色接触及几何资格"]
  DEF -.-> AS & CR & BC & BP
  AS --> H & HP & K & Y & KO & FU & TS & A & SH
  SE --> BR & KO & SH & HP
  BC --> BP & BCP
  BR --> BP & BS & BCR
  BCR --> BCP
  BS --> HS
  H --> HS
  HP & A --> EX
  KO & H & BR & A --> CONTACT
  PH --> BR & BCR & HS & HP & KO & A & SH
  CR -.-> H & K & KO & FU & SH & BR & BCR
  PROJ -.-> H & HS & HP & BR & BCR & Y & KO & FU & A & SH
```

| 角色 | 主要权威状态所有者 | 写入/消费的特殊约束 |
| --- | --- | --- |
| 春日 | 强化组件、支援来源存储、勇者之力运行时 | 强化与支援解锁顺序不变；震慑必须在开火前生效 |
| 兔女郎春日 | 形态/舞台运行时、支援来源存储 | 形态和解锁一起发布；双方舞台先采样后提交 |
| 伴随阿虚 | 伴随运行时、每个接收者的可靠效果、舰体资源 | 母舰关系、临时策反、归还、弹体清理保持同步事务 |
| 阿虚 | ShipStatus 与舰体资源；被动倍率是规则查询 | 增益生效帧保护；回血只通过舰体操作 |
| 长门 | 雷达运行时、航空组件、Scout 自身 | 出生时采样战斗能力；策反后不能错误重新采样身份 |
| 古泉 | 护盾/光球模块的私有状态 | 特殊移动与接触资格即时可见；命中历史不泄露 |
| 未来1096 | FutureFlagshipForm、BeamSystem | 形态先提交再换算；光线先固定命中集合再投递 |
| 鹤屋 | SponsorEffect；策反由适配事务协调 | 阵营/集合/伴随效果一起变更；失败退款顺序不改 |
| 朝仓 | 视野波运行时、ShipStatus | 净化双方先采样；同帧新增效果的保护不能被顺序吞掉 |
| 三味线 | 猎杀与抓痕模块、ShipStatus | 攻击增幅先于分摊；击杀后继效果同步完成 |

角色身份、具体效果 ID 和策略中的角色战术本来就属于领域知识，不能因为出现 `characterId` 就判定耦合错误。真正要限制的是角色模块获得的写权限、对世界对象的可达范围，以及接入新角色时需要修改的中心模块数量。

## 图五：AI 的实际内部结构

相对路径位于 `shared/game/ai/`，BotController 位于上一级。

```mermaid
flowchart LR
  MATCH["MatchSimulation"]
  RUN["bridge/runner.js<br/>每席随机流与驱动"]
  BOT["bot-controller.js<br/>Proxy 外部数据参数校验"]
  RP["policy/rule-policy.js<br/>RulePolicy：私有调度、模式与计划提交"]
  OBSBUILD["bridge/observation.js<br/>实体到有权知道的纯数据"]
  PORT["bridge/action-port.js<br/>观察缓存、提交动作、失效"]
  OBS["F1 · 深只读观测缓存<br/>普通与 strict 模式一致隔离"]
  INDEX["F1 · policy/observation-view.js<br/>私有 Map、冻结数组、只读 ID 集合"]
  PARAM["params/index.js<br/>default.js / difficulty.js / presets.js<br/>冻结参数"]
  subgraph private[真正私有的状态组件]
    INTEL["policy/intel-tracker.js<br/>已确认记忆、反应延迟队列"]
    BELIEF["policy/belief.js<br/>搜索概率网格"]
    SCOUT["policy/tactics/yuki-scout.js<br/>ScoutDoctrine：缓存、承诺、重编组"]
    SKILL["policy/skill-decision-cycle.js<br/>技能时钟、历史决策"]
  end
  subgraph heuristics[无状态启发式：消费冻结的读取与操作上下文]
    READ["view.js / geometry.js<br/>evaluation.js / energy.js / context.js"]
    PLAN["split.js / mode.js / detached.js<br/>targets.js / movement.js"]
    ACT["commands.js / scout.js / skills.js<br/>debug-state.js"]
  end
  SEARCH["F3 · policy/search-navigation.js<br/>私有区域、游标、方向、推进时间<br/>候选凭证与版本校验，显式消费"]
  TACTIC["tactics/bunny-stage.js<br/>character-counterplay.js / shamisen-hunt.js"]
  FACT["characters/decision-view.js<br/>复制并冻结事实和输入"]
  PROFILE["characters/index.js + 九个角色档案<br/>冻结注册表、纯角色决策"]
  DISPATCH["action-dispatcher.js<br/>标准动作；侦察扩展由桥适配"]
  MATCH --> RUN
  RUN --> BOT --> RP
  RUN --> PORT
  PORT --> OBSBUILD
  OBSBUILD -.->|唯一实体读取桥| MATCH
  PORT ==>|缓存| OBS
  RP -->|observe| PORT
  READ --> OBS & INDEX
  RP --> PARAM
  RP ==>|私有实例| INTEL & BELIEF & SCOUT & SKILL
  PROGRAM["policy/policy-program.js<br/>枚举读取与操作能力，不持有策略实例<br/>只读诊断计数"]
  RP -->|执行计算| PROGRAM
  PROGRAM --> READ & PLAN & ACT
  PLAN & ACT -->|候选结果| RP
  RP ==>|独占并消费候选| SEARCH
  INTEL -->|接触事实| SEARCH
  RP --> INDEX
  READ & PLAN & ACT --> TACTIC
  ACT --> FACT --> PROFILE
  SKILL -->|只读目标事实| PROFILE
  SKILL -->|破盾重规划结果| RP
  ACT -->|命令| PORT
  PORT -->|submit 后立即失效| DISPATCH
  DISPATCH --> MATCH
```

AI 没有实体兼容通道。观测与索引只读；搜索候选查询不推进游标，实际命令显式消费候选。启发式不再安装到 RulePolicy 原型，执行上下文没有字段写权；模式、卡死采样、移动和分离结果返回协调器提交。诊断只读，不靠覆写策略方法采样。情报外推只在同一观测和参数下复用，动作后立即失效。

## 图六：实际单帧顺序

此图来自 `MatchSimulation.update()`，保持代码顺序。箭头是先后顺序，不是模块 import。A、B 的顺序是当前行为的一部分。

```mermaid
flowchart TB
  I["服务端 applyQueuedInputs<br/>或单人即时动作提交"]
  T["tick + 1 / elapsed + safeDt"]
  B0["兔女郎持续资源与舞台推进<br/>伴随清理、归还、可靠效果与导航准备"]
  H["刷新双方三味线猎杀目标"]
  AI["逐席 AI：观察、决策、立即提交动作"]
  TEAM["Team A.update → Team B.update<br/>编队死亡调整 → 冷却 → 赞助回血 → 能量<br/>舰船 → 支援 → 视野波 → 航空 → 光线蓄力"]
  HERO["勇者之力：移动后、开火前震慑"]
  CONTACT["古泉护盾撞击 → 光球接触 → 冲击波<br/>春日冲撞 → 兔女郎冲撞 → 船体碰撞<br/>刀锋接触 → 侦察机相撞"]
  PURGE["双方舞台采样/提交 → 视野波净化<br/>兔女郎来源清理"]
  VIS["A/B 可见性采样 → A/B 雷达推进"]
  BEAM["A/B 蓄力光线结算"]
  FIRE["A/B 普通战斗<br/>各舰船 → 僚机 → 侦察机"]
  BULLET["弹体拦截 → 移动/命中 → 活集合发布<br/>护盾阶段收尾"]
  FX["爆发、飘字、反馈寿命推进"]
  CLEAN["伴随/来源清理 → 兔女郎视野刷新"]
  WIN["胜负检查"]
  OUT["按消费者节拍投影<br/>权威快照、雷达、统计、显示"]
  I --> T --> B0 --> H --> AI --> TEAM --> HERO --> CONTACT --> PURGE
  PURGE --> VIS --> BEAM --> FIRE --> BULLET --> FX --> CLEAN --> WIN --> OUT
```

不能把所有状态“延后统一消费”。伤害分摊、死亡、封印、支援、净化、技能冷却及后续 AI 观察都存在同帧因果关系。可集中的是各状态的写入所有者和阶段入口；只对需要公平同时观察的规则先统一采样，例如双方舞台与净化目标。

## 图七：属性、控制与承伤的事实求值

```mermaid
flowchart TB
  S["Ship 属性与资格查询"]
  R["rules/character-rules.js<br/>实体读取适配边界"]
  M["Team / FleetFormation<br/>只返回编队成员关系"]
  A["rules/attribute-facts.js<br/>sampleAttributeFacts / sampleControlFacts<br/>sampleImmunityFacts / sampleDamageFacts"]
  REL["伴随、可靠与舞台来源关系<br/>创建或授予时登记 WeakMap<br/>即时校验存活、归属、成员资格"]
  FACT["冻结普通事实<br/>时间、效果、形态、数值<br/>不含实体、世界、回调"]
  E["rules/attribute-evaluation.js<br/>纯属性、控制、免伤、承伤和航速求值"]
  OUT["能力结果<br/>供导航、武器、伤害等系统消费"]
  S --> R
  R -->|仅航速需要成员| M
  R --> A
  M -->|每成员采样基础航速事实| A
  A -->|按需读取局部关系| REL
  A --> FACT --> E --> OUT
```

不再存在 `FleetFormation → member.baseSpeed() → 角色 → 世界扫描` 的求值回绕。属性变化仍即时采样：变身、分离、封印、策反、净化和死亡影响同帧后续查询，不在帧头统一缓存。适配层可读取实体，纯求值器不能；生成与转移等事务仍需跨所有者协调，不能把事务适配误称为纯函数。

## 图八：服务端房间、状态与持久边界

```mermaid
flowchart LR
  SERVER["server/server.js<br/>组合根、协议路由、快照帧装配"]
  PROTOCOL["protocol.js / config.js<br/>载荷校验、规则握手、限流配置"]
  ID["game-identity.js<br/>身份验签，不持有签名私钥"]
  REG["room-registry.js<br/>查找、成员/观战集合、对外视图"]
  LIFE["room-lifecycle.js<br/>加入、离开、换阵容、就绪、主持行为"]
  STATE["room-state.js<br/>开始、倒计时转运行、结束"]
  RUNTIME["match-runtime.js<br/>固定步、发快照节拍、结束消费"]
  ROOM["F6 · server/room.js / Room<br/>私有成员、就绪、阶段、比赛与结果"]
  SCHEDULE["SnapshotSchedule<br/>独占快照序号与累加器"]
  INPUT["input-queue.js<br/>连接私有输入队列与确认"]
  STREAM["snapshot-stream.js<br/>连接私有差量/拥塞/确认状态"]
  MATCH["MatchSimulation"]
  RECORD["statistics-records.js<br/>结果到统计记录"]
  STORE["statistics-store.js<br/>持久化、聚合、公开榜单投影"]
  SERVER --> PROTOCOL & ID & REG & LIFE & RUNTIME & INPUT & STREAM
  REG & LIFE & STATE & RUNTIME -->|领域命令或只读状态| ROOM
  SERVER -->|请求下一序号| ROOM
  ROOM ==>|独占实例| SCHEDULE
  LIFE --> STATE
  RUNTIME --> STATE
  RUNTIME --> INPUT
  INPUT -->|权威动作| MATCH
  RUNTIME -->|update| MATCH
  MATCH -->|序列化| SERVER
  SERVER -->|冻结帧与每席私有雷达| STREAM
  RUNTIME -->|完成回调| SERVER
  SERVER --> RECORD --> STORE
```

房间成员、就绪、阶段和结算统一由 Room 提交。连接层仍负责权限、通知和连接记录，运行器通过领域命令推进比赛和快照时钟；它们不能直接修改房间字段。观战集合、席位、就绪和结果均只读，历史视图不追随后续提交。

## F1～F6 完成对照

| 项 | 实际所有者与契约 | 反向验证 |
| --- | --- | --- |
| F1 观测与索引 | action-port 深冻结；ObservationView 私有索引 | 普通/strict 写入拒绝，历史观测稳定，成功及失败动作后失效 |
| F2 实体与成员 | Ship/Scout/Wingman 私有状态；FleetRoster/AircraftOperations 独占发布 | 标量/嵌套修改拒绝；重复、错误归属、跨对局拒绝；转移失败无部分副作用 |
| F3 AI 内部多写 | SearchNavigation 候选及消费；RulePolicy 私有计划与调度；PolicyProgram 只读上下文 | 重复查询不推进；伪造、过期、重复候选拒绝；外部不能写计划与时钟 |
| F4 求值回绕 | 按用途采样的冻结事实与纯求值器；局部来源关系 | 无实体/回调；历史稳定；同帧变身、净化与归属变化立即生效 |
| F5 角色接入 | CHARACTER_ASSEMBLY；队级/对局角色所有者；独立投影 | 核心实体不再持有具体角色组件或列举推进；固定阶段拒绝未声明入口 |
| F6 房间多写 | Room 聚合；SnapshotSchedule | 重复席位、冒名就绪、外部赋值拒绝；倒计时/运行/完成及快照顺序保持 |

对应源码分别见 [观测端口](../shared/game/ai/bridge/action-port.js)、[舰船](../shared/game/model/ship.js)、[搜索所有者](../shared/game/ai/policy/search-navigation.js)、[属性事实](../shared/game/rules/attribute-facts.js)、[角色装配](../shared/game/rules/character-assembly.js)、[房间聚合](../server/room.js)。测试入口为 `scripts/verify-domain-boundaries.mjs`，完整证据记录在重构记录中。

## 保留的合理耦合与验收边界

- 角色规则知道角色身份、形态及效果含义；通用算法只消费能力或事实。封装的目标是限制权威存储和职责，不是消除全部领域依赖。
- 角色事务适配层负责生成、转移、清理、命中等跨所有者操作，仍会取得领域实体；它只能使用领域命令，不能直接修改私有存储。纯求值层不取得这些能力。
- Team/Match 保留领域门面，已有调用者和测试可调用明确操作；角色状态、投影和阶段顺序已转交对应所有者，门面不再保存第二份状态。
- 冻结 AI 观测、事实和历史会产生分配开销；只在有明确身份和失效规则的地方复用。没有通过改变规则、延迟到帧尾或重刷回放来换取性能。
- 自动化覆盖固定种子、全部核心角色、浏览器和本地网络；不能推导出任意对局穷尽证明，也不替代真人多端体验。未推送、未部署。
