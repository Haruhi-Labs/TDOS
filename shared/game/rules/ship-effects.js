import { initializeKoizumiOrb, dispelKoizumiOrb, updateKoizumiOrb } from "../koizumi-orb.js";
import { resetHaruhiHeroPowerShock } from "../haruhi-hero-power.js";
import { initializeBunnyShip, cleanseBunnyShipControl, purgeBunnyShipForm, commitBunnyTransform } from "../bunny-haruhi-runtime.js";
import { purgeBunnyReliableEffect, initializeBunnyReliableReceiver } from "../bunny-companion-runtime.js";
import { initializeClawMarks, clearClawMarks, activeClawMarks, expireClawMarks, registerClawHit } from "../shamisen-claw.js";

import { bunnyHaruhiSupportSource } from "../bunny-haruhi-support.js";
import { triggerSupportOtherworlder } from "../haruhi-support.js";
import { triggerHaruhiOtherworlder } from "../haruhi-flagship.js";

// 角色写入适配：在实体的确定阶段同步调用，不把伤害或控制推迟到帧尾。
// 组件由各专属模块更新；基础血量、位移与定时效果仍通过实体操作提交。
export const SHIP_EFFECTS = Object.freeze({
  consumeBarrierRam(source, attackerTeam, ramKind) {
    if (ramKind !== "haruhi_otherworlder") return true;
    return source.bunnyHaruhi
      ? triggerSupportOtherworlder(bunnyHaruhiSupportSource(source, !attackerTeam.areSkillsDisabled()), attackerTeam.match.elapsed)
      : triggerHaruhiOtherworlder(attackerTeam);
  },
  // null 走公共能量路径；false 为拒绝；成功返回待施放组件消费的完成结果。
  castExclusiveSubSkill(ship) {
    return ship?.bunnyHaruhi ? commitBunnyTransform(ship) : null;
  },
  initialize(ship) {
    initializeKoizumiOrb(ship);
    resetHaruhiHeroPowerShock(ship);
    initializeClawMarks(ship);
    initializeBunnyReliableReceiver(ship);
    initializeBunnyShip(ship);
  },
  clearControl(ship) {
    resetHaruhiHeroPowerShock(ship);
    cleanseBunnyShipControl(ship);
  },
  clearPositive(ship, preserveCurrentTick) {
    const preservedTick = preserveCurrentTick ? ship.team.match.tick : -1;
    let cleared = purgeBunnyReliableEffect(ship, preservedTick);
    if (purgeBunnyShipForm(ship, preservedTick)) cleared = true;
    for (const key of ["reliableUntil", "bladeQueenUntil", "catPawUntil"]) {
      if (ship.clearTimedEffect(key, preserveCurrentTick)) cleared = true;
    }
    if (ship.canClearActiveSkillEffect("koizumiOrb", preserveCurrentTick) && dispelKoizumiOrb(ship)) {
      cleared = true;
      ship.forgetActiveSkillEffect("koizumiOrb");
    }
    if (ship.canClearActiveSkillEffect("nextShotDamageMultiplier", preserveCurrentTick)) {
      if (ship.effects.nextShotDamageMultiplier > 1) cleared = true;
      ship.consumeNextShotMultiplier();
    }
    return cleared;
  },
  hasNegative(ship) {
    const now = ship.team.match.elapsed;
    return ship.heroPowerShock.recoveryUntil > now
      || (ship.bunnyStageExposure?.recoveryUntil || 0) > now
      || activeClawMarks(ship).stacks > 0;
  },
  clearNegative: clearClawMarks,
  expireMarks: expireClawMarks,
  registerClawHit,
  advanceMovement: updateKoizumiOrb,
  prepareShotDamage(ship, damage, match) {
    if (ship.effects.nextShotDamageMultiplier > 1) {
      damage *= ship.effects.nextShotDamageMultiplier;
      match.spawnFloatingTextKey(ship.x + 12, ship.y - 12, "超能力", {}, "#9be0ff");
      ship.consumeNextShotMultiplier();
    }
    return damage;
  },
  onProjectileHit(projectile, target, match) {
    if (!projectile.claw || target.kind !== "ship" || !target.alive) return;
    registerClawHit(target, {
      ...projectile.claw, sourceSeat: projectile.team.seat, color: projectile.color,
    }, match, projectile.source);
  },
});
