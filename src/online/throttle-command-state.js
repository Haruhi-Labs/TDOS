import { normalizeThrottleToGear } from "../../shared/game/throttle.js";

const DEFAULT_MAX_ACK_HOLD_MS = 1200;
const THROTTLE_EPSILON = 1e-6;

function normalizedThrottle(value, fallback = 1) {
  return normalizeThrottleToGear(value, fallback);
}

// 联机换挡采用「本地意图保持到权威快照确认」：否则高频旧快照会在指令往返期间
// 短暂覆盖刚选择的档位，随后创建航线又会把旧档位送回服务端。
export function createThrottleCommandState({ maxAckHoldMs = DEFAULT_MAX_ACK_HOLD_MS } = {}) {
  const pendingByShip = new Map();
  const safeMaxAckHoldMs = Math.max(0, Number(maxAckHoldMs) || 0);

  return {
    record(shipKey, seq, throttle, createdAtMs = 0) {
      const key = String(shipKey || "");
      const sequence = Number(seq);
      if (!key || !Number.isInteger(sequence) || sequence < 0) {
        return false;
      }

      const current = pendingByShip.get(key);
      if (current && current.seq > sequence) {
        return false;
      }

      pendingByShip.set(key, {
        seq: sequence,
        throttle: normalizedThrottle(throttle),
        createdAtMs: Number(createdAtMs) || 0,
        ackedAtMs: null,
      });
      return true;
    },

    valueFor(shipKey, authoritativeThrottle) {
      const pending = pendingByShip.get(String(shipKey || ""));
      return pending
        ? pending.throttle
        : normalizedThrottle(authoritativeThrottle);
    },

    reconcile({ ackSeq, ships, nowMs = 0 } = {}) {
      const acknowledgedSequence = Number(ackSeq);
      const currentTime = Number(nowMs) || 0;

      for (const [shipKey, pending] of pendingByShip) {
        if (!Number.isInteger(acknowledgedSequence) || acknowledgedSequence < pending.seq) {
          continue;
        }

        const ship = ships ? ships[shipKey] : null;
        const authoritativeThrottle = ship
          ? normalizedThrottle(ship.throttle, pending.throttle)
          : null;
        if (
          authoritativeThrottle !== null
          && Math.abs(authoritativeThrottle - pending.throttle) <= THROTTLE_EPSILON
        ) {
          pendingByShip.delete(shipKey);
          continue;
        }

        if (pending.ackedAtMs === null) {
          pending.ackedAtMs = currentTime;
        } else if (currentTime - pending.ackedAtMs >= safeMaxAckHoldMs) {
          // 舰船可能已被击沉或指令因状态变化未生效；避免无效意图永久覆盖权威状态。
          pendingByShip.delete(shipKey);
        }
      }
    },

    clear() {
      pendingByShip.clear();
    },
  };
}
