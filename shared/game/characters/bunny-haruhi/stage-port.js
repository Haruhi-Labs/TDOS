import { BunnyStageRuntime } from "./stage-runtime.js";
import { advanceBunnyFormResources, cleanupBunnyForm } from "./form-port.js";

const runtimes = new WeakMap();
const receivers = new WeakMap();
const sourceIndexes = new WeakMap();

function isStageSourceActive(team) {
  return Boolean(team?.ships?.main?.bunnyHaruhi && team.ships.main.alive && !team.areSkillsDisabled());
}

/** 采样全部已注册舰队的当前舞台，返回只读冻结的 { receiverSeat, ownStage, hostileStages } 列表，不推进模拟。 */
export function sampleBunnyStages(match) {
  const teams = match.allTeams();
  const sampleBySeat = new Map();
  for (const team of teams) {
    const main = team.ships.main;
    sampleBySeat.set(
      team.seat,
      isStageSourceActive(team)
        ? Object.freeze({ sourceShipId: main.id, seat: team.seat, x: main.x, y: main.y, radius: main.effectiveVision() })
        : null,
    );
  }
  return Object.freeze(teams.map((team) => {
    const hostileStages = [];
    for (const enemy of match.enemyTeamsOf(team.seat)) {
      const sample = sampleBySeat.get(enemy.seat);
      if (sample) hostileStages.push(sample);
    }
    return Object.freeze({
      receiverSeat: team.seat,
      ownStage: team.ships.main.bunnyHaruhi ? sampleBySeat.get(team.seat) : undefined,
      hostileStages: Object.freeze(hostileStages),
    });
  }));
}

export function initializeBunnyStageReceiver(ship) {
  Object.defineProperty(ship, "bunnyStageExposure", { enumerable: true, get: () => receivers.get(ship)?.exposure(ship.id) });
}
export function cleanseBunnyShipControl(ship) { receivers.get(ship)?.cleanse(ship.id); }
export function bunnyStageEnabled(ship) { return receivers.get(ship)?.enabled(ship.id) || false; }

/** 只读查询当前曝光来源的席位与阵营信息，不推进治疗、禁控或来源清理，也不暴露实体引用。 */
export function bunnyStageSourceInfo(ship) {
  const exposure = ship?.bunnyStageExposure;
  if (!exposure || !exposure.inside || !Number.isSafeInteger(exposure.sourceShipId)) return null;
  const index = sourceIndexes.get(ship.team?.match);
  const source = index?.get(exposure.sourceShipId);
  if (!source) return null;
  return Object.freeze({
    sourceShipId: source.id,
    seat: source.team.seat,
    sideId: source.team.sideId,
  });
}

export function initializeBunnyBattle(match) {
  if (runtimes.has(match)) return true;
  const teams = match.allTeams();
  if (!teams.some((team) => team.getPlayerShips().some((ship) => ship.bunnyHaruhi))) return false;
  const byId = new Map();
  for (const team of teams) {
    for (const ship of team.getPlayerShips()) byId.set(ship.id, ship);
  }
  const teamFor = (seat) => match.teamBySeat(seat);
  const members = (seat) => teamFor(seat)?.getPlayerShips() || [];
  const runtime = new BunnyStageRuntime(Object.freeze({
    seats: Object.freeze(teams.map((team) => team.seat)), now: () => match.elapsed, tick: () => match.tick,
    sampleStages: () => sampleBunnyStages(match),
    receivers: (seat) => members(seat).map((ship) => {
      byId.set(ship.id, ship);
      receivers.set(ship, runtime);
      return Object.freeze({ id: ship.id, alive: ship.alive, x: ship.x, y: ship.y, maxHp: ship.maxHp });
    }),
    sourceValid(sourceId, targetId) {
      const source = byId.get(sourceId), target = byId.get(targetId);
      return Boolean(
        source && target?.alive && source.alive
        && source.bunnyHaruhi && source.team.ships.main === source
        && match.relations.areEnemies(source.team.seat, target.team.seat)
        && !source.team.areSkillsDisabled(),
      );
    },
    stageActive: (seat) => isStageSourceActive(teamFor(seat)),
    resources: (id) => { const ship = byId.get(id); return { hp: ship.hp, maxHp: ship.maxHp }; },
    heal: (id, amount) => byId.get(id).restoreHull(amount),
    stopIfVulnerable: (id) => { const ship = byId.get(id); if (!ship.isControlImmune()) ship.setFlightSpeed(0); },
    sustainForm: (id, from, to) => advanceBunnyFormResources(byId.get(id), from, to),
    cleanupForm: (id) => cleanupBunnyForm(byId.get(id)),
  }));
  runtimes.set(match, runtime);
  sourceIndexes.set(match, byId);
  Object.defineProperty(match, "bunnyHaruhiActive", { enumerable: true, value: true });
  for (const team of teams) {
    for (const ship of team.getPlayerShips()) { byId.set(ship.id, ship); receivers.set(ship, runtime); }
    if (team.ships.main.bunnyHaruhi) Object.defineProperty(team, "bunnyStage", { enumerable: true, get: () => runtime.stage(team.seat) });
  }
  return true;
}
export function resolveBunnyStages(match) { runtimes.get(match)?.resolve(); }
export function advanceBunnyRules(match) { runtimes.get(match)?.advance(); }
export function cleanupBunnySources(match) { runtimes.get(match)?.cleanup(); }
