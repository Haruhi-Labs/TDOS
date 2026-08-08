const DEG_TO_RAD = Math.PI / 180;

export const YUKI_RADAR_ROTATION_SECONDS = 2.2;
export const SCOUT_LAUNCH_COST = 28;
export const MANUAL_SCOUT_COOLDOWN = 2.6;
export const AUTO_SCOUT_COOLDOWN_MULTIPLIER = 2;
export const EMERGENCY_BRAKE_COST = 18;
export const EMERGENCY_BRAKE_COOLDOWN = 1.25;

export const FIRE_ARC_BANDS = Object.freeze([
  { startDeg: -60, endDeg: 60, multiplier: 1 },
  { startDeg: 60, endDeg: 120, multiplier: 1.5 },
  { startDeg: -120, endDeg: -60, multiplier: 1.5 },
  { startDeg: 120, endDeg: 150, multiplier: 1 },
  { startDeg: -150, endDeg: -120, multiplier: 1 },
  { startDeg: 150, endDeg: 180, multiplier: 0 },
  { startDeg: -180, endDeg: -150, multiplier: 0 },
]);

export function fireArcDensityMultiplier(relativeAngle, uniformOutput = false) {
  if (uniformOutput) {
    return 1.5;
  }
  const absAngle = Math.abs(relativeAngle);
  if (absAngle <= 60 * DEG_TO_RAD) {
    return 1;
  }
  if (absAngle <= 120 * DEG_TO_RAD) {
    return 1.5;
  }
  if (absAngle <= 150 * DEG_TO_RAD) {
    return 1;
  }
  return 0;
}
