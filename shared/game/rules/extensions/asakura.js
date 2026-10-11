import { initializeVisionWaves, cancelVisionWaveSkill, updateVisionWaveSkill, serializeVisionWaves } from "../../vision-wave.js";
import { resolveVisionWavePurges } from "../../vision-wave-purge.js";
import { resolveBladeQueenContacts } from "../../character-contacts.js";
export default {
  activeSkills: {
    flagship: (port, meta) => {
      if (!port.spendEnergy(meta.cost || 0)) return false;
      port.activateVisionWave({ duration: meta.duration || 6, interval: meta.pulseInterval || 1 });
      return true;
    },
    sub: (port, meta) => {
      port.activateEffect("bladeQueenUntil", meta.duration || 10);
      port.ensureMinimumSpeed();
      return true;
    },
  },
  queries: {
    barrierRamProfile: [[20, (source) => source.hasEffect?.("bladeQueenUntil") ? { ramKind: "blade_queen", extraRadius: source.radius } : null]],
    hullCollision: [[20, (ship) => !ship.hasEffect("bladeQueenUntil")]],
  },
  id: "asakura",
  createTeam: (team) => ({ hooks: {
    initializeMembers: [[20, () => initializeVisionWaves(team)]],
    clearPositive: [[30, (preserveCurrentTick) => cancelVisionWaveSkill(team, { preserveCurrentTick })]],
    afterMovement: [[30, () => updateVisionWaveSkill(team)]],
  } }),
  createBattle: (match) => ({ operations: {
    bladeContacts: { phases: { afterHull: 10 }, run: () => resolveBladeQueenContacts(match) },
    purges: { phases: { beforeVisibility: 20 }, run: () => resolveVisionWavePurges(match.visionWavePurgePort) },
  } }),
  projectShip: (ship) => ({ bladeQueen: ship.hasEffect("bladeQueenUntil") }),
  projectTeam: (team) => ({ visionWaves: serializeVisionWaves(team) }),
};
