# 游戏模块架构图与残留问题

源码基线：`c60f9b9`，2026-10-11。本次只绘图、核对代码和运行隔离内存探针，不修改游戏规则或运行逻辑。

这是一张分成八个视图的架构地图。图中的箭头按标签表示调用、数据流或状态持有，不等同于 import；模块名省略共同目录时在图前注明。`F1`～`F6` 对应后面的残留问题。静态模块全量索引见 [模块索引](architecture-module-index.md)。

**结论：现在已经具备组件化结构，但内部写权限与求值依赖还没有完全收口。** 导航、技能周期、情报等组件的私有状态是真正拆出了；AI 其余启发式仍是同一个大策略的原型方法，基础实体仍可直接写，角色运行时仍能通过实体访问整个世界。以下将已经成立的边界和这些残留同时画出。

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
  PUB["F2 · 仍公开可写<br/>hp / energy / x / y / speed / angle<br/>team / alive / formationOffset 等"]
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
  S ==>|当前自身存储| PUB
  S -->|能力求值| CR
  S -->|阶段扩展| SE
  SE --> ROLE
  CR -.->|读角色状态| ROLE
  CR -.->|F4：继续读取完整实体关系| TEAM
  ROLE -->|调用领域操作| S
  HD -->|死亡端口| DEST
  DEST --> TEAM
  S --> PROJ
  PROJ -.->|读数，不推进| ROLE
```

私有组件不是单纯分文件：外部不能修改导航的航线对象、状态生效帧或射击计时内部存储。但这不等于整个 Ship 已经只读：公开标量仍可绕过 `takeDamage`、`restoreEnergy`、`displaceTo`、`transferToTeam` 等操作。冻结 Team 的槽位字典也不会冻结字典里指向的 Ship。

## 图三：Team 的组件、装配与剩余职责

```mermaid
flowchart LR
  T["model/team.js · Team<br/>装配、阶段编排、领域门面、序列化"]
  MEM["F2 · 成员关系<br/>固定 ships 字典、extraShips 冻结数组<br/>元素仍是活实体；发布入口无完整不变量校验"]
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
  T ==>|角色组件| HF & SF & FF
  T -->|显式推进或查询| VW & KB & SH & BH
  M -->|A 后 B 固定顺序| T
  T -->|逐实体推进、立即开火| S
  T -.->|F5：投影直接列举具体角色| VW & KB & SH & HF
```

角色效果要生成实体或转移阵营时，会调用集合所有者的领域操作；这种跨所有者命令本身是合理的。问题在于集合所有者必须最终保证唯一性和归属，而不能完全依赖每个角色调用者正确配对调用。

## 图四：九角色的运行时与消费关系

```mermaid
flowchart LR
  DEF["characters.js<br/>冻结角色定义、技能元数据"]
  AS["rules/active-skills.js<br/>普通主动技能声明"]
  SE["rules/ship-effects.js<br/>专属技能、净化和命中挂接"]
  CR["rules/character-rules.js<br/>跨角色属性及资格组合"]
  PROJ["rules/ship-projection.js / status-effects.js<br/>AI bridge/observation.js<br/>分别生成表现与策略读模型"]
  PH["F5 · Match / Team 固定阶段<br/>角色接入点分散在多个编排器"]
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
  RP["policy/rule-policy.js<br/>RulePolicy：调度、模式、搜索意图、移动计划"]
  OBSBUILD["bridge/observation.js<br/>实体到有权知道的纯数据"]
  PORT["bridge/action-port.js<br/>观察缓存、提交动作、失效"]
  OBS["F1 · 观测缓存<br/>纯数据但可写，共享同一引用"]
  INDEX["F1 · policy/view.js<br/>公开索引对象、ships 数组、Map、Set"]
  PARAM["params/index.js<br/>default.js / difficulty.js / presets.js<br/>冻结参数"]
  subgraph private[真正私有的状态组件]
    INTEL["policy/intel-tracker.js<br/>已确认记忆、反应延迟队列"]
    BELIEF["policy/belief.js<br/>搜索概率网格"]
    SCOUT["policy/tactics/yuki-scout.js<br/>ScoutDoctrine：缓存、承诺、重编组"]
    SKILL["policy/skill-decision-cycle.js<br/>技能时钟、历史决策"]
  end
  subgraph mixins[仍安装在同一个 RulePolicy 原型的 14 组方法]
    READ["view.js / geometry.js<br/>evaluation.js / energy.js / context.js"]
    PLAN["split.js / mode.js / detached.js<br/>targets.js / movement.js"]
    ACT["commands.js / scout.js / skills.js<br/>debug-state.js"]
  end
  SEARCH["F3 · 共享可变搜索意图<br/>searchZoneId / searchCursor<br/>searchSweepSign / lastSearchAdvanceAt"]
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
  RP ==>|原型混入，共享 this| READ & PLAN & ACT
  PLAN & ACT -->|F3：多处写入| SEARCH
  INTEL -->|contactZone 回调| SEARCH
  READ & PLAN & ACT --> TACTIC
  ACT --> FACT --> PROFILE
  SKILL -->|只读目标事实| PROFILE
  SKILL -->|破盾重规划结果| RP
  ACT -->|命令| PORT
  PORT -->|submit 后立即失效| DISPATCH
  DISPATCH --> MATCH
