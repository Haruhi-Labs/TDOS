import { launchHaruhiRandomBeam } from "./rules/character-launch.js";
import { readonlyIdSet } from "../data/readonly-id-set.js";
import { CHARACTER_DEFS } from "./characters.js";
import { BUNNY_HARUHI_CONFIG as C } from "./bunny-haruhi-config.js";
import {
  createBunnyStageExposure, resolveBunnyStageExposure, leaveBunnyStage,
  createBunnyHaruhiState, cleanseBunnyStageControl, purgeBunnyForm,
  bunnySelfDrainAmount, bunnyStageHealAmount, clearBunnyFormWindows,
  planBunnyTransform, nextBunnyForm, isBunnyBroadcasting, isBunnyControlLocked,
  resolveBunnyThrottle, isBunnyEncoreLocked,
} from "./bunny-haruhi.js";
import { rngFor } from "./rng.js";
import { bunnyHaruhiSupportSource, unlockBunnyHaruhiSupport, updateBunnyHaruhiSupport } from "./bunny-haruhi-support.js";
import { bunnyCompanions, bunnyCompanionOwner, createBunnyCompanion } from "./bunny-companion-runtime.js";
import { supportOrbGeometry, supportOtherworlderReady, clearSupportQueue, initializeSupport, replaceSupportState, readSupportState } from "./haruhi-support.js";

export const BUNNY_HARUHI_CHARACTER = CHARACTER_DEFS.bunny_haruhi;

const companionFactories = new WeakMap();
const forms = new WeakMap();
const formViews = new WeakMap();
const exposures = new WeakMap();
const exposureSources = new WeakMap();
const battles = new WeakMap();

/** 对局只编排阶段；持续结算游标与舞台样本由角色运行时独占。 */
export function initializeBunnyBattle(match) {
  if (battles.has(match)) return true;
  const teams = [match.teamA, match.teamB];
  if (!teams.some((team) => team.getPlayerShips().some((ship) => ship.bunnyHaruhi))) return false;
  const battle = { sustainAt: match.elapsed, stages: new Map() };
  battles.set(match, battle);
  Object.defineProperty(match, "bunnyHaruhiActive", { enumerable: true, value: true });
  for (const team of teams) {
    if (!team.ships.main.bunnyHaruhi) continue;
    battle.stages.set(team, null);
    Object.defineProperty(team, "bunnyStage", { enumerable: true, get: () => battle.stages.get(team) });
  }
  return true;
}

function commitForm(ship, state) {
  replaceSupportState(ship, state.support);
  forms.set(ship, Object.freeze({ ...state, visitedForms: readonlyIdSet(state.visitedForms) }));
  formViews.delete(ship);
}

function commitExposure(ship, state) {
  exposures.set(ship, Object.freeze(state));
}

// 母舰关系与舰队发布在一个同步事务内提交；伴随舰工厂不反向修改母舰状态。
export function spawnBunnyCompanion(owner) {
  if (!owner.alive || owner.bunnyHaruhi?.form !== "encore" || owner.bunnyHaruhi.companionId !== null
    || !["sub1", "sub2"].includes(owner.key) || owner.team.ships[owner.key] !== owner) return null;
  const ship = createBunnyCompanion(owner, companionFactories.get(owner));
  owner.team.addAuxiliaryShip(ship);
  commitForm(owner, { ...owner.bunnyHaruhi, companionId: ship.id, companionSpawned: true });
  return ship;
}

export function initializeBunnyShip(ship, createShip) {
  Object.defineProperty(ship, "bunnyStageExposure", { enumerable: true, get: () => exposures.get(ship) });
  if (ship.character !== BUNNY_HARUHI_CHARACTER) return;
  Object.defineProperty(ship, "bunnyHaruhi", { enumerable: true, get: () => {
    const support = readSupportState(ship);
    let view = formViews.get(ship);
    if (!view || view.support !== support) {
      view = Object.freeze({ ...forms.get(ship), support });
      formViews.set(ship, view);
    }
    return view;
  } });
  companionFactories.set(ship, createShip);
  commitForm(ship, createBunnyHaruhiState());
  // 保留锁档的实时读取与最终落值语义，覆盖已有动作、航线和兼容调用。
  ship.configureThrottleConstraint((value) => resolveBunnyThrottle(
    ship.bunnyHaruhi, value, !ship.team.areSkillsDisabled(), ship.team.match.elapsed,
  ));
}

export function cleanseBunnyShipControl(ship) {
  if (ship.bunnyStageExposure) commitExposure(ship, cleanseBunnyStageControl(ship.bunnyStageExposure));
}

export function purgeBunnyShipForm(ship, preservedTick) {
  if (!ship.bunnyHaruhi) return false;
  const old = ship.bunnyHaruhi;
  const next = purgeBunnyForm(old, preservedTick);
  commitForm(ship, next);
  return next.positiveSuppressed !== old.positiveSuppressed || next.immunityUntil !== old.immunityUntil;
}

