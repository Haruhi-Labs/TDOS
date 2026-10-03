import { CHARACTER_DEFS } from "./characters.js";
import { BUNNY_HARUHI_CONFIG as C } from "./bunny-haruhi-config.js";
import {
  createBunnyStageExposure, resolveBunnyStageExposure, leaveBunnyStage,
  bunnySelfDrainAmount, bunnyStageHealAmount, clearBunnyFormWindows,
  planBunnyTransform, nextBunnyForm, isBunnyBroadcasting, isBunnyControlLocked,
  resolveBunnyThrottle, isBunnyEncoreLocked,
} from "./bunny-haruhi.js";
import { bunnyHaruhiSupportSource, unlockBunnyHaruhiSupport, updateBunnyHaruhiSupport } from "./bunny-haruhi-support.js";
import { bunnyCompanions, bunnyCompanionOwner } from "./bunny-companion-runtime.js";
import { supportOrbGeometry, supportOtherworlderReady } from "./haruhi-support.js";

export const BUNNY_HARUHI_CHARACTER = CHARACTER_DEFS.bunny_haruhi;

/** 光环取来源的开关；目标自己的技能封印不能关闭敌方光环。 */
export function bunnyStageEnabled(ship) {
  const exposure = ship.bunnyStageExposure;
  if (!exposure?.inside || !ship.alive) return false;
  const enemy = ship.team.match.enemyTeamBySeat(ship.team.seat);
  return enemy.ships.main.id === exposure.sourceShipId && enemy.ships.main.alive && !enemy.areSkillsDisabled();
}

export function bunnyTransformBlockReason(ship) {
  if (!ship?.bunnyHaruhi || !["sub1", "sub2"].includes(ship.key)
    || ship.team.ships[ship.key] !== ship) return "invalid_slot";
  if (!ship.alive) return "dead";
  if (ship.isAttached()) return "attached";
  if (!ship.canControl() || ship.isKoizumiOrbActive()) return "control_locked";
  if (ship.isSilenced()) return "silenced";
  if (ship.team.areSkillsDisabled()) return "skills_disabled";
  if (ship.team.cooldowns[ship.key] > 0) return "cooldown";
  if (nextBunnyForm(ship.bunnyHaruhi) === "bless" && ship.hp <= ship.maxHp * C.bless.hpCostRatio) return "insufficient_hp";
  return null;
}

export function commitBunnyTransform(ship) {
  if (bunnyTransformBlockReason(ship)) return false;
  const { team } = ship;
  const { match } = team;
  const result = planBunnyTransform(ship.bunnyHaruhi, ship, match.elapsed, match.tick);
  if (!result.ok) return false;
  const oldSpeed = ship.effectiveSpeed();
  const oldRate = ship.effectiveFireRate();
  const oldThrottle = ship.throttle;
  const companions = bunnyCompanions(match).filter((candidate) => candidate.alive && bunnyCompanionOwner(candidate) === ship && candidate.team === team)
    .map((candidate) => ({ ship: candidate, speed: candidate.effectiveSpeed(), rate: candidate.effectiveFireRate() }));
  if (result.unlockSupport) {
    const source = { ...bunnyHaruhiSupportSource(ship, true), state: result.state.support };
    unlockBunnyHaruhiSupport(source, match.elapsed, Math.random);
  }
  ship.bunnyHaruhi = result.state;
  ship.hp = result.hp;
  ship.energy = result.energy;
  ship.throttle = resolveBunnyThrottle(result.state, oldThrottle, true, match.elapsed);
  if (oldSpeed > 0) ship.speed *= ship.effectiveSpeed() / oldSpeed;
  ship.cooldown *= oldRate / ship.effectiveFireRate();
  for (const old of companions) {
    if (old.speed > 0) old.ship.speed *= old.ship.effectiveSpeed() / old.speed;
    old.ship.cooldown *= old.rate / old.ship.effectiveFireRate();
  }
  if (result.spawnCompanion) team.spawnBunnyCompanion(ship);
  team.cooldowns[ship.key] = result.cooldownSeconds;
  match.recordAction(team.seat, "sub_skill");
  team.revealCasterIfSeen(ship);
  refreshBunnyVisibility(match);
  return true;
}

export function refreshBunnyVisibility(match) {
  match.teamA.computeVisibility(match.teamB);
  match.teamB.computeVisibility(match.teamA);
}

/** 先采样双方全部圆，再写目标状态，避免席位顺序反馈到同阶段半径。 */
export function resolveBunnyStages(match) {
  const samples = [match.teamA, match.teamB].map((team) => {
    const main = team.ships.main;
    return main.bunnyHaruhi && main.alive && !team.areSkillsDisabled()
      ? { sourceShipId: main.id, seat: team.seat, x: main.x, y: main.y, radius: main.effectiveVision() } : null;
  });
  for (let i = 0; i < 2; i += 1) {
    const team = i === 0 ? match.teamA : match.teamB;
    const sample = samples[1 - i];
    if (team.ships.main.bunnyHaruhi) team.bunnyStage = samples[i];
    for (const ship of team.getPlayerShips()) {
      const inside = Boolean(sample && ship.alive
        && (ship.x - sample.x) ** 2 + (ship.y - sample.y) ** 2 <= sample.radius ** 2 + 1e-9);
      if (!inside && !ship.bunnyStageExposure) continue;
      const resolved = resolveBunnyStageExposure(ship.bunnyStageExposure || createBunnyStageExposure(), {
        inside, sourceShipId: sample?.sourceShipId, now: match.elapsed, tick: match.tick,
      });
      ship.bunnyStageExposure = resolved.state;
      if (resolved.healRatio && ship.alive) ship.hp = Math.min(ship.maxHp, ship.hp + ship.maxHp * resolved.healRatio);
      if (!ship.isControlImmune() && isBunnyControlLocked(resolved.state, match.elapsed)) ship.speed = 0;
    }
  }
}

