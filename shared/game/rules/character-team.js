import { createTeamHaruhiFlagship } from "./haruhi-flagship-port.js";
import { createTeamSponsor } from "./sponsor-port.js";
import { createTeamFutureForm } from "./future-form-port.js";
import { futureFormDefinition } from "../future-flagship-form.js";
import { initializeSupport, readSupportState } from "../haruhi-support.js";
import { createHaruhiFlagshipState, updateHaruhiFlagship } from "../haruhi-flagship.js";
import { initializeKoizumiBarrier } from "../koizumi-barrier.js";
import { initializeKoizumiImpactWaves } from "../koizumi-orb.js";
import { initializeShamisenHunt } from "../shamisen-hunt.js";
import { initializeRadar } from "../visibility-radar.js";
import { initializeVisionWaves, cancelVisionWaveSkill, updateVisionWaveSkill } from "../vision-wave.js";
import { updateBunnyTeamSupports } from "../bunny-haruhi-runtime.js";

// 队级角色装配独占角色组件；Team 只保留通用成员、编队、资源和推进职责。
export function createTeamCharacters(team, facing) {
  const sponsor = createTeamSponsor(team);
  const haruhi = createTeamHaruhiFlagship(team);
  const future = createTeamFutureForm(team);
  let effectView;
  initializeSupport(team, createHaruhiFlagshipState(facing));
  Object.defineProperty(team, "haruhiFlagship", { enumerable: true, get: () => readSupportState(team) });
  initializeKoizumiBarrier(team);
  initializeShamisenHunt(team);
  return Object.freeze({
    get effects() {
      const haruhiBoostUntil = haruhi.expiresAt;
      const sponsorUntil = sponsor.expiresAt;
      if (!effectView || effectView.haruhiBoostUntil !== haruhiBoostUntil || effectView.sponsorUntil !== sponsorUntil)
        effectView = Object.freeze({ haruhiBoostUntil, sponsorUntil });
      return effectView;
    },
    initializeMembers() {
      initializeRadar(team, facing);
      initializeVisionWaves(team);
      initializeKoizumiImpactWaves(team);
    },
    get form() { return future.current; },
    formDefinition: (form = future.current) => futureFormDefinition(form),
    statMultiplier: (key) => future.statMultiplier(key),
    damageMultiplier: () => future.damageTakenMultiplier(),
    switchForm: () => future.switch(),
    sponsorActive: () => sponsor.active(),
    activateSupport: (duration, random) => haruhi.activate(duration, random),
    castSupport: (duration) => haruhi.cast(duration),
    activateSponsor: (duration) => sponsor.activate(duration),
    cooldownStep: (dt) => sponsor.cooldownStep(dt),
    regenerate: (dt) => sponsor.regenerate(dt),
    clearPositive(preserveCurrentTick) {
      let cleared = sponsor.clear({ preserveCurrentTick });
      if (haruhi.clear({ preserveCurrentTick })) cleared = true;
      if (cancelVisionWaveSkill(team, { preserveCurrentTick })) cleared = true;
      return cleared;
    },
    afterMovement(dt) {
      updateHaruhiFlagship(team, {
        dt, launchAlienWingmen: (ship) => team.launchHaruhiAlienWingmen(ship),
        launchRandomBeam: (ship) => team.launchHaruhiRandomBeam(ship),
      });
      if (team.match.bunnyHaruhiActive) updateBunnyTeamSupports(team, dt);
      updateVisionWaveSkill(team);
    },
  });
}
