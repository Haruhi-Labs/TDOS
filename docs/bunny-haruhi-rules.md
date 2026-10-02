# 兔女郎春日：配置与纯规则

当前完成配置与纯规则、支援有限抽取、舞台与变身及阿虚接入。权威内核已支持该角色，但仅在显式内部模拟开关下构造，公开角色目录、选角和随机池仍不包含它。规则版本更新为 `ruleset-20261002-01`；公开版本和网络编码版本不变。没有新角色的对局继续沿用原行为和原快照字段。

## 模块与调用边界

| 文件 | 职责 |
| --- | --- |
| `shared/game/bunny-haruhi-config.js` | 深冻结的独立基础值、技能ID、三项支援池、形态/舞台枚举、所有新倍率和时长 |
| `shared/game/bunny-haruhi.js` | 状态工厂、成功施放序列、资源方案、舞台状态转换、纯属性查询、持续区间计算 |
| `shared/game/bunny-haruhi-companion.js` | 伴随舰基础值派生、独立状态、可靠技能周期、策反/归还/退场意图及接收者生命周期 |
| `shared/game/haruhi-support.js` | 共用支援状态、有限池抽取、旧节拍调度、光球几何与碰撞冷却 |
| `shared/game/bunny-haruhi-support.js` | 显式副舰来源、三项池以及新来源封印/恢复策略 |
| `shared/game/bunny-haruhi-runtime.js` | 内部构造定义、施放提交、舞台采样、持续资源、广播、来源清理及白名单摘要 |
| `shared/game/bunny-companion-runtime.js` | 注入实体工厂、跟随、死亡清理、自动技能、临时换队、母舰形态查询及公开摘要 |
| `scripts/core-tests/bunny-haruhi-suite.mjs` | 上述规则的边界测试，默认随 `test:core` 执行 |

纯规则依赖仅为配置、共用支援及已有推进/数学叶模块。运行时适配层可读取角色目录、调用注入的Ship工厂，但不反向导入战斗入口、服务端或显示模块，不新增依赖包。配置完全独立于普通春日，不能通过修改旧角色对象构造变体。普通春日和兔女郎的状态工厂调用同一个 `createSupportState`，各自持有独立容器。

形态、舞台和伴随舰纯规则不修改传入对象、不调用随机数、墙钟、音效或实体工厂。工厂每次创建新的 Set、数组及局部对象。返回状态可共享未改变的子对象，按只读值使用；提交者替换状态，不能把历史结果作为另一条可变权威状态并行保存。施放方案额外复制支援容器，允许奖励事务在新方案上准备。支援模块沿用旧模块的原地更新合同，只能推进当前权威状态或尚未发布的事务副本，具体随机数和回调边界见下文。

时间均为模拟 elapsed 的绝对秒数，`tick` 为非负整数逻辑帧。暂停不推进时间，截止采用 `now >= until`，调用者保证时间单调。资源采用有限浮点数，保持 `0 <= hp <= maxHp`、`0 <= energy <= maxEnergy`、`maxHp > 0`；非法工厂/施放参数抛出中文错误，合法但生命代价不足返回失败。这里不是网络输入校验层，不能直接使用客户端传入的资源、倍率、时间或授权标记。

## 状态合同

状态工厂与源文件 JSDoc 是实际字段定义；以下说明字段的归属和寿命。

| 状态 | 字段及用途 |
| --- | --- |
| `BunnyHaruhiState` | `form=neutral`，`successfulCasts=0`，`formStartedAt=0`、`formStartedTick=-1`；`visitedForms` 为首次奖励 Set；`scoutsDisabled`、`positiveSuppressed` 初始 false；`immunityUntil/drainUntil/broadcastUntil` 初始0；`companionId=null`、`companionSpawned=false`；独立 `support` |
| `support` | `supporters` 空 Set，`queuedBeamAt` 空数组，`alienNextAt/timeTravelerNextAt/otherworlderReadyAt/esperAngle` 初始0。保留未来与旧支援工厂统一的结构，不代表新角色可获得宇宙人 |
| `BunnyStageExposure` | `sourceShipId/enteredAt=null`、`inside=false`、`phase=none`、`phaseStartedTick=-1`；`nextEntryControlAt=0`、`firstEntranceHealConsumed=false` 属于整局历史；锁定和恢复的三个时间字段初始0 |
| `BunnyCompanionState` | 永久 `ownerShipId/ownerSeat`；`convertedUntil=0`；出生 `nextReliableAt=now+20`；`reliableUntil=0`、`reliableStartedTick=-1`；独立 `followOffset={forward:-28,lateral:24}`，距离使用世界单位 |
| 接收者可靠技能状态 | `sourceCompanionId`、`until=now+6`、`startedTick`、`suppressed=false`；母舰和阿虚分别创建，周期只归伴随舰状态管理 |

