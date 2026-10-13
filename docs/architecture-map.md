# 游戏模块架构图与状态所有权

行为基线：`9139545`；边界与路径更新于 2026-10-13，与本文件同提交的源码对应。原始问题及探针保留在 Git 提交 `c30d1a2`；本图展示落实后的结构，实施和验收见 [重构记录](architecture-refactor.md)。

这是一张分成十个视图的架构地图。图中的箭头按标签表示调用、数据流或状态持有，不等同于 import；模块名省略共同目录时在图前注明。`F1`～`F6` 对应后面的完成对照。目录选择与任务定位见 [战斗代码导航](../shared/game/README.md)，静态模块全量索引见 [模块索引](architecture-module-index.md)。

已经收回的写权限包括实体资源、组件状态、AI 记忆、角色运行时、对局开关和统计计数：AI 只消费冻结观测与候选，角色求值消费事实，角色装配与固定阶段归角色层，房间聚合独占成员和生命周期。对局本身的剩余公开状态另列在末尾复查清单中。图中仍保留必要的跨所有者命令与适配关系；它们必须通过领域操作同步完成，不能退回共享字段赋值。

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
    clock["shared/game/runtime/fixed-step-clock.js<br/>固定 30Hz 步进"]
    dispatch["shared/game/runtime/action-dispatcher.js<br/>动作与领域资格校验"]
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
    NP["adapters/navigation-port.js<br/>只读运动参数与飞行提交操作"]
    CP["adapters/ship-combat-port.js<br/>武器端口与承伤端口"]
    COL["adapters/collision-port.js<br/>实时只读几何与位移操作"]
  end
  subgraph rules[规则与角色扩展]
    HD["systems/hull-damage.js<br/>攻击增幅、分摊、扣血、死亡顺序"]
    CR["characters/abilities/character-rules.js<br/>属性、资格、伤害、控制、广播"]
    SE["characters/assembly/ship-effects.js<br/>初始化、净化、专属移动、命中扩展"]
    DEST["characters/interactions/ship-destruction.js<br/>伴随清理、猎杀后继效果"]
    ROLE["角色运行时<br/>光球、震慑、抓痕、形态、可靠效果"]
  end
  PUB["F2 · Ship 私有基础状态<br/>资源、运动、归属、存活、偏移<br/>getter 发布，无原始导航 setter<br/>资源比例意图校验后提交"]
  PROJ["projection/ship-projection.js<br/>projection/status-effects.js<br/>独立协议数据"]
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
  CR -->|F4：即时采样，求值器不接收实体| FACTS["characters/abilities/attribute-facts.js<br/>characters/abilities/attribute-evaluation.js"]
  ROLE -->|调用领域操作| S
  HD -->|死亡端口| DEST
  DEST --> TEAM
  S --> PROJ
  PROJ -.->|读数，不推进| ROLE
