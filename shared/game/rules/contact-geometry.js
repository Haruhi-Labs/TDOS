// 共享的接触几何与外形参数：只读计算，供规则与渲染共同消费。
import { throttleForGear } from "./throttle.js";
const HARUHI_BOW_CONTACT_TOLERANCE = 5;
const HARUHI_BOW_ARC_COS = Math.cos(Math.PI / 4);
const HARUHI_RAM_MINIMUM_GEAR = 2;
const HARUHI_RAM_SPEED_TOLERANCE = 0.5;
export const HARUHI_OTHERWORLDER_AURA_FORWARD_RADIUS_MULTIPLIER = 5;
export const HARUHI_OTHERWORLDER_AURA_REAR_RADIUS_MULTIPLIER = 1.45;
export const HARUHI_OTHERWORLDER_AURA_HALF_WIDTH_RADIUS_MULTIPLIER = 2.25;
const HARUHI_OTHERWORLDER_AURA_MIN_FORWARD_RADIUS_MULTIPLIER = 0.5;

export function haruhiRamApproachEligible(source, targetX, targetY) {
  const minimumRamSpeed = source.effectiveSpeed() * throttleForGear(HARUHI_RAM_MINIMUM_GEAR);
  if (source.speed + HARUHI_RAM_SPEED_TOLERANCE < minimumRamSpeed) {
    return false;
  }
  const forwardX = Math.cos(source.angle);
  const forwardY = Math.sin(source.angle);
  const deltaX = targetX - source.x;
  const deltaY = targetY - source.y;
  const centerDistance = Math.hypot(deltaX, deltaY);
  if (centerDistance < 1e-6) {
    return false;
  }
  const facingDot = (deltaX * forwardX + deltaY * forwardY) / centerDistance;
  return facingDot >= HARUHI_BOW_ARC_COS;
}

export function haruhiOtherworlderAuraForwardReach(source) {
  return Math.max(1, Number(source?.radius) || 0) * HARUHI_OTHERWORLDER_AURA_FORWARD_RADIUS_MULTIPLIER;
}

function haruhiOtherworlderAuraHalfWidth(source, localX) {
  const radius = Math.max(1, Number(source?.radius) || 0);
  const forwardReach = haruhiOtherworlderAuraForwardReach(source);
  const rearReach = radius * HARUHI_OTHERWORLDER_AURA_REAR_RADIUS_MULTIPLIER;
  const progress = Math.max(0, Math.min(1, (localX + rearReach) / (forwardReach + rearReach)));
  const curve = Math.pow(Math.max(0, Math.sin(progress * Math.PI)), 0.72);
  return radius * HARUHI_OTHERWORLDER_AURA_HALF_WIDTH_RADIUS_MULTIPLIER * curve;
}

export function haruhiOtherworlderAuraContact(source, target) {
  if (!haruhiRamApproachEligible(source, target.x, target.y)) {
    return null;
  }
  const forwardX = Math.cos(source.angle);
  const forwardY = Math.sin(source.angle);
  const sideX = -forwardY;
  const sideY = forwardX;
  const deltaX = target.x - source.x;
  const deltaY = target.y - source.y;
  const localX = deltaX * forwardX + deltaY * forwardY;
  const localY = deltaX * sideX + deltaY * sideY;
  const radius = Math.max(1, Number(source.radius) || 0);
  const targetRadius = Math.max(0, Number(target.radius) || 0) + HARUHI_BOW_CONTACT_TOLERANCE;
  const minimumForward = radius * HARUHI_OTHERWORLDER_AURA_MIN_FORWARD_RADIUS_MULTIPLIER;
  const forwardReach = haruhiOtherworlderAuraForwardReach(source);
  if (localX < minimumForward || localX > forwardReach + targetRadius) {
    return null;
  }
  const widthSampleX = Math.min(forwardReach, Math.max(minimumForward, localX));
  if (Math.abs(localY) > haruhiOtherworlderAuraHalfWidth(source, widthSampleX) + targetRadius) {
    return null;
  }
  const contactLength = Math.hypot(deltaX, deltaY);
  const directionX = contactLength > 1e-6 ? deltaX / contactLength : forwardX;
  const directionY = contactLength > 1e-6 ? deltaY / contactLength : forwardY;
  return {
    x: source.x + directionX * Math.max(0, contactLength - targetRadius),
    y: source.y + directionY * Math.max(0, contactLength - targetRadius),
    angle: Math.atan2(directionY, directionX),
    directionX,
    directionY,
    localX,
    localY,
  };
}
