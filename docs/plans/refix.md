/loop

# TDOS「星域争夺战」返工修改执行文档

## 一、任务信息

目标仓库：

```text
https://github.com/feiniao87968492/TDOS
```

目标分支：

```text
experiment/stellar-territory-mode
```

基线分支：

```text
experiment/gameplay-mode-lab
```

本任务不是继续增加新技能或新机制，而是返工当前星域争夺战，使其真正符合原始玩法设想，并达到可以进行玩法测试的状态。

当前版本已经实现了部分规则代码，但地图、控制区、出生点、地形、战争点数和资源系统在实际画面与操作中没有正确呈现。

---

# 二、目标玩法

星域争夺战应当是一个：

```text
固定大型控制区
+ 战争点数
+ 随机移动地形
+ 永久资源包
+ 主动战术技能
+ 舰船复活
+ 3v3舰队规模
```

的区域争夺模式。

玩家进入游戏后，必须能够立即看懂：

```text
我方从哪里出生
敌方从哪里出生
三个控制区在哪里
控制区目前属于谁
控制区正在被谁占领
双方还剩多少战争点数
地图中有哪些地形
当前资源包和技能包在哪里
己方持有什么战术技能
```

如果上述信息不能在战斗画面中直接看懂，则任务不能结束。

---

# 三、当前主要问题

## P0：必须优先修复

```text
1. 星域地图被共享背景覆盖。
2. 控制区太小、不固定、不明显。
3. 出生点位置错误。
4. 初始舰队没有真正生成在模式出生点。
5. 地形没有正式视觉。
6. 战争点数只存在开发者侧栏。
7. 资源包会自动消失。
8. 模式时间被重复推进。
9. 3v3模式本地玩家仍可能错误控制A而不是A1。
10. 玩家没有手动使用战术技能的入口。
```

## P1：完成P0后修复

```text
1. 旧九宫格战区与新控制区概念冲突。
2. 每次重开地图种子基本固定。
3. 多个模式参数显示但不生效。
4. 资源和技能预告没有具体位置与类型。
5. 3v3复活会在同一坐标重叠。
6. 同一舰船第二次死亡可能无法再次复活。
7. 编队全灭额外扣点判断不稳定。
8. AI可能全部争抢同一个目标。
9. AI任务切换过于频繁。
```

## P2：测试与体验问题

```text
1. 浏览器测试只统计颜色像素，可能产生误判。
2. 没有验证控制区的位置和大小。
3. 没有验证战争点数是否处于战斗主HUD。
4. 没有验证地形是否真正显示。
5. 没有验证A1是否可以操作。
6. 没有验证技能可以由玩家手动释放。
7. 缺少完整的动画和事件反馈。
```

---

# 四、最高优先级架构约束

## 4.1 不得重建第二套模式

继续使用：

```text
shared/modes/stellar-territory.js
shared/gameplay/territory-*.js
src/modes/stellar-territory/
src/prototype/
```

禁止创建：

```text
stellar-territory-v2.js
new-territory-runtime.js
prototype-territory-core.js
```

## 4.2 规则与表现分离

规则层负责：

```text
控制区判定
战争点数
资源生命周期
地形倍率
技能效果
复活
胜负
```

表现层负责：

```text
虚线框
颜色
图标
动画
粒子
HUD
文字提示
```

禁止通过动画结束决定权威规则。

## 4.3 不在平台核心硬编码模式ID

禁止在以下文件中增加：

```js
if (mode.id === "stellar-territory") {
}
```

文件包括：

```text
src/prototype/index.js
src/prototype/runtime.js
src/prototype/template.js
shared/game-core.js
```

模式差异继续通过：

```text
modeDefinition
runtimePreset
presentationFactory
```

传入。

---

# 五、Loop 0：确认分支与测试基线

执行：

```bash
git status
git branch --show-current
git log -10 --oneline
git diff experiment/gameplay-mode-lab...HEAD --stat
```

确认当前分支：

```text
experiment/stellar-territory-mode
```

运行已有测试：

```bash
npm run test:core
npm run test:prototype-platform
npm run test:prototype-browser
npm run test:territory-map
npm run test:territory-control
npm run test:territory-resources
npm run test:territory-terrain
npm run test:territory-skills
npm run test:territory-respawn
npm run test:territory-ai
npm run test:territory-browser
npm run test:territory-performance
npm run build
```

