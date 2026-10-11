import { characterDecisionFacts, characterDecisionInput } from "./characters/decision-view.js";
// 技能施放的无状态条件评估；检查节拍由 SkillDecisionCycle 独占。
// 这些方法安装在 RulePolicy 的原型上，读取观测与战术上下文，不持有技能时钟或执行技能。
import { skillMetaForCharacter } from "../../characters.js";
import { distance } from "../../math.js";
import { characterProfile } from "./characters/index.js";
import { barrierBlocksRangedAttack } from "./tactics/character-counterplay.js";

export const skillsMethods = {
  characterSkillFacts(ship = null) {
    return characterDecisionFacts({
      obs: this.obs, mode: this.mode, energyHigh: ship ? this.energyProfile(ship).high : false,
      skillAimLead: this.params.features.skillAimLead, aimPadding: this.safeRoutePadding(4), searchZoneId: this.searchZoneId,
    });
  },
  usesAdvancedSkillCounterplay() {
    return this.params.features.advancedCounterplay;
  },

  incomingVisionWaveWillPurge(ships, buffDuration) {
    if (!this.usesAdvancedSkillCounterplay()) {
      return false;
    }
    const targets = ships.filter((ship) => ship?.alive);
    const state = this.obs.enemy.visionWave;
    const horizon = Math.max(0.2, Number(buffDuration) || 0);
    if (targets.length === 0 || !state) {
      return false;
    }

    const now = this.obs.time;
    const waves = state.waves.filter((wave) => wave.expiresAt > now);
    const willReachWithin = (wave, ship, delay = 0) => {
      const speed = Math.max(1, Number(wave.speed) || 480);
      const width = Math.max(0, Number(wave.width) || 0);
      const currentRadius = Math.max(0, (now - wave.emittedAt) * speed);
      const targetRadius = distance(wave.x, wave.y, ship.x, ship.y);
      const contactRadius = width * 0.5 + Math.max(0, Number(ship.radius) || 0);
      // 波前已经完全越过该舰时不会回头；否则按公开可见的波心、速度和宽度估算到达时间。
      if (currentRadius - contactRadius > targetRadius) {
        return false;
      }
      const arrival = delay + Math.max(0, targetRadius - contactRadius - currentRadius) / speed;
      return arrival <= horizon;
    };

    for (const wave of waves) {
      if (targets.some((ship) => willReachWithin(wave, ship))) {
        return true;
      }
    }

    // 技能仍会继续发波时，以最新一圈公开波纹的波心预测下一圈。不会读取隐藏朝仓的
    // 实时坐标；若朝仓正在移动，这只是困难以上 AI 对已见轨迹的合理外推。
    const hasFuturePulse = state.pulsesRemaining > 0
      && state.nextPulseAt < state.activeUntil - 1e-9;
    const latestWave = waves.at(-1);
    if (!hasFuturePulse || !latestWave) {
      return false;
    }
    const nextPulseDelay = Math.max(0, state.nextPulseAt - now);
    const projectedWave = {
      ...latestWave,
      emittedAt: now,
    };
    return targets.some((ship) => willReachWithin(projectedWave, ship, nextPulseDelay));
  },

  shouldDelayFlagshipBuff(characterId, meta) {
    if (!characterProfile(characterId).flagship?.purgeableBuff) {
      return false;
    }
    const targets = this.ownShips();
    return this.incomingVisionWaveWillPurge(targets, meta?.duration || 6);
  },

  shouldDelaySubBuff(ship, meta) {
    if (!ship || !characterProfile(ship.characterId).sub?.purgeableBuff) {
      return false;
    }
    const usefulDuration = meta?.duration || 6;
    return this.incomingVisionWaveWillPurge([ship], usefulDuration);
  },

  shouldCastFlagshipSkill(estimate, context = this.currentContext) {
    const K = this.params.skills.flagship;
    const main = this.obs.self.ships.main;
    const characterId = this.obs.self.loadout.main;
    if (!estimate || !main.alive) {
      return false;
    }
    const meta = skillMetaForCharacter(characterId, "flagship");
    if (!meta || meta.type !== "active") {
      return false; // 被动旗舰(阿虚/有希):没有可主动释放的技能,别空试
    }
    if (this.shouldDelayFlagshipBuff(characterId, meta)) {
      return false;
    }
    const profile = characterProfile(characterId).flagship;
    const energyFloors = profile?.energyFloors?.(K)
      || { emergencyFloor: K.emergencyFloor, normalFloor: K.normalFloor, conserveFloor: K.conserveFloor };
    if (meta?.cost && !this.allowEnergyCommit("main", meta.cost, context, energyFloors)) {
      return false;
    }
    const dist = distance(main.x, main.y, estimate.x, estimate.y);
    return profile?.shouldCast ? profile.shouldCast(this.characterSkillFacts(), characterDecisionInput({ K, main, estimate, context, dist })) : true;
  },

  shouldCastSubSkill(ship, estimate, context = this.currentContext) {
    const K = this.params.skills.sub;
    if (!ship || !ship.alive) {
      return false;
    }
    const profile = characterProfile(ship.characterId).sub;
    if (profile?.decideAlone) return profile.decideAlone(this.characterSkillFacts(ship), characterDecisionInput({ ship, estimate, context }));
    const meta = skillMetaForCharacter(ship.characterId, "sub");
    if (this.shouldDelaySubBuff(ship, meta)) {
      return false;
    }
    if (meta?.cost && !this.allowEnergyCommit(ship, meta.cost, context, { emergencyFloor: K.emergencyFloor, normalFloor: K.normalFloor, conserveFloor: K.conserveFloor })) {
      return false;
    }
    const dist = estimate ? distance(ship.x, ship.y, estimate.x, estimate.y) : Infinity;
    const enemyBarrier = context?.barrierTactics?.enemy;
    const assignedToBreach = Boolean(
      enemyBarrier?.active
      && context?.barrierTactics?.breachShipKey === ship.key,
    );
    const breachDistance = enemyBarrier
      ? distance(ship.x, ship.y, enemyBarrier.x, enemyBarrier.y)
      : dist;
    const blockedByBarrier = barrierBlocksRangedAttack(enemyBarrier, ship, K.barrierBlockMargin);
    return profile?.shouldCast
      ? profile.shouldCast(this.characterSkillFacts(ship), characterDecisionInput({ K, ship, estimate, context, dist, assignedToBreach, breachDistance, blockedByBarrier }))
      : true;
  },
};
