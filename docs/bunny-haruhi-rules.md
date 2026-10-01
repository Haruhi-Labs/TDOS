# 兔女郎春日：配置与纯规则

当前仅完成实现规划中的第二阶段。以下模块尚未被 `game-core.js`、角色目录、随机池或前端导入，不可选用，也不产生新快照字段。实际对局语义未变，暂不递增 `RULESET_VERSION`；后续首次接入影响对局结果的行为时必须递增。

## 模块与调用边界

| 文件 | 职责 |
| --- | --- |
| `shared/game/bunny-haruhi-config.js` | 深冻结的独立基础值、技能ID、三项支援池、形态/舞台枚举、所有新倍率和时长 |
| `shared/game/bunny-haruhi.js` | 状态工厂、成功施放序列、资源方案、舞台状态转换、纯属性查询、持续区间计算 |
| `shared/game/bunny-haruhi-companion.js` | 伴随舰基础值派生、独立状态、可靠技能周期、策反/归还/退场意图及接收者生命周期 |
| `scripts/core-tests/bunny-haruhi-suite.mjs` | 上述规则的边界测试，默认随 `test:core` 执行 |

依赖仅为新配置和已有推进叶模块。不导入战斗入口、角色目录、服务端或显示模块，不新增依赖包。配置完全独立于普通春日，不能通过修改旧角色对象构造变体。支援工厂现在只创建独立容器；普通春日的支援实现不做抽取或修改。

所有函数不修改传入对象、不调用随机数、墙钟、音效或实体工厂。工厂每次创建新的 Set、数组及局部对象。返回状态可共享未改变的子对象，按只读值使用；提交者替换状态，不能把历史结果作为另一条可变权威状态并行保存。施放方案额外复制支援容器，允许未来奖励事务在新方案上准备。

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

本阶段不提供快照序列化；成功施放“序列函数”指形态次序，不是将 Set 或私有奖励历史直接发往客户端。将来旧角色不创建这些字段，新角色公开视图必须经过显式白名单序列化。

## 施放方案与序列

`nextBunnyForm(state)` 只读取成功次数：`bless → knows → bless → encore → bless → knows → …`。涤除、当前形态或支援结果不改变次序；encore仅一次。

`planBunnyTransform(state, {hp,maxHp,energy,maxEnergy}, now, tick)` 返回：

- 成功：`{ok:true, reason:null, state, hp, energy, cooldownSeconds, unlockSupport, spawnCompanion}`。
- 失败：`{ok:false, reason:"dead"|"insufficient_hp"}`，无待提交状态或奖励。

bless要求 `hp > maxHp*0.15`，直接扣除最大生命15%，能量补至至少80%；knows不支付即时生命，同样补能，创建4秒免伤、16秒自损及广播窗口；encore恢复20%最大生命，上限截断。已高于80%的能量不降低，零能量可生成成功方案。

`unlockSupport` 仅首次到达各形态为true，一共三次；具体无放回抽取和随机数消费留给后续支援阶段。`spawnCompanion` 仅第一次encore为true，方案中的 `companionSpawned` 同时置true，实体ID由后续事务写入。伴随舰死亡不恢复生成资格。

未来施放适配器必须先验证真实副舰槽位、存活、分离、控制、沉默、光球、全局封印和CD，并预备所有实体资源，然后一次提交整个方案和奖励。当前函数仅计算形态与资源，不具备绕过这些校验的授权含义。调用方案但未提交不推进次数、不扣血、不消耗随机数；重复计算同一输入也不能多次发放奖励。冷却30秒由现有队伍冷却管理，不引入第二份倒计时。

`purgeBunnyForm(state,tick)` 保留同tick新施放效果；之后仅压制bless正倍率或清除knows免伤，保留生命代价、自损、广播和永久进度。下次成功切换重置正倍率涤除标记。`clearBunnyFormWindows(state)` 清除临时窗口，保留永久历史；死亡实体不再参与查询，由未来适配器同时清来源及退场。

## 属性、能量与持续结算

`bunnyStatMultiplier({form,stage,reliable,enabled}, statKey, now)` 的 `form` 是形态状态对象。返回三个来源的乘积，不含任何旧队伍加成、难度或单飞加成。只接受既有属性键 `speed/turnRate/accel/range/vision/damage/fireRate/regen`，其余返回1。缺失状态返回中性值。实际属性仍由旧计算结果乘本函数的结果。

- bless：航速1.15、转向/加速1.2、射程/视野1.1、伤害1.25、射速1.2，炮击输出乘积1.5。
- knows：五项机动/感知属性0.8、伤害和射速各0.7，输出乘积0.49。
- 哑口无言：航速和射速各0.9，自然回能为0；入迷：七项战斗属性各1.2，恢复自然回能。
- 可靠技能：转向1.2、航速/伤害1.06、加速1.1，其余1；不附带普通阿虚的减伤。

`bunnyDamageTakenMultiplier(form)` 只返回bless的1.2易伤或中性1；`isBunnyDamageImmune(form,now,enabled)` 只判断knows剩余窗口，不代表免控。`isBunnyBroadcasting` 表示bless持续广播或knows的16秒广播；具体可见性、目标范围、伤害分摊顺序由后续接入处理。

`enabled=false` 暂停形态正倍率、舞台效果、可靠增益、免伤、广播及encore锁档；bless易伤和knows降属性保留。自损与治疗区间查询也显式传该开关，封印期间不结算，解除后不补过期时间。永久侦察资格不因封印恢复。

`bunnyStageSpeedFactor(stage,now,enabled)` 返回控制锁的0、恢复阶段的线性0至1、或正常1，必须在移动处另乘；锁定期间是否允许射击/操作使用 `isBunnyControlLocked` 判断，不能把航速0当作全部控制效果。

