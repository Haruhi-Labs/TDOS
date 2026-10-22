import { CHARACTER_DEFS } from "../catalog.js";
import { initializeVisionWaves, cancelVisionWaveSkill, updateVisionWaveSkill, serializeVisionWaves } from "./vision-wave.js";
import { resolveVisionWavePurges } from "../../systems/vision-wave-purge.js";
import { resolveBladeQueenContacts } from "../interactions/character-contacts.js";
export default {
  positiveTimedEffects: ["bladeQueenUntil"],
  timedAttributes: [[20, { until: "bladeQueenUntil", multipliers: {
    speed: CHARACTER_DEFS.asakura.subSkill.speedMultiplier,
    accel: CHARACTER_DEFS.asakura.subSkill.accelerationMultiplier,
    turnRate: CHARACTER_DEFS.asakura.subSkill.turnMultiplier,
  } }]],
  statusEffects: [
    [20, (ship, { timed }) => {
      timed("blade_queen", ship.effects.bladeQueenUntil, CHARACTER_DEFS.asakura.subSkill.duration);
    }],
    [110, (ship, { timed }) => {
      const team = ship.team;
      timed("vision_wave", team.visionWaveSkill.activeUntil, CHARACTER_DEFS.asakura.flagshipSkill.duration);
    }]
  ],
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