已由 `serializeBunnyShip` 提供白名单摘要；成功施放“序列函数”仍指形态次序，不是将 Set 或私有奖励历史直接发往客户端。没有新来源或接触历史的旧角色不创建新字段，具体公开字段见下文。

## 施放方案与序列

`nextBunnyForm(state)` 只读取成功次数：`bless → knows → bless → encore → bless → knows → …`。涤除、当前形态或支援结果不改变次序；encore仅一次。

`planBunnyTransform(state, {hp,maxHp,energy,maxEnergy}, now, tick)` 返回：

- 成功：`{ok:true, reason:null, state, hp, energy, cooldownSeconds, unlockSupport, spawnCompanion}`。
- 失败：`{ok:false, reason:"dead"|"insufficient_hp"}`，无待提交状态或奖励。

bless要求 `hp > maxHp*0.15`，直接扣除最大生命15%，能量补至至少80%；knows不支付即时生命，同样补能，创建4秒免伤、16秒自损及广播窗口；encore恢复20%最大生命，上限截断。已高于80%的能量不降低，零能量可生成成功方案。

方案中的 `unlockSupport` 仅首次到达各形态为true，一共三次；提交层使用支援接口完成无放回抽取。`spawnCompanion` 表示首次encore生成意图；提交时实际构造阿虚，填写稳定 `companionId` 并保留永久 `companionSpawned=true`，死亡不重生。前一阶段的待生成占位标记已移除。

`commitBunnyTransform` 验证真实副舰槽位、存活、分离、控制、沉默、光球、全局封印、CD及生命代价，然后在支援状态副本上抽取奖励并提交形态、资源、必要的阿虚实体、队伍冷却和记录。调用纯方案但未提交不推进次数、不扣血、不消耗随机数；重复计算同一输入也不能多次发放奖励。冷却30秒由现有队伍冷却管理，受鹤屋冷却流速影响，不引入第二份倒计时。实体仅由可信配置和固定工厂构造，不接受客户端构造参数。

`purgeBunnyForm(state,tick)` 保留同tick新施放效果；之后仅压制bless正倍率或清除knows免伤，保留生命代价、自损、广播和永久进度。下次成功切换重置正倍率涤除标记。`clearBunnyFormWindows(state)` 清除临时窗口，保留永久历史；死亡实体不再参与查询，运行时适配器同时清来源及退场。

## 属性、能量与持续结算

`bunnyStatMultiplier({form,stage,reliable,enabled}, statKey, now)` 的 `form` 是形态状态对象。返回三个来源的乘积，不含任何旧队伍加成、难度或单飞加成。只接受既有属性键 `speed/turnRate/accel/range/vision/damage/fireRate/regen`，其余返回1。缺失状态返回中性值。实际属性仍由旧计算结果乘本函数的结果。

- bless：航速1.15、转向/加速1.2、射程/视野1.1、伤害1.25、射速1.2，炮击输出乘积1.5。
- knows：五项机动/感知属性0.8、伤害和射速各0.7，输出乘积0.49。
- 哑口无言：航速和射速各0.9，自然回能为0；入迷：七项战斗属性各1.2，恢复自然回能。
- 可靠技能：转向1.2、航速/伤害1.06、加速1.1，其余1；不附带普通阿虚的减伤。

`bunnyDamageTakenMultiplier(form)` 只返回bless的1.2易伤或中性1；`isBunnyDamageImmune(form,now,enabled)` 只判断knows剩余窗口，不代表免控。现已接入 `Ship.isDamageImmune`，在分摊前返回。`isBunnyBroadcasting` 表示bless持续广播或knows的16秒广播；均只广播己方存活玩家舰位。主舰舞台额外广播其圆内己方玩家舰位，包括源主舰，不广播召唤物。

