import { haruhiBoostActive } from "../../haruhi-flagship.js";
import { supportOtherworlderReady } from "../../haruhi-support.js";
import { haruhiOtherworlderAuraForwardReach, haruhiRamApproachEligible } from "../../contact-geometry.js";
import { createTeamHaruhiFlagship } from "../haruhi-flagship-port.js";
import { createHaruhiFlagshipState, updateHaruhiFlagship, triggerHaruhiOtherworlder, serializeHaruhiFlagship, haruhiOtherworlderReady } from "../../haruhi-flagship.js";
import { initializeSupport, readSupportState, triggerSupportOtherworlder } from "../../haruhi-support.js";
import { bunnyHaruhiSupportSource } from "../../bunny-haruhi-support.js";
import { resetHaruhiHeroPowerShock, serializeHaruhiHeroPowerShock } from "../../haruhi-hero-power.js";
import { createHeroPowerRuntime } from "../hero-power-runtime.js";
import { resolveHaruhiOtherworlderContacts } from "../../character-contacts.js";
import { launchHaruhiAlienWingmen, launchHaruhiRandomBeam } from "../character-launch.js";

export default {
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