以实际 `package.json` 中存在的脚本为准。

输出基线：

```text
通过测试
失败测试
当前可见问题
当前模式截图
当前控制席位
当前地图种子
```

---

# 六、Loop 1：修复绘制顺序

## 6.1 当前问题

当前模式的：

```text
renderWorldBefore()
```

在：

```text
drawBattleWorld()
```

之前运行。

但是 `drawBattleWorld()` 内部会再次绘制全屏背景，因此此前绘制的：

```text
地形
出生区
控制区
生成节点
```

都会被覆盖。

## 6.2 修改目标

建立明确的绘制层级：

```text
第1层：星空背景
第2层：地形
第3层：控制区
第4层：出生区
第5层：资源和技能生成节点
第6层：航线和投射物
第7层：舰船
第8层：资源包和技能包实体
第9层：技能与复活特效
第10层：屏幕空间HUD
```

## 6.3 推荐方案

为共享渲染增加通用钩子：

```js
drawBattleWorld(ctx, {
  ...frame,
  worldLayerBeforeZones,
  worldLayerAfterBackground,
  worldLayerBeforeShips,
  worldLayerAfterShips,
})
```

或者将背景绘制拆成独立调用：

```js
drawBattleBackground(ctx, frame);
presentation.renderWorldBackground(...);
drawBattleEntities(ctx, frame);
presentation.renderWorldForeground(...);
```

不能只简单把全部星域内容改到 `renderWorldAfter()`，否则地形会盖在舰船上。

## 6.4 验收

```text
[ ] 星空背景不会覆盖地形。
[ ] 地形不会覆盖舰船。
[ ] 控制区在舰船下方。
[ ] 资源包和技能包在舰船附近仍清晰可见。
[ ] 标准歼灭模式绘制顺序不受影响。
```

---

# 七、Loop 2：重新设计固定控制区

## 7.1 设计要求

控制区不再随机偏移。

固定为三个大型区域：

```text
A区：左下偏中央
B区：地图中央
C区：右上偏中央
```

推荐坐标比例：

```text
A区中心：(0.28W, 0.72H)
B区中心：(0.50W, 0.50H)
C区中心：(0.72W, 0.28H)
```

推荐尺寸：

```text
宽度：280～340
高度：200～260
```

控制区最终使用：

```text
大型矩形或圆角矩形
虚线外框
半透明内部区域
```

不要继续使用半径60～70的小圆点。

## 7.2 控制区结构

改为：

```js
{
  id: "alpha",
  label: "A",
  shape: "rect",
  x,
  y,
  width,
  height,

  ownerAllianceId: null,
  capturingAllianceId: null,
  captureProgress: 0,
  contested: false,
  occupants: {
    A: [],
    B: [],
  },
}
```

如需要兼容圆形判断，可抽象：

```js
pointInsideControlPoint(point, controlPoint)
```

禁止继续在占领代码中直接假设：

```js
distance(center, ship) <= radius
```

## 7.3 占领表现

控制区必须显示：

```text
中立
A占领中 35%
A已占领
争夺中
B占领中 70%
B已占领
```

视觉要求：

### 中立

```text
灰白虚线
内部透明
显示“中立”
```

### A占领中

```text
蓝色虚线
底部或边缘显示占领进度
显示“A 占领中”
```

### A已占领

```text
蓝色稳定边框
淡蓝色内部填充
中央显示“A”
```

### B已占领

```text
红色稳定边框
淡红色内部填充
中央显示“B”
```

### 争夺中

```text
蓝红交替或双向流动虚线
显示“争夺中”
```

## 7.4 占领动画

至少实现：

```text
进入区域：边框增强
开始占领：虚线开始流动
占领进度：边框或内部进度变化
占领完成：冲击环或扫光
失去控制：颜色向中立淡出
争夺中：双向脉冲
```

## 7.5 验收

```text
[ ] 三个控制区位置固定。
[ ] 控制区足够大。
[ ] 控制区采用明显虚线框。
[ ] 玩家不看开发面板也能知道归属。
[ ] 占领进度在战场中可见。
[ ] 争夺状态可见。
[ ] 控制区不会随随机种子改变位置。
```

---

# 八、Loop 3：出生点改为左下角和右上角

## 8.1 出生位置

设定：

```text
A阵营：左下角
B阵营：右上角
```

