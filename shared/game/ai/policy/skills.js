import { characterDecisionFacts, characterDecisionInput } from "./characters/decision-view.js";
// 技能施放的无状态条件评估；检查节拍由 SkillDecisionCycle 独占。
// 这些方法安装在 RulePolicy 的原型上，读取观测与战术上下文，不持有技能时钟或执行技能。
import { skillMetaForCharacter } from "../../characters.js";
import { distance } from "../../math.js";
import { characterProfile } from "./characters/index.js";
import { barrierBlocksRangedAttack } from "./tactics/character-counterplay.js";

export const skillsMethods = {
  characterSkillFacts({
    obs: policyObs,
    mode: policyMode,
    energyProfile: capEnergyProfile,
    params: policyParams,
    safeRoutePadding: capSafeRoutePadding,
    searchZoneId: policySearchZoneId,
  }, ship = null) {
    return characterDecisionFacts({
      obs: policyObs, mode: policyMode, energyHigh: ship ? capEnergyProfile(ship).high : false,
      skillAimLead: policyParams.features.skillAimLead, aimPadding: capSafeRoutePadding(4), searchZoneId: policySearchZoneId,
    });
  },
  usesAdvancedSkillCounterplay({ params: policyParams }) {
    return policyParams.features.advancedCounterplay;
  },

  incomingVisionWaveWillPurge({ usesAdvancedSkillCounterplay: capUsesAdvancedSkillCounterplay, obs: policyObs }, ships, buffDuration) {
    if (!capUsesAdvancedSkillCounterplay()) {
      return false;
    }
    const targets = ships.filter((ship) => ship?.alive);
    const state = policyObs.enemy.visionWave;
    const horizon = Math.max(0.2, Number(buffDuration) || 0);
    if (targets.length === 0 || !state) {
      return false;
    }

    const now = policyObs.time;
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

  shouldDelayFlagshipBuff({ ownShips: capOwnShips, incomingVisionWaveWillPurge: capIncomingVisionWaveWillPurge }, characterId, meta) {
    if (!characterProfile(characterId).flagship?.purgeableBuff) {
      return false;
    }
    const targets = capOwnShips();
    return capIncomingVisionWaveWillPurge(targets, meta?.duration || 6);
  },

  shouldDelaySubBuff({ incomingVisionWaveWillPurge: capIncomingVisionWaveWillPurge }, ship, meta) {
    if (!ship || !characterProfile(ship.characterId).sub?.purgeableBuff) {
      return false;
    }
    const usefulDuration = meta?.duration || 6;
    return capIncomingVisionWaveWillPurge([ship], usefulDuration);
  },

  shouldCastFlagshipSkill({
    currentContext: policyCurrentContext,
    params: policyParams,
    obs: policyObs,
    shouldDelayFlagshipBuff: capShouldDelayFlagshipBuff,
    allowEnergyCommit: capAllowEnergyCommit,
    characterSkillFacts: capCharacterSkillFacts,
  }, estimate, context = policyCurrentContext) {
    const K = policyParams.skills.flagship;
    const main = policyObs.self.ships.main;
    const characterId = policyObs.self.loadout.main;
    if (!estimate || !main.alive) {
      return false;
    }
    const meta = skillMetaForCharacter(characterId, "flagship");
    if (!meta || meta.type !== "active") {
      return false; // 被动旗舰(阿虚/有希):没有可主动释放的技能,别空试
    }
    if (capShouldDelayFlagshipBuff(characterId, meta)) {
      return false;
    }
    const profile = characterProfile(characterId).flagship;
    const energyFloors = profile?.energyFloors?.(K)
      || { emergencyFloor: K.emergencyFloor, normalFloor: K.normalFloor, conserveFloor: K.conserveFloor };
    if (meta?.cost && !capAllowEnergyCommit("main", meta.cost, context, energyFloors)) {
      return false;
    }
    const dist = distance(main.x, main.y, estimate.x, estimate.y);
    return profile?.shouldCast ? profile.shouldCast(capCharacterSkillFacts(), characterDecisionInput({ K, main, estimate, context, dist })) : true;
  },

  shouldCastSubSkill({
    currentContext: policyCurrentContext,
    params: policyParams,
    characterSkillFacts: capCharacterSkillFacts,
    shouldDelaySubBuff: capShouldDelaySubBuff,
    allowEnergyCommit: capAllowEnergyCommit,
  }, ship, estimate, context = policyCurrentContext) {
    const K = policyParams.skills.sub;
    if (!ship || !ship.alive) {
      return false;
    }
    const profile = characterProfile(ship.characterId).sub;
    if (profile?.decideAlone) return profile.decideAlone(capCharacterSkillFacts(ship), characterDecisionInput({ ship, estimate, context }));
    const meta = skillMetaForCharacter(ship.characterId, "sub");
    if (capShouldDelaySubBuff(ship, meta)) {
      return false;
    }
    if (meta?.cost && !capAllowEnergyCommit(ship, meta.cost, context, { emergencyFloor: K.emergencyFloor, normalFloor: K.normalFloor, conserveFloor: K.conserveFloor })) {
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
      ? profile.shouldCast(capCharacterSkillFacts(ship), characterDecisionInput({ K, ship, estimate, context, dist, assignedToBreach, breachDistance, blockedByBarrier }))
      : true;
  },
};
