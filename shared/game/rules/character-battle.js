import { ensureShamisenHuntTarget } from "../shamisen-hunt.js";
import { updateRadarPassive } from "../visibility-radar.js";
import { rngFor } from "../rng.js";
import { createHeroPowerRuntime } from "./hero-power-runtime.js";
import { resolveHaruhiOtherworlderContacts, resolveBunnyOtherworlderContacts, resolveBladeQueenContacts } from "../character-contacts.js";
import { resolveKoizumiOrbContacts, updateKoizumiImpactWaves } from "../koizumi-orb.js";
import { resolveKoizumiBarrierRamContacts } from "../koizumi-barrier.js";
import { prepareBunnyCompanions, cleanupBunnyCompanions } from "../bunny-companion-runtime.js";
import { refreshBunnyVisibility } from "../bunny-haruhi-runtime.js";
import { initializeBunnyBattle, resolveBunnyStages, advanceBunnyRules, cleanupBunnySources } from "../rules/bunny-stage-port.js";
import { resolveVisionWavePurges } from "../vision-wave-purge.js";

// 阶段名与顺序是规则契约。角色只能接入已声明阶段，不能任意广播事件改变消费顺序。
export const CHARACTER_PHASES = Object.freeze({
  beforeAi: Object.freeze(["sustain", "companions", "hunts"]),
  afterTeams: Object.freeze(["heroPower", "barrierRam", "orbContacts", "impactWaves", "haruhiRam", "bunnyRam"]),
  afterHull: Object.freeze(["bladeContacts"]),
  beforeVisibility: Object.freeze(["stages", "purges", "sourceCleanup"]),
  beforeBeams: Object.freeze(["radar"]),
  afterVisuals: Object.freeze(["companionCleanup", "sourceCleanup", "stageVisibility"]),
});

export function createBattleCharacters(match) {
  const heroPowers = createHeroPowerRuntime(match);
  const bunny = (operation) => () => { if (match.bunnyHaruhiActive) operation(match); };
  const operations = Object.freeze({
    sustain: bunny(advanceBunnyRules), companions: bunny(prepareBunnyCompanions),
    hunts: () => {
      ensureShamisenHuntTarget(match.teamA, match.teamB, rngFor(match).next);
      ensureShamisenHuntTarget(match.teamB, match.teamA, rngFor(match).next);
    },
    heroPower: () => heroPowers.advance(),
    barrierRam: () => resolveKoizumiBarrierRamContacts(match),
    orbContacts: () => resolveKoizumiOrbContacts(match),
    impactWaves: () => updateKoizumiImpactWaves(match),
    haruhiRam: () => resolveHaruhiOtherworlderContacts(match),
    bunnyRam: bunny(resolveBunnyOtherworlderContacts),
    bladeContacts: () => resolveBladeQueenContacts(match),
    stages: bunny(resolveBunnyStages),
    purges: () => resolveVisionWavePurges(match.visionWavePurgePort),
    sourceCleanup: bunny(cleanupBunnySources),
    radar: (dt) => {
      updateRadarPassive(match.teamA, match.teamB, dt);
      updateRadarPassive(match.teamB, match.teamA, dt);
    },
    companionCleanup: bunny(cleanupBunnyCompanions),
    stageVisibility: bunny(refreshBunnyVisibility),
  });
  if (initializeBunnyBattle(match)) {
    operations.stages();
    operations.stageVisibility();
  }
  operations.hunts();
  return Object.freeze({
    advance(phase, dt) {
      if (!Object.hasOwn(CHARACTER_PHASES, phase)) throw new Error(`未声明的角色阶段：${phase}`);
      for (const name of CHARACTER_PHASES[phase]) operations[name](dt);
    },
    run(name) {
      if (!Object.hasOwn(operations, name)) throw new Error(`未声明的角色操作：${name}`);
      operations[name]();
    },
    enqueueHeroPower: (ship, meta) => heroPowers.enqueue(ship, meta),
    inspectHeroPowers: () => heroPowers.inspect(),
    projectHeroPowers: () => heroPowers.serialize(),
  });
}