`bunnyEnergyRate(stage,regen,moveDrain,throttle,enabled)` 在哑口无言时返回纯推进负收支，其他情况完整委托旧 `energyRateForThrottle`。不能只给旧函数传regen=0，因为旧函数仍保底每秒1.2回能。瞬间补能独立于这个查询。

`canBunnyLaunchScout(form)` 只表达本角色的额外资格，其他侦察权限仍由原入口验证。`resolveBunnyThrottle(form,requestedThrottle,enabled)` 在encore时返回现有推进表中的4档1.4，否则返回输入；不改变实际航速、耗能或其他角色档位规则。不会新增规划旧文本提及、但当前项目已经移除的急刹功能。

`bunnySelfDrainAmount(form,{from,to,hp,maxHp,enabled})` 与 `bunnyStageHealAmount(stage,同参数)` 返回本区间的正扣血量/治疗量，不修改生命。按有效窗口交集积分：knows每秒最大生命0.5%，16秒总8%，最低1HP；入迷从 `enteredAt+10` 起每秒0.4%，不溢出、不复活。区间零长度返回0；跨截止点只算有效部分。

持续结算调用者负责区间不重叠，每个权威区间仅应用一次；在形态切换、离圈、封印和死亡边界拆分区间。成员关系查询可每tick多次执行，不能因此重复应用持续量。先结清旧状态区间再替换状态；新入圈不会追溯治疗旧区间。分30Hz片段与一次积分在浮点误差内相同。

## 舞台生命周期

`resolveBunnyStageExposure(state,{inside,sourceShipId,now,tick})` 返回 `{state,healRatio}`，不读取坐标或实体列表。未来调用者先按双方同一阶段的权威圆快照计算成员关系，仅传存活敌方三个玩家舰位，圆边界用舰船中心，禁止召唤物自动进入此路径。

入圈设置哑口无言和连续计时；控制冷却满足时触发0.5秒锁定与1.5秒恢复，下次控制时刻为入圈时间+15。连续10秒进入入迷，并只在整局首次返回0.15治疗比例，满血同样标记领取。重复检查不重发治疗或刷新控制。改变来源视为新入圈，但保留目标历史。

`inside=false`、`leaveBunnyStage(state)` 用于离圈、来源死亡、目标死亡及舞台封印清场：只保留 `nextEntryControlAt` 与 `firstEntranceHealConsumed`。`cleanseBunnyStageControl` 只清此次锁定/恢复，保留在场阶段、历史及冷却，重复成员查询不能恢复已清控制。

## 伴随舰与可靠技能生命周期

`deriveBunnyCompanionBase(baseStats)` 默认取独立配置，返回冻结的12项基础属性。默认HP308、能量65、伤害11.6、射速0.282、速度33、转向0.36、加速1.02、射程416、视野103.2、回能6.25、耗能4.1、半径8.96。参数必须是未受难度、形态或团队增益影响的基础值。实体构造和单飞奖励排除尚待接入。

`advanceBunnyCompanion(state,{now,tick,alive,ownerAlive,sameOwnerTeam,canAct,enabled})` 返回新 `state` 与五个布尔意图：`triggerReliable/returnToOwner/retire/clearReliable/clearProjectiles`。`sameOwnerTeam` 意为双方仍在永久出生阵营；`canAct` 包括未沉默、未失控；所有标记来自权威实体。

到20秒且条件满足时触发一次6秒增益，下一次为now+20；条件不满足同样重排，不积压。迟到一次更新也只触发一次。母舰死亡优先于归还，活着的阿虚返回退场意图；阿虚已死不再请求重复退场，但仍请求幂等清理。两个死亡分支都不请求归还或触发技能。

`planBunnyCompanionConversion(state,now)` 只对经校验的存活合法目标调用：策反截止now+5，周期为null，清来源增益，并返回清接收者与炮弹的意图。到期归还时重新排now+20，不立刻触发。owner字段始终不改；实际队伍转移、跟随、攻击排除、炮弹销毁和击杀记账均由下一阶段实体事务处理。转移必须先于队伍遍历，不能在A/B更新中重复处理。

合法触发后，适配器对母舰和阿虚分别调用 `bunnyReliableRecovery`，各自恢复最大生命6%、最大能量15%；再各自 `createBunnyReliableState(sourceCompanionId,now,tick)`。`purgeBunnyReliable(state,tick)` 保护同帧效果，之后仅压制该接收者；`expireBunnyReliable(state,now,sourceValid)` 在截止或来源死亡/策反时返回null，适配器删除字段。已恢复资源不追扣。被策反时不向属性查询传母舰形态；归还直接读取母舰当前状态，不能重新生成4秒免伤窗口。

## 验证与尚未接入的范围

专项命令：`npm run test:core:bunny-haruhi`；默认 `test:core` 和 `test:logic` 已包含它。专项在内存中运行，不启动服务器或访问身份/统计数据。

测试覆盖冻结/独立工厂、未注册角色、10次成功序列与三次奖励、生命支付边界和零能量、精确倍率与叠乘、同帧涤除、舞台10/15秒及0.5/2秒边界、治疗只领取一次、16秒消耗的区间积分、封印与死亡、可靠20/6秒周期、策反5秒归还及死亡优先级。

后续仍需支援抽取及RNG调用顺序、实际施放事务、阶段采样/持续结算调度、阿虚实体和伤害链、白名单快照、选角及随机池、AI、前端占位素材与跨端显示验收。本阶段没有素材加载，也没有让未完成角色可玩。