```

导航、武器、效果分别持有自己的状态，Ship 持有基础机体与生命周期。生命、能量、坐标、存活和归属不能直接赋值；航线、目标、击退和武器周期也不再有属性 setter，航线不能由外部构造进度和长度；角色效果只能提交位移、资源比例意图、伤害等领域操作。`grantResources` 使用当前容量与余额计算消耗、恢复及保底，拒绝未知字段、非法比例、致死消耗与死亡奖励；不再接收最终 hp/energy 覆盖值。Scout/Wingman 同样私有持有运动、任务、武器和寿命，任务输入隔离引用，成员发布和转移校验归属与唯一性。

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
    FC["systems/targeting-system.js<br/>FleetFireControl<br/>当轮集火分配"]
  end
  subgraph adapters[各组件能力端口]
    FP["adapters/formation-port.js"]
    SP["adapters/team-skill-port.js<br/>characters/assembly/active-skills.js"]
    AP["adapters/aircraft-port.js"]
    BP["adapters/beam-port.js"]
    VP["adapters/visibility-port.js<br/>常规探测、波纹覆盖与广播采样"]
    FCP["adapters/fire-control.js<br/>候选 DTO 与实体映射"]
  end
  subgraph specific[队级角色组件与运行时]
    HF["characters/haruhi/flagship-port.js<br/>characters/haruhi/flagship-runtime.js<br/>characters/haruhi/flagship.js / characters/haruhi/support.js"]
    SF["characters/tsuruya/sponsor-port.js<br/>characters/tsuruya/sponsor-effect.js"]
    FF["characters/future1096/form-port.js<br/>characters/future1096/flagship-form.js"]
    VW["characters/asakura/vision-wave.js<br/>波纹持有与发波周期"]
    KB["characters/koizumi/barrier.js / characters/koizumi/orb.js<br/>护盾与冲击波队级状态"]
    RP["characters/yuki/radar-port.js<br/>实体采样与识别编号消费"]
    RR["characters/yuki/radar-runtime.js<br/>私有相位、序号与回波"]
    SH["characters/shamisen/hunt.js<br/>猎杀目标与后继选择"]
    BH["characters/bunny-haruhi/form-port.js<br/>队伍支援阶段"]
  end
  M["runtime/battle-runtime.js<br/>由 MatchSimulation 推进"]
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
  ASSEMBLY["characters/assembly/character-assembly.js<br/>characters/assembly/character-team.js<br/>装配并独占队级角色组件"]
  EXT["characters/assembly/registry.js<br/>九角色统一声明"]
  CONTRACT["characters/assembly/extension-contract.js<br/>校验能力、钩子、技能、阶段与投影冲突"]
  EXT --> CONTRACT --> ASSEMBLY
  T -->|装配与领域操作| ASSEMBLY
  ASSEMBLY ==>|角色组件| HF & SF & FF
  ASSEMBLY -->|消费声明中的有序钩子| VW & KB & SH & BH & RP
  RP -->|值样本| RR
  RR -->|待识别编号| RP
  RP -->|本方阶段内同步识别| S
  T -->|装配能力读取私有雷达投影| ASSEMBLY
  TP -.->|仅公开扫线| RP
  LAUNCH["characters/interactions/character-launch.js<br/>技能机群、随机支援与光线规则"]
  ASSEMBLY & SP & BH --> LAUNCH
  LAUNCH -->|统一接收成员及入队光线| T
  M -->|A 后 B 固定顺序| T
  T -->|逐实体推进、立即开火| S
  TP["projection/team-projection.js<br/>角色与通用状态的协议投影"]
  T -->|只读序列化| TP
  TP -.->|消费状态| VW & KB & SH & HF
```

长门雷达状态只归 `RadarRuntime` 所有；它不持有 Team、Ship、Match 或端口回调，仅接受位置、可见性、时间等值样本，返回待识别编号。`radar-port` 同步提交识别，随后才处理另一方；该标志不参与同轮其他目标的扫描计算。Team 通过角色装配能力读取私有回波，公开投影只读扫线。通用视野适配器不再保存长门状态。

角色效果要生成实体或转移阵营时，会调用集合所有者的领域操作；这种跨所有者命令本身是合理的。集合所有者现在统一验证唯一性和归属，实体转移先验证后修改双方成员。伴随转换先预检，再同步清理可靠效果和弹体、提交角色状态；失败不产生部分副作用。

## 图四：九角色的运行时与消费关系