推荐中心：

```text
A：(0.12W, 0.88H)
B：(0.88W, 0.12H)
```

出生区域使用：

```text
圆形或六边形安全区域
明显阵营颜色
“A 出生区”
“B 出生区”
```

## 8.2 初始部署

模式地图生成完成后，必须真正影响舰船初始位置。

不能只在复活时使用出生点。

增加通用接口，例如：

```js
modeDefinition.prepareSimulation({
  simulation,
  modeState,
  fleetLayout,
})
```

或者：

```js
modeDefinition.getInitialDeployments({
  modeState,
  fleetLayout,
})
```

返回：

```js
{
  A1: {
    main: { x, y },
    sub1: { x, y },
    sub2: { x, y },
  },
}
```

## 8.3 3v3出生锚点

A阵营：

```text
A1：左下出生区中央
A2：A1上方
A3：A1右侧
```

B阵营：

```text
B1：右上出生区中央
B2：B1下方
B3：B1左侧
```

每支编队内部三艘舰船也需要相对偏移。

禁止18艘舰船堆叠在同一点。

## 8.4 朝向

A阵营默认朝向：

```text
右上
```

B阵营默认朝向：

```text
左下
```

## 8.5 镜头

本地玩家是A1时，镜头初始中心应对准A1主舰。

不能继续读取：

```text
fleets.A
```

必须根据：

```text
runtime.getFleetLayout().localSeat
```

获取本地编队。

## 8.6 验收

```text
[ ] A阵营从左下角出生。
[ ] B阵营从右上角出生。
[ ] 开局位置和复活位置一致。
[ ] 3v3编队不会重叠。
[ ] 初始朝向正确。
[ ] 镜头对准A1。
```

---

# 九、Loop 4：修复本地控制席位

## 9.1 当前问题

星域争夺战定义：

```text
localSeat = A1
```

但 Prototype 仍然：

```text
读取 fleets.A
动作发送给 A
```

## 9.2 修改

统一新增：

```js
function localSeat() {
  return app.runtime?.getFleetLayout?.()?.localSeat || "A";
}
```

修改：

```text
ownTeam()
selectedShip()
applyAction()
camera.reset()
selectedKeyForTeam()
localControlSeat
```

使其全部使用：

```text
localSeat()
```

己方阵营其他编队：

```text
A2
A3
```

作为友军绘制，但不能被A1直接控制。

## 9.3 验收

```text
[ ] 右键航线只改变A1。
[ ] 1/2/3切船只切换A1编队。
[ ] A2/A3由AI控制。
[ ] A1舰船有本地控制脉动效果。
[ ] A2/A3没有本地控制脉动效果。
```

---

# 十、Loop 5：修复模式时间重复推进

## 10.1 当前问题

多个子系统分别执行：

```js
next.elapsed += dt;
```

导致同一个Tick中时间被重复增加。

可能涉及：

```text
资源生命周期
技能生命周期
技能效果
模式主状态
```

## 10.2 修改原则

只有模式主更新函数可以推进一次：

```js
next.elapsed += dt;
```

其他所有系统接收：

```text
now
dt
```

但不得修改 `elapsed`。

建议：

```js
const now = next.elapsed + dt;
next.elapsed = now;

updateResources({ modeState: next, now, dt });
updateSkills({ modeState: next, now, dt });
updateEffects({ modeState: next, now, dt });
```

## 10.3 测试

固定推进：

```text
30 Tick
```

应当增加：

```text
1秒
```

而不是：

```text
2秒
3秒
4秒
```

测试：

```js
assert(Math.abs(state.elapsed - expected) < 1e-6);
```

## 10.4 验收

```text
[ ] 资源生成时间与真实模拟时间一致。
[ ] 技能持续时间正确。
[ ] 复活倒计时正确。
[ ] 0.5x、1x、2x、4x倍率正确。
[ ] 单步只推进1/30秒。
```

---

# 十一、Loop 6：资源包永久存在

## 11.1 新规则

资源包生成后：

```text
不会因时间自动消失
一直存在直到被拾取
```

移除：

```text
expiresAt
resource_expired
RESOURCE_LIFETIME_SECONDS
```

或者保留字段但设为：

```text
null
```

生命周期不再删除未拾取资源。

## 11.2 生成频率

降低频率：