`enabled=false` 暂停形态正倍率、舞台效果、可靠增益、免伤、广播及encore锁档；bless易伤和knows降属性保留。自损与治疗区间查询也显式传该开关，封印期间不结算，解除后不补过期时间。永久侦察资格不因封印恢复。

`bunnyStageSpeedFactor(stage,now,enabled)` 返回控制锁的0、恢复阶段的线性0至1、或正常1，必须在移动处另乘；锁定期间是否允许射击/操作使用 `isBunnyControlLocked` 判断，不能把航速0当作全部控制效果。

`bunnyEnergyRate(stage,regen,moveDrain,throttle,enabled)` 在哑口无言时返回纯推进负收支，其他情况完整委托旧 `energyRateForThrottle`。不能只给旧函数传regen=0，因为旧函数仍保底每秒1.2回能。瞬间补能独立于这个查询。

`canBunnyLaunchScout(form)` 只表达本角色的额外资格，其他侦察权限仍由原入口验证。`resolveBunnyThrottle(form,requestedThrottle,enabled)` 在encore时返回现有推进表中的4档1.4，否则返回输入；不改变实际航速、耗能或其他角色档位规则。不会新增规划旧文本提及、但当前项目已经移除的急刹功能。

`bunnySelfDrainAmount(form,{from,to,hp,maxHp,enabled})` 与 `bunnyStageHealAmount(stage,同参数)` 返回本区间的正扣血量/治疗量，不修改生命。按有效窗口交集积分：knows每秒最大生命0.5%，16秒总8%，最低1HP；入迷从 `enteredAt+10` 起每秒0.4%，不溢出、不复活。区间零长度返回0；跨截止点只算有效部分。

持续结算调用者负责区间不重叠，每个权威区间仅应用一次；在形态切换、离圈、封印和死亡边界拆分区间。成员关系查询可每tick多次执行，不能因此重复应用持续量。先结清旧状态区间再替换状态；新入圈不会追溯治疗旧区间。分30Hz片段与一次积分在浮点误差内相同。

## 舞台生命周期

`resolveBunnyStageExposure(state,{inside,sourceShipId,now,tick})` 返回 `{state,healRatio}`，不读取坐标或实体列表。实际调用者 `resolveBunnyStages` 先采样双方同一阶段的权威圆，再更新成员关系，仅传存活敌方三个玩家舰位，圆边界用舰船中心，召唤物不进入此路径。

入圈设置哑口无言和连续计时；控制冷却满足时触发0.5秒锁定与1.5秒恢复，下次控制时刻为入圈时间+15。连续10秒进入入迷，并只在整局首次返回0.15治疗比例，满血同样标记领取。重复检查不重发治疗或刷新控制。改变来源视为新入圈，但保留目标历史。

`inside=false`、`leaveBunnyStage(state)` 用于离圈、来源死亡、目标死亡及舞台封印清场：只保留 `nextEntryControlAt` 与 `firstEntranceHealConsumed`。`cleanseBunnyStageControl` 只清此次锁定/恢复，保留在场阶段、历史及冷却，重复成员查询不能恢复已清控制。

## 伴随舰与可靠技能生命周期

`deriveBunnyCompanionBase(baseStats)` 默认取独立配置，返回冻结的基础属性。默认HP308、能量65、伤害11.6、射速0.282、速度33、转向0.36、加速1.02、射程416、视野103.2、回能6.25、耗能4.1、半径8.96。参数必须是未受难度、形态或团队增益影响的基础值。实体构造时生命按出生队伍难度缩放一次；伤害动态读取当前队伍难度。阿虚排除单飞射速奖励。

`advanceBunnyCompanion(state,{now,tick,alive,ownerAlive,sameOwnerTeam,canAct,enabled})` 返回新 `state` 与五个布尔意图：`triggerReliable/returnToOwner/retire/clearReliable/clearProjectiles`。`sameOwnerTeam` 意为双方仍在永久出生阵营；`canAct` 包括未沉默、未失控；所有标记来自权威实体。

到20秒且条件满足时触发一次6秒增益，下一次为now+20；条件不满足同样重排，不积压。迟到一次更新也只触发一次。母舰死亡优先于归还，活着的阿虚返回退场意图；阿虚已死不再请求重复退场，但仍请求幂等清理。两个死亡分支都不请求归还或触发技能。