```mermaid
flowchart LR
  DEF["characters/catalog.js<br/>冻结角色定义、技能元数据"]
  AS["characters/assembly/active-skills.js<br/>消费角色声明中的主动技能"]
  SE["characters/assembly/ship-effects.js<br/>专属技能、净化和命中挂接"]
  CR["characters/abilities/character-rules.js<br/>跨角色属性及资格组合"]
  PROJ["projection/ship-projection.js / projection/status-effects.js<br/>AI bridge/observation.js<br/>分别生成表现与策略读模型"]
  PH["F5 · characters/assembly/character-assembly.js<br/>characters/assembly/registry.js / extension-contract.js<br/>统一声明、冲突校验、固定阶段装配"]
  subgraph haruhi[普通春日]
    H["characters/haruhi/flagship-runtime.js<br/>强化到期与同帧保护"]
    HS["characters/haruhi/support.js<br/>来源私有调度、支援池、冲撞冷却"]
    HP["characters/haruhi/hero-power.js<br/>characters/haruhi/hero-power-runtime.js<br/>勇者之力事件、震慑"]
  end
  subgraph bunny[兔女郎春日与伴随阿虚]
    BC["characters/bunny-haruhi/config.js"]
    BP["characters/bunny-haruhi/rules.js<br/>纯形态、舞台、资源意图"]
    BR["characters/bunny-haruhi/form-port.js<br/>受限形态事务能力适配"]
    FORM["characters/bunny-haruhi/form-runtime.js<br/>形态历史与同步事务"]
    STAGEPORT["characters/bunny-haruhi/stage-port.js<br/>实体到编号、事实与有限命令"]
    STAGE["characters/bunny-haruhi/stage-runtime.js<br/>舞台区域、接收者、持续游标"]
    BPROJ["characters/bunny-haruhi/projection.js<br/>只读协议投影"]
    BS["characters/bunny-haruhi/support.js<br/>显式副舰支援来源"]
    BCP["characters/bunny-haruhi/companion-rules.js<br/>纯伴随与策反计划、资格"]
    BCR["characters/bunny-haruhi/companion-runtime.js<br/>伴随关系、可靠效果、归还与跟随"]
  end
  subgraph other[其他角色]
    K["阿虚：characters/kyon/extension.js<br/>ShipStatus / FleetFormation<br/>被动编队倍率、可靠增益"]
    Y["长门：characters/yuki/radar-port.js<br/>characters/yuki/radar-runtime.js<br/>雷达；AircraftOperations + Scout 负责侦察"]
    KO["古泉：characters/koizumi/barrier.js<br/>characters/koizumi/orb.js<br/>护盾、光球、接触与冲击波"]
    FU["未来1096：characters/future1096/flagship-form.js<br/>BeamSystem<br/>队级形态与副舰蓄力光线"]
    TS["鹤屋：characters/tsuruya/sponsor-effect.js<br/>characters/interactions/support-conversion.js<br/>赞助与战区策反事务"]
    A["朝仓：characters/asakura/vision-wave.js<br/>systems/vision-wave-purge.js<br/>ShipStatus / characters/interactions/character-contacts.js"]
    SH["三味线：characters/shamisen/hunt.js<br/>characters/shamisen/claw.js<br/>猎杀、抓痕、猫爪弹体"]
  end
  EX["systems/expanding-wave.js<br/>通用波前命中与历史"]
  CONTACT["characters/interactions/character-contacts.js<br/>rules/contact-geometry.js<br/>角色接触及几何资格"]
  BR --> FORM
  STAGEPORT --> STAGE
  STAGE -->|有限命令| STAGEPORT
  BPROJ -.->|只读| FORM & STAGE
  PROJ --> BPROJ
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
  PH --> BR & STAGEPORT & BCR & HS & HP & KO & A & SH
  CR -.-> H & K & KO & FU & SH & BR & BCR
  PROJ -.-> H & HS & HP & BR & BCR & Y & KO & FU & A & SH
```

| 角色 | 主要权威状态所有者 | 写入/消费的特殊约束 |
| --- | --- | --- |
| 春日 | 强化组件、支援来源存储、勇者之力运行时 | 强化与支援解锁顺序不变；震慑必须在开火前生效 |
| 兔女郎春日 | BunnyFormRuntime、BunnyStageRuntime、支援来源存储 | 形态和解锁一起发布；双方舞台先采样后提交 |
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

相对路径位于 `shared/game/ai/`，BotController 位于该目录的 `bot-controller.js`。