```text
普通资源：45～60秒
稀有资源：100～140秒
```

模式参数必须真实控制间隔。

建议参数：

```js
{
  key: "commonResourceSpawnSeconds",
  default: 52,
}

{
  key: "rareResourceSpawnSeconds",
  default: 120,
}
```

随机波动：

```text
±15%
```

## 11.3 节点占用

每个资源生成节点最多存在一个资源。

当节点已被占用：

```text
跳过该节点
选择其他节点
```

所有合法节点已占用时：

```text
暂停生成
等待资源被拾取
```

不要无限积累。

## 11.4 资源预告

预告时必须提前确定：

```text
资源类型
生成节点
具体坐标
生成时间
```

事件：

```js
{
  type: "resource_warning",
  position: { x, y },
  payload: {
    resourceType,
    nodeId,
    spawnAt,
  },
}
```

## 11.5 资源表现

资源生成前：

```text
节点闪烁
倒计时
资源图标
粒子聚集
```

生成后：

```text
持续存在
呼吸动画
小地图标记
```

## 11.6 验收

```text
[ ] 资源不会自动消失。
[ ] 资源被拾取后才移除。
[ ] 同一节点不会堆叠多个资源。
[ ] 参数真实控制生成频率。
[ ] 预告显示具体位置和类型。
```

---

# 十二、Loop 7：技能包生命周期同步调整

技能包是否永久存在，可先采用：

```text
技能包生成后持续存在，直到被拾取
```

这样与资源包规则统一，也符合地图争夺目标。

若担心地图长期堆积，则限制：

```text
全地图最多同时存在2个技能包
```

生成频率：

```text
60～90秒
```

预告必须包含：

```text
技能类型
生成位置
生成时间
```

不得再生成：

```text
无位置、无类型的泛化预告
```

---

# 十三、Loop 8：战争点数主HUD

## 13.1 位置

战争点数必须放在战斗画面顶部中央。

不要只放在右侧开发者面板。

推荐布局：

```text
┌────────────────────────────────────┐
│ A阵营 120   [A][B][C]   120 B阵营 │
└────────────────────────────────────┘
```

控制区图标：

```text
蓝色：A控制
红色：B控制
灰色：中立
闪烁：争夺中
```

## 13.2 信息

至少显示：

```text
A战争点数
B战争点数
控制区归属
比赛时间
当前点数扣除速度
```

## 13.3 动画

点数减少时：

```text
数值短暂放大
红色跳字 -1
显示原因：
控制区劣势
舰船被击毁
编队全灭
```

低于：

```text
30%
```

时：

```text
边框警告
轻微脉冲
```

归零时：

```text
冻结HUD
播放结算动画
```

## 13.4 开发面板

右侧模式HUD仍可保留诊断信息，但不作为主要信息来源。

## 13.5 验收

```text
[ ] 战争点数进入战斗主HUD。
[ ] 不打开开发面板也能看见。
[ ] 点数变化有原因提示。
[ ] 三个控制区归属同时显示。
```

---

# 十四、Loop 9：正式地形表现

## 14.1 当前问题

现有地形只是低透明度调试边框。

## 14.2 小行星带

需要绘制：

```text
小行星碎片
不规则分布
区域虚线或半透明边界
舰船进入时碎屑被扰动
```

文字：

```text
小行星带
航速降低
```

## 14.3 高速航道

需要绘制：

```text
长条航道
明确方向箭头
持续流动线
顺向和逆向提示
```

文字：

```text
高速航道
顺向加速
```

## 14.4 引力泥沼

需要绘制：

```text
旋转漩涡
暗色半透明区域
中心引力核
边缘空间波纹
```

文字：

```text
引力泥沼
航速与转向降低
```

## 14.5 图层

地形必须：

```text
位于背景之上
位于控制区和舰船之下
```

## 14.6 调试开关

区分：

```text
正式地形表现
调试碰撞边界
```

正式地形默认显示。

调试边界由开发者开关控制。

## 14.7 小地图

移动端小地图至少显示：

```text
控制区
资源
技能包
出生区
主要地形轮廓
```

## 14.8 验收

```text
[ ] 三种地形肉眼可区分。
[ ] 不打开调试边界也能看见地形。
[ ] 高速航道方向明确。
[ ] 地形文字和图标不遮挡舰船。
```

---

# 十五、Loop 10：隐藏旧九宫格战区