```

AI 已经没有实体兼容通道，动作也回到经过领域资格检查的执行路径。这项改善是真的。剩余问题在于内部仍缺少统一只读的观测与索引，以及几个策略模块对同一搜索意图的隐式修改；不能再把“没有实体引用”与“AI 内部已经解耦”画上等号。

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

## 图七：属性查询仍存在的运行期回绕

下面是具体的方法调用链，而不是抽象层级。它会终止，**不是无限递归**；问题是能力求值跨越多次所有者和整个世界，依赖范围隐含在闭包与实体引用里。

```mermaid
flowchart TB
  S["Ship.effectiveSpeed()"]
  R["CHARACTER_RULES.effectiveSpeed(ship)"]
  T["Team.fleetSpeedForShip(ship)"]
  F["FleetFormation.fleetSpeedForShip(key)"]
  P["formation-port：member.baseSpeed()"]
  B["每个成员 Ship.baseSpeed()"]
  C["CHARACTER_RULES.statWithBuffs<br/>队级形态、春日、伴随、舞台等"]
  BR["bunnyCompanionForm / bunnyReliableState"]
  WORLD["ship.team.match<br/>查母舰、扫描双方 extraShips、取当前时间"]
  S --> R --> T --> F --> P --> B --> C --> BR --> WORLD
