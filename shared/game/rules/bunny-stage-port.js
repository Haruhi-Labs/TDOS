import { BunnyStageRuntime } from "./bunny-stage-runtime.js";
import { advanceBunnyFormResources, cleanupBunnyForm } from "../bunny-haruhi-runtime.js";

const runtimes = new WeakMap();
const receivers = new WeakMap();

export function initializeBunnyStageReceiver(ship) {
  Object.defineProperty(ship, "bunnyStageExposure", { enumerable: true, get: () => receivers.get(ship)?.exposure(ship.id) });
}
export function cleanseBunnyShipControl(ship) { receivers.get(ship)?.cleanse(ship.id); }
export function bunnyStageEnabled(ship) { return receivers.get(ship)?.enabled(ship.id) || false; }

export function initializeBunnyBattle(match) {
  if (runtimes.has(match)) return true;
  const teams = [match.teamA, match.teamB];
  if (!teams.some((team) => team.getPlayerShips().some((ship) => ship.bunnyHaruhi))) return false;
  const byId = new Map();
  const teamFor = (seat) => teams.find((team) => team.seat === seat);
  const members = (seat) => teamFor(seat).getPlayerShips();
  const active = (team) => Boolean(team.ships.main.bunnyHaruhi && team.ships.main.alive && !team.areSkillsDisabled());
  const runtime = new BunnyStageRuntime(Object.freeze({
    seats: Object.freeze(teams.map((team) => team.seat)), now: () => match.elapsed, tick: () => match.tick,
    sampleStages() {
      const samples = teams.map((team) => {
        const main = team.ships.main;
        return active(team) ? Object.freeze({ sourceShipId: main.id, seat: team.seat, x: main.x, y: main.y, radius: main.effectiveVision() }) : null;
      });
      return teams.map((team, i) => ({ seat: team.seat, own: team.ships.main.bunnyHaruhi ? samples[i] : undefined, enemy: samples[1 - i] }));
    },
    receivers: (seat) => members(seat).map((ship) => {
      byId.set(ship.id, ship);
      receivers.set(ship, runtime);
      return { id: ship.id, alive: ship.alive, x: ship.x, y: ship.y, maxHp: ship.maxHp };
    }),
    sourceValid(sourceId, targetId) {
      const source = byId.get(sourceId), target = byId.get(targetId);
      return Boolean(source && target?.alive && source.alive && source.team !== target.team && !source.team.areSkillsDisabled());
    },
    stageActive: (seat) => active(teamFor(seat)),
    resources: (id) => { const ship = byId.get(id); return { hp: ship.hp, maxHp: ship.maxHp }; },
    heal: (id, amount) => byId.get(id).restoreHull(amount),
    stopIfVulnerable: (id) => { const ship = byId.get(id); if (!ship.isControlImmune()) ship.setFlightSpeed(0); },
    sustainForm: (id, from, to) => advanceBunnyFormResources(byId.get(id), from, to),
    cleanupForm: (id) => cleanupBunnyForm(byId.get(id)),
  }));
  runtimes.set(match, runtime);
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