## 15.1 问题

星域争夺战中存在两种“战区”：

```text
旧九宫格技能战区
新夺点控制区
```

容易混淆。

## 15.2 修改

为共享战场渲染增加：

```js
showLegacyZones: false
```

星域争夺战默认：

```text
不显示九宫格边框
不显示战区1～9文字
```

但内部九宫格数据可以保留，供角色技能使用。

当进入依赖九宫格的技能瞄准状态时：

```text
临时显示九宫格
技能结束或取消后隐藏
```

## 15.3 命名

新模式统一称为：

```text
控制区
据点
占领区
```

旧系统继续称为：

```text
战区
```

避免文案冲突。

---

# 十六、Loop 11：随机种子和重开行为

## 16.1 当前问题

无随机种子时会退化为：

```text
0
```

导致每次地图相同。

## 16.2 新行为

增加两个按钮：

```text
新地图重开
同种子重开
```

### 新地图重开

```text
生成新随机种子
重新生成地图和地形
```

### 同种子重开

```text
保留当前种子
复现当前地图
```

增加：

```text
种子输入框
载入种子
复制种子
```

## 16.3 验收

```text
[ ] 普通新局生成新地图。
[ ] 同种子重开地图完全一致。
[ ] 输入种子可复现地图。
[ ] 规则随机与表现随机互不干扰。
```

---

# 十七、Loop 12：修复失效参数

逐一检查：

```text
initialTickets
controlPointCount
captureSeconds
resourceSpawnInterval
skillSpawnInterval
respawnEnabled
mapTemplate
```

要求：

```text
界面中存在的参数必须真实生效
```

不能出现“参数只显示但代码不读取”。

## 推荐处理

固定控制区后：

```text
controlPointCount
```

如果短期只支持3个，则从参数面板删除。

不要提供一个实际无效的：

```text
1或3
```

资源频率拆分：

```text
普通资源间隔
稀有资源间隔
```

技能间隔读取参数。

## 验收

每个参数都需要自动测试：

```text
修改参数
→ 重开
→ 观察权威状态变化
```

---

# 十八、Loop 13：玩家手动使用战术技能

## 18.1 当前问题

`X` 键仍用于发射侦察机。

随机技能只有 AI 和测试代码可以使用。

## 18.2 新按键

建议：

```text
X：使用随机战术技能
Z：发射侦察机
```

或者保留侦察键并新增：

```text
F：使用战术技能
```

选择一个不会与当前功能冲突的方案。

## 18.3 HUD

显示：

```text
当前技能图标
技能名称
使用快捷键
目标类型
技能说明
```

没有技能时：

```text
战术技能：空
```

## 18.4 目标类型

### 无目标

```text
护盾
推进过载
火力过载
```

按键后立即使用。

### 地图目标

```text
短程跃迁
引力场
```

进入瞄准状态。

显示：

```text
最大范围
合法区域
非法区域
目标落点
```

### 友方编队目标

```text
维修无人机
```

Prototype 3v3中可通过：

```text
A1
A2
A3
```

按钮选择。

## 18.5 取消

```text
Esc
右键
再次按技能键
```

## 18.6 验收

```text
[ ] 玩家可以使用所有技能。
[ ] 非法目标不会消耗技能。
[ ] AI与玩家使用相同权威接口。
[ ] 技能槽使用后清空。
[ ] 快捷键与侦察机不冲突。
```

---

# 十九、Loop 14：复活系统修复

## 19.1 多次死亡

死亡账本必须在舰船成功复活后清理对应死亡实例。

同一舰船第二次死亡时必须再次：

```text
扣战争点数
进入复活队列
产生复活事件
```

## 19.2 复活坐标

复活使用席位专属锚点：

```text
A1
A2
A3
B1
B2
B3
```

舰船内部再次使用偏移：

```text
main
sub1
sub2
```

禁止重叠。

## 19.3 编队全灭

不要只检测同一个Tick中新死亡数量。

维护：

```js
fleetWipeState[seat]
```

当某支编队从：

```text
至少一艘存活
```

变成：

```text
三艘基础舰全部死亡
```

时，触发一次全灭惩罚。

复活后重置该状态。

## 19.4 复活保护

保护解除条件：

```text
时间结束
主动攻击
主动使用技能
离开出生区域
```