`planBunnyCompanionConversion(state,now)` 只对经校验的存活合法目标调用：策反截止now+5，周期为null，清来源增益，并返回清接收者与炮弹的意图。到期归还时重新排now+20，不立刻触发。owner字段始终不改；实际队伍转移、跟随、攻击排除、炮弹销毁和舰损排除已由运行时实体事务处理。转移先于队伍遍历，不能在A/B更新中重复处理。

合法触发后，适配器对母舰和阿虚分别调用 `bunnyReliableRecovery`，各自恢复最大生命6%、最大能量15%；再各自 `createBunnyReliableState(sourceCompanionId,now,tick)`。`purgeBunnyReliable(state,tick)` 保护同帧效果，之后仅压制该接收者；`expireBunnyReliable(state,now,sourceValid)` 在截止或来源死亡/策反时返回null，适配器删除字段。已恢复资源不追扣。被策反时不向属性查询传母舰形态；归还直接读取母舰当前状态，不能重新生成4秒免伤窗口。

## 验证与尚未接入的范围

专项命令：`npm run test:core:bunny-haruhi`；默认 `test:core` 和 `test:logic` 已包含它。专项在内存中运行，不启动服务器或访问身份/统计数据。

测试覆盖冻结/独立工厂、未注册角色、10次成功序列与三次奖励、生命支付边界和零能量、精确倍率与叠乘、同帧涤除、舞台10/15秒及0.5/2秒边界、治疗只领取一次、16秒消耗的区间积分、封印与死亡、可靠20/6秒周期、策反5秒归还及死亡优先级。

后续仍需公开选角/随机池、角色专属AI策略、前端专属素材及HUD和真实跨端显示验收。本阶段复用阿虚角色身份与既有额外舰船显示链路，没有新增素材加载，角色仍未公开。舞台、变身、三项支援及阿虚完整规则已在显式实验对局中可验证。

## 支援有限抽取合同

`haruhi-flagship.js` 保留全部24个旧导出、普通春日旗舰身份判断、主动增益、吸弹线段算法及原快照结构。仅把状态工厂、池抽取、定时调度、环绕几何和异世界人冷却委托给 `haruhi-support.js`。旧 `hasHaruhiSupport` 不识别兔女郎，不替换 `team.haruhiFlagship`，不改旧碰撞/屏障调用方。

| 接口 | 输入、更新与边界 |
| --- | --- |
| `createSupportState(initialAngle=0)` | 保持原六字段及顺序，规范化初始角度；没有额外随机数或新字段 |
| `unlockSupport(state,eligibleIds,now,random)` | 从可信配置提供的有序、无重复池排除已解锁项；实际解锁取一次显式RNG，穷尽取零次；原地保存支援及对应首次时间 |
| `tickSupportSource(source,now,dt,hooks)` | `source={sourceShip,state,enabled}`；按旧顺序补处理宇宙人、排未来人三束光线、逐束回调、转动光球；只由发射回调消费发射随机数 |
| `supportOrbGeometry(source)` | 使用实际来源坐标、半径和有效视野；未启用、死亡、未解锁时返回null，无状态写回 |
| `supportOtherworlderReady(source,now)` / `triggerSupportOtherworlder(source,now)` | 读取/消耗此来源独立8秒冷却；是否实际命中、方向门槛和伤害仍由碰撞层负责 |

旧旗舰适配器保持原生命周期：只在来源死亡时清待发光线，不新增技能封印检查或恢复重排。定时检查继续使用原 `now+1e-9` 容差，追帧次序与状态数组顺序不变。新逻辑不能顺带修正这些历史语义，否则会改变旧回放。

`bunnyHaruhiSupportSource(ship,enabled)` 必须显式传入启用标记，通常来自 `!team.areSkillsDisabled()`。只接受 `bunny_haruhi` 且实际占据 `team.ships.sub1/sub2` 的舰船；其他来源返回null。来源直接引用该副舰与其独占 `bunnyHaruhi.support`，不读取或转借旗舰状态。描述符供本阶段调用，不进入快照，不跨队伍转移缓存。

`unlockBunnyHaruhiSupport(source,now,random)` 固定使用未来人、异世界人、超能力者三项池；未启用或死亡不抽取。只应在形态首次奖励事务中调用，函数本身不负责去重形态事件。事务准备时可把已复制的方案 `state.support` 放入临时source，再在全部校验完成后执行抽取并提交，避免改动旧权威状态。