```mermaid
flowchart LR
  MATCH["MatchSimulation"]
  RUN["bridge/runner.js<br/>每席随机流与驱动"]
  BOT["bot-controller.js<br/>Proxy 数据参数校验<br/>不发布端口或随机流，链式返回留在门面"]
  RP["policy/rule-policy.js<br/>RulePolicy：私有调度、模式与计划提交"]
  OBSBUILD["bridge/observation.js<br/>实体到有权知道的纯数据"]
  PORT["bridge/action-port.js<br/>观察缓存、提交动作、失效"]
  OBS["F1 · 深只读观测缓存<br/>普通与 strict 模式一致隔离"]
  INDEX["F1 · policy/observation-view.js<br/>私有 Map、冻结数组、只读 ID 集合"]
  PARAM["params/index.js<br/>default.js / difficulty.js / presets.js<br/>冻结参数"]
  subgraph private[真正私有的状态组件]
    INTEL["policy/state/intel-tracker.js<br/>已确认记忆、反应延迟队列"]
    BELIEF["policy/state/belief.js<br/>搜索概率网格"]
    SCOUT["policy/tactics/yuki-scout.js<br/>ScoutDoctrine：缓存、承诺、重编组"]
    SKILL["policy/state/skill-decision-cycle.js<br/>技能时钟、历史决策"]
  end
  subgraph heuristics[受限能力启发式]
    READ["policy/view.js<br/>policy/heuristics/energy.js / context.js<br/>逐方法声明事实及查询输入"]
    PURE["policy/algorithms/<br/>geometry.js / evaluation.js / mode.js<br/>显式数据计算，无策略回调"]
    SAMPLE["policy/fact-calculations.js<br/>按需采样当前观测与接触"]
    PLAN["policy/heuristics/<br/>split.js / detached.js<br/>targets.js / movement.js"]
    ACT["policy/commands.js / debug-state.js<br/>policy/heuristics/scout.js / skills.js"]
  end
  SEARCH["F3 · policy/state/search-navigation.js<br/>私有区域、游标、方向、推进时间<br/>候选凭证与版本校验，显式消费"]
  TACTIC["policy/tactics/bunny-stage.js<br/>character-counterplay.js / shamisen-hunt.js"]
  FACT["policy/characters/decision-view.js<br/>复制并冻结事实和输入"]
  PROFILE["policy/characters/index.js + 九个角色档案<br/>冻结注册表、纯角色决策"]
  DISPATCH["../runtime/action-dispatcher.js<br/>标准动作；侦察扩展由桥适配"]
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
  PROGRAM["policy/policy-program.js / policy-inputs.js<br/>每算法独立输入清单<br/>动作后事实显式重读"]
  RP -->|执行计算| PROGRAM
  PROGRAM --> READ & PLAN & ACT
  PROGRAM --> SAMPLE --> PURE
  PURE -->|估值与模式候选| RP
  RP -->|走位准备后提交搜索| SEARCH
  PROGRAM -.->|子调用只取得自身声明的依赖| READ
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

AI 没有实体兼容通道，也不再通过 `port/rng` getter 或配置操作的链式返回泄露底层能力。观测与索引只读；搜索候选查询不推进游标，实际命令显式消费候选。启发式不再安装到 RulePolicy 原型，也没有隐式 this 或共同继承的大读取上下文。每个算法在参数与 policy-inputs 中明确声明直接依赖；查询不能取得动作与调度权限。战力、威胁、几何和模式计算直接接收事实；随机模式规划显式消费随机能力并返回结果。执行算法通过明确的重读函数取得动作后的新观测。走位由协调器先读准备事实，再提交搜索与模式，最后执行路线，不从启发式绕回协调器选模式。卡死采样和移动结果返回协调器提交；能量算法返回换挡意图；分离由协调器逐次规划和提交，第二次规划重新观察第一次动作结果。诊断只读，不靠覆写策略方法采样。情报外推只在同一观测和参数下复用，动作后立即失效。

## 图六：实际单帧顺序

此图来自 `MatchSimulation.update()` 的取时步骤与 `BattleRuntime.update()` 的战斗阶段，保持代码顺序。箭头是先后顺序，不是模块 import。A、B 的顺序是当前行为的一部分。AI 与常规开火开关由对局私有持有，外部只能调用设置方法；每席轮到执行时读取当前开关，因此前一席的变更立即影响后一席。

```mermaid
flowchart TB
  I["服务端 applyQueuedInputs<br/>或单人即时动作提交"]
  T["MatchSimulation → SimulationTime<br/>原子发布 tick + 1 / elapsed + safeDt"]
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
  BULLET["ProjectileSystem 私有活集合<br/>拦截 → 移动/命中 → 存活集合发布 → 阶段收尾"]
  FX["爆发、飘字、反馈寿命推进"]
  CLEAN["伴随/来源清理 → 兔女郎视野刷新"]
  WIN["胜负检查 → 私有终局一次提交"]
  OUT["按消费者节拍投影<br/>权威快照、雷达、统计、显示"]
  I --> T --> B0 --> H --> AI --> TEAM --> HERO --> CONTACT --> PURGE
  PURGE --> VIS --> BEAM --> FIRE --> BULLET --> FX --> CLEAN --> WIN --> OUT
