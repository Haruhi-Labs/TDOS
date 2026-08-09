import { clamp, distance } from "../../shared/game-core.js";
import { getPveCampaign, PVE_CAMPAIGN_IDS } from "./campaigns.js";

const DIFFICULTY_PROFILES = Object.freeze({
  easy: {
    teleportFirst: 10,
    teleportInterval: 20,
    teleportWarning: 1.5,
    teleportShips: 1,
    justiceStages: [36, 56, 72],
    justiceCheat: { damage: 1.68, fireRate: 1.52, range: 1.32, damageTaken: 0.76 },
  },
  normal: {
    teleportFirst: 8,
    teleportInterval: 16,
    teleportWarning: 1.25,
    teleportShips: 2,
    justiceStages: [30, 49, 65],
    justiceCheat: { damage: 1.8, fireRate: 1.6, range: 1.36, damageTaken: 0.72 },
  },
  hard: {
    teleportFirst: 6.5,
    teleportInterval: 13.5,
    teleportWarning: 1.05,
    teleportShips: 2,
    justiceStages: [24, 41, 56],
    justiceCheat: { damage: 2.1, fireRate: 1.8, range: 1.42, damageTaken: 0.7 },
  },
  master: {
    teleportFirst: 5.5,
    teleportInterval: 11.5,
    teleportWarning: 0.88,
    teleportShips: 3,
    justiceStages: [18, 32, 45],
    justiceCheat: { damage: 2.35, fireRate: 1.9, range: 1.46, damageTaken: 0.67 },
  },
});

const JUSTICE_PHASES = Object.freeze([
  {
    label: "作弊协议：全开",
    detail: "全图观测 · 火控增幅 · 射程扩展 · 动力超频",
  },
  {
    label: "第一权限已被剥离",
    detail: "火控增幅失效 · 全图观测、射程与动力仍有效",
  },
  {
    label: "第二权限已被剥离",
    detail: "全图观测与射程扩展失效 · 仅余动力超频",
  },
  {
    label: "解析完成",
    detail: "作弊协议全部失效 · 强化长门进入完全战斗状态",
  },
]);

function difficultyProfile(difficulty) {
  return DIFFICULTY_PROFILES[difficulty] || DIFFICULTY_PROFILES.normal;
}

function setShipPose(ship, x, y, angle) {
  if (!ship) return;
  ship.x = x;
  ship.y = y;
  ship.angle = angle;
  ship.speed = 0;
  ship.command = { x, y };
  ship.route = null;
  ship.forcedKnockback = null;
}

function placeFleet(team, x, y, angle) {
  const main = team.ships.main;
  setShipPose(main, x, y, angle);
  for (const ship of [team.ships.sub1, team.ships.sub2]) {
    const offset = ship.formationOffset || { x: -36, y: ship.key === "sub1" ? 22 : -22 };
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const ox = offset.x * 0.5;
    const oy = offset.y * 0.5;
    setShipPose(ship, x + ox * cos - oy * sin, y + ox * sin + oy * cos, angle);
  }
}

function event(id, speaker, text, characterId = null, tone = "info", textArgs = {}) {
  return { id, speaker, text, characterId, tone, textArgs };
}

export function pveSimulationOptions(campaignId, difficulty = "normal") {
  const campaign = getPveCampaign(campaignId);
  if (!campaign) return null;
  return {
    mode: "ai",
    teamNames: {
      A: campaign.playerTeamName,
      B: campaign.enemyTeamName,
    },
    teamLoadouts: {
      A: campaign.playerLoadout,
      B: campaign.enemyLoadout,
    },
    aiDifficulty: difficulty,
  };
}

class PveCampaignRuntime {
  constructor(simulation, campaignId, difficulty = "normal", options = {}) {
    this.sim = simulation;
    this.campaign = getPveCampaign(campaignId);
    if (!this.campaign) {
      throw new Error(`未知的 PVE 战役：${campaignId}`);
    }
    this.id = campaignId;
    this.difficulty = difficulty;
    this.profile = difficultyProfile(difficulty);
    this.random = typeof options.random === "function" ? options.random : Math.random;
    this.started = false;
    this.events = [];
    this.eventSequence = 0;
    this.phaseIndex = 0;
    this.nextAllyPlanAt = 0;
    this.nextTeleportAt = Infinity;
    this.pendingTeleports = [];
    this.teleportCursor = 0;
    this.ally = null;
    this.configure();
  }

