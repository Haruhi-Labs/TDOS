import {
  isBunnyCompanion, deriveBunnyCompanionBase, createBunnyCompanionState,
  advanceBunnyCompanion, createBunnyReliableState, expireBunnyReliable, bunnyReliableRecovery,
  planBunnyCompanionConversion, purgeBunnyReliable,
} from "./bunny-haruhi-companion.js";
import { BUNNY_HARUHI_CONFIG as C } from "./bunny-haruhi-config.js";

// 伴随舰和接收者效果由该运行时独占写入，实体只提供冻结读视图。
const companions = new WeakMap();
const reliableEffects = new WeakMap();

export function initializeBunnyReliableReceiver(ship) {
  Object.defineProperty(ship, "bunnyReliable", { enumerable: true, get: () => reliableEffects.get(ship) });
}

function commitCompanionState(ship, state) {
  const followOffset = Object.isFrozen(state.followOffset) ? state.followOffset : Object.freeze({ ...state.followOffset });
  companions.set(ship, Object.freeze({ ...state, followOffset }));
}

function commitReliableEffect(ship, state) {
  reliableEffects.set(ship, Object.freeze(state));
}

export function purgeBunnyReliableEffect(ship, preservedTick) {
  if (!ship.bunnyReliable) return false;
  const old = ship.bunnyReliable;
  const next = purgeBunnyReliable(old, preservedTick);
  commitReliableEffect(ship, next);
  return next.suppressed !== old.suppressed;
}

export function bunnyCompanionOwner(ship) {
  const state = ship?.bunnyCompanion;
  if (!state) return null;
  return ship.team.match.teamBySeat(state.ownerSeat).getPlayerShips()
    .find((candidate) => candidate.id === state.ownerShipId) || null;
}

export function bunnyCompanionForm(ship) {
  const owner = bunnyCompanionOwner(ship);
  return ship?.alive && owner?.alive && owner.team === ship.team && !ship.bunnyCompanion.convertedUntil
    ? owner.bunnyHaruhi : undefined;
}

function followPoint(owner, offset) {
  const { match } = owner.team;
  const cos = Math.cos(owner.angle);
  const sin = Math.sin(owner.angle);
  return {
    x: match.clampX(owner.x + cos * offset.forward - sin * offset.lateral, 10),
    y: match.clampY(owner.y + sin * offset.forward + cos * offset.lateral, 10),
  };
}

/** Ship 工厂由舰队注入，角色规则不反向导入实体实现。 */
export function createBunnyCompanion(owner, createShip) {
  const { team } = owner;
  const point = followPoint(owner, C.companion.followOffset);
  const key = `bunny_kyon_${owner.id}`;
  const ship = createShip(team, key, point.x, point.y, owner.angle, {
    characterId: "kyon", slotKey: key, isAuxiliary: true, attachToMain: false,
    entityRole: C.companionRole, baseStats: deriveBunnyCompanionBase(owner.base), roleLabel: "伴随舰",
  });
  Object.defineProperty(ship, "bunnyCompanion", { enumerable: true, get: () => companions.get(ship) });
  commitCompanionState(ship, createBunnyCompanionState(owner.id, team.seat, team.match.elapsed));
  ship.resetHullCapacity(Math.max(1, Math.round(ship.base.hp * (team.statMult || 1))));
  ship.setThrottle(owner.throttle);
  return ship;
}

export function bunnyCompanions(match) {
  return [...match.teamA.extraShips, ...match.teamB.extraShips].filter(isBunnyCompanion)
    .sort((a, b) => a.id - b.id);
}

/** 接收者单独持有资格；来源死亡或换阵营后属性查询立即失效。 */
export function bunnyReliableState(ship) {
  if (!ship?.alive || !ship.bunnyReliable) return null;
  const source = bunnyCompanions(ship.team.match).find((candidate) => candidate.id === ship.bunnyReliable.sourceCompanionId);
  const owner = source && bunnyCompanionOwner(source);
  const valid = source?.alive && owner?.alive && source.team === owner.team && source.team === ship.team
    && !source.bunnyCompanion.convertedUntil && (ship === source || ship === owner);
  return expireBunnyReliable(ship.bunnyReliable, ship.team.match.elapsed, valid);
}

function clearCompanionReliable(ship) {
  for (const team of [ship.team.match.teamA, ship.team.match.teamB]) {
    for (const receiver of team.getAllShips()) {
      if (receiver.bunnyReliable?.sourceCompanionId === ship.id) reliableEffects.delete(receiver);
    }
  }
  commitCompanionState(ship, { ...ship.bunnyCompanion, reliableUntil: 0, reliableStartedTick: -1 });
}

function clearCompanionProjectiles(ship) {
  ship.team.match.discardProjectilesFrom(ship.id);
}