单纯设置航线不应立刻取消保护，除非舰船真的离开出生区。

## 19.5 复活动画

至少实现：

```text
复活前3秒出生点预热
粒子聚集
舰船实体化
冲击波
保护罩
保护罩破碎
```

---

# 二十、Loop 15：AI目标分配

## 20.1 当前问题

所有AI独立计算同一套最高分目标，容易集体抢同一资源或同一控制区。

## 20.2 增加阵营协调器

每个阵营维护：

```js
{
  assignments: {
    A1: objective,
    A2: objective,
    A3: objective,
  }
}
```

目标容量：

| 目标    | 默认容量 |
| ----- | ---: |
| 普通资源包 | 1支编队 |
| 技能包   | 1支编队 |
| 空控制区  | 1支编队 |
| 敌方控制区 | 2支编队 |
| 防守控制区 | 1支编队 |
| 正面攻击  | 2支编队 |

## 20.3 任务锁定

最短任务锁定时间：

```text
3～5秒
```

只有以下情况可提前切换：

```text
目标消失
目标被拾取
目标已完成
舰体过低
出现更高优先级紧急事件
```

## 20.4 阵营分工

3v3初始建议：

```text
一支抢近点
一支争中央
一支支援或资源
```

不要永久固定角色，允许动态调整。

## 20.5 诊断

显示：

```text
每支AI当前任务
目标ID
任务分数
锁定剩余时间
```

---

# 二十一、Loop 16：动画和事件系统补齐

当前 Presentation 的：

```text
update
renderScreen
```

不能继续为空。

必须消费 Runtime 事件：

```text
resource_warning
resource_spawned
resource_collected

skill_warning
skill_spawned
skill_collected
skill_used
skill_effect_ended

control_point_owner_changed
control_point_contested

ticket_drained

respawn_queued
ship_respawned
```

## 必须实现的表现

### 控制区

```text
占领进度
争夺脉冲
占领完成
归属变化
```

### 资源

```text
生成预告
生成动画
拾取吸附
恢复数字
```

### 技能

```text
生成预告
拾取反馈
释放特效
持续特效
结束特效
```

### 复活

```text
预热
出现
保护罩
```

### 战争点数

```text
扣点跳字
原因标签
低点警告
```

要求按事件ID去重。

模式切换和重开时清理全部特效。

---

# 二十二、Loop 17：修复浏览器测试

现有颜色像素统计只能作为辅助，不能作为主要验收。

增加测试钩子或状态接口。

## 22.1 控制区测试

验证：

```text
三个控制区数量
固定中心坐标
固定矩形尺寸
状态文字
占领进度
```

## 22.2 出生点测试

验证：

```text
A位于左下
B位于右上
A1/A2/A3位置不同
B1/B2/B3位置不同
```

## 22.3 地形测试

验证：

```text
正式地形默认开启
三个地形渲染函数被调用
调试开关不会关闭正式地形
```

## 22.4 资源测试

验证：

```text
生成60秒后仍存在
没有expiresAt或不会自动过期
拾取后消失
```

## 22.5 战争点数测试

验证：

```text
主HUD存在
A/B点数可见
开发面板隐藏后仍可见
```

## 22.6 控制测试

验证：

```text
localSeat为A1
右键命令改变A1路线
A2路线不改变
```

## 22.7 技能测试

验证：

```text
玩家拾取技能
HUD显示技能
按键使用
目标选择
技能槽清空
```

---

# 二十三、Loop 18：人工验收

至少进行：

```text
3局1v1人机
3局3v3规模人机
```

人工检查：

```text
能否在3秒内找到控制区
能否看懂控制区归属
能否找到出生区
能否分辨三种地形
能否找到战争点数
能否理解资源包类型
能否知道当前持有技能
能否手动释放技能
复活后是否清楚位置
```

若测试者需要打开右侧诊断面板才能理解玩法，则不通过。

---

# 二十四、完整回归测试

最终执行：

```bash
npm run test:core
npm run test:2v2-core
npm run test:2v2-server
npm run test:2v2-client
npm run test:2v2-comm
npm run test:2v2-reconnect
npm run test:2v2-result
npm run test:2v2-browser

npm run test:prototype-platform
npm run test:prototype-browser

npm run test:territory-map
npm run test:territory-control
npm run test:territory-resources
npm run test:territory-terrain
npm run test:territory-skills
npm run test:territory-respawn
npm run test:territory-ai
npm run test:territory-scale
npm run test:territory-browser
npm run test:territory-performance

npm run build
```

