// 保留既有 JSON 字段顺序，避免纯装配调整改变快照字节与回放摘要；新字段自动追加。
export function orderedProjection(fields, order) {
  const result = {};
  for (const key of order) if (Object.hasOwn(fields, key)) result[key] = fields[key];
  for (const key of Object.keys(fields)) if (!Object.hasOwn(result, key)) result[key] = fields[key];
  return result;
}
export const SHIP_WIRE_FIELDS = Object.freeze("id key slotKey characterId characterName name x y angle speed cooldown hp maxHp energy maxEnergy fleetEnergy fleetMaxEnergy alive radius throttle vision range attached canControl bladeQueen catPawVolley silenced stunRemaining silenceRemaining heroPowerShock koizumiOrb knockedBack haruhiImpactReady clawMarks nameRevealed buffs statusEffects bunnyHaruhi bunnyStageExposure entityRole bunnyCompanion bunnyReliable route".split(" "));
export const TEAM_WIRE_FIELDS = Object.freeze("seat name color splitLevel loadout bunnyStage energy maxEnergy hullRatio future1096Form haruhiFlagship koizumiBarrier shamisenHunt skillsDisabled autoScout cooldowns visibleEnemyIds radarSweep visionWaves koizumiImpactWaves ships extraShips scouts wingmen beams".split(" "));
