// 侦察机的发射判断、选区与长门侦察条令的接入。
// 每个算法显式声明事实和查询输入；执行算法按需重读动作后的事实。
import { skillMetaForCharacter } from "../../characters/catalog.js";
import { SCOUT_LAUNCH_COST } from "../../rules/combat-rules.js";
import { clamp, distance } from "../../foundation/math.js";

export const scoutMethods = {
  likelyProbeZoneId({
    predictEnemyVector: capPredictEnemyVector,
    profile: policyProfile,
    obs: policyObs,
    clampX: capClampX,
    safeRoutePadding: capSafeRoutePadding,
    clampY: capClampY,
    zoneForPoint: capZoneForPoint,
  }, focus) {
    if (!focus) {
      return null;
    }
    const travel = capPredictEnemyVector(focus);
    const probeDistance = clamp((140 + (focus.uncertainty || 0) * 0.9) * policyProfile.probeDistanceMultiplier, 150, policyObs.world.size / 2.6);
    const probeX = capClampX(focus.x + Math.cos(travel.angle) * probeDistance, capSafeRoutePadding());
    const probeY = capClampY(focus.y + Math.sin(travel.angle) * probeDistance, capSafeRoutePadding());
    return capZoneForPoint(probeX, probeY).id;
  },

  // 选侦察机起源舰：取离"敌方估计位置(或目标战区中心)"最近的存活舰，使侦察最快抵近目标(前出分离舰优先)
  pickScoutSourceKey({ zoneCenter: capZoneCenter, obs: policyObs }, zoneId, aimPoint = null) {
    const c = (aimPoint && Number.isFinite(aimPoint.x)) ? aimPoint : capZoneCenter(zoneId);
    let bestKey = "main";
    let bestD = Infinity;
    for (const key of ["main", "sub1", "sub2"]) {
      const ship = policyObs.self.ships[key];
      if (!ship || !ship.alive) continue;
      const d = c ? distance(ship.x, ship.y, c.x, c.y) : 0;
      if (d < bestD) { bestD = d; bestKey = key; }
    }
    return bestKey;
  },

  planScoutDeployment({
    currentContext: policyCurrentContext,
    obs: policyObs,
    primaryEnemyEstimate: capPrimaryEnemyEstimate,
    zoneForPoint: capZoneForPoint,
    planYukiDeployment: capPlanYukiDeployment,
    seat: policySeat,
    knownEnemyContacts: capKnownEnemyContacts,
    beliefZoneWeights: capBeliefZoneWeights,
    likelyProbeZoneId: capLikelyProbeZoneId,
  }, context = policyCurrentContext) {
    if (!policyObs.self.flags.yukiFlagship || !policyObs.self.ships.main.alive) {
      return null;
    }
    const focus = context?.focus || capPrimaryEnemyEstimate();
    const activeScouts = policyObs.self.scouts
      .filter((scout) => scout.alive && scout.combatCapable)
      .map((scout) => ({
        id: scout.id,
        zoneId: scout.zoneId || capZoneForPoint(scout.x, scout.y).id,
        life: scout.life,
        mode: scout.mode,
        mission: scout.mission,
      }));
    return capPlanYukiDeployment({
      zones: policyObs.world.zones,
      worldSize: policyObs.world.size,
      ownMain: policyObs.self.ships.main,
      forwardSign: policySeat === "A" ? 1 : -1,
      focus,
      contacts: capKnownEnemyContacts({ maxAge: 12 }),
      beliefZoneWeights: capBeliefZoneWeights(),
      activeScouts,
      context: context || {},
      now: policyObs.time,
      probeZoneId: capLikelyProbeZoneId(focus),
    });
  },

  shouldLaunchScout({
    currentContext: policyCurrentContext,
    params: policyParams,
    shouldReserveEnergyForHaruhiFlagship: capShouldReserveEnergyForHaruhiFlagship,
    energyProfile: capEnergyProfile,
    obs: policyObs,
  }, context = policyCurrentContext, scoutPlan = null) {
    const SL = policyParams.scout.launch;
    if (capShouldReserveEnergyForHaruhiFlagship()) {
      return false;
    }
    if (!context) {
      return true;
    }
    const fleetEnergy = context.fleetEnergy || capEnergyProfile("main");
    if (fleetEnergy.current < SCOUT_LAUNCH_COST) {
      return false;
    }
    if (policyObs.self.flags.yukiFlagship) {
      const activeScouts = policyObs.self.scouts.filter((item) => item.alive && item.combatCapable).length;
      const desiredActive = scoutPlan?.desiredActive || SL.yukiDesiredActive;
      const maxActive = scoutPlan?.maxActive || SL.yukiMaxActive;
      if (activeScouts >= maxActive) {
        return false;
      }
      if (context.emergencyCommit && context.intelSolid && fleetEnergy.ratio < SL.yukiEmergencyEnergy && activeScouts >= 2) {
        return false;
      }
      if (context.conserveEnergy && activeScouts >= 2 && !context.searchRequired && !context.trackableIntel) {
        return false;
      }
      return activeScouts < desiredActive
        || context.scoutPriority > SL.yukiPriority
        || context.trackableIntel
        || context.maxShipThreat > SL.yukiThreat;
    }
    if (context.emergencyCommit && context.intelSolid && fleetEnergy.ratio < SL.emergencyEnergy) {
      return false;
    }
    if (context.conserveEnergy && !context.searchRequired && !context.trackableIntel) {
      return false;
    }
    return context.scoutPriority > SL.priority;
  },

  shouldReserveEnergyForHaruhiFlagship({ obs: policyObs, flagshipTimer: policyFlagshipTimer, params: policyParams, energyProfile: capEnergyProfile }) {
    if (policyObs.self.loadout.main !== "haruhi" || !policyObs.self.ships.main.alive) {
      return false;
    }
    const meta = skillMetaForCharacter("haruhi", "flagship");
    const cost = Number(meta?.cost) || 0;
    const readyIn = Math.max(
      0,
      Number(policyObs.self.cooldowns.flagship) || 0,
      Number(policyFlagshipTimer) || 0,
    );
    if (readyIn > policyParams.skills.haruhiFlagship.energyReserveWindow) {
      return false;
    }
    const energy = capEnergyProfile("main");
    // 即将可以施放时，侦察机不能抢走技能所需能量；仍保留5%余量，避免施放后立刻失去机动能力。
    return energy.current - SCOUT_LAUNCH_COST < cost + energy.max * 0.05;
  },
};
