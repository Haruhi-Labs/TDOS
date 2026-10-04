// 规则策略：只通过端口读取观测、提交动作，数值来自参数表，随机取自分配的随机流。
// 决策的各个阶段分布在同目录的模块里，由下方统一安装到原型上；本文件负责状态初始化与每帧的阶段编排。
import { SCOUT_LAUNCH_COST } from "../../combat-rules.js";
import { normalizeAiDifficulty, resolveAiParams } from "../params/index.js";
import { createScoutDoctrineState, recordScoutDeployment } from "./tactics/yuki-scout.js";
import { viewMethods } from "./view.js";
import { commandsMethods } from "./commands.js";
import { debugStateMethods } from "./debug-state.js";
import { geometryMethods } from "./geometry.js";
import { intelTrackerMethods } from "./intel-tracker.js";
import { beliefMethods } from "./belief.js";
import { evaluationMethods } from "./evaluation.js";
import { energyMethods } from "./energy.js";
import { contextMethods } from "./context.js";
import { splitMethods } from "./split.js";
import { modeMethods } from "./mode.js";
import { scoutMethods } from "./scout.js";
import { skillsMethods } from "./skills.js";
import { detachedMethods } from "./detached.js";
import { targetsMethods } from "./targets.js";
import { movementMethods } from "./movement.js";

export class RulePolicy {
  // port 是 AI 与对局之间的唯一通道：port.observe() 读取观测，port.submit(action) 提交动作。
  // params 指定难度、预设与覆盖：{ difficulty, preset, overrides }。
  constructor(port, { rng, params } = {}) {
    this.port = port;
    this.seat = port.seat;
    this.indexedObservation = null;
    this.observationIndex = null;
    // 每席 AI 使用对局分配的随机流；未带种子的对局里它就是环境随机源。
    this.rng = rng;
    // 决策用到的全部数值都来自参数表；难度与旧版对照是其上的覆盖层。
    this.paramSpec = { difficulty: "master", preset: null, overrides: null, ...(params || {}) };
    this.applyParamSpec();

    this.moveTimer = 0;
    this.koizumiOrbSteerTimer = 0;
    this.scoutTimer = this.obs.self.flags.yukiFlagship ? 0.55 : this.profile.initialScoutTimer;
    this.scoutDoctrine = createScoutDoctrineState();
    this.currentScoutPlan = null;
    this.scoutPlanRefreshAt = 0;
    // 春日的首次施放既能立即提供团队强化，也会解锁常驻支援，因此不等待通用的开局观察窗。
    this.flagshipTimer = this.obs.self.loadout.main === "haruhi" ? 0 : this.profile.initialFlagshipTimer;
    this.subTimers = {
      sub1: this.profile.initialSubTimers.sub1,
      sub2: this.profile.initialSubTimers.sub2,
    };
    this.modeTimer = 0;
    this.mode = "press";

    this.lastMainPos = {
      x: this.obs.self.ships.main.x,
      y: this.obs.self.ships.main.y,
    };
    this.stuckTimer = 0;

    const enemyMain = this.port.enemySpawn();
    const spawnZone = this.zoneForPoint(enemyMain.x, enemyMain.y);
    this.searchOrder = [5, 2, 8, 4, 6, 1, 7, 3, 9];
    this.searchCursor = 0;
    this.enemyIntel = {
      entities: new Map(),
      main: {
        id: enemyMain.id,
        kind: "ship",
        key: enemyMain.key,
        slotKey: enemyMain.slotKey,
        x: enemyMain.x,
        y: enemyMain.y,
        angle: enemyMain.angle,
        speed: 0,
        seenAt: this.obs.time,
        zoneId: spawnZone.id,
        source: "spawn",
      },
      searchZoneId: spawnZone.id,
    };
    this.pendingSightings = new Map();
    this.searchSweepSign = 1;
    this.lastSearchAdvanceAt = this.obs.time;
    // 情报占据图(belief)：像人一样推理敌人位置——持续预测(向外扩散可能区)、排除(己方视野
    // 看过且无敌的区清零)、缩小到最高概率未排除区去搜。初始以敌出生点为峰。
    this.belief = this.initBelief(enemyMain);
    this.lastTacticalPlan = {
      focus: this.debugContact(this.enemyIntel.main),
      searchCenter: this.debugPoint(this.zoneCenter(spawnZone.id)),
      combatCenter: null,
      searchAssignments: null,
      sectorPlan: null,
      detachedPlan: null,
      orders: {},
      useSearchSectorPlan: false,
      shouldUseDetachedRoles: false,
    };
    this.lastScoutDecision = {
      action: "idle",
      zoneId: spawnZone.id,
      launched: false,
      urgent: false,
      at: this.obs.time,
    };
    this.lastFlagshipDecision = {
      action: "idle",
      cast: false,
      at: this.obs.time,
      target: null,
    };
    this.lastSubSkillDecision = {
      sub1: {
        action: "idle",
        cast: false,
        at: this.obs.time,
        target: null,
      },
      sub2: {
        action: "idle",
        cast: false,
        at: this.obs.time,
        target: null,
      },
    };
    this.lastSplitDecision = {
      attempt1: false,
      attempt2: false,
      acted: [],
      level: this.obs.self.splitLevel,
      at: this.obs.time,
    };
  }

