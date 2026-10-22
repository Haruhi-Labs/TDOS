import { HARUHI_SUPPORT_LABELS } from "./flagship.js";
import { CHARACTER_DEFS } from "../catalog.js";
import { haruhiBoostActive } from "./flagship.js";
import { supportOtherworlderReady } from "./support.js";
import { haruhiOtherworlderAuraForwardReach, haruhiRamApproachEligible } from "../../rules/contact-geometry.js";
import { createTeamHaruhiFlagship } from "./flagship-port.js";
import { createHaruhiFlagshipState, updateHaruhiFlagship, triggerHaruhiOtherworlder, serializeHaruhiFlagship, haruhiOtherworlderReady } from "./flagship.js";
import { initializeSupport, readSupportState, triggerSupportOtherworlder } from "./support.js";
import { bunnyHaruhiSupportSource } from "../bunny-haruhi/support.js";
import { resetHaruhiHeroPowerShock, serializeHaruhiHeroPowerShock } from "./hero-power.js";
import { createHeroPowerRuntime } from "./hero-power-runtime.js";
import { resolveHaruhiOtherworlderContacts } from "../interactions/character-contacts.js";
import { launchHaruhiAlienWingmen, launchHaruhiRandomBeam } from "../interactions/character-launch.js";

export default {
  statusEffects: [
    [70, (ship, { timed }) => {
    const shock = ship.heroPowerShock;
    timed("hero_lock", shock.lockUntil, Math.max(0, shock.lockUntil - shock.hitAt));
    timed("hero_shock", shock.recoveryUntil, Math.max(0, shock.recoveryUntil - shock.hitAt));
    }],
    [130, (ship, { timed, add }) => {
    const team = ship.team;
    if (team.mainCharacterId() === "haruhi") {
      timed("haruhi_boost", team.effects.haruhiBoostUntil, CHARACTER_DEFS.haruhi.flagshipSkill.duration);
      timed("broadcast", team.effects.haruhiBoostUntil, CHARACTER_DEFS.haruhi.flagshipSkill.duration);
      if (ship.key === "main") {
        for (const support of Object.keys(HARUHI_SUPPORT_LABELS)) {
          if (team.haruhiFlagship.supporters.has(support)) add(`support_${support}`);
        }
      }
    }
    }]
  ],
  activeSkills: {
    flagship: (port, meta) => {
      if (!port.spendEnergy(meta.cost || 0)) return false;
      port.activateSupport(meta.duration || 16);
      return true;
    },
    sub: (port, meta) => { port.emitHeroPower(meta); return true; },
  },
  queries: {
    barrierRamProfile: [[30, (source, attackerTeam, defendingMain) => {
      const bunny = source.bunnyHaruhi ? bunnyHaruhiSupportSource(source, !attackerTeam.areSkillsDisabled()) : null;
      const ready = bunny ? supportOtherworlderReady(bunny, attackerTeam.match.elapsed) : source === attackerTeam.ships.main && haruhiOtherworlderReady(attackerTeam);
      if (!ready || !haruhiRamApproachEligible(source, defendingMain.x, defendingMain.y)) return null;
      return { ramKind: "haruhi_otherworlder", bow: true, bowOffset: haruhiOtherworlderAuraForwardReach(source), extraRadius: 5 };
    }]],
    broadcast: [[10, (team) => haruhiBoostActive(team) ? team.getAllShips().filter((ship) => ship.alive) : []]],
  },
  id: "haruhi",
  ship: { hooks: {
    initialize: [[20, resetHaruhiHeroPowerShock]], clearControl: [[10, resetHaruhiHeroPowerShock]],
    hasNegative: [[10, (ship) => ship.heroPowerShock.recoveryUntil > ship.team.match.elapsed]],
    consumeBarrierRam: [[10, (source, team, kind) => kind !== "haruhi_otherworlder" ? true : source.bunnyHaruhi
      ? triggerSupportOtherworlder(bunnyHaruhiSupportSource(source, !team.areSkillsDisabled()), team.match.elapsed) : triggerHaruhiOtherworlder(team)]],
  } },
  createTeam(team, facing) {
    const haruhi = createTeamHaruhiFlagship(team);
    initializeSupport(team, createHaruhiFlagshipState(facing));
    Object.defineProperty(team, "haruhiFlagship", { enumerable: true, get: () => readSupportState(team) });
    return {
      capabilities: { activateSupport: (duration, random) => haruhi.activate(duration, random), castSupport: (duration) => haruhi.cast(duration) },
      effects: () => ({ haruhiBoostUntil: haruhi.expiresAt }),
      hooks: {
        clearPositive: [[20, (preserveCurrentTick) => haruhi.clear({ preserveCurrentTick })]],
        afterMovement: [[10, (dt) => updateHaruhiFlagship(team, { dt, launchAlienWingmen: (ship) => launchHaruhiAlienWingmen(team, ship), launchRandomBeam: (ship) => launchHaruhiRandomBeam(team, ship) })]],
      },
    };
  },
  createBattle(match) {
    const hero = createHeroPowerRuntime(match);
    return {
      capabilities: { enqueueHeroPower: (ship, meta) => hero.enqueue(ship, meta), inspectHeroPowers: () => hero.inspect(), projectHeroPowers: () => hero.serialize() },
      operations: {
        heroPower: { phases: { afterTeams: 10 }, run: () => hero.advance() },
        haruhiRam: { phases: { afterTeams: 50 }, run: () => resolveHaruhiOtherworlderContacts(match) },
      },
    };
  },
  projectShip: (ship) => ({ heroPowerShock: serializeHaruhiHeroPowerShock(ship), haruhiImpactReady: ship.key === "main" && haruhiOtherworlderReady(ship.team) }),
  projectTeam: (team) => ({ haruhiFlagship: serializeHaruhiFlagship(team) }),
};