以真实脚本为准。

禁止伪造测试结果。

---

# 二十五、禁止事项

禁止：

```text
继续增加新技能
继续增加新地形类型
加入侦察类随机技能
只调整透明度而不修复绘制层级
使用小圆点冒充控制区
继续随机移动控制区
让资源包自动消失
只在开发面板显示战争点数
让玩家动作继续发送给A而不是A1
通过直接修改对象绕过Runtime
为了通过测试降低断言
只使用颜色像素判断视觉正确
删除旧模式兼容测试
自动合并
自动推送
自动创建PR
```

---

# 二十六、完成标准

只有全部满足才能退出 `/loop`：

```text
[ ] 星域地图不再被背景覆盖
[ ] 三个控制区为固定大型虚线框
[ ] 控制区位于左下—中央—右上路线
[ ] 控制区显示中立、占领中、已占领和争夺中
[ ] 控制区显示占领进度
[ ] A出生区位于左下角
[ ] B出生区位于右上角
[ ] 初始部署使用模式出生点
[ ] 3v3出生和复活不重叠
[ ] A1是本地控制席位
[ ] A2/A3由AI控制
[ ] 模式时间每Tick只推进一次
[ ] 资源包不会自动消失
[ ] 资源生成频率降低
[ ] 资源参数真实生效
[ ] 资源预告包含位置和类型
[ ] 技能预告包含位置和类型
[ ] 战争点数显示在顶部主HUD
[ ] 点数变化显示原因
[ ] 三种地形正式显示
[ ] 地形不依赖调试边界
[ ] 旧九宫格默认隐藏
[ ] 地图种子可随机和复现
[ ] 无无效模式参数
[ ] 玩家可以手动使用战术技能
[ ] 快捷键不与侦察功能冲突
[ ] 舰船可重复死亡和复活
[ ] 编队全灭惩罚稳定触发
[ ] AI不会全部抢同一目标
[ ] AI任务具有锁定和迟滞
[ ] 控制区动画完整
[ ] 资源动画完整
[ ] 技能动画完整
[ ] 复活动画完整
[ ] 战争点数反馈完整
[ ] 浏览器测试验证真实状态
[ ] 现有2v2功能未被破坏
[ ] Prototype其他模式未被破坏
[ ] 所有测试通过
[ ] npm run build通过
[ ] 无RAF泄漏
[ ] 无监听器泄漏
[ ] 无特效泄漏
[ ] git diff无无关修改
```

---

# 二十七、建议提交顺序

建议按以下边界提交：

```text
1. fix territory presentation layer order
2. redesign fixed control point layout
3. move spawns and apply initial deployments
4. fix local A1 control
5. fix territory elapsed time
6. make resource pickups persistent
7. add primary ticket HUD
8. add production terrain visuals
9. hide legacy zones in territory mode
10. fix seed and parameter behavior
11. add player tactical skill controls
12. fix repeated respawn and spawn offsets
13. coordinate territory AI objectives
14. add territory animations and events
15. strengthen browser tests
```

---

# 二十八、每轮汇报格式

每轮结束后输出：

## 本轮完成

```text
修改文件
修复问题
新增接口
```

## 验证

```text
自动测试
人工测试
截图或状态数据
```

## 未完成

```text
遗留问题
风险
下一Loop
```

如果上一阶段没有达到验收条件，不得进入下一阶段。

---

# 二十九、最终汇报格式

## 1. 已修复问题

逐项对应：

```text
控制区
出生点
地形
资源
战争点数
本地控制
技能操作
复活
AI
动画
```

## 2. 实际文件变化

列出：

```text
新增文件
修改文件
每个文件职责
```

## 3. 玩法截图说明

至少展示：

```text
全地图
控制区占领中
控制区已占领
资源生成
地形显示
战争点数HUD
技能释放
复活
```

## 4. 测试结果

逐项列出真实命令和结果。

## 5. Git状态

```bash
git status --short
git diff --stat
git log -15 --oneline
```

## 6. 仍需后续处理

只列出本轮未覆盖的：

```text
联网3v3
正式房间
网络同步
观战
正式平衡
```

不要自动合并，不要自动推送，不要自动创建 PR。
