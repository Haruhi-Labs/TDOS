import {
  isBunnyCompanion, deriveBunnyCompanionBase, createBunnyCompanionState,
  advanceBunnyCompanion, createBunnyReliableState, expireBunnyReliable, bunnyReliableRecovery,
  planBunnyCompanionConversion,
} from "./bunny-haruhi-companion.js";
import { BUNNY_HARUHI_CONFIG as C } from "./bunny-haruhi-config.js";

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

/** Ship工厂由兼容入口注入，叶模块不反向导入game-core。 */
export function spawnBunnyCompanion(owner, createShip) {
  if (!owner.alive || owner.bunnyHaruhi?.form !== "encore" || owner.bunnyHaruhi.companionId !== null
    || !["sub1", "sub2"].includes(owner.key) || owner.team.ships[owner.key] !== owner) return null;
  const { team } = owner;
  const point = followPoint(owner, C.companion.followOffset);
  const key = `bunny_kyon_${owner.id}`;
  const ship = createShip(team, key, point.x, point.y, owner.angle, {
    characterId: "kyon", slotKey: key, isAuxiliary: true, attachToMain: false,
    entityRole: C.companionRole, baseStats: deriveBunnyCompanionBase(owner.base), roleLabel: "伴随舰",
  });
  ship.bunnyCompanion = createBunnyCompanionState(owner.id, team.seat, team.match.elapsed);
  ship.maxHp = Math.max(1, Math.round(ship.base.hp * (team.statMult || 1)));
  ship.hp = ship.maxHp;
  ship.throttle = owner.throttle;
  team.extraShips.push(ship);
  owner.bunnyHaruhi.companionId = ship.id;
  owner.bunnyHaruhi.companionSpawned = true;
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
      if (receiver.bunnyReliable?.sourceCompanionId === ship.id) delete receiver.bunnyReliable;
    }
  }
  ship.bunnyCompanion.reliableUntil = 0;
  ship.bunnyCompanion.reliableStartedTick = -1;
}

function clearCompanionProjectiles(ship) {
  const { match } = ship.team;
  for (const projectile of match.projectiles) {
    if (projectile.sourceId === ship.id) projectile.alive = false;
  }
  match.projectiles = match.projectiles.filter((projectile) => projectile.alive);
}

function transferCompanion(ship, destination, nextState) {
  const oldSpeed = ship.effectiveSpeed();
  const oldRate = ship.effectiveFireRate();
  clearCompanionReliable(ship);
  clearCompanionProjectiles(ship);
  ship.team.extraShips = ship.team.extraShips.filter((candidate) => candidate !== ship);
  ship.team = destination;
  ship.bunnyCompanion = nextState;
  destination.extraShips.push(ship);
  // 位置与生命不因换阵营重算；伤害等查询读取当前阵营，禁止重复难度缩放。
  ship.route = null;
  if (oldSpeed > 0) ship.speed *= ship.effectiveSpeed() / oldSpeed;
  ship.cooldown *= oldRate / ship.effectiveFireRate();
}

function returnCompanion(ship, now) {
  const owner = bunnyCompanionOwner(ship);
  transferCompanion(ship, owner.team, {
    ...ship.bunnyCompanion, convertedUntil: 0, nextReliableAt: now + C.companion.intervalSeconds,
    reliableUntil: 0, reliableStartedTick: -1,
  });
  ship.command = followPoint(owner, ship.bunnyCompanion.followOffset);
  ship.throttle = owner.throttle;
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
    ship.command = { x: zone.x + zone.width * 0.5, y: zone.y + zone.height * 0.5 };
  }
  return true;
}

/** 退场不走伤害/舰损回调，不产生第二次击杀；死亡实体保留稳定ID摘要。 */
export function cleanupBunnyCompanions(match) {
  for (const ship of bunnyCompanions(match)) {
    const owner = bunnyCompanionOwner(ship);
    if (ship.alive && owner?.alive) continue;
    ship.alive = false;
    ship.hp = 0;
    ship.speed = 0;
    ship.route = null;
    ship.bunnyCompanion.nextReliableAt = null;
    ship.bunnyCompanion.convertedUntil = 0;
    clearCompanionReliable(ship);
    clearCompanionProjectiles(ship);
  }
  for (const team of [match.teamA, match.teamB]) {
    for (const receiver of team.getAllShips()) {
      if (receiver.bunnyReliable && !bunnyReliableState(receiver)) delete receiver.bunnyReliable;
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
    else ship.bunnyCompanion = result.state;
    if (result.triggerReliable) {
      for (const receiver of [owner, ship]) {
        Object.assign(receiver, bunnyReliableRecovery(receiver));
        receiver.bunnyReliable = createBunnyReliableState(ship.id, match.elapsed, match.tick);
      }
    }
    if (ship.bunnyCompanion.convertedUntil) continue;
    ship.command = followPoint(owner, ship.bunnyCompanion.followOffset);
    ship.throttle = owner.throttle;
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
