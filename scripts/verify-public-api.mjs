import assert from "node:assert/strict";

const contracts = new Map([
  ["../shared/game-core.js", [
    "AUTO_SCOUT_COOLDOWN_MULTIPLIER", "BotController", "CHARACTER_DEFS", "CHARACTER_ORDER",
    "DEFAULT_AI_LOADOUT", "DEFAULT_MAP_PADDING", "DEFAULT_TEAM_LOADOUT", "DEFAULT_THROTTLE_GEAR",
    "DEFAULT_WORLD_SIZE", "EMERGENCY_BRAKE_COST", "ENERGY_GEAR_PROFILES", "FIRE_ARC_BANDS",
    "MANUAL_SCOUT_COOLDOWN", "MatchSimulation", "SCOUT_LAUNCH_COST", "SNAPSHOT_RATE",
    "THROTTLE_GEAR_VALUES", "TICK_DT", "TICK_RATE", "YUKI_RADAR_ROTATION_SECONDS", "__resetEntityIds",
    "buildZones", "clamp", "cloneLoadout", "distance", "energyProfileForThrottle", "energyRateForThrottle",
    "fireArcDensityMultiplier", "lerp", "normalizeLoadout", "normalizeThrottleToGear", "quadraticPoint",
    "randomAiLoadout", "skillMetaForCharacter", "slotLabel", "throttleForGear", "throttleGearForValue",
  ]],
  ["../src/i18n.js", [
    "SUPPORTED_LOCALES", "applyCoreLocale", "bindLanguageSelector", "characterName", "characterShortName",
    "characterText", "fleetSideLabel", "formatClockTime", "formatSeconds", "getLocale", "getLocaleInfo",
    "initI18n", "languageSelectorHTML", "localizeFloatingText", "seatLabel", "setLocale",
    "shipCharacterName", "shipDisplayName", "skillText", "slotLabel", "splitLabel", "t", "translateServerText",
  ]],
  ["../src/character-select.js", [
    "CHARACTER_THEMES", "TEAM_COLORS", "createCharacterSelect", "drawInGamePortrait",
    "getLoadedPortraitImage", "getPortrait", "invalidatePortrait", "loadPortraitImage",
  ]],
  ["../src/battle/render.js", [
    "ROUTE_HANDLE_RADIUS", "drawBackground", "drawBattleCountdown", "drawBattleWorld", "drawBeam",
    "drawBladeQueenAura", "drawBurst", "drawCurveKnob", "drawFloatingText", "drawMinimap", "drawNoDataHint",
    "drawPauseOverlay", "drawProjectile", "drawRoute", "drawScout", "drawSelectedFireArc",
    "drawSelectedVisionCircle", "drawShip", "drawShipNameLabel", "drawSubSkillAimHint", "drawTargetMarker",
    "drawTeamVisionCircles", "drawWingman", "drawYukiRadar", "drawYukiRadarMinimap", "drawZones",
  ]],
]);

for (const [modulePath, expectedExports] of contracts) {
  const module = await import(modulePath);
  assert.deepEqual(
    Object.keys(module).sort(),
    [...expectedExports].sort(),
    `${modulePath} 的公共导出发生变化；若为有意修改，请同步更新兼容契约`,
  );
}

console.log(`公共 API 校验通过：${contracts.size} 个兼容入口的导出保持稳定。`);