/** 光环取来源的开关；目标自己的技能封印不能关闭敌方光环。 */
export function bunnyStageEnabled(ship) {
  const exposure = ship.bunnyStageExposure;
  if (!exposure?.inside || !ship.alive) return false;
  const source = exposureSources.get(ship);
  return Boolean(source && source.id === exposure.sourceShipId && source.team !== ship.team
    && source.alive && !source.team.areSkillsDisabled());
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
  // 解锁先在事务私有来源上完成，再连同形态发布；随机回调不能看到半提交形态。
  const plannedSupport = {};
  initializeSupport(plannedSupport, result.state.support);
  if (result.unlockSupport) unlockBunnyHaruhiSupport({
    ...bunnyHaruhiSupportSource(ship, true), owner: plannedSupport,
  }, match.elapsed, rngFor(match).next);
  commitForm(ship, { ...result.state, support: readSupportState(plannedSupport) });
  ship.applyResourcePlan(result);
  ship.setThrottle(resolveBunnyThrottle(result.state, oldThrottle, true, match.elapsed));
  ship.rescaleCombatTiming(oldSpeed, oldRate);
  for (const old of companions) {
    old.ship.rescaleCombatTiming(old.speed, old.rate);
  }
  if (result.spawnCompanion) spawnBunnyCompanion(ship);
  // 角色只提交效果，成功冷却、统计、显形及随后视野刷新交还施放事务。
  return { cooldown: result.cooldownSeconds, refreshVisibility: true };
}

export function refreshBunnyVisibility(match) {
  match.teamA.computeVisibility(match.teamB);
  match.teamB.computeVisibility(match.teamA);
}

/** 先采样双方全部圆，再写目标状态，避免席位顺序反馈到同阶段半径。 */
export function resolveBunnyStages(match) {
  const battle = battles.get(match);
  if (!battle) return;
  const samples = [match.teamA, match.teamB].map((team) => {
    const main = team.ships.main;
    return main.bunnyHaruhi && main.alive && !team.areSkillsDisabled()
      ? Object.freeze({ sourceShipId: main.id, seat: team.seat, x: main.x, y: main.y, radius: main.effectiveVision() }) : null;
  });
  for (let i = 0; i < 2; i += 1) {
    const team = i === 0 ? match.teamA : match.teamB;
    const sample = samples[1 - i];
    if (team.ships.main.bunnyHaruhi) battle.stages.set(team, samples[i]);
    for (const ship of team.getPlayerShips()) {
      const inside = Boolean(sample && ship.alive
        && (ship.x - sample.x) ** 2 + (ship.y - sample.y) ** 2 <= sample.radius ** 2 + 1e-9);
      if (!inside && !ship.bunnyStageExposure) continue;
      const resolved = resolveBunnyStageExposure(ship.bunnyStageExposure || createBunnyStageExposure(), {
        inside, sourceShipId: sample?.sourceShipId, now: match.elapsed, tick: match.tick,
      });
      if (sample) exposureSources.set(ship, (i === 0 ? match.teamB : match.teamA).ships.main);
      commitExposure(ship, resolved.state);
      if (resolved.healRatio && ship.alive) ship.restoreHull(ship.maxHp * resolved.healRatio);
      if (!ship.isControlImmune() && isBunnyControlLocked(resolved.state, match.elapsed)) ship.setFlightSpeed(0);
    }
  }
}

/** 每权威区间只结算一次；后续成员关系采样不重复结算持续资源。 */
export function advanceBunnyRules(match) {
  const battle = battles.get(match);
  if (!battle) return;
  const from = battle.sustainAt;
  const to = match.elapsed;
  if (to > from) {
    for (const team of [match.teamA, match.teamB]) {
      for (const ship of team.getPlayerShips()) {
        if (!ship.alive) continue;
        if (ship.bunnyHaruhi) ship.drainHull(bunnySelfDrainAmount(ship.bunnyHaruhi, {
          from, to, hp: ship.hp, maxHp: ship.maxHp, enabled: !team.areSkillsDisabled(),
        }));
        if (ship.bunnyStageExposure) ship.restoreHull(bunnyStageHealAmount(ship.bunnyStageExposure, {
          from, to, hp: ship.hp, maxHp: ship.maxHp, enabled: bunnyStageEnabled(ship),
        }));
      }
    }
    battle.sustainAt = to;
  }
  cleanupBunnySources(match);
  resolveBunnyStages(match);
}

export function updateBunnyTeamSupports(team, dt) {
  for (const ship of [team.ships.sub1, team.ships.sub2]) {
    if (!ship.bunnyHaruhi) continue;
    updateBunnyHaruhiSupport(bunnyHaruhiSupportSource(ship, !team.areSkillsDisabled()), team.match.elapsed, dt, {
      launchRandomBeam: (source) => launchHaruhiRandomBeam(team, source),
    });
  }
}

export function cleanupBunnySources(match) {
  const battle = battles.get(match);
  if (!battle) return;
  for (const team of [match.teamA, match.teamB]) {
    for (const ship of team.getPlayerShips()) {
      if (ship.bunnyHaruhi && !ship.alive) {
        commitForm(ship, clearBunnyFormWindows(ship.bunnyHaruhi));
        clearSupportQueue(ship);
      }
      if (ship.bunnyStageExposure?.inside && !bunnyStageEnabled(ship)) commitExposure(ship, leaveBunnyStage(ship.bunnyStageExposure));
    }
    if (team.bunnyStage && (!team.ships.main.alive || team.areSkillsDisabled())) battle.stages.set(team, null);
  }
}

export function bunnyBroadcastsShip(team, ship) {
  if (!ship.alive || !team.getPlayerShips().includes(ship) || team.areSkillsDisabled()) return false;
  const main = team.ships.main;
  if (main.bunnyHaruhi && main.alive
    && (ship.x - main.x) ** 2 + (ship.y - main.y) ** 2 <= main.effectiveVision() ** 2 + 1e-9) return true;
  // knows只广播来源自身；bless仍广播己方全部玩家舰位。
  return team.getPlayerShips().some((source) => source.alive
    && isBunnyBroadcasting(source.bunnyHaruhi, team.match.elapsed)
    && (source === ship || source.bunnyHaruhi.form !== "knows"));
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