`updateBunnyHaruhiSupport(source,now,dt,hooks)` 为新来源提供停止/恢复策略：封印或死亡清待发光线，并在其支援状态上惰性记录 `suspended=true`；恢复时把未来人下一次发射排为now+10、清停用标记，不补积压。该可选私有字段只存在于新来源，不扩展旧工厂或旧快照。解锁项不清除，沉默不停止支援，碰撞冷却继续按绝对时间流逝，光球角度在停用时不推进。

`Team.update` 已在旧旗舰支援之后调用新来源适配器，停用时也调用以记录停止。`hooks.launchRandomBeam(sourceShip)` 连接现有 `team.launchHaruhiRandomBeam`，实际方向随机数、蓄力、射程和伤害仍由现有光线实现承担。异世界人共用旧碰撞几何/击退，碰撞和破盾消耗同一来源冷却；超能力者在旧防御链之后按稳定来源ID检查吸弹。

`test:core:haruhi-support` 单独检查两种池的固定种子顺序和消费次数、追帧回调的随机数位置、旧状态/视图字段、时间容差、独立几何/冷却、副舰身份及封印/死亡清队列。默认随 `test:core` 执行；`test:api` 另锁定旧旗舰24项导出。固定旧阵容的完整回放继续用于抽取前后逐帧对比，不能只用单元测试推断旧行为一致。

## 舞台与变身接入合同

内部测试使用 `new MatchSimulation({allowExperimentalBunnyHaruhi:true, teamLoadouts:...})`，只有严格布尔true开启。该选项不是动作或房间协议字段，服务端房间创建不转发它；普通阵容归一化继续排除 `bunny_haruhi`。实验归一化允许其与普通春日同队，仍不允许同ID重复占位。只有实际含新角色才创建 `match.bunnyHaruhiActive`、`bunnySustainAt` 和对应舰船状态；没有新角色时不进入新采样、结算、支援或可见性收尾路径。

`bunnySustainAt` 是最近一次持续资源结算的绝对秒数，初始0，不序列化。每tick沿旧更新顺序插入以下阶段：

1. elapsed推进后、AI及两队移动前：按 `[bunnySustainAt,elapsed]` 有效区间结算自损/治疗，更新游标，清死源并采样双方舞台。
2. 既有移动、冲撞和位移结算后、视野波净化及开火前：再次采样成员关系；新入场即限速/禁控，持续资源不重复计算。
3. 净化之后仅清失效来源，不重新施加入场控制；原视野、雷达、光线、炮击与弹体顺序保留。
4. 伤害及死亡收尾后、胜负检查前：清死源窗口、待发支援、阿虚来源增益和离场状态，并刷新含新角色对局的可见性。

入场锁在 `isControlLocked` 和移动限速入口生效，不能被编队跟随覆盖；沉默进入原主动技能校验，持续回能通过独立能量查询归零。沿用当前古泉光球免控规则，不让新增锁定绕过既有免控；形态2免伤仍不免控。目标的封印与来源的封印分别判断，目标封印不会关闭敌方舞台。

变身只写本舰生命/能量，不调用伤害或共享能量消费入口；成功后按新旧有效航速比例调整当前速度、按旧/新射速比例调整炮击冷却。encore只在该角色实例上安装推进属性存取器，统一约束直接赋值、动作和航线落值；封印暂停锁档，恢复立即按4档读取，退出形态保留当时档位并允许换挡。普通舰船的推进字段仍是原数据属性。

公开摘要字段：舰船可选 `bunnyHaruhi` 包含形态/下一形态/次数、侦察资格、涤除标记、三个窗口剩余秒数、支援ID列表、不可施放原因及 `companionId/companionSpawned`；接触过舞台的目标可选 `bunnyStageExposure` 只含来源ID、在场/阶段、锁定/恢复/入迷剩余秒数。舞台主舰队伍可选 `bunnyStage={sourceShipId,seat,x,y,radius}|null`。剩余窗口表示绝对时间余量，是否生效还需结合存活、队伍封印和控制免疫；没有新角色的快照不添加空对象。`visitedForms`、首次治疗历史、待发队列及内部对象引用不进入协议。

继续使用原 `cast_sub_skill`。协议只接受 `type/shipKey/zoneId/targetX/targetY`，槽位必须是sub1/sub2或省略；拒绝目标形态、生命、支援结果及开关等额外字段。未指定形态，始终由权威成功次数计算下一形态。原合法动作不变，之前被忽略的伪造额外字段现在明确拒绝。