```

不能把所有状态“延后统一消费”。伤害分摊、死亡、封印、支援、净化、技能冷却及后续 AI 观察都存在同帧因果关系。可集中的是各状态的写入所有者和阶段入口；只对需要公平同时观察的规则先统一采样，例如双方舞台与净化目标。

## 图七：属性、控制与承伤的事实求值

```mermaid
flowchart TB
  S["Ship 属性与资格查询"]
  R["characters/abilities/character-rules.js<br/>实体读取适配边界"]
  M["Team / FleetFormation<br/>只返回编队成员关系"]
  A["characters/abilities/attribute-facts.js<br/>sampleAttributeFacts / sampleControlFacts<br/>sampleImmunityFacts / sampleDamageFacts"]
  REL["伴随、可靠与舞台来源关系<br/>创建或授予时登记 WeakMap<br/>即时校验存活、归属、成员资格"]
  FACT["冻结普通事实<br/>时间、效果、形态、数值<br/>不含实体、世界、回调"]
  E["characters/abilities/attribute-evaluation.js<br/>纯属性、控制、免伤、承伤和航速求值"]
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
  TELEMETRY["runtime/match-telemetry.js<br/>MatchTelemetry 私有计数<br/>动作、攻击、伤害、舰损事件"]
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
  MATCH ==>|独占统计实例| TELEMETRY
  MATCH -->|即时事件| TELEMETRY
  TELEMETRY -.->|结算副本经 statisticsSummary 读取| RECORD
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
| F5 角色接入 | CHARACTER_EXTENSIONS 统一声明主动技能、规则、钩子、队级/对局工厂及投影；装配器校验 | 独立声明直接接入；未知阶段、重复顺序、能力/投影冲突与覆盖生命周期均拒绝 |
| F6 房间多写 | Room 聚合；SnapshotSchedule | 重复席位、冒名就绪、外部赋值拒绝；倒计时/运行/完成及快照顺序保持 |

对应源码分别见 [观测端口](../shared/game/ai/bridge/action-port.js)、[舰船](../shared/game/model/ship.js)、[搜索所有者](../shared/game/ai/policy/state/search-navigation.js)、[属性事实](../shared/game/characters/abilities/attribute-facts.js)、[角色装配](../shared/game/characters/assembly/character-assembly.js)、[房间聚合](../server/room.js)。测试入口为 `scripts/verify-domain-boundaries.mjs`，完整证据记录在重构记录中。

## 保留的合理耦合与验收边界

- 角色规则知道角色身份、形态及效果含义；通用算法只消费能力或事实。封装的目标是限制权威存储和职责，不是消除全部领域依赖。
- 角色事务适配层负责生成、转移、清理、命中等跨所有者操作，仍会取得领域实体；它只能使用领域命令，不能直接修改私有存储。纯求值层不取得这些能力。
- Team/Match 保留领域门面，已有调用者和测试可调用明确操作；角色状态、投影和阶段顺序已转交对应所有者，门面不再保存第二份状态。
- 冻结 AI 观测、事实和历史会产生分配开销；只在有明确身份和失效规则的地方复用。没有通过改变规则、延迟到帧尾或重刷回放来换取性能。
- 自动化覆盖固定种子、全部核心角色、浏览器和本地网络；不能推导出任意对局穷尽证明，也不替代真人多端体验。未推送、未部署。

## 沿角色调用链的再次复查（2026-10-11）