  configure() {
    if (this.id === PVE_CAMPAIGN_IDS.RESEARCH_CHALLENGE) {
      this.configureResearchChallenge();
      return;
    }
    this.configureJusticePrevails();
  }

  configureResearchChallenge() {
    const size = this.sim.worldSize;
    placeFleet(this.sim.teamA, size * 0.27, size * 0.5, 0);
    placeFleet(this.sim.teamB, size * 0.73, size * 0.5, Math.PI);
    this.sim.teamB.forceFullVision = true;
    this.sim.teamB.splitLevel = 2;

    this.ally = this.sim.teamA.addScenarioShip({
      key: "campaign-yuki",
      slotKey: "campaign-yuki",
      characterId: "yuki",
      roleLabel: "援军",
      x: size * 0.2,
      y: size * 0.5 + 92,
      facing: 0,
      throttle: 1,
      countsForVictory: false,
      modifiers: {
        hp: 1.18,
        speed: 1.08,
        turnRate: 1.2,
        accel: 1.28,
        regen: 1.3,
        vision: 1.35,
        range: 1.1,
        damage: 1,
        fireRate: 1,
        damageTaken: 0.9,
      },
    });
    this.ally.name = "援军·强化长门有希";
    // 开场前隐藏，演出到“接入”镜头再出现；跳过演出时 startBattle 会兜底恢复。
    this.ally.alive = false;
    this.ally.hp = this.ally.maxHp;
  }

  configureJusticePrevails() {
    const size = this.sim.worldSize;
    // 速攻图将双方摆在一个战区宽度内，并让双方以侧舷相对；玩家可以立刻兑现短暂火控优势。
    placeFleet(this.sim.teamA, size * 0.35, size * 0.5, -Math.PI * 0.5);
    placeFleet(this.sim.teamB, size * 0.65, size * 0.5, Math.PI * 0.5);
    this.sim.teamB.ships.main.configureScenarioModifiers({
      hp: 1.5,
      speed: 1.08,
      turnRate: 1.18,
      accel: 1.2,
      regen: 1.25,
      vision: 1.42,
      range: 1.16,
      damage: 1.12,
      fireRate: 1.1,
      damageTaken: 0.86,
    });
    this.setJusticePhase(0, false);
  }

  startBattle() {
    if (this.started) return;
    this.started = true;
    if (this.id === PVE_CAMPAIGN_IDS.RESEARCH_CHALLENGE) {
      if (this.ally) {
        this.ally.alive = true;
        this.ally.hp = Math.max(1, this.ally.hp || this.ally.maxHp);
      }
      this.sim.teamB.computeVisibility(this.sim.teamA);
      this.nextTeleportAt = this.profile.teleportFirst;
      this.pushEvent(event(
        "research-start",
        "长门有希",
        "独立战斗舰已接入。我会牵制相位跃迁目标。",
        "yuki",
        "ally",
      ));
    } else {
      this.sim.teamA.computeVisibility(this.sim.teamB);
      this.pushEvent(event(
        "justice-start",
        "电研社社长",
        "作弊协议全开。现在就是唯一的先手窗口！",
        null,
        "advantage",
      ));
    }
  }

  pushEvent(value) {
    this.eventSequence += 1;
    this.events.push({ ...value, sequence: this.eventSequence });
  }

  consumeEvents() {
    return this.events.splice(0);
  }

  applyOpeningCue(cue) {
    const size = this.sim.worldSize;
    if (this.id === PVE_CAMPAIGN_IDS.RESEARCH_CHALLENGE) {
      if (cue === "enemy-cheat") {
        for (const ship of this.sim.teamA.getPlayerShips()) {
          this.sim.spawnBurst(ship.x, ship.y, "#ff6d78", 13);
        }
      }
      if (cue === "yuki-arrives" || cue === "ally-lock" || cue === "battle-ready") {
        if (this.ally && !this.ally.alive) {
          this.ally.alive = true;
          this.ally.hp = this.ally.maxHp;
          setShipPose(this.ally, size * 0.22, size * 0.5 + 104, -0.12);
          this.sim.spawnBurst(this.ally.x, this.ally.y, "#b8a9f0", 22);
        }
      }
    } else if (cue === "player-cheat") {
      for (const ship of this.sim.teamA.getPlayerShips()) {
        this.sim.spawnBurst(ship.x, ship.y, "#f0d488", 15);
      }
    } else if (cue === "yuki-analysis") {
      const yuki = this.sim.teamB.ships.main;
      this.sim.spawnBurst(yuki.x, yuki.y, "#b8a9f0", 20);
    }
  }

