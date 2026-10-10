// 公共兼容入口：只导出稳定 API，不持有或推进战斗状态。
import { DEFAULT_MAP_PADDING, DEFAULT_WORLD_SIZE, SNAPSHOT_RATE, TICK_DT, TICK_RATE } from "./game/constants.js";
import { DEFAULT_THROTTLE_GEAR, ENERGY_GEAR_PROFILES, THROTTLE_GEAR_VALUES, energyProfileForThrottle, energyRateForThrottle, normalizeThrottleToGear, throttleForGear, throttleGearForValue } from "./game/throttle.js";
import { AUTO_SCOUT_COOLDOWN_MULTIPLIER, FIRE_ARC_BANDS, MANUAL_SCOUT_COOLDOWN, SCOUT_LAUNCH_COST, YUKI_RADAR_ROTATION_SECONDS, fireArcDensityMultiplier } from "./game/combat-rules.js";
import { CHARACTER_DEFS, CHARACTER_ORDER, DEFAULT_AI_LOADOUT, DEFAULT_TEAM_LOADOUT, cloneLoadout, normalizeLoadout, randomAiLoadout, skillMetaForCharacter, slotLabel } from "./game/characters.js";
import { buildZones, clamp, distance, lerp, quadraticPoint } from "./game/math.js";
import { BotController } from "./game/bot-controller.js";
export { MatchSimulation } from "./game/runtime/match-simulation.js";
export { __resetEntityIds } from "./game/model/model-support.js";

export {
  DEFAULT_MAP_PADDING,
  DEFAULT_WORLD_SIZE,
  SNAPSHOT_RATE,
  TICK_DT,
  TICK_RATE,
  DEFAULT_THROTTLE_GEAR,
  ENERGY_GEAR_PROFILES,
  THROTTLE_GEAR_VALUES,
  energyProfileForThrottle,
  energyRateForThrottle,
  normalizeThrottleToGear,
  throttleForGear,
  throttleGearForValue,
  AUTO_SCOUT_COOLDOWN_MULTIPLIER,
  FIRE_ARC_BANDS,
  MANUAL_SCOUT_COOLDOWN,
  SCOUT_LAUNCH_COST,
  YUKI_RADAR_ROTATION_SECONDS,
  fireArcDensityMultiplier,
  CHARACTER_DEFS,
  CHARACTER_ORDER,
  DEFAULT_AI_LOADOUT,
  DEFAULT_TEAM_LOADOUT,
  cloneLoadout,
  normalizeLoadout,
  randomAiLoadout,
  skillMetaForCharacter,
  slotLabel,
  buildZones,
  clamp,
  distance,
  lerp,
  quadraticPoint,
  BotController,
};
