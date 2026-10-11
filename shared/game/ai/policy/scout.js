// 侦察机的发射判断、选区与长门侦察条令的接入。
// 这些方法安装在 RulePolicy 的原型上，经 this 访问观测、参数、随机流与策略状态。
import { skillMetaForCharacter } from "../../characters.js";
import { SCOUT_LAUNCH_COST } from "../../combat-rules.js";
import { clamp, distance } from "../../math.js";

export const scoutMethods = {
  likelyProbeZoneId(focus) {
    if (!focus) {
      return null;
    }
    const travel = this.predictEnemyVector(focus);
    const probeDistance = clamp((140 + (focus.uncertainty || 0) * 0.9) * this.profile.probeDistanceMultiplier, 150, this.obs.world.size / 2.6);
    const probeX = this.clampX(focus.x + Math.cos(travel.angle) * probeDistance, this.safeRoutePadding());
    const probeY = this.clampY(focus.y + Math.sin(travel.angle) * probeDistance, this.safeRoutePadding());
    return this.zoneForPoint(probeX, probeY).id;
  },

  // 选侦察机起源舰：取离"敌方估计位置(或目标战区中心)"最近的存活舰，使侦察最快抵近目标(前出分离舰优先)
  pickScoutSourceKey(zoneId, aimPoint = null) {
    const c = (aimPoint && Number.isFinite(aimPoint.x)) ? aimPoint : this.zoneCenter(zoneId);
    let bestKey = "main";
    let bestD = Infinity;
    for (const key of ["main", "sub1", "sub2"]) {
      const ship = this.obs.self.ships[key];
      if (!ship || !ship.alive) continue;
      const d = c ? distance(ship.x, ship.y, c.x, c.y) : 0;
      if (d < bestD) { bestD = d; bestKey = key; }
    }
    return bestKey;
  },

  planScoutDeployment(context = this.currentContext) {
    if (!this.obs.self.flags.yukiFlagship || !this.obs.self.ships.main.alive) {
      return null;
    }
    const focus = context?.focus || this.primaryEnemyEstimate();
    const activeScouts = this.obs.self.scouts
      .filter((scout) => scout.alive && scout.combatCapable)
      .map((scout) => ({
        id: scout.id,
        zoneId: scout.zoneId || this.zoneForPoint(scout.x, scout.y).id,
        life: scout.life,
        mode: scout.mode,
        mission: scout.mission,
      }));
    return this.planYukiDeployment({
      zones: this.obs.world.zones,
      worldSize: this.obs.world.size,
      ownMain: this.obs.self.ships.main,
      forwardSign: this.seat === "A" ? 1 : -1,
      focus,
      contacts: this.knownEnemyContacts({ maxAge: 12 }),
      beliefZoneWeights: this.beliefZoneWeights(),
      activeScouts,
      context: context || {},
      now: this.obs.time,
      probeZoneId: this.likelyProbeZoneId(focus),
    });
  },

  shouldLaunchScout(context = this.currentContext, scoutPlan = null) {
    const SL = this.params.scout.launch;
    if (this.shouldReserveEnergyForHaruhiFlagship()) {
      return false;
    }
    if (!context) {
      return true;
    }
    const fleetEnergy = context.fleetEnergy || this.energyProfile("main");
    if (fleetEnergy.current < SCOUT_LAUNCH_COST) {
      return false;
    }
    if (this.obs.self.flags.yukiFlagship) {
      const activeScouts = this.obs.self.scouts.filter((item) => item.alive && item.combatCapable).length;
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

  shouldReserveEnergyForHaruhiFlagship() {
    if (this.obs.self.loadout.main !== "haruhi" || !this.obs.self.ships.main.alive) {
      return false;
    }
    const meta = skillMetaForCharacter("haruhi", "flagship");
    const cost = Number(meta?.cost) || 0;
    const readyIn = Math.max(
      0,
      Number(this.obs.self.cooldowns.flagship) || 0,
      Number(this.flagshipTimer) || 0,
    );
    if (readyIn > this.params.skills.haruhiFlagship.energyReserveWindow) {
      return false;
    }
    const energy = this.energyProfile("main");
    // 即将可以施放时，侦察机不能抢走技能所需能量；仍保留5%余量，避免施放后立刻失去机动能力。
    return energy.current - SCOUT_LAUNCH_COST < cost + energy.max * 0.05;
  },
};