  updateBeforeStep() {
    if (!this.started || this.sim.phase !== "running") return;
    if (this.id === PVE_CAMPAIGN_IDS.RESEARCH_CHALLENGE) {
      this.updateAllyTactics();
      this.updateEnemyTeleport();
    } else {
      this.updateJusticeTimeline();
    }
  }

  updateAfterStep() {
    if (!this.started || this.sim.phase !== "running") return;
    if (this.id === PVE_CAMPAIGN_IDS.RESEARCH_CHALLENGE && this.ally && !this.ally.alive && !this.allyLossReported) {
      this.allyLossReported = true;
      this.pushEvent(event(
        "ally-lost",
        "长门有希",
        "独立舰体停止响应。后续战斗交还给你。",
        "yuki",
        "danger",
      ));
    }
  }

  updateAllyTactics() {
    const ally = this.ally;
    const now = this.sim.elapsed;
    if (!ally?.alive || now + 1e-9 < this.nextAllyPlanAt) return;
    this.nextAllyPlanAt = now + 2.2;
    const enemies = this.sim.teamB.getAllShips().filter((ship) => ship.alive);
    if (!enemies.length) return;

    let target = enemies[0];
    let targetDistance = distance(ally.x, ally.y, target.x, target.y);
    for (const candidate of enemies.slice(1)) {
      const candidateDistance = distance(ally.x, ally.y, candidate.x, candidate.y);
      if (candidateDistance < targetDistance) {
        target = candidate;
        targetDistance = candidateDistance;
      }
    }
    const angleToTarget = Math.atan2(target.y - ally.y, target.x - ally.x);
    const flankSign = Math.sin(now * 0.23 + target.id) >= 0 ? 1 : -1;
    const desiredRange = clamp(ally.effectiveRange() * 0.7, 280, 430);
    const flankAngle = angleToTarget + flankSign * Math.PI * 0.48;
    const tx = this.sim.clampX(target.x + Math.cos(flankAngle) * desiredRange, 32);
    const ty = this.sim.clampY(target.y + Math.sin(flankAngle) * desiredRange, 32);
    ally.setBezierRoute(undefined, undefined, tx, ty, targetDistance > 620 ? 1.4 : 1, false);
  }

  scheduleTeleport() {
    const enemies = this.sim.teamB.getAllShips().filter((ship) => ship.alive && !ship.forcedKnockback);
    const players = this.sim.teamA.getPlayerShips().filter((ship) => ship.alive);
    if (!enemies.length || !players.length) return;
    const teleportCount = Math.min(enemies.length, this.profile.teleportShips || 1);
    const ordered = Array.from({ length: teleportCount }, (_, index) => enemies[(this.teleportCursor + index) % enemies.length]);
    this.teleportCursor += teleportCount;
    const weakest = players.reduce((current, candidate) => (
      !current || candidate.hp / candidate.maxHp < current.hp / current.maxHp ? candidate : current
    ), null);
    this.pendingTeleports = ordered.map((ship, index) => {
      const target = index === 0 ? weakest : players[index % players.length];
      const bearing = Math.atan2(target.y - ship.y, target.x - ship.x);
      const side = index % 2 === 0 ? 1 : -1;
      const flank = side * (Math.PI * (0.42 + index * 0.12) + this.random() * 0.22);
      const offset = 340 + this.random() * 90;
      const x = this.sim.clampX(target.x + Math.cos(bearing + flank) * offset, 36);
      const y = this.sim.clampY(target.y + Math.sin(bearing + flank) * offset, 36);
      this.sim.spawnBurst(x, y, "#ff6d78", 18);
      this.sim.spawnFloatingTextKey(x + 12, y - 14, "相位坐标锁定", {}, "#ff9da5");
      return {
        ship,
        target,
        x,
        y,
        executeAt: this.sim.elapsed + this.profile.teleportWarning + index * 0.14,
      };
    });
    this.pushEvent(event(
      `teleport-warning-${this.teleportCursor}`,
      "战术警报",
      "{count}艘敌舰正在改写坐标，注意红色相位落点。",
      null,
      "danger",
      { count: teleportCount },
    ));
  }