```

改进方向是把参与本次属性计算的事实和关系查询缩窄，形成有明确失效条件的属性求值输入；保留必须即时读取的部分。不能粗暴地在帧开始缓存所有属性，否则分离、变身、策反、净化后的同帧属性会失真。

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
  ROOM["F6 · 共享 room 记录<br/>seats / ready / spectators / status<br/>match / snapshotSeq / snapshotAccumulator"]
  INPUT["input-queue.js<br/>连接私有输入队列与确认"]
  STREAM["snapshot-stream.js<br/>连接私有差量/拥塞/确认状态"]
  MATCH["MatchSimulation"]
  RECORD["statistics-records.js<br/>结果到统计记录"]
  STORE["statistics-store.js<br/>持久化、聚合、公开榜单投影"]
  SERVER --> PROTOCOL & ID & REG & LIFE & RUNTIME & INPUT & STREAM
  REG & LIFE & STATE & RUNTIME -->|各自直接修改不同或相邻字段| ROOM
  SERVER -->|snapshotSeq 递增| ROOM
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

输入队列和连接快照状态已经私有化。房间本身仍是多个模块共同持有的可写记录。当前路径有明确顺序，但不变量仍由协作约定而非房间所有者统一保证；这是战斗内部之外的后续改进项，不是已确认的联机错误。

## 从图中确认的六项残留

优先级表示架构治理顺序，**不表示线上事故或安全漏洞等级**。F1～F3 有隔离内存探针；F4～F6 是已核对调用链的设计分析。

### F1：AI 的纯数据观测与索引仍共享可变引用（优先）

- [action-port.js:60](../shared/game/ai/bridge/action-port.js#L60) 缓存 `buildObservation()` 的结果并直接返回；`strict` 只做 JSON 往返，不冻结。
- [view.js:6](../shared/game/ai/policy/view.js#L6) 返回内部 `observationIndex`，其中数组、Map、Set 可写，元素又指向同一份观测。
- 探针：把 `observe().self.ships.main.hp` 写成 13，下一次 `observe()` 仍得到 13，而权威生命保持 880。普通和 strict 模式均成立。
- 因此目前不会借该引用直接修改游戏实体，但会污染后续 AI 判断；观测对象不换引用时，索引缓存也不会重建。
- 建议：端口发布深只读观测；索引由独立私有 `ObservationView` 持有；消费者只取得查询或只读数组，不取得 Map/Set。继续保留动作提交后的立即失效。

### F2：实体基本状态与成员不变量尚未封闭（优先）

- [ship.js:34](../shared/game/model/ship.js#L34) 仍公开写入 `team/hp/energy/x/y/speed/alive` 等字段；`formationOffset` 也是可写对象。
- [team.js:49](../shared/game/model/team.js#L49) 发布冻结槽位容器，内部元素仍是活实体；[team.js:210](../shared/game/model/team.js#L210) 的成员发布直接追加，没有校验归属和重复。
- 探针：直接赋值 `ship.hp = -5`，`alive` 仍为 true，绕过死亡事务。把 B 主舰两次加入 A 的额外舰船集合也被接受，尽管数组本身冻结。
- 这些反例证明写入口能绕过，不证明正常游戏已经这样调用。目前角色生产路径主要使用领域命令，前轮改进有效。
- 建议：私有化核心资源/运动/归属字段并发布 getter；训练装配与测试场景用显式构造契约；独立成员所有者保证唯一性、角色资格和跨队转移事务。不要仅在外面再套一个冻结数组。

### F3：AI 仍是原型拼装的大策略，搜索意图有多个写者（优先）

- [rule-policy.js:361](../shared/game/ai/policy/rule-policy.js#L361) 将 14 组方法安装到同一个原型；文件分开了，`this` 仍是同一份状态和能力集合。
- [scout.js:33](../shared/game/ai/policy/scout.js#L33)、[targets.js:6](../shared/game/ai/policy/targets.js#L6) 都修改 `searchZoneId`；[rule-policy.js:75](../shared/game/ai/policy/rule-policy.js#L75) 的情报回调也修改它。
- 探针：调用看起来用于选择侦察区的 `pickScoutZoneId`，搜索意图从 4 变成 1。额外调用一次选区可能影响后续走位，而不是只得到一个候选值。
- 建议：`SearchNavigationState` 统一消费接触、探测与到达事实，持有搜索游标；选区和目标计算返回候选，不提交状态。RulePolicy 只按原顺序协调候选、动作与结果。
- 已拆出的 IntelTracker、SearchBelief、ScoutDoctrine、SkillDecisionCycle 应保留，不能因为尚有残留而否认这些真实边界。

### F4：角色适配器权限过宽，属性求值仍反复经过实体与世界（第二步）

- [character-rules.js:157](../shared/game/rules/character-rules.js#L157) 读取队级与多个角色效果；[character-rules.js:167](../shared/game/rules/character-rules.js#L167) 通过 Team 和编队组件反查成员属性。
- [formation-port.js:13](../shared/game/rules/formation-port.js#L13) 回调实体的 `baseSpeed()`；[bunny-companion-runtime.js:78](../shared/game/bunny-companion-runtime.js#L78) 又沿 `ship.team.match` 查整个伴随集合。
- 通用算法已不再直接枚举角色状态，这是好的；但“依赖倒置”只完成了一半，角色适配器仍可访问整个实体对象图。测试替换一个能力函数，不能证明其真实实现的读取范围受限。
- 建议：按属性、伤害、控制、可见性、成员关系拆成有明确输入的求值契约；角色运行时取得有限关系查询和效果提交能力。处理同帧失效，不强行统一延后。

### F5：角色接入仍分散于中央装配、推进、规则和投影（第二步）

- [match-simulation.js:398](../shared/game/runtime/match-simulation.js#L398) 直接列出角色推进、碰撞、清理；[team.js:405](../shared/game/model/team.js#L405) 继续编排队级角色；[team.js:518](../shared/game/model/team.js#L518) 自己列举角色投影。
- 另外还需要同步 `SHIP_EFFECTS`、`CHARACTER_RULES`、主动技能声明、状态投影及 AI 观测。新增复杂角色的改动面仍跨越多个中央入口，容易漏掉清理或投影。
- 建议：先建立明确的角色装配模块，声明初始化、能力、投影以及允许参加的固定阶段；框架持有阶段顺序。仅登记已存在的阶段，不引入任意事件广播，不把所有角色塞入同一个巨大配置解释器。
- Ship/Team 仍较长并不是充分证据；真正的证据是它们同时负责装配、角色阶段、领域命令和协议投影。

### F6：房间状态仍跨模块共享修改（后续）

- [room-state.js:2](../server/room-state.js#L2) 写比赛阶段与重置字段；[match-runtime.js:63](../server/match-runtime.js#L63) 写快照累加器；[server.js:246](../server/server.js#L246) 写房间快照序号。
- [room-lifecycle.js:277](../server/room-lifecycle.js#L277) 写就绪集合；[room-registry.js:79](../server/room-registry.js#L79) 整理观战集合。
- 这里不是“多个模块分别写不相干字段就一定错误”，而是共享 room 可达全部字段，跨字段约束缺少统一所有者。当前生命周期顺序正确不代表边界已被代码强制。
- 建议：房间聚合持有席位、就绪、阶段与比赛；快照调度持有序号和累加器；查询/序列化只拿读模型。避免再按文件名拆分函数但共享整个 room。

## 已成立的边界与不应误改的部分

| 边界 | 已成立的约束 | 不能据此推出的结论 |
| --- | --- | --- |
| AI 实体桥 | 策略不接收真实 Ship/Team，动作经执行适配 | 不代表 AI 观测和内部计划不可变 |
| 组件私有状态 | 导航、火控、技能周期、记忆等真实私有 | 不代表实体所有标量或成员关系私有 |
| 角色支援快照 | 不可作为写凭证，历史快照稳定 | 不代表所有角色模块只持有受限能力 |
| 通用战斗算法 | 通过端口消费，未直接读取角色状态字段 | 不代表能力求值实现没有实体回绕 |
| 单人/联机表现 | 消费权威投影，显示插值不写回 | 不代表服务端房间记录已经独占写入 |
| 固定步与即时事务 | 关键同帧顺序已有回归基线 | 不代表可以任意重排阶段或统一帧尾提交 |

## 建议的下一轮顺序和完成标准

1. **观测和索引只读**：同一个采样可复用，但任何消费方不能修改；动作后观察到最新权威状态。
2. **实体与成员写入口关闭**：非法直接赋值被拒绝；合法训练、转队、生成、伤害与移动均由所有者操作完成；跨队和重复成员被所有者拒绝。
3. **搜索意图独占**：重复调用选区/目标查询不改变状态；更新只由明确事实与动作结果推进；保持现有随机消费和决策顺序。
4. **缩窄角色求值上下文**：先处理图七这样的具体链，再扩展到控制、伤害与可见性；不能用缓存引入跨阶段陈旧属性。
5. **集中角色装配与投影挂接**：新增角色不必同时修改 Match、Team、Ship 三个实体的内部生命周期；阶段排序仍显式可审阅。
6. **房间聚合所有权**：把外围共享记录收回，独立验证就绪、倒计时、断线、结束、快照序号和统计消费。

每项都需要“越界操作失败”的负向证据、既有角色行为断言和未重刷的原始回放。仅减少类行数、改目录、增加代理方法或跑绿旧测试，都不算完成标准。

## 本次分析的验证范围

已核对当前源码的引用、装配、实际方法调用和状态写者；五个隔离内存探针通过（普通/strict AI 缓存、公开生命、成员关系、侦察选区副作用）。探针只创建临时内存对局，没有访问网络或身份/统计数据，日志位于 `.cache/architecture-map-probes.log`。这些是边界可绕过的证据，不是游戏故障复现。

八幅 Mermaid 图均已通过解析与浏览器渲染，已检查核心图的实际布局；模块索引覆盖 218 个 JavaScript 模块，本地链接及引用行号均已校验。

本次只增加图与分析文档，未重跑整套游戏门禁，也未声称发现新的线上缺陷。源码基线之前的完整回归结果见 [第十一轮记录](architecture-refactor.md#第十一轮以角色为中心追踪能力和状态别名)。