  get obs() {
    return this.port.observe();
  }

  applyParamSpec() {
    this.params = resolveAiParams(this.paramSpec);
    this.profile = this.params.profile;
    this.difficulty = normalizeAiDifficulty(this.paramSpec.difficulty);
    this.reactionMult = this.params.difficulty.reactionMult;
    this.replanMult = this.params.difficulty.replanMult;
  }

  // 只切换 AI 决策参数的难度覆盖层；数值缩放等让分由对局在构造时写入舰队。
  setDifficulty(level) {
    this.paramSpec = { ...this.paramSpec, difficulty: level };
    this.applyParamSpec();
    return this;
  }

  // 旧版 AI 对照：等价于启用 legacy 预设。
  get legacy() {
    return this.paramSpec.preset === "legacy";
  }

  set legacy(value) {
    this.paramSpec = { ...this.paramSpec, preset: value ? "legacy" : null };
    this.applyParamSpec();
  }

  // 控制变量对照：关闭间接情报。
  get noIndirectIntel() {
    return !this.params.features.indirectIntel;
  }

  set noIndirectIntel(value) {
    const overrides = this.paramSpec.overrides || {};
    this.paramSpec = {
      ...this.paramSpec,
      overrides: { ...overrides, features: { ...overrides.features, indirectIntel: !value } },
    };
    this.applyParamSpec();
  }