/** 每权威区间只结算一次；后续成员关系采样不重复结算持续资源。 */
export function advanceBunnyRules(match) {
  const from = match.bunnySustainAt;
  const to = match.elapsed;
  if (to > from) {
    for (const team of [match.teamA, match.teamB]) {
      for (const ship of team.getPlayerShips()) {
        if (!ship.alive) continue;
        if (ship.bunnyHaruhi) ship.hp -= bunnySelfDrainAmount(ship.bunnyHaruhi, {
          from, to, hp: ship.hp, maxHp: ship.maxHp, enabled: !team.areSkillsDisabled(),
        });
        if (ship.bunnyStageExposure) ship.hp += bunnyStageHealAmount(ship.bunnyStageExposure, {
          from, to, hp: ship.hp, maxHp: ship.maxHp, enabled: bunnyStageEnabled(ship),
        });
      }
    }
    match.bunnySustainAt = to;
  }
  cleanupBunnySources(match);
  resolveBunnyStages(match);
}

export function updateBunnyTeamSupports(team, dt) {
  for (const ship of [team.ships.sub1, team.ships.sub2]) {
    if (!ship.bunnyHaruhi) continue;
    updateBunnyHaruhiSupport(bunnyHaruhiSupportSource(ship, !team.areSkillsDisabled()), team.match.elapsed, dt, {
      launchRandomBeam: (source) => team.launchHaruhiRandomBeam(source),
    });
  }
}

export function cleanupBunnySources(match) {
  for (const team of [match.teamA, match.teamB]) {
    for (const ship of team.getPlayerShips()) {
      if (ship.bunnyHaruhi && !ship.alive) {
        ship.bunnyHaruhi = clearBunnyFormWindows(ship.bunnyHaruhi);
        ship.bunnyHaruhi.support.queuedBeamAt.length = 0;
      }
      if (ship.bunnyStageExposure?.inside && !bunnyStageEnabled(ship)) ship.bunnyStageExposure = leaveBunnyStage(ship.bunnyStageExposure);
    }
    if (team.bunnyStage && (!team.ships.main.alive || team.areSkillsDisabled())) team.bunnyStage = null;
  }
}

export function bunnyBroadcastsShip(team, ship) {
  if (!ship.alive || !team.getPlayerShips().includes(ship) || team.areSkillsDisabled()) return false;
  const main = team.ships.main;
  if (main.bunnyHaruhi && main.alive
    && (ship.x - main.x) ** 2 + (ship.y - main.y) ** 2 <= main.effectiveVision() ** 2 + 1e-9) return true;
  return team.getPlayerShips().some((source) => source.alive
    && isBunnyBroadcasting(source.bunnyHaruhi, team.match.elapsed));
}

/** 只输出白名单摘要，不暴露Set、首次领取历史、支援队列或可写实体引用。 */
export function serializeBunnyShip(ship) {
  const now = ship.team.match.elapsed;
  const fields = {};
  if (ship.bunnyHaruhi) {
    const state = ship.bunnyHaruhi;
    const enabled = !ship.team.areSkillsDisabled() && ship.alive;
    const source = bunnyHaruhiSupportSource(ship, enabled);
    const companion = bunnyCompanions(ship.team.match).find((candidate) => candidate.id === state.companionId);
    const blockReason = bunnyTransformBlockReason(ship);
    fields.bunnyHaruhi = {
      form: state.form, nextForm: nextBunnyForm(state), successfulCasts: state.successfulCasts,
      scoutsDisabled: state.scoutsDisabled, positiveSuppressed: state.positiveSuppressed,
      immunityRemaining: Math.max(0, state.immunityUntil - now),
      drainRemaining: Math.max(0, state.drainUntil - now),
      broadcastRemaining: Math.max(0, state.broadcastUntil - now),
      supporters: C.supportIds.filter((id) => state.support.supporters.has(id)),
      blockReason, canTransform: blockReason === null, enabled,
      lockedGear: isBunnyEncoreLocked(state, now, enabled) ? C.encore.lockedGear : null,
      broadcasting: enabled && isBunnyBroadcasting(state, now),
      esperOrb: supportOrbGeometry(source), otherworlderReady: supportOtherworlderReady(source, now),
      companionId: state.companionId, companionSpawned: state.companionSpawned,
      companion: companion ? { alive: companion.alive, teamSeat: companion.team.seat,
        convertedRemaining: Math.max(0, companion.bunnyCompanion.convertedUntil - now) } : null,
    };
  }
  if (ship.bunnyStageExposure) {
    const state = ship.bunnyStageExposure;
    fields.bunnyStageExposure = {
      sourceShipId: state.sourceShipId, phase: state.phase, inside: state.inside,
      controlLocked: !ship.isControlImmune() && isBunnyControlLocked(state, now, bunnyStageEnabled(ship)),
      lockRemaining: Math.max(0, state.lockUntil - now), recoveryRemaining: Math.max(0, state.recoveryUntil - now),
      entranceRemaining: state.inside ? Math.max(0, state.enteredAt + C.stage.entranceSeconds - now) : 0,
    };
  }
  return fields;
}
