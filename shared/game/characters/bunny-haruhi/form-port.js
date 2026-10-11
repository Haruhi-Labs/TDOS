import { launchHaruhiRandomBeam } from "../interactions/character-launch.js";
import { BunnyFormRuntime } from "./form-runtime.js";
import { CHARACTER_DEFS } from "../catalog.js";
import { BUNNY_HARUHI_CONFIG as C } from "./config.js";
import { nextBunnyForm, isBunnyBroadcasting, resolveBunnyThrottle } from "./rules.js";
import { rngFor } from "../../foundation/rng.js";
import { bunnyHaruhiSupportSource, unlockBunnyHaruhiSupport, updateBunnyHaruhiSupport } from "./support.js";
import { bunnyCompanions, bunnyCompanionOwner, createBunnyCompanion } from "./companion-runtime.js";
import { clearSupportQueue, initializeSupport, replaceSupportState, readSupportState } from "../haruhi/support.js";

export const BUNNY_HARUHI_CHARACTER = CHARACTER_DEFS.bunny_haruhi;

const forms = new WeakMap();

export function spawnBunnyCompanion(owner) {
  const id = forms.get(owner)?.spawnCompanion();
  return id == null ? null : owner.team.extraShips.find((ship) => ship.id === id);
}

// 实体适配只提供本次形态事务所需能力；形态状态机不能取得 Ship、Team 或 Match。
export function initializeBunnyShip(ship, createShip) {
  if (ship.character !== BUNNY_HARUHI_CHARACTER) return;
  const runtime = new BunnyFormRuntime(Object.freeze({
    now: () => ship.team.match.elapsed, tick: () => ship.team.match.tick,
    alive: () => ship.alive, enabled: () => !ship.team.areSkillsDisabled(),
    resources: () => ({ hp: ship.hp, maxHp: ship.maxHp, energy: ship.energy, maxEnergy: ship.maxEnergy }),
    blockReason: () => bunnyTransformBlockReason(ship),
    support: () => readSupportState(ship), replaceSupport: (state) => replaceSupportState(ship, state),
    clearSupport: () => clearSupportQueue(ship),
    grantResources: (effect) => ship.grantResources(effect), drainHull: (amount) => ship.drainHull(amount),
    canSpawn: () => ship.alive && ["sub1", "sub2"].includes(ship.key) && ship.team.ships[ship.key] === ship,
    spawnCompanion() {
      const companion = createBunnyCompanion(ship, createShip);
      ship.team.addAuxiliaryShip(companion);
      return companion.id;
    },
    prepareSupport(state, unlock) {
      const planned = {};
      initializeSupport(planned, state);
      if (unlock) unlockBunnyHaruhiSupport({ ...bunnyHaruhiSupportSource(ship, true), owner: planned }, ship.team.match.elapsed, rngFor(ship.team.match).next);
      return readSupportState(planned);
    },
    captureMotion() {
      const speed = ship.effectiveSpeed(), rate = ship.effectiveFireRate(), throttle = ship.throttle;
      const companions = bunnyCompanions(ship.team.match).filter((candidate) => candidate.alive && bunnyCompanionOwner(candidate) === ship && candidate.team === ship.team)
        .map((candidate) => ({ ship: candidate, speed: candidate.effectiveSpeed(), rate: candidate.effectiveFireRate() }));
      // 捕获对象只留在适配器闭包，不将实体交给形态状态机。
      return Object.freeze({ restore(resolveThrottle) {
        ship.setThrottle(resolveThrottle(throttle));
        ship.rescaleCombatTiming(speed, rate);
        for (const old of companions) old.ship.rescaleCombatTiming(old.speed, old.rate);
      } });
    },
    restoreMotion: (motion, resolveThrottle) => motion.restore(resolveThrottle),
  }));
  forms.set(ship, runtime);
  Object.defineProperty(ship, "bunnyHaruhi", { enumerable: true, get: () => runtime.state });
  ship.configureThrottleConstraint((value) => resolveBunnyThrottle(runtime.state, value, !ship.team.areSkillsDisabled(), ship.team.match.elapsed));
}

export function purgeBunnyShipForm(ship, tick) { return forms.get(ship)?.purge(tick) || false; }

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

export function commitBunnyTransform(ship) { return forms.get(ship)?.transform() || false; }

export function refreshBunnyVisibility(match) {
  match.teamA.computeVisibility(match.teamB);
  match.teamB.computeVisibility(match.teamA);
}

export function advanceBunnyFormResources(ship, from, to) { forms.get(ship)?.sustain(from, to); }
export function cleanupBunnyForm(ship) { forms.get(ship)?.cleanup(); }

export function updateBunnyTeamSupports(team, dt) {
  for (const ship of [team.ships.sub1, team.ships.sub2]) {
    if (!ship.bunnyHaruhi) continue;
    updateBunnyHaruhiSupport(bunnyHaruhiSupportSource(ship, !team.areSkillsDisabled()), team.match.elapsed, dt, {
      launchRandomBeam: (source) => launchHaruhiRandomBeam(team, source),
    });
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