  update(dt, elapsed) {
    const ST = this.params.scout.timers;
    this.moveTimer -= dt;
    this.koizumiOrbSteerTimer -= dt;
    this.scoutTimer -= dt;
    this.flagshipTimer -= dt;
    this.subTimers.sub1 -= dt;
    this.subTimers.sub2 -= dt;
    this.modeTimer -= dt;

    this.refreshIntel();
    this.updateBelief(dt);
    this.updateStuckState(dt);
    const main = this.obs.self.ships.main;
    const focus = main.alive ? this.selectEnemyFocus(main) : null;
    this.currentContext = main.alive && focus ? this.buildTacticalContext(main, focus) : null;
    this.evaluateSplit(elapsed, this.currentContext);
    this.enforceEnergyThrottleCaps();
    const shouldRefreshScoutPlan = this.obs.self.flags.yukiFlagship && (
      !this.currentScoutPlan
      || this.obs.time >= this.scoutPlanRefreshAt
      || this.scoutTimer <= 0
      || this.obs.time >= this.scoutDoctrine.nextRetaskAt
    );
    if (shouldRefreshScoutPlan) {
      this.currentScoutPlan = this.planScoutDeployment(this.currentContext);
      this.scoutPlanRefreshAt = this.obs.time + ST.planRefresh;
    }
    const scoutPlan = this.currentScoutPlan;
    const retaskedScouts = this.retaskYukiCombatScouts(scoutPlan);

    if (
      this.currentContext
      && this.currentContext.intelUrgency > ST.urgentIntel
      && this.obs.self.scouts.filter((item) => item.alive).length === 0
    ) {
      this.scoutTimer = Math.min(this.scoutTimer, this.profile.aggressiveScoutWindow);
    }

    if (
      this.currentContext
      && this.currentContext.maxShipThreat > ST.urgentThreat
      && this.obs.self.scouts.filter((item) => item.alive).length <= 1
    ) {
      this.scoutTimer = Math.min(this.scoutTimer, this.profile.aggressiveScoutWindow);
    }

    if (this.moveTimer <= 0 || this.stuckTimer > this.profile.stuckTrigger) {
      this.issueMovement(this.currentContext);
      this.moveTimer = this.rng.range(this.profile.moveReplanMin, this.profile.moveReplanMax) * (this.replanMult || 1);
      this.stuckTimer = 0;
    }
    this.steerActiveKoizumiOrbs(this.currentContext);

    if (this.scoutTimer <= 0 && !this.obs.self.scoutsDisabled) {
      if (this.shouldLaunchScout(this.currentContext, scoutPlan)) {
        const focusEst = this.currentContext?.focus || this.primaryEnemyEstimate();
        const zoneId = scoutPlan?.zoneId || this.pickScoutZoneId(this.obs.self.ships.main, focusEst);
        // 侦察目标点：看得见就奔可见处；看不见就奔 belief 占据图的最高概率(未排除)区——
        // 让侦察去"最该排查"的地方，系统化缩小可能区(类人搜索)。前出分离舰就近发出，最快覆盖。
        const peak = (focusEst && focusEst.visible) ? null : this.beliefPeak();
        const scoutAim = scoutPlan?.seekPoint || peak || focusEst;
        const scoutSourceKey = this.pickScoutSourceKey(zoneId, scoutAim);
        const seekPoint = scoutAim && Number.isFinite(scoutAim.x) ? { x: scoutAim.x, y: scoutAim.y } : null;
        // 侦察机也必须纳入能量预算。尤其是分离副舰，不能只因刚好攒够28点就立即花光，
        // 否则下一秒既无法机动，也无法使用自保技能。
        const scoutEnergyFloors = this.obs.self.flags.yukiFlagship
          ? { emergencyFloor: ST.yukiEmergencyFloor, normalFloor: ST.yukiNormalFloor, conserveFloor: ST.yukiConserveFloor }
          : { emergencyFloor: ST.emergencyFloor, normalFloor: ST.normalFloor, conserveFloor: ST.conserveFloor };
        const hasScoutReserve = this.allowEnergyCommit(
          scoutSourceKey,
          SCOUT_LAUNCH_COST,
          this.currentContext,
          scoutEnergyFloors,
        );
        const launched = hasScoutReserve
          && this.writeLaunchScout(zoneId, {
            fromShipKey: scoutSourceKey,
            seekPoint,
            patrolCenter: scoutPlan?.seekPoint || seekPoint,
            patrolRadius: scoutPlan?.patrolRadius,
            mission: scoutPlan?.mission,
          });
        if (launched && scoutPlan) {
          recordScoutDeployment(this.scoutDoctrine, scoutPlan, this.obs.time);
        }
        this.lastScoutDecision = {
          action: launched ? "launch" : hasScoutReserve ? "retry" : "hold-energy",
          zoneId,
          launched,
          urgent: Boolean(this.currentContext?.emergencyCommit || this.currentContext?.searchRequired || this.currentContext?.trackableIntel),
          doctrineMode: scoutPlan?.mode || null,
          mission: scoutPlan?.mission || null,
          primaryZoneId: scoutPlan?.primaryZoneId || null,
          predictedZoneId: scoutPlan?.predictedZoneId || null,
          retasked: retaskedScouts,
          at: this.obs.time,
        };
        if (launched) {
          if (scoutPlan) {
            this.scoutTimer = this.rng.range(scoutPlan.cadenceMin, scoutPlan.cadenceMax);
          } else if (this.currentContext?.scoutPriority > ST.highPriority || this.currentContext?.searchRequired || this.currentContext?.maxShipThreat > ST.highThreat) {
            this.scoutTimer = this.rng.range(ST.launchedUrgent[0], ST.launchedUrgent[1]);
          } else if (this.currentContext?.trackableIntel) {
            this.scoutTimer = this.rng.range(ST.launchedTrackable[0], ST.launchedTrackable[1]);
          } else if (this.currentContext?.conserveEnergy) {
            this.scoutTimer = this.rng.range(ST.launchedConserve[0], ST.launchedConserve[1]);
          } else {
            this.scoutTimer = this.rng.range(ST.launched[0], ST.launched[1]);
          }
        } else {
          this.scoutTimer = !hasScoutReserve
            ? this.obs.self.flags.yukiFlagship ? this.rng.range(ST.noEnergyYuki[0], ST.noEnergyYuki[1]) : this.rng.range(ST.noEnergy[0], ST.noEnergy[1])
            : this.currentContext?.emergencyCommit
              ? this.rng.range(ST.rejectedEmergency[0], ST.rejectedEmergency[1])
              : this.rng.range(ST.rejected[0], ST.rejected[1]);
        }
      } else {
        this.lastScoutDecision = {
          action: "hold",
          zoneId: this.enemyIntel.searchZoneId || null,
          launched: false,
          urgent: false,
          doctrineMode: scoutPlan?.mode || null,
          mission: scoutPlan?.mission || null,
          primaryZoneId: scoutPlan?.primaryZoneId || null,
          predictedZoneId: scoutPlan?.predictedZoneId || null,
          retasked: retaskedScouts,
          at: this.obs.time,
        };
        this.scoutTimer = this.obs.self.flags.yukiFlagship
          ? this.currentContext?.conserveEnergy ? this.rng.range(ST.holdYukiConserve[0], ST.holdYukiConserve[1]) : this.rng.range(ST.holdYuki[0], ST.holdYuki[1])
          : this.currentContext?.conserveEnergy ? this.rng.range(ST.holdConserve[0], ST.holdConserve[1]) : this.rng.range(ST.hold[0], ST.hold[1]);
      }
    }

    this.tryFlagshipSkill(this.currentContext);
    this.trySubSkill("sub1", this.currentContext);
    this.trySubSkill("sub2", this.currentContext);
    // 技能可能在本 tick 内显著消耗能量，立即降档，不能等下一轮改航才停止4档消耗。
    this.enforceEnergyThrottleCaps();
  }
}

for (const methods of [
  viewMethods,
  commandsMethods,
  debugStateMethods,
  geometryMethods,
  intelTrackerMethods,
  beliefMethods,
  evaluationMethods,
  energyMethods,
  contextMethods,
  splitMethods,
  modeMethods,
  scoutMethods,
  skillsMethods,
  detachedMethods,
  targetsMethods,
  movementMethods,
]) {
  for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(methods))) {
    Object.defineProperty(RulePolicy.prototype, name, { ...descriptor, enumerable: false });
  }
}