  updateEnemyTeleport() {
    const now = this.sim.elapsed;
    if (!this.pendingTeleports.length && now + 1e-9 >= this.nextTeleportAt) {
      this.scheduleTeleport();
      this.nextTeleportAt = now + this.profile.teleportInterval * (0.9 + this.random() * 0.2);
    }
    const due = this.pendingTeleports.filter((pending) => now + 1e-9 >= pending.executeAt);
    this.pendingTeleports = this.pendingTeleports.filter((pending) => now + 1e-9 < pending.executeAt);
    for (const { ship, target, x, y } of due) {
      if (!ship.alive) continue;
      this.sim.teamB.blinkShip(ship, x, y, this.sim.worldSize * 2);
      if (target?.alive) ship.angle = Math.atan2(target.y - ship.y, target.x - ship.x) + Math.PI * 0.5;
    }
  }

  updateJusticeTimeline() {
    const stageTimes = this.profile.justiceStages;
    let nextPhase = this.phaseIndex;
    while (nextPhase < stageTimes.length && this.sim.elapsed + 1e-9 >= stageTimes[nextPhase]) {
      nextPhase += 1;
    }
    if (nextPhase !== this.phaseIndex) this.setJusticePhase(nextPhase, true);
  }

  setJusticePhase(index, announce) {
    this.phaseIndex = clamp(Math.round(index), 0, 3);
    const player = this.sim.teamA;
    if (this.phaseIndex === 0) {
      const cheat = this.profile.justiceCheat;
      player.forceFullVision = true;
      player.configureScenarioModifiers({
        speed: 1.24,
        turnRate: 1.22,
        accel: 1.34,
        vision: 1.24,
        range: cheat.range,
        damage: cheat.damage,
        fireRate: cheat.fireRate,
        damageTaken: cheat.damageTaken,
      });
    } else if (this.phaseIndex === 1) {
      player.forceFullVision = true;
      player.configureScenarioModifiers({
        damage: 1,
        fireRate: 1,
        damageTaken: 1,
      });
    } else if (this.phaseIndex === 2) {
      player.forceFullVision = false;
      player.configureScenarioModifiers({
        vision: 1,
        range: 1,
      });
    } else {
      player.forceFullVision = false;
      player.configureScenarioModifiers({
        speed: 1,
        turnRate: 1,
        accel: 1,
      });
      this.sim.teamB.ships.main.configureScenarioModifiers({
        speed: 1.16,
        accel: 1.28,
        damage: 1.26,
        fireRate: 1.22,
        damageTaken: 0.78,
      });
    }
    if (!announce) return;
    const messages = [
      null,
      event("justice-fire-control-lost", "长门有希", "火控增幅与防护修正已解除。", "yuki", "danger"),
      event("justice-vision-lost", "长门有希", "全域观测与超距火控权限已解除。", "yuki", "danger"),
      event("justice-complete", "长门有希", "解析完成。非对称参数归零。开始反制。", "yuki", "danger"),
    ];
    this.pushEvent(messages[this.phaseIndex]);
    const yuki = this.sim.teamB.ships.main;
    this.sim.spawnBurst(yuki.x, yuki.y, "#b8a9f0", 18 + this.phaseIndex * 3);
    this.sim.spawnAnnouncementKey(
      this.sim.worldSize * 0.5,
      this.sim.worldSize * 0.23,
      JUSTICE_PHASES[this.phaseIndex].label,
      {},
      "#e4d8ff",
    );
  }

  hudState() {
    if (this.id === PVE_CAMPAIGN_IDS.RESEARCH_CHALLENGE) {
      const pending = this.pendingTeleports.length
        ? Math.max(0, Math.min(...this.pendingTeleports.map((item) => item.executeAt)) - this.sim.elapsed)
        : null;
      return {
        title: this.campaign.shortTitle,
        objective: this.campaign.objective,
        phase: pending === null ? "敌方作弊协议：全域观测 / 相位跃迁" : "相位跃迁预警 {seconds}秒",
        phaseArgs: pending === null ? {} : { seconds: pending.toFixed(1) },
        tone: pending === null ? "hostile" : "danger",
      };
    }
    const nextAt = this.profile.justiceStages[this.phaseIndex];
    return {
      title: this.campaign.shortTitle,
      objective: this.campaign.objective,
      phase: JUSTICE_PHASES[this.phaseIndex].label,
      detail: JUSTICE_PHASES[this.phaseIndex].detail,
      countdown: Number.isFinite(nextAt) ? Math.max(0, nextAt - this.sim.elapsed) : null,
      tone: this.phaseIndex === 0 ? "advantage" : this.phaseIndex === 3 ? "danger" : "hostile",
    };
  }
}

export function createPveCampaignRuntime(simulation, campaignId, difficulty = "normal", options = {}) {
  return new PveCampaignRuntime(simulation, campaignId, difficulty, options);
}