function transferCompanion(ship, destination, nextState) {
  const oldSpeed = ship.effectiveSpeed();
  const oldRate = ship.effectiveFireRate();
  clearCompanionReliable(ship);
  clearCompanionProjectiles(ship);
  ship.transferToTeam(destination);
  commitCompanionState(ship, nextState);
  // 位置与生命不因换阵营重算；伤害等查询读取当前阵营，禁止重复难度缩放。
  ship.clearRoute();
  ship.rescaleCombatTiming(oldSpeed, oldRate);
}

function returnCompanion(ship, now) {
  const owner = bunnyCompanionOwner(ship);
  transferCompanion(ship, owner.team, {
    ...ship.bunnyCompanion, convertedUntil: 0, nextReliableAt: now + C.companion.intervalSeconds,
    reliableUntil: 0, reliableStartedTick: -1,
  });
  ship.followTarget(followPoint(owner, ship.bunnyCompanion.followOffset), owner.throttle);
}

/** 战区资格由鹤屋入口校验；转移仅发生在队伍更新前的动作/生命周期阶段。 */
export function convertBunnyCompanion(ship, destination, zone) {
  if (!isBunnyCompanion(ship) || !ship.alive || !bunnyCompanionOwner(ship)?.alive
    || ship.team === destination || ship.team.match !== destination.match) return false;
  const now = destination.match.elapsed;
  if (destination.seat === ship.bunnyCompanion.ownerSeat) {
    // 原阵营反策反视为提前归还，同样重排自动技能和清除旧弹体。
    returnCompanion(ship, now);
  } else {
    transferCompanion(ship, destination, planBunnyCompanionConversion(ship.bunnyCompanion, now).state);
    ship.followTarget({ x: zone.x + zone.width * 0.5, y: zone.y + zone.height * 0.5 });
  }
  return true;
}

/** 退场不走伤害/舰损回调，不产生第二次击杀；死亡实体保留稳定ID摘要。 */
export function cleanupBunnyCompanions(match) {
  for (const ship of bunnyCompanions(match)) {
    const owner = bunnyCompanionOwner(ship);
    if (ship.alive && owner?.alive) continue;
    ship.retireWithoutLoss();
    commitCompanionState(ship, { ...ship.bunnyCompanion, nextReliableAt: null, convertedUntil: 0 });
    clearCompanionReliable(ship);
    clearCompanionProjectiles(ship);
  }
  for (const team of [match.teamA, match.teamB]) {
    for (const receiver of team.getAllShips()) {
      if (receiver.bunnyReliable && !bunnyReliableState(receiver)) reliableEffects.delete(receiver);
    }
  }
}

/** 每帧队伍更新前准备普通导航，不使用编队的位置插值或额外追赶倍率。 */
export function prepareBunnyCompanions(match) {
  cleanupBunnyCompanions(match);
  for (const ship of bunnyCompanions(match)) {
    if (!ship.alive) continue;
    const owner = bunnyCompanionOwner(ship);
    const result = advanceBunnyCompanion(ship.bunnyCompanion, {
      now: match.elapsed, tick: match.tick, alive: ship.alive, ownerAlive: owner?.alive,
      sameOwnerTeam: ship.team === owner?.team,
      canAct: !ship.isSilenced() && !ship.isControlLocked()
        && (!ship.forcedKnockback || ship.forcedKnockback.endsAt <= match.elapsed),
      enabled: !ship.team.areSkillsDisabled(),
    });
    if (result.returnToOwner) returnCompanion(ship, match.elapsed);
    else commitCompanionState(ship, result.state);
    if (result.triggerReliable) {
      for (const receiver of [owner, ship]) {
        receiver.applyResourcePlan(bunnyReliableRecovery(receiver));
        commitReliableEffect(receiver, createBunnyReliableState(ship.id, match.elapsed, match.tick));
      }
    }
    if (ship.bunnyCompanion.convertedUntil) continue;
    ship.followTarget(followPoint(owner, ship.bunnyCompanion.followOffset), owner.throttle);
  }
}

export function serializeBunnyCompanion(ship) {
  if (!ship.bunnyCompanion) return {};
  const state = ship.bunnyCompanion;
  return {
    entityRole: C.companionRole,
    bunnyCompanion: {
      ownerShipId: state.ownerShipId, ownerSeat: state.ownerSeat,
      convertedRemaining: Math.max(0, state.convertedUntil - ship.team.match.elapsed),
      reliableRemaining: Math.max(0, state.reliableUntil - ship.team.match.elapsed),
      nextReliableRemaining: state.nextReliableAt === null ? null : Math.max(0, state.nextReliableAt - ship.team.match.elapsed),
    },
  };
}
