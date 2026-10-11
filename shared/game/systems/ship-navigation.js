import { clamp, distance, dot, lerp, quadraticLengthApprox, quadraticPoint, quadraticStartCurvature, rotateOffset, shortestAngleDelta } from "../math.js";
import { normalizeThrottleToGear } from "../throttle.js";
import { copyPlainData, freezePlainData } from "../../data/plain-data.js";

// 导航独占航线、目标点与击退过程。端口只提供船体运动能力，不携带舰队或对局。
export class ShipNavigation {
  #port;
  #route = null;
  #routeView;
  #commandView;
  #command;
  #forcedKnockback = null;
  constructor(port, point) { this.#port = port; this.#command = { x: point.x, y: point.y }; }
  get route() { return this.#routeView ??= freezePlainData(copyPlainData(this.#route)); }
  get command() {
    if (!this.#commandView || this.#commandView.x !== this.#command.x || this.#commandView.y !== this.#command.y)
      this.#commandView = Object.freeze({ ...this.#command });
    return this.#commandView;
  }
  get forcedKnockback() { return this.#forcedKnockback; }
  replaceRoute(route) {
    this.#routeView = undefined;
    this.#route = copyPlainData(route);
  }
  target(point) { this.#command = { x: point.x, y: point.y }; }
  knockback(motion) { this.#forcedKnockback = motion && Object.freeze({ ...motion }); }
  advanceSpecialRoute(traveledDistance, minimumLength, captureRadius) {
    this.#routeView = undefined;
    if (!this.#route) return;
    this.#route.t = clamp((Number(this.#route.t) || 0) + traveledDistance / Math.max(minimumLength, Number(this.#route.length) || 1), 0, 1);
    if (this.#route.t >= 1 && Math.hypot(this.#route.p2.x - this.#port.x, this.#route.p2.y - this.#port.y) <= captureRadius) this.#route = null;
    else this.enforceRouteFeasibility(this.#route.p1, false);
  }
  routeAnchorShip() {
    if (this.#route && this.#route.anchorToMain) {
      const main = this.#port.leader();
      if (main && main.alive) {
        return main;
      }
    }
    return this.#port.anchor();
  }

  routeConstraintProfile() {
    const anchor = this.routeAnchorShip();
    const throttleFactor = 0.2 + clamp(this.#port.throttle, 0.25, 1.4) * 0.38;
    const turnRate = Math.max(0.05, anchor.turnRate * throttleFactor);
    const speedRef = Math.max(anchor.speed, anchor.flightSpeed * Math.max(0.32, this.#port.throttle), 8);
    let minTurnRadius = clamp((speedRef / turnRate) * 1.05, 30, 560);
    // 起点切线锁定朝向:把控制点的横向偏角收得很小(~8-12°,航速越快越直),使「画出来的曲线
    // 离开舰船的方向」≈「舰船实际航向」,曲线与航迹在近场一致(实测切线偏移由峰值~77°降到~10°)。
    // 代价:不再能拖出大幅S形/强凹凸弯(单条二次贝塞尔无法既起点对齐朝向又侧弯)。
    // 反向掉头另由下方 dynamicDeviation 放宽(掉头必须侧弓一点,否则二次曲线会退化成尖点)。
    let maxStartDeviation = (Math.PI / 180) * clamp(14 - speedRef * 0.03, 8, 12);
    minTurnRadius *= this.#port.routeTurnRadiusMultiplier();
    maxStartDeviation *= this.#port.routeDeviationMultiplier();
    const minForward = clamp(minTurnRadius * 0.34, 16, 200);
    const heading = anchor.angle;
    const forward = { x: Math.cos(heading), y: Math.sin(heading) };
    const left = { x: -forward.y, y: forward.x };
    return {
      anchor,
      minTurnRadius,
      maxStartDeviation,
      minForward,
      forward,
      left,
    };
  }

  suggestControlForCurrentEndpoint() {
    if (!this.#route) {
      return { x: this.#port.x, y: this.#port.y };
    }
    const profile = this.routeConstraintProfile();
    const p0 = { x: profile.anchor.x, y: profile.anchor.y };
    const relX = this.#route.p2.x - p0.x;
    const relY = this.#route.p2.y - p0.y;
    const ex = dot(relX, relY, profile.forward.x, profile.forward.y);
    const ey = dot(relX, relY, profile.left.x, profile.left.y);

    const bearingToEnd = Math.atan2(relY, relX);
    const deltaToEnd = shortestAngleDelta(profile.anchor.angle, bearingToEnd);
    const sideSign = deltaToEnd >= 0 ? 1 : -1;
    let sideEy = ey;
    if (ex < 0 && Math.abs(sideEy) < profile.minTurnRadius * 0.08) {
      sideEy = sideSign * profile.minTurnRadius * 0.34;
    }

    let u = Math.max(profile.minForward, Math.sqrt(Math.max(0, Math.abs(sideEy) * profile.minTurnRadius * 0.5)));
    if (ex < 0) {
      u = Math.max(u, profile.minForward + Math.abs(ex) * 0.24);
    } else {
      u = Math.max(u, ex * 0.24);
    }
    const maxLat = Math.max(8, u * Math.tan(profile.maxStartDeviation));
    const v = clamp(sideEy * 0.34, -maxLat, maxLat);
    return {
      x: p0.x + profile.forward.x * u + profile.left.x * v,
      y: p0.y + profile.forward.y * u + profile.left.y * v,
    };
  }

  enforceRouteFeasibility(desiredControlPoint = null, resetProgress = true) {
    this.#routeView = undefined;
    if (!this.#route) {
      return;
    }
    const profile = this.routeConstraintProfile();
    const p0 = { x: profile.anchor.x, y: profile.anchor.y };
    const match = this.#port.world;
    this.#route.p0 = p0;
    this.#route.p2 = {
      x: match.clampX(this.#route.p2.x, match.mapPadding),
      y: match.clampY(this.#route.p2.y, match.mapPadding),
    };

    const desired = desiredControlPoint || this.#route.p1 || this.suggestControlForCurrentEndpoint();
    const relX = desired.x - p0.x;
    const relY = desired.y - p0.y;
    let u = dot(relX, relY, profile.forward.x, profile.forward.y);
    let v = dot(relX, relY, profile.left.x, profile.left.y);

    const endRelX = this.#route.p2.x - p0.x;
    const endRelY = this.#route.p2.y - p0.y;
    const ex = dot(endRelX, endRelY, profile.forward.x, profile.forward.y);
    const ey = dot(endRelX, endRelY, profile.left.x, profile.left.y);
    const bearingToEnd = Math.atan2(endRelY, endRelX);
    const deltaToEnd = shortestAngleDelta(profile.anchor.angle, bearingToEnd);
    const sideSign = deltaToEnd >= 0 ? 1 : -1;
    const reverseRatio = clamp(-ex / Math.max(80, profile.minTurnRadius * 1.2), 0, 1.45);
    const dynamicDeviation = profile.maxStartDeviation + reverseRatio * (Math.PI / 180) * 40;
    const dFromCurvature = Math.sqrt(Math.max(0, Math.abs(ey) * profile.minTurnRadius * 0.46));
    const reversePenalty = ex < 0 ? Math.abs(ex) * 0.28 : ex * 0.05;
    u = Math.max(u, profile.minForward, dFromCurvature, profile.minForward + reversePenalty);

    let maxLat = Math.max(10, u * Math.tan(dynamicDeviation));
    v = clamp(v, -maxLat, maxLat);
    if (reverseRatio > 0.45) {
      const minLatForReverse = Math.min(maxLat * 0.75, profile.minTurnRadius * 0.45);
      if (Math.abs(v) < minLatForReverse) {
        v = sideSign * minLatForReverse;
      }
    }

    let p1 = {
      x: p0.x + profile.forward.x * u + profile.left.x * v,
      y: p0.y + profile.forward.y * u + profile.left.y * v,
    };

    const maxCurvature = 1 / Math.max(1, profile.minTurnRadius);
    let curvature = quadraticStartCurvature(p0, p1, this.#route.p2);
    let guard = 0;
    while (curvature > maxCurvature && guard < 20) {
      u *= 1.1;
      maxLat = Math.max(10, u * Math.tan(dynamicDeviation));
      v = clamp(v, -maxLat, maxLat);
      p1 = {
        x: p0.x + profile.forward.x * u + profile.left.x * v,
        y: p0.y + profile.forward.y * u + profile.left.y * v,
      };
      curvature = quadraticStartCurvature(p0, p1, this.#route.p2);
      guard += 1;
    }

    this.#route.p1 = {
      x: p1.x,
      y: p1.y,
    };
    if (resetProgress) {
      this.#route.t = 0;
    }
    this.#route.length = quadraticLengthApprox(this.#route.p0, this.#route.p1, this.#route.p2);
    this.#command.x = this.#route.p2.x;
    this.#command.y = this.#route.p2.y;
  }

  setBezierRoute(controlX, controlY, endX, endY, throttle, anchorToMain = true) {
    this.#routeView = undefined;
    const match = this.#port.world;
    this.#port.throttle = normalizeThrottleToGear(throttle, this.#port.throttle);
    this.#route = {
      anchorToMain,
      p0: { x: this.#port.x, y: this.#port.y },
      p1: { x: this.#port.x, y: this.#port.y },
      p2: {
        x: match.clampX(endX, match.mapPadding),
        y: match.clampY(endY, match.mapPadding),
      },
      t: 0,
      length: 1,
    };

    const hasControl = Number.isFinite(controlX) && Number.isFinite(controlY);
    const desiredControl = hasControl
      ? {
          x: match.clampX(controlX, match.mapPadding),
          y: match.clampY(controlY, match.mapPadding),
        }
      : this.suggestControlForCurrentEndpoint();

    this.enforceRouteFeasibility(desiredControl, true);
  }

  setRouteControl(controlX, controlY, resetProgress = false) {
    this.#routeView = undefined;
    if (!this.#route) {
      return;
    }
    const match = this.#port.world;
    this.enforceRouteFeasibility(
      {
        x: match.clampX(controlX, match.mapPadding),
        y: match.clampY(controlY, match.mapPadding),
      },
      resetProgress,
    );
  }

  setRouteEndpoint(endX, endY, resetProgress = false) {
    this.#routeView = undefined;
    if (!this.#route) {
      return;
    }
    const match = this.#port.world;
    this.#route.p2 = {
      x: match.clampX(endX, match.mapPadding),
      y: match.clampY(endY, match.mapPadding),
    };
    this.enforceRouteFeasibility(this.#route.p1, resetProgress);
  }

  clearRoute() {
    this.#routeView = undefined;
    this.#route = null;
  }

  advance(dt) {
    this.#routeView = undefined;
    const match = this.#port.world;
    if (this.#port.isAttached()) {
      this.followLeader(dt);
      return;
    }

    let navTargetX = this.#command.x;
    let navTargetY = this.#command.y;

    if (this.#route) {
      this.enforceRouteFeasibility(this.#route.p1, false);
      const speedRatio = clamp(this.#port.speed / Math.max(this.#port.effectiveSpeed(), 1), 0, 1);
      const lookLead = 0.04 + speedRatio * 0.12;
      const lookT = clamp(this.#route.t + lookLead, 0, 1);
      const lookAhead = quadraticPoint(this.#route.p0, this.#route.p1, this.#route.p2, lookT);
      // 曲率约束可能为靠近边界的掉头航线生成地图外控制点。曲线本身可以保留，
      // 但导航前视点若也落到地图外，舰船会保持正常内部航速朝边界外航行，
      // 实际位置却被边界钳住，视觉上就像换挡后熄火。此时直接朝地图内的航线终点
      // 脱离边界；单纯钳制前视点可能恰好落在舰船脚下，反而触发到点停车。
      const lookAheadOutside = (
        lookAhead.x < 8
        || lookAhead.x > match.worldSize - 8
        || lookAhead.y < 8
        || lookAhead.y > match.worldSize - 8
      );
      navTargetX = lookAheadOutside ? this.#route.p2.x : lookAhead.x;
      navTargetY = lookAheadOutside ? this.#route.p2.y : lookAhead.y;
    }

    const navDx = navTargetX - this.#port.x;
    const navDy = navTargetY - this.#port.y;
    const dist = Math.hypot(navDx, navDy);
    // 已到达目标且没有位移需求时保持当前航向；atan2(0, 0) 会返回 0，曾令朝向 π 的 B 方旗舰
    // 在原地无故掉头，进而拖动整支附着编队散开。
    const desired = dist > 1e-4 ? Math.atan2(navDy, navDx) : this.#port.angle;
    const delta = shortestAngleDelta(this.#port.angle, desired);
    const deltaAbs = Math.abs(delta);
    const turnUrgency = clamp(deltaAbs / Math.PI, 0, 1);
    const reverseAssist = this.#route && deltaAbs > 2.35 ? 0.85 : 0;
    const turnBoost = this.#route ? 1 + turnUrgency * 2.8 + reverseAssist : 1;
    const turnRate = this.#port.effectiveTurnRate() * (0.22 + this.#port.throttle * 0.4) * turnBoost;
    this.#port.angle += clamp(delta, -turnRate * dt, turnRate * dt);

    const throttlePenalty = this.#port.energySpeedFactor();
    const steerBrake = this.#route ? clamp(1 - turnUrgency * 0.78, 0.22, 1) : 1;
    const minimumSpeed = this.#port.minimumFlightSpeed();
    const targetSpeed = Math.max(minimumSpeed, dist < 8 ? 0 : this.#port.effectiveSpeed() * this.#port.throttle * throttlePenalty * steerBrake * this.#port.collisionSpeedFactor());

    const accelResponse = clamp(this.#port.baseAcceleration() * this.#port.accelerationMultiplier(), 0.65, 9.6);
    this.#port.speed = Math.max(minimumSpeed, lerp(this.#port.speed, targetSpeed, clamp(dt * accelResponse, 0, 1)));

    this.#port.advanceFlight(dt);

    if (this.#route) {
      const minAdvance = 5;
      // 普通 P 档保持航线进度；刀锋强制前飞时仍推进航线。
      const routeSpeed = this.#port.throttle <= 0 && minimumSpeed <= 0 ? 0 : Math.max(minAdvance, this.#port.speed);
      const headingAlign = clamp(Math.cos(deltaAbs), -1, 1);
      const alignFactor = clamp((headingAlign + 0.25) / 1.25, 0.12, 1);
      const deltaT = (routeSpeed * dt * alignFactor) / Math.max(130, this.#route.length);
      this.#route.t = clamp(this.#route.t + deltaT, 0, 1);
      if (this.#route.t >= 1 && distance(this.#port.x, this.#port.y, this.#route.p2.x, this.#route.p2.y) <= 20) {
        this.#route = null;
      }
    }
  }

  updateForcedKnockback() {
    const forced = this.#forcedKnockback;
    if (!forced) {
      return false;
    }
    if (this.#port.isControlImmune() || this.#port.minimumFlightSpeed() > 0) {
      // 光球免控与刀锋持续前飞均不接受旧击退插值，避免随后回跳到旧坐标。
      this.#forcedKnockback = null;
      return false;
    }
    const now = this.#port.world.elapsed;
    const duration = Math.max(0.001, forced.endsAt - forced.startedAt);
    const progress = clamp((now - forced.startedAt) / duration, 0, 1);
    const eased = 1 - (1 - progress) * (1 - progress);
    this.#port.x = lerp(forced.fromX, forced.toX, eased);
    this.#port.y = lerp(forced.fromY, forced.toY, eased);
    this.#port.speed = 0;
    if (progress < 1) {
      return true;
    }
    this.#forcedKnockback = null;
    this.#route = null;
    this.#port.clearCollisionSlow();
    return false;
  }

  followLeader(dt) {
    this.#routeView = undefined;
    const match = this.#port.world;
    const leader = this.#port.leader();
    const compactMode = this.#port.formationSize() > 1;
    const offsetScale = compactMode ? 0.5 : 1;
    const rot = rotateOffset(this.#port.formationOffset.x * offsetScale, this.#port.formationOffset.y * offsetScale, leader.angle);
    const tx = leader.x + rot.x;
    const ty = leader.y + rot.y;

    this.#command.x = tx;
    this.#command.y = ty;

    const errorX = tx - this.#port.x;
    const errorY = ty - this.#port.y;
    const dist = Math.hypot(errorX, errorY);
    // 编队跟随采用「旗舰速度 + 位置误差修正」的期望速度。
    // 旧逻辑即使旗舰静止也让副舰以巡航速度冲向编队点，越过后再折返；B 方初始朝向为 π，
    // 症状尤其明显，会在开局向两侧大幅散开。现在到位后自然静止，旗舰移动时再同步跟进。
    const correctionRate = compactMode ? 1.35 : 0.82;
    const desiredVx = Math.cos(leader.angle) * leader.speed + errorX * correctionRate;
    const desiredVy = Math.sin(leader.angle) * leader.speed + errorY * correctionRate;
    const desiredSpeed = Math.hypot(desiredVx, desiredVy);
    const desired = desiredSpeed > 0.05 ? Math.atan2(desiredVy, desiredVx) : leader.angle;
    const delta = shortestAngleDelta(this.#port.angle, desired);
    const turnRate = this.#port.effectiveFormationTurnRate();
    this.#port.angle += clamp(delta, -turnRate * dt, turnRate * dt);

    const fleetSpeed = this.#port.effectiveSpeed();
    const targetSpeed = Math.min(desiredSpeed, fleetSpeed * (compactMode ? 1.4 : 1.18));
    const accelResponse = clamp(this.#port.baseAcceleration() * this.#port.accelerationMultiplier() * (compactMode ? 1.8 : 1.3), 0.8, 3.2);
    this.#port.speed = lerp(this.#port.speed, targetSpeed, clamp(dt * accelResponse, 0, 1));

    this.#port.x += Math.cos(this.#port.angle) * this.#port.speed * dt;
    this.#port.y += Math.sin(this.#port.angle) * this.#port.speed * dt;
    this.#port.x = match.clampX(this.#port.x, 8);
    this.#port.y = match.clampY(this.#port.y, 8);

    if (compactMode && dist < 11) {
      this.#port.x = lerp(this.#port.x, tx, clamp(dt * 6, 0, 1));
      this.#port.y = lerp(this.#port.y, ty, clamp(dt * 6, 0, 1));
    }
  }

}