本轮不以依赖图无环代替判断；核对了装配、施放、属性读取、移动/击退、支援生成、弹体与承伤、伴随转队/死亡清理，以及 AI 观察→候选→提交→重新观察的实际链路。

| 本轮残留 | 原来的实际问题 | 现在的所有权边界 |
| --- | --- | --- |
| 专属发射回绕 | 春日/长门运行时经 Team 进入通用航空组件，由后者持有技能参数与随机生成规则 | `character-launch` 决定专属规则，Team 接收成员/光线，航空组件只管理生产与生命周期 |
| Ship 原始替换入口 | 私有组件仍接受航线、目标、击退和冷却 setter，航线长度/进度可以绕过几何约束 | 只读属性；航线通过导航约束生成，击退同步停船清航线，完成时失效读视图 |
| AI 过宽能力及回绕 | 冻结启发式上下文仍能提交动作、推进搜索、回调策略选模式 | 查询与执行分开；每个执行入口列出能力，搜索/模式提交由 RulePolicy 顺序编排 |
| AI 对外能力泄露 | 策略 getter 发布动作端口/随机流，链式配置返回原始策略，可绕过门面校验 | 底层能力留在桥接和策略内部，链式调用继续返回受校验门面 |
| 支援旧快照消费 | 冷却消费相信调用方的旧资格样本，重复使用可能重入消费 | 私有所有者重新校验并提交，旧样本不能授权或阻止当前消费 |

保留的关系均有明确用途：成员集合里的活实体用于同步领域命令；承伤仍即时分摊并完成死亡收尾；属性适配层组合可替换的规则能力；角色运行时持有来源身份以处理同帧死亡与转队。这些调用保留即时状态语义，不把内部可写容器交给消费者。


## 图九：资源事务与 AI 计划的实际消费边界

```mermaid
flowchart TB
  subgraph character[角色变身同步事务]
    direction TB
    REQUEST["SkillCycle：校验施放资格"]
    FORM["BunnyFormRuntime<br/>纯计划与形态历史"]
    SAMPLE["适配器采样旧运动、支援解锁<br/>不发布半提交形态"]
    COMMIT["发布形态与支援"]
    RESOURCE["Ship.grantResources<br/>当前容量和余额校验<br/>比例意图转为资源落值"]
    MOTION["换算本舰与伴随运动<br/>必要时生成伴随"]
    COMPLETE["SkillCycle<br/>冷却、统计、显形、视野"]
    REQUEST --> FORM --> SAMPLE --> COMMIT --> RESOURCE --> MOTION --> COMPLETE
  end
  subgraph ai[AI 逐次规划与消费]
    direction TB
    OBS["最新只读观测与记忆"]
    FACT["fact-calculations<br/>本次计算所需事实"]
    EVAL["纯估值、威胁、几何、模式评分"]
    PLAN["候选或明确动作意图"]
    OWNER["RulePolicy<br/>提交私有计划与调度"]
    ACTION["动作桥<br/>校验并立即提交"]
    INVALIDATE["失效观测<br/>下一次规划重读"]
    OBS --> FACT --> EVAL --> PLAN --> OWNER --> ACTION --> INVALIDATE --> OBS
  end
```

资源校验失败不会部分扣费或发放同次资源奖励；角色事务仍在既有同步调用栈中完成。需要同步观察双方的舞台只统一采样区域；伤害、死亡、分离和后续 AI 观察仍按图六的顺序即时消费。协议字段顺序由 `projection-order.js` 保留，角色自行贡献投影字段，投影不能推进状态。

四项工作的源码入口分别为 `model/ship.js`、`characters/bunny-haruhi/form-runtime.js` 与 `characters/bunny-haruhi/stage-runtime.js`、`characters/<角色>/extension.js` 与 `characters/assembly/extension-contract.js`、`ai/policy/fact-calculations.js` 与 `policy-inputs.js`。剩余实体引用集中在需要同步领域操作的适配器；纯状态机与数值算法不取得世界对象。该边界约束合作代码的职责，不宣称 JavaScript 模块是对恶意代码的安全沙箱。