`test:core:bunny-haruhi-integration` 覆盖实际资源与广播、舞台边界、编队锁定、移动后入场禁止补射、双向采样、排除召唤物、驱散、锁档、支援发射点和破盾冷却、快照白名单、伪造动作及330tick本地/服务端队列一致性；新快照逐帧经过现有量化/差量协议往返。阿虚实体由独立 `test:core:bunny-companion` 验证，不把规则测试通过等同于前端验收。

## 阿虚运行时接入合同

`spawnBunnyCompanion(owner,createShip)` 仅接受真实副舰的encore状态，已存在稳定ID则拒绝重复生成。`Team.spawnBunnyCompanion` 注入原Ship构造器，提供冻结 `baseStats` 和 `entityRole="bunny_kyon"`；显示身份仍是 `characterId="kyon"`，不会获得普通阿虚主动技。实体放入当前阵营 `extraShips`，key固定为 `bunny_kyon_<ownerShipId>`，且 `isAuxiliary=true`、`attachToMain=false`。

`isBunnyCompanion`、`countsForVictory`、`isFleetParticipant` 只区分该实体类型。独立fleet key只返回阿虚自身，用于能源、航速和分摊查询；不进入主舰共享池，不参与胜负、主编队生命比例、玩家舰损或猎杀候选。仍可正常挡弹、受伤、碰撞和提供当前阵营真实视野。附着状态的母舰与阿虚之间也保留碰撞体积。玩家动作不能操控阿虚，侦察入口显式拒绝其key，不能退回主舰代发。

`prepareBunnyCompanions(match)` 在持续资源/舞台解析之后、AI及两队更新前执行：按稳定ID集合清死亡来源、归还到期策反、推进自动技能，再准备母舰后28/侧24的跟随点及档位。移动复用普通Ship导航，自身能量不足仍减速，不瞬移或额外加速追赶。自动技能要求双方存活、同属原阵营、阿虚未沉默/禁控/有效击退且技能未封印；距离不限制，未满足时重排20秒，不补积压。母舰形态的属性、易伤和剩余免伤动态继承一次，母舰涤除同步生效；不复制母舰的资源支付、补能、支援或广播。策反期间暂停此继承，归还不重建免伤窗口。母舰换形态及换队时按新旧有效速度/射速换算速度与炮击剩余冷却。

`convertBunnyCompanion(ship,destination,zone)` 由鹤屋既有战区入口调用，无新增视野要求。普通侦察机/僚机的永久策反流程不变。阿虚原子移出/移入extraShips，保留ID/key/出生归属、位置与当前生命，改为当前阵营队伍加成；设置5秒截止，清两名接收者的来源增益及自身旧弹体，向战区中心导航。原阵营反策反视为提前归还，同样清弹体并重排20秒。归还发生在队伍更新前，一队临时持有两架也各更新一次。

`bunnyOwnerDamageBlocked(source,target)` 按永久母舰ID保护自己的阿虚。炮击选敌、实际弹体命中、光线命中集合和新异世界冲撞先排除受保护目标；`takeDamage` 和猫爪附效入口再次拦截，返回false，不扣血、不分摊、不加猫爪或命中伤害统计。光线排除发生在命中数倍率计算前。其他原友舰可正常攻击被策反阿虚，阿虚也能攻击母舰；伤害记入攻击时当前阵营，换队清弹体避免可变source.team导致串账。

`cleanupBunnyCompanions(match)` 在伤害死亡回调、帧首与帧末执行幂等清理。阿虚死亡立即清可靠来源，母舰死亡即使在策反期间也使阿虚退场；退场不调用第二次伤害/舰损事件。死亡实体保留ID及alive=false摘要，不归还、不复活。

阿虚快照仅新增 `entityRole` 和 `bunnyCompanion={ownerShipId,ownerSeat,convertedRemaining,reliableRemaining,nextReliableRemaining}`；周期停用时next为null。母舰/阿虚的可选 `bunnyReliable={sourceCompanionId,remaining,suppressed}` 为各自增益资格；来源计时剩余不等于每个接收者都有效。跟随偏移、绝对计时和实体引用不序列化。既有差量协议支持跨队删除/新增同一ID；共享插值按各队集合处理，联机额外平滑缓存对阿虚换队立即重置，显示不回写模拟。