## 2026-10-13 复查：已落实与下一层边界

本次沿实际读写入口发现并处理了三处残留：长门雷达的算法/状态与实体适配混合、AI/开火开关的对象直写入口、统计模块只拆函数而仍由 Match 公开计数表。对应实现和验收见 [重构记录](architecture-refactor.md)。

本次继续收紧后，时钟、终局、弹体集合和碰撞历史的开放入口均已关闭，见图十。还没有因此宣称整个对局聚合完全封闭：表现集合、实体编号源及部分装配引用仍可进一步收权，弹体实体本身也仍有公开字段；本次收回的是集合的创建、成员发布、来源清理与阶段消费权限。复查未发现生产模块绕过新的四类所有者写入；这不等于对其他状态作穷尽证明。

此外，一些角色端口仍需要完整领域对象完成生成、转移、承伤和立即查询；这是下一步收窄能力面的候选，但不能把必要的同步事务全部换成延迟事件。此次没有发现 AI 恢复实体兼容输入，通用组件仍由角色适配器提供规则能力；这只是本次检查范围的结论，不是全仓穷尽证明。

## 图十：逻辑时间、终局、弹体与接触历史

```mermaid
flowchart LR
  subgraph production[生产权威入口与战斗能力]
    MATCH["runtime/match-simulation.js<br/>MatchSimulation.update"]
    TIME["runtime/simulation-time.js<br/>SimulationTime 私有时间<br/>只能逐步 advance，无跳时/重置"]
    WORLD["runtime/battle-runtime.js<br/>BattleRuntime 基类<br/>只读取时间，按固定阶段消费"]
    OUTCOME["私有 outcome<br/>phase + winnerSeat 原子提交<br/>checkVictory 只提交一次"]
    COLLISION["systems/collision-system.js<br/>HullCollisionSystem<br/>私有接触 Set + 迟滞判定"]
    SHOTS["systems/projectile-system.js<br/>ProjectileSystem 私有活数组<br/>创建、来源清理、遍历与存活发布"]
    PHASE["characters/interactions/projectile-phase.js<br/>拦截、推进/命中、护盾恢复"]
    READ["成员只读视图 / 序列化副本<br/>AI、角色与表现消费者"]
    MATCH ==>|私有实例及唯一推进入口| TIME
    TIME -.->|冻结时间样本，只读能力| WORLD
    MATCH -->|先取时，再调用继承的战斗阶段| WORLD
    WORLD ==>|结果所有权| OUTCOME
    OUTCOME -.->|已终局则不推进| MATCH
    WORLD ==>|私有系统| COLLISION & SHOTS
    WORLD -->|即时船体端口与当前时间| COLLISION
    WORLD -->|当轮角色阶段能力| SHOTS
    SHOTS -->|逐弹拦截再推进，发布后收尾| PHASE
    SHOTS -.->|成员不可增删/替换| READ
    OUTCOME -.->|只读胜者及阶段| READ
  end
  subgraph tests[仅测试目录的独立场景]
    SAMPLE["scripts/core-tests/scenario-simulation.mjs<br/>ScenarioSimulation + 假时间源"]
    SCENARIO["独立的 BattleRuntime 场景实例<br/>消费指定时刻，单独触发角色阶段"]
    SAMPLE -->|指定时间样本；禁止传入真实 MatchSimulation| SCENARIO
  end
```

生产 MatchSimulation 不接受外部时钟；场景测试没有访问或覆写它的私有字段。世界依然使用同一套角色、实体、阶段和胜负规则，假时间源不复制战斗算法。真正的对局推进由时间专项、原始回放和权威一致性验证，不能以跳时场景替代。

弹体遍历捕获当轮的活数组，普通追加立即进入同轮；如果来源清理发布了另一个集合，本轮仍按原数组遍历和最终筛选，保持旧调用语义。存活集合发布后才执行收尾，收尾新增保留到下一帧。成员视图冻结的是成员关系，不把其中实体伪装成纯快照。碰撞系统逐对读取前一次位移后的实时几何，只在新接触时施加减速，释放余量和成员离场由系统自己更新历史。
